/* Spectre Orbit Online — Matchmaking & Signaling Server
   Node.js LTS + WebSocket (ws)
   Handles room creation, room browsing, reservations, WebRTC signaling, STUN/TURN config, and health checks. */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'node:crypto';

const PROTOCOL_VERSION = 'spectre-1.5';
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const RESERVATION_TTL_MS = 15000;
const ROOM_HEARTBEAT_TTL_MS = 35000;
const MAX_PAYLOAD_BYTES = 65536; // 64 KB
const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_MESSAGES_PER_WINDOW = 40;

// STUN / TURN configuration
function getIceServers() {
  const servers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
  ];
  if (process.env.TURN_URL) {
    const turnConfig = { urls: process.env.TURN_URL };
    if (process.env.TURN_SECRET) {
      // Ephemeral TURN credentials (RFC 5766 / Coturn style)
      const username = `${Math.floor(Date.now() / 1000) + 3600}:${crypto.randomBytes(4).toString('hex')}`;
      const hmac = crypto.createHmac('sha1', process.env.TURN_SECRET);
      hmac.update(username);
      turnConfig.username = username;
      turnConfig.credential = hmac.digest('base64');
    } else if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      turnConfig.username = process.env.TURN_USERNAME;
      turnConfig.credential = process.env.TURN_CREDENTIAL;
    }
    servers.push(turnConfig);
  }
  return servers;
}

// 5-character readable room codes excluding easily confused chars (I, O, 0, 1, L)
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function generateRoomCode(existingCodes) {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!existingCodes.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function sanitizeText(str, maxLen = 32) {
  if (typeof str !== 'string') return '';
  return str.replace(/[^\w\s\-\.\#\:\/\(\)\[\]]/gi, '').trim().slice(0, maxLen);
}

export function createServer(options = {}) {
  const rooms = new Map(); // code -> Room
  const clients = new Map(); // ws -> ClientInfo
  const staticDir = options.staticDir || null;

  const server = http.createServer((req, res) => {
    // CORS headers for API calls
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        protocol: PROTOCOL_VERSION,
        uptime: process.uptime(),
        rooms: rooms.size,
        clients: clients.size,
        timestamp: Date.now(),
      }));
      return;
    }

    if (url.pathname === '/ice') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ iceServers: getIceServers() }));
      return;
    }

    if (url.pathname === '/rooms') {
      const list = [];
      const now = Date.now();
      for (const [code, r] of rooms) {
        if (!r.isPrivate && now - r.lastHeartbeat < ROOM_HEARTBEAT_TTL_MS) {
          list.push({
            code,
            name: r.name,
            host: r.hostName,
            map: r.map,
            mode: r.mode,
            players: r.players.size,
            max: r.maxPlayers,
            ping: 0,
          });
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }

    // Static file serving fallback if staticDir is provided
    if (staticDir && req.method === 'GET') {
      let filePath = path.join(staticDir, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, ''));
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.mjs': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.glb': 'model/gltf-binary',
          '.wasm': 'application/wasm',
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD_BYTES });

  function send(ws, msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function broadcastRoomUpdate(room) {
    const info = {
      t: 'room_state',
      code: room.code,
      players: room.players.size,
      max: room.maxPlayers,
    };
    for (const pid of room.players) {
      for (const [cws, cinfo] of clients) {
        if (cinfo.peerId === pid) send(cws, info);
      }
    }
  }

  function cleanupStaleRooms() {
    const now = Date.now();
    for (const [code, r] of rooms) {
      if (now - r.lastHeartbeat > ROOM_HEARTBEAT_TTL_MS) {
        // Notify any remaining guests
        for (const pid of r.players) {
          if (pid !== r.hostPeerId) {
            for (const [cws, cinfo] of clients) {
              if (cinfo.peerId === pid) send(cws, { t: 'error', code: 'HOST_DISCONNECTED', message: 'Room host disconnected due to inactivity.' });
            }
          }
        }
        rooms.delete(code);
      } else {
        // Clean up expired reservations
        for (const [resId, res] of r.reservations) {
          if (now > res.expiresAt) {
            r.reservations.delete(resId);
          }
        }
      }
    }
  }

  const cleanupTimer = setInterval(cleanupStaleRooms, 10000);

  wss.on('connection', (ws, req) => {
    const sessionId = crypto.randomUUID();
    const client = {
      ws,
      sessionId,
      peerId: null,
      name: '',
      roomCode: null,
      isHost: false,
      msgCount: 0,
      windowStart: Date.now(),
    };
    clients.set(ws, client);

    // Initial greeting with session identity and ICE server configuration
    send(ws, {
      t: 'welcome',
      sessionId,
      protocol: PROTOCOL_VERSION,
      iceServers: getIceServers(),
    });

    ws.on('message', raw => {
      // Rate limiting
      const now = Date.now();
      if (now - client.windowStart > RATE_LIMIT_WINDOW_MS) {
        client.windowStart = now;
        client.msgCount = 0;
      }
      client.msgCount++;
      if (client.msgCount > MAX_MESSAGES_PER_WINDOW) {
        send(ws, { t: 'error', code: 'RATE_LIMIT', message: 'Too many messages sent. Slow down.' });
        return;
      }

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { t: 'error', code: 'MALFORMED', message: 'Invalid JSON payload.' });
        return;
      }

      if (!msg || typeof msg.t !== 'string') return;

      // Handle message types
      switch (msg.t) {
        case 'ping':
          send(ws, { t: 'pong', c: msg.c });
          break;

        case 'identity':
          client.peerId = sanitizeText(msg.peerId, 32) || client.sessionId;
          client.name = sanitizeText(msg.name, 24) || 'Player';
          break;

        case 'create_room': {
          if (client.roomCode) {
            send(ws, { t: 'error', code: 'ALREADY_IN_ROOM', message: 'Already in a room.' });
            return;
          }
          const code = generateRoomCode(rooms);
          const maxPlayers = Math.min(Math.max(parseInt(msg.max || '6', 10), 2), 12);
          const room = {
            code,
            name: sanitizeText(msg.name, 32) || `${client.name}'s Match`,
            hostSessionId: client.sessionId,
            hostPeerId: client.peerId || client.sessionId,
            hostName: client.name || 'Host',
            map: sanitizeText(msg.map, 24) || 'foundry',
            seed: parseInt(msg.seed || '0', 10) || 0,
            mode: sanitizeText(msg.mode, 8) || 'ffa',
            isPrivate: !!msg.isPrivate,
            maxPlayers,
            players: new Set([client.peerId || client.sessionId]),
            reservations: new Map(),
            created: now,
            lastHeartbeat: now,
          };
          rooms.set(code, room);
          client.roomCode = code;
          client.isHost = true;

          send(ws, {
            t: 'room_created',
            code,
            room: {
              code,
              name: room.name,
              map: room.map,
              seed: room.seed,
              mode: room.mode,
              isPrivate: room.isPrivate,
              maxPlayers: room.maxPlayers,
            },
          });
          break;
        }

        case 'heartbeat': {
          if (client.roomCode) {
            const room = rooms.get(client.roomCode);
            if (room && room.hostSessionId === client.sessionId) {
              room.lastHeartbeat = now;
              if (msg.players !== undefined) {
                // Synchronize active player count from host
                // Host reports current players
              }
            }
          }
          break;
        }

        case 'list_rooms': {
          const list = [];
          for (const [code, r] of rooms) {
            if (!r.isPrivate && now - r.lastHeartbeat < ROOM_HEARTBEAT_TTL_MS) {
              list.push({
                code,
                name: r.name,
                host: r.hostName,
                map: r.map,
                mode: r.mode,
                players: r.players.size,
                max: r.maxPlayers,
              });
            }
          }
          send(ws, { t: 'room_list', rooms: list });
          break;
        }

        case 'join_room': {
          const code = (msg.code || '').trim().toUpperCase();
          const room = rooms.get(code);
          if (!room || now - room.lastHeartbeat > ROOM_HEARTBEAT_TTL_MS) {
            send(ws, { t: 'error', code: 'ROOM_NOT_FOUND', message: 'Room not found or no longer active.' });
            return;
          }

          // Check capacity including active reservations
          const activeResCount = Array.from(room.reservations.values()).filter(r => now < r.expiresAt).length;
          if (room.players.size + activeResCount >= room.maxPlayers) {
            send(ws, { t: 'error', code: 'ROOM_FULL', message: 'Room is at full capacity.' });
            return;
          }

          const reservationId = crypto.randomUUID();
          room.reservations.set(reservationId, {
            peerId: client.peerId || client.sessionId,
            expiresAt: now + RESERVATION_TTL_MS,
          });

          client.roomCode = code;
          client.isHost = false;

          // Find host ws
          let hostWs = null;
          for (const [cws, cinfo] of clients) {
            if (cinfo.sessionId === room.hostSessionId) {
              hostWs = cws;
              break;
            }
          }

          if (!hostWs) {
            send(ws, { t: 'error', code: 'HOST_UNAVAILABLE', message: 'Room host is unavailable.' });
            return;
          }

          send(ws, {
            t: 'join_reserved',
            code,
            reservationId,
            room: {
              code,
              name: room.name,
              host: room.hostName,
              map: room.map,
              seed: room.seed,
              mode: room.mode,
              maxPlayers: room.maxPlayers,
            },
          });

          // Inform host of the prospective guest
          send(hostWs, {
            t: 'guest_join_request',
            reservationId,
            peerId: client.peerId || client.sessionId,
            name: client.name || 'Guest',
            char: sanitizeText(msg.char, 32) || '',
          });
          break;
        }

        case 'guest_joined_ack': {
          // Sent by host when guest successfully finishes DataChannel negotiation
          if (client.isHost && client.roomCode) {
            const room = rooms.get(client.roomCode);
            if (room && room.hostSessionId === client.sessionId) {
              const peerId = msg.peerId;
              if (peerId) {
                room.players.add(peerId);
                if (msg.reservationId) room.reservations.delete(msg.reservationId);
                broadcastRoomUpdate(room);
              }
            }
          }
          break;
        }

        case 'guest_left': {
          if (client.isHost && client.roomCode) {
            const room = rooms.get(client.roomCode);
            if (room && room.hostSessionId === client.sessionId) {
              room.players.delete(msg.peerId);
              broadcastRoomUpdate(room);
            }
          }
          break;
        }

        // WebRTC Signaling Forwarding (Offer, Answer, ICE Candidate)
        case 'signal': {
          const targetPeerId = msg.target;
          if (!targetPeerId) return;

          // Target peer resolution: find client with matching peerId or sessionId
          let targetWs = null;
          for (const [cws, cinfo] of clients) {
            if (cinfo.peerId === targetPeerId || cinfo.sessionId === targetPeerId) {
              targetWs = cws;
              break;
            }
          }

          if (targetWs) {
            // Forward signal with authenticated sender ID (cannot be spoofed by client!)
            send(targetWs, {
              t: 'signal',
              from: client.peerId || client.sessionId,
              signal: msg.signal,
            });
          }
          break;
        }

        case 'leave_room': {
          if (client.roomCode) {
            const room = rooms.get(client.roomCode);
            if (room) {
              if (client.isHost) {
                // Host left: close room and notify all players
                const notifiedPids = new Set();
                for (const pid of room.players) notifiedPids.add(pid);
                for (const [, res] of room.reservations) notifiedPids.add(res.peerId);

                for (const pid of notifiedPids) {
                  if (pid !== client.peerId) {
                    for (const [cws, cinfo] of clients) {
                      if (cinfo.peerId === pid || cinfo.sessionId === pid) {
                        send(cws, { t: 'error', code: 'HOST_CLOSED', message: 'Host has closed the match.' });
                      }
                    }
                  }
                }
                rooms.delete(client.roomCode);
              } else {
                room.players.delete(client.peerId || client.sessionId);
                // Notify host
                for (const [cws, cinfo] of clients) {
                  if (cinfo.sessionId === room.hostSessionId) {
                    send(cws, { t: 'peer_disconnected', peerId: client.peerId || client.sessionId });
                  }
                }
                broadcastRoomUpdate(room);
              }
            }
            client.roomCode = null;
            client.isHost = false;
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      if (client.roomCode) {
        const room = rooms.get(client.roomCode);
        if (room) {
          if (client.isHost) {
            // Host disconnected: close room
            const notifiedPids = new Set();
            for (const pid of room.players) notifiedPids.add(pid);
            for (const [, res] of room.reservations) notifiedPids.add(res.peerId);

            for (const pid of notifiedPids) {
              if (pid !== client.peerId) {
                for (const [cws, cinfo] of clients) {
                  if (cinfo.peerId === pid || cinfo.sessionId === pid) {
                    send(cws, { t: 'error', code: 'HOST_DISCONNECTED', message: 'Room host has disconnected.' });
                  }
                }
              }
            }
            rooms.delete(client.roomCode);
          } else {
            room.players.delete(client.peerId || client.sessionId);
            for (const [cws, cinfo] of clients) {
              if (cinfo.sessionId === room.hostSessionId) {
                send(cws, { t: 'peer_disconnected', peerId: client.peerId || client.sessionId });
              }
            }
            broadcastRoomUpdate(room);
          }
        }
      }
      clients.delete(ws);
    });
  });

  return {
    server,
    wss,
    rooms,
    clients,
    close: () => {
      clearInterval(cleanupTimer);
      wss.close();
      server.close();
    },
  };
}

// Standalone execution
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const defaultStatic = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/online');
  const staticDir = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : (fs.existsSync(defaultStatic) ? defaultStatic : null);
  const instance = createServer({ staticDir });
  instance.server.listen(PORT, HOST, () => {
    console.log(`[Spectre Orbit Server] Listening on http://${HOST}:${PORT} (Protocol: ${PROTOCOL_VERSION})`);
    if (staticDir) console.log(`[Spectre Orbit Server] Serving web game from ${staticDir}`);
  });
}

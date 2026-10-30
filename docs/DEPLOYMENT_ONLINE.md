# Spectre Orbit Online — Production Deployment & Operations Guide

## 1. Architecture Overview

Spectre Orbit Online introduces an internet-ready, browser-playable multiplayer FPS powered by **Babylon.js 9** while preserving the standalone single-file Three.js LAN version (`LAN_FPS.html`).

```
                              [ CLIENT (Browser) ]
                                      │
                   ┌──────────────────┴──────────────────┐
                   │ HTTPS / WSS                         │ WebRTC (UDP)
                   ▼                                     ▼
        [ MATCHMAKING / SIGNALING ]              [ PEER-TO-PEER DATA ]
        - Node.js LTS (index.mjs)                - Authoritative Host (60 Hz)
        - Session authentication                 - Reliable channel ('rel')
        - Room codes & reservation               - Fast channel ('fast')
        - Trickle ICE exchange                   - Client prediction & lerp
                   │
                   ▼
          [ STUN / TURN SERVER ]
          - Google STUN (direct P2P)
          - Coturn Relay (Symmetric NAT)
```

---

## 2. Quickstart & Local Development

### Prerequisites
- Node.js v20+ LTS
- modern WebGPU / WebGL 2 compatible browser (Chrome, Edge, Firefox, Brave)

### 1. Install Dependencies
```bash
# Server dependencies
cd server
npm install

# Client dependencies
cd ../source
npm install
```

### 2. Start Matchmaking Server
```bash
cd server
npm start
# Output: [Spectre Orbit Server] Listening on http://0.0.0.0:8080 (Protocol: spectre-1.5)
```

### 3. Build Distributions
```bash
cd source
npm run build:all
# Generates:
# - LAN_FPS.html (Classic Three.js offline edition)
# - LAN_FPS_online.html (Babylon.js standalone edition)
# - dist/online/index.html (Hosted web application)
```

### 4. Run Test Suites
```bash
# In source/
npm run test:all

# In server/
npm test
```

---

## 3. Production Deployment

### Option A: Docker Deployment (Recommended)
```bash
docker compose up -d --build
```
This builds and starts the signaling server with the static online game client hosted on port `8080`.

### Option B: Systemd Service + Nginx Reverse Proxy
1. Build the online frontend:
   ```bash
   cd source && npm run build:online
   ```
2. Copy `dist/online/` to `/var/www/spectre-orbit/dist/online`.
3. Configure `spectre-signaling.service` in `/etc/systemd/system/`:
   ```ini
   [Unit]
   Description=Spectre Orbit Matchmaking Service
   After=network.target

   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/var/www/spectre-orbit/server
   ExecStart=/usr/bin/node index.mjs
   Restart=always
   RestartSec=5
   Environment=PORT=8080
   Environment=HOST=127.0.0.1
   Environment=TURN_URL=turn:turn.yourdomain.com:3478
   Environment=TURN_SECRET=your_turn_secret_here

   [Install]
   WantedBy=multi-user.target
   ```
4. Configure Nginx with `server/nginx.conf` and obtain SSL certificates via Certbot:
   ```bash
   certbot --nginx -d play.yourdomain.com
   ```

---

## 4. WebRTC STUN & TURN Configuration

### STUN (Session Traversal Utilities for NAT)
By default, the signaling server provides Google's public STUN servers:
- `stun:stun.l.google.com:19302`
- `stun:stun1.l.google.com:19302`

STUN enables direct peer-to-peer UDP connectivity for approximately 80-85% of domestic internet connections without relay cost.

### TURN (Traversal Using Relays around NAT)
For symmetric NATs, cellular data, or corporate/campus firewalls, a TURN relay server (such as Coturn) is necessary.

1. Deploy Coturn using `server/turnserver.conf`.
2. Configure the shared secret in Coturn and set `TURN_SECRET` in the signaling server environment.
3. The signaling server dynamically generates short-lived ephemeral credentials (RFC 5766) and supplies them to connecting clients during the WebSocket handshake.
4. **Never embed permanent TURN credentials in the client bundle.**

---

## 5. Unreal Engine Counterpart Compatibility

The parallel Unreal Engine port is developed independently. Both implementations adhere to the shared design contracts:

| Domain | Specification | Notes |
|---|---|---|
| **Map Identifiers** | `foundry`, `school`, `railyard`, `glowplant`, `zenith`, `forest`, `aftermath`, `river`, `sandbox`, `arena` | Exact lowercase keys |
| **Operative IDs** | `abdulkarim`, `mina`, `eldeep`, `gemy`, `hamdy`, `hooda`, `romero` | Matches character models |
| **Weapon IDs** | `ak47`, `shotgun`, `sniper`, `smg`, `lmg`, `knife` | Identical baseline stats |
| **Damage Rules** | 100 HP, 25/50 AK47, 55/110 Knife, 10 kills win condition | Defined in `sim.js` |
| **Protocol Version** | `spectre-1.5` | Enforced at handshake |

*Note: Direct WebRTC cross-play between the browser client and native Unreal dedicated servers requires dedicated protocol serialization (e.g. FlatBuffers or custom binary frames) and is planned for Milestone 2.0.*

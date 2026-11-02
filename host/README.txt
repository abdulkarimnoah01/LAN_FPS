SPECTRE ORBIT - HOST PACK
=========================

HOST (the PC that runs the match server)
  1. Double-click Start_Host.bat.
     - First run may offer to install Node.js and cloudflared with winget. Say Y.
     - It starts the server, opens a free Cloudflare tunnel (no VPN, no port
       forwarding) and opens the game in your browser.
  2. It prints a JOIN CODE (also copied to your clipboard and saved in join_code.txt).
  3. Keep the window open while playing. Close it to stop the server.

  Options:  Start_Host.bat -NoTunnel   LAN only, no internet tunnel
            Start_Host.bat -NoBrowser  do not open the game page

REMOTE PLAYERS
  1. Open Spectre_Orbit_Light.html (this file is in the pack; send it to friends once).
  2. Settings -> "Server join code or address" -> paste the code -> Save & reconnect.
     The code is remembered. The host gets a new code each time they start the launcher.
  Or open the file with ?server=<code> added to its address.

NOTES
  - The code changes every time the tunnel restarts (free Cloudflare quick tunnel).
  - Only matchmaking goes through the tunnel; the match itself is peer-to-peer.
    Players behind strict NATs (some mobile data / ISP setups) may need a TURN relay.
  - Windows 10/11, PowerShell 5.1+. Node.js 18+ is needed on the host only.

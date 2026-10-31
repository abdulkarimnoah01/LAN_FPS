<#
  Spectre Orbit host launcher.
  Starts the matchmaking server, opens a free Cloudflare tunnel so remote PCs can reach it with no VPN or
  port forwarding, prints a join code, and opens the game for you.

    -NoTunnel    LAN only (no internet tunnel)
    -NoBrowser   do not open the game page
    -Port 8080   server port
#>
param([switch]$NoTunnel, [switch]$NoBrowser, [int]$Port = 8080)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$children = @()

function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

function Find-Tool($name, $paths) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in $paths) { if (Test-Path $p) { return $p } }
  return $null
}

function Ensure-Tool($name, $paths, $wingetId, $label) {
  $found = Find-Tool $name $paths
  if ($found) { return $found }
  Say "$label is not installed." Yellow
  $a = Read-Host "Install it now with winget? (Y/n)"
  if ($a -match '^n') { throw "$label is required." }
  winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements --silent | Out-Null
  $found = Find-Tool $name $paths
  if (-not $found) { throw "$label installed, but it is not on PATH yet. Close this window and run the launcher again." }
  return $found
}

function Test-Health($p) {
  try { return (Invoke-RestMethod -Uri "http://127.0.0.1:$p/health" -TimeoutSec 2).status -eq 'ok' } catch { return $false }
}

Say ''
Say '  SPECTRE ORBIT // HOST LAUNCHER' Red
Say '  ------------------------------' DarkRed

# --- server -------------------------------------------------------------------------------------
$serverDir = Join-Path $root 'server'
if (-not (Test-Path (Join-Path $serverDir 'index.mjs'))) { $serverDir = Join-Path (Split-Path $root -Parent) 'server' }
$public = Join-Path $root 'public'
if (-not (Test-Path (Join-Path $public 'index.html'))) { $public = Join-Path (Split-Path $root -Parent) 'dist\online' }

if (Test-Health $Port) {
  Say "Server already running on port $Port. Reusing it." Green
} else {
  $node = Ensure-Tool 'node' @("$env:ProgramFiles\nodejs\node.exe") 'OpenJS.NodeJS.LTS' 'Node.js'
  $env:PORT = "$Port"; $env:HOST = '0.0.0.0'
  if (Test-Path (Join-Path $public 'index.html')) { $env:STATIC_DIR = $public }
  $children += Start-Process -FilePath $node -ArgumentList "`"$(Join-Path $serverDir 'index.mjs')`"" -WorkingDirectory $serverDir -WindowStyle Hidden -PassThru
  for ($i = 0; $i -lt 30 -and -not (Test-Health $Port); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Health $Port)) { throw "Server did not start on port $Port. Is something else using it?" }
  Say "Server started on port $Port." Green
}

$lanIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddress })
$lan = @($lanIps | Where-Object { $_ -like '192.168.*' }) + @($lanIps | Where-Object { $_ -like '10.*' }) + @($lanIps | Where-Object { $_ -match '^172\.(1[6-9]|2\d|3[01])\.' }) | Select-Object -First 1

# --- tunnel -------------------------------------------------------------------------------------
$code = $null
if (-not $NoTunnel) {
  $cf = Ensure-Tool 'cloudflared' @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe") 'Cloudflare.cloudflared' 'cloudflared'
  $log = Join-Path $env:TEMP 'spectre_orbit_tunnel.log'
  Remove-Item $log -ErrorAction SilentlyContinue
  $children += Start-Process -FilePath $cf -ArgumentList 'tunnel', '--url', "http://localhost:$Port", '--no-autoupdate' -RedirectStandardError $log -WindowStyle Hidden -PassThru
  Say 'Opening tunnel...' DarkGray
  for ($i = 0; $i -lt 60 -and -not $code; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
      $m = Select-String -Path $log -Pattern 'https://([a-z0-9-]+)\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($m) { $code = $m.Matches[0].Groups[1].Value }
    }
  }
  if (-not $code) { Say 'Tunnel did not come up. LAN play still works.' Yellow }
}

# --- summary ------------------------------------------------------------------------------------
Say ''
if ($code) {
  Set-Content -Path (Join-Path $root 'join_code.txt') -Value $code -Encoding ascii
  try { Set-Clipboard -Value $code } catch {}
  Say '  JOIN CODE (copied to clipboard):' White
  Say "      $code" Red
  Say ''
  Say '  Remote PCs: open LAN_FPS_online.html, go to Settings, paste the code in' DarkGray
  Say '  "Server join code", press Save & reconnect. It is remembered after that.' DarkGray
  Say "  Or open the file with  ?server=$code  added to its address." DarkGray
} else {
  Say '  No internet tunnel.' Yellow
}
if ($lan) { Say "  Same network: http://${lan}:$Port/" DarkGray }
Say "  This PC:      http://localhost:$Port/" DarkGray
Say ''
Say '  The join code changes each time the tunnel restarts.' DarkGray
Say '  Keep this window open while you play. Close it to stop the server.' DarkGray
Say ''

if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

try {
  while ($true) {
    Start-Sleep -Seconds 5
    if ($children.Count -gt 0 -and ($children | Where-Object { -not $_.HasExited }).Count -eq 0) { Say 'Server and tunnel stopped.' Yellow; break }
  }
} finally {
  foreach ($c in $children) { if ($c -and -not $c.HasExited) { try { Stop-Process -Id $c.Id -Force } catch {} } }
}

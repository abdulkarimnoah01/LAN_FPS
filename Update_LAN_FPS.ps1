<#
.SYNOPSIS
    LAN_FPS Online Updater
    Updates LAN_FPS to the latest version via Git or Direct Web Download.
.PARAMETER Force
    Force re-download / update even if already up to date.
.PARAMETER CheckOnly
    Only check if an update is available without downloading.
.PARAMETER NoLaunch
    Do not prompt to launch the game after updating.
.PARAMETER Branch
    Specify the Git branch (default: main).
#>

[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$CheckOnly,
    [switch]$NoLaunch,
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Colors & Formatting
function Write-Header {
    Write-Host ""
    Write-Host " ================================================= " -ForegroundColor Cyan
    Write-Host "                LAN_FPS UPDATER                    " -ForegroundColor Yellow
    Write-Host "   Low-poly LAN FPS · Studio Network Edition       " -ForegroundColor DarkGray
    Write-Host " ================================================= " -ForegroundColor Cyan
    Write-Host ""
}

function Write-Info($msg) { Write-Host " [INFO] " -ForegroundColor Blue -NoNewline; Write-Host $msg }
function Write-Success($msg) { Write-Host " [OK]   " -ForegroundColor Green -NoNewline; Write-Host $msg -ForegroundColor Green }
function Write-Warn($msg) { Write-Host " [WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $msg -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host " [ERR]  " -ForegroundColor Red -NoNewline; Write-Host $msg -ForegroundColor Red }

Write-Header

# Load updater config if present
$ConfigFile = Join-Path $ScriptDir "updater_config.json"
$Config = @{
    repo_owner = "abdulkarimnoah01"
    repo_name  = "LAN_FPS"
    branch     = $Branch
    git_url    = "https://github.com/abdulkarimnoah01/LAN_FPS.git"
    raw_base_url = "https://raw.githubusercontent.com/abdulkarimnoah01/LAN_FPS/main"
    version_url  = "https://raw.githubusercontent.com/abdulkarimnoah01/LAN_FPS/main/version.json"
    bundle_url   = "https://raw.githubusercontent.com/abdulkarimnoah01/LAN_FPS/main/LAN_FPS.html"
    auto_launch  = $true
}

if (Test-Path $ConfigFile) {
    try {
        $loadedConfig = Get-Content $ConfigFile -Raw | ConvertFrom-Json
        if ($loadedConfig.repo_owner) { $Config.repo_owner = $loadedConfig.repo_owner }
        if ($loadedConfig.repo_name)  { $Config.repo_name  = $loadedConfig.repo_name }
        if ($loadedConfig.branch)     { $Config.branch     = $loadedConfig.branch }
        if ($loadedConfig.git_url)    { $Config.git_url    = $loadedConfig.git_url }
        if ($loadedConfig.version_url){ $Config.version_url= $loadedConfig.version_url }
        if ($loadedConfig.bundle_url) { $Config.bundle_url = $loadedConfig.bundle_url }
        if ($loadedConfig.auto_launch -ne $null) { $Config.auto_launch = $loadedConfig.auto_launch }
    } catch {
        Write-Warn "Could not parse updater_config.json, using default settings."
    }
}

# Current local version
$LocalVersionFile = Join-Path $ScriptDir "version.json"
$CurrentVersion = "1.0.0"
if (Test-Path $LocalVersionFile) {
    try {
        $verData = Get-Content $LocalVersionFile -Raw | ConvertFrom-Json
        if ($verData.version) { $CurrentVersion = $verData.version }
    } catch {}
}
Write-Info "Current local version: v$CurrentVersion"
Write-Info "Target repository: $($Config.git_url)"

$IsGitInstalled = $false
try {
    $null = git --version 2>&1
    $IsGitInstalled = $true
} catch {
    $IsGitInstalled = $false
}

$IsGitRepo = (Test-Path (Join-Path $ScriptDir ".git"))
$Updated = $false

# -------------------------------------------------------------
# MODE 1: Git-based Update
# -------------------------------------------------------------
if ($IsGitInstalled -and $IsGitRepo) {
    Write-Info "Git detected in local repository. Using Git update mode..."
    try {
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"

        # Check remote origin
        $remotes = & git remote
        if (-not ($remotes -contains "origin")) {
            Write-Info "Configuring git remote 'origin' -> $($Config.git_url)"
            & git remote add origin $Config.git_url
        }

        Write-Info "Fetching latest changes from remote..."
        & git fetch origin $Config.branch --tags 2>$null

        $localHash = (& git rev-parse HEAD 2>$null).Trim()
        $remoteHash = (& git rev-parse "origin/$($Config.branch)" 2>$null).Trim()

        $ErrorActionPreference = $prevEAP

        if ($localHash -and $remoteHash -and $localHash -eq $remoteHash -and -not $Force) {
            Write-Success "LAN_FPS is already up to date! (Commit: $($localHash.Substring(0,7)))"
            $Updated = $true
        } else {
            if ($CheckOnly) {
                Write-Warn "Update available on origin/$($Config.branch) ($($remoteHash.Substring(0,7)))"
                return
            }

            Write-Info "Pulling updates from origin/$($Config.branch)..."
            $pullOut = & git pull --rebase origin $Config.branch 2>&1
            Write-Host $pullOut -ForegroundColor DarkGray

            $Updated = $true
            Write-Success "Git update completed successfully!"

            # Read new version if version.json updated
            if (Test-Path $LocalVersionFile) {
                try {
                    $verData = Get-Content $LocalVersionFile -Raw | ConvertFrom-Json
                    Write-Success "Updated to LAN_FPS v$($verData.version)!"
                    if ($verData.notes) { Write-Host "   Notes: $($verData.notes)" -ForegroundColor Cyan }
                } catch {}
            }
        }
    } catch {
        Write-Warn "Git update encountered an issue: $_. Falling back to direct Web download..."
    }
}

# -------------------------------------------------------------
# MODE 2: Web API / Direct Download Update (Zero-dependency fallback)
# -------------------------------------------------------------
if (-not $Updated -and (-not $IsGitRepo -or -not $IsGitInstalled -or $Force)) {
    Write-Info "Using Web download updater mode..."

    # 1. Fetch remote version info
    $RemoteVersion = $null
    $RemoteNotes = ""
    try {
        Write-Info "Checking latest version at $($Config.version_url)..."
        $webClient = New-Object System.Net.WebClient
        $webClient.Headers.Add("User-Agent", "LAN_FPS-Updater/1.0")
        $jsonStr = $webClient.DownloadString($Config.version_url)
        $remoteData = $jsonStr | ConvertFrom-Json
        $RemoteVersion = $remoteData.version
        $RemoteNotes = $remoteData.notes
    } catch {
        Write-Warn "Could not reach remote version server: $_"
        Write-Warn "If this is a private or new repository, please ensure it has been published to GitHub."
    }

    if ($RemoteVersion) {
        Write-Info "Latest online version: v$RemoteVersion"
        if ($RemoteNotes) { Write-Host "   What's new: $RemoteNotes" -ForegroundColor Cyan }

        $needsUpdate = ($RemoteVersion -ne $CurrentVersion) -or $Force
        if (-not $needsUpdate) {
            Write-Success "LAN_FPS is already at the latest version (v$CurrentVersion)."
        } else {
            if ($CheckOnly) {
                Write-Warn "Update available: v$CurrentVersion -> v$RemoteVersion"
                return
            }

            Write-Info "Downloading updated LAN_FPS.html..."
            $targetHtml = Join-Path $ScriptDir "LAN_FPS.html"
            $backupHtml = Join-Path $ScriptDir "LAN_FPS.html.bak"

            # Create backup if file exists
            if (Test-Path $targetHtml) {
                Copy-Item -Path $targetHtml -Destination $backupHtml -Force
            }

            try {
                $tempDownload = Join-Path $ScriptDir "LAN_FPS.tmp"
                # Use WebClient for direct progress/fast download
                $wc = New-Object System.Net.WebClient
                $wc.Headers.Add("User-Agent", "LAN_FPS-Updater/1.0")
                $wc.DownloadFile($Config.bundle_url, $tempDownload)

                $fileItem = Get-Item $tempDownload
                if ($fileItem.Length -lt 100000) {
                    throw "Downloaded file is suspiciously small ($($fileItem.Length) bytes). Possible 404 or connection error."
                }

                Move-Item -Path $tempDownload -Destination $targetHtml -Force
                if (Test-Path $backupHtml) { Remove-Item $backupHtml -Force }

                # Update version.json locally
                if ($remoteData) {
                    $remoteData | ConvertTo-Json -Depth 4 | Set-Content $LocalVersionFile -Encoding UTF8
                }

                $Updated = $true
                Write-Success "Update successful! LAN_FPS is now at v$RemoteVersion."
            } catch {
                Write-Err "Download failed: $_"
                if (Test-Path $backupHtml) {
                    Write-Warn "Restoring previous version from backup..."
                    Move-Item -Path $backupHtml -Destination $targetHtml -Force
                }
            }
        }
    } else {
        if (-not $IsGitRepo -and -not $Force) {
            Write-Warn "Could not verify online version. Your existing game remains ready to play."
        }
    }
}

# -------------------------------------------------------------
# Optional Launch
# -------------------------------------------------------------
$GameFile = Join-Path $ScriptDir "LAN_FPS.html"
if (Test-Path $GameFile) {
    Write-Host ""
    if (-not $NoLaunch) {
        $prompt = Read-Host " Launch LAN_FPS now? (Y/n)"
        if ($prompt -eq "" -or $prompt -match "^[yY]") {
            Write-Info "Launching LAN_FPS in default browser..."
            Start-Process $GameFile
        }
    }
} else {
    Write-Err "LAN_FPS.html was not found in $ScriptDir."
}

Write-Host ""
Write-Host " ================================================= " -ForegroundColor Cyan

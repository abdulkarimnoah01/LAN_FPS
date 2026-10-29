<#
.SYNOPSIS
    LAN_FPS Publisher
    Builds, tests, bumps version, commits, and pushes updates to Git.
#>

[CmdletBinding()]
param(
    [string]$Message,
    [string]$NewVersion
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host ""
Write-Host " ================================================= " -ForegroundColor Cyan
Write-Host "                LAN_FPS PUBLISHER                  " -ForegroundColor Yellow
Write-Host "       Build, Test & Push to Git Repository        " -ForegroundColor DarkGray
Write-Host " ================================================= " -ForegroundColor Cyan
Write-Host ""

# Step 1: Run build
Write-Host " [1/5] Building LAN_FPS.html from source..." -ForegroundColor Blue
Set-Location (Join-Path $ScriptDir "source")
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host " [ERR] Build failed! Aborting publish." -ForegroundColor Red
    exit 1
}

# Step 2: Run tests
Write-Host " [2/5] Running verification tests..." -ForegroundColor Blue
npm test
if ($LASTEXITCODE -ne 0) {
    Write-Host " [ERR] Unit tests failed! Aborting publish." -ForegroundColor Red
    exit 1
}

Set-Location $ScriptDir

# Step 3: Version and notes
$VerFile = Join-Path $ScriptDir "version.json"
$verObj = @{ version = "1.1.0"; name = "LAN_FPS"; date = (Get-Date -Format "yyyy-MM-dd"); notes = "" }
if (Test-Path $VerFile) {
    try { $verObj = Get-Content $VerFile -Raw | ConvertFrom-Json } catch {}
}

if (-not $NewVersion) {
    Write-Host ""
    $vInput = Read-Host " Enter new version number (current: $($verObj.version)) [Press Enter to keep]"
    if ($vInput -match "^\d+\.\d+") {
        $verObj.version = $vInput.Trim()
    }
} else {
    $verObj.version = $NewVersion
}

if (-not $Message) {
    $mInput = Read-Host " Enter changelog / commit message"
    if ($mInput) {
        $Message = $mInput.Trim()
        $verObj.notes = $Message
    } else {
        $Message = "Update LAN_FPS v$($verObj.version)"
    }
} else {
    $verObj.notes = $Message
}

$verObj.date = (Get-Date -Format "yyyy-MM-dd")
$verObj | ConvertTo-Json -Depth 4 | Set-Content $VerFile -Encoding UTF8
Write-Host " [3/5] Updated version.json -> v$($verObj.version)" -ForegroundColor Green

# Step 4: Git commit
Write-Host " [4/5] Staging files and creating Git commit..." -ForegroundColor Blue
git add .
$commitMsg = "v$($verObj.version): $Message"
git commit -m $commitMsg

# Step 5: Git push
Write-Host " [5/5] Pushing to remote Git repository..." -ForegroundColor Blue
$branch = "main"
git branch -M $branch 2>$null
$pushRes = git push -u origin $branch 2>&1
Write-Host $pushRes -ForegroundColor DarkGray

Write-Host ""
Write-Host " ================================================= " -ForegroundColor Cyan
Write-Host "  LAN_FPS v$($verObj.version) published successfully! " -ForegroundColor Green
Write-Host "  Any other PC can now run Update_LAN_FPS.bat     " -ForegroundColor Cyan
Write-Host " ================================================= " -ForegroundColor Cyan
Write-Host ""

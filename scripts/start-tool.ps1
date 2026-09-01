$ErrorActionPreference = 'Stop'

function Show-StartupError {
    param([string]$Message)
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($Message, 'SP Bulk Ads Builder') | Out-Null
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$distPath = Join-Path $projectRoot 'dist\index.html'
if (-not (Test-Path -LiteralPath $distPath)) {
    Show-StartupError 'The app build is missing. Please ask Codex to rebuild the tool.'
    exit 1
}

try {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
} catch {
    Show-StartupError 'Node.js was not found. Please install Node.js or ask Codex to repair the launcher.'
    exit 1
}

$runtimeDir = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

$selectedPort = $null
foreach ($candidate in 4173..4182) {
    $connection = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue
    if (-not $connection) {
        $selectedPort = $candidate
        break
    }
}

if (-not $selectedPort) {
    Show-StartupError 'Local ports 4173-4182 are in use. Close another local tool and try again.'
    exit 1
}

$stdoutPath = Join-Path $runtimeDir "server-$selectedPort.log"
$stderrPath = Join-Path $runtimeDir "server-$selectedPort-error.log"
$process = Start-Process -FilePath $nodePath `
    -ArgumentList @('server.mjs', '--port', $selectedPort, '--idle-minutes', '120') `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

$url = "http://127.0.0.1:$selectedPort"
$ready = $false
foreach ($attempt in 1..30) {
    Start-Sleep -Milliseconds 150
    if ($process.HasExited) {
        break
    }
    try {
        $health = Invoke-RestMethod -Uri "$url/__health" -TimeoutSec 1
        if ($health.ok -eq $true) {
            $ready = $true
            break
        }
    } catch {
        # The local server can need a short moment to bind the port.
    }
}

if (-not $ready) {
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Show-StartupError "The local app server did not start. Check $stderrPath"
    exit 1
}

@(
    "pid=$($process.Id)"
    "port=$selectedPort"
    "url=$url"
) | Set-Content -LiteralPath (Join-Path $runtimeDir 'last-server.txt') -Encoding ASCII

Start-Process $url

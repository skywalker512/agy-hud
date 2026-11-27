# AGY-HUD one-line installer for Windows (PowerShell 5.1+ and PowerShell 7+).
#
# Usage:
#   irm https://h.512.pub | iex
#   # or direct GitHub raw:
#   irm https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.ps1 | iex
#
# Optional environment variables:
#   $env:AGY_HUD_VERSION  Install a specific release tag (e.g. "1.2.0" or "v1.2.0")
#   $env:AGY_HUD_REF      Install from a specific git branch/ref (e.g. "main")
#   $env:AGY_HUD_TARGET   Custom plugin install directory (default: ~\.gemini\config\plugins\agy-hud)
#   $env:AGY_HUD_REPO     Override GitHub owner/repo (default: skywalker512/agy-hud)

$ErrorActionPreference = 'Stop'

# Ensure TLS 1.2 on Windows PowerShell 5.1
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
    # Ignore on newer .NET runtimes that manage TLS automatically
}

$Repo = if ($env:AGY_HUD_REPO) { $env:AGY_HUD_REPO } else { 'skywalker512/agy-hud' }
$Version = if ($env:AGY_HUD_VERSION) { $env:AGY_HUD_VERSION.Trim() } else { '' }
$Ref = if ($env:AGY_HUD_REF) { $env:AGY_HUD_REF.Trim() } else { '' }
$Target = if ($env:AGY_HUD_TARGET) { $env:AGY_HUD_TARGET.Trim() } else { '' }
$MinNodeMajor = 22
$MinNodeMinor = 18

function Write-Info([string]$Message) {
    Write-Host "[agy-hud] $Message"
}

function Write-Err([string]$Message) {
    Write-Host "[agy-hud] ERROR: $Message" -ForegroundColor Red
}

function Show-NodeInstallHelp {
    Write-Host ''
    Write-Host "AGY-HUD requires Node.js >= $MinNodeMajor.$MinNodeMinor (for built-in node:sqlite)." -ForegroundColor Yellow
    Write-Host 'Install or upgrade Node.js on Windows using one of the following:'
    Write-Host '  - winget:   winget install OpenJS.NodeJS.LTS'
    Write-Host '  - fnm:      winget install Schniz.fnm ; fnm install 22 ; fnm use 22'
    Write-Host '  - scoop:    scoop install nodejs-lts'
    Write-Host '  - Download: https://nodejs.org/en/download'
    Write-Host ''
    Write-Host 'Then open a new PowerShell window and re-run this installer.'
}

function Test-AllowedGitHubUrl([string]$Url, [string]$AllowedRepo) {
    try {
        $uri = [System.Uri]$Url
        if ($uri.Scheme -ne 'https') { return $false }
        if ($uri.UserInfo) { return $false }
        if (-not $uri.IsDefaultPort -and $uri.Port -ne 443) { return $false }
        $hostLower = $uri.Host.ToLowerInvariant()
        $decodedPath = [System.Uri]::UnescapeDataString($uri.AbsolutePath)
        if ($decodedPath.Contains([char]0) -or $decodedPath.Contains('\') -or ($decodedPath.Split('/') -contains '..')) {
            return $false
        }
        $pathLower = $uri.AbsolutePath.ToLowerInvariant()
        $repoLower = $AllowedRepo.ToLowerInvariant()

        if (($hostLower -eq 'github.com' -or $hostLower -eq 'codeload.github.com') -and $pathLower.StartsWith("/$repoLower/")) {
            return $true
        }
        if ($hostLower -eq 'api.github.com' -and $pathLower.StartsWith("/repos/$repoLower/")) {
            return $true
        }
        return $false
    } catch {
        return $false
    }
}

function Expand-ZipSafely([string]$ZipPath, [string]$DestDir) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $fullDest = [System.IO.Path]::GetFullPath($DestDir)
    if (-not $fullDest.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $fullDest = $fullDest + [System.IO.Path]::DirectorySeparatorChar
    }
    [System.IO.Directory]::CreateDirectory($fullDest) | Out-Null

    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        foreach ($entry in $archive.Entries) {
            $rel = $entry.FullName -replace '\\', '/'
            if ($rel.StartsWith('/') -or $rel -match '^[A-Za-z]:' -or ($rel.Split('/') -contains '..')) {
                throw "Refused unsafe archive path: $($entry.FullName)"
            }
            $targetPath = [System.IO.Path]::GetFullPath((Join-Path $fullDest $entry.FullName))
            if (-not $targetPath.StartsWith($fullDest, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Archive entry escapes destination directory: $($entry.FullName)"
            }
            if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) {
                [System.IO.Directory]::CreateDirectory($targetPath) | Out-Null
            } else {
                $parentDir = [System.IO.Path]::GetDirectoryName($targetPath)
                if ($parentDir) {
                    [System.IO.Directory]::CreateDirectory($parentDir) | Out-Null
                }
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true)
            }
        }
    } finally {
        $archive.Dispose()
    }
}

function Resolve-ArchiveUrl([string]$RepoName, [string]$RequestedVersion, [string]$RequestedRef) {
    if ($RequestedVersion) {
        $tag = if ($RequestedVersion -match '^[vV]') { $RequestedVersion } else { "v$RequestedVersion" }
        Write-Info "Selected version tag: $tag"
        return "https://github.com/$RepoName/archive/refs/tags/$tag.zip"
    }

    if ($RequestedRef) {
        Write-Info "Selected git ref: $RequestedRef"
        return "https://github.com/$RepoName/archive/$RequestedRef.zip"
    }

    Write-Info "Checking latest GitHub release for $RepoName..."
    $headers = @{
        'User-Agent' = 'agy-hud-installer'
        'Accept'     = 'application/vnd.github+json'
    }
    try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$RepoName/releases/latest" -Headers $headers -TimeoutSec 15
        if ($rel -and $rel.assets) {
            foreach ($asset in $rel.assets) {
                if ($asset.name -match '\.zip$' -and $asset.browser_download_url -and (Test-AllowedGitHubUrl $asset.browser_download_url $RepoName)) {
                    return [string]$asset.browser_download_url
                }
            }
        }
        if ($rel -and $rel.zipball_url -and (Test-AllowedGitHubUrl $rel.zipball_url $RepoName)) {
            return [string]$rel.zipball_url
        }
        if ($rel -and $rel.tag_name) {
            $encTag = [System.Uri]::EscapeDataString([string]$rel.tag_name)
            return "https://github.com/$RepoName/archive/refs/tags/$encTag.zip"
        }
    } catch {
        Write-Info 'No published release found (or GitHub API unavailable); falling back to main branch archive.'
    }

    return "https://github.com/$RepoName/archive/refs/heads/main.zip"
}

function Invoke-AgyHudInstall {
    $arch = if ($env:PROCESSOR_ARCHITECTURE) { $env:PROCESSOR_ARCHITECTURE } else { 'unknown' }
    Write-Info "Detected platform: Windows ($arch)"

    # 1. Check Node.js >= 22.18
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Err 'Node.js is not installed or not on PATH.'
        Show-NodeInstallHelp
        exit 1
    }

    $nodeVerRaw = (& $nodeCmd.Source -v).Trim()
    $cleanVer = $nodeVerRaw -replace '^[vV]', ''
    $parts = $cleanVer.Split('.')
    $major = 0
    $minor = 0
    if ($parts.Length -ge 2) {
        [void][int]::TryParse($parts[0], [ref]$major)
        [void][int]::TryParse($parts[1], [ref]$minor)
    }

    if ($major -lt $MinNodeMajor -or ($major -eq $MinNodeMajor -and $minor -lt $MinNodeMinor)) {
        Write-Err "Found Node.js $nodeVerRaw, which is older than required >= v$MinNodeMajor.$MinNodeMinor."
        Show-NodeInstallHelp
        exit 1
    }
    Write-Info "Using Node.js $nodeVerRaw ($($nodeCmd.Source))"

    # 2. Resolve and verify archive URL
    $archiveUrl = Resolve-ArchiveUrl -RepoName $Repo -RequestedVersion $Version -RequestedRef $Ref
    if (-not (Test-AllowedGitHubUrl $archiveUrl $Repo)) {
        Write-Err "Refused to download from untrusted URL: $archiveUrl"
        exit 1
    }

    $tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agy-hud-install-" + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null

    try {
        $zipPath = Join-Path $tmpRoot 'agy-hud.zip'
        $extractDir = Join-Path $tmpRoot 'extract'

        Write-Info "Downloading $archiveUrl..."
        $dlHeaders = @{ 'User-Agent' = 'agy-hud-installer' }
        Invoke-WebRequest -Uri $archiveUrl -Headers $dlHeaders -OutFile $zipPath -UseBasicParsing

        Write-Info 'Extracting archive...'
        Expand-ZipSafely -ZipPath $zipPath -DestDir $extractDir

        $installerPath = $null
        $srcRoot = $null
        $directPlugin = Join-Path $extractDir 'plugin\install.mjs'
        $directRoot = Join-Path $extractDir 'install.mjs'

        if (Test-Path $directPlugin) {
            $installerPath = $directPlugin
            $srcRoot = $extractDir
        } elseif (Test-Path $directRoot) {
            $installerPath = $directRoot
            $srcRoot = $extractDir
        } else {
            foreach ($dir in (Get-ChildItem -Path $extractDir -Directory)) {
                $candPlugin = Join-Path $dir.FullName 'plugin\install.mjs'
                $candRoot = Join-Path $dir.FullName 'install.mjs'
                if (Test-Path $candPlugin) {
                    $installerPath = $candPlugin
                    $srcRoot = $dir.FullName
                    break
                } elseif (Test-Path $candRoot) {
                    $installerPath = $candRoot
                    $srcRoot = $dir.FullName
                    break
                }
            }
        }

        if (-not $installerPath) {
            Write-Err 'Could not locate plugin\install.mjs inside downloaded archive.'
            exit 1
        }

        $pluginDir = Split-Path -Parent $installerPath
        $uiIndex = Join-Path $pluginDir 'sidecars\hud_panel\ui\index.html'
        if (-not (Test-Path $uiIndex)) {
            $webDir = Join-Path $srcRoot 'web'
            $webPkg = Join-Path $webDir 'package.json'
            $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
            if (-not $npmCmd) { $npmCmd = Get-Command npm -ErrorAction SilentlyContinue }
            if ((Test-Path $webPkg) -and $npmCmd) {
                Write-Info 'Pre-built UI bundle not found in archive; building web UI...'
                & $npmCmd.Source --prefix $webDir install --no-audit --no-fund
                if ($LASTEXITCODE -ne 0) { throw 'npm install failed while building UI' }
                & $npmCmd.Source --prefix $webDir run build
                if ($LASTEXITCODE -ne 0) { throw 'npm run build failed while building UI' }
            } else {
                Write-Err 'Pre-built UI bundle is missing and cannot be built automatically.'
                exit 1
            }
        }

        Write-Info 'Running AGY-HUD plugin installer...'
        $installArgs = @($installerPath, '--install')
        $doctorArgs = @($installerPath, '--doctor')
        if ($Target) {
            $installArgs += @('--target', $Target)
            $doctorArgs += @('--target', $Target)
        }

        & $nodeCmd.Source @installArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Installer exited with code $LASTEXITCODE"
        }

        Write-Info 'Verifying installation...'
        & $nodeCmd.Source @doctorArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Doctor verification failed with code $LASTEXITCODE"
        }

        Write-Host ''
        Write-Info 'AGY-HUD installation complete!'
        Write-Host 'Next steps:'
        Write-Host '  1. Restart Antigravity (or reload plugins) if it is currently running.'
        Write-Host '  2. Open the AGY-HUD panel in the Antigravity side pane.'
        Write-Host '  3. Future updates can be applied directly inside AGY-HUD or via:'
        Write-Host "     irm https://raw.githubusercontent.com/$Repo/main/scripts/install.ps1 | iex"
    } finally {
        if (Test-Path $tmpRoot) {
            Remove-Item -Path $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Invoke-AgyHudInstall

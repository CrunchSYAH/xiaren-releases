param(
    [string]$PackagePath,
    [string]$ChecksumPath
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$installRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$extensionPath = Join-Path $installRoot 'extension'
$releaseInfo = Get-Content -LiteralPath (Join-Path $installRoot 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($releaseInfo.repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid release repository.' }
if (-not (Test-Path -LiteralPath (Join-Path $extensionPath 'manifest.json') -PathType Leaf)) { throw 'Run this updater from the original installation folder.' }
$current = Get-Content -LiteralPath (Join-Path $extensionPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$confirmation = Read-Host 'End all tasks in all Chrome profiles first. Type UPDATE to continue'
if ($confirmation -cne 'UPDATE') { Write-Output 'Cancelled.'; exit }
$workPath = Join-Path $installRoot ('.xiaren-update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workPath | Out-Null
try {
    if (-not $PackagePath) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $headers = @{ 'User-Agent' = 'Xiaren-Updater'; 'Accept' = 'application/vnd.github+json' }
        $latest = Invoke-RestMethod -Uri ("https://api.github.com/repos/" + $releaseInfo.repository + "/releases/latest") -Headers $headers -TimeoutSec 30
        if ($latest.draft -or $latest.prerelease -or $latest.tag_name -notmatch '^v(\d+\.\d+\.\d+)$') { throw 'Invalid release metadata.' }
        $releaseVersion = $Matches[1]
        if ([version]$releaseVersion -le [version]$current.version) { Write-Output ('Already up to date: ' + $current.version); return }
        $assetName = "xiaren-chrome-v$releaseVersion.zip"
        $asset = @($latest.assets | Where-Object name -eq $assetName)
        $checksum = @($latest.assets | Where-Object name -eq "$assetName.sha256")
        if ($asset.Count -ne 1 -or $checksum.Count -ne 1) { throw 'Release assets are incomplete.' }
        $baseUrl = "https://github.com/$($releaseInfo.repository)/releases/download/$($latest.tag_name)/"
        if ($asset[0].browser_download_url -cne ($baseUrl + $assetName) -or $checksum[0].browser_download_url -cne ($baseUrl + "$assetName.sha256")) { throw 'Unexpected asset URL.' }
        $PackagePath = Join-Path $workPath $assetName
        $ChecksumPath = Join-Path $workPath "$assetName.sha256"
        Invoke-WebRequest -UseBasicParsing -Uri $asset[0].browser_download_url -OutFile $PackagePath -TimeoutSec 120
        Invoke-WebRequest -UseBasicParsing -Uri $checksum[0].browser_download_url -OutFile $ChecksumPath -TimeoutSec 30
    }
    if (-not $ChecksumPath) { throw 'A SHA256 checksum file is required.' }
    $checksumLine = [IO.File]::ReadAllText($ChecksumPath).Trim()
    if ($checksumLine -notmatch '^([a-fA-F0-9]{64})\s+\*?[^\r\n]+$') { throw 'Invalid checksum file.' }
    $expectedHash = $Matches[1]
    $hashStream = [IO.File]::OpenRead($PackagePath)
    $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
    try { $actualHash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($hashStream)).Replace('-', '') }
    finally { $hashStream.Dispose(); $hashAlgorithm.Dispose() }
    if ($actualHash -ine $expectedHash) { throw 'Checksum mismatch. Installation was not changed.' }
    if ((Get-Item -LiteralPath $PackagePath).Length -gt 10MB) { throw 'Package is too large.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stagePath = Join-Path $workPath 'stage'
    New-Item -ItemType Directory -Path $stagePath | Out-Null
    $archive = [IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        $totalBytes = 0
        $seen = @{}
        foreach ($entry in $archive.Entries) {
            $entryName = $entry.FullName.Replace('\', '/')
            if ($entryName -notmatch '^(extension/[A-Za-z0-9_./-]+|update\.cmd|update\.ps1|release\.json|README\.txt)$' -or $entryName -match '(^|/)\.\.?(/|$)' -or $entryName.Contains('//')) { throw 'Unsafe package path.' }
            if ($seen.ContainsKey($entryName)) { throw 'Duplicate package path.' }
            $seen[$entryName] = $true
            $totalBytes += $entry.Length
            if ($totalBytes -gt 20MB -or $archive.Entries.Count -gt 200) { throw 'Package exceeds extraction limits.' }
            if ($entryName.EndsWith('/')) { continue }
            $destination = [IO.Path]::GetFullPath((Join-Path $stagePath $entryName))
            if (-not $destination.StartsWith($stagePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package escaped staging folder.' }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination)
        }
    } finally { $archive.Dispose() }
    $nextPath = Join-Path $stagePath 'extension'
    $next = Get-Content -LiteralPath (Join-Path $nextPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $nextRelease = Get-Content -LiteralPath (Join-Path $stagePath 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($nextRelease.repository -cne $releaseInfo.repository -or $nextRelease.version -cne $next.version -or $next.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Package identity mismatch.' }
    if ($releaseVersion -and $next.version -cne $releaseVersion) { throw 'Release version mismatch.' }
    if ([version]$next.version -le [version]$current.version) { throw 'Refusing to install the same or an older version.' }
    if ($next.manifest_version -ne 3 -or $next.name -cne $current.name -or (@($next.permissions) -join ',') -cne 'storage,scripting' -or (@($next.host_permissions) -join ',') -cne 'https://seller.shopee.co.id/*') { throw 'Unexpected extension identity or permissions.' }
    foreach ($forbidden in @('optional_permissions', 'optional_host_permissions', 'content_scripts', 'externally_connectable', 'update_url')) {
        if ($null -ne $next.PSObject.Properties[$forbidden]) { throw "Unexpected manifest field: $forbidden" }
    }
    if ($next.key -cne $current.key) { throw 'Extension key must not change.' }
    foreach ($required in @('background.mjs', 'dashboard.html', 'dashboard.mjs', 'update.html', 'release-config.mjs')) {
        if (-not (Test-Path -LiteralPath (Join-Path $nextPath $required) -PathType Leaf)) { throw "Missing file: $required" }
    }
    $rootFiles = @('update.cmd', 'update.ps1', 'release.json', 'README.txt')
    foreach ($rootFile in $rootFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $stagePath $rootFile) -PathType Leaf)) { throw "Missing file: $rootFile" }
    }
    foreach ($guardPath in @($installRoot, $extensionPath, (Join-Path $installRoot 'backups')) + @($rootFiles | ForEach-Object { Join-Path $installRoot $_ })) {
        if ((Test-Path -LiteralPath $guardPath) -and ((Get-Item -LiteralPath $guardPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked installation paths are not supported.' }
    }
    $backupRoot = Join-Path $installRoot 'backups'
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $backupPath = Join-Path $backupRoot ('v' + $current.version + '-' + [guid]::NewGuid().ToString('N'))
    $extensionBackupPath = Join-Path $backupPath 'extension'
    New-Item -ItemType Directory -Path $backupPath | Out-Null
    $backedUp = @()
    $installed = @()
    # Every moved item is a fixed child of this installation, never an archive-supplied path.
    try {
        foreach ($itemName in @('extension') + $rootFiles) {
            $oldPath = Join-Path $installRoot $itemName
            if (Test-Path -LiteralPath $oldPath) {
                $oldBackupPath = if ($itemName -eq 'extension') { $extensionBackupPath } else { Join-Path $backupPath $itemName }
                Move-Item -LiteralPath $oldPath -Destination $oldBackupPath
                $backedUp += $itemName
            }
            Move-Item -LiteralPath (Join-Path $stagePath $itemName) -Destination $oldPath
            $installed += $itemName
        }
    }
    catch {
        $installError = $_.Exception.Message
        $recoveryErrors = @()
        foreach ($itemName in $installed) {
            try {
                Move-Item -LiteralPath (Join-Path $installRoot $itemName) -Destination (Join-Path $workPath ('failed-' + $itemName))
            } catch { $recoveryErrors += "Could not preserve new ${itemName}: $($_.Exception.Message)" }
        }
        foreach ($itemName in $backedUp) {
            $oldBackupPath = if ($itemName -eq 'extension') { $extensionBackupPath } else { Join-Path $backupPath $itemName }
            try {
                $restorePath = Join-Path $installRoot $itemName
                if (Test-Path -LiteralPath $restorePath) { throw 'Destination is occupied; backup retained.' }
                Move-Item -LiteralPath $oldBackupPath -Destination $restorePath
            } catch { $recoveryErrors += "Could not restore ${itemName}: $($_.Exception.Message)" }
        }
        if ($recoveryErrors.Count) {
            throw ($installError + " Recovery incomplete. End all tasks before manually restoring from: $backupPath. Preserved new files: $workPath. " + ($recoveryErrors -join '; '))
        }
        throw $installError
    }
    Write-Output ("Updated to " + $next.version + ". Reload Xiaren in chrome://extensions in EVERY Chrome profile.")
    Write-Output ("Previous extension backup: " + $backupPath)
    Write-Output 'To roll back: close all tasks, preserve current files, restore extension and updater files from the backup, then reload.'
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    # Temporary staging and downloaded files are retained for diagnosis; no recursive deletion.
    Write-Output ("Temporary files: " + $workPath)
}

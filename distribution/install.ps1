param(
    [switch]$Yes,
    [switch]$Quiet,
    [switch]$List,
    [string]$Path
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$here = [IO.Path]::GetFullPath($PSScriptRoot)
$packageExtension = Join-Path $here 'extension'
$markerPath = Join-Path $env:LOCALAPPDATA 'Xiaren\install.json'
$rootFiles = @('install.cmd', 'install.ps1', 'update.cmd', 'update.ps1', 'release.json', 'README.txt')

function Read-Manifest([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
}

function Write-Line([string]$text) { if (-not $Quiet) { Write-Host $text } }

$packageManifest = Read-Manifest (Join-Path $packageExtension 'manifest.json')
if (-not $packageManifest) { throw '安装包不完整：找不到 extension\manifest.json，请重新解压完整压缩包。' }
$name = $packageManifest.name
$version = $packageManifest.version
Write-Line ''
Write-Line ('虾仁 一键安装 · 包内版本 v' + $version)
Write-Line '------------------------------------------------------------'

$targets = New-Object System.Collections.Generic.List[string]

# 以目录里的 manifest.json 为准核对身份：浏览器记录中的 manifest 字段可能为空。
function Add-Target([string]$candidate) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { return }
    try { $full = [IO.Path]::GetFullPath($candidate).TrimEnd('\') } catch { return }
    if (-not (Test-Path -LiteralPath (Join-Path $full 'manifest.json') -PathType Leaf)) { return }
    $manifest = Read-Manifest (Join-Path $full 'manifest.json')
    if (-not $manifest) { return }
    if ($manifest.name -ne $name) { return }
    if (-not $targets.Contains($full)) { $targets.Add($full) }
}

if (-not [string]::IsNullOrWhiteSpace($Path)) {
    Add-Target $Path
    if ($targets.Count -eq 0) { throw ('指定的目录不是虾仁：' + $Path + '（里面应包含 manifest.json）') }
}

# 1) 上次安装记录
if (Test-Path -LiteralPath $markerPath) {
    try {
        $saved = Get-Content -LiteralPath $markerPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($savedPath in @($saved.paths)) { Add-Target $savedPath }
    } catch { }
}

# 2) 浏览器配置：已解压扩展记为 location = 4；新版 Chrome 把它放在 Secure Preferences
$browserRoots = @(
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome Beta\User Data'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome SxS\User Data'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data')
)
foreach ($browserRoot in $browserRoots) {
    if (-not (Test-Path -LiteralPath $browserRoot)) { continue }
    foreach ($profileDir in (Get-ChildItem -LiteralPath $browserRoot -Directory -ErrorAction SilentlyContinue)) {
        foreach ($fileName in @('Secure Preferences', 'Preferences')) {
            $preferencesPath = Join-Path $profileDir.FullName $fileName
            if (-not (Test-Path -LiteralPath $preferencesPath -PathType Leaf)) { continue }
            try { $preferences = Get-Content -LiteralPath $preferencesPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
            if ($null -eq $preferences.extensions -or $null -eq $preferences.extensions.settings) { continue }
            foreach ($property in $preferences.extensions.settings.PSObject.Properties) {
                $entry = $property.Value
                if ($null -eq $entry) { continue }
                if ($null -eq $entry.location) { continue }
                if ([int]$entry.location -ne 4) { continue }
                Add-Target $entry.path
            }
        }
    }
}

function Select-Folder {
    try {
        Add-Type -AssemblyName System.Windows.Forms | Out-Null
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = '请选择当初加载虾仁时选的那个 extension 文件夹（里面有 manifest.json）'
        $dialog.ShowNewFolderButton = $false
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.SelectedPath }
    } catch { }
    return $null
}

if ($targets.Count -eq 0 -and -not $List -and -not $Yes) {
    Write-Line '没有从浏览器配置里自动找到虾仁，请手动选择它的 extension 文件夹。'
    $picked = Select-Folder
    if ($picked) { Add-Target $picked }
}

if ($List) {
    if ($targets.Count -eq 0) { Write-Line '未找到已安装的虾仁目录。'; exit 1 }
    foreach ($target in $targets) {
        $current = Read-Manifest (Join-Path $target 'manifest.json')
        Write-Line ('  ' + $target + '  当前 v' + $current.version)
    }
    exit 0
}

$markerDir = Split-Path -Parent $markerPath
if (-not (Test-Path -LiteralPath $markerDir)) { New-Item -ItemType Directory -Force -Path $markerDir | Out-Null }

function Save-Marker([string[]]$paths) {
    try {
        $payload = [ordered]@{ paths = @($paths); updatedAt = (Get-Date).ToString('s'); version = $version }
        # 无 BOM 的 UTF-8，便于其他工具直接读取
        $json = $payload | ConvertTo-Json -Depth 4
        [IO.File]::WriteAllText($markerPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    } catch { Write-Line ('提示：无法写入安装记录（' + $_.Exception.Message + '），下次仍会自动查找。') }
}

function Copy-RootFiles([string]$installRoot) {
    foreach ($file in $rootFiles) {
        $source = Join-Path $here $file
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
        Copy-Item -LiteralPath $source -Destination $installRoot -Force -ErrorAction SilentlyContinue
    }
}

if ($targets.Count -eq 0) {
    # 首次安装：放到固定目录，保证以后每次更新都是同一路径（扩展 ID 不变）
    $installRoot = Join-Path $env:LOCALAPPDATA 'Xiaren'
    $target = Join-Path $installRoot 'extension'
    Write-Line '没有找到已安装的虾仁，按首次安装处理。'
    Write-Line ('安装目录：' + $installRoot)
    if (-not $Yes) {
        $answer = Read-Host '确认把虾仁安装到这个目录？输入 Y 继续'
        if ($answer -notin @('Y', 'y', 'YES', 'yes')) { Write-Line '已取消，未做任何修改。'; exit 1 }
    }
    New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
    if (Test-Path -LiteralPath $target) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backupRoot = Join-Path $installRoot 'backups'
        New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
        Move-Item -LiteralPath $target -Destination (Join-Path $backupRoot ('extension-' + $stamp))
    }
    Copy-Item -LiteralPath $packageExtension -Destination $target -Recurse -Force
    Copy-RootFiles $installRoot
    $installed = Read-Manifest (Join-Path $target 'manifest.json')
    if (-not $installed -or $installed.version -ne $version) { throw '安装后版本校验失败，请重新解压并再试一次。' }
    Save-Marker @($target)
    Write-Line ''
    Write-Line ('安装完成：' + $target + '（v' + $version + '）')
    Write-Line ''
    Write-Line '接下来请手动完成最后一步（只需一次）：'
    Write-Line '  1. 浏览器地址栏打开 chrome://extensions'
    Write-Line '  2. 打开右上角"开发者模式"'
    Write-Line '  3. 点"加载已解压的扩展程序"，选择下面这个文件夹：'
    Write-Line ('     ' + $target)
    Write-Line '  4. 以后收到新版本，直接双击安装包里的 install.cmd 即可自动更新，不用再选文件夹。'
    exit 0
}

Write-Line '开始前请确认：已在所有店铺结束正在运行的任务，并关闭虾仁工作台页面。'
Write-Line ''
$pending = New-Object System.Collections.Generic.List[string]
Write-Line ('找到 ' + $targets.Count + ' 个虾仁目录：')
foreach ($target in $targets) {
    $current = Read-Manifest (Join-Path $target 'manifest.json')
    $currentVersion = '0.0.0'
    if ($current -and $current.version) { $currentVersion = $current.version }
    if ($currentVersion -eq $version) {
        Write-Line ('  · ' + $target + '  已是 v' + $currentVersion + '，无需更新')
    } else {
        Write-Line ('  · ' + $target + '  v' + $currentVersion + ' → v' + $version)
        $pending.Add($target)
    }
}
Write-Line ''

if ($pending.Count -eq 0) {
    Write-Line '所有找到的虾仁目录都已经是最新版本，没有需要替换的文件。'
    Write-Line '如果你刚更新过却没生效：请在 chrome://extensions 点一次"重新加载"（只刷新页面不会换代码）。'
    exit 0
}

Write-Line '更新只替换 extension 文件夹并保留旧版备份；发送记录、任务历史、模板、图片都在浏览器里，不会丢。'
Write-Line '请勿卸载扩展、请勿更换文件夹，否则扩展 ID 变化会导致读不到原有记录。'
Write-Line ''

if (-not $Yes) {
    $answer = Read-Host '确认更新以上目录？输入 Y 继续'
    if ($answer -notin @('Y', 'y', 'YES', 'yes')) { Write-Line '已取消，未做任何修改。'; exit 1 }
}

$updated = 0
foreach ($target in $pending) {
    $installRoot = Split-Path -Parent $target
    $current = Read-Manifest (Join-Path $target 'manifest.json')
    $currentVersion = '0.0.0'
    if ($current -and $current.version) { $currentVersion = $current.version }
    $backupRoot = Join-Path $installRoot 'backups'
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupPath = Join-Path $backupRoot ('extension-v' + $currentVersion + '-' + $stamp)
    Write-Line ('正在更新：' + $target)
    Move-Item -LiteralPath $target -Destination $backupPath
    try {
        Copy-Item -LiteralPath $packageExtension -Destination $target -Recurse -Force
        $installed = Read-Manifest (Join-Path $target 'manifest.json')
        if (-not $installed -or $installed.version -ne $version) { throw '版本校验失败' }
        foreach ($required in @('background.mjs', 'dashboard.html', 'update.html', 'updater.mjs')) {
            if (-not (Test-Path -LiteralPath (Join-Path $target $required) -PathType Leaf)) { throw ('缺少文件 ' + $required) }
        }
    } catch {
        $failure = $_.Exception.Message
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $backupPath) { Move-Item -LiteralPath $backupPath -Destination $target }
        throw ('更新失败并已回滚：' + $failure + '（原文件在 ' + $backupPath + '）')
    }
    Copy-RootFiles $installRoot
    Write-Line ('  完成 v' + $version + '，旧版备份：' + $backupPath)
    $updated++
}

Save-Marker @($targets)
Write-Line ''
Write-Line ('已更新 ' + $updated + ' 个目录。')
Write-Line '最后一步：打开 chrome://extensions，找到"虾仁"点"重新加载"。'
Write-Line '如果提示"已停用，因为权限发生变化"，点"启用"——本版只多了几个 GitHub 域名，仅用于检查更新。'
Write-Line '多个 Chrome 用户（profile）各自加载同一目录时，每个都要重新加载一次。'
exit 0

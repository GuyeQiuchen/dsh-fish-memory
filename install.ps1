# Install dsh-jiyiti-memory into a DSH profile on Windows.
#
# Why a copy instead of a junction or a link: the host only resolves
# @deepseek-ai/* for packages that physically live in the profile. A junction
# or a symlink loads but the plugin may silently never activate, and pnpm
# rewrites "link:" dependencies into symlinks whenever it installs anything.
#
# Usage: .\install.ps1            # desktop profile
#        .\install.ps1 -Profile x # another profile name
# Keep this file ASCII-only: PowerShell 5.1 reads BOM-less files as ANSI.

param(
  [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$userHome = $env:USERPROFILE
if (-not $userHome) { $userHome = $env:HOME }
if (-not $userHome) { throw 'cannot resolve the user home directory' }

$profileDir = Join-Path $userHome ('.dsh\profiles\' + $Profile)
$pkgPath = Join-Path $profileDir 'package.json'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
$modDir = Join-Path $profileDir 'node_modules'
$storeDir = Join-Path $profileDir 'local-packages'
$storeCopy = Join-Path $storeDir 'dsh-jiyiti-memory'
$target = Join-Path $modDir 'dsh-jiyiti-memory'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path $pkgPath)) { throw "profile not found: $pkgPath" }

Copy-Item $pkgPath "$pkgPath.bak-$stamp" -Force
if (Test-Path $patchPath) {
  Copy-Item $patchPath "$patchPath.bak-$stamp" -Force
  Write-Host "backup: package.json.bak-$stamp, cordis.patch.yml.bak-$stamp"
} else {
  Write-Host "backup: package.json.bak-$stamp (no cordis.patch.yml yet)"
}

# Keep an own copy inside the profile. The dependency below points at this copy,
# so deleting or moving the folder you downloaded from breaks nothing.
if (-not (Test-Path $storeDir)) { New-Item -ItemType Directory -Path $storeDir -Force | Out-Null }
if (-not (Test-Path $storeCopy)) { New-Item -ItemType Directory -Path $storeCopy -Force | Out-Null }
robocopy $here $storeCopy /MIR /NFL /NDL /NJH /NJS /NP /XD node_modules .git test | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy to local-packages failed with $LASTEXITCODE" }
Write-Host "stored: $storeCopy"

if (-not (Test-Path $modDir)) { New-Item -ItemType Directory -Path $modDir -Force | Out-Null }
$existing = Get-Item $target -ErrorAction SilentlyContinue
if ($existing -and $existing.LinkType -eq 'SymbolicLink') { $existing.Delete() }
if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null }
$rcArgs = @(
  $here, $target,
  '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
  '/XF', '*.bak*', 'loaded.txt', 'load-error.txt',
  '/XD', 'node_modules', '.git', 'test'
)
robocopy @rcArgs | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with $LASTEXITCODE" }
Write-Host "copied: $here -> $target"

$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $pkg.dependencies) { $pkg | Add-Member -NotePropertyName 'dependencies' -NotePropertyValue ([pscustomobject]@{}) }
$deps = $pkg.dependencies
if (-not ($deps.PSObject.Properties.Name -contains 'dsh-jiyiti-memory')) {
  $deps | Add-Member -NotePropertyName 'dsh-jiyiti-memory' -NotePropertyValue "link:$($storeCopy -replace '\\','/')"
  Write-Host "dep: dsh-jiyiti-memory added"
}
if (-not $pkg.dsh) { $pkg | Add-Member -NotePropertyName 'dsh' -NotePropertyValue ([pscustomobject]@{}) }
if (-not $pkg.dsh.profile) { $pkg.dsh | Add-Member -NotePropertyName 'profile' -NotePropertyValue ([pscustomobject]@{}) }
$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-jiyiti-memory') {
  $bundles += 'dsh-jiyiti-memory'
  $pkg.dsh.profile.bundles = $bundles
  Write-Host "bundle: dsh-jiyiti-memory added"
}
$pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding UTF8

# cordis.patch.yml: 不再插条目——包自带的 cordis.patch.yml（bundle）已经插入
# fish-memory 行；再插一份会和它重复，DSH 对重复 id 会报冲突。
# 全新 profile 可能还没有这个文件，没有就跳过。
if (Test-Path $patchPath) {
  $patch = [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8)
  if ($patch.Length -lt 100) { throw "cordis.patch.yml looks empty ($($patch.Length) chars); aborting" }
  Write-Host "patch: unchanged (fish-memory row comes from the bundle)"
} else {
  Write-Host "patch: no cordis.patch.yml yet; skipped (bundle provides the row)"
}

Write-Host ""
Write-Host "done. Restart DSH to apply."
Write-Host "The memory root defaults to $DSH_HOME/memory (normally ~/.dsh/memory); an empty one builds its own skeleton on first boot."
Write-Host "If you install other plugins later, re-run this script so the package stays a real directory."

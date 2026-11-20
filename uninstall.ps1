# Uninstall dsh-fish-memory from a DSH profile on Windows.
#
# Reverses install.ps1: removes the copied package, the dependency, the bundle
# entry and the fish-memory patch block. Does not touch your memory files under
# ~/.memory.
#
# Usage: .\uninstall.ps1            # desktop profile
#        .\uninstall.ps1 -Profile x # another profile name
# Keep this file ASCII-only: PowerShell 5.1 reads BOM-less files as ANSI.

param(
  [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'

$userHome = $env:USERPROFILE
if (-not $userHome) { $userHome = $env:HOME }
if (-not $userHome) { throw 'cannot resolve the user home directory' }

$profileDir = Join-Path $userHome ('.dsh\profiles\' + $Profile)
$pkgPath = Join-Path $profileDir 'package.json'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
$target = Join-Path $profileDir 'node_modules\dsh-fish-memory'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path $pkgPath)) { throw "profile not found: $pkgPath" }

Copy-Item $pkgPath "$pkgPath.bak-$stamp" -Force
Copy-Item $patchPath "$patchPath.bak-$stamp" -Force
Write-Host "backup: package.json.bak-$stamp, cordis.patch.yml.bak-$stamp"

if (Test-Path $target) {
  Remove-Item $target -Recurse -Force
  Write-Host "removed: $target"
}

$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($pkg.dependencies) {
  $pkg.dependencies.PSObject.Properties.Remove('dsh-fish-memory')
}
if ($pkg.dsh -and $pkg.dsh.profile -and $pkg.dsh.profile.bundles) {
  $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-fish-memory' })
}
$pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding UTF8
Write-Host "package.json cleaned"

$patch = [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8)
$patch = $patch -replace "(?ms)\r?\n- insert:\r?\n    - id: fish-memory\r?\n(?:      .*\r?\n)*", "`n"
[System.IO.File]::WriteAllText($patchPath, $patch, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "patch: fish-memory entry removed"

Write-Host ""
Write-Host "done. Restart DSH to apply."
Write-Host "Your memory files under ~/.memory are untouched."

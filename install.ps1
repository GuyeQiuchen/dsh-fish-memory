# Install dsh-fish-memory into a DSH profile on Windows.
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
$target = Join-Path $modDir 'dsh-fish-memory'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path $pkgPath)) { throw "profile not found: $pkgPath" }

Copy-Item $pkgPath "$pkgPath.bak-$stamp" -Force
Copy-Item $patchPath "$patchPath.bak-$stamp" -Force
Write-Host "backup: package.json.bak-$stamp, cordis.patch.yml.bak-$stamp"

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
if (-not ($deps.PSObject.Properties.Name -contains 'dsh-fish-memory')) {
  $deps | Add-Member -NotePropertyName 'dsh-fish-memory' -NotePropertyValue "link:$($here -replace '\\','/')"
  Write-Host "dep: dsh-fish-memory added"
}
if (-not $pkg.dsh) { $pkg | Add-Member -NotePropertyName 'dsh' -NotePropertyValue ([pscustomobject]@{}) }
if (-not $pkg.dsh.profile) { $pkg.dsh | Add-Member -NotePropertyName 'profile' -NotePropertyValue ([pscustomobject]@{}) }
$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-fish-memory') {
  $bundles += 'dsh-fish-memory'
  $pkg.dsh.profile.bundles = $bundles
  Write-Host "bundle: dsh-fish-memory added"
}
$pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding UTF8

$patch = [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8)
if ($patch.Length -lt 100) { throw "cordis.patch.yml looks empty ($($patch.Length) chars); aborting" }
if ($patch -notmatch '(?m)^- id: fish-memory') {
  $patch = $patch.TrimEnd() + @"

- insert:
    - id: fish-memory
      name: 'dsh-fish-memory'
      config:
        memoryRoot: ''
        bootMaxChars: 1400
        recallMaxChars: 1600
        maxRecallResults: 6
        rulesPage: 'identity/house-rules.md'
        maxRulesChars: 500
        maxRuleChars: 22
        alarm: true
"@
}
[System.IO.File]::WriteAllText($patchPath, $patch, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "patch: fish-memory entry added"

Write-Host ""
Write-Host "done. Restart DSH to apply."
Write-Host "The memory root defaults to ~/.memory; an empty one builds its own skeleton on first boot."
Write-Host "If you install other plugins later, re-run this script so the package stays a real directory."

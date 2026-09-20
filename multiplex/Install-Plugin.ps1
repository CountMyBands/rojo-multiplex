param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$buildDir = Join-Path $repoRoot 'build'
$pluginOutput = Join-Path $buildDir 'RojoMultiplex.rbxm'
$studioPlugins = Join-Path $env:LOCALAPPDATA 'Roblox\Plugins'

New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
New-Item -ItemType Directory -Force -Path $studioPlugins | Out-Null

if (-not $SkipBuild) {
    $bundledRojo = Join-Path $PSScriptRoot 'bin\rojo.exe'
    $rojoCommand = if (Test-Path -LiteralPath $bundledRojo) { $bundledRojo } else { 'rojo' }
    & $rojoCommand build (Join-Path $repoRoot 'plugin.project.json') --output $pluginOutput
    if ($LASTEXITCODE -ne 0) { throw 'Rojo plugin build failed.' }
}

if (-not (Test-Path -LiteralPath $pluginOutput)) {
    throw "Plugin build does not exist: $pluginOutput"
}

Copy-Item -LiteralPath $pluginOutput -Destination (Join-Path $studioPlugins 'RojoMultiplex.rbxm') -Force
Write-Host "Installed Rojo Multiplex plugin to $studioPlugins"
Write-Host 'Restart Roblox Studio if it is currently open.'

param(
    [string]$RojoRepository = $env:ROJO_MULTIPLEX_ROJO_REPOSITORY
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$destinationFolder = Join-Path (Split-Path $PSScriptRoot -Parent) 'bin'
$destination = Join-Path $destinationFolder 'rojo.exe'

# The bundled plugin speaks the protocol of the Rojo release it is based on, so
# the bundled server must be on the same major.minor line no matter which
# checkout it is built from. Reading it from the plugin keeps this check correct
# after the repository is updated to a newer Rojo release.
$pluginVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'plugin\Version.txt') -TotalCount 1).Trim()
if ($pluginVersion -notmatch '^(\d+)\.(\d+)\.') {
    throw "Could not read the plugin's Rojo version from plugin\Version.txt: '$pluginVersion'"
}
$expectedLine = "$($Matches[1]).$($Matches[2])"
$expectedVersion = "^Rojo $([regex]::Escape($expectedLine))\.\d+"

# Build from this repository by default rather than copying a stock release:
# its server carries fixes that stock Rojo lacks (such as Windows symlink
# watching), and the installer must always ship them.
if ($RojoRepository) {
    $RojoRepository = [System.IO.Path]::GetFullPath($RojoRepository)
    $sourceLabel = "custom Rojo checkout at $RojoRepository"
} else {
    $RojoRepository = $repoRoot
    $sourceLabel = 'Rojo Multiplex server built from this repository'
}

if (-not (Test-Path -LiteralPath (Join-Path $RojoRepository 'Cargo.toml') -PathType Leaf)) {
    throw "Rojo repository does not contain Cargo.toml: $RojoRepository"
}

Push-Location $RojoRepository
try {
    & cargo build --release --locked
    if ($LASTEXITCODE -ne 0) { throw "The Rojo release build failed in $RojoRepository." }
} finally {
    Pop-Location
}

$targetDirectory = if ($env:CARGO_TARGET_DIR) {
    [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR)
} else {
    Join-Path $RojoRepository 'target'
}
$source = Join-Path $targetDirectory 'release\rojo.exe'

if (-not (Test-Path -LiteralPath $source)) {
    throw "The Rojo binary was not found at $source"
}

$version = (& $source --version | Out-String).Trim()
if ($version -notmatch $expectedVersion) {
    throw "Expected a Rojo $expectedLine binary for the bundled $pluginVersion plugin, but $source reports '$version'."
}

New-Item -ItemType Directory -Force -Path $destinationFolder | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force
Write-Host "Prepared $sourceLabel ($version) at $destination"

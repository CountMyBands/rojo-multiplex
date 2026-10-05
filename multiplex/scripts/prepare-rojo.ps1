param(
    [string]$RojoRepository = $env:ROJO_MULTIPLEX_ROJO_REPOSITORY
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$destinationFolder = Join-Path (Split-Path $PSScriptRoot -Parent) 'bin'
$destination = Join-Path $destinationFolder 'rojo.exe'

# The bundled plugin speaks Rojo 7.7's protocol, so the bundled server must stay
# on the 7.7 line no matter which checkout it is built from.
$expectedVersion = '^Rojo 7\.7\.\d+'

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
    throw "Expected a Rojo 7.7 binary for the bundled 7.7.1 plugin, but $source reports '$version'."
}

New-Item -ItemType Directory -Force -Path $destinationFolder | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force
Write-Host "Prepared $sourceLabel ($version) at $destination"

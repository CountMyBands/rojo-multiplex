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

# rustc embeds the absolute paths of dependency sources (under the Cargo home)
# in panic messages, which would publish the builder's Windows username inside
# the installer. Remap them to neutral prefixes. Passing them through --config
# rather than RUSTFLAGS keeps the repository's own rustflags, because Cargo
# joins rustflags from every matching target table but RUSTFLAGS replaces them.
# When several prefixes match, rustc applies the last one, so the Cargo home
# (usually inside the profile) goes last.
$userProfile = [System.IO.Path]::GetFullPath($env:USERPROFILE)
$cargoHome = if ($env:CARGO_HOME) { [System.IO.Path]::GetFullPath($env:CARGO_HOME) } else { Join-Path $userProfile '.cargo' }
# The flags go in a temporary config file because a path can contain quotes,
# which don't survive being passed to cargo on the command line. JSON string
# escaping is also valid TOML basic-string escaping.
$remapFlags = @("--remap-path-prefix=$userProfile=~", "--remap-path-prefix=$cargoHome=cargo-home") |
    ForEach-Object { ConvertTo-Json -InputObject $_ -Compress }
$remapConfig = Join-Path ([System.IO.Path]::GetTempPath()) "rojo-multiplex-remap-$PID.toml"
[System.IO.File]::WriteAllText($remapConfig, "[target.'cfg(all())']`nrustflags = [$($remapFlags -join ', ')]`n", (New-Object System.Text.UTF8Encoding $false))

Push-Location $RojoRepository
try {
    & cargo build --release --locked --config $remapConfig
    if ($LASTEXITCODE -ne 0) { throw "The Rojo release build failed in $RojoRepository." }
} finally {
    Pop-Location
    Remove-Item -LiteralPath $remapConfig -ErrorAction SilentlyContinue
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

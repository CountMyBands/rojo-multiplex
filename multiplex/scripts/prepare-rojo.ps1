param(
    [string]$RojoRepository = $env:ROJO_MULTIPLEX_ROJO_REPOSITORY
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$destinationFolder = Join-Path (Split-Path $PSScriptRoot -Parent) 'bin'
$destination = Join-Path $destinationFolder 'rojo.exe'

if ($RojoRepository) {
    $RojoRepository = [System.IO.Path]::GetFullPath($RojoRepository)
    if (-not (Test-Path -LiteralPath (Join-Path $RojoRepository 'Cargo.toml') -PathType Leaf)) {
        throw "Rojo repository does not contain Cargo.toml: $RojoRepository"
    }

    Push-Location $RojoRepository
    try {
        & cargo build --release --locked
        if ($LASTEXITCODE -ne 0) { throw 'The custom Rojo release build failed.' }
    } finally {
        Pop-Location
    }

    $source = Join-Path $RojoRepository 'target\release\rojo.exe'
    $sourceLabel = "custom Rojo fork at $RojoRepository"
} else {
    Push-Location $repoRoot
    try {
        & rokit install
        if ($LASTEXITCODE -ne 0) { throw 'Rokit could not install Rojo 7.7.1.' }
    } finally {
        Pop-Location
    }

    $source = Join-Path $env:USERPROFILE '.rokit\tool-storage\rojo-rbx\rojo\7.7.1\rojo.exe'
    $sourceLabel = 'Rojo 7.7.1 from Rokit'
}

if (-not (Test-Path -LiteralPath $source)) {
    throw "The Rojo binary was not found at $source"
}

New-Item -ItemType Directory -Force -Path $destinationFolder | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force
Write-Host "Prepared $sourceLabel at $destination"

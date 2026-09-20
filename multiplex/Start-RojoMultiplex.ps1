param(
    [string]$Config = (Join-Path $PSScriptRoot 'rojo-multiplex.json')
)

$ErrorActionPreference = 'Stop'
node (Join-Path $PSScriptRoot 'manager.mjs') --config $Config

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This package requires Windows x64.' }
$nodeDir = Join-Path $PSScriptRoot '.runtime/node-v22.23.2-win-x64'
if (!(Test-Path "$nodeDir/node.exe")) {
  New-Item -ItemType Directory -Force '.runtime' | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/v22.23.2/node-v22.23.2-win-x64.zip' -OutFile '.runtime/node.zip'
  if ((Get-FileHash '.runtime/node.zip' -Algorithm SHA256).Hash.ToLower() -ne '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97') { throw 'Node download checksum failed.' }
  Expand-Archive -Path '.runtime/node.zip' -DestinationPath '.runtime' -Force
}
$env:PATH = "$nodeDir;$env:PATH"
& "$nodeDir/node.exe" bootstrap.mjs
if ($LASTEXITCODE -ne 0) { throw 'Setup or Pi failed. Please show this window to your teacher.' }

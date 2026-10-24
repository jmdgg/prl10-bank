# Builds the Nim server and the TypeScript UI (PowerShell). Run from project root.
$ErrorActionPreference = "Stop"

$nimItem = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter nim.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$gccItem = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter gcc.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $nimItem -or -not $gccItem) {
    Write-Error "Could not find nim.exe or gcc.exe in WinGet Packages. Please install them as per README.md."
    exit 1
}

$nimBin = $nimItem.DirectoryName
$gccBin = $gccItem.DirectoryName
$env:PATH = "$nimBin;$gccBin;$env:PATH"

& "$nimBin\nim.exe" c -d:release -o:server/bank.exe server/bank.nim
npx esbuild web/src/main.ts --bundle --minify --outfile=web/public/app.js
Write-Host "Build OK. Start with: .\server\bank.exe"

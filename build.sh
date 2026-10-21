#!/usr/bin/env bash
# Builds the Nim server and the TypeScript UI. Run from the project root (Git Bash).
set -euo pipefail
cd "$(dirname "$0")"

# winget installs Nim and MinGW per-user; add them to PATH if present.
NIM_BIN=$(find "$LOCALAPPDATA/Microsoft/WinGet/Packages" -path '*nim-*/bin' -type d 2>/dev/null | head -1 || true)
GCC_BIN=$(dirname "$(find "$LOCALAPPDATA/Microsoft/WinGet/Packages" -name gcc.exe 2>/dev/null | head -1)" 2>/dev/null || true)
export PATH="$NIM_BIN:$GCC_BIN:$PATH"

nim c -d:release -o:server/bank.exe server/bank.nim
npx esbuild web/src/main.ts --bundle --minify --outfile=web/public/app.js
echo "Build OK. Start with: ./server/bank.exe  (run from the project root)"

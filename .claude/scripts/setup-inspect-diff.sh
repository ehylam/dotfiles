#!/usr/bin/env bash
set -euo pipefail

deps="${XDG_DATA_HOME:-$HOME/.local/share}/inspect"
mkdir -p "$deps"
npm install --prefix "$deps" --no-save --package-lock=false \
  --ignore-scripts --no-audit --no-fund pixelmatch@7.2.0 pngjs@7.0.0
printf 'Shared inspect diff dependencies installed in %s\n' "$deps"

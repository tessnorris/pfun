#!/usr/bin/env bash
# pfun — run a Pfun script using the compiled interpreter
#
# Usage:
#   pfun script.pf          run a script
#   pfun                    start the REPL
#
# Install:
#   1. Copy this file somewhere on your PATH, e.g. ~/bin/pfun
#   2. chmod +x ~/bin/pfun
#   3. Run `npm run build` in the project directory whenever you change
#      the interpreter source.
#
# The script locates the project via the PFUN_HOME environment variable.
# If that isn't set it falls back to the directory containing this script,
# so you can also just keep it in the project root.

set -euo pipefail

if [[ -n "${PFUN_HOME:-}" ]]; then
  PROJECT="$PFUN_HOME"
else
  # Resolve symlinks so the script works from anywhere on PATH
  SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
  PROJECT="$SCRIPT_DIR"
fi

DIST="$PROJECT/dist/main.js"

if [[ ! -f "$DIST" ]]; then
  echo "pfun: compiled interpreter not found at $DIST" >&2
  echo "      Run 'npm run build' in $PROJECT first." >&2
  exit 1
fi

exec node "$DIST" "$@"

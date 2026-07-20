#!/usr/bin/env bash
# Verifies that the representative golden output is valid JavaScript.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
node --check test/golden/js_representative.js

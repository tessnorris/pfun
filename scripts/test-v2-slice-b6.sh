#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -gt 0 ]]; then
	BASE_COMPILER="$1"
elif [[ -f output/slice-b5/stage1/pfc.js ]]; then
	BASE_COMPILER="output/slice-b5/stage1/pfc.js"
elif [[ -f output/slice-b4/stage1/pfc.js ]]; then
	BASE_COMPILER="output/slice-b4/stage1/pfc.js"
elif [[ -f output/slice-b3/stage4/pfc.js ]]; then
	BASE_COMPILER="output/slice-b3/stage4/pfc.js"
else
	BASE_COMPILER="bootstrap-stage2/pfc.js"
fi

WORK="output/slice-b6"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: seed compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

rm -rf "$WORK"
mkdir -p "$WORK/stage1" "$WORK/stage2"

echo "== TypeScript bootstrap compiler build =="
npm run build

echo
echo "== V1 compiler namespaced-testing smoke =="
rm -rf "$WORK/v1-smoke"
mkdir -p "$WORK/v1-smoke"

PFUN_HOME="$ROOT" node dist/main.js \
	-c bootstrap/spec/slice-b6/v1_testing_import.pf \
	-o "$WORK/v1-smoke"

echo "V1 compiler testing namespace passed"

echo
echo "== Bootstrap Pfun test corpus after testing-module move =="
bash bootstrap/test/run-tests.sh --summary

echo
echo "== Build V2 compiler containing B6 resolver changes =="
PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build bootstrap/src/drivers/cli.pf \
	-o "$STAGE1"

echo
echo "== V2 compiler fixed point =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build bootstrap/src/drivers/cli.pf \
	-o "$STAGE2"

cmp "$STAGE1" "$STAGE2"
echo "compiler fixed point passed"

echo
echo "== V2 stdlib/testing import smoke =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build bootstrap/spec/slice-b6/main.pf \
	-o "$WORK/slice-b6.js"

if ! node "$WORK/slice-b6.js" > "$WORK/slice-b6.actual.txt"
then
	echo
	echo "== B6 bundle diagnostics ==" >&2
	python3 - "$WORK/slice-b6.js" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8", errors="replace")

mods = sorted(set(re.findall(
    r'\$mods\[(?:"|\')([^"\']+)(?:"|\')\]\s*=',
    text,
)))
maps = sorted(set(re.findall(
    r'\$maps\[(?:"|\')([^"\']+)(?:"|\')\]\s*=',
    text,
)))

print("registered module IDs containing testing/assertions:", file=sys.stderr)
found = [m for m in mods if "testing/assertions" in m]
if found:
    for item in found:
        print(f"  {item}", file=sys.stderr)
else:
    print("  <none>", file=sys.stderr)

print("registered map IDs containing slice-b6/main:", file=sys.stderr)
found_maps = [m for m in maps if "slice-b6/main" in m]
if found_maps:
    for item in found_maps:
        print(f"  {item}", file=sys.stderr)
else:
    print("  <none>", file=sys.stderr)

needle = "testing/assertions"
positions = [m.start() for m in re.finditer(re.escape(needle), text)]
print(f"occurrences of {needle!r}: {len(positions)}", file=sys.stderr)
for pos in positions[:8]:
    start = max(0, pos - 180)
    end = min(len(text), pos + 240)
    snippet = text[start:end].replace("\n", "\\n")
    print(f"  ...{snippet}...", file=sys.stderr)
PY
	exit 1
fi


diff -u \
	bootstrap/spec/slice-b6/expected.txt \
	"$WORK/slice-b6.actual.txt"

echo "V2 public-library imports passed"

echo
echo "== Layout and dependency gates =="

for file in \
	bootstrap/src/stdlib/list.pf \
	bootstrap/src/stdlib/string.pf \
	bootstrap/src/stdlib/toml.pf \
	bootstrap/src/testing/assertions.pf \
	bootstrap/src/testing/testing.pf \
	bootstrap/src/testing/runner.pf \
	lib/toml.pf
do
	if [[ ! -f "$file" ]]; then
		echo "error: required migrated file is missing: $file" >&2
		exit 1
	fi
done

for removed in \
	lib/list.pf \
	lib/string.pf \
	lib/testing/assertions.pf \
	lib/testing/testing.pf \
	lib/testing/runner.pf
do
	if [[ -e "$removed" ]]; then
		echo "error: V2 file still exists in legacy lib/: $removed" >&2
		exit 1
	fi
done

if ! grep -F 'import * from "foreign"' lib/toml.pf > /dev/null; then
	echo "error: lib/toml.pf is not the restored V1 implementation" >&2
	exit 1
fi

if ! grep -F 'import * as Str from "string"' \
	bootstrap/src/stdlib/toml.pf > /dev/null
then
	echo "error: bootstrap/src/stdlib/toml.pf is not the V2 implementation" >&2
	exit 1
fi

LEGACY_TESTING_LOG="$WORK/legacy-testing-imports.log"
: > "$LEGACY_TESTING_LOG"

# Search actual executable/import references. Exclude this gate so its own
# forbidden-pattern text cannot become a false positive.
grep -R -n \
\t--include='*.pf' \
\t--include='*.js' \
\t--include='*.ts' \
\t--include='*.sh' \
\t--exclude='test-v2-slice-b6.sh' \
\t-E 'from "[^"]*(\$PFUN_HOME/)?lib/testing/(assertions|testing|runner)(\.pf)?"|runner-import[^[:cntrl:]]*lib/testing/(assertions|testing|runner)' \
\tbootstrap scripts utils \
\t>> "$LEGACY_TESTING_LOG" || true

if [[ -s "$LEGACY_TESTING_LOG" ]]; then
\techo "error: executable V2/bootstrap references to legacy lib/testing remain" >&2
\tcat "$LEGACY_TESTING_LOG" >&2
\texit 1
fi


if grep -R -n \
	--include='*.pf' \
	-E 'from "\$PFUN_HOME/lib/(list|string|toml)' \
	bootstrap
then
	echo "error: V2 source still imports public modules from legacy lib/" >&2
	exit 1
fi

echo "layout gates passed"

if [[ -x scripts/test-v2-slice-b5.sh ]]; then
	echo
	echo "== B5 through Slice A regression gates =="
	bash scripts/test-v2-slice-b5.sh "$STAGE1"
fi

echo
echo "ALL SLICE B6 LIBRARY-LAYOUT TESTS PASSED"

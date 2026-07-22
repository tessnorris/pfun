#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"
WORK="output/slice-b6"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: seed compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

rm -rf "$WORK"
mkdir -p "$WORK/stage1" "$WORK/stage2"

echo "== Build V2 compiler containing B6 resolver changes =="
PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build src/drivers/cli.pf \
	-o "$STAGE1"

echo
echo "== V2 compiler fixed point =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build src/drivers/cli.pf \
	-o "$STAGE2"

cmp "$STAGE1" "$STAGE2"
echo "compiler fixed point passed"

echo
echo "== V2 stdlib/testing import smoke =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-b6/main.pf \
	-o "$WORK/slice-b6.js"

node "$WORK/slice-b6.js" > "$WORK/slice-b6.actual.txt"

diff -u \
	spec/slice-b6/expected.txt \
	"$WORK/slice-b6.actual.txt"

echo "V2 public-library imports passed"

echo
echo "== Layout and dependency gates =="

for file in \
	src/stdlib/list.pf \
	src/stdlib/string.pf \
	src/stdlib/toml.pf \
	src/testing/assertions.pf \
	src/testing/testing.pf \
	src/testing/runner.pf \
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
	src/stdlib/toml.pf > /dev/null
then
	echo "error: src/stdlib/toml.pf is not the V2 implementation" >&2
	exit 1
fi

LEGACY_TESTING_LOG="$WORK/legacy-testing-imports.log"
: > "$LEGACY_TESTING_LOG"

# Search executable/import references. Exclude this gate so its forbidden
# pattern does not become a false positive.
grep -R -n \
	--include='*.pf' \
	--include='*.js' \
	--include='*.ts' \
	--include='*.sh' \
	--exclude='test-v2-slice-b6.sh' \
	-E 'from "[^"]*(\$PFUN_HOME/)?lib/testing/(assertions|testing|runner)(\.pf)?"|runner-import[^[:cntrl:]]*lib/testing/(assertions|testing|runner)' \
	src scripts utils \
	>> "$LEGACY_TESTING_LOG" || true

if [[ -s "$LEGACY_TESTING_LOG" ]]; then
	echo "error: executable V2 references to legacy lib/testing remain" >&2
	cat "$LEGACY_TESTING_LOG" >&2
	exit 1
fi

if grep -R -n \
	--include='*.pf' \
	-E 'from "\$PFUN_HOME/lib/(list|string|toml)' \
	src
then
	echo "error: V2 source still imports public modules from legacy lib/" >&2
	exit 1
fi

echo "layout gates passed"

echo
echo "ALL SLICE B6 LIBRARY-LAYOUT TESTS PASSED"

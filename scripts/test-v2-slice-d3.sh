#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -gt 0 ]]; then
	BASE_COMPILER="$1"
elif [[ -f output/slice-d2/stage1/pfc.js ]]; then
	BASE_COMPILER="output/slice-d2/stage1/pfc.js"
else
	echo "error: no trusted D2 compiler was found" >&2
	exit 1
fi

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: seed compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-d3"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"

rm -rf "$WORK"
mkdir -p "$WORK/stage1" "$WORK/stage2"

echo "== TypeScript compiler build =="
npm run build

echo
echo "== Bootstrap Pfun test corpus =="
bash bootstrap/test/run-tests.sh --summary

echo
echo "== Node host manifest, file, and binary behavior =="
node bootstrap/test/host_node_test.js
node bootstrap/test/file_node_host_test.js
node bootstrap/test/binary_node_host_test.js

echo
echo "== Build compiler containing Slice D3 =="
PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build bootstrap/src/drivers/cli.pf \
	-o "$STAGE1"

echo
echo "== Compiler fixed point =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build bootstrap/src/drivers/cli.pf \
	-o "$STAGE2"

cmp "$STAGE1" "$STAGE2"
echo "compiler fixed point passed"

echo
echo "== Example-facing binary and buffer program through pfc run =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" \
	run bootstrap/spec/slice-d3/binary-example.pf \
	> "$WORK/program.stdout.txt" \
	2> "$WORK/program.stderr.txt"
PROGRAM_RC=$?
set -e

if [[ "$PROGRAM_RC" -ne 0 ]]; then
	echo "error: D3 compiled fixture returned $PROGRAM_RC" >&2
	if [[ -s "$WORK/program.stderr.txt" ]]; then
		echo "--- fixture stderr ---" >&2
		cat "$WORK/program.stderr.txt" >&2
	fi
	if [[ -s "$WORK/program.stdout.txt" ]]; then
		echo "--- fixture stdout ---" >&2
		cat "$WORK/program.stdout.txt" >&2
	fi
	exit "$PROGRAM_RC"
fi

if [[ -s "$WORK/program.stderr.txt" ]]; then
	echo "error: successful D3 fixture wrote stderr" >&2
	cat "$WORK/program.stderr.txt" >&2
	exit 1
fi

diff -u \
	bootstrap/spec/slice-d3/expected.txt \
	"$WORK/program.stdout.txt"

echo "compiled binary and buffer behavior passed"

echo
echo "== Direct NodeBundle binary and buffer compatibility =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build bootstrap/spec/slice-d3/binary-example.pf \
	-o "$WORK/binary-example.js" \
	> "$WORK/build.stdout.txt" \
	2> "$WORK/build.stderr.txt"

if [[ -s "$WORK/build.stderr.txt" ]]; then
	echo "error: successful D3 build wrote stderr" >&2
	cat "$WORK/build.stderr.txt" >&2
	exit 1
fi

rm -rf "$WORK/program"

node "$WORK/binary-example.js" \
	> "$WORK/bundle.stdout.txt" \
	2> "$WORK/bundle.stderr.txt"

if [[ -s "$WORK/bundle.stderr.txt" ]]; then
	echo "error: successful D3 bundle wrote stderr" >&2
	cat "$WORK/bundle.stderr.txt" >&2
	exit 1
fi

diff -u \
	bootstrap/spec/slice-d3/expected.txt \
	"$WORK/bundle.stdout.txt"

echo "direct NodeBundle binary and buffer behavior passed"

echo
echo "== Slice D2 through Slice A regression gates =="
bash scripts/test-v2-slice-d2.sh "$STAGE1"

echo
echo "ALL SLICE D3 BINARY-BUFFER TESTS PASSED"

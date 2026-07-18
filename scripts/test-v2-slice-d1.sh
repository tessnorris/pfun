#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -gt 0 ]]; then
	BASE_COMPILER="$1"
elif [[ -f output/slice-c4/stage1/pfc.js ]]; then
	BASE_COMPILER="output/slice-c4/stage1/pfc.js"
else
	echo "error: no trusted C4 compiler was found" >&2
	exit 1
fi

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: seed compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-d1"
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
echo "== Node host manifest and I/O behavior =="
node bootstrap/test/host_node_test.js
node bootstrap/test/io_node_host_test.js

echo
echo "== Build compiler containing Slice D1 =="
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
echo "== Example-style console I/O through pfc run =="
set +e
printf 'βrest\r\nlast\r' | \
	PFUN_HOME="$ROOT" node "$STAGE1" \
		run bootstrap/spec/slice-d1/io-example.pf \
		> "$WORK/io.stdout.txt" \
		2> "$WORK/io.stderr.txt"
IO_RUN_RC=$?
set -e

if [[ "$IO_RUN_RC" -ne 0 ]]; then
	echo "error: D1 compiled I/O fixture returned $IO_RUN_RC" >&2
	if [[ -s "$WORK/io.stderr.txt" ]]; then
		echo "--- fixture stderr ---" >&2
		cat "$WORK/io.stderr.txt" >&2
	fi
	if [[ -s "$WORK/io.stdout.txt" ]]; then
		echo "--- fixture stdout ---" >&2
		cat "$WORK/io.stdout.txt" >&2
	fi
	exit "$IO_RUN_RC"
fi

diff -u \
	bootstrap/spec/slice-d1/stdout-expected.txt \
	"$WORK/io.stdout.txt"

diff -u \
	bootstrap/spec/slice-d1/stderr-expected.txt \
	"$WORK/io.stderr.txt"

echo "console streams and stdin passed"

echo
echo "== Exact exit status through pfc run =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" \
	run bootstrap/spec/slice-d1/exit-status.pf \
	> "$WORK/exit.stdout.txt" \
	2> "$WORK/exit.stderr.txt"
EXIT_RC=$?
set -e

if [[ "$EXIT_RC" -ne 23 ]]; then
	echo "error: exit probe returned $EXIT_RC instead of 23" >&2
	cat "$WORK/exit.stdout.txt" >&2
	cat "$WORK/exit.stderr.txt" >&2
	exit 1
fi

if [[ -s "$WORK/exit.stdout.txt" ]]; then
	echo "error: code after exit executed or stdout was polluted" >&2
	cat "$WORK/exit.stdout.txt" >&2
	exit 1
fi

if [[ -s "$WORK/exit.stderr.txt" ]]; then
	echo "error: exit probe wrote stderr" >&2
	cat "$WORK/exit.stderr.txt" >&2
	exit 1
fi

echo "exit status passed"

echo
echo "== Direct NodeBundle I/O compatibility =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build bootstrap/spec/slice-d1/io-example.pf \
	-o "$WORK/io-example.js" \
	> "$WORK/build.stdout.txt" \
	2> "$WORK/build.stderr.txt"

if [[ -s "$WORK/build.stderr.txt" ]]; then
	echo "error: successful D1 build wrote stderr" >&2
	cat "$WORK/build.stderr.txt" >&2
	exit 1
fi

printf 'βrest\r\nlast\r' | \
	node "$WORK/io-example.js" \
	> "$WORK/bundle.stdout.txt" \
	2> "$WORK/bundle.stderr.txt"

diff -u \
	bootstrap/spec/slice-d1/stdout-expected.txt \
	"$WORK/bundle.stdout.txt"

diff -u \
	bootstrap/spec/slice-d1/stderr-expected.txt \
	"$WORK/bundle.stderr.txt"

echo "direct NodeBundle I/O passed"

echo
echo "== Slice C4 through Slice A regression gates =="
bash scripts/test-v2-slice-c4.sh "$STAGE1"

echo
echo "ALL SLICE D1 NODE-IO TESTS PASSED"

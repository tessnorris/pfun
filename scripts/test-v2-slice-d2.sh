#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-d2"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"

rm -rf "$WORK"
mkdir -p "$WORK/stage1" "$WORK/stage2"

echo "== Build compiler containing Slice D2 =="
PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build src/drivers/cli.pf \
	-o "$STAGE1"

echo
echo "== Compiler fixed point =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build src/drivers/cli.pf \
	-o "$STAGE2"

cmp "$STAGE1" "$STAGE2"
echo "compiler fixed point passed"

echo
echo "== Example-facing text-file program through pfc run =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" \
	run spec/slice-d2/file-example.pf \
	> "$WORK/program.stdout.txt" \
	2> "$WORK/program.stderr.txt"
PROGRAM_RC=$?
set -e

if [[ "$PROGRAM_RC" -ne 0 ]]; then
	echo "error: D2 compiled fixture returned $PROGRAM_RC" >&2
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
	echo "error: successful D2 fixture wrote stderr" >&2
	cat "$WORK/program.stderr.txt" >&2
	exit 1
fi

diff -u \
	spec/slice-d2/expected.txt \
	"$WORK/program.stdout.txt"

echo "compiled text-file behavior passed"

echo
echo "== Direct NodeBundle text-file compatibility =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-d2/file-example.pf \
	-o "$WORK/file-example.js" \
	> "$WORK/build.stdout.txt" \
	2> "$WORK/build.stderr.txt"

if [[ -s "$WORK/build.stderr.txt" ]]; then
	echo "error: successful D2 build wrote stderr" >&2
	cat "$WORK/build.stderr.txt" >&2
	exit 1
fi

rm -rf "$WORK/program"

node "$WORK/file-example.js" \
	> "$WORK/bundle.stdout.txt" \
	2> "$WORK/bundle.stderr.txt"

if [[ -s "$WORK/bundle.stderr.txt" ]]; then
	echo "error: successful D2 bundle wrote stderr" >&2
	cat "$WORK/bundle.stderr.txt" >&2
	exit 1
fi

diff -u \
	spec/slice-d2/expected.txt \
	"$WORK/bundle.stdout.txt"

echo "direct NodeBundle text-file behavior passed"


echo
echo "ALL SLICE D2 TEXT-FILE TESTS PASSED"

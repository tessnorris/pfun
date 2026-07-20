#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-d4"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"

rm -rf "$WORK"
mkdir -p "$WORK/stage1" "$WORK/stage2"

echo "== Build compiler containing Slice D4 =="
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
echo "== Awaited and fire-and-forget async execution through pfc run =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" \
	run spec/slice-d4/async-example.pf \
	> "$WORK/program.stdout.txt" \
	2> "$WORK/program.stderr.txt"
PROGRAM_RC=$?
set -e

if [[ "$PROGRAM_RC" -ne 0 ]]; then
	echo "error: D4 async fixture returned $PROGRAM_RC" >&2
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
	echo "error: successful D4 fixture wrote stderr" >&2
	cat "$WORK/program.stderr.txt" >&2
	exit 1
fi

diff -u \
	spec/slice-d4/expected.txt \
	"$WORK/program.stdout.txt"

echo "async execution passed"

echo
echo "== Await outside async is rejected =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" \
	check spec/slice-d4/await-outside-async.pf \
	> "$WORK/await-negative.stdout.txt" \
	2> "$WORK/await-negative.stderr.txt"
AWAIT_RC=$?
set -e

if [[ "$AWAIT_RC" -eq 0 ]]; then
	echo "error: await outside async unexpectedly checked" >&2
	exit 1
fi

if [[ -s "$WORK/await-negative.stdout.txt" ]]; then
	echo "error: await diagnostic polluted stdout" >&2
	cat "$WORK/await-negative.stdout.txt" >&2
	exit 1
fi

if ! grep -i -F "await" \
	"$WORK/await-negative.stderr.txt" >/dev/null
then
	echo "error: await diagnostic is missing from stderr" >&2
	cat "$WORK/await-negative.stderr.txt" >&2
	exit 1
fi

echo "await-context rejection passed"

echo
echo "== Direct NodeBundle async compatibility =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-d4/async-example.pf \
	-o "$WORK/async-example.js" \
	> "$WORK/build.stdout.txt" \
	2> "$WORK/build.stderr.txt"

if [[ -s "$WORK/build.stderr.txt" ]]; then
	echo "error: successful D4 build wrote stderr" >&2
	cat "$WORK/build.stderr.txt" >&2
	exit 1
fi

set +e
node "$WORK/async-example.js" \
	> "$WORK/bundle.stdout.txt" \
	2> "$WORK/bundle.stderr.txt"
BUNDLE_RC=$?
set -e

if [[ "$BUNDLE_RC" -ne 0 ]]; then
	echo "error: D4 NodeBundle returned $BUNDLE_RC" >&2
	cat "$WORK/bundle.stderr.txt" >&2
	exit "$BUNDLE_RC"
fi

if [[ -s "$WORK/bundle.stderr.txt" ]]; then
	echo "error: successful D4 NodeBundle wrote stderr" >&2
	cat "$WORK/bundle.stderr.txt" >&2
	exit 1
fi

diff -u \
	spec/slice-d4/expected.txt \
	"$WORK/bundle.stdout.txt"

echo "direct NodeBundle async execution passed"


echo
echo "ALL SLICE D4 ASYNC-SLEEP TESTS PASSED"

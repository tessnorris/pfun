#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-c2"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"

rm -rf "$WORK"
mkdir -p "$WORK/bridge" "$WORK/stage1" "$WORK/stage2"

echo "== Build final compiler containing Slice C2 =="
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
echo "== Public eprint/eprintln stream separation =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-c2/stderr.pf \
	-o "$WORK/stderr.js" \
	> "$WORK/stderr-build.stdout.txt" \
	2> "$WORK/stderr-build.stderr.txt"

if [[ -s "$WORK/stderr-build.stderr.txt" ]]; then
	echo "error: successful stderr-probe build wrote stderr" >&2
	cat "$WORK/stderr-build.stderr.txt" >&2
	exit 1
fi

node "$WORK/stderr.js" \
	> "$WORK/stderr.actual.stdout.txt" \
	2> "$WORK/stderr.actual.stderr.txt"

diff -u spec/slice-c2/stdout-expected.txt "$WORK/stderr.actual.stdout.txt"
diff -u spec/slice-c2/stderr-expected.txt "$WORK/stderr.actual.stderr.txt"
echo "public stderr procedures passed"

echo
echo "== Check diagnostics use stderr =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" \
	check spec/slice-c1/pure-calls-proc.pf \
	> "$WORK/check-bad.stdout.txt" \
	2> "$WORK/check-bad.stderr.txt"
BAD_RC=$?
set -e

if [[ "$BAD_RC" -ne 1 ]]; then
	echo "error: invalid check returned $BAD_RC instead of 1" >&2
	exit 1
fi
if [[ -s "$WORK/check-bad.stdout.txt" ]]; then
	echo "error: invalid check polluted stdout" >&2
	cat "$WORK/check-bad.stdout.txt" >&2
	exit 1
fi
if ! grep -F "error[Purity]" "$WORK/check-bad.stderr.txt" >/dev/null; then
	echo "error: invalid check did not report Purity on stderr" >&2
	cat "$WORK/check-bad.stderr.txt" >&2
	exit 1
fi
echo "diagnostic stream passed"

echo
echo "== Usage failures use stderr =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" check \
	> "$WORK/check-usage.stdout.txt" \
	2> "$WORK/check-usage.stderr.txt"
USAGE_RC=$?
PFUN_HOME="$ROOT" node "$STAGE1" nope \
	> "$WORK/unknown.stdout.txt" \
	2> "$WORK/unknown.stderr.txt"
UNKNOWN_RC=$?
set -e

if [[ "$USAGE_RC" -ne 2 ]]; then
	echo "error: incomplete check returned $USAGE_RC instead of 2" >&2
	exit 1
fi
if [[ -s "$WORK/check-usage.stdout.txt" ]]; then
	echo "error: check usage polluted stdout" >&2
	cat "$WORK/check-usage.stdout.txt" >&2
	exit 1
fi
if ! grep -F "pfc check <entry.pf>" "$WORK/check-usage.stderr.txt" >/dev/null; then
	echo "error: check usage was not written to stderr" >&2
	cat "$WORK/check-usage.stderr.txt" >&2
	exit 1
fi
if [[ "$UNKNOWN_RC" -ne 2 ]]; then
	echo "error: unknown command returned $UNKNOWN_RC instead of 2" >&2
	exit 1
fi
if [[ -s "$WORK/unknown.stdout.txt" ]]; then
	echo "error: unknown command polluted stdout" >&2
	cat "$WORK/unknown.stdout.txt" >&2
	exit 1
fi
if ! grep -F "Unknown command 'nope'." "$WORK/unknown.stderr.txt" >/dev/null; then
	echo "error: unknown-command message was not written to stderr" >&2
	cat "$WORK/unknown.stderr.txt" >&2
	exit 1
fi
echo "usage stream passed"

echo
echo "== Successful commands keep stderr empty =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	check spec/slice-c1/good.pf \
	> "$WORK/check-good.stdout.txt" \
	2> "$WORK/check-good.stderr.txt"
if [[ -s "$WORK/check-good.stderr.txt" ]]; then
	echo "error: successful check wrote stderr" >&2
	cat "$WORK/check-good.stderr.txt" >&2
	exit 1
fi
if ! grep -F "Checked spec/slice-c1/good.pf" "$WORK/check-good.stdout.txt" >/dev/null; then
	echo "error: successful check confirmation is missing" >&2
	cat "$WORK/check-good.stdout.txt" >&2
	exit 1
fi
echo "successful command streams passed"


echo
echo "ALL SLICE C2 STDERR TESTS PASSED"

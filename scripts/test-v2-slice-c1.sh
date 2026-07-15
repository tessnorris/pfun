#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -gt 0 ]]; then
	BASE_COMPILER="$1"
elif [[ -f output/slice-b6/stage1/pfc.js ]]; then
	BASE_COMPILER="output/slice-b6/stage1/pfc.js"
elif [[ -f output/slice-b5/stage1/pfc.js ]]; then
	BASE_COMPILER="output/slice-b5/stage1/pfc.js"
elif [[ -f bootstrap-stage2/pfc.js ]]; then
	BASE_COMPILER="bootstrap-stage2/pfc.js"
else
	echo "error: no trusted seed compiler was found" >&2
	exit 1
fi

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: seed compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-c1"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"
COMPILER="$ROOT/$STAGE1"

rm -rf "$WORK"
mkdir -p "$WORK/stage1" "$WORK/stage2"

echo "== TypeScript compiler build =="
npm run build

echo
echo "== Bootstrap Pfun test corpus =="
bash bootstrap/test/run-tests.sh --summary

echo
echo "== Build compiler containing Slice C1 =="
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
echo "== Check-only success and no artifact =="
CHECK_CWD="$ROOT/$WORK/check-cwd"
CHECK_STDOUT="$ROOT/$WORK/check-good.stdout.txt"
CHECK_STDERR="$ROOT/$WORK/check-good.stderr.txt"

mkdir -p "$CHECK_CWD"

(
	cd "$CHECK_CWD"
	PFUN_HOME="$ROOT" node "$COMPILER" \
		check ../../../bootstrap/spec/slice-c1/good.pf \
		> "$CHECK_STDOUT" \
		2> "$CHECK_STDERR"
)

if ! grep -F \
	"Checked ../../../bootstrap/spec/slice-c1/good.pf" \
	"$WORK/check-good.stdout.txt" >/dev/null
then
	echo "error: successful check did not print the expected confirmation" >&2
	cat "$WORK/check-good.stdout.txt" >&2
	exit 1
fi

if [[ -s "$WORK/check-good.stderr.txt" ]]; then
	echo "error: successful C1 check unexpectedly wrote stderr" >&2
	cat "$WORK/check-good.stderr.txt" >&2
	exit 1
fi

if [[ -e "$CHECK_CWD/pfc.js" ]]; then
	echo "error: check command created the default build artifact" >&2
	exit 1
fi

echo "check-only success passed"

echo
echo "== Check-only diagnostic failure =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" \
	check bootstrap/spec/slice-c1/pure-calls-proc.pf \
	> "$WORK/check-bad.stdout.txt" \
	2> "$WORK/check-bad.stderr.txt"
BAD_RC=$?
set -e

if [[ "$BAD_RC" -ne 1 ]]; then
	echo "error: invalid program returned $BAD_RC instead of 1" >&2
	cat "$WORK/check-bad.stdout.txt" >&2
	cat "$WORK/check-bad.stderr.txt" >&2
	exit 1
fi

if [[ -s "$WORK/check-bad.stdout.txt" ]]; then
	echo "error: invalid check polluted stdout" >&2
	cat "$WORK/check-bad.stdout.txt" >&2
	exit 1
fi

if ! grep -F "error[Purity]" "$WORK/check-bad.stderr.txt" >/dev/null; then
	echo "error: invalid check did not report a Purity diagnostic on stderr" >&2
	cat "$WORK/check-bad.stderr.txt" >&2
	exit 1
fi

echo "check-only diagnostic failure passed"

echo
echo "== Usage and unknown-command exits =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" check \
	> "$WORK/check-usage.stdout.txt" \
	2> "$WORK/check-usage.stderr.txt"
CHECK_USAGE_RC=$?

PFUN_HOME="$ROOT" node "$STAGE1" nope \
	> "$WORK/unknown.stdout.txt" \
	2> "$WORK/unknown.stderr.txt"
UNKNOWN_RC=$?
set -e

if [[ "$CHECK_USAGE_RC" -ne 2 ]]; then
	echo "error: incomplete check returned $CHECK_USAGE_RC instead of 2" >&2
	cat "$WORK/check-usage.stdout.txt" >&2
	exit 1
fi

if [[ -s "$WORK/check-usage.stdout.txt" ]]; then
	echo "error: check usage polluted stdout" >&2
	cat "$WORK/check-usage.stdout.txt" >&2
	exit 1
fi

if ! grep -F "pfc check <entry.pf>" "$WORK/check-usage.stderr.txt" >/dev/null; then
	echo "error: check usage text is missing from stderr" >&2
	cat "$WORK/check-usage.stderr.txt" >&2
	exit 1
fi

if [[ "$UNKNOWN_RC" -ne 2 ]]; then
	echo "error: unknown command returned $UNKNOWN_RC instead of 2" >&2
	cat "$WORK/unknown.stdout.txt" >&2
	exit 1
fi

if [[ -s "$WORK/unknown.stdout.txt" ]]; then
	echo "error: unknown command polluted stdout" >&2
	cat "$WORK/unknown.stdout.txt" >&2
	exit 1
fi

if ! grep -F "Unknown command 'nope'." "$WORK/unknown.stderr.txt" >/dev/null; then
	echo "error: unknown command diagnostic was not rendered on stderr" >&2
	cat "$WORK/unknown.stderr.txt" >&2
	exit 1
fi

echo "usage behavior passed"

echo
echo "== Existing build command regression =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build bootstrap/spec/slice-c1/good.pf \
	-o "$WORK/good.js" \
	> "$WORK/build.stdout.txt" \
	2> "$WORK/build.stderr.txt"

node "$WORK/good.js" > "$WORK/build.actual.txt"

diff -u \
	bootstrap/spec/slice-c1/build-expected.txt \
	"$WORK/build.actual.txt"

echo "build regression passed"

if [[ -x scripts/test-v2-slice-b6.sh ]]; then
	echo
	echo "== Slice B6 through Slice A regression gates =="
	bash scripts/test-v2-slice-b6.sh "$STAGE1"
fi

echo
echo "ALL SLICE C1 CHECK-COMMAND TESTS PASSED"

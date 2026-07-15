#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -gt 0 ]]; then
	BASE_COMPILER="$1"
elif [[ -f output/slice-c1/stage1/pfc.js ]]; then
	BASE_COMPILER="output/slice-c1/stage1/pfc.js"
elif [[ -f bootstrap-stage2/pfc.js ]]; then
	BASE_COMPILER="bootstrap-stage2/pfc.js"
else
	echo "error: no trusted C1 compiler was found" >&2
	exit 1
fi

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: seed compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-c2"
BRIDGE_SRC="$WORK/bridge-src"
BRIDGE="$WORK/bridge/pfc.js"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"

rm -rf "$WORK"
mkdir -p "$WORK/bridge" "$WORK/stage1" "$WORK/stage2"

echo "== TypeScript compiler build =="
npm run build

echo
echo "== Bootstrap harness integrity =="
if grep -R -F '$PFUN_HOME/lib/testing/runner' \
	bootstrap/test/*_gen.pf >/dev/null 2>&1
then
	echo "error: generated harnesses still reference the removed root runner" >&2
	exit 1
fi

echo "== Bootstrap Pfun test corpus =="
bash bootstrap/test/run-tests.sh --summary

echo
echo "== Node host manifest and behavior =="
node bootstrap/test/host_node_test.js

echo
echo "== Build C2 manifest bridge compiler =="
cp -R bootstrap/src "$BRIDGE_SRC"

python3 - "$BRIDGE_SRC/drivers/iofloor.pf" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

old = 'eprintln(join(lines, "\\n"));'
new = 'println(join(lines, "\\n"));'

if old not in text:
	raise SystemExit(
		f"error: bridge IO floor is missing the C2 errorLines call: {path}"
	)

if text.count(old) != 1:
	raise SystemExit(
		f"error: expected exactly one C2 errorLines call in {path}"
	)

path.write_text(text.replace(old, new, 1), encoding="utf-8")
PY

if grep -F 'eprintln(join(lines, "\n"));' 	"$BRIDGE_SRC/drivers/iofloor.pf" >/dev/null
then
	echo "error: bridge IO floor still calls eprintln" >&2
	exit 1
fi

if ! grep -F 'println(join(lines, "\n"));' 	"$BRIDGE_SRC/drivers/iofloor.pf" >/dev/null
then
	echo "error: bridge IO floor does not call println" >&2
	exit 1
fi

PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build "$BRIDGE_SRC/drivers/cli.pf" \
	-o "$BRIDGE"

echo
echo "== Build final compiler containing Slice C2 =="
PFUN_HOME="$ROOT" node "$BRIDGE" \
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
echo "== Public eprint/eprintln stream separation =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build bootstrap/spec/slice-c2/stderr.pf \
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

diff -u bootstrap/spec/slice-c2/stdout-expected.txt "$WORK/stderr.actual.stdout.txt"
diff -u bootstrap/spec/slice-c2/stderr-expected.txt "$WORK/stderr.actual.stderr.txt"
echo "public stderr procedures passed"

echo
echo "== Check diagnostics use stderr =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" \
	check bootstrap/spec/slice-c1/pure-calls-proc.pf \
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
	check bootstrap/spec/slice-c1/good.pf \
	> "$WORK/check-good.stdout.txt" \
	2> "$WORK/check-good.stderr.txt"
if [[ -s "$WORK/check-good.stderr.txt" ]]; then
	echo "error: successful check wrote stderr" >&2
	cat "$WORK/check-good.stderr.txt" >&2
	exit 1
fi
if ! grep -F "Checked bootstrap/spec/slice-c1/good.pf" "$WORK/check-good.stdout.txt" >/dev/null; then
	echo "error: successful check confirmation is missing" >&2
	cat "$WORK/check-good.stdout.txt" >&2
	exit 1
fi
echo "successful command streams passed"

echo
echo "== Slice C1 through Slice A regression gates =="
bash scripts/test-v2-slice-c1.sh "$STAGE1"

echo
echo "ALL SLICE C2 STDERR TESTS PASSED"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -gt 0 ]]; then
	BASE_COMPILER="$1"
elif [[ -f output/slice-d4/stage1/pfc.js ]]; then
	BASE_COMPILER="output/slice-d4/stage1/pfc.js"
else
	echo "error: no trusted D4 compiler was found" >&2
	exit 1
fi

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: seed compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-d5"
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
echo "== Node host manifest and process behavior =="
node bootstrap/test/host_node_test.js
node bootstrap/test/file_node_host_test.js
node bootstrap/test/binary_node_host_test.js
node bootstrap/test/async_node_host_test.js
node bootstrap/test/process_node_host_test.js

echo
echo "== Build compiler containing Slice D5 =="
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
echo "== Arguments and environment through pfc run =="
(
	unset PFUN_D5_MISSING
	export PFUN_D5_PRESENT="present value"
	export PFUN_D5_EMPTY=""

	PFUN_HOME="$ROOT" node "$STAGE1" \
		run bootstrap/spec/slice-d5/process-example.pf \
		alpha "beta gamma" "" --literal "β"
) \
	> "$WORK/program.stdout.txt" \
	2> "$WORK/program.stderr.txt"

if [[ -s "$WORK/program.stderr.txt" ]]; then
	echo "error: successful D5 fixture wrote stderr" >&2
	cat "$WORK/program.stderr.txt" >&2
	exit 1
fi

diff -u \
	bootstrap/spec/slice-d5/expected.txt \
	"$WORK/program.stdout.txt"

echo "pfc run argument and environment behavior passed"

echo
echo "== Environment reads remain proc-only =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" \
	check bootstrap/spec/slice-d5/environment-in-pure.pf \
	> "$WORK/purity.stdout.txt" \
	2> "$WORK/purity.stderr.txt"
PURITY_RC=$?
set -e

if [[ "$PURITY_RC" -eq 0 ]]; then
	echo "error: pure envVars call unexpectedly checked" >&2
	exit 1
fi

cat "$WORK/purity.stdout.txt" "$WORK/purity.stderr.txt" \
	> "$WORK/purity.all.txt"

if ! grep -F "error[Purity]" \
	"$WORK/purity.all.txt" >/dev/null
then
	echo "error: envVars purity rejection lacked a Purity diagnostic" >&2
	cat "$WORK/purity.all.txt" >&2
	exit 1
fi

echo "proc-only environment contract passed"

echo
echo "== Direct NodeBundle process compatibility =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build bootstrap/spec/slice-d5/process-example.pf \
	-o "$WORK/process-example.js" \
	> "$WORK/build.stdout.txt" \
	2> "$WORK/build.stderr.txt"

if [[ -s "$WORK/build.stderr.txt" ]]; then
	echo "error: successful D5 build wrote stderr" >&2
	cat "$WORK/build.stderr.txt" >&2
	exit 1
fi

(
	unset PFUN_D5_MISSING
	export PFUN_D5_PRESENT="present value"
	export PFUN_D5_EMPTY=""

	node "$WORK/process-example.js" \
		alpha "beta gamma" "" --literal "β"
) \
	> "$WORK/bundle.stdout.txt" \
	2> "$WORK/bundle.stderr.txt"

if [[ -s "$WORK/bundle.stderr.txt" ]]; then
	echo "error: successful D5 NodeBundle wrote stderr" >&2
	cat "$WORK/bundle.stderr.txt" >&2
	exit 1
fi

diff -u \
	bootstrap/spec/slice-d5/expected.txt \
	"$WORK/bundle.stdout.txt"

echo "direct NodeBundle process behavior passed"

echo
echo "== Slice D4 through Slice A regression gates =="
bash scripts/test-v2-slice-d4.sh "$STAGE1"

echo
echo "ALL SLICE D5 ARGS-ENVIRONMENT TESTS PASSED"

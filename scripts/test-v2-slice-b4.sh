#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -gt 0 ]]; then
	BASE_COMPILER="$1"
elif [[ -f output/slice-b3/stage4/pfc.js ]]; then
	BASE_COMPILER="output/slice-b3/stage4/pfc.js"
elif [[ -f output/slice-b3/stage5/pfc.js ]]; then
	BASE_COMPILER="output/slice-b3/stage5/pfc.js"
elif [[ -f output/slice-b2/stage3/pfc.js ]]; then
	BASE_COMPILER="output/slice-b2/stage3/pfc.js"
else
	BASE_COMPILER="bootstrap-stage2/pfc.js"
fi

WORK="output/slice-b4"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"
PERMISSION_ROOT="$WORK/permission-root"
ROOT_PERMISSION_TMP=""

cleanup() {
	if [[ -n "$ROOT_PERMISSION_TMP" ]]; then
		chmod -R u+rwx "$ROOT_PERMISSION_TMP" 2>/dev/null || true
		rm -rf "$ROOT_PERMISSION_TMP"
	fi

	chmod -R u+rwx "$PERMISSION_ROOT" 2>/dev/null || true
	rm -rf "$PERMISSION_ROOT"
}
trap cleanup EXIT

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: seed compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

if ! command -v timeout > /dev/null 2>&1; then
	echo "error: Slice B4 requires the coreutils 'timeout' command" >&2
	exit 1
fi

rm -rf "$WORK"
mkdir -p "$WORK/stage1" "$WORK/stage2"

echo "== Build compiler containing Slice B4 corpus =="
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

build_program() {
	local name="$1"
	local source="$2"

	PFUN_HOME="$ROOT" node "$STAGE1" \
		build "$source" \
		-o "$WORK/${name}.js"
}

echo
echo "== Build Slice B4 input programs =="

build_program "scanln" "bootstrap/spec/slice-b4/scanln.pf"
build_program "scanchar" "bootstrap/spec/slice-b4/scanchar.pf"
build_program "mixed-input" "bootstrap/spec/slice-b4/mixed_input.pf"
build_program "empty-input" "bootstrap/spec/slice-b4/empty_input.pf"
build_program "permission-denied" \
	"bootstrap/spec/slice-b4/permission_denied.pf"

echo
echo "== scanln: CRLF, empty line, final unterminated line, EOF =="

printf 'alpha\r\n\r\nomega' |
	LC_ALL=C.UTF-8 timeout 10s node "$WORK/scanln.js" \
	> "$WORK/scanln.actual.txt"

diff -u \
	bootstrap/spec/slice-b4/scanln.expected.txt \
	"$WORK/scanln.actual.txt"

echo "scanln passed"

echo
echo "== scanChar: Unicode code points and EOF =="

printf 'Aé🙂' |
	LC_ALL=C.UTF-8 timeout 10s node "$WORK/scanchar.js" \
	> "$WORK/scanchar.actual.txt"

diff -u \
	bootstrap/spec/slice-b4/scanchar.expected.txt \
	"$WORK/scanchar.actual.txt"

echo "scanChar passed"

echo
echo "== Shared stdin cursor =="

printf 'first\nZ' |
	LC_ALL=C.UTF-8 timeout 10s node "$WORK/mixed-input.js" \
	> "$WORK/mixed-input.actual.txt"

diff -u \
	bootstrap/spec/slice-b4/mixed_input.expected.txt \
	"$WORK/mixed-input.actual.txt"

echo "shared stdin cursor passed"

echo
echo "== Immediate EOF =="

printf '' |
	LC_ALL=C.UTF-8 timeout 10s node "$WORK/empty-input.js" \
	> "$WORK/empty-input.actual.txt"

diff -u \
	bootstrap/spec/slice-b4/empty_input.expected.txt \
	"$WORK/empty-input.actual.txt"

echo "immediate EOF passed"

run_permission_denied() {
	local bundle="$WORK/permission-denied.js"
	local actual="$WORK/permission-denied.actual.txt"

	if [[ "$(id -u)" -eq 0 ]]; then
		ROOT_PERMISSION_TMP="$(mktemp -d /tmp/pfun-slice-b4.XXXXXX)"
		chmod 755 "$ROOT_PERMISSION_TMP"

		cp "$bundle" "$ROOT_PERMISSION_TMP/permission-denied.js"
		chmod 644 "$ROOT_PERMISSION_TMP/permission-denied.js"

		mkdir "$ROOT_PERMISSION_TMP/protected"
		printf 'secret\n' > "$ROOT_PERMISSION_TMP/protected/secret.txt"
		chmod 700 "$ROOT_PERMISSION_TMP/protected"
		chown -R 0:0 "$ROOT_PERMISSION_TMP/protected"

		local uid
		local gid
		uid="$(id -u nobody 2>/dev/null || printf '65534')"
		gid="$(id -g nobody 2>/dev/null || printf '65534')"

		if command -v setpriv > /dev/null 2>&1; then
			timeout 10s setpriv \
				--reuid="$uid" \
				--regid="$gid" \
				--clear-groups \
				node "$ROOT_PERMISSION_TMP/permission-denied.js" \
				"$ROOT_PERMISSION_TMP/protected/secret.txt" \
				"$ROOT_PERMISSION_TMP/protected/new.txt" \
				> "$actual"
		elif command -v runuser > /dev/null 2>&1; then
			timeout 10s runuser -u nobody -- \
				node "$ROOT_PERMISSION_TMP/permission-denied.js" \
				"$ROOT_PERMISSION_TMP/protected/secret.txt" \
				"$ROOT_PERMISSION_TMP/protected/new.txt" \
				> "$actual"
		else
			echo "error: root B4 permission test requires setpriv or runuser" >&2
			exit 1
		fi
	else
		mkdir -p "$PERMISSION_ROOT/protected"
		printf 'secret\n' > "$PERMISSION_ROOT/protected/secret.txt"
		chmod 000 "$PERMISSION_ROOT/protected"

		timeout 10s node "$bundle" \
			"$PERMISSION_ROOT/protected/secret.txt" \
			"$PERMISSION_ROOT/protected/new.txt" \
			> "$actual"

		chmod 700 "$PERMISSION_ROOT/protected"
	fi

	if ! grep -F "permission-read=EACCES:" "$actual" > /dev/null; then
		echo "error: readFile did not report a real EACCES failure" >&2
		cat "$actual" >&2
		exit 1
	fi

	if ! grep -F "permission-write=EACCES:" "$actual" > /dev/null; then
		echo "error: writeFile did not report a real EACCES failure" >&2
		cat "$actual" >&2
		exit 1
	fi
}

echo
echo "== Real permission-denied Result handling =="

run_permission_denied
echo "permission-denied read/write passed"

expect_build_failure() {
	local name="$1"
	local source="$2"
	shift 2

	local log="$WORK/${name}.log"
	local output="$WORK/${name}.js"

	if PFUN_HOME="$ROOT" node "$STAGE1" \
		build "$source" \
		-o "$output" \
		> "$log" 2>&1
	then
		echo "error: $name unexpectedly compiled" >&2
		cat "$log" >&2
		exit 1
	fi

	for needle in "$@"; do
		if ! grep -F -- "$needle" "$log" > /dev/null; then
			echo "error: $name did not contain expected diagnostic:" >&2
			echo "  $needle" >&2
			echo "--- compiler output ---" >&2
			cat "$log" >&2
			exit 1
		fi
	done

	echo "$name passed"
}

echo
echo "== Slice B4 negative diagnostics =="

expect_build_failure \
	"pure-scanln" \
	"bootstrap/spec/slice-b4/pure_scanln.pf" \
	"Pure code cannot call procedure 'scanln'."

expect_build_failure \
	"pure-scanchar" \
	"bootstrap/spec/slice-b4/pure_scanchar.pf" \
	"Pure code cannot call procedure 'scanChar'."

if [[ -x scripts/test-v2-slice-b3.sh ]]; then
	echo
	echo "== B3, B2, B1, and Slice A regression gates =="
	bash scripts/test-v2-slice-b3.sh "$STAGE1"
fi

echo
echo "ALL SLICE B4 ACCEPTANCE TESTS PASSED"

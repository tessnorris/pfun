#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-c4"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"

rm -rf "$WORK"
mkdir -p "$WORK/stage1" "$WORK/stage2"

echo "== Build compiler containing Slice C4 =="
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
echo "== Default NodeBundle compatibility =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-c4/node-main.pf \
	-o "$WORK/default.js" \
	> "$WORK/default-build.stdout.txt" \
	2> "$WORK/default-build.stderr.txt"

if [[ -s "$WORK/default-build.stderr.txt" ]]; then
	echo "error: successful default build wrote stderr" >&2
	cat "$WORK/default-build.stderr.txt" >&2
	exit 1
fi

node "$WORK/default.js" > "$WORK/default.actual.txt"

diff -u \
	spec/slice-c4/node-expected.txt \
	"$WORK/default.actual.txt"

echo "default NodeBundle passed"

echo
echo "== Explicit NodeBundle target =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-c4/node-main.pf \
	--target node-bundle \
	-o "$WORK/explicit.js" \
	> "$WORK/explicit-build.stdout.txt" \
	2> "$WORK/explicit-build.stderr.txt"

node "$WORK/explicit.js" > "$WORK/explicit.actual.txt"

diff -u \
	spec/slice-c4/node-expected.txt \
	"$WORK/explicit.actual.txt"

echo "explicit NodeBundle passed"

echo
echo "== NodeFiles target =="
NODE_FILES="$WORK/node-files"

PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-c4/node-main.pf \
	--target node \
	-o "$NODE_FILES" \
	> "$WORK/node-files-build.stdout.txt" \
	2> "$WORK/node-files-build.stderr.txt"

for required in \
	"$NODE_FILES/package.json" \
	"$NODE_FILES/main.js"
do
	if [[ ! -f "$required" ]]; then
		echo "error: NodeFiles output is missing $required" >&2
		exit 1
	fi
done

MODULE_COUNT="$(
	find "$NODE_FILES/modules" \
		-maxdepth 1 \
		-type f \
		-name '*.js' \
		-print | wc -l
)"

if [[ "$MODULE_COUNT" -lt 1 ]]; then
	echo "error: NodeFiles emitted no module files" >&2
	exit 1
fi

node "$NODE_FILES/main.js" > "$WORK/node-files.actual.txt"

diff -u \
	spec/slice-c4/node-expected.txt \
	"$WORK/node-files.actual.txt"

echo "NodeFiles target passed"

echo
echo "== BrowserBundle target =="
BROWSER_OUT="$WORK/site/app.html"

PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-c4/browser-main.pf \
	--page "C4 <Browser>" \
	--target browser \
	-o "$BROWSER_OUT" \
	> "$WORK/browser-build.stdout.txt" \
	2> "$WORK/browser-build.stderr.txt"

if [[ ! -f "$BROWSER_OUT" ]]; then
	echo "error: browser target did not write $BROWSER_OUT" >&2
	exit 1
fi

if [[ -s "$WORK/browser-build.stderr.txt" ]]; then
	echo "error: successful browser build wrote stderr" >&2
	cat "$WORK/browser-build.stderr.txt" >&2
	exit 1
fi

if ! grep -F "PfunBrowser" "$BROWSER_OUT" >/dev/null; then
	echo "error: browser artifact does not contain the browser host" >&2
	exit 1
fi

for node_marker in \
	"(function attachPfunNode(root, factory)" \
	"function buildPfunNode(core, nodeRequire)" \
	"root.PfunNode = api;" \
	'nodeRequire("node:fs")'
do
	if grep -F "$node_marker" "$BROWSER_OUT" >/dev/null; then
		echo "error: browser artifact contains Node-host marker: $node_marker" >&2
		exit 1
	fi
done

if ! grep -F "C4 &lt;Browser&gt;" "$BROWSER_OUT" >/dev/null; then
	echo "error: browser page title was not HTML-escaped" >&2
	exit 1
fi

if ! grep -F "exports[\"answer\"] = answer;" \
	"$BROWSER_OUT" >/dev/null
then
	echo "error: browser entry module was not linked" >&2
	exit 1
fi

echo "BrowserBundle target passed"

echo
echo "== Build-target usage failures =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-c4/node-main.pf \
	--target wat \
	> "$WORK/bad-target.stdout.txt" \
	2> "$WORK/bad-target.stderr.txt"
BAD_TARGET_RC=$?

PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-c4/node-main.pf \
	--page Nope \
	> "$WORK/bad-page.stdout.txt" \
	2> "$WORK/bad-page.stderr.txt"
BAD_PAGE_RC=$?
set -e

if [[ "$BAD_TARGET_RC" -ne 2 ]]; then
	echo "error: bad target returned $BAD_TARGET_RC instead of 2" >&2
	exit 1
fi

if [[ -s "$WORK/bad-target.stdout.txt" ]]; then
	echo "error: bad target polluted stdout" >&2
	exit 1
fi

if ! grep -F "Unknown build target 'wat'." \
	"$WORK/bad-target.stderr.txt" >/dev/null
then
	echo "error: bad target message is missing from stderr" >&2
	exit 1
fi

if [[ "$BAD_PAGE_RC" -ne 2 ]]; then
	echo "error: non-browser --page returned $BAD_PAGE_RC instead of 2" >&2
	exit 1
fi

if [[ -s "$WORK/bad-page.stdout.txt" ]]; then
	echo "error: invalid --page polluted stdout" >&2
	exit 1
fi

if ! grep -F -- "--page is only valid with --target browser." \
	"$WORK/bad-page.stderr.txt" >/dev/null
then
	echo "error: invalid --page message is missing from stderr" >&2
	exit 1
fi

echo "build-target usage passed"


echo
echo "ALL SLICE C4 BUILD-TARGET TESTS PASSED"

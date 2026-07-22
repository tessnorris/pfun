#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="boot/pfc.js"
OUTPUT_MODE="normal"
COLOR_MODE="auto"
FAIL_FAST=0
LIST_ONLY=0

usage() {
	cat <<'EOF'
Usage: scripts/test-v2-all-slices.sh [options]

Runs every scripts/test-v2-slice-*.sh acceptance runner in natural version
order. New slice runners are discovered automatically.

Options:
  --compiler PATH  Seed compiler passed to every slice runner (default: boot/pfc.js)
  --summary        Show one colored result per slice; full output remains in logs
  --fail-fast      Stop after the first failing slice
  --color          Force ANSI color, even when output is redirected
  --no-color       Disable ANSI color
  --list           List the discovered slice runners without running them
  -h, --help       Show this help

Logs and the aggregate summary are written beneath output/all-slices/.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--compiler)
		if [[ $# -lt 2 ]]; then
			echo "error: --compiler requires a path" >&2
			exit 2
		fi
		BASE_COMPILER="$2"
		shift 2
		;;
	--summary)
		OUTPUT_MODE="summary"
		shift
		;;
	--fail-fast)
		FAIL_FAST=1
		shift
		;;
	--color)
		COLOR_MODE="always"
		shift
		;;
	--no-color)
		COLOR_MODE="never"
		shift
		;;
	--list)
		LIST_ONLY=1
		shift
		;;
	-h|--help)
		usage
		exit 0
		;;
	*)
		echo "error: unknown option: $1" >&2
		usage >&2
		exit 2
		;;
	esac
done

if [[ "$BASE_COMPILER" != /* ]]; then
	BASE_COMPILER="$ROOT/$BASE_COMPILER"
fi

mapfile -t RUNNERS < <(
	find "$ROOT/scripts" -maxdepth 1 -type f \
		-name 'test-v2-slice-*.sh' -print \
		| LC_ALL=C sort -V
)

if [[ ${#RUNNERS[@]} -eq 0 ]]; then
	echo "error: no slice acceptance runners were found" >&2
	exit 1
fi

if [[ "$LIST_ONLY" -eq 1 ]]; then
	for runner in "${RUNNERS[@]}"; do
		printf '%s\n' "${runner#"$ROOT/"}"
	done
	exit 0
fi

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

color_enabled=0
case "$COLOR_MODE" in
	always) color_enabled=1 ;;
	never) color_enabled=0 ;;
	auto)
		if [[ -n "${FORCE_COLOR:-}" && "${FORCE_COLOR:-0}" != "0" ]]; then
			color_enabled=1
		elif [[ -t 1 && -z "${NO_COLOR+x}" && "${TERM:-}" != "dumb" ]]; then
			color_enabled=1
		fi
		;;
esac

if [[ "$color_enabled" -eq 1 ]]; then
	RED=$'\033[31m'
	GREEN=$'\033[32m'
	CYAN=$'\033[36m'
	BOLD_RED=$'\033[1;31m'
	BOLD_GREEN=$'\033[1;32m'
	RESET=$'\033[0m'
	export FORCE_COLOR=1
	unset NO_COLOR
else
	RED=''
	GREEN=''
	CYAN=''
	BOLD_RED=''
	BOLD_GREEN=''
	RESET=''
	export FORCE_COLOR=0
	if [[ "$COLOR_MODE" == "never" ]]; then
		export NO_COLOR=1
	fi
fi

WORK="$ROOT/output/all-slices"
LOGS="$WORK/logs"
rm -rf "$WORK"
mkdir -p "$LOGS"

passed=()
failed=()
started_at="$SECONDS"

printf "%sPfun V2 complete slice acceptance sweep%s\n" "$CYAN" "$RESET"
printf "Compiler: %s\n" "${BASE_COMPILER#"$ROOT/"}"
printf "Discovered: %s slice runners\n" "${#RUNNERS[@]}"

for runner in "${RUNNERS[@]}"; do
	relative="${runner#"$ROOT/"}"
	name="$(basename "$runner" .sh)"
	log="$LOGS/$name.log"
	slice_started="$SECONDS"

	printf "\n%s== %s ==%s\n" "$CYAN" "$relative" "$RESET"

	if [[ "$OUTPUT_MODE" == "summary" ]]; then
		bash "$runner" "$BASE_COMPILER" >"$log" 2>&1
		rc=$?
	else
		bash "$runner" "$BASE_COMPILER" 2>&1 | tee "$log"
		rc=${PIPESTATUS[0]}
	fi

	elapsed=$((SECONDS - slice_started))
	if [[ "$rc" -eq 0 ]]; then
		passed+=("$relative")
		printf "%sPASS%s -- %s (%ss)\n" "$GREEN" "$RESET" "$relative" "$elapsed"
	else
		failed+=("$relative")
		printf "%sFAIL%s -- %s (exit %s, %ss)\n" \
			"$BOLD_RED" "$RESET" "$relative" "$rc" "$elapsed" >&2
		if [[ "$OUTPUT_MODE" == "summary" ]]; then
			printf "%s--- %s output ---%s\n" "$RED" "$relative" "$RESET" >&2
			cat "$log" >&2
		fi
		if [[ "$FAIL_FAST" -eq 1 ]]; then
			break
		fi
	fi
done

total_elapsed=$((SECONDS - started_at))
summary="$WORK/summary.txt"
{
	printf 'Pfun V2 complete slice acceptance sweep\n'
	printf 'Compiler: %s\n' "${BASE_COMPILER#"$ROOT/"}"
	printf 'Discovered: %s\n' "${#RUNNERS[@]}"
	printf 'Passed: %s\n' "${#passed[@]}"
	printf 'Failed: %s\n' "${#failed[@]}"
	printf 'Elapsed seconds: %s\n' "$total_elapsed"
	printf '\nPassed runners:\n'
	printf '  %s\n' "${passed[@]}"
	if [[ ${#failed[@]} -gt 0 ]]; then
		printf '\nFailed runners:\n'
		printf '  %s\n' "${failed[@]}"
	fi
} > "$summary"

printf "\n%s== Aggregate result ==%s\n" "$CYAN" "$RESET"
printf "%s passed, %s failed, %ss elapsed\n" \
	"${#passed[@]}" "${#failed[@]}" "$total_elapsed"
printf "Logs: %s\n" "${LOGS#"$ROOT/"}"

if [[ ${#failed[@]} -gt 0 ]]; then
	printf "%sFAILED SLICE RUNNERS:%s\n" "$BOLD_RED" "$RESET" >&2
	for runner in "${failed[@]}"; do
		printf "  %s\n" "$runner" >&2
	done
	exit 1
fi

printf "%sALL PFUN V2 SLICE ACCEPTANCE TESTS PASSED%s\n" \
	"$BOLD_GREEN" "$RESET"

#!/usr/bin/env node
// gen-test-harness.js
//
// Annotation-driven test harness generation for Pfun.
//
// Test authors write suites declaratively with annotations and NO main:
//
//   type CryptoInputs = { parts, correctOk, wrongOk }
//
//   //![suite("crypto")]
//   proc cryptoInputs() {
//     let h       = hashPassword("swordfish");
//     let parts   = split(h, ":");
//     let correct = verifyPassword("swordfish", h);
//     let wrong   = verifyPassword("WRONG", h);
//     CryptoInputs { parts, correct, wrong }
//   }
//
//   //![test("hash format")]
//   function testHashFormat(inputs) {
//     assertions([assertEqual(6, length(inputs.parts))]);
//   }
//
// The generator scans annotations and emits `<base>_gen.pf` next to the source:
// the original content plus a generated harness. The harness uses the V1-safe
// shape discovered by experiment:
//
//   - lambda-closing lives in a PURE FUNCTION per suite:
//       function __gen_suite_crypto(inputs) {
//         suite("crypto", [ test("hash format", fn () => testHashFormat(inputs)), ... ])
//       }
//   - the generated proc main() contains effects and pure calls but NO lambdas,
//     dodging V1's fn-lambda-in-proc purity contamination:
//       proc main() {
//         let __in_crypto = cryptoInputs();
//         runSuites([ __gen_suite_crypto(__in_crypto), ... ]);
//       }
//
// Pure suites (no builder proc after the suite annotation) skip the inputs
// threading: tests take zero params and are referenced bare (no lambdas).
//
// Annotation forms (both accepted):
//   //![suite("Name")]   comment form — source file stays valid Pfun (recommended)
//   ![suite("Name")]     bare form — generator comments it out in the emitted
//                        file so line numbers still match the source
//
// Rules:
//   - tests attach to the most recent suite annotation above them
//   - if the declaration right after ![suite] is a proc, it is that suite's
//     inputs builder; its result is passed to every test in the suite
//   - builder-suite tests must take exactly 1 parameter; pure-suite tests 0
//   - annotated files must not define their own `proc main`
//
// Usage:
//   node gen-test-harness.js [--dir tests] [--recursive]
//                            [--runner-import 'import * from "./runner";']
//                            [--orchestrate run-tests.sh --mode compile
//                             --pfun ./pfun.sh --runtime ./pfun-runtime.js --timeout 60]
//
// With --orchestrate, also emits an orchestrator script over exactly the
// generated files (same runner shape as gen-test-runner.js).

const fs = require('fs');
const path = require('path');

// ── args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    dir: 'tests',
    recursive: false,
    runnerImport: 'import * from "./runner";',
    ioImport: 'import * from "io";',
    orchestrate: '',        // output path for orchestrator; empty = skip
    mode: 'compile',
    pfun: './pfun.sh',
    runtime: '',
    timeout: 60,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i];
    else if (a === '--recursive') args.recursive = true;
    else if (a === '--runner-import') args.runnerImport = argv[++i];
    else if (a === '--orchestrate') args.orchestrate = argv[++i];
    else if (a === '--mode') args.mode = argv[++i];
    else if (a === '--pfun') args.pfun = argv[++i];
    else if (a === '--runtime') args.runtime = argv[++i];
    else if (a === '--timeout') args.timeout = parseInt(argv[++i], 10);
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  return args;
}

function printHelp() {
  console.log(`gen-test-harness.js — annotation-driven Pfun test harness generator

  --dir DIR             directory to scan for annotated *_test.pf (default: tests)
  --recursive           scan subdirectories
  --runner-import STR   import line ensuring runSuites is in scope
                        (default: import * from "./runner";)
  --orchestrate FILE    also emit an orchestrator script over the generated files
  --mode MODE           orchestrator: interp | compile (default: compile)
  --pfun PATH           orchestrator: pfun launcher (may be multi-word)
  --runtime PATH        orchestrator compile mode: path to pfun-runtime.js
  --timeout SECS        orchestrator: per-file timeout (default 60, 0 disables)
  -h, --help            this help`);
}

// ── scanning ─────────────────────────────────────────────────────────────────

const ANNOT_RE = /^\s*(\/\/)?!\[\s*(suite|test)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)\s*\]\s*$/;
const DECL_RE  = /^\s*(?:export\s+)?(proc|function)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/;
const MAIN_RE  = /^\s*(?:export\s+)?proc\s+main\s*\(/;

function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const suites = [];           // { name, builder: {name}|null, tests: [{name, fnName, arity}] }
  const errors = [];
  const bareAnnotLines = [];   // line indexes of bare (non-comment) annotations to comment out
  let pending = null;          // an annotation waiting for its declaration
  let current = null;          // current suite

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (MAIN_RE.test(line)) {
      errors.push(`${file}:${i + 1}: annotated test files must not define 'proc main' — the harness is generated.`);
      continue;
    }

    const am = line.match(ANNOT_RE);
    if (am) {
      const isComment = !!am[1];
      if (!isComment) bareAnnotLines.push(i);
      if (pending) {
        // two annotations in a row: a suite annotation followed by a test
        // annotation means the suite is PURE (no builder) — commit the suite.
        if (pending.kind === 'suite' && am[2] === 'test') {
          current = { name: pending.name, builder: null, tests: [], line: pending.line };
          suites.push(current);
          pending = null;
        } else {
          errors.push(`${file}:${pending.line + 1}: annotation was not followed by a matching declaration.`);
          pending = null;
        }
      }
      pending = { kind: am[2], name: am[3], line: i };
      continue;
    }

    const dm = line.match(DECL_RE);
    if (dm && pending) {
      const [, declKind, fnName, params] = dm;
      const arity = params.trim() === '' ? 0 : params.split(',').length;
      if (pending.kind === 'suite') {
        if (declKind === 'proc') {
          if (arity !== 0) {
            errors.push(`${file}:${i + 1}: suite builder '${fnName}' must take no parameters (takes ${arity}).`);
          }
          current = { name: pending.name, builder: { name: fnName }, tests: [], line: pending.line };
        } else {
          // suite annotation directly on a function: treat as a pure suite and
          // fall through — but a suite annotation shouldn't decorate a function.
          errors.push(`${file}:${i + 1}: ![suite] must be followed by a builder proc, or by ![test] annotations for a pure suite. Found function '${fnName}'.`);
          current = { name: pending.name, builder: null, tests: [], line: pending.line };
        }
        suites.push(current);
      } else { // test
        if (!current) {
          errors.push(`${file}:${i + 1}: ![test("${pending.name}")] appears before any ![suite] annotation.`);
        } else {
          if (declKind !== 'function') {
            errors.push(`${file}:${i + 1}: test '${fnName}' must be a pure function, not a proc (test bodies return TestResult as a value).`);
          }
          const want = current.builder ? 1 : 0;
          if (arity !== want) {
            errors.push(`${file}:${i + 1}: test '${fnName}' takes ${arity} parameter(s); suite "${current.name}" ${current.builder ? `has builder '${current.builder.name}' so tests must take exactly 1 (the inputs)` : 'is pure so tests must take 0'}.`);
          }
          current.tests.push({ name: pending.name, fnName, arity });
        }
      }
      pending = null;
      continue;
    }
  }
  if (pending) {
    errors.push(`${file}:${pending.line + 1}: trailing annotation was never attached to a declaration.`);
  }
  for (const s of suites) {
    if (s.tests.length === 0) errors.push(`${file}:${s.line + 1}: suite "${s.name}" has no tests.`);
  }
  return { src, lines, suites, errors, bareAnnotLines };
}

// ── generation ───────────────────────────────────────────────────────────────

function ident(name) {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

function ensureImports(lines, needed) {
  // Insert any missing import lines after the last existing import (or at top).
  const have = new Set(lines.filter(l => /^\s*import\b/.test(l)).map(l => l.trim()));
  const missing = needed.filter(imp => !have.has(imp.trim()));
  if (missing.length === 0) return lines;
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) if (/^\s*import\b/.test(lines[i])) lastImport = i;
  const out = lines.slice();
  out.splice(lastImport + 1, 0, ...missing.map(m => m + ' // added by gen-test-harness'));
  return out;
}

function generateHarness(fileBase, suites) {
  const out = [];
  out.push('');
  out.push('// ─────────────────────────────────────────────────────────────────');
  out.push('// GENERATED TEST HARNESS (gen-test-harness.js) — do not edit.');
  out.push('// Lambda-closing lives in pure functions; the generated main has no');
  out.push('// lambdas, so V1\'s fn-lambda-in-proc purity quirk is never triggered.');
  out.push('// ─────────────────────────────────────────────────────────────────');
  const suiteExprs = [];
  for (const s of suites) {
    const sid = ident(s.name);
    if (s.builder) {
      out.push('');
      out.push(`function __gen_suite_${sid}(inputs) {`);
      out.push(`\tsuite("${s.name}", [`);
      out.push(s.tests.map(t => `\t\ttest("${t.name}", fn () => ${t.fnName}(inputs))`).join(',\n'));
      out.push('\t])');
      out.push('}');
      suiteExprs.push({ s, expr: `__gen_suite_${sid}(__in_${sid})` });
    } else {
      out.push('');
      out.push(`function __gen_suite_${sid}() {`);
      out.push(`\tsuite("${s.name}", [`);
      out.push(s.tests.map(t => `\t\ttest("${t.name}", ${t.fnName})`).join(',\n'));
      out.push('\t])');
      out.push('}');
      suiteExprs.push({ s, expr: `__gen_suite_${sid}()` });
    }
  }
  out.push('');
  out.push('proc main() {');
  for (const { s } of suiteExprs) {
    if (s.builder) out.push(`\tlet __in_${ident(s.name)} = ${s.builder.name}();`);
  }
  out.push(`\trunSuites([${suiteExprs.map(e => e.expr).join(', ')}]);`);
  out.push('}');
  out.push('main();');
  out.push('');
  return out.join('\n');
}

// ── orchestrator emission (same shape as gen-test-runner.js) ────────────────

function shQuote(s) { return "'" + String(s).replace(/'/g, `'\\''`) + "'"; }

// The orchestrator cd's to its own directory, so any relative path in the
// launcher (e.g. "node dist/main.js") would resolve against the test dir
// rather than the caller's CWD. Resolve path-like tokens at generation time.
// A token is path-like if it contains a separator or ends in .js/.sh/.mjs/.cjs
// AND names something that exists relative to the current working directory.
function resolveLauncher(cmd, repoRoot) {
  return String(cmd).split(/\s+/).filter(Boolean).map(tok => {
    const looksPathy = tok.includes('/') || /\.(js|mjs|cjs|sh)$/.test(tok);
    if (!looksPathy) return tok;                 // bare command like `node`
    const abs = path.isAbsolute(tok) ? tok : path.resolve(tok);
    if (!fs.existsSync(abs)) return tok;         // don't mangle flags/unknowns
    // Emit relative to the project root: the script cd's there first, so this
    // stays portable across checkouts instead of baking in an absolute path.
    return path.relative(repoRoot, abs);
  }).join(' ');
}

function generateOrchestrator(args, relFiles, rootUp) {
  const repoRoot = process.cwd();
  const pfunCmd = resolveLauncher(args.pfun, repoRoot);
  const timeoutPrefix = args.timeout > 0 ? `timeout ${args.timeout} ` : '';
  const L = [];

  L.push('#!/usr/bin/env bash');
  L.push('# GENERATED by gen-test-harness.js — do not edit by hand.');
  L.push(`# mode=${args.mode} files=${relFiles.length} generated=${new Date().toISOString()}`);
  L.push('set -u');
  L.push('');
  L.push('output_mode=normal');
  L.push('case "${1:-}" in');
  L.push('  --verbose) output_mode=verbose; shift ;;');
  L.push('  --summary) output_mode=summary; shift ;;');
  L.push('  "") ;;');
  L.push('  *) echo "Usage: $0 [--verbose|--summary]" >&2; exit 2 ;;');
  L.push('esac');
  L.push('if [ "$#" -ne 0 ]; then');
  L.push('  echo "Usage: $0 [--verbose|--summary]" >&2');
  L.push('  exit 2');
  L.push('fi');
  L.push('');
  L.push('if [ "$output_mode" = "verbose" ]; then');
  L.push('  export PFUN_TEST_VERBOSE=1');
  L.push('else');
  L.push('  export PFUN_TEST_VERBOSE=0');
  L.push('fi');
  L.push('');
  L.push('# Color only on an interactive terminal unless explicitly forced.');
  L.push('# FORCE_COLOR overrides NO_COLOR. TERM=dumb disables automatic color.');
  L.push('color_enabled=0');
  L.push('if [ -n "${FORCE_COLOR:-}" ] && [ "${FORCE_COLOR:-0}" != "0" ]; then');
  L.push('  color_enabled=1');
  L.push('elif [ -t 1 ] && [ -z "${NO_COLOR+x}" ] && [ "${TERM:-}" != "dumb" ]; then');
  L.push('  color_enabled=1');
  L.push('fi');
  L.push('');
  L.push('if [ "$color_enabled" -eq 1 ]; then');
  L.push("  RED=$'\\033[31m'");
  L.push("  GREEN=$'\\033[32m'");
  L.push("  YELLOW=$'\\033[33m'");
  L.push("  CYAN=$'\\033[36m'");
  L.push("  BOLD_RED=$'\\033[1;31m'");
  L.push("  BOLD_GREEN=$'\\033[1;32m'");
  L.push("  RESET=$'\\033[0m'");
  L.push('else');
  L.push("  RED=''");
  L.push("  GREEN=''");
  L.push("  YELLOW=''");
  L.push("  CYAN=''");
  L.push("  BOLD_RED=''");
  L.push("  BOLD_GREEN=''");
  L.push("  RESET=''");
  L.push('fi');
  L.push('export PFUN_TEST_COLOR="$color_enabled"');

  // Run from the project root (the directory the generator was invoked from).
  // Not the script's own directory: the compiler mirrors source paths into the
  // output dir, so compiling from a subdirectory makes "$PFUN_HOME/lib/..."
  // imports climb above the output root and write outside it.
  L.push(`cd "$(dirname "\${BASH_SOURCE[0]}")/${rootUp}" || exit 2`);
  L.push('PROJECT_ROOT="$(pwd)"');

  // $PFUN_HOME must be set for "$PFUN_HOME/lib/..." imports to resolve.
  L.push('export PFUN_HOME="${PFUN_HOME:-$PROJECT_ROOT}"');

  if (args.mode === 'compile') {
    const rtRel = args.runtime
      ? path.relative(repoRoot, path.resolve(args.runtime))
      : '';
    L.push(`export PFUN_RUNTIME=${rtRel ? '"$PROJECT_ROOT/' + rtRel + '"' : '""'}`);

    const ioRel = rtRel
      ? path.join(path.dirname(rtRel), 'pfun-io.js')
      : '';
    L.push(`export PFUN_IO=${ioRel ? '"$PROJECT_ROOT/' + ioRel + '"' : '""'}`);
  }

  L.push('');
  L.push('pass=0');
  L.push('fail=0');
  L.push('failed_files=()');
  L.push('');

  L.push('show_full_output() {');
  L.push('  local f="$1"');
  L.push('  local log="$2"');
  L.push('  local status="$3"');
  L.push('  echo');
  L.push('  if [ "$status" = "pass" ]; then');
  L.push('    printf "%s=== %s ===%s\\n" "$CYAN" "$f" "$RESET"');
  L.push('  else');
  L.push('    printf "%s=== %s ===%s\\n" "$BOLD_RED" "$f" "$RESET"');
  L.push('  fi');
  L.push('  cat "$log"');
  L.push('}');
  L.push('');

  L.push('show_pass_summary() {');
  L.push('  local f="$1"');
  L.push('  local log="$2"');
  L.push('  local suites_line');
  L.push('  suites_line="$(grep "^Suites:" "$log" | tail -n 1)"');
  L.push('  if [ -n "$suites_line" ]; then');
  L.push('    printf "%s -- %s%s%s\\n" "$suites_line" "$CYAN" "$f" "$RESET"');
  L.push('  else');
  L.push('    printf "%sPASS%s -- %s%s%s\\n" "$GREEN" "$RESET" "$CYAN" "$f" "$RESET"');
  L.push('  fi');
  L.push('}');
  L.push('');

  L.push('run_one() {');
  L.push('  local f="$1"');
  L.push('  local log');
  L.push('  log="$(mktemp)"');
  L.push('  local rc=0');
  L.push('  local failure_kind=""');

  if (args.mode === 'interp') {
    L.push(`  ${timeoutPrefix}${pfunCmd} "$f" >"$log" 2>&1`);
    L.push('  rc=$?');
  } else {
    L.push('  local base');
    L.push('  base="$(basename "$f" .pf)"');
    L.push('  local outdir');
    L.push('  outdir="$(mktemp -d)"');

    L.push(`  ${pfunCmd} -c "$f" -o "$outdir" >"$log" 2>&1`);
    L.push('  local compile_rc=$?');

    L.push('  if [ "$compile_rc" -ne 0 ]; then');
    L.push('    rc="$compile_rc"');
    L.push('    failure_kind="compile"');
    L.push('    printf "%sCOMPILE FAILED:%s %s\\n" "$BOLD_RED" "$RESET" "$f" >>"$log"');
    L.push('  else');
    L.push('    local js');
    L.push('    js="$(find "$outdir" -name "${base}.js" ! -path "*/lib/*" | head -1)"');

    L.push('    if [ -z "$js" ]; then');
    L.push('      rc=1');
    L.push('      failure_kind="no js"');
    L.push('      printf "%sNO OUTPUT JS:%s %s\\n" "$BOLD_RED" "$RESET" "$f" >>"$log"');
    L.push('    else');
    L.push('      local jsdir');
    L.push('      jsdir="$(dirname "$js")"');

    L.push('      if [ -n "$PFUN_RUNTIME" ]; then');
    L.push('        mkdir -p "$jsdir/lib" "$outdir/lib"');
    L.push('        cp "$PFUN_RUNTIME" "$jsdir/lib/pfun-runtime.js" 2>/dev/null || true');
    L.push('        cp "$PFUN_RUNTIME" "$outdir/lib/pfun-runtime.js" 2>/dev/null || true');
    L.push('        [ -n "$PFUN_IO" ] && {');
    L.push('          cp "$PFUN_IO" "$jsdir/lib/pfun-io.js" 2>/dev/null || true');
    L.push('          cp "$PFUN_IO" "$outdir/lib/pfun-io.js" 2>/dev/null || true');
    L.push('        }');
    L.push('      fi');

    L.push(`      ${timeoutPrefix}node "$js" >>"$log" 2>&1`);
    L.push('      rc=$?');
    L.push('    fi');
    L.push('  fi');

    L.push('  rm -rf "$outdir"');
  }

  L.push('');
  L.push('  if [ "$rc" -eq 0 ]; then');
  L.push('    pass=$((pass+1))');
  L.push('    if [ "$output_mode" = "summary" ]; then');
  L.push('      show_pass_summary "$f" "$log"');
  L.push('    else');
  L.push('      show_full_output "$f" "$log" pass');
  L.push('    fi');
  L.push('  else');
  L.push('    fail=$((fail+1))');
  L.push('    if [ -n "$failure_kind" ]; then');
  L.push('      failed_files+=("$f ($failure_kind)")');
  L.push('    else');
  L.push('      failed_files+=("$f (exit $rc)")');
  L.push('    fi');
  L.push('    show_full_output "$f" "$log" fail');
  L.push('  fi');
  L.push('');
  L.push('  rm -f "$log"');
  L.push('}');
  L.push('');

  for (const f of relFiles) {
    L.push(`run_one ${shQuote(f)}`);
  }

  L.push('');
  L.push('echo');
  L.push('echo "========================================"');
  L.push('printf "Test files: %s%s passed%s, " "$GREEN" "$pass" "$RESET"');
  L.push('if [ "$fail" -eq 0 ]; then');
  L.push('  printf "%s0 failed%s\\n" "$GREEN" "$RESET"');
  L.push('else');
  L.push('  printf "%s%s failed%s\\n" "$RED" "$fail" "$RESET"');
  L.push('fi');
  L.push('if [ "$fail" -ne 0 ]; then');
  L.push('  echo');
  L.push('  printf "%sFailed:%s\\n" "$BOLD_RED" "$RESET"');
  L.push('  for ff in "${failed_files[@]}"; do');
  L.push('    printf "  %s-%s %s\\n" "$RED" "$RESET" "$ff"');
  L.push('  done');
  L.push('  exit 1');
  L.push('fi');
  L.push('printf "%sALL TEST FILES PASSED%s\\n" "$BOLD_GREEN" "$RESET"');
  L.push('exit 0');
  L.push('');

  return L.join('\n');
}

// ── main ─────────────────────────────────────────────────────────────────────

function discover(dir, recursive) {
  const found = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch (e) { console.error(`Cannot read directory '${d}': ${e.message}`); process.exit(1); }
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) { if (recursive) walk(full); }
      else if (ent.isFile() && ent.name.endsWith('_test.pf') && !ent.name.endsWith('_gen.pf')) found.push(full);
    }
  };
  walk(dir);
  found.sort();
  return found;
}

function main() {
  const args = parseArgs(process.argv);
  const files = discover(args.dir, args.recursive);
  if (files.length === 0) {
    console.error(`No *_test.pf files found in '${args.dir}'.`);
    process.exit(1);
  }

  const generated = [];
  let anyErrors = false;

  for (const file of files) {
    const { lines, suites, errors, bareAnnotLines } = scanFile(file);
    if (suites.length === 0) {
      console.error(`  (skip) ${file}: no annotations found.`);
      continue;
    }
    if (errors.length > 0) {
      anyErrors = true;
      for (const e of errors) console.error(`  ERROR ${e}`);
      continue;
    }
    // Comment out bare annotations so the generated file compiles, without
    // shifting line numbers relative to the source.
    const body = lines.slice();
    for (const i of bareAnnotLines) body[i] = '//' + body[i];
    const withImports = ensureImports(body, [args.ioImport, args.runnerImport]);
    const harness = generateHarness(path.basename(file, '.pf'), suites);
    const outPath = file.replace(/\.pf$/, '_gen.pf');
    fs.writeFileSync(outPath, withImports.join('\n') + harness);
    generated.push(outPath);
    const total = suites.reduce((n, s) => n + s.tests.length, 0);
    console.error(`  + ${outPath}  (${suites.length} suite(s), ${total} test(s))`);
  }

  if (anyErrors) {
    console.error('Errors found; fix annotations and re-run.');
    process.exit(1);
  }
  if (generated.length === 0) {
    console.error('Nothing generated.');
    process.exit(1);
  }

  if (args.orchestrate) {
    // Paths are relative to the project root, matching the script's cd above.
    const rel = generated.map(f => path.relative(process.cwd(), path.resolve(f)));
    const scriptDir = path.dirname(path.resolve(args.orchestrate));
    const rootUp = path.relative(scriptDir, process.cwd()) || '.';
    fs.writeFileSync(args.orchestrate, generateOrchestrator(args, rel, rootUp), { mode: 0o755 });
    console.error(`  + ${args.orchestrate}  (orchestrator, mode=${args.mode})`);
  }
}

main();

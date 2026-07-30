#!/usr/bin/env node
// Pfun V2 Completion Specification -- S0 task 5.
//
// Produces a deterministic inventory of every construct the soundness floor
// (S1/S2) and the contract phases (C1-C6) must eliminate or make real:
//
//   * permissive types            TAny, ITAny, TUnknown
//   * field shape representation  FieldMono, FieldCommon
//   * builtin `Any` signatures    the S1 task 4 worklist
//   * unsafe intrinsics           $nthU, $chrU and their ambient bindings
//   * host throw sites            $runtimeError
//   * broad host catches          §6.9 sentinel-rethrow obligations
//   * native error families       declared vs. actually constructed (§7.3)
//
// Output is a function of tracked source only: no timestamps, no absolute
// paths, no environment facts. Two runs on the same tree are byte-identical,
// so a later phase can diff its inventory against the checked-in baseline and
// see exactly which holes it closed.
//
// Environment identity (S0 task 1) is written separately by
// scripts/baseline-environment.sh, because it legitimately varies by machine.
//
// Usage:
//   node scripts/baseline-inventory.mjs              # write baseline/inventory.md
//   node scripts/baseline-inventory.mjs --stdout     # print instead of writing
//   node scripts/baseline-inventory.mjs --check      # fail if it drifted

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const OUT = join(ROOT, "baseline", "inventory.md");

// ── file collection ─────────────────────────────────────────────────────────

// Roots are listed explicitly rather than discovered, so adding a directory is
// a deliberate edit to this file and shows up as an inventory diff.
const ROOTS = [
	{ dir: "src", exts: [".pf"] },
	{ dir: "lib", exts: [".pf"] },
	{ dir: "host", exts: [".js"] },
];

function walk(dir, exts, acc) {
	let entries;
	try {
		entries = readdirSync(join(ROOT, dir));
	} catch {
		return acc;
	}
	for (const name of entries.sort()) {
		const rel = `${dir}/${name}`;
		const st = statSync(join(ROOT, rel));
		if (st.isDirectory()) walk(rel, exts, acc);
		else if (exts.some((e) => name.endsWith(e))) acc.push(rel);
	}
	return acc;
}

// Tests and examples are scanned only for the intrinsic migration worklist.
// They are kept out of the primary set because generated tests embed Pfun
// source as string literals, which would inflate the permissive-type counts
// with occurrences that are data rather than code.
const AUX_ROOTS = [
	{ dir: "test", exts: [".pf"] },
	{ dir: "examples", exts: [".pf"] },
];

const FILES = [];
for (const r of ROOTS) walk(r.dir, r.exts, FILES);
FILES.sort();

const AUX_FILES = [];
for (const r of AUX_ROOTS) walk(r.dir, r.exts, AUX_FILES);
AUX_FILES.sort();

const TEXT = new Map();
for (const f of [...FILES, ...AUX_FILES]) TEXT.set(f, readFileSync(join(ROOT, f), "utf8"));

function lines(f) {
	return TEXT.get(f).split("\n");
}

function isPf(f) {
	return f.endsWith(".pf");
}

// ── extraction helpers ──────────────────────────────────────────────────────

// A hit is {file, line, text}. `text` is trimmed source, kept verbatim so the
// reader can see the role of the occurrence without the tool guessing at it.
function scanWord(word, filter = () => true, files = FILES) {
	const re = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRe(word)}([^A-Za-z0-9_$]|$)`);
	const hits = [];
	for (const f of files) {
		if (!filter(f)) continue;
		lines(f).forEach((text, i) => {
			if (re.test(text)) hits.push({ file: f, line: i + 1, text: text.trim() });
		});
	}
	return hits;
}

function escapeRe(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Comment-only occurrences are noise for a soundness inventory: a keyword in a
// comment cannot ground a field or swallow an exception.
function isComment(hit) {
	return /^(\/\/|\*|\/\*)/.test(hit.text);
}

function partitionComments(hits) {
	return {
		code: hits.filter((h) => !isComment(h)),
		comment: hits.filter(isComment),
	};
}

function countByFile(hits) {
	const m = new Map();
	for (const h of hits) m.set(h.file, (m.get(h.file) ?? 0) + 1);
	return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// ── renderers ───────────────────────────────────────────────────────────────

const out = [];
const push = (s = "") => out.push(s);

function table(headers, rows) {
	push(`| ${headers.join(" | ")} |`);
	push(`|${headers.map(() => "---").join("|")}|`);
	for (const r of rows) push(`| ${r.join(" | ")} |`);
	push();
}

function listing(hits) {
	if (hits.length === 0) {
		push("_none_");
		push();
		return;
	}
	push("```text");
	for (const h of hits) push(`${h.file}:${h.line}: ${h.text}`);
	push("```");
	push();
}

function section(title, hits, note) {
	const { code, comment } = partitionComments(hits);
	push(`### ${title}`);
	push();
	push(`Code occurrences: **${code.length}** (plus ${comment.length} in comments).`);
	push();
	if (note) {
		push(note);
		push();
	}
	if (code.length) {
		table(["File", "Occurrences"], countByFile(code).map(([f, n]) => [`\`${f}\``, n]));
	}
	listing(code);
}

// ── 1. source identity ──────────────────────────────────────────────────────

push("# Pfun V2 baseline inventory");
push();
push(
	"Generated by `node scripts/baseline-inventory.mjs` (Completion Specification S0 task 5). " +
		"Derived from tracked source only, so repeated runs on the same tree are byte-identical. " +
		"Machine-specific identity lives in `baseline/environment.md`."
);
push();
push(`Source files scanned: ${FILES.length}`);
push();

// ── 2. permissive types ─────────────────────────────────────────────────────

push("## 1. Permissive types");
push();
push(
	"§4.1 makes `TAny` and `TUnknown` non-evidence: neither may bind or ground a normal " +
		"field, discharge a class requirement, or appear in a finalized export. Every code " +
		"occurrence below is a site S1 must classify as *removed*, *quarantined to the native " +
		"boundary*, or *recovery taint that must not cascade*."
);
push();

section(
	"`TAny`",
	scanWord("TAny", isPf),
	"Reachable from ordinary user code today via the four builtin signatures in section 3."
);
section("`ITAny`", scanWord("ITAny", isPf), "Interface counterpart; §4.1 rule 7 applies the same rules.");
section(
	"`TUnknown`",
	scanWord("TUnknown", isPf),
	"Recovery taint rather than a dynamic type. §4.1 rule 5: taints a field without binding " +
		"it, and must not emit a second diagnostic when it originated from an earlier failure."
);

// ── 3. field shape representation ───────────────────────────────────────────

push("## 2. Field shape representation");
push();
push(
	"F1 task 4 replaces the type-bearing `FieldMono` with a key-bearing reference, and F2/F3 " +
		"remove the `FieldCommon` path that currently answers `TUnknown` for a union-wide " +
		"common-field access."
);
push();

section("`FieldMono`", scanWord("FieldMono", isPf));
section("`FieldCommon`", scanWord("FieldCommon", isPf));

// ── 4. builtin Any signatures ───────────────────────────────────────────────

push("## 3. Builtin signatures using `Any`");
push();
push("The S1 task 4 worklist. §4.2 replaces each with type-directed cases.");
push();

const anySigs = lines("src/builtins/spec.pf")
	.map((text, i) => ({ file: "src/builtins/spec.pf", line: i + 1, text: text.trim() }))
	.filter((h) => /tAny\(\)/.test(h.text));
listing(anySigs);

// ── 5. unsafe intrinsics ────────────────────────────────────────────────────

push("## 4. Unsafe intrinsics");
push();
push(
	"§6.24 keeps `$nthU` and `$chrU` as compiler-proved lowering intrinsics but removes them " +
		"as ambient user APIs. Each Pfun-level call site below must move to a trusted " +
		"compiler-only namespace or to an explicit verified import."
);
push();

const INTRINSIC_FILES = [...FILES, ...AUX_FILES].sort();

for (const name of ["nthU", "chrU"]) {
	const ambient = scanWord(name, isPf, INTRINSIC_FILES).filter((h) => !isComment(h));
	const host = scanWord(`$${name}`, (f) => !isPf(f), INTRINSIC_FILES).filter((h) => !isComment(h));
	push(`### \`${name}\` / \`$${name}\``);
	push();
	push(`Pfun-level occurrences: **${ambient.length}**. Host-level occurrences: **${host.length}**.`);
	push();
	listing([...ambient, ...host]);
}

// ── 6. host throw sites ─────────────────────────────────────────────────────

push("## 5. Host throw sites (`$runtimeError`)");
push();
push(
	"Every one of these raises a host exception in place of a typed failure. S1/S2 and the " +
		"N phases decide per site whether it becomes a contract violation, a `NativeError`, " +
		"or a statically excluded case."
);
push();

const throwSites = [];
for (const f of FILES.filter((x) => !isPf(x))) {
	const ls = lines(f);
	ls.forEach((text, i) => {
		if (!/\$runtimeError\s*\(/.test(text)) return;
		if (/function\s+\$runtimeError/.test(text)) return; // the definition itself
		// The message may sit on the call line, on the next line for a wrapped
		// call, or be a concatenation. Record it when it is a plain literal and
		// mark it otherwise, so no call site is silently dropped from the count.
		let m = text.match(/\$runtimeError\s*\(\s*"([^"]*)"\s*\)/);
		if (!m && ls[i + 1] !== undefined) m = ls[i + 1].match(/^\s*"([^"]*)"/);
		throwSites.push({ file: f, line: i + 1, message: m ? m[1] : "(non-literal message)" });
	});
}
push(`Total: **${throwSites.length}**`);
push();
table(
	["File", "Sites"],
	countByFile(throwSites).map(([f, n]) => [`\`${f}\``, n])
);
push("Distinct messages:");
push();
push("```text");
for (const msg of [...new Set(throwSites.map((t) => t.message))].sort()) push(msg);
push("```");
push();

// ── 7. broad host catches ───────────────────────────────────────────────────

push("## 6. Broad host catches");
push();
push(
	"§6.9 requires every broad catch to begin with `if ($isInvariantViolation(error)) throw error;` " +
		"before translating into a boundary value. The sentinel does not exist in the baseline, so " +
		"every site is currently unguarded. C2 drives the unguarded count to zero."
);
push();

const catches = [];
for (const f of FILES.filter((x) => !isPf(x))) {
	const ls = lines(f);
	ls.forEach((text, i) => {
		if (!/\bcatch\s*\(/.test(text)) return;
		// Look at the first non-blank line of the handler body for the guard.
		let guarded = false;
		for (let j = i + 1; j < Math.min(i + 4, ls.length); j++) {
			if (ls[j].trim() === "") continue;
			guarded = /isInvariantViolation/.test(ls[j]);
			break;
		}
		catches.push({ file: f, line: i + 1, text: text.trim(), guarded });
	});
}
push(
	`Total: **${catches.length}** — guarded: **${catches.filter((c) => c.guarded).length}**, ` +
		`unguarded: **${catches.filter((c) => !c.guarded).length}**`
);
push();
table(
	["File", "Line", "Site", "Sentinel rethrow"],
	catches.map((c) => [`\`${c.file}\``, c.line, `\`${c.text.replace(/\|/g, "\\|")}\``, c.guarded ? "yes" : "**no**"])
);

// ── 8. native error families ────────────────────────────────────────────────

push("## 7. Native error families");
push();
push(
	"§7.3 requires every reserved family to become real or be removed. *Declared* means listed " +
		"in the builtin union; *registered* means present in the host schema registry; " +
		"*constructed* counts actual `$nativeError(...)` call sites."
);
push();

const allText = FILES.map((f) => TEXT.get(f)).join("\n");
const declared = new Set(
	[...TEXT.get("src/builtins/spec.pf").matchAll(/"(Native[A-Za-z]*Error)"/g)].map((m) => m[1])
);
const registered = new Set(
	[...allText.matchAll(/name:\s*"(Native[A-Za-z]*Error)"/g)].map((m) => m[1])
);
const constructed = new Map();
for (const f of FILES) {
	for (const m of TEXT.get(f).matchAll(/\$nativeError\s*\(\s*"(Native[A-Za-z]*Error)"/g)) {
		constructed.set(m[1], (constructed.get(m[1]) ?? 0) + 1);
	}
}

const families = [...new Set([...declared, ...registered, ...constructed.keys()])]
	.filter((n) => n !== "NativeError")
	.sort();

table(
	["Family", "Declared", "Registered", "Constructed", "Status"],
	families.map((n) => {
		const c = constructed.get(n) ?? 0;
		return [
			`\`${n}\``,
			declared.has(n) ? "yes" : "no",
			registered.has(n) ? "yes" : "no",
			c,
			c > 0 ? "in use" : "**reserved, unused**",
		];
	})
);

// ── 9. summary ──────────────────────────────────────────────────────────────

push("## 8. Regression summary");
push();
push("Counts a later phase can assert against. Every number should fall, none should rise.");
push();

const codeCount = (w) => partitionComments(scanWord(w, isPf)).code.length;
table(
	["Metric", "Baseline"],
	[
		["`TAny` code occurrences", codeCount("TAny")],
		["`ITAny` code occurrences", codeCount("ITAny")],
		["`TUnknown` code occurrences", codeCount("TUnknown")],
		["`FieldMono` code occurrences", codeCount("FieldMono")],
		["`FieldCommon` code occurrences", codeCount("FieldCommon")],
		["Builtin signatures using `Any`", anySigs.length],
		[
			"Pfun-level unsafe intrinsic occurrences (incl. tests/examples)",
			partitionComments(scanWord("nthU", isPf, INTRINSIC_FILES)).code.length +
				partitionComments(scanWord("chrU", isPf, INTRINSIC_FILES)).code.length,
		],
		["Host `$runtimeError` sites", throwSites.length],
		["Broad host catches without sentinel rethrow", catches.filter((c) => !c.guarded).length],
		["Reserved-but-unused native error families", families.filter((n) => !(constructed.get(n) > 0)).length],
	]
);

// ── write ───────────────────────────────────────────────────────────────────

const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
const mode = process.argv[2] ?? "";

if (mode === "--stdout") {
	process.stdout.write(text);
} else if (mode === "--check") {
	let current = "";
	try {
		current = readFileSync(OUT, "utf8");
	} catch {
		console.error(`error: ${relative(ROOT, OUT).split(sep).join("/")} is missing; run without --check first`);
		process.exit(1);
	}
	if (current !== text) {
		console.error("error: baseline inventory is out of date; re-run and review the diff");
		process.exit(1);
	}
	console.log("baseline inventory up to date");
} else {
	mkdirSync(join(ROOT, "baseline"), { recursive: true });
	writeFileSync(OUT, text);
	console.log(`wrote baseline/inventory.md (${FILES.length} source files scanned)`);
}

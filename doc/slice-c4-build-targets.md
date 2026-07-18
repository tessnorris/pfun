# Slice C4 — target-aware build

Slice C4 exposes all three linker targets through the compiler driver:

```text
pfc build <entry.pf>
  [--target node|node-bundle|browser]
  [-o <path>]
  [--page <title>]
```

## Targets

| CLI target | Link target | Default output |
|---|---|---|
| `node` | `NodeFiles` | `build/` |
| `node-bundle` | `NodeBundle` | `pfc.js` |
| `browser` | `BrowserBundle(BarePage)` | `index.html` |

The old command remains compatible:

```text
pfc build app.pf -o app.js
```

It still emits a single Node bundle.

`--page` is accepted only for the browser target. Titles are escaped by the
linker before insertion into the HTML page.

## Driver boundary

All targets still use:

```text
loadGraph
  -> Pipeline.compileProgram
  -> Link.link
  -> write Artifact
```

C4 adds driver support for every existing artifact variant:

- `SingleJs` writes one JavaScript file;
- `FileSet` writes every linker-provided relative path;
- `HtmlPage` writes one HTML file.

The linker remains responsible for module paths and artifact structure.

## Browser host

C4 adds the minimal browser platform host needed by bare browser pages:

- platform-neutral core builtins;
- `print`, `println`, and `flushStdout`;
- JSON, math, and async core mappings.

Node-only procedures and filesystem APIs are deliberately absent. DOM mounting,
TEA event wiring, fetch, serve composition, and playground messaging remain
later slices.

## Acceptance gate

```bash
bash scripts/test-v2-slice-c4.sh
```

## Browser-host exclusion check

The browser integration test checks for structural Node-host markers rather
than rejecting every occurrence of the text `PfunNode`. The significant
markers are the Node attachment wrapper, Node builder, global assignment, and
`node:fs` initialization. This distinguishes an embedded Node host from a
harmless identifier mention in comments, diagnostics, or compatibility code.

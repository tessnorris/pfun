# Pfun V2 standard library

This directory contains ordinary public Pfun V2 modules.

Bare, non-builtin imports without a reserved namespace resolve here:

```pfun
import * as List from "list";
import * as Str from "string";
import * as Toml from "toml";
```

Compiler-internal implementation helpers remain under `bootstrap/src/data`.
The public modules in this directory may delegate to those helpers, but user
programs should import the public facade rather than compiler internals.

Reserved public namespaces are rooted beside this directory:

- `testing/...` → `bootstrap/src/testing/...`
- `browser/...` → `bootstrap/src/browser/...`

The repository-root `lib/` directory is reserved for V1 libraries.

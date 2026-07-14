# Pfun V2 browser libraries

Browser-specific V2 libraries live in this namespace rather than occupying
top-level standard-library names.

Planned imports include:

```pfun
import * as Tea from "browser/tea";
import * as Html from "browser/html";
import * as View from "browser/view";
import * as Theme from "browser/theme";
```

The existing files such as `lib/tea.pf`, `lib/htmllib.pf`, `lib/viewlib.pf`,
and `lib/theme.pf` are V1 libraries and remain under `lib/` until individually
ported to V2.

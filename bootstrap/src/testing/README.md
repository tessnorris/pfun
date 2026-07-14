# Pfun V2 testing library

These modules are a public, namespaced part of the Pfun V2 standard library.

```pfun
import * as Assert from "testing/assertions";
import * as Testing from "testing/testing";
import * from "testing/runner";
```

They live outside `stdlib/` to avoid adding `assertions`, `testing`, and
`runner` as unrelated top-level module names.

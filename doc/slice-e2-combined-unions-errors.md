# Slice E2: combined unions and unified errors

Status: implemented.

## Surface syntax

An include item inside a union body starts with `...` and names another union:

```pfun
type AppError = {
	...FileError
	...JsonError
	| ConfigInvalid: message, code
}
```

The comma after an include is optional. Includes and ordinary variants may be
interleaved.

## Static model

- An included union keeps its nominal identity and owns its constructors.
- Inclusion is directional: a component union widens to its combined union;
  the combined union does not narrow implicitly.
- Inclusion is transitive.
- A combined union's variant set is the flattened union of all included and
  locally declared variants.
- Exhaustiveness checks use that flattened set.
- A field is available on the combined union only when every flattened variant
  has a compatible field of that name.
- Branches, matches, lists, and arrays join component types at their unique
  least combined-union supertype. The join recurses through matching named
  containers such as `Result`.
- Two equally specific join candidates produce a type diagnostic.

Interfaces carry three union views: `unions` for flattened variants,
`ownUnions` for constructors owned by each declaration, and `unionMembers` for
the transitive nominal inclusion closure. This preserves component constructors
across modules while giving inference and exhaustiveness the complete view.

## Rejected declarations and flows

The checker diagnoses:

- unknown included names;
- inclusion of a record or other non-union type;
- duplicate includes;
- duplicate variants after flattening;
- direct or transitive inclusion cycles;
- implicit flow from a combined union back to a component union;
- ambiguous least-upper-bound joins.

## Acceptance coverage

`scripts/test-v2-slice-e2-unions-errors.sh` builds the compiler twice and checks
fixed-point output, runs the complete generated unit suite, executes a
cross-module combined-error program as both a normal and NodeBundle build, and
checks the negative cases above. The canonical tour in `examples/example.pf`
shows a `Result` whose error branches join to one combined application error,
reads its shared `message` field, and handles every flattened variant.

Run the slice directly:

```bash
bash scripts/test-v2-slice-e2-unions-errors.sh
```

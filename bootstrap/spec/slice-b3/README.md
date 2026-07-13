# Slice B3 — typed JSON

B3 turns JSON into a checked Pfun boundary rather than an unchecked JavaScript
object conversion.

## Positive coverage

- scalar, strict-list, record, and union serialization;
- inferred deserialization for directly constrained scalar/list types;
- explicit `jsonDeserializeAs(text, witness)` for nominal records, unions, and other types whose identity cannot be inferred safely;
- nominal record/union reconstruction;
- canonical record field order on serialization;
- wrong nominal targets return `None`;
- malformed JSON returns `None`;
- unknown nominal tags return `None`;
- missing and extra fields return `None`;
- untagged plain objects return `None`;
- function serialization and function-target deserialization return `None`;
- file-backed JSON round trips through the B2 whole-file API.

## Runtime/linker contract

The emitter passes compact static type descriptors to `$jsonSerialize` and
`$jsonDeserialize`. The linker registers all emitted record and variant schemas
before application modules execute. The shared runtime accepts only registered
nominal tags and exact field sets.

Nested nominal fields are checked against their own tags. Full field-type
schemas are a later refinement; the current linker schema records names and
field order but not each field's static type.

## Run

```bash
bash scripts/test-v2-slice-b3.sh
```

The runner checks the compiler fixed point, executes the B3 Node bundle, verifies
its generated JSON file, checks the Option negative diagnostic, and runs the
B2/B1/A regression chain.

# Slice E3 — unified Result

E3 makes the ambient core `Result<Value, Error>` the single two-state result
type used by the active V2 compiler, builtin modules, supported standard
library, and applications. Packages declare domain error unions and place them
in `Result`'s error slot instead of declaring collision-avoidance wrappers such
as `FileResult` or private `Ok`/`Err` copies.

The positive fixture composes two package-level error unions through a combined
`StageError`, then maps and matches the shared core `Result` across module
boundaries. The negative fixture proves that the file module's specialized
three-state `ReadResult` no longer aliases core constructors: streaming reads
must use `ReadOk`, `ReadEof`, and `ReadErr`.

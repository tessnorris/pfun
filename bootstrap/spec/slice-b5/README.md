# Slice B5 — pure TOML subset

B5 replaces the old V1-era `lib/toml.pf` implementation with an ordinary,
pure Pfun V2 library.

## API

```text
tomlParse : Str -> Result<List<SettingGroup>, Str>
tomlEmit  : List<SettingGroup> -> Str
```

The exported data model is:

```text
SettingValue =
  SStr(value)
  | SInt(value)
  | SFloat(value)
  | SBool(value)
  | SList(items)

Setting = { key, value }
SettingGroup = { name, settings }
```

## Supported subset

- top-level keys;
- `[section]` headers;
- quoted strings with `\"`, `\\`, `\n`, and `\t`;
- signed decimal integers;
- signed decimal floats;
- booleans;
- homogeneous inline scalar arrays;
- comments and blank lines.

Unsupported or malformed syntax returns `Err`:

- dotted keys;
- dates and times;
- inline tables;
- nested arrays;
- mixed-type arrays;
- missing delimiters;
- duplicate keys or sections;
- unsupported string escapes.

## Acceptance coverage

- successful parse;
- canonical emission;
- parse → emit → parse equality;
- file-backed write/read/parse equality through B2;
- malformed-input cases for each unsupported/error category;
- compiler fixed point;
- complete B4 → B3 → B2 → B1 → A regression chain.

## Run

```bash
bash scripts/test-v2-slice-b5.sh
```

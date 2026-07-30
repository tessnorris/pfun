# Testing Pfun V2

Run the complete acceptance history from the repository root:

```sh
scripts/test-v2-all-slices.sh
```

The runner discovers every `scripts/test-v2-slice-*.sh` file automatically in
natural version order. Adding a slice therefore requires adding its individual
runner; the complete sweep includes it without a second manifest update.

Color is enabled automatically on an interactive terminal. `FORCE_COLOR=1` or
`--color` forces it for redirected output and CI; `NO_COLOR=1` or `--no-color`
disables it. For compact CI output, use:

```sh
scripts/test-v2-all-slices.sh --summary --color
```

The default compiler is `boot/pfc.js`. Override it when validating a candidate
bootstrap:

```sh
scripts/test-v2-all-slices.sh --compiler output/candidate/pfc.js
```

Every slice retains its complete log beneath `output/all-slices/logs/`, and the
aggregate result is written to `output/all-slices/summary.txt`. The default
behavior continues after a failure so the summary reports every broken slice;
use `--fail-fast` while iterating locally.

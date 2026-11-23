## Themate

An enterprise theme for Frappe 15 — a dense, Ant Design-inspired Desk skin built
on design tokens and Frappe's own CSS variables, with no Desk template forks.

### Documentation

| File | What it is |
| --- | --- |
| [`DESIGN_CONTRACT.md`](DESIGN_CONTRACT.md) | The frozen visual contract: palette, density, radius, spacing, interaction states, rollback scoping. **The authority on visual values.** |
| [`FRAPPE_UI_MAP.md`](FRAPPE_UI_MAP.md) | Every integration point, verified against Frappe 15.121.0 source: surface → native file → selector → lifecycle → owning module. Also records the current-state findings this rebuild fixed. |
| [`COVERAGE.md`](COVERAGE.md) | Per-surface status, what was and was not verified, known limitations, and next steps on a real bench. |
| [`tests/README.md`](tests/README.md) | How to run the cascade-contract and adapter test suites. |

`THEMATE_SAAS_UI_PLAN.md` and `EXECUTION_PROMPT.md` are earlier planning
documents, kept for history and annotated where they are superseded.

### Architecture

Three layers, in this order:

1. **Tokens** (`public/scss/tokens/`) — the design vocabulary. Raw colour values
   are permitted only in `_palette.scss` and `_dark.scss`.
2. **Bridge** (`tokens/_bridge.scss`) — maps verified native Frappe CSS
   variables onto the tokens. One assignment here restyles every native
   component that already consumes that variable.
3. **Components** (`public/scss/components/`, `layout/`) — only the structure
   the bridge cannot express. Each file names the native source it targets.

Dark mode redefines tokens only; the bridge is mode-independent and re-resolves
on its own. Theme state is Frappe's — `data-theme-mode` and `data-theme`, via
`frappe.ui.set_theme()`. Themate does not invent a parallel attribute.

### Building

```bash
bench build --app themate
bench --site <site> clear-cache
bench restart          # required if hooks.py changed
```

### The theme looks like stock Frappe?

That means it is not loading, not that it is styled badly. Black primary buttons
are Frappe's own `--btn-primary: var(--gray-900)`; the theme would make them
blue. Run:

```bash
bench --site <site> execute themate.diagnostics.run
```

It checks, in order, every layer that has to be true for a single pixel to
change — app installed, assets built, hooks registered, master flag on, boot
payload readable — and prints the fix for whichever one is broken.

### Tests

```bash
cd tests
npm install
npm test
```

Dev-only, and kept out of the app root on purpose: Frappe's esbuild runs
`yarn build` in any app whose root `package.json` declares a `build` script.
The app itself has no npm dependencies.

`npm run test:build` compiles the bundles with Frappe's own toolchain
(esbuild 0.14 + legacy-API sass + postcss), which is a stricter check than
running `sass` directly — see `tests/README.md`.

#### License

mit

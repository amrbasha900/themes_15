# Themate tests

Focused coverage for the things that actually break: the CSS cascade contract
and the pure logic inside the JS adapters. Deliberately **not** covered: rules
that merely restate a token value, or anything that would claim coverage from a
successful build.

## Requirements

Dev-only, and deliberately **not** at the app root. Frappe's esbuild runs
`yarn build` inside any app whose `package.json` declares a `build` script
(`frappe/esbuild/esbuild.js:447`), and a `package.json` at an app root also
invites `yarn install` to pull these dev dependencies onto a production bench.
The Frappe app itself has no npm dependencies.

```bash
cd tests
npm install
```

Chromium: the tests use `PLAYWRIGHT_CHROMIUM` if set, else Playwright's own
resolution. On a bench where Chromium is preinstalled, point it at that binary.

## Running

```bash
cd tests
npm test                  # all eighteen suites
npm run test:flags        # feature-flag resolution (Python, no bench, no browser)
npm run test:linked-fields # what a list may filter by, one link away (Python, no bench)
npm run test:palette      # ramp generator pinned to the SCSS (no browser)
npm run test:build        # builds with FRAPPE's toolchain, not dart-sass alone
npm run test:css          # cascade contract
npm run test:js           # adapter logic
npm run test:icons        # sprite-swap fallout, read from rendered pixels
npm run test:form-tabs    # the Connections tab against the form's real setup order
npm run test:list-row     # list row geometry, measured not asserted by selector
npm run test:page-head    # page head stays one line; buttons go to ⋯ only when they must
npm run test:loading      # placeholder timing + the skeleton CSS contracts
npm run test:calendar     # Calendar Layout lines, weekend hiddenDays, extra fields
npm run test:flicker      # page changes that must not paint a blank or a flash
npm run test:linked-filters # linked-document filters against Frappe's own filter classes
npm run test:list-pager   # the paging row on a phone, measured, with and without :has()
npm run test:form-panel   # the record panel folds to a rail; follows the page head on scroll
npm run test:integration  # CSS + bootstrap + picker together
```

## Why `test:build` exists

`sass in.scss out.css` proves the SCSS is valid Sass. It does **not** prove
`bench build --app themate` will succeed, because Frappe compiles through
esbuild 0.14 with a legacy-API sass plugin, its own `sassOptions`, its
`ignore-assets` resolver, then postcss and autoprefixer. A stylesheet can be
valid Sass and still fail there — for example every `@font-face` src fails to
resolve without Frappe's `ignore-assets` plugin, because esbuild tries to bundle
`/assets/...` as a module.

This suite reproduces that pipeline with the versions frappe/package.json pins,
and asserts the guard selector, `:has()` and logical properties all survive it.

## Why `test:flags` exists

A Check field on a loaded Single can never read back as `None` —
`BaseDocument._fix_numeric_types` cint()s every one of them — so a
`is not None` guard on a document silently turns a newly added flag off on every
existing site. This suite reproduces Frappe's coercion faithfully; it needs
neither a bench nor a browser.

## Why `test:flicker` exists

Flicker is a sequence of paints, so it was found by recording one frame per
paint of a real desk (Chrome's screencast) and reading them in order — a
blank page between a list and its form, the sidebar drawn twice, Frappe's
grey `#freeze` layer fading over the desk for every lazy bundle, a skeleton
pushed below the fold by an empty editor. Each is pinned here the way it can
be: timing against the clock (the form page is switched to only together with
its outline), markup against the real files on mocks of Frappe's shapes, and
the rest against the built CSS. A new decoration that runs after a paint
(a `setTimeout` after `page-change`, a rebuild on a route event) is the thing
to check against this list.

## Why `test:integration` exists

Three real bugs shipped past the first two suites because each of those
exercises **one layer alone** — a stylesheet with no JavaScript, or JavaScript
with no stylesheet. Every one of the three was an interaction:

1. bootstrap overrode the user's saved Dark choice with the site default;
2. bootstrap's inline brand styles outranked the dark-mode CSS;
3. the accent picker and bootstrap resolved the current colour differently.

`test:integration` loads the compiled bundle, the palette module, bootstrap and
the theme switcher together, drives them with boot payloads shaped like the real
`frappe.boot.themate`, and pins each regression by name. When adding a test for
anything that spans CSS and JS, it belongs here — not in the single-layer
suites.

One trap worth knowing: a boot payload in a test must include `default_mode`,
`brand_color` and `flags`, because `themate/api.py` always supplies them. An
earlier test passed `{}` and "proved" a precedence rule against a payload that
can never occur.

## What `test:palette` proves

It reads the expected ramps **out of** `tokens/_palette.scss` and
`tokens/_dark.scss` and asserts the runtime generator reproduces them exactly,
so the CSS and the JS cannot drift apart silently. Change a stop in either place
without the other and this fails. It needs no browser.

## What `test:css` proves

It compiles `themate.bundle.scss` and asserts **computed** styles in a real
browser against a stand-in DOM whose structure is copied from the verified
Frappe sources listed in `FRAPPE_UI_MAP.md` §3.

It therefore proves that the token layer, the Frappe variable bridge, dark-mode
switching via the native `data-theme` attribute, the `data-tm-*` feature-flag
rollback, and the density and radius presets all resolve as the design contract
says they should.

**It does not prove the theme looks right on a real Frappe site.** The DOM is a
stand-in, Frappe's own stylesheet is only approximated, and no real data, RTL
text or Desk JS is involved. Visual acceptance still requires a running bench —
see `COVERAGE.md`.

## Note on transitions

`.btn` transitions `background-color` over 100 ms. A computed-style read taken
immediately after flipping `data-theme` returns the interpolated start value,
not the target. The suite settles after every attribute change; a "colour did
not update" failure is usually a missing settle, not a cascade bug.

## tools/build_icons.py

Generates `themate/public/icons.svg` (the Themate Business icon set) from the
definitions in the script. Edit the script, run `python3 tests/tools/build_icons.py`,
then `bench build --app themate`. The sprite header says the same.

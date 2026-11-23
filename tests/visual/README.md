# Visual acceptance capture

`capture.js` drives a **real Frappe site** through the acceptance route and saves
the full matrix. It cannot run in CI or in a sandbox — it needs a live bench with
Themate installed, which is exactly the gap the automated suites cannot close.

## Route and matrix

**Route:** List → Form → Child Grid → Dialog, 10 shots per run:

| # | Shot | Why it is in the route |
| --- | --- | --- |
| 1 | `list` | row height, density, column alignment |
| 2 | `list-filters` | filter chips and control heights against adjacent inputs |
| 3 | `list-row-selected` | selected must differ from hover — the contract requires it |
| 4 | `form-new` | empty form: labels, required markers, section structure |
| 5 | `form-populated` | real data, long labels, mixed scripts |
| 6 | `child-grid` | the grid is a *separate* implementation from the list |
| 7 | `child-grid-row-editor` | inline editing must not change row height |
| 8 | `dialog` | modal surface, control alignment inside it |
| 9 | `dialog-validation` | error border + error text, not colour alone |
| 10 | `dialog-autocomplete` | dropdown layering inside a modal — a classic clipping bug |

**Matrix:** {English, Arabic} × {Light, Dark} × {1366×768, 1440×900} = 8 runs,
80 screenshots.

Language and theme are set through the API and the page is reloaded, so the boot
path is genuinely exercised. Setting them client-side would skip the very code
these fixes touch.

**On Arabic:** setting `User.language = "ar"` flips the layout, because Frappe's
`is_rtl()` checks `lang in ["ar", "he", "fa", "ps"]` and `www/app.py` renders
`dir="rtl"` from it. Whether the *labels* are Arabic depends on whether Arabic
translations are installed on that site. If they are not, the direction still
flips and the RTL layout is still worth reviewing — but the shots will show
English text in an RTL layout, which does not exercise Arabic glyph metrics or
line height. `manifest.json` records the resolved `dir` per run so this is
visible rather than assumed.

## Running

```bash
npm install
npm run capture -- \
  --url http://site.local:8000 \
  --user Administrator \
  --password "$FRAPPE_PASSWORD"
```

Useful flags:

| Flag | Default | Notes |
| --- | --- | --- |
| `--list-doctype` | `ToDo` | any populated list |
| `--form-doctype` | `User` | **must have an editable child table.** `User` ships with Frappe and has Roles. With ERPNext installed, prefer `--form-doctype "Sales Invoice"` for a realistic dense document. |
| `--out` | `tests/visual/shots` | output directory |
| `--channel` | — | use a browser already on the host (`chrome`, `msedge`, `chromium`) instead of Playwright's download |

### Getting a browser to run

Playwright downloads a browser binary but **not** the system libraries it links
against, and a stock Frappe bench usually lacks them. The symptom is a wall of
Chromium flags with `error while loading shared libraries: libnspr4.so` buried
in it; the script detects that and prints the fix instead.

Pick whichever fits the host:

| Situation | Do this |
| --- | --- |
| You have root on the bench | `sudo npx playwright install-deps chromium` |
| No root, but Chrome or Chromium is already installed | `npm run capture -- --channel chrome …` or `PLAYWRIGHT_CHROMIUM=/usr/bin/chromium npm run capture -- …` |
| No root and no browser on the bench | Run the capture **from your own machine** against the bench's URL — nothing has to be installed on the server. Clone the repo locally, `npm install`, then `--url http://<bench-ip>`. |

The manual package list, if `install-deps` is unavailable:

```bash
sudo apt-get update && sudo apt-get install -y   libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0   libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libpango-1.0-0   libcairo2 libasound2t64 libx11-6 libxcb1 libxcomposite1 libxdamage1   libxext6 libxfixes3 libxkbcommon0 libxrandr2
```

Use `libasound2` instead of `libasound2t64` before Ubuntu 24.04.

`PLAYWRIGHT_CHROMIUM` overrides the browser binary if the bench has its own.

The site URL takes any host and port, including a bare LAN address:
`--url http://172.24.238.166`.

### A note on the login page

`themate/www/login.html` renders the login fields **twice** — once in Frappe's
original macro and once in the themate split-screen block — so `#login_email`,
`#login_password` and `.btn-login` each match two elements. Every locator in the
login step is filtered to the visible copy; a bare `page.fill()` would fail with
a Playwright strict-mode violation. The same applies to the route: a list has
many `.list-row-checkbox` elements and a grid many `.btn-open-row`, so those
clicks target the first match and log a skip rather than failing silently.

## Output

```
tests/visual/shots/
  <language>-<theme>-<viewport>/NN-<step>.png
  manifest.json
```

`manifest.json` records the site, timestamp, app versions, the resolved
`data-theme` / `data-theme-mode` / `dir` per run, the `frappe.boot.themate`
payload, and **console errors per run**. That last one matters: capture a
baseline with the theme disabled and diff the error lists, so theme-introduced
errors are separated from pre-existing ones.

## Reviewing the output

Judge against `DESIGN_CONTRACT.md`, not against taste:

1. **Arabic first.** It is the least-verified area. Check mixed Arabic/English in
   one line, currency amounts, dates, and document IDs — these must read LTR
   inside RTL text without reversing.
2. **Alignment.** Every control on one row should share a height and a baseline.
3. **Selected vs hover** on list rows must be visibly different.
4. **Nothing clipped.** The dialog autocomplete shot is there specifically to
   catch a dropdown cut off by a modal's overflow.
5. **Dark mode is not just inverted.** Surfaces should lift off the background;
   the accent should stay legible.

Keep the first run as the baseline and compare later runs against those files,
not against recollection.

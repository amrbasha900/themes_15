# Themate visual contract

Frozen for this implementation. Component SCSS consumes the semantic tokens in §3 only; raw values
live in `tokens/_palette.scss` and `tokens/_semantic.scss` (light) and `tokens/_dark.scss` (dark).

## 1. Intent

Readable data first. Clear hierarchy, predictable alignment, compact controls, stable interaction
states. Neutral surfaces with **one** primary accent. Secondary actions are neutral, not a second
hue. Status colours keep their semantic meaning and are never reused for decoration.

## 2. Reference status — read this before judging the result

The values below are the **project's own contract**, taken from the implementation brief's suggested
starting values. They are Ant-Design-*inspired*: the accent ramp and the 4px/6px radius pair follow
Ant Design 5's documented defaults, and the density follows its compact algorithm's intent.

**This is not a claim of pixel parity with Ant Design.** No Ant Design page was opened, captured or
diffed during this work, and no Frappe page was rendered to compare against one. The brief's three
required visual references — a dense list with filters, a form with a child table, an open
dialog/select — are **not yet pinned to captured screenshots**; doing so needs a browser, which this
environment does not have. Intended references, to be pinned and captured before visual acceptance:

- `https://ant.design/components/table` — dense list with filters
- `https://ant.design/components/form` + `https://ant.design/components/table#components-table-demo-edit-row` — form with editable child rows
- `https://ant.design/components/modal` + `https://ant.design/components/select` — dialog and select

Pin the exact Ant Design release (5.x) and archive the screenshots at that point, per brief §3.

## 3. Token contract

### Colour — accent

| Role | Value | Notes |
| --- | --- | --- |
| Primary | `#1677ff` | the single accent |
| Primary hover | `#4096ff` | lighter on hover |
| Primary active/pressed | `#0958d9` | darker on press |
| Selected background | `#e6f4ff` | **must stay distinct from row hover** |
| Focus ring | `rgb(5 145 255 / 0.10)`, 3px outer | never removed without replacement |

Ramp `--tm-brand-50 … 900` is generated around `#1677ff`; steps 400/500/600 are the hover/base/active
triple above, so runtime brand overrides keep the same relationships.

### Colour — neutral

| Role | Value |
| --- | --- |
| App background | `#f5f5f5` |
| Surface | `#ffffff` |
| Sunken (filled control) | `#fafafa` |
| Hover (neutral row/item) | `#fafafa` |
| Primary text | `#1f1f1f` |
| Secondary text | `#595959` |
| Tertiary / placeholder | `#707070` (amended 2026-11-01: `#8c8c8c` was 3.36:1 on white) |
| Input border | `#d9d9d9` |
| Subtle divider | `#f0f0f0` |

### Colour — status

| Role | Text | Background |
| --- | --- | --- |
| Success | `#389e0d` | `#f6ffed` |
| Warning | `#d46b08` | `#fffbe6` |
| Danger | `#cf1322` | `#fff2f0` |
| Info | `#0958d9` | `#e6f4ff` |

### Typography

| Role | Value |
| --- | --- |
| Base | 14px |
| Dense / table / control | 13px |
| Metadata only | 12px |
| Weights | 400 regular, 500 medium, 600 semibold |
| Latin | bundled `InterVariable` (woff2, already in `public/fonts/`) |
| Arabic | bundled `Cairo` (ttf, already in `public/fonts/`) |
| Line height | 1.5 body, 1.4 dense rows |

No CDN. No global `h1`–`h6`/`p` restyling — headings are scoped to the surfaces that own them.

### Dimension

| Property | Comfortable | Compact |
| --- | --- | --- |
| Control height | 32px | 28px |
| List row | 36px | 32px |
| Topbar | 48px | 44px |
| Sidebar / rail | 216px / 56px | 216px / 56px (narrowed 2026-09-16 to the design rail) |

Control height applies identically to inputs, selects and buttons that sit on the same row — this is
the single most visible alignment rule in the theme.

### Radius

| Scope | Value |
| --- | --- |
| Controls (input, button, checkbox, pill) | 4px |
| Panels, cards, dialogs, dropdown menus | 6px |

`sharp` and `round` presets shift both by the same step and keep the 4/6 relationship.

### Spacing

`4 / 8 / 12 / 16 / 24` px. Any other value is a documented exception.

### Elevation

Restrained, and only on surfaces that actually float: dropdown menu, autocomplete list, popover,
tooltip, dialog, toast. Cards and list rows get a border, not a shadow.

## 4. Interaction states — all required, one accent is not enough

| State | Treatment |
| --- | --- |
| Hover | neutral `#fafafa` fill; never the accent |
| Selected | `#e6f4ff` fill + accent left/inline-start marker where a row supports it |
| Active / pressed | one step darker than hover |
| Focus | 3px accent ring, visible in both modes; `:focus-visible` preferred |
| Disabled | `#f5f5f5` fill, `#8c8c8c` text, `not-allowed` cursor |
| Readonly | **amended 2026-09-16:** rendered as a disabled control — `#fafafa` fill, `#d9d9d9` border, secondary text. Bare text was indistinguishable from a label ("Abbr" / "ZG") and said nothing about editability. Link values keep the link colour. |
| Invalid | danger border + danger help text; never colour alone |
| Loading | reduced opacity + wait cursor; layout must not shift |

## 5. Scope and rollback

Two levels, because they can honestly deliver two different things.

**Master switch — a real rollback.**

| Attribute on `<html>` | Effect |
| --- | --- |
| `data-tm-enabled="off"` | The entire theme is gone: tokens, the Frappe variable bridge and every component rule. Stock Frappe returns, colours included. |

Driven by `Enable Theme` in Theme Settings, and implemented as one guard selector
in `scss/tokens/_guard.scss` that scopes every file that paints. When off,
`core/bootstrap.js` also forces every area flag off, emits no brand stylesheet
and writes no font override, so nothing survives on the document either.

**Per-area switches — structure only.**

| Attribute on `<html>` | Guards |
| --- | --- |
| `data-tm-list="on"` | List View, filters, indicators in list context |
| `data-tm-form="on"` | Form layout, controls, child grid, timeline |
| `data-tm-navbar="on"` | Navbar |
| `data-tm-sidebar="on"` | Sidebar |

These remove an area's structural rules — padding, borders, heights — and leave
the palette alone. They cannot do more, and that is a property of Frappe rather
than a shortcut taken here: `--primary`, `--bg-color`, `--border-color` and the
rest are defined on `:root` and consumed globally, so no per-area selector can
give the List View back its native colours without taking them from the Form at
the same time. Restoring the palette is what the master switch is for.

## 6. Density and direction

- Density switches `data-tm-density="compact"|"comfortable"` and changes only the §3 dimension rows.
- Density is never achieved by zoom, `transform`, sub-12px text, hidden fields or truncated labels.
- Direction uses logical properties (`margin-inline-*`, `inset-inline-*`, `border-inline-*`)
  throughout Themate's own rules. Native Frappe's physical properties are corrected explicitly in
  `layout/_rtl.scss`, which is a correction layer, not a mirror of the whole theme.
- Below 768px, touch spacing takes over: controls return to 32px and row padding grows.

## 7. Amendments from the first bench session (2026-09-16)

Recorded here because §1–§5 were written without a browser; these were settled on screen.

| Surface | Treatment |
| --- | --- |
| Sidebar active item | brand-50 tint, 3px brand-500 bar on the start edge, brand-600 text and icon. Not a solid fill: white-on-brand failed contrast on light brands (`#81a103`, `#90a617`). Parent of an active child gets brand text only. |
| Status pills (`.indicator-pill`) | tinted ground + 6px dot + coloured text, no outline, in list and form alike. |
| Form section header | a bar across the card (`#fafafa`, rule beneath while open); when collapsed the bar is the card. |
| Form sidebar rows | Assigned To / Attachments / Tags / Share divided by 1px rules; "+" in the accent. |
| Link / Dynamic Link fields | chevron at the end, so a picker reads as a picker. |
| Content links | `--tm-text-link` (brand-600), underline on hover: `.control-value a`, comments, timeline, help text, widget bodies. Navigation chrome keeps its own treatment. |
| Breadcrumbs | parents `--tm-text-2`, current page `--tm-text` medium, 13px. |
| Document name | shown under the title (`page.js` looks for an `h6` that `page.html` no longer has; `core/page_subtitle.js` re-points it). |
| Font size | `--tm-font-scale` multiplies the whole type ramp and, through the bridge, Frappe's `--text-*`. Presets small 0.92 / default 1 / large 1.08 / extra-large 1.16. Site default in Theme Settings, per-user override in the theme switcher. |
| Full width | `body.full-width .container` is 100%, not Frappe's 90% (which, next to a fixed sidebar, was narrower than the default cap). |
| Icons | Themate Business duotone set (`public/icons.svg`): 24-grid, line layer `currentColor`, tint layer `currentColor` at `--tm-icon-tint` (0.18; 0 = Outline), weight `--tm-icon-stroke` (1.5 / 1.75 / 2), size `--tm-icon-size` (18px default, 12–28), colour inherits or brand-600. Every workspace/shortcut icon name resolves to this set first. |
| Personalisation | The Theme Customizer owns per-user: mode, accent, font family, base font size (px), corners, density, icon style + size, sidebar state. Site defaults live in Theme Settings; a user preference always wins for that user. |
| Navbar | Language switcher (globe + code) and Theme Customizer button sit before the user menu, same 32px footprint as Frappe's items. |
| Dark mode neutrals | **amended 2026-09-16:** slate-navy, not flat black — ground `#141b2b`, surface `#1c2536`, raised `#232e42`, sunken `#171f30`, hover `#263248`, border `#2f3b52` / strong `#3f4d68`, text `#e6ebf5` / `#aab4c8` / `#8d98af` (lifted 2026-11-01: the first values felt heavy) (solid, not white-at-opacity). Pure `#000` with `#141414` cards read as switched-off and had no depth. |
| Workspace layout | 12-column grid: shortcut tiles span 2 (84px min, equal per row), chart 8 + set-up card 4 (set-up alone: span 12 in Frappe's two-column layout), link groups 4, number cards 3, headers 12. |
| Overview picture | Frappe's own image block adopted into the 72px picture box: click → Upload / Remove (native handlers); module icon behind it until a photo exists; camera badge marks it clickable. |
| Dialogs | `.modal-body` no longer clips (`overflow: visible`, no max-height) — autocompletes and date pickers extend past it; `modal-sm/lg/xl` keep Bootstrap widths, 640px applies only to the default size. |
| Page head | on the ground (`--tm-surface-app`), no rule; white 44px icon tile; title `--tm-text` 20px (Home: the greeting at 1.2×, on a soft band), sub-line / count `--tm-text-2` 13px. |
| Text styles | per element (title, subtitle, section, tab, label, body, menu): size 10–40px, weight 400–700, italic, colour — user over site over contract. Body size drives `--tm-font-scale`. |
| Charts | ECharts through the Frappe Charts option shape. Series `--tm-chart-1..8` (brand, teal, gold, violet, green, rose, orange, geekblue; lighter in dark). Bars ≤ 40px, 38% category gap, top corners rounded; axis text `--tm-text-2` 11px; grid `--tm-border`; tooltip on `--tm-surface-raised`. |

# Frappe UI Map — verified integration points

**Verification basis.** Every selector, CSS variable and lifecycle hook below was read from
Frappe source at `frappe/frappe@version-15`, **version 15.121.0** (commit `4fa1b14`), cloned
for this audit. Nothing here is inferred from documentation or from the previous plan documents.

> **Version caveat.** `EXECUTION_PROMPT.md` claims the target bench runs Frappe **15.111.1** at
> `/home/frappe/frappe-bench` on site `site.local`. **No bench, no `bench` CLI and no `frappe`
> Python package exist in this environment** — that claim could not be verified and the site could
> not be inspected. The map was therefore built against the `version-15` branch tip. The variables
> and selectors used below are long-lived Frappe 15 API surface, but **re-verify against the
> deployed version before accepting the theme visually.**

## 0. How Themate's assets reach the Desk

| Step | Verified source | Consequence for Themate |
| --- | --- | --- |
| `hooks.get("app_include_css")` merges per installed app, framework first | `frappe/www/app.py:48` | `themate.bundle.css` loads **after** `desk.bundle.css`. Equal-specificity overrides win on order alone — `!important` is not needed for that. |
| Same for JS | `frappe/www/app.py:47` | `themate.bundle.js` runs after Frappe's desk bundle is parsed, but **before** `frappe.ready`/app boot completes. |
| `<html data-theme-mode="{{ desk_theme.lower() }}" data-theme="{{ desk_theme.lower() }}">` | `frappe/www/app.html:2` | Both theme attributes are **server-rendered**. There is no flash-of-wrong-theme to fix, and client code must not fight the server value. |
| `desk_theme` = `boot.desk_theme or "Light"` | `frappe/www/app.py:66` | Source of truth is the **User.desk_theme** field, not Themate's own settings. |
| `frappe.boot = {{ boot | json }}` inline in the template | `frappe/www/app.html` | `extend_bootinfo` payload (`frappe.boot.themate`) is available synchronously before Themate's bundle runs. Verified against `themate/boot.py:4`. |

## 1. Theme state — the single most important correction

Frappe uses **two** attributes on `document.documentElement`, verified in
`frappe/public/js/frappe/ui/theme_switcher.js`:

| Attribute | Meaning | Values | Set by |
| --- | --- | --- | --- |
| `data-theme-mode` | the user's *choice* | `light` / `dark` / `automatic` | server (`app.html:2`), `toggle_theme()` (`theme_switcher.js:129`) |
| `data-theme` | the *effective* theme actually rendered | `light` / `dark` | server (`app.html:2`), `frappe.ui.set_theme()` (`theme_switcher.js:162`) |

```js
// theme_switcher.js:154-163 — verbatim resolution logic
frappe.ui.set_theme = (theme) => {
    const root = document.documentElement;
    let theme_mode = root.getAttribute("data-theme-mode");
    if (!theme) {
        if (theme_mode === "automatic") {
            theme = frappe.ui.dark_theme_media_query.matches ? "dark" : "light";
        }
    }
    root.setAttribute("data-theme", theme || theme_mode);
};
```

All Frappe dark styling keys off `[data-theme="dark"]` (`frappe/public/scss/desk/dark.scss`), and
`:root, [data-theme="light"]` carries the light defaults (`common/css_variables.scss:4-5`).

**Defect (confirmed).** `core/bootstrap.js:127` writes `root.dataset.tmMode`, i.e. `data-tm-mode`,
while `tokens/_dark.scss:3` targets `[data-theme="dark"]`. The two never meet, so selecting Dark in
Themate's own settings changes nothing. `resolveMode()` also emits `light`/`dark` from `Light`/
`Dark`/`Auto`, a third vocabulary that matches neither Frappe's nor the DocType's.

**Direction.** One effective state: `data-theme`, owned by Frappe. Themate maps its
`Light`/`Dark`/`Auto` preference onto `data-theme-mode` and then delegates to
`frappe.ui.set_theme()`, and registers `frappe.ui.add_system_theme_switch_listener()` so
`automatic` keeps tracking the OS. `data-tm-mode` is removed, not bridged.

## 2. Verified CSS variables worth bridging

From `frappe/public/scss/common/css_variables.scss` unless noted.

| Native variable | Native value | Line | Note |
| --- | --- | --- | --- |
| `--navbar-height` | `48px` | 26 | Matches the brief's ~48px topbar target exactly. |
| `--input-height` | `28px` (`$input-height`) | 1, 133 | Frappe is **already** at the brief's 28px compact target. |
| `--btn-height` | `28px` | 130 | Same. |
| `--primary-color` | `var(--gray-900)` | 129 | Frappe's "primary" is near-black, not a hue. |
| `--btn-primary` | `var(--gray-900)` | 97 | Why stock primary buttons are black; the accent must be introduced deliberately. |
| `--btn-default-bg` / `--btn-default-hover-bg` | `--gray-100` / `--gray-300` | 98-99 | Neutral default action — matches the brief's required hierarchy. |
| `--control-bg` | `var(--gray-100)` | 87 | Inputs are filled, not outlined, in stock Frappe. |
| `--border-color` / `--dark-border-color` | `--gray-200` / `--gray-300` | 111-112 | Divider vs. input border. |
| `--subtle-fg` | `var(--gray-100)` | 81 | List header background. |
| `--highlight-color` | `var(--gray-50)` | 114 | Row hover **and** row focus — see §4. |
| `--fg-color` / `--bg-color` | `white` / `white` | 78-79 | Frappe does **not** ship a distinct app background; the brief's `#f5f5f5` app ground is a deliberate change. |
| `--checkbox-size` | `14px` | 137 | |
| `--placeholder-color` | `var(--gray-50)` | 118 | Near-invisible on white; a genuine native weakness worth fixing. |
| `--text-on-blue`, `--alert-bg-*`, `--bg-*` pairs | various | 51-77 | Semantic pairs the indicator/alert system consumes. |

## 3. Surface → source → selector → owner

| Surface | Native source | Verified selectors | Lifecycle trigger | Themate module | Validation route |
| --- | --- | --- | --- | --- | --- |
| Shell / page | `scss/desk/page.scss` | `.page-head`, `.page-title`, `.page-actions`, `.page-form`, `.layout-main-section`, `.layout-main-section-wrapper`, `.layout-side-section`, `.page-container` | `frappe.ui.Page` ctor | `layout/_page.scss` | any Desk route |
| Navbar | `scss/desk/navbar.scss` | `.navbar`, `.navbar-home`, `.search-bar`, `.navbar.bg-dark` | server-rendered `<header>` | `layout/_navbar.scss` | every route |
| Sidebar (native) | `scss/desk/sidebar.scss` | `.layout-side-section`, `.list-sidebar`, `.form-sidebar`, `.sidebar-menu`, `.sidebar-padding`, `.overlay-sidebar` | per-view | `layout/_sidebar.scss` | List + Form |
| Sidebar (Themate custom) | — | `.modern-sidebar` (Themate-owned markup) | `public/js/modern_sidebar.js` | legacy CSS/JS — see §5 | every route |
| Buttons | `scss/common/buttons.scss` | `.btn`, `.btn.btn-primary`, `.btn.btn-default`, `.btn.btn-secondary`, `.btn.btn-danger`, `.btn-primary-light`, `.btn-secondary-dark`, `.btn-reset` | static | `components/_buttons.scss` | every route |
| Inputs / controls | `scss/common/controls.scss`, `common/form.scss` | `.frappe-control[data-fieldtype="…"]`, `.control-label`, `.control-input`, `.control-input-wrapper`, `.control-value`, `.form-control`, `.like-disabled-input`, `.control-label.reqd:after`, `.help-box` | `frappe.ui.form.Control.make()` | `components/_forms.scss` | any Form |
| Autocomplete / Link | `scss/common/awesomeplete.scss`, `controls.scss:56-147` | `.awesomplete`, `.awesomplete > ul`, `.link-option`, `.table-multiselect`, `.multiselect-list`, `.selectable-item` | on focus | `components/_dropdowns.scss` | Link field |
| Form layout | `scss/desk/form.scss` | `.form-section`, `.form-column`, `.form-page`, `.form-tabs-list`, `.form-tab-content`, `.form-footer`, `.form-message`, `.form-dashboard-section`, `.form-links`, `.empty-section`, `.form-inner-toolbar` | `frappe.ui.form.Layout` | `components/_form-page.scss` | any Form |
| List View | `scss/desk/list.scss` | `.list-row-container`, `.list-row`, `.list-row-head`, `.list-row-col`, `.list-subject`, `.list-row-border`, `.list-row-activity`, `input.list-row-checkbox`, `.level-left`/`.level-right` | `frappe.views.ListView.render()` | `components/_list.scss` | `/app/todo` |
| Filters | `scss/desk/filters.scss` | `.filter-selector`, `.filter-button`, `.filter-area`, `.tag-filters-area` | filter area render | `components/_list.scss` | `/app/todo` |
| Filters — linked documents | `ui/filters/field_select.js`, `filter.js`, `filter_list.js`, `list/base_list.js`, `list/list_view.js`, `views/calendar/calendar.js` | dotted filter `link.field` on the list's doctype; `.tm-flinked` in the builder | `Filter.make_select`, `FilterGroup.validate_args` / `add_filters`, `BaseList.get_filters_for_args` / `refresh`, `ListView.get_search_params` / `parse_filters_from_route_options`, `Calendar.get_args` | `core/linked_filters.js` + `themate.api.get_linked_filter_fields` | Leave Application → Employee › Department |
| Child grid | `scss/common/grid.scss` | `.form-grid`, `.grid-heading-row`, `.grid-body`, `.grid-row`, `.data-row`, `.grid-static-col`, `.row-index`, `.row-check`, `.editable-row`, `.grid-footer-toolbar`, `.form-in-grid`, `.grid-append-row`, `.grid-delete-row`, `.grid-empty` | `frappe.ui.form.Grid.refresh()` | `components/_grid.scss` | Form with a child table |
| Report DataTable | `scss/desk/frappe_datatable.scss`, `desk/report.scss` | `.dt-cell`, `.dt-row`, `.dt-header`, `.dt-scrollable`, `.datatable` (vendor `frappe-datatable`) | `frappe.views.QueryReport` | `components/_grid.scss` (own block) | `/app/query-report/…` |
| Modals | `scss/common/modal.scss` | `.modal`, `.modal-dialog`, `.modal-header`, `.modal-body`, `.modal-footer`, `.modal-backdrop.show`, `.msgprint-dialog` | `frappe.ui.Dialog.show()` | `components/_modals.scss` | any dialog |
| Indicators | `scss/common/indicator.scss` | `.indicator`, `.indicator-pill`, `.indicator-pill-right`, `.indicator-pill-round`, `.indicator::before` | list/form render | `components/_indicators.scss` | `/app/todo` |
| Timeline | `scss/desk/timeline.scss` | `.timeline-item`, `.timeline-content`, `.timeline-dot`, `.comment-box` | form render | `components/_timeline.scss` | any Form |
| Workspace | `scss/desk/desktop.scss` | `.widget`, `.widget-head`, `.widget-title`, `.widget-label`, `.widget.number-widget-box`, `.widget.shortcut-widget-box`, `.widget.links-widget-box`, `.widget.onboarding-widget-box` | `frappe.widget.widget_factory` | `components/_workspace.scss` | `/app/home` |
| Theme switcher | `scss/desk/theme_switcher.scss`, `ui/theme_switcher.js` | `.theme-grid`, `.theme-title`, `[data-theme-mode]` | navbar menu | `core/bootstrap.js` | navbar → Toggle Theme |

## 4. Cascade traps verified in native source

1. **`--highlight-color` is overloaded.** `list.scss:64-66` uses it for `.list-row-container:focus`
   and `list.scss:92-94` for `.list-row:hover`. The brief requires a *selected* background distinct
   from *hover*; native has no separate selected token, so selection must be expressed on
   `.list-row-container` state, not by re-tinting `--highlight-color`.
2. **`.list-row-head` is `@extend .list-row`** (`list.scss:170`). Any `.list-row` rule also lands on
   the header row. Header-only intent must use `:not(.list-row-head)` — native itself does this at
   line 92.
3. **`.list-row` is `height: 40px` with `padding: 15px 15px 15px 0`** (`list.scss:84-85`). Reaching
   the brief's 32–36px row needs both values changed together, or padding wins and the row clips.
4. **Physical properties throughout native SCSS** — but they are mirrored at build time.
   *Corrected 2026-09-16 on a bench:* `frappe/esbuild/esbuild.js:233` runs **rtlcss** over every
   stylesheet bundle (Themate's included) to produce `rtl_*.bundle.css`, which is what
   `<html dir="rtl">` loads. Native physical values therefore do **not** leak, and a physical
   "correction" written in the theme is mirrored too and cancels itself out. The only real RTL
   work is keeping LTR runs LTR (numbers, dates, document IDs), and those declarations must carry
   the loud `rtl:ignore` comment or rtlcss flips them. Also: `body.frappe-rtl` is **not** set by
   Frappe 15's client (three orphaned selectors in its SCSS only); the direction signal is
   `html[dir="rtl"]`, and because `dir` sits on `<html>` the theme's scope must be the compound
   `html[dir="rtl"]`, never the descendant `html [dir="rtl"]` — which matched nothing.
5. **`$border-color` (Sass) vs `--border-color` (CSS)** — `list.scss:74` uses the *Sass* variable,
   compiled into Frappe's bundle. It cannot be re-pointed from Themate; it must be overridden as a
   normal declaration.

## 5. Themate current-state findings (source-verified, commit `c3d2227`)

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| 1 | **Dark mode is unreachable.** Bootstrap writes `data-tm-mode`; dark styles target `data-theme`. | `core/bootstrap.js:127` vs `tokens/_dark.scss:3` | **Fixed** — see §1. |
| 2 | **`applyFont()` silently replaces Inter with Outfit.** `font && font !== "Inter" && stacks[font] ? font : "Outfit"` — the configured default (`Inter`, `api.py:14`) can never apply. | `core/bootstrap.js:104` | **Fixed** |
| 3 | **Google Fonts CDN loaded from two places** — an `@import url(...)` in the Desk bundle **and** a `<link>` in the login template — pulling Outfit + Plus Jakarta Sans despite bundled Inter/Cairo and an explicit no-CDN constraint. Every login page hit a third party. | `themate.bundle.scss:1`, `www/login.html:65`, `EXECUTION_PROMPT.md` constraint 4 | **Fixed in both.** The app now makes no external requests. |
| 4 | **`--tm-secondary-*` is never defined in CSS.** `_buttons.scss` colours *every* default/secondary button from it, but the scale exists only if `applySecondaryScale()` runs. Before/without JS the declarations are invalid and buttons fall back to native black-on-gray. | `_buttons.scss:3-5`; absent from `tokens/_palette.scss` | **Fixed** — secondary palette removed entirely per brief §2. |
| 5 | **localStorage outranks boot settings with no reset.** `localStorage.getItem("tm-brand-color") \|\| theme.brand_color` — an admin changing the brand colour cannot override a user's stale local value. | `core/bootstrap.js:137-141` | **Fixed** — precedence inverted and versioned. |
| 6 | **Three different default brand colours.** `#3b6fec` (`api.py:8`), `#2f54f0` (`bootstrap.js:1`, `_palette.scss:5`), `#3b6fec` again in the switcher fallback. | as cited | **Fixed** — single source. |
| 7 | **`container_fullwidth` forced on every boot** from **two** places, overwriting the user's own Frappe toolbar preference on every page load. | `core/bootstrap.js:143`, `modern_sidebar.js:58` | **Fixed in both.** bootstrap no longer touches it; the sidebar now *seeds* the value only when the user has never set one, and reads it back in Frappe's own JSON-boolean form (`toolbar.js:220`). |
| 8 | **`!important` is the primary mechanism, not a fallback.** 283 in `_workspace.scss`, 15 in `_buttons.scss`, 26 in `_semantic.scss` (including blanket `h1`–`h6`, `p`). Themate's bundle already loads last, so ordinary specificity suffices. | file scan | **Largely fixed** — see COVERAGE.md. |
| 9 | **Global tag restyling.** `_semantic.scss` sets `h1`–`h6` and `p` with `!important`, recolouring `p` to `--text-muted` everywhere — then `_grid.scss` and `_modals.scss` exist *solely* to undo it inside grids and modals. Self-inflicted cascade. | `_semantic.scss:216-271`, `_grid.scss`, `_modals.scss` | **Fixed** — global tag rules dropped; the two undo-files repurposed. |
| 10 | **12 of 22 SCSS partials are comment-only stubs** — including `_forms.scss`, `_list.scss`, `_navbar.scss`, `_dropdowns.scss`, `_indicators.scss`, `_timeline.scss`, `_rtl.scss`, `_responsive.scss`. The theme's entire weight sits in workspace card decoration. | file scan | **Fixed** for forms/list/controls/grid/overlays/indicators/timeline/RTL/responsive. |
| 11 | **Feature flags are JS-only.** `setFlag()` writes `data-tm-*`, but no SCSS reads those attributes, so disabling an area removes nothing — and the token bridge is global regardless. | `bootstrap.js:118-125`; no `data-tm-sidebar` in any SCSS | **Fixed** — component blocks now scope to the flags. |
| 12 | **Body-wide `MutationObserver({subtree:true})` plus a 100 ms polling interval** re-scanning for widgets on every DOM mutation anywhere. | `workspace/cards.js:428-441` | **Fixed** — scoped + debounced. |
| 13 | **`frappe.ui.Dialog` is replaced globally** to inject icon fields, matched by `opts.title.includes("Shortcut"/"Number Card"/"Link")` — an untranslated substring match that fires on unrelated dialogs in English and never in a translated UI. | `workspace/cards.js:169-215` | **Documented**; narrowed, not removed (see §7). |

### 5a. Three further defects, found in review after the first rebuild

These were reported by the reviewer and reproduced here before fixing. All three
were **interaction** bugs between two layers, which is exactly why the original
unit-level tests missed them — each suite exercised CSS without JS, or JS
without CSS, or bootstrap without the picker.

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| 14 | **A saved Dark choice reverted to Light on every reload.** `applyThemeMode` took `prefs.theme_mode \|\| theme.default_mode`, but `default_mode` is never empty (`api.py` defaults it to `"Light"`), so the site default always won and the user's own choice could never stick. | `bootstrap.js` (old `apply()`); `api.py` `THEME_DEFAULTS` | **Fixed.** `theme_mode` now mirrors Frappe's `User.desk_theme` — the same field `switch_theme` writes — so there is one store. The site default applies only when that column is genuinely null. Reading the raw column matters: `frappe/sessions.py:184` collapses null into `"Light"`, which would make "never chose" indistinguishable from "chose Light". |
| 15 | **Runtime brand colours overwrote dark mode.** `applyBrandScale()` wrote each stop as an **inline style** on `<html>`, and an inline style beats every stylesheet rule — including `[data-theme="dark"]`. In dark mode `--tm-brand-50` became `#e8f1ff` instead of `#111a2c` and `--tm-brand-500` became `#1677ff` instead of `#1668dc`. The linear mix also drifted from the contract in light mode (`#4995ff` where the contract says `#4096ff`). | reproduced in a browser before the fix | **Fixed.** Ramps now come from `core/palette.js`, a port of Ant Design's own palette algorithm that reproduces both frozen SCSS ramps **exactly** (asserted in `tests/palette.test.js`, which reads the expected values out of the SCSS so they cannot drift). They are emitted as **mode-scoped CSS rules**, not inline styles, and nothing at all is emitted when the brand equals the default — the SCSS stays authoritative. |
| 16 | **The accent picker showed a different colour than the page painted.** `bootstrap` preferred the configured brand; `theme_switcher.current_accent()` preferred `localStorage`. With purple stored locally and blue configured on the site, the page painted blue while the picker highlighted purple. | reproduced in a browser before the fix | **Fixed.** One exported resolver, `window.themate.effectiveAccent()`, used by both. |

Findings 3 and 7 were each only half-true as first written: both defects also
existed in a second file. They were found by grepping the whole app for the
removed symbol after fixing the obvious occurrence. Claiming "fixed" from the
first hit alone would have been wrong.

## 6. Legacy sidebar — deliberately retained (now bundled)

*Updated 2026-09-16:* the trio is no longer loaded as bare `/assets` paths. nginx serves `/assets`
with `Cache-Control: max-age=31536000`, so as un-hashed files no change ever reached an existing
browser (`config/nginx.conf:48`). They are now imported by the content-hashed bundles:
`scss/layout/_modern-sidebar.scss` (last import of `themate.bundle.scss`, wrapped in
`rtl:begin/end:ignore` because it carries its own `[dir]` variants) and
`js/sidebar/{modern_sidebar,msidebar_override}.js` (last imports of `themate.bundle.js`).
`hooks.py` lists only the two bundles.

`hooks.py` loaded `modern_sidebar.css` (1635 lines), `modern_sidebar.js` (635 lines) and
`msidebar_override.js` (120 lines) *alongside* the new bundles, while the intended replacements
`js/sidebar/sidebar.js`, `js/sidebar/flyout.js` and `scss/layout/_sidebar.scss` were 1-line stubs.

The legacy trio is the **only** working sidebar. Per brief §2 ("remove legacy includes only once its
replacement works") and §"Avoid deleting existing code solely because it looks old", it is **kept**.
Rewriting 755 lines of mount/route/collapse logic that cannot be exercised in a browser here would
trade a working sidebar for an unverifiable one. `_sidebar.scss` now re-points the legacy skin at the
new tokens so the sidebar moves with the palette instead of diverging from it.

**Carried forward as the top open item.** See COVERAGE.md.

## 7. Datavalue reference column

`kimoamer/datavalue_theme_15` was **not** fetched: this environment's GitHub scope is limited to
`kimoamer/themate`, and the brief classes Datavalue as a read-only *reference*, not a dependency.
The decisions the brief asks for are recorded from its own §9 trace, which is itself a source review.

| Datavalue feature | Entry point (per brief §9) | Effect category | Verified here? | Themate decision |
| --- | --- | --- | --- | --- |
| Variable bridge in `app.html` inline `<style>` | custom Desk template | visual | No — template not forked | **Adopt the pattern, reject the vehicle.** Same idea (one setting → many native variables) via `tokens/_bridge.scss` + `extend_bootinfo`, with no Desk template fork. |
| `_frappe.scss` native-component overrides | `datavalue_theme.bundle.scss` | visual | No | **Adapt.** Equivalent coverage rebuilt per component against Frappe 15.121 selectors verified in §3. |
| `_grid.scss` (`.dv-row`/`.dv-col-*`) | bundle import | layout | No | **Omit.** Brief §9.2 is explicit that this is *not* the child-table grid; counting it as grid coverage would be false. |
| `.dv-navbar` / `.dv-side-menu` markup | compiled JS mounts | behavior + visual | No | **Omit the markup.** Themate keeps native navbar markup; the sidebar question is §6. |
| Compiled JS class replacement (`frappe.ui.Page`, `ControlLink`, `QueryReport`, …) | `app_include_js` | client behavior | No | **Omit.** Brief §9.4.1 warns these change behavior, not appearance. Themate's visual goals need none of them. |
| `Theme Settings` Single DocType | app schema | persisted schema | N/A | **Conflict noted** (brief §9.4.8): both apps define a Single named `Theme Settings` with different schemas. Themate's is unchanged by this work; do not co-install without resolving ownership. |
| Login slideshow / Owl Carousel dynamic load | `web_include_js` | behavior + dependency | No | **Omit.** Out of theme scope; adds a runtime dependency. |

## 8. What could not be verified

- **Everything requiring a browser.** No bench, no site, no Chromium run against Frappe. No
  screenshots, no computed-style inspection, no console-error baseline, no RTL/dark visual pass.
- **The deployed Frappe version** (claimed 15.111.1) and whether `datavalue_theme_15` is co-installed.
- **Whether the legacy sidebar currently works** on the real site — retained on the evidence of the
  source, not of a running page.

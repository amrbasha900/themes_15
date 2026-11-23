> **SUPERSEDED IN PART — read this first.**
>
> This document predates the Ant Design-inspired enterprise rebuild. It is kept
> because its architectural direction (SCSS bundle + partials, CSS variable
> bridging, a `Theme Settings` Single, `website_context` for favicon/splash) was
> adopted and still holds. Its *specifics* are stale in several places:
>
> - Its palette, density, radius and typography targets are replaced by
>   **`DESIGN_CONTRACT.md`**, which is the authority on visual values.
> - Its selector and API sketches were never verified against Frappe. Verified
>   selectors, variables and lifecycle hooks are in **`FRAPPE_UI_MAP.md`**,
>   checked against Frappe 15.121.0 source. Where the two disagree, the map wins.
> - Phase numbering in code comments ("Phase 5 styles forms") no longer matches
>   anything; those stubs have been implemented.
> - Its assumption that the legacy sidebar would be deleted in Phase 3 has not
>   been carried out, deliberately — see **`COVERAGE.md`** §"Sidebar".
>
> Current status of every surface: **`COVERAGE.md`**.

---

# Themate — SaaS UI Revamp Plan (Frappe 15)

> Goal: turn Themate from a "sidebar hack + one CSS file" into a deep, token-driven,
> upgrade-safe SaaS theme layer for Frappe Desk — the look & feel of Linear / Notion /
> Stripe dashboards, with an admin-configurable Theme Settings panel.

---

## 1. Where we are today (audit)

| Area | Current state | Problem |
|---|---|---|
| CSS | 2 plain CSS files (`themate.css`, `modern_sidebar.css`) included with `?version=` query strings | No SCSS, no partials, no auto cache-busting, hard to grow |
| JS | `modern_sidebar.js` + `msidebar_override.js` — jQuery DOM injection with `setTimeout` retries, `MutationObserver`, `ajaxComplete` polling | Fragile race-condition driven mounting; re-fetches workspaces via `xcall` although they are already in `frappe.boot` |
| Settings | JSON blob stored in a custom field on `User` (`sidebar_settings`) | Only stores `collapsed`; no admin-facing settings at all |
| Scope | Sidebar only | No tokens, no dark mode, no navbar, no forms/lists/modals, no login page, no RTL strategy |

## 2. What we learn from `datavalue_theme_15` (adopt vs. avoid)

**Adopt:**
- **SCSS bundle + partials architecture** — `*.bundle.scss` entry compiled by Frappe's esbuild, one partial per UI area (`_frappe.scss`, `_side-menu.scss`, `_header.scss`, `_dark-style.scss`, `_rtl.scss`, `_responsive.scss`...). Referenced in hooks simply as `"datavalue_theme.bundle.css"` — hashed dist file, no `?version=` hacks.
- **CSS variable bridging** — it re-skins Frappe by remapping core variables (`--primary`, `--btn-primary`, `--blue-500`, `--subtle-fg`, …) to its own brand scale instead of forking every component style. This is the single most powerful technique in that app.
- **`Theme Settings` Single DocType** — admin-configurable colors, logos, fonts, dark mode, login page, default workspace, feature flags (`apply_on_navbar`, `apply_on_menu`, …) exposed to JS as `frappe.theme_settings`.
- **Per-page JS hook** — `page_js = {"dashboard-view": "..."}` for targeted page customization.
- **`website_context` hook** — favicon + splash screen without template forks.

**Avoid:**
- **Forking `www/app.html` + `www/app.py`** (full copies of Frappe core's desk shell). Every Frappe minor upgrade can silently break it. We achieve ~95% of the same via the `extend_bootinfo` hook + a tiny JS bootstrapper that sets `<html>`/`<body>` data-attributes and injects CSS variables at runtime.
- Raw SQL on `tabSingles`, jQuery plugins from 2015 (nicescroll, owl-carousel), Vue 2 sprinkled into the navbar, committed minified bundles. We stay vanilla JS (ES6 classes, same as Frappe core) and build from source.

## 3. Target architecture

```
themate/
├── hooks.py                        # bundles, extend_bootinfo, website_context, page_js
├── boot.py                         # injects theme settings into frappe.boot
├── api.py                          # whitelisted: get/update theme settings, user prefs
├── install.py                      # after_install defaults
├── patches/
├── themate/doctype/
│   ├── theme_settings/             # Single: brand, fonts, radius, density, flags, logos
│   └── themate_user_preference/    # per-user: sidebar collapsed, pinned workspaces
└── public/
    ├── icons.svg                   # custom SVG sprite (app_include_icons)
    ├── js/
    │   ├── themate.bundle.js       # entry: imports everything below
    │   ├── core/
    │   │   ├── bootstrap.js        # reads boot → sets data-attrs + CSS vars (replaces app.html fork)
    │   │   ├── store.js            # user prefs: localStorage first, server sync after
    │   │   └── shortcuts.js        # ⌘K palette focus, [ for sidebar toggle …
    │   ├── sidebar/
    │   │   ├── sidebar.js          # ModernSidebar v2 (single clean mount on app_ready)
    │   │   └── flyout.js           # collapsed-rail flyout submenus
    │   └── navbar/navbar.js        # topbar augmentation (search button, breadcrumb polish)
    └── scss/
        ├── themate.bundle.scss     # desk entry
        ├── login.bundle.scss       # website/login entry
        ├── tokens/
        │   ├── _palette.scss       # raw scales: brand-50…900, gray-50…900
        │   ├── _semantic.scss      # surface/border/text/elevation/radius/spacing tokens
        │   ├── _bridge.scss        # map tokens → Frappe core variables
        │   └── _dark.scss          # [data-theme="dark"] token overrides
        ├── layout/
        │   ├── _navbar.scss  _sidebar.scss  _page.scss  _responsive.scss  _rtl.scss
        └── components/
            ├── _buttons.scss  _forms.scss  _list.scss  _grid.scss
            ├── _modals.scss   _dropdowns.scss  _indicators.scss
            ├── _workspace.scss  _form-page.scss  _timeline.scss
            └── _misc.scss     # toasts, skeletons, scrollbars, focus rings
```

**Layering rule (what makes it "deep" but upgrade-safe):**
1. *Token layer* — define our design language as CSS custom properties.
2. *Bridge layer* — remap Frappe's own variables to our tokens (zero selectors fighting core).
3. *Component layer* — only where variables can't reach, override core selectors (kept small, one file per component, every override commented with the core file it targets).
4. *JS layer* — augment, never replace, core classes; mount once on `app_ready`.

---

## Phase 0 — Build pipeline & skeleton (½ day)

Replace plain CSS includes with esbuild bundles.

```python
# hooks.py
app_include_css = ["themate.bundle.css"]
app_include_js = ["themate.bundle.js"]

web_include_css = ["login.bundle.css"]          # login + website pages

app_include_icons = "themate/public/icons.svg"  # custom SVG sprite

extend_bootinfo = "themate.boot.extend_bootinfo"

website_context = {
    "favicon": "/assets/themate/images/favicon.png",
    "splash_image": "/assets/themate/images/splash.svg",
}

after_install = "themate.install.after_install"
```

```scss
// public/scss/themate.bundle.scss
@import "tokens/palette";
@import "tokens/semantic";
@import "tokens/bridge";
@import "tokens/dark";
@import "layout/navbar";
@import "layout/sidebar";
@import "layout/page";
@import "components/buttons";
@import "components/forms";
@import "components/list";
// … then responsive + rtl LAST so they win the cascade
@import "layout/responsive";
@import "layout/rtl";
```

```js
// public/js/themate.bundle.js
import "./core/bootstrap";
import "./core/store";
import "./core/shortcuts";
import "./sidebar/sidebar";
import "./navbar/navbar";
```

Build with `bench build --app themate`. Delete the `?version=1.0.x` strings — dist
files are content-hashed. Keep old files until Phase 3 ports the sidebar, then remove.

---

## Phase 1 — Design token system (1–2 days) ← the heart of the SaaS look

### 1a. Raw palette

```scss
// tokens/_palette.scss
:root {
  // Brand scale (generate from one hue; keep 500 as the anchor)
  --tm-brand-50:  #eef4ff;  --tm-brand-100: #dce7fd;
  --tm-brand-200: #c0d4fb;  --tm-brand-300: #94b8f8;
  --tm-brand-400: #6193f3;  --tm-brand-500: #3b6fec;  // anchor
  --tm-brand-600: #2554d9;  --tm-brand-700: #1e42b0;
  --tm-brand-800: #1d398c;  --tm-brand-900: #1d3270;

  // Neutral scale tuned for SaaS (slightly cool gray, like Linear)
  --tm-gray-25: #fcfcfd; --tm-gray-50: #f8f9fb; --tm-gray-100: #f1f3f6;
  --tm-gray-200: #e6e9ee; --tm-gray-300: #d4d9e1; --tm-gray-400: #aab2bf;
  --tm-gray-500: #7c8595; --tm-gray-600: #5b6472; --tm-gray-700: #414a58;
  --tm-gray-800: #2b323d; --tm-gray-900: #161b24;
}
```

### 1b. Semantic tokens (this is what components consume)

```scss
// tokens/_semantic.scss
:root {
  // Surfaces (SaaS = layered surfaces, not flat white)
  --tm-surface-app:     var(--tm-gray-50);   // app background
  --tm-surface:         #ffffff;             // cards, page content
  --tm-surface-raised:  #ffffff;             // modals, popovers
  --tm-surface-sunken:  var(--tm-gray-100);  // wells, code, table headers

  // Borders & lines
  --tm-border:        var(--tm-gray-200);
  --tm-border-strong: var(--tm-gray-300);

  // Text
  --tm-text:        var(--tm-gray-900);
  --tm-text-2:      var(--tm-gray-600);   // secondary
  --tm-text-3:      var(--tm-gray-500);   // muted/placeholder

  // Elevation (soft, layered — never harsh)
  --tm-shadow-xs: 0 1px 2px rgb(22 27 36 / .05);
  --tm-shadow-sm: 0 1px 3px rgb(22 27 36 / .07), 0 1px 2px rgb(22 27 36 / .04);
  --tm-shadow-md: 0 4px 12px rgb(22 27 36 / .08), 0 1px 3px rgb(22 27 36 / .05);
  --tm-shadow-lg: 0 12px 32px rgb(22 27 36 / .12), 0 2px 6px rgb(22 27 36 / .06);

  // Radius scale (overridable by Theme Settings preset)
  --tm-radius-sm: 6px;  --tm-radius-md: 8px;
  --tm-radius-lg: 12px; --tm-radius-xl: 16px;

  // Focus ring (a11y, SaaS signature detail)
  --tm-ring: 0 0 0 3px color-mix(in srgb, var(--tm-brand-500) 25%, transparent);

  // Motion
  --tm-ease: cubic-bezier(.2,.8,.3,1);
  --tm-dur-fast: 120ms; --tm-dur: 180ms;

  // Layout
  --tm-sidebar-w: 248px; --tm-sidebar-w-rail: 64px;
  --tm-navbar-h: 52px;
}
```

### 1c. Bridge layer — remap Frappe core variables (datavalue's trick, done in SCSS)

```scss
// tokens/_bridge.scss — every line here saves dozens of selector overrides
:root, [data-theme="light"] {
  --primary:        var(--tm-brand-500);
  --primary-color:  var(--tm-brand-500);
  --btn-primary:    var(--tm-brand-500);
  --brand-color:    var(--tm-brand-500);

  --bg-color:       var(--tm-surface-app);
  --fg-color:       var(--tm-surface);
  --card-bg:        var(--tm-surface);
  --subtle-fg:      var(--tm-gray-100);
  --subtle-accent:  var(--tm-brand-50);

  --border-color:   var(--tm-border);
  --dark-border-color: var(--tm-border-strong);

  --text-color:     var(--tm-text);
  --text-muted:     var(--tm-text-2);
  --text-light:     var(--tm-text-3);
  --heading-color:  var(--tm-text);

  --navbar-height:  var(--tm-navbar-h);
  --border-radius:        var(--tm-radius-sm);
  --border-radius-md:     var(--tm-radius-md);
  --border-radius-lg:     var(--tm-radius-lg);
  --shadow-sm: var(--tm-shadow-sm);
  --shadow-md: var(--tm-shadow-md);
  --shadow-lg: var(--tm-shadow-lg);
  --modal-shadow: var(--tm-shadow-lg);

  // Frappe maps lots of UI to the blue scale → point it at brand
  --blue-50: var(--tm-brand-50);   --blue-100: var(--tm-brand-100);
  --blue-200: var(--tm-brand-200); --blue-300: var(--tm-brand-300);
  --blue-400: var(--tm-brand-400); --blue-500: var(--tm-brand-500);
  --blue-600: var(--tm-brand-600); --blue-700: var(--tm-brand-700);
}
```

> Tip: grep Frappe's `apps/frappe/frappe/public/scss/desk/css_variables.scss` and
> `variables.scss` once per upgrade — the bridge file is the only file that must track core.

### 1d. Typography

```scss
:root {
  --font-stack: "Inter", "Cairo", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
// Self-host Inter + Cairo (variable fonts) in public/fonts — no Google Fonts runtime dep
@font-face { font-family: "Inter"; src: url("/assets/themate/fonts/InterVariable.woff2") format("woff2-variations"); font-weight: 100 900; font-display: swap; }
@font-face { font-family: "Cairo"; src: url("/assets/themate/fonts/Cairo-Variable.woff2") format("woff2-variations"); font-weight: 200 900; font-display: swap; }
```

---

## Phase 2 — Theme Settings DocType + boot injection (1–2 days)

### 2a. `Theme Settings` (Single)

Fields (sketch — `issingle: 1`):

| Tab | Fields |
|---|---|
| Brand | `brand_color` (Color), `accent_preset` (Select: Indigo/Blue/Violet/Teal/Custom), `app_logo` / `app_logo_dark` (Attach Image), `favicon` |
| Appearance | `font_family` (Select: Inter/Cairo/System), `radius_preset` (Select: Sharp/Default/Round), `density` (Select: Comfortable/Compact), `default_mode` (Select: Light/Dark/Auto) |
| Layout flags | `enable_sidebar` (Check), `enable_navbar_restyle` (Check), `enable_list_restyle` (Check), `enable_form_restyle` (Check) ← rollout kill-switches, like datavalue's `apply_on_*` |
| Sidebar | `default_workspace` (Link Workspace), `show_workspace_icons` (Check), `sidebar_default` (Select: Expanded/Rail) |
| Login | `login_layout` (Select: Centered/Split), `login_background` (Attach Image), `login_tagline` (Data) |

### 2b. Boot injection — the upgrade-safe replacement for datavalue's `app.html` fork

```python
# themate/boot.py
import frappe

def extend_bootinfo(bootinfo):
    settings = frappe.get_cached_doc("Theme Settings")  # Single → cached
    bootinfo.themate = {
        "brand_color": settings.brand_color,
        "radius_preset": settings.radius_preset,
        "density": settings.density,
        "default_mode": settings.default_mode,
        "font_family": settings.font_family,
        "app_logo": settings.app_logo,
        "app_logo_dark": settings.app_logo_dark,
        "flags": {
            "sidebar": settings.enable_sidebar,
            "navbar": settings.enable_navbar_restyle,
            "list": settings.enable_list_restyle,
            "form": settings.enable_form_restyle,
        },
        "user_prefs": get_user_prefs(),   # from Themate User Preference
    }
```

```js
// public/js/core/bootstrap.js — runs immediately (bundle loads after boot is parsed)
(function apply() {
  const t = frappe.boot.themate || {};
  const root = document.documentElement;

  // feature flags drive CSS via attributes — components opt-in with selectors
  root.dataset.tmSidebar = t.flags?.sidebar ? "on" : "off";
  root.dataset.tmRadius  = t.radius_preset || "default";
  root.dataset.tmDensity = t.density || "comfortable";

  // dynamic brand color without rebuilding CSS: derive a scale at runtime
  if (t.brand_color) {
    root.style.setProperty("--tm-brand-500", t.brand_color);
    root.style.setProperty("--tm-brand-600", shade(t.brand_color, -12)); // tiny helper
    root.style.setProperty("--tm-brand-50",  tint(t.brand_color, 92));
    // … 100–900
  }
})();
```

```scss
// presets consumed from the attribute, e.g.:
[data-tm-radius="sharp"]  { --tm-radius-sm: 3px; --tm-radius-md: 4px; --tm-radius-lg: 6px; }
[data-tm-radius="round"]  { --tm-radius-sm: 8px; --tm-radius-md: 12px; --tm-radius-lg: 16px; }
[data-tm-density="compact"] { --tm-navbar-h: 44px; /* + tighter control padding */ }
```

### 2c. Per-user preferences (replaces the JSON-on-User hack)

`Themate User Preference` DocType (one doc per user, autoname `field:user`):
`user` (Link), `sidebar_collapsed` (Check), `pinned_workspaces` (Small Text JSON),
`theme_mode` (Select). Write-through cache:

```js
// core/store.js
export const store = {
  get: (k, d) => JSON.parse(localStorage.getItem(`tm:${k}`) ?? "null") ?? d,
  set(k, v) {
    localStorage.setItem(`tm:${k}`, JSON.stringify(v));        // instant
    frappe.call("themate.api.save_pref", { key: k, value: v }); // async sync
  },
};
```

---

## Phase 3 — Sidebar v2 (2–3 days)

Principles: mount **once**, from boot data, no polling.

```js
// sidebar/sidebar.js
$(document).on("app_ready", () => {
  if (frappe.boot.themate?.flags?.sidebar) new ThemateSidebar();
});

class ThemateSidebar {
  constructor() {
    // 1. data is already booted — no xcall needed
    this.pages = frappe.boot.allowed_workspaces || [];   // boot.py:181 in frappe v15
    this.render();
    frappe.router.on("change", () => this.set_active()); // only active-state updates
  }

  render() {
    this.$el = $(`<aside class="tm-sidebar" data-collapsed="${store.get("sidebar_collapsed", false)}">`)
      .prependTo(".main-section").parent()  // insert before .main-section
      ; // header (logo) + search filter + sections + footer (user)
  }
}
```

Feature set:

- **Sections**: Pinned (user), Workspaces (public tree from `parent_page`), Recents (last 8 routes tracked on `router change` → localStorage), Settings shortcut at bottom.
- **Collapse to icon rail** (64px) — labels hidden, flyout submenu on hover rendered in a portal (`position: fixed`) like today, but extracted into `flyout.js` with a single positioning function instead of inline math.
- **Pin/unpin** on hover (star icon) → `store.set("pinned_workspaces", [...])`.
- **Filter box** at top (filters items client-side; `/` focuses it).
- **Keyboard**: `[` toggles collapse, arrows navigate, Enter opens.
- **Hide core double-sidebar** only where ours is on:

```scss
html[data-tm-sidebar="on"] {
  .codex-sidebar, #page-Workspaces .layout-side-section { display: none; }
  .main-section { margin-inline-start: var(--tm-sidebar-w); transition: margin var(--tm-dur) var(--tm-ease); }
  &[data-tm-collapsed="true"] .main-section { margin-inline-start: var(--tm-sidebar-w-rail); }
}
```

```scss
// layout/_sidebar.scss — SaaS visual language
.tm-sidebar {
  position: fixed; inset-inline-start: 0; top: 0; bottom: 0; z-index: 100;
  width: var(--tm-sidebar-w);
  background: var(--tm-surface);
  border-inline-end: 1px solid var(--tm-border);
  display: flex; flex-direction: column;

  .tm-item {
    display: flex; align-items: center; gap: 8px;
    height: 32px; padding-inline: 10px; margin-inline: 8px;
    border-radius: var(--tm-radius-sm);
    color: var(--tm-text-2); font-size: 13px; font-weight: 500;
    &:hover { background: var(--tm-gray-100); color: var(--tm-text); }
    &.active { background: var(--tm-brand-50); color: var(--tm-brand-600);
               .icon { color: var(--tm-brand-500); } }
  }
  .tm-section-title {
    font-size: 11px; font-weight: 600; letter-spacing: .04em;
    text-transform: uppercase; color: var(--tm-text-3);
    padding: 16px 18px 6px;
  }
}
```

Migration: port `themate.settings.get_settings/save_settings` consumers to `store.js`,
then delete `modern_sidebar.js`, `msidebar_override.js`, `modern_sidebar.css`.

---

## Phase 4 — Topbar (1 day)

Keep Frappe's navbar DOM (toolbar logic is dense — don't replace it), restyle + augment:

```scss
// layout/_navbar.scss
.navbar {
  height: var(--tm-navbar-h);
  background: color-mix(in srgb, var(--tm-surface) 85%, transparent);
  backdrop-filter: blur(8px);                 // SaaS frosted topbar
  border-bottom: 1px solid var(--tm-border);
  box-shadow: none;
}
#navbar-breadcrumbs a { color: var(--tm-text-2); font-size: 13px; }
```

```js
// navbar/navbar.js — turn awesomebar into a ⌘K command button
$(document).on("app_ready", () => {
  const $search = $("header .search-bar input");
  $search.attr("placeholder", __("Search or jump to…"));
  $(`<kbd class="tm-kbd">⌘K</kbd>`).insertAfter($search);
  frappe.ui.keys.add_shortcut({
    shortcut: "ctrl+k", action: () => $search.trigger("focus"),
    description: __("Open command bar"), ignore_inputs: true,
  });
});
```

Details: avatar with status dot, notification bell with count pill
(`.notifications-seen .badge`), divider-separated icon group, full-bleed dropdowns
with `--tm-shadow-lg` + `--tm-radius-lg`.

---

## Phase 5 — Component re-skin (the "depth", 4–6 days, incremental)

One partial per component; each override is annotated with the core file it targets so
upgrades are auditable. Everything respects the kill-switch flags
(`html[data-tm-list="on"] …`) during rollout.

**Buttons** (`components/_buttons.scss`)
```scss
.btn { border-radius: var(--tm-radius-sm); font-weight: 500; font-size: 13px;
       transition: all var(--tm-dur-fast) var(--tm-ease);
       &:focus-visible { box-shadow: var(--tm-ring); } }
.btn-primary { background: var(--tm-brand-500); border: 1px solid var(--tm-brand-600);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .12), var(--tm-shadow-xs); // subtle SaaS gloss
  &:hover { background: var(--tm-brand-600); } }
.btn-default, .btn-secondary { background: var(--tm-surface); border: 1px solid var(--tm-border-strong);
  box-shadow: var(--tm-shadow-xs); &:hover { background: var(--tm-gray-50); } }
```

**Form controls** (`components/_forms.scss`) — focus rings + quiet borders:
```scss
.form-control, .input-with-feedback {
  background: var(--tm-surface); border: 1px solid var(--tm-border-strong);
  border-radius: var(--tm-radius-sm); height: 30px; font-size: 13px;
  transition: border-color var(--tm-dur-fast), box-shadow var(--tm-dur-fast);
  &:focus { border-color: var(--tm-brand-400); box-shadow: var(--tm-ring); background: var(--tm-surface); }
}
.control-label { font-size: 12px; font-weight: 500; color: var(--tm-text-2); }
```

**Form page as settings-card layout** (`components/_form-page.scss`):
```scss
.form-page .form-section, .form-dashboard-section {
  background: var(--tm-surface); border: 1px solid var(--tm-border);
  border-radius: var(--tm-radius-lg); box-shadow: var(--tm-shadow-xs);
  margin-bottom: 12px;
  .section-head { font-size: 13px; font-weight: 600; }
}
.form-tabs-list { /* pill or underline tabs, sticky under navbar */ }
```

**List view as data table card** (`components/_list.scss`):
```scss
.frappe-list .list-row-container { background: var(--tm-surface); }
.frappe-list { border: 1px solid var(--tm-border); border-radius: var(--tm-radius-lg);
               box-shadow: var(--tm-shadow-xs); overflow: clip; }
.list-row-head { background: var(--tm-surface-sunken); text-transform: uppercase;
                 font-size: 11px; letter-spacing: .03em; color: var(--tm-text-3); }
.list-row:hover { background: var(--tm-gray-25); }
.filter-section .filter-button { /* chip-style filters */ }
```

**Status indicators → pills** (`components/_indicators.scss`):
```scss
.indicator-pill { border-radius: 999px; font-weight: 500; font-size: 12px;
  padding: 2px 10px; // semantic bg/text pairs:
  &.green { background: #e7f6ec; color: #15803d; }
  &.red   { background: #fdecec; color: #b91c1c; }
  &.orange{ background: #fff3e0; color: #c2410c; }
  // keep Frappe's class names — only re-skin
}
```

**Modals / dropdowns** — `--tm-shadow-lg`, `--tm-radius-xl`, fade+scale-in
(`transform: scale(.98)→1` over `--tm-dur`), dimmed `backdrop-filter: blur(2px)` overlay.

**Workspace** (`components/_workspace.scss`) — number cards as KPI tiles
(value 24px/600, label 12px muted, sparkline color = brand), shortcut chips with icon
squares, chart cards with header row + "…" menu.

**Timeline / comments** (`components/_timeline.scss`) — avatar rail, bubble-less flat
entries, subtle separators — Notion-style activity feed.

**Misc** (`components/_misc.scss`) — thin overlay scrollbars, skeleton shimmer class,
`.alert`/toast restyle (raised surface + icon + border-left brand), empty-state blocks.

---

## Phase 6 — Dark mode (1 day, because tokens did the work)

Frappe v15 sets `data-theme="dark"` from the user's `desk_theme`. Only token values flip:

```scss
// tokens/_dark.scss
[data-theme="dark"] {
  --tm-surface-app:    #101318;
  --tm-surface:        #161b22;
  --tm-surface-raised: #1d242e;
  --tm-surface-sunken: #0d1117;
  --tm-border:         #262d38;  --tm-border-strong: #323b48;
  --tm-text:  #e8ecf2;  --tm-text-2: #9aa6b5;  --tm-text-3: #6b7686;
  --tm-shadow-md: 0 4px 12px rgb(0 0 0 / .4);   // shadows read differently on dark
  // brand: bump one step lighter for contrast
  --tm-brand-500: var(--tm-brand-400);
}
```

Add a mode toggle in the navbar user menu (`frappe.ui.set_theme("dark")` exists in v15 toolbar) and honor `default_mode: Auto` via `prefers-color-scheme`.

---

## Phase 7 — Login page (1 day)

Default: **CSS-only re-skin** via `web_include_css` (`login.bundle.scss`) — split layout
using grid on `body.login-page`, brand panel via `::before` + Theme Settings background
injected through `update_website_context`:

```python
# hooks.py
update_website_context = ["themate.overrides.website_context"]

# themate/overrides.py
def website_context(context):
    s = frappe.get_cached_doc("Theme Settings")
    if s.login_background: context["tm_login_bg"] = s.login_background
    context["tm_login_layout"] = s.login_layout or "Centered"
    return context
```

Optional (only if CSS can't reach the layout we want): fork `www/login.html` like
datavalue — but import the core context instead of copying it:

```python
# www/login.py
from frappe.www.login import get_context as core_get_context
def get_context(context):
    context = core_get_context(context)
    # add theme settings…
    return context
```

---

## Phase 8 — RTL, a11y, performance, QA (ongoing, finish 1–2 days)

- **RTL**: use logical properties everywhere (`margin-inline-start`, `inset-inline-end`,
  `border-inline-…`) — then `_rtl.scss` only fixes third-party leftovers. Cairo variable
  font already bundled for Arabic.
- **A11y**: `:focus-visible` rings on every interactive element, `prefers-reduced-motion`
  guard around all transitions, AA contrast check on the brand scale (tokens make this a
  one-file audit), `aria-current="page"` on the active sidebar item.
- **Performance**: no runtime Google Fonts, no jQuery plugins; one CSS + one JS bundle;
  `content-visibility: auto` on heavy list rows is an easy win.
- **QA matrix** (each phase ships only after passing): List / Form / Report / Workspace /
  Dialog / Print preview / Setup wizard × Light / Dark × LTR / RTL × ≥1280px / 768px /
  mobile.

## Rollout & risk

1. Ship phases behind the Theme Settings kill-switches (`enable_*`) defaulting **on** for
   dev sites, **off** in production until QA passes — exactly the migration valve
   datavalue built with `apply_on_*`.
2. `_bridge.scss` is the only file coupled to Frappe internals → re-grep core
   `css_variables.scss` on every `bench update`; keep a `BRIDGE_NOTES.md` of mappings.
3. No `www/app.html` fork unless a feature is provably impossible via boot + JS — if ever
   added, document the upstream file hash it was copied from.
4. Patch to migrate old `sidebar_settings` custom field → `Themate User Preference`,
   then remove the custom field in a follow-up release.

## Suggested order of attack

| Week | Deliverable |
|---|---|
| 1 | Phase 0 + 1 (pipeline + tokens + bridge) — desk already looks 60% more SaaS with zero component CSS |
| 2 | Phase 2 + 3 (settings + sidebar v2) — delete the legacy sidebar hack |
| 3 | Phase 4 + 5a (navbar, buttons, forms, list) |
| 4 | Phase 5b + 6 (workspace, modals, timeline, dark mode) |
| 5 | Phase 7 + 8 (login, RTL/a11y/QA, rollout flags to prod) |

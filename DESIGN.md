---
name: Themate
description: A dense, Ant Design-inspired Desk theme for Frappe and ERPNext, for Arabic and English.
colors:
  primary: "#1677ff"
  primary-hover: "#4096ff"
  primary-active: "#0958d9"
  selected: "#e6f4ff"
  app-background: "#f5f5f5"
  surface: "#ffffff"
  surface-sunken: "#fafafa"
  text: "#1f1f1f"
  text-secondary: "#595959"
  text-tertiary: "#707070"
  border-strong: "#d9d9d9"
  border: "#f0f0f0"
  dark-app-background: "#141b2b"
  dark-surface: "#1c2536"
  dark-surface-raised: "#232e42"
  dark-text: "#e6ebf5"
  dark-text-secondary: "#aab4c8"
  dark-border: "#2f3b52"
  sidebar-dark: "#121b36"
typography:
  title:
    fontFamily: "InterVariable, Cairo, sans-serif"
    fontSize: "20px"
    fontWeight: 600
  body:
    fontFamily: "InterVariable, Cairo, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  dense:
    fontFamily: "InterVariable, Cairo, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "InterVariable, Cairo, sans-serif"
    fontSize: "12px"
    fontWeight: 500
rounded:
  control: "4px"
  panel: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    height: "32px"
---

# Design System: Themate

`DESIGN_CONTRACT.md` is the authority on values, and `scss/tokens/` is their source. This file is the short guide for anyone designing a new screen. If the two disagree, the contract wins and this file gets corrected.

## Overview

**Creative North Star: "The Clear Desk"**

A tidy, well-lit desk someone is glad to sit at for eight hours. Everything needed is within reach, nothing is in the way, and the next step is obvious. The theme must feel friendly and easy, never difficult, gloomy or distracting.

Neutral surfaces and one accent keep it calm. Character comes from care: controls that line up, states that are never ambiguous, plain words, and Arabic that looks as considered as English.

Every surface is an Operate surface, except the login page, which may carry more of the client's brand.

**Key Characteristics:**
- One accent, supplied by the client's brand colour.
- High density without shrinking below 12px text.
- Borders separate; shadows are for things that float.
- Logical CSS, so RTL needs no second design.

## Colors

Neutral surfaces with one runtime-generated accent ramp. Clients change the accent, so nothing may rely on it being blue.

### Primary
- **Brand Accent** (#1677ff, replaced per client): primary actions, links, focus, and the current location. `core/palette.js` generates the ramp, in both modes.

### Neutral
- **Page, surface and sunken fill** (#f5f5f5, #ffffff, #fafafa): the page, its panels, and filled controls.
- **Text in three steps** (#1f1f1f, #595959, #707070): primary, secondary, tertiary.
- **Two border weights** (#d9d9d9, #f0f0f0): input borders and quiet dividers.

### Named Rules
**The One Accent Rule.** Secondary actions are neutral, never a second hue. Status colours keep their meaning and are never decoration. The decorative tones (`--tm-tone-*`) mark identity on workspace cards and activity categories only; they never mean a status.

**The Tokens Only Rule.** Components use `--tm-*` semantic tokens. Literal colours belong in `tokens/` only.

## Typography

**Latin:** InterVariable. **Arabic:** Cairo. Both are bundled; a client may choose another in Theme Settings.

Sizes come from `--tm-text-*`, which follow the user's font-size preference.

### Hierarchy
- **Title** (600, 20px): page titles.
- **Body** (400, 14px, 1.5): the base size.
- **Dense** (400, 13px, 1.4): tables, rows and controls.
- **Label** (500, 12px): metadata only.

### Named Rules
**The Numbers Align Rule.** Number columns use `tabular-nums`.

## Layout

Spacing is 4, 8, 12, 16 and 24px. Comfortable density gives 32px controls and 36px rows; compact gives 28px and 32px. Inputs, selects and buttons sharing a row have the same height. Density never uses zoom, `transform`, hidden fields or truncated labels. Direction uses logical properties.

## Sidebar

The dark sidebar carries flowing-ribbon art (`core/art.js`), recoloured from the SVG's colour variables, chosen in the Theme Customizer or derived from the sidebar colour. The light sidebar has none. Home's greeting card carries the same kind of art, turned to the accent's hue and inverted in dark mode. Edit the SVGs in `public/`, then run `tests/tools/build_art.py`.

## Elevation & Depth

Flat at rest. Cards and rows use a border. Only surfaces that float get a shadow: dropdown, autocomplete, popover, tooltip, dialog and toast. Two documented exceptions: kanban cards, because they are dragged, and workspace shortcut and link cards, which carry a soft resting shadow because the workspace is where people arrive. That shadow never animates.

## Shapes

Controls have 4px corners and panels have 6px; workspace shortcut and link cards have 12px. The `sharp` and `round` presets shift both by the same step, keeping that relationship.

## Components

Every control supports hover, selected, pressed, focus, disabled, readonly, invalid and loading (`DESIGN_CONTRACT.md` §4).

### Buttons
Quiet and exact. One primary per area; everything else neutral.

### Inputs
Readonly looks like a disabled input, not bare text. Focus is a 3px ring in the accent. Invalid uses a danger border plus help text.

### Navigation
The current item is a tint plus an inline-start bar. Sections have clear headers.

## Do's and Don'ts

- Do check each screen against three questions: is it easy, is it welcoming, is it calm? A "no" means it is not finished, even when every value matches the contract.
- Don't let density turn into clutter. Dense means more useful information, not more things competing for attention.
- Don't let dark mode or empty states feel heavy. Keep clear contrast between surfaces, and tell people what to do next.
- Do keep selected distinct from hover.
- Do verify every change in LTR and RTL, light and dark.
- Do use the inline-start bar for selected rows and active navigation. The contract requires it, so ignore the detector's `side-tab` warning on those.
- Don't override with `!important` unless it is documented.
- Don't put `:has()` on `body` or `html`; it made child-table edits several times slower.
- Don't add un-hashed assets to `app_include_*`.
- Don't animate anything triggered from the keyboard.

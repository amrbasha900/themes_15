# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences carry equal weight:

- **Operations staff** (accounting, sales, stock, HR) who keep ERPNext open all day and enter a lot of data. They need speed, density and predictable controls.
- **Managers** who come in to follow dashboards and reports and to approve requests. They need to find the state of the business quickly, without learning the system.

A screen that serves one audience by making the other's job harder is not finished.

## Product Purpose

Themate is the Desk theme for Frappe 15 and ERPNext sites delivered by Innomate to its clients. It is the design and frame only; data, analysis, dashboards and print formats belong to the separate InnoDash app.

Success means a client's staff can read, enter and find data faster and with fewer mistakes, in Arabic or English, on any module.

## Positioning

A theme that does not fork Frappe's Desk templates, so client sites keep taking Frappe upgrades, and that can be rolled back to stock Frappe with one switch.

## Product Facts

- Delivered per client by Innomate. Each client may set their own brand colour, logo and font from Theme Settings, so no design may depend on one specific brand colour.
- Arabic (RTL) and English (LTR) are equal. Every screen is reviewed in both.
- Light and dark modes are both supported.
- Users can change density, font size, corners and icons in the Theme Customizer. Layouts must survive those changes.
- Stock Frappe behaviour, keyboard shortcuts and permissions must keep working. Themate must never show something the reader may not open.
- No CDN assets: fonts and icons ship with the app.

## Evidence on Hand

- `tests/` holds contract and behaviour suites; `tests/visual/capture.js` captures the screenshot matrix.
- No client testimonials, usage metrics or benchmarks exist in this repository. Do not invent them.

## Product Principles

**The direction for every design decision: Themate is user friendly. It must not feel difficult, gloomy or distracting.** When two options both work, choose the one that feels easier, lighter and calmer to the person using it.

- **Not difficult:** the next step is obvious, labels use plain words, and nobody needs training to find or finish something.
- **Not gloomy:** screens feel open and welcoming, including in dark mode, on empty states and on errors.
- **Not distracting:** only what helps the current task gets attention; everything else stays quiet.

1. Readable data comes first; the theme serves the record on screen.
2. Upgrade safety beats a prettier override. Prefer Frappe's variables and events to replacing its code.
3. Arabic and English are the same product, not a translation of one another.
4. Every setting in Theme Settings must visibly work.
5. Judge the result in the rendered screen, not by passing tests alone.

## Accessibility & Inclusion

Keyboard focus stays visible, and status is never carried by colour alone (`DESIGN_CONTRACT.md` §4). No formal WCAG level has been committed to yet; this is undecided.

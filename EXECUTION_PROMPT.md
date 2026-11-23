> **SUPERSEDED IN PART — read this first.**
>
> This prompt describes an earlier phased execution. Its hard constraints were
> re-checked and most are kept: no Desk template fork, token discipline, logical
> properties, vanilla ES6 with no new runtime dependencies, verify selectors
> against real Frappe source, and comment every core-selector override with the
> file it targets.
>
> What changed:
>
> - **Its environment facts are unverified.** It claims Frappe 15.111.1 at
>   `/home/frappe/frappe-bench` on `site.local`. No bench exists in the
>   environment this work was done in; the audit was made against Frappe
>   **15.121.0** source instead. Re-verify before trusting any version claim.
> - **Constraint 8 (delete the legacy sidebar in Phase 3) is not met, by
>   design.** See `COVERAGE.md` §"Sidebar" for why and what finishing it needs.
> - The phase ordering has been replaced by the deliverable order in the current
>   brief: audit and contract first, then foundation, then components.
> - `THEMATE_SAAS_UI_PLAN.md` is no longer the visual authority;
>   `DESIGN_CONTRACT.md` is.
>
> Current status of every surface: **`COVERAGE.md`**.

---

# Themate SaaS UI Revamp — Execution Prompt

You are working in a Frappe 15 bench at `/home/frappe/frappe-bench`. The app to modify is **themate** (`apps/themate`, branch `main`). The full implementation plan is in `apps/themate/THEMATE_SAAS_UI_PLAN.md` — read it completely before writing any code.

A reference theme app exists at `apps/datavalue_theme_15`: study it when you need to see how a working theme overrides Frappe (SCSS partials, CSS variable bridging, Theme Settings doctype), but treat it as **read-only** — never modify it and never copy files from it wholesale.

## Mission

Implement the plan **one phase at a time, in order** (Phase 0 → Phase 8). Do not start a phase until the previous one builds cleanly, is verified, and is committed.

## Environment facts

- Frappe version: 15.111.1 — dev site name: `site.local`
- Build assets: `bench build --app themate`
- Clear cache: `bench --site site.local clear-cache`
- After creating/changing DocTypes: `bench --site site.local migrate`
- After changing `hooks.py`: the web process must restart (tell me if you cannot restart it yourself)

## Hard constraints — violating any of these means the implementation is wrong

1. **Never fork `www/app.html` / `www/app.py`.** Desk-side settings injection goes through the `extend_bootinfo` hook + the JS bootstrapper exactly as designed in Phase 2 of the plan.
2. **Token discipline:** raw color/size values may only appear in `tokens/_palette.scss`, `tokens/_semantic.scss`, and `tokens/_dark.scss`. Every other SCSS file consumes `--tm-*` variables only.
3. **Logical properties everywhere** (`margin-inline-start`, `inset-inline-end`, `border-inline-…`) so RTL works without per-rule fixes.
4. **Vanilla ES6 JS only** — no new jQuery plugins, no Vue, no CDN fonts, no new npm dependencies.
5. **Verify selectors against reality:** before styling or hooking any Frappe component, inspect the actual source under `apps/frappe/frappe/public/` (and the rendered DOM if needed). The plan's code blocks are sketches — if a selector or API in the plan doesn't exist in Frappe 15.111, follow reality and record the deviation in your phase report.
6. Every override of a core selector in `components/*.scss` gets a one-line comment naming the core file it targets.
7. All restyling respects the Theme Settings kill-switch flags via `html[data-tm-*]` attributes, so each area can be toggled off in production.
8. Keep the legacy sidebar files (`modern_sidebar.js`, `msidebar_override.js`, `modern_sidebar.css`) working until Phase 3 ships their replacement; delete them in that same commit.
9. Do not touch any other app in the bench.

## Workflow for every phase

1. Re-read the phase's section in `THEMATE_SAAS_UI_PLAN.md`.
2. Implement the full deliverables of that phase. Expand the plan's abbreviated hints into production code (e.g. where the plan says "… 100–900", generate the complete scale).
3. Run `bench build --app themate` — must finish with zero errors.
4. Verify on the running site: page loads, no JS console errors, the phase's features behave as described. For DocType phases, also run migrate and confirm the doctype opens in the desk.
5. Commit inside `apps/themate` with message `phase N: <short summary>`.
6. Print a short status report: what shipped, how it was verified, and any deviations from the plan with reasons. Then continue to the next phase.

## Decisions you make alone

Exact shade values inside the palette, spacing tweaks, file-naming details, and selector adjustments discovered while inspecting the real Frappe DOM.

## Decisions that require asking me first

Anything that would break a hard constraint, change a DocType schema after its phase was committed, add a dependency, or fork a core template (including the optional `www/login.html` fork in Phase 7 — default to the CSS-only approach).

## Definition of done

- All phases (0–8) committed, one commit per phase minimum.
- Legacy sidebar files removed; old `?version=` includes gone from `hooks.py`.
- `bench build --app themate` clean; no JS console errors on Desk.
- Theme Settings single controls brand color, radius, density, mode, and kill-switches end-to-end.
- Sidebar v2, navbar, list/form/buttons re-skin, dark mode, and login re-skin all verified on `site.local` in Light + Dark and LTR + RTL.
- Final summary of everything shipped vs. the plan.

Start now with Phase 0.

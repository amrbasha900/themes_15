/* Cascade-contract tests.
 *
 * Compiles the Desk bundle and asserts COMPUTED styles in Chromium against the
 * stand-in DOM in fixture.html, whose structure is copied from the Frappe
 * sources recorded in FRAPPE_UI_MAP.md §3.
 *
 * Scope: token resolution, the Frappe variable bridge, dark switching via the
 * native data-theme attribute, feature-flag rollback, density and radius.
 * These are the parts of the theme that fail silently and are invisible in a
 * successful build. Assertions that merely restate a token value are
 * deliberately absent — they would test nothing.
 *
 * NOT a substitute for visual verification on a real Frappe site (COVERAGE.md).
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const SCSS = path.join(ROOT, "themate/public/scss");
const OUT = path.join(__dirname, "themate.bundle.css");

function compile() {
	/* node_modules lives in tests/, not at the app root — see
	 * tests/package.json for why. The app-root path is still checked so a
	 * pre-existing install keeps working. */
	const sass = [
		path.join(__dirname, "node_modules/.bin/sass"),
		path.join(__dirname, "../node_modules/.bin/sass"),
		path.join(ROOT, "tests/node_modules/.bin/sass"),
		path.join(ROOT, "node_modules/.bin/sass"),
	].find((p) => fs.existsSync(p));
	if (!sass) {
		throw new Error("sass not installed — run `npm install` inside tests/");
	}
	execFileSync(
		sass,
		[
			"--no-source-map",
			"--quiet",
			`--load-path=${SCSS}`,
			path.join(SCSS, "themate.bundle.scss"),
			OUT,
		],
		{ stdio: ["ignore", "ignore", "inherit"] }
	);
}

function chromiumPath() {
	if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
	const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (base && fs.existsSync(base)) {
		const dir = fs.readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
		if (dir) {
			const p = path.join(base, dir, "chrome-linux", "chrome");
			if (fs.existsSync(p)) return p;
		}
	}
	return undefined; /* let Playwright resolve its own download */
}

const hex = (rgb) => {
	const m = String(rgb).match(/^rgba?\(([^)]+)\)$/);
	if (!m) return String(rgb).trim();
	const parts = m[1].split(",").map((n) => parseFloat(n));
	return "#" + parts.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
};

(async () => {
	compile();
	const { chromium } = require("playwright");
	const exe = chromiumPath();
	const browser = await chromium.launch(exe ? { executablePath: exe } : {});
	const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
	await page.goto("file://" + path.join(__dirname, "fixture.html"));

	/* core/bootstrap.js sets these from frappe.boot.themate at runtime. The
	 * static fixture must do the same or every flag-scoped rule is inert.
	 * (On a real Desk this is never a flash: frappe/www/app.html ships an empty
	 * shell and builds all components in JS after the bundles load.) */
	await page.evaluate(() => {
		const r = document.documentElement;
		r.dataset.tmForm = "on";
		r.dataset.tmList = "on";
		r.dataset.tmNavbar = "on";
		r.dataset.tmSidebar = "on";
		r.dataset.tmDensity = "comfortable";
		r.dataset.tmRadius = "default";
	});

	/* .btn transitions background-color over 100ms, so a read taken straight
	 * after a theme flip returns the interpolated start value. */
	const settle = () => page.waitForTimeout(250);
	const setAttr = async (name, value) => {
		await page.evaluate(([n, v]) => document.documentElement.setAttribute(n, v), [name, value]);
		await settle();
	};
	await settle();

	const results = [];
	const check = (name, actual, expected) => {
		results.push({ name, actual, expected, pass: String(actual).toLowerCase() === String(expected).toLowerCase() });
	};

	const cs = (sel, prop) =>
		page.evaluate(([s, p]) => {
			const el = document.querySelector(s);
			return el ? getComputedStyle(el).getPropertyValue(p).trim() : "NO-ELEMENT";
		}, [sel, prop]);

	const pseudo = (sel, pseud, prop) =>
		page.evaluate(([s, ps, p]) => {
			const el = document.querySelector(s);
			return el ? getComputedStyle(el, ps).getPropertyValue(p).trim() : "NO-ELEMENT";
		}, [sel, pseud, prop]);

	const rootVar = (name) =>
		page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

	/* ---- Bridge: native variables must resolve to Themate tokens ---------- */
	check("bridge: --bg-color resolves to the app ground", await rootVar("--bg-color"), "#f5f5f5");
	check("bridge: --input-height follows the control token", await rootVar("--input-height"), "32px");
	check("bridge: --navbar-height follows the topbar token", await rootVar("--navbar-height"), "48px");
	check("bridge: --placeholder-color no longer near-invisible gray-50", await rootVar("--placeholder-color"), "#707070");

	/* ---- Action hierarchy: one accent, neutral default, explicit danger ---- */
	check("buttons: primary is the accent", hex(await cs(".btn-primary", "background-color")), "#1677ff");
	check("buttons: default is neutral, not a second hue", hex(await cs(".btn-default", "background-color")), "#ffffff");
	check("buttons: danger is semantic", hex(await cs(".btn-danger", "background-color")), "#ff4d4f");
	check("buttons: share the control height", await cs(".btn-primary", "height"), "32px");
	check("buttons: disabled is inert, not merely faded", hex(await cs(".btn[disabled]", "background-color")), "#f5f5f5");

	/* ---- Controls ---------------------------------------------------------- */
	check("forms: input is outlined", await cs(".form-control", "border-top-width"), "1px");
	check("forms: input border colour", hex(await cs(".form-control", "border-top-color")), "#d9d9d9");
	check("forms: input matches the control height", await cs(".form-control", "height"), "32px");
	check("forms: required marker is danger", hex(await pseudo(".control-label.reqd", "::after", "color")), "#ff4d4f");
	check("forms: placeholder is legible", hex(await pseudo(".form-control", "::placeholder", "color")), "#707070");
	check("forms: invalid control borders danger", hex(await cs("#badctl .form-control", "border-top-color")), "#ff4d4f");
	check("forms: invalid help text is danger", hex(await cs("#badctl .help-box", "color")), "#cf1322");
	check("forms: numeric input aligns to the end", await cs("#curctl .form-control", "text-align"), "end");
	check("forms: numeric input uses tabular figures", await cs("#curctl .form-control", "font-variant-numeric"), "tabular-nums");

	/* ---- List View --------------------------------------------------------- */
	check("list: row height matches the contract", await cs(".list-row", "height"), "36px");
	check("list: selected row is tinted", hex(await cs("#selrow", "background-color")), "#e6f4ff");
	check("list: unselected row stays transparent", await cs("#plainrow", "background-color"), "rgba(0, 0, 0, 0)");

	/* ---- Grid and DataTable are separate implementations -------------------- */
	check("grid: numeric cell aligns to the end", await cs('.grid-static-col[data-fieldtype="Currency"]', "text-align"), "end");
	check("grid: header row is a distinct surface", hex(await cs(".grid-heading-row", "background-color")), "#fafafa");
	check("datatable: header is a distinct surface", hex(await cs(".dt-header", "background-color")), "#fafafa");

	/* ---- The window scrolls the page, never <body> ------------------------- */
	/* Frappe leaves `overflow: auto` inline on <body> each time a dialog
	 * closes (ui/dialog.js:92 -> :290). Any overflow on <html> keeps that
	 * value on body, and body (height: 100%) becomes a window-tall scroll box
	 * that cuts a Link dropdown off at its bottom edge and adds a second
	 * scrollbar (layout/_modern-sidebar.scss). */
	const bodyScroll = await page.evaluate(() => {
		const tall = document.body.appendChild(document.createElement("div"));
		tall.style.height = "3000px";
		document.body.style.overflow = "auto";
		document.body.scrollTop = 40; /* moves only a body that scrolls itself */
		const own = document.body.scrollTop;
		document.body.style.overflow = "";
		tall.remove();
		return own;
	});
	check("page: body does not scroll by itself after a dialog closes", bodyScroll, 0);

	/* The sideways clip the old <html> rule gave is kept, on the content shell. */
	const sideways = await page.evaluate(() => {
		const shell = document.body.appendChild(document.createElement("div"));
		shell.className = "main-section";
		shell.innerHTML = '<div style="width: 200vw; height: 1px"></div>';
		const root = document.documentElement;
		const scrolls = root.scrollWidth > root.clientWidth;
		shell.remove();
		return scrolls;
	});
	check("page: a surface wider than the window does not scroll the page sideways", sideways, false);

	/* ---- Feature-flag rollback --------------------------------------------- */
	await setAttr("data-tm-form", "off");
	check("flag off: form rules are removed", await cs(".form-control", "border-top-width"), "0px");
	await setAttr("data-tm-form", "on");
	check("flag on: form rules return", await cs(".form-control", "border-top-width"), "1px");

	await setAttr("data-tm-list", "off");
	check("flag off: list rules are removed", await cs(".list-row", "height"), "40px");
	await setAttr("data-tm-list", "on");

	/* ---- Dark mode via the NATIVE attribute --------------------------------- */
	await setAttr("data-theme", "dark");
	check("dark: surface token redefined", await rootVar("--tm-surface"), "#1c2536");
	check("dark: bridge re-resolves without being restated", hex(await cs("body", "background-color")), "#141b2b");
	check("dark: accent lifts for contrast", hex(await cs(".btn-primary", "background-color")), "#1668dc");
	check("dark: input surface follows the token", hex(await cs(".form-control", "background-color")), "#1c2536");
	check("dark: selected row stays distinct from hover", hex(await cs("#selrow", "background-color")) !== await rootVar("--tm-surface-hover"), true);
	await setAttr("data-theme", "light");

	/* ---- Density and radius presets ----------------------------------------- */
	await setAttr("data-tm-density", "compact");
	check("density compact: control is 28px", await cs(".form-control", "height"), "28px");
	check("density compact: row is 32px", await cs(".list-row", "height"), "32px");
	await setAttr("data-tm-density", "comfortable");
	check("density comfortable: control back to 32px", await cs(".form-control", "height"), "32px");

	check("radius default: controls are 4px", await cs(".form-control", "border-top-left-radius"), "4px");
	await setAttr("data-tm-radius", "sharp");
	check("radius sharp: controls are 2px", await cs(".form-control", "border-top-left-radius"), "2px");
	await setAttr("data-tm-radius", "round");
	check("radius round: controls are 6px", await cs(".form-control", "border-top-left-radius"), "6px");

	await browser.close();

	let pass = 0;
	const failures = [];
	for (const r of results) {
		if (r.pass) {
			pass++;
			console.log(`  ok   ${r.name}`);
		} else {
			failures.push(r);
			console.log(`  FAIL ${r.name}\n         expected ${r.expected}, got ${r.actual}`);
		}
	}
	console.log(`\ncss contract: ${pass} passed, ${failures.length} failed`);
	process.exit(failures.length ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

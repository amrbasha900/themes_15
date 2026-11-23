/* End-to-end integration: compiled CSS + palette + bootstrap + theme switcher,
 * running together in a browser against realistic frappe.boot payloads.
 *
 * WHY THIS SUITE EXISTS: three real bugs shipped past unit-level tests that
 * each exercised one piece in isolation — a stylesheet with no JS, or JS with
 * no stylesheet, or bootstrap without the picker. Every one of them was an
 * interaction between two layers:
 *
 *   1. bootstrap overrode the user's saved Dark choice with the site default.
 *   2. bootstrap's inline brand styles outranked the dark-mode CSS.
 *   3. the picker and bootstrap resolved the accent differently.
 *
 * Each is pinned below as a named regression. Boot payloads here are SHAPED
 * LIKE THE REAL ONE — in particular default_mode is always present, because
 * themate/api.py always provides it. The earlier test that passed an empty
 * object was testing a payload that cannot occur.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCSS = path.join(ROOT, "themate/public/scss");
const JS_DIR = path.join(ROOT, "themate/public/js");
const CSS_OUT = path.join(__dirname, "css/themate.bundle.css");

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
		["--no-source-map", "--quiet", `--load-path=${SCSS}`,
		 path.join(SCSS, "themate.bundle.scss"), CSS_OUT],
		{ stdio: ["ignore", "ignore", "inherit"] }
	);
	return fs.readFileSync(CSS_OUT, "utf8");
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
	return undefined;
}

const hex = (v) => {
	const m = String(v).match(/^rgba?\(([^)]+)\)$/);
	if (!m) return String(v).trim().toLowerCase();
	const p = m[1].split(",").map(parseFloat);
	return "#" + p.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
};

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

const SRC = {
	palette: fs.readFileSync(path.join(JS_DIR, "core/palette.js"), "utf8"),
	bootstrap: fs.readFileSync(path.join(JS_DIR, "core/bootstrap.js"), "utf8"),
	switcher: fs.readFileSync(path.join(JS_DIR, "core/theme_switcher.js"), "utf8"),
};

/* A boot payload shaped like the real thing: api.py ALWAYS supplies
 * default_mode, font_family, brand_color and flags. */
const bootPayload = (over = {}) => ({
	brand_color: "#1677ff",
	font_family: "Inter",
	radius_preset: "Default",
	density: "Comfortable",
	default_mode: "Light",
	flags: { theme: 1, sidebar: 1, navbar: 1, list: 1, form: 1 },
	user_prefs: { sidebar_collapsed: 0, pinned_workspaces: [], theme_mode: null },
	...over,
});

(async () => {
	const css = compile();
	const { chromium } = require("playwright");
	const exe = chromiumPath();
	const browser = await chromium.launch(exe ? { executablePath: exe } : {});

	/* Builds a page the way frappe/www/app.html does: theme attributes
	 * server-rendered from User.desk_theme, stylesheet in <head>, app JS at the
	 * end of <body>. */
	async function load(browserCtx, { deskTheme = "Light", boot = bootPayload(), seed = {}, withSwitcher = false } = {}) {
		const page = await browserCtx.newPage();
		const mode = deskTheme.toLowerCase() === "automatic" ? "automatic" : deskTheme.toLowerCase();
		await page.route("**/*", (route) =>
			route.fulfill({
				status: 200,
				contentType: "text/html",
				body: `<!DOCTYPE html><html data-theme-mode="${mode}" data-theme="${mode === "automatic" ? "light" : mode}" dir="ltr" lang="en">
<head><meta charset="utf-8">
<!-- Stand-in for Frappe's own desk.bundle.css, loaded FIRST exactly as
     frappe/www/app.py:48 orders it. Without this there is nothing for the
     master rollback to hand control back to, and an "OFF" assertion would
     only prove the theme's own values vanished, not that Frappe's returned.
     Values copied from frappe/public/scss/common/css_variables.scss. -->
<style>
:root, [data-theme="light"] {
  --primary: #171717; --btn-primary: #171717; --bg-color: white; --fg-color: white;
  --border-color: #e2e2e2; --text-color: #171717; --navbar-height: 48px;
  --input-height: 28px; --btn-height: 28px; --control-bg: #f4f5f6;
}
[data-theme="dark"] { --bg-color: #191919; --fg-color: #232323; --text-color: #f6f6f6; }
.form-control { border: none; height: var(--input-height); padding: 6px 8px; }
.list-row { padding: 15px 15px 15px 0; height: 40px; }
</style>
<style>${css}</style></head>
<body>
<button class="btn btn-primary" id="prim">Primary</button>
<div class="list-row-container" id="selrow"><div class="level list-row">
<input type="checkbox" class="list-row-checkbox" checked><div class="list-subject"><a href="#">row</a></div></div></div>
<div class="form-group frappe-control"><div class="control-input-wrapper">
<div class="control-input"><input class="form-control"></div></div></div>
</body></html>`,
			})
		);
		await page.goto("http://themate.test/");

		await page.evaluate(
			([b, s]) => {
				Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v));
				window.__alerts = [];
				window.frappe = {
					boot: { themate: b },
					show_alert: (m) => window.__alerts.push(m),
					ui: {
						set_theme: (t) => {
							const r = document.documentElement;
							const m = r.getAttribute("data-theme-mode");
							const eff = t || (m === "automatic"
								? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
								: m);
							r.setAttribute("data-theme", eff);
						},
						add_system_theme_switch_listener: () => { window.__osListener = true; },
					},
				};
			},
			[boot, seed]
		);

		await page.addScriptTag({ content: SRC.palette });
		await page.addScriptTag({ content: SRC.bootstrap });
		if (withSwitcher) {
			/* Expose the module-private resolver so the picker's notion of the
			 * selected swatch can be compared with what the page painted. */
			await page.addScriptTag({
				content: SRC.switcher.replace(
					/if \(document\.readyState === "loading"\)[\s\S]*$/,
					"window.__current_accent = current_accent;\nwindow.__build_section = build_section;"
				),
			});
		}
		/* The flags are NOT forced here: bootstrap sets them from the boot
		 * payload, which is the behaviour under test. Forcing them on would
		 * mask the master rollback entirely. */
		await page.waitForTimeout(250); /* .btn transitions background-color */
		return page;
	}

	const cssVar = (page, name) =>
		page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
	const bg = async (page, sel) =>
		hex(await page.evaluate((s) => getComputedStyle(document.querySelector(s)).backgroundColor, sel));
	const attr = (page, name) => page.evaluate((n) => document.documentElement.getAttribute(n), name);

	/* ===== REGRESSION 1 — the user's saved choice must survive a reload ===== */
	{
		/* User picked Dark in Frappe. Site default is Light. */
		const page = await load(browser, {
			deskTheme: "Dark",
			boot: bootPayload({ default_mode: "Light", user_prefs: { theme_mode: "Dark" } }),
		});
		check("R1: user chose Dark, site default Light -> stays dark", await attr(page, "data-theme"), "dark");
		check("R1: and the page actually paints dark", await bg(page, "body"), "#141b2b");
		await page.close();
	}
	{
		/* Inverse: user picked Light, site default Dark. */
		const page = await load(browser, {
			deskTheme: "Light",
			boot: bootPayload({ default_mode: "Dark", user_prefs: { theme_mode: "Light" } }),
		});
		check("R1: user chose Light, site default Dark -> stays light", await attr(page, "data-theme"), "light");
		await page.close();
	}
	{
		/* Never chose: the site default is allowed to speak. */
		const page = await load(browser, {
			deskTheme: "Light",
			boot: bootPayload({ default_mode: "Dark", user_prefs: { theme_mode: null } }),
		});
		check("R1: no user choice -> site default applies", await attr(page, "data-theme"), "dark");
		await page.close();
	}
	{
		/* Frappe spells it "Automatic"; Themate's Select said "Auto". Both must work. */
		for (const spelling of ["Auto", "Automatic"]) {
			const page = await load(browser, {
				deskTheme: "Light",
				boot: bootPayload({ user_prefs: { theme_mode: spelling } }),
			});
			check(`R1: "${spelling}" maps to Frappe's automatic`, await attr(page, "data-theme-mode"), "automatic");
			await page.close();
		}
	}
	{
		/* choose -> save -> reload, simulating the round trip through the API. */
		const page = await load(browser, {
			deskTheme: "Light",
			boot: bootPayload({ default_mode: "Light", user_prefs: { theme_mode: null } }),
		});
		check("R1: reload cycle, before choosing", await attr(page, "data-theme"), "light");
		await page.close();

		/* api.py save_pref writes User.desk_theme, so the next boot carries it
		 * in BOTH the server-rendered attribute and user_prefs.theme_mode. */
		const reloaded = await load(browser, {
			deskTheme: "Dark",
			boot: bootPayload({ default_mode: "Light", user_prefs: { theme_mode: "Dark" } }),
		});
		check("R1: reload cycle, after choosing Dark -> persists", await attr(reloaded, "data-theme"), "dark");
		await reloaded.close();
	}

	/* ===== REGRESSION 2 — brand generation must respect the current mode ==== */
	{
		/* Default brand in dark mode: the frozen dark ramp must survive. */
		const page = await load(browser, {
			deskTheme: "Dark",
			boot: bootPayload({ brand_color: "#1677ff", user_prefs: { theme_mode: "Dark" } }),
		});
		check("R2: dark + default brand keeps the dark ramp (50)", await cssVar(page, "--tm-brand-50"), "#111a2c");
		check("R2: dark + default brand keeps the dark ramp (500)", await cssVar(page, "--tm-brand-500"), "#1668dc");
		check("R2: no inline brand styles are written at all",
			await page.evaluate(() => document.documentElement.style.getPropertyValue("--tm-brand-500")), "");
		check("R2: primary button paints the dark accent", await bg(page, "#prim"), "#1668dc");
		await page.close();
	}
	{
		/* Default brand in light mode: exact contract values. */
		const page = await load(browser, { deskTheme: "Light", boot: bootPayload({ brand_color: "#1677ff" }) });
		check("R2: light hover step matches the contract", await cssVar(page, "--tm-brand-400"), "#4096ff");
		check("R2: light pressed step matches the contract", await cssVar(page, "--tm-brand-600"), "#0958d9");
		check("R2: selected row uses the contract tint", await bg(page, "#selrow"), "#e6f4ff");
		await page.close();
	}
	{
		/* Custom brand in dark mode must generate a DARK ramp, not a light one. */
		const page = await load(browser, {
			deskTheme: "Dark",
			boot: bootPayload({ brand_color: "#722ed1", user_prefs: { theme_mode: "Dark" } }),
		});
		const b50 = await cssVar(page, "--tm-brand-50");
		const b500 = await cssVar(page, "--tm-brand-500");
		check("R2: custom brand in dark does not paint step 500 as the raw colour", b500 !== "#722ed1", true);
		check("R2: custom brand in dark keeps step 50 dark", parseInt(b50.slice(1, 3), 16) < 0x60, true);
		await page.close();
	}
	{
		/* Same custom brand, light mode: step 500 IS the chosen colour. */
		const page = await load(browser, { deskTheme: "Light", boot: bootPayload({ brand_color: "#722ed1" }) });
		check("R2: custom brand in light lands on step 500", await cssVar(page, "--tm-brand-500"), "#722ed1");
		check("R2: custom brand paints the primary button", await bg(page, "#prim"), "#722ed1");
		await page.close();
	}
	{
		/* Toggling mode at runtime must re-resolve the custom ramp, because the
		 * emitted rules are mode-scoped rather than inline. */
		const page = await load(browser, { deskTheme: "Light", boot: bootPayload({ brand_color: "#722ed1" }) });
		const lightVal = await cssVar(page, "--tm-brand-500");
		await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
		await page.waitForTimeout(250);
		const darkVal = await cssVar(page, "--tm-brand-500");
		check("R2: a runtime theme flip re-resolves the custom ramp", lightVal !== darkVal, true);
		await page.close();
	}

	/* ===== REGRESSION 3 — picker and page must agree ======================= */
	{
		/* Purple stored locally, blue configured on the site. */
		const page = await load(browser, {
			deskTheme: "Light",
			boot: bootPayload({ brand_color: "#1677ff" }),
			seed: { "tm:pref-version": "2", "tm:brand-color": "#722ed1" },
			withSwitcher: true,
		});
		const applied = await cssVar(page, "--tm-brand-500");
		const picker = await page.evaluate(() => window.__current_accent());
		check("R3: page paints the configured colour", applied, "#1677ff");
		check("R3: picker reports the SAME colour the page painted", picker.toLowerCase(), applied);
		await page.close();
	}
	{
		/* Nothing configured: the local override is what both should report. */
		const page = await load(browser, {
			deskTheme: "Light",
			boot: bootPayload({ brand_color: null }),
			seed: { "tm:pref-version": "2", "tm:brand-color": "#722ed1" },
			withSwitcher: true,
		});
		const applied = await cssVar(page, "--tm-brand-500");
		const picker = await page.evaluate(() => window.__current_accent().toLowerCase());
		check("R3: local override applies when nothing is configured", applied, "#722ed1");
		check("R3: picker agrees with the page", picker, applied);
		await page.close();
	}
	{
		/* Stale preference version: both must fall back to the default together. */
		const page = await load(browser, {
			deskTheme: "Light",
			boot: bootPayload({ brand_color: null }),
			seed: { "tm:pref-version": "1", "tm:brand-color": "#722ed1" },
			withSwitcher: true,
		});
		const applied = await cssVar(page, "--tm-brand-500");
		const picker = await page.evaluate(() => window.__current_accent().toLowerCase());
		check("R3: stale override discarded by the page", applied, "#1677ff");
		check("R3: picker agrees on the fallback", picker, applied);
		await page.close();
	}

	/* ===== MASTER ROLLBACK — the theme must leave nothing behind ============
	 * Frappe defines --primary, --bg-color and the rest on :root and consumes
	 * them globally, so per-area flags can only remove STRUCTURE. This master
	 * switch is the only thing that hands Frappe back its own palette, and
	 * these assertions are what make that claim checkable. */
	{
		const page = await load(browser, {
			deskTheme: "Light",
			boot: bootPayload({ flags: { theme: 0, sidebar: 1, navbar: 1, list: 1, form: 1 } }),
		});

		check("OFF: the guard attribute is set", await attr(page, "data-tm-enabled"), "off");

		/* Tokens gone. */
		check("OFF: brand token removed", await cssVar(page, "--tm-brand-500"), "");
		check("OFF: surface token removed", await cssVar(page, "--tm-surface"), "");

		/* The Frappe bridge is gone, so the stub stylesheet's own values win
		 * again — this is the part per-area flags could never do. */
		check("OFF: Frappe keeps its own --primary", await cssVar(page, "--primary"), "#171717");
		check("OFF: Frappe keeps its own --bg-color", await cssVar(page, "--bg-color"), "white");
		check("OFF: Frappe keeps its own --input-height", await cssVar(page, "--input-height"), "28px");

		/* Structure gone: native values are back. */
		check("OFF: list row returns to Frappe's 40px",
			await page.evaluate(() => getComputedStyle(document.querySelector(".list-row")).height), "40px");
		check("OFF: input loses the themed border",
			await page.evaluate(() => getComputedStyle(document.querySelector(".form-control")).borderTopWidth), "0px");

		/* Area flags are forced off so no component rule can survive. */
		check("OFF: every area flag is forced off",
			await page.evaluate(() => {
				const d = document.documentElement.dataset;
				return [d.tmForm, d.tmList, d.tmNavbar, d.tmSidebar];
			}), ["off", "off", "off", "off"]);

		/* No runtime artefacts left on the document. */
		check("OFF: no brand stylesheet is emitted",
			await page.evaluate(() => document.getElementById("tm-brand-scale")), null);
		check("OFF: no font override is left on <html>",
			await page.evaluate(() => document.documentElement.style.getPropertyValue("--tm-font-stack")), "");
		await page.close();
	}
	{
		/* A custom brand must not leak through when the theme is off. */
		const page = await load(browser, {
			deskTheme: "Dark",
			boot: bootPayload({ brand_color: "#722ed1", user_prefs: { theme_mode: "Dark" },
				flags: { theme: 0, sidebar: 1, navbar: 1, list: 1, form: 1 } }),
		});
		check("OFF: a custom brand emits nothing", await cssVar(page, "--tm-brand-500"), "");
		check("OFF: the user's theme choice is still respected", await attr(page, "data-theme"), "dark");
		await page.close();
	}
	{
		/* Absent flag (a site that has not migrated) must default to ON. */
		const page = await load(browser, {
			deskTheme: "Light",
			boot: bootPayload({ flags: { sidebar: 1, navbar: 1, list: 1, form: 1 } }),
		});
		check("OFF: an absent master flag defaults to enabled", await attr(page, "data-tm-enabled"), "on");
		check("OFF: and the theme still paints", await cssVar(page, "--tm-brand-500"), "#1677ff");
		await page.close();
	}
	{
		/* ON is still ON after all of the above. */
		const page = await load(browser, { deskTheme: "Light", boot: bootPayload() });
		check("ON: guard attribute is on", await attr(page, "data-tm-enabled"), "on");
		check("ON: bridge still maps --bg-color to the app ground", await cssVar(page, "--bg-color"), "#f5f5f5");
		check("ON: list row is the contract height",
			await page.evaluate(() => getComputedStyle(document.querySelector(".list-row")).height), "36px");
		await page.close();
	}

	await browser.close();

	let pass = 0;
	const failures = [];
	for (const r of results) {
		if (r.pass) { pass++; console.log(`  ok   ${r.name}`); }
		else { failures.push(r); console.log(`  FAIL ${r.name}\n         expected ${r.expected}\n         got      ${r.actual}`); }
	}
	console.log(`\nintegration: ${pass} passed, ${failures.length} failed`);
	process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

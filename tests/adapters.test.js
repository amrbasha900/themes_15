/* Adapter behaviour tests.
 *
 * Covers the logic the JS layer actually introduces — theme-state mapping,
 * font selection, preference precedence and reset, flag attributes, and the
 * dialog field-signature matching — by running the real files in a browser
 * against a mocked `frappe` global. Each test names the defect it guards.
 *
 * Deliberately not covered: anything that only restates a constant.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const JS_DIR = path.join(ROOT, "themate/public/js");

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

const paletteSrc = fs.readFileSync(path.join(JS_DIR, "core/palette.js"), "utf8");
const bootstrapSrc = fs.readFileSync(path.join(JS_DIR, "core/bootstrap.js"), "utf8");
const iconFieldsSrc = fs.readFileSync(path.join(JS_DIR, "workspace/icon_fields.js"), "utf8");
const sidebarMountSrc = fs.readFileSync(path.join(JS_DIR, "sidebar/msidebar_override.js"), "utf8");
const sidebarClassSrc = fs.readFileSync(path.join(JS_DIR, "sidebar/modern_sidebar.js"), "utf8");
const iconsSrc = fs.readFileSync(path.join(JS_DIR, "core/icons.js"), "utf8");
const JQUERY = path.resolve(ROOT, "../frappe/node_modules/jquery/dist/jquery.min.js");

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

/* Boots a page with a mocked frappe global, then runs core/bootstrap.js. */
const ORIGIN = "http://themate.test/";

/* localStorage requires a real origin — about:blank and file:// both deny it.
 * A stubbed http origin gives the adapters the same storage semantics they
 * have on a Desk page. */
async function blankPage(browser) {
	const page = await browser.newPage();
	await page.route("**/*", (route) =>
		route.fulfill({ status: 200, contentType: "text/html", body: "<!DOCTYPE html><html><body></body></html>" })
	);
	await page.goto(ORIGIN);
	return page;
}

async function boot(browser, { themate = {}, setTheme = true, local = {}, dir = "ltr" } = {}) {
	const page = await blankPage(browser);
	await page.evaluate(
		([themateBoot, withSetTheme, localSeed, pageDir]) => {
			document.documentElement.setAttribute("dir", pageDir);
			window.__setThemeCalls = [];
			window.frappe = {
				boot: { themate: themateBoot },
				ui: withSetTheme
					? {
							set_theme: () => {
								const root = document.documentElement;
								const mode = root.getAttribute("data-theme-mode");
								const eff =
									mode === "automatic"
										? window.matchMedia("(prefers-color-scheme: dark)").matches
											? "dark"
											: "light"
										: mode;
								root.setAttribute("data-theme", eff);
								window.__setThemeCalls.push(mode);
							},
							add_system_theme_switch_listener: () => {
								window.__listenerBound = true;
							},
					  }
					: undefined,
			};
			Object.entries(localSeed).forEach(([k, v]) => localStorage.setItem(k, v));
		},
		[themate, setTheme, local, dir]
	);
	await page.addScriptTag({ content: paletteSrc });
	await page.addScriptTag({ content: bootstrapSrc });
	return page;
}

(async () => {
	const { chromium } = require("playwright");
	const exe = chromiumPath();
	const browser = await chromium.launch(exe ? { executablePath: exe } : {});

	/* Desk has a separate navbar-nav for breadcrumbs; tools belong beside the avatar. */
	for (const [lang, dir, width] of [["ar", "rtl", 390], ["en", "ltr", 1280]]) {
		const languages = [{ code: "ar", label: "العربية" }, { code: "en", label: "English" }];
		const page = await boot(browser, { dir, themate: { navbar: { language_switcher: 1, languages } } });
		await page.setViewportSize({ width, height: 800 });
		await page.addScriptTag({ path: JQUERY });
		const bootstrap = path.resolve(ROOT, "../frappe/node_modules/bootstrap/dist");
		await page.addStyleTag({ path: path.join(bootstrap, "css/bootstrap.min.css") });
		await page.addScriptTag({ path: path.join(bootstrap, "js/bootstrap.bundle.min.js") });
		await page.evaluate((lang) => {
			frappe.boot.lang = lang;
			frappe.session = { user: "user@example.test" };
			frappe.call = ({ args }) => { window.languageWrite = args; };
			frappe.utils = { icon: (name) => `<svg><use href="#${name}"></use></svg>` };
			document.body.innerHTML = '<header class="navbar navbar-expand"><ul class="navbar-nav" id="navbar-breadcrumbs"></ul>' +
				'<ul class="navbar-nav"><li class="dropdown-navbar-user"></li></ul></header>';
		}, lang);
		await page.addScriptTag({ path: path.join(JS_DIR, "core/navbar_tools.js") });
		await page.evaluate(() => { $(document).trigger("toolbar_setup").trigger("toolbar_setup"); });
		const row = page.locator(".navbar-nav").last();
		const toggle = row.locator(".tm-lang-toggle");
		check(`navbar (${lang}): one visible language button beside the user menu`,
			[await toggle.count(), await toggle.isVisible(), (await toggle.textContent()).trim()],
			[1, true, lang.toUpperCase()]);
		check(`navbar (${lang}): the button requests the globe icon`,
			await toggle.locator("use").getAttribute("href"), "#es-line-globe");
		await toggle.click();
		check(`navbar (${lang}): the active language is visible in the open menu`,
			await row.locator(`.tm-lang-option.active[data-lang="${lang}"]`).isVisible(), true);
		const next = lang === "ar" ? "en" : "ar";
		await row.locator(`.tm-lang-option[data-lang="${next}"]`).click();
		check(`navbar (${lang}): the selection saves the session user's language`, await page.evaluate(() => window.languageWrite),
			{ doctype: "User", name: "user@example.test", fieldname: "language", value: next });

		/* The two companion apps can mount before or after the theme. */
		const peer = lang === "ar" ? "fk-nav-lang" : "dropdown-language";
		await row.evaluate((list, cls) => list.insertAdjacentHTML("afterbegin", `<li class="${cls}"></li>`), peer);
		check(`navbar: ${peer} takes over while the customizer stays`,
			[await row.locator("." + peer).count(), await toggle.count(), await row.locator(".tm-customizer-nav").count()], [1, 0, 1]);
		await page.evaluate(() => $(document).triggerHandler("toolbar_setup"));
		check(`navbar: a toolbar with ${peer} already present keeps one switcher`, await toggle.count(), 0);
		await row.locator("." + peer).evaluate((el) => el.remove());
		check("navbar: the theme switcher returns when the companion item goes away", await toggle.count(), 1);
		await page.evaluate(() => {
			frappe.boot.themate.navbar.language_switcher = 0;
			$(document).triggerHandler("toolbar_setup");
		});
		check("navbar: disabling the language switcher keeps the customizer", [await toggle.count(), await row.locator(".tm-customizer-nav").count()], [0, 1]);
		await page.close();
	}

	/* ---- Font: the Outfit-substitution regression ------------------------- */
	{
		const page = await boot(browser, { themate: { font_family: "Inter" } });
		const stack = await page.evaluate(() =>
			document.documentElement.style.getPropertyValue("--tm-font-stack")
		);
		check(
			"font: choosing Inter actually yields Inter (was silently swapped to Outfit)",
			stack.includes("InterVariable") && !stack.includes("Outfit"),
			true
		);
		check("font: data-tm-font records the choice", await page.evaluate(() => document.documentElement.dataset.tmFont), "inter");
		await page.close();
	}
	{
		const page = await boot(browser, { themate: { font_family: "Cairo" } });
		const stack = await page.evaluate(() => document.documentElement.style.getPropertyValue("--tm-font-stack"));
		check("font: Cairo leads the stack when chosen", stack.trim().startsWith('"Cairo"'), true);
		await page.close();
	}
	{
		const page = await boot(browser, { themate: { font_family: "Outfit" } });
		const stack = await page.evaluate(() => document.documentElement.style.getPropertyValue("--tm-font-stack"));
		check("font: an unbundled face falls back to Inter, never a CDN", stack.includes("InterVariable"), true);
		await page.close();
	}

	/* ---- Theme state: the data-tm-mode vs data-theme split ----------------- */
	{
		const page = await boot(browser, { themate: { default_mode: "Dark" } });
		check("theme: Dark maps onto the native data-theme-mode",
			await page.evaluate(() => document.documentElement.getAttribute("data-theme-mode")), "dark");
		check("theme: effective data-theme is set (dark styles now reachable)",
			await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "dark");
		check("theme: delegates to frappe.ui.set_theme rather than inventing state",
			await page.evaluate(() => window.__setThemeCalls), ["dark"]);
		check("theme: the dead data-tm-mode attribute is gone",
			await page.evaluate(() => document.documentElement.hasAttribute("data-tm-mode")), false);
		await page.close();
	}
	{
		const page = await boot(browser, { themate: { default_mode: "Auto" } });
		check("theme: Auto maps to Frappe's 'automatic', not a third vocabulary",
			await page.evaluate(() => document.documentElement.getAttribute("data-theme-mode")), "automatic");
		check("theme: automatic registers the OS listener",
			await page.evaluate(() => window.__listenerBound === true), true);
		await page.close();
	}
	{
		/* No Themate preference: the server-rendered value must survive. */
		const page = await blankPage(browser);
		await page.evaluate(() => {
			document.documentElement.setAttribute("data-theme-mode", "dark");
			document.documentElement.setAttribute("data-theme", "dark");
			window.frappe = { boot: { themate: {} } };
		});
		await page.addScriptTag({ content: paletteSrc });
		await page.addScriptTag({ content: bootstrapSrc });
		check("theme: with no Themate preference, the user's Frappe choice is left alone",
			await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "dark");
		await page.close();
	}
	{
		/* Before frappe.ui exists, bootstrap must still resolve the first paint. */
		const page = await boot(browser, { themate: { default_mode: "Dark" }, setTheme: false });
		check("theme: resolves without frappe.ui (runs before boot completes)",
			await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "dark");
		await page.close();
	}

	/* ---- Preference precedence and reset ----------------------------------
	 * These assert the RESOLVER, not the painted colour. The ramp itself is no
	 * longer an inline style — bootstrap emits mode-scoped CSS rules — so the
	 * painted result is asserted in tests/integration.test.js, which loads the
	 * stylesheet. Testing the paint here, without CSS, is what let the
	 * dark-mode override bug through in the first place. */
	{
		const page = await boot(browser, {
			themate: { brand_color: "#ff0000" },
			local: { "tm:pref-version": "2", "tm:brand-color": "#00ff00" },
		});
		check("prefs: a configured brand colour outranks a local override",
			await page.evaluate(() => window.themate.effectiveAccent()), "#ff0000");
		await page.close();
	}
	{
		const page = await boot(browser, {
			themate: {},
			local: { "tm:pref-version": "2", "tm:brand-color": "#00ff00" },
		});
		check("prefs: a current-version local override applies when nothing is configured",
			await page.evaluate(() => window.themate.effectiveAccent()), "#00ff00");
		await page.close();
	}
	{
		const page = await boot(browser, {
			themate: {},
			local: { "tm:pref-version": "1", "tm:brand-color": "#00ff00" },
		});
		check("prefs: a stale-version override is discarded (reset path works)",
			await page.evaluate(() => window.themate.effectiveAccent()), "#1677ff");
		await page.close();
	}
	{
		const page = await boot(browser, { themate: {}, local: { "tm:pref-version": "2", "tm:brand-color": "#00ff00" } });
		await page.evaluate(() => window.themate.resetLocalPreferences());
		check("prefs: resetLocalPreferences clears the override",
			await page.evaluate(() => localStorage.getItem("tm:brand-color")), null);
		check("prefs: reset restores the default accent",
			await page.evaluate(() => window.themate.effectiveAccent()), "#1677ff");
		await page.close();
	}
	{
		/* A custom brand emits a stylesheet; the default emits nothing, because
		 * the frozen SCSS ramps are already exactly right. */
		const page = await boot(browser, { themate: { brand_color: "#722ed1" } });
		check("prefs: a custom brand emits a mode-scoped stylesheet",
			await page.evaluate(() => {
				const el = document.getElementById("tm-brand-scale");
				/* Must tie the compiled token blocks on specificity, or dark loses. */
				return el ? [el.textContent.includes('html:not([data-tm-enabled="off"]):not([data-theme="dark"]){'),
				             el.textContent.includes('html:not([data-tm-enabled="off"])[data-theme="dark"]{')] : null;
			}), [true, true]);
		check("prefs: and writes no inline styles on <html>",
			await page.evaluate(() => document.documentElement.style.getPropertyValue("--tm-brand-500")), "");
		await page.close();
	}
	{
		const page = await boot(browser, { themate: { brand_color: "#1677ff" } });
		check("prefs: the DEFAULT brand emits nothing, leaving the SCSS ramps authoritative",
			await page.evaluate(() => document.getElementById("tm-brand-scale")), null);
		await page.close();
	}

	/* ---- Feature flags ----------------------------------------------------- */
	{
		const page = await boot(browser, { themate: { flags: { sidebar: 1, navbar: 0, list: 1, form: 0 } } });
		check("flags: written as data-tm-* for the SCSS scopes to read",
			await page.evaluate(() => {
				const d = document.documentElement.dataset;
				return [d.tmSidebar, d.tmNavbar, d.tmList, d.tmForm];
			}),
			["on", "off", "on", "off"]);
		await page.close();
	}

	/* ---- container_fullwidth must no longer be forced ---------------------- */
	{
		const page = await boot(browser, { themate: {} });
		check("layout: the user's fullwidth preference is not overwritten on boot",
			await page.evaluate(() => localStorage.getItem("container_fullwidth")), null);
		await page.close();
	}

	/* ---- Dialog matching by field signature, not translated title ---------- */
	{
		const page = await blankPage(browser);
		await page.evaluate(() => {
			window.__constructed = [];
			window.frappe = {
				ui: {
					Dialog: class {
						constructor(opts) {
							window.__constructed.push(opts);
						}
					},
				},
			};
		});
		await page.addScriptTag({ content: iconFieldsSrc });

		const out = await page.evaluate(() => {
			const mk = (fields, title) => {
				new window.frappe.ui.Dialog({ title, fields });
				return fields.map((f) => f.fieldname);
			};
			return {
				/* A shortcut dialog in a NON-English UI — the old substring match
				 * on the title would have missed this entirely. */
				translated: mk(
					[{ fieldname: "type" }, { fieldname: "link_to" }, { fieldname: "label" }],
					"اختصار جديد"
				),
				/* An unrelated dialog whose title merely contains "Link". */
				unrelated: mk([{ fieldname: "email" }, { fieldname: "subject" }], "Share Link"),
				/* Number card editor. */
				numberCard: mk(
					[{ fieldname: "label" }, { fieldname: "new_or_existing" }],
					"إضافة بطاقة"
				),
			};
		});

		check("dialog: shortcut editor gets an icon field even in a translated UI",
			out.translated.includes("icon"), true);
		check("dialog: an unrelated dialog titled 'Share Link' is untouched",
			out.unrelated.includes("icon"), false);
		check("dialog: number card editor gets custom_icon",
			out.numberCard.includes("custom_icon"), true);

		/* Idempotence: constructing twice must not duplicate the field. */
		const dupe = await page.evaluate(() => {
			const fields = [{ fieldname: "type" }, { fieldname: "link_to" }, { fieldname: "label" }];
			new window.frappe.ui.Dialog({ title: "x", fields });
			new window.frappe.ui.Dialog({ title: "x", fields });
			return fields.filter((f) => f.fieldname === "icon").length;
		});
		check("dialog: injection is idempotent", dupe, 1);
		await page.close();
	}

	/* ---- The master switch: the site's Enable Theme, then the user's own ---- */
	{
		const sheet = '<link rel="stylesheet" href="/assets/themate/dist/css/themate.bundle.ABC123.css">';
		const state = async (themate, withSheet = true) => {
			const page = await blankPage(browser);
			await page.evaluate((html) => { document.head.insertAdjacentHTML("beforeend", html); }, withSheet ? sheet : "");
			await page.evaluate((t) => { window.frappe = { boot: { themate: t }, ui: { set_theme() {} } }; }, themate);
			await page.addScriptTag({ content: paletteSrc });
			await page.addScriptTag({ content: bootstrapSrc });
			const r = await page.evaluate(() => ({
				enabled: document.documentElement.dataset.tmEnabled,
				api: window.themate.enabled(),
				sheetOff: document.querySelector('link[rel="stylesheet"]')?.disabled ?? null,
				attrs: [...document.documentElement.attributes].map((a) => a.name).filter((n) => /^data-tm-/.test(n) && n !== "data-tm-enabled" && document.documentElement.getAttribute(n) !== "off"),
			}));
			await page.close();
			return r;
		};
		const on = await state({});
		check("switch: with nothing configured the theme is on and its stylesheet is live", [on.enabled, on.api, on.sheetOff], ["on", true, false]);
		const siteOff = await state({ flags: { theme: 0 } });
		check("switch: the site's Enable Theme off turns it off — the stylesheet is disabled, no data-tm-* left on",
			[siteOff.enabled, siteOff.api, siteOff.sheetOff, siteOff.attrs], ["off", false, true, []]);
		const userOff = await state({ flags: { theme: 1 }, user_prefs: { use_theme: "Off" } });
		check("switch: a user can turn it off for themselves over a site that has it on", [userOff.enabled, userOff.sheetOff], ["off", true]);
		const userOn = await state({ flags: { theme: 0 }, user_prefs: { use_theme: "On" } });
		check("switch: and on for themselves over a site that has it off — stylesheet back", [userOn.enabled, userOn.sheetOff], ["on", false]);
		const blank = await state({ flags: { theme: 0 }, user_prefs: { use_theme: null } });
		check("switch: a blank choice follows the site", [blank.enabled, blank.sheetOff], ["off", true]);
		const stray = await state({ flags: { theme: 1 }, user_prefs: { use_theme: "Maybe" } });
		check("switch: a stray choice falls back to the site", [stray.enabled, stray.sheetOff], ["on", false]);
		const noLink = await state({ flags: { theme: 0 } }, false);
		check("switch: off with no stylesheet in the page is not an error", [noLink.enabled, noLink.sheetOff], ["off", null]);
	}

	/* ---- The old sidebar and the icon set follow the same switch ---------- */
	{
		const run = async (tmEnabled, setupComplete = 1) => {
			const page = await blankPage(browser);
			await page.evaluate(([flag, setupComplete]) => {
				document.documentElement.dataset.tmEnabled = flag;
				document.body.innerHTML = '<div class="navbar-brand navbar-home">brand</div><div class="main-section"></div><div id="page-Workspaces"><div class="layout-side-section">native</div></div>';
				window.frappe = { boot: { sysdefaults: { setup_complete: setupComplete } }, ui: { Sidebar: class Native {} } };
				window.frappe.ui.ModernSidebar = class { constructor(parent) { parent.append("<div class=modern-sidebar></div>"); } };
			}, [tmEnabled, setupComplete]);
			await page.addScriptTag({ path: JQUERY });
			await page.addScriptTag({ content: sidebarMountSrc });
			await page.evaluate(() => new Promise((r) => setTimeout(r, 700)));
			const out = await page.evaluate(() => ({
				mounted: document.querySelectorAll(".modern-sidebar-container").length,
				brandReplaced: !document.querySelector(".navbar-brand.navbar-home"),
				nativeSidebarHidden: getComputedStyle(document.querySelector("#page-Workspaces .layout-side-section")).display === "none",
			}));
			await page.close();
			return out;
		};
		check("old sidebar: with the master switch on it mounts, replaces the navbar logo and hides the native Workspaces sidebar",
			await run("on"), { mounted: 1, brandReplaced: true, nativeSidebarHidden: true });
		check("old sidebar: with it off nothing mounts, the logo and Frappe's sidebar are left alone",
			await run("off"), { mounted: 0, brandReplaced: false, nativeSidebarHidden: false });
		check("old sidebar: the setup wizard (setup not complete) gets no sidebar",
			(await run("on", 0)).mounted, 0);

		const klass = async (tmEnabled) => {
			const page = await blankPage(browser);
			await page.evaluate((flag) => {
				document.documentElement.dataset.tmEnabled = flag;
				window.$ = () => ({ ready() {}, width: () => 1400, on() {} });
				window.frappe = { provide() {}, ui: { Sidebar: class Native {} }, router: null };
				window.__native = window.frappe.ui.Sidebar;
			}, tmEnabled);
			await page.addScriptTag({ content: sidebarClassSrc }).catch(() => {});
			const same = await page.evaluate(() => frappe.ui.Sidebar === window.__native);
			await page.close();
			return same;
		};
		check("old sidebar: Frappe's own frappe.ui.Sidebar class is kept when off, replaced when on",
			[await klass("off"), await klass("on")], [true, false]);

		const icon = async (tmEnabled) => {
			const page = await blankPage(browser);
			await page.evaluate((flag) => {
				document.documentElement.dataset.tmEnabled = flag;
				document.body.innerHTML = '<svg id="all-symbols"><symbol id="icon-tm-add"></symbol></svg>';
				window.frappe = { utils: { icon: (name) => name } };
			}, tmEnabled);
			await page.addScriptTag({ content: iconsSrc });
			const r = await page.evaluate(() => frappe.utils.icon("add"));
			await page.close();
			return r;
		};
		check("icons: Themate's set answers when on, Frappe's own name goes through when off",
			[await icon("on"), await icon("off")], ["tm-add", "add"]);
	}

	/* ---- Form side panel: Auto / Left / Right against the page direction ---- */
	{
		const edge = async (themate, dir) => {
			const page = await boot(browser, { themate, dir });
			const v = await page.evaluate(() => document.documentElement.dataset.tmPanel ?? null);
			await page.close();
			return v;
		};
		check("panel side: Auto is the end of the line, in English and in Arabic",
			[await edge({}, "ltr"), await edge({}, "rtl")], ["end", "end"]);
		check("panel side: Left is the start in English, the end in Arabic",
			[await edge({ form_panel_side: "Left" }, "ltr"), await edge({ form_panel_side: "Left" }, "rtl")], ["start", "end"]);
		check("panel side: Right is the end in English, the start in Arabic",
			[await edge({ form_panel_side: "Right" }, "ltr"), await edge({ form_panel_side: "Right" }, "rtl")], ["end", "start"]);
		check("panel side: the user's choice outranks the site default",
			await edge({ form_panel_side: "Left", user_prefs: { form_panel_side: "Right" } }, "ltr"), "end");
		check("panel side: a stray value falls back to Auto",
			await edge({ form_panel_side: "Sideways" }, "ltr"), "end");
		check("panel side: nothing is written with the theme off",
			await edge({ form_panel_side: "Left", flags: { theme: 0 } }, "ltr"), null);
	}

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
	console.log(`\nadapters: ${pass} passed, ${failures.length} failed`);
	process.exit(failures.length ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

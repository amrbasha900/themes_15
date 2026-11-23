/* The Connections tab survives the form's own setup order.
 *
 * core/form_tabs.js hooks Form.setup_std_layout to split a plain form into
 * Details + Connections. form.js:109 calls setup_std_layout, and form.js:112
 * creates frm.script_manager immediately after — an order Frappe's own
 * comment there says cannot change ("client script must be called after
 * setup - there are no fields_dict attached to the frm otherwise").
 *
 * So anything reached from that hook runs on a form with no script_manager.
 * form.js:2066 set_active_tab ends in script_manager.trigger("on_tab_change"),
 * and place() calls it straight away, which threw
 *
 *   TypeError: Cannot read properties of undefined (reading 'trigger')
 *
 * on every plain form. The try/catch around place() swallowed it into a
 * console warning and took the rest of update() with it, so the bar was left
 * with no decided active tab. Frappe's native tabs never hit this because
 * they only reach set_active_tab through a shown.bs.tab event, which fires
 * long after setup.
 *
 * These run the real file against a form mocked at exactly that moment.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BENCH = path.resolve(ROOT, "../..");
const JQUERY = path.join(BENCH, "apps/frappe/node_modules/jquery/dist/jquery.min.js");

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

const formTabsSrc = fs.readFileSync(path.join(ROOT, "themate/public/js/core/form_tabs.js"), "utf8");

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

/* A form at the moment setup_std_layout runs: layout built, dashboard
 * parented, docname known, script_manager NOT yet created. */
const MOCK = `
window.__warnings = [];
const realWarn = console.warn;
console.warn = function (...a) { window.__warnings.push(a.map(String).join(" ")); realWarn.apply(console, a); };

window.__ = (s) => s;
window.themate = { enabled: () => true };
window.frappe = {
  scrub: (s, r) => String(s).toLowerCase().replace(/ /g, r || "_"),
  utils: { escape_html: (s) => String(s) },
  ui: { form: {} },
};
frappe.ui.form.Dashboard = class Dashboard {
  refresh() {} show() {} hide() {} update_badges() {}
};
frappe.ui.form.Form = class Form {
  constructor() {
    this.doctype = "Probe";
    this.docname = "PROBE-0001";
    this.meta = { istable: 0 };
    this.dashboard = { parent: $('<div class="form-dashboard visible-section"></div>') };
    const wrapper = $('<div class="form-layout"></div>').appendTo("body");
    const page = $('<div class="form-page"></div>').appendTo(wrapper);
    $('<div class="form-section"></div>').appendTo(page);
    page.append(this.dashboard.parent);
    this.layout = {
      tabs: [],
      page,
      wrapper,
      setup_tabbed_layout() {
        $('<div class="form-tabs-list"><ul class="nav form-tabs"></ul></div>').appendTo(this.page);
        this.tab_link_container = this.page.find(".form-tabs");
        this.tabs_content = $('<div class="form-tab-content tab-content"></div>').appendTo(this.page);
      },
    };
  }
  setup_std_layout() { this.__native_ran = true; }
  /* form.js:2066, verbatim in behaviour */
  set_active_tab(tab) {
    if (!this.active_tab_map) this.active_tab_map = {};
    this.active_tab_map[this.docname] = tab;
    this.script_manager.trigger("on_tab_change");
  }
  get_active_tab() { return this.active_tab_map && this.active_tab_map[this.docname]; }
};
/* Bootstrap's .tab() is all form_tabs.js uses from bootstrap */
$.fn.tab = function () { return this; };
`;

(async () => {
	const { chromium } = require("playwright");
	const browser = await chromium.launch({ executablePath: chromiumPath() });
	const page = await browser.newPage();
	await page.route("**/*", (route) =>
		route.fulfill({ status: 200, contentType: "text/html", body: "<!DOCTYPE html><html><body></body></html>" })
	);
	await page.goto("http://themate.test/");
	await page.addScriptTag({ content: fs.readFileSync(JQUERY, "utf8") });
	await page.addScriptTag({ content: MOCK });
	await page.addScriptTag({ content: formTabsSrc });

	/* ---- setup order: no script_manager yet ------------------------------- */
	const out = await page.evaluate(() => {
		const frm = new frappe.ui.form.Form();
		frm.setup_std_layout(); /* form.js:109 — script_manager does not exist */
		return {
			warnings: window.__warnings.slice(),
			nativeRan: !!frm.__native_ran,
			tabCount: frm.layout.tabs.length,
			labels: frm.layout.tabs.map((t) => t.label),
			/* the half of set_active_tab that update() reads back */
			activeTab: frm.get_active_tab()?.label || null,
			barExists: frm.layout.page.children(".form-tabs-list").length,
			dashboardInConnections:
				frm.layout.tabs[1]?.wrapper.find(".form-dashboard").length || 0,
		};
	});

	check("setup: no error is swallowed into a warning", out.warnings, []);
	check("setup: Frappe's own setup_std_layout still ran", out.nativeRan, true);
	check("setup: a plain form becomes Details + Connections", out.labels, ["Details", "Connections"]);
	check("setup: the tab bar is on the page", out.barExists, 1);
	check("setup: the dashboard moved into Connections", out.dashboardInConnections, 1);
	/* update() runs to completion only if set_active() did not throw */
	check("setup: update() finished and decided an active tab", out.activeTab, "Details");

	/* ---- once the form is set up, the real event must fire ---------------- */
	const later = await page.evaluate(() => {
		const frm = new frappe.ui.form.Form();
		frm.setup_std_layout();
		const fired = [];
		frm.script_manager = { trigger: (e) => fired.push(e) }; /* form.js:112 */
		frm._tm_tabs.details.set_active();
		return { fired, activeTab: frm.get_active_tab()?.label || null };
	});
	check("after setup: on_tab_change fires once there is something to fire it on",
		later.fired, ["on_tab_change"]);
	check("after setup: and the tab is still recorded", later.activeTab, "Details");

	await page.close();
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
	console.log(`\nform tabs: ${pass} passed, ${failures.length} failed`);
	process.exit(failures.length ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

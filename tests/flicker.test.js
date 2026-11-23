/* Page changes that paint something the person should never see.
 *
 * Each of these was found by recording the paint frames of a real desk
 * (Chrome's screencast, one frame per paint) and reading them in order:
 *
 *  1. list -> form: the form page was switched to at once and its outline
 *     drawn 200ms later, so a blank white page stood between the list and
 *     every form (form_skeleton.js + loading.js);
 *  2. every page load: the sidebar was drawn, thrown away and drawn again
 *     when Frappe's workspace view called make_sidebar, its labels fading
 *     in both times (modern_sidebar.js, _modern-sidebar.scss);
 *  3. every lazy bundle (frappe.require: startup, build events, the
 *     onboarding video, the chart engine) faded Frappe's #freeze layer — a
 *     0.8 grey sheet over the whole desk — in and out (_modals.scss);
 *  4. a workspace reload: the dashboard skeleton was pushed below the fold
 *     by an empty 630px editor while blocks.js had the holder renamed, and
 *     two differently shaped skeletons followed each other (_workspace.scss,
 *     tabs.js); Frappe's block skeleton went before the editor had drawn a
 *     block (blocks.js);
 *  5. the workspace page title read "Workspace" and then its real name
 *     (page_head.js);
 *  6. "Sort by" was made after the filter bar, into the row the bar hides,
 *     and was gone from every list (list_filters.js).
 *
 * Timing is tested against the clock, markup against the real files run on
 * mocks of Frappe's shapes, and the CSS against the built bundle. */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BENCH = path.resolve(ROOT, "../..");
const JS_DIR = path.join(ROOT, "themate/public/js");
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

const read = (rel) => fs.readFileSync(path.join(JS_DIR, rel), "utf8");

function builtCss(dirName) {
	const dir = path.resolve(ROOT, `../../sites/assets/themate/dist/${dirName}`);
	if (!fs.existsSync(dir)) return null;
	const file = fs.readdirSync(dir).find((f) => /^themate\.bundle\..*\.css$/.test(f));
	return file ? fs.readFileSync(path.join(dir, file), "utf8") : null;
}

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
	const { chromium } = require("playwright");
	const browser = await chromium.launch({ executablePath: chromiumPath() });

	async function fresh() {
		const page = await browser.newPage();
		await page.route("**/*", (route) =>
			route.fulfill({ status: 200, contentType: "text/html", body: "<!DOCTYPE html><html><body></body></html>" })
		);
		await page.goto("http://themate.test/");
		await page.addScriptTag({ content: fs.readFileSync(JQUERY, "utf8") });
		return page;
	}

	/* ---- 1. list -> form ---------------------------------------------------- */
	{
		const page = await fresh();
		await page.addScriptTag({
			content: `
			window.__ = (s) => s;
			window.__switches = [];
			window.__atSwitch = [];
			window.__route = "Form/Project/P-1";
			window.frappe = {
				views: {
					FormFactory: class { fetch_and_render() {} render() {} },
					formview: {},
				},
				container: {
					change_to(layout) {
						window.__switches.push(layout);
						$(document).trigger("page-change");
						/* what the next paint would show: anything the switch's own
						 * task adds is in by the time a microtask runs */
						queueMicrotask(() => window.__atSwitch.push(!!document.querySelector(".tm-form-skeleton")));
					},
				},
				get_route_str: () => window.__route,
			};
			const el = document.createElement("div");
			el.className = "page-container";
			el.innerHTML = '<div class="layout-main-section"><div class="form-layout">previous record</div></div>';
			document.body.appendChild(el);
			frappe.views.formview.Project = $(el);`,
		});
		await page.addScriptTag({ content: read("core/loading.js").replace(/^export /gm, ""), type: "module" });
		await page.waitForFunction(() => !!window.themate?.pending);
		await page.addScriptTag({ content: read("core/form_skeleton.js").replace(/^import \{ pending \} from "\.\/loading";$/m, "const { pending } = window.themate;") });

		const state = () => page.evaluate(() => ({
			switches: window.__switches.length,
			skeleton: !!document.querySelector(".tm-form-skeleton"),
			loading: !!document.querySelector("[data-tm-form-loading]"),
		}));
		const reset = () => page.evaluate(() => { window.__switches = []; window.__atSwitch = []; window.__route = "Form/Project/P-1"; });

		/* fast: the document is back inside the delay */
		await page.evaluate(() => { window.__f = new frappe.views.FormFactory(); __f.fetch_and_render("Project", "P-1", "Project"); });
		await sleep(60);
		await page.evaluate(() => __f.render());
		await sleep(300);
		check("form, fast: the page is not switched ahead of Frappe's render", (await state()).switches, 0);
		check("form, fast: and nothing is drawn", (await state()).skeleton, false);

		/* slow: switch and outline together, once the wait can be felt */
		await reset();
		await page.evaluate(() => __f.fetch_and_render("Project", "P-2", "Project"));
		await sleep(120);
		check("form, slow: at 120ms the list is still what shows", (await state()).switches, 0);
		await sleep(180);
		const slow = await state();
		check("form, slow: at 300ms the form page is switched to, once", slow.switches, 1);
		check("form, slow: with its outline drawn in the same task (no blank frame)", await page.evaluate(() => window.__atSwitch), [true]);
		check("form, slow: the previous record is held out of sight", slow.loading, true);
		check("form, slow: our own page-change did not cancel the outline", slow.skeleton, true);
		await page.evaluate(() => __f.render());
		await sleep(250);
		check("form, slow: the document's render takes the outline away", (await state()).skeleton, false);

		/* routed away before the delay */
		await reset();
		await page.evaluate(() => { __f.fetch_and_render("Project", "P-3", "Project"); });
		await sleep(80);
		await page.evaluate(() => { window.__route = "List/Project/List"; $(document).trigger("page-change"); });
		await sleep(300);
		const away = await state();
		check("form, abandoned: the page that was left is never switched to", [away.switches, away.skeleton], [0, false]);
		await page.close();
	}

	/* ---- 2. the sidebar, 5. the workspace title ------------------------------ */
	{
		const page = await fresh();
		await page.addScriptTag({
			content: `
			window.__ = (s) => s;
			window.__calls = [];
			window.frappe = {
				provide() {},
				ui: {
					Page: class { set_title_sub() {} },
				},
				views: { Workspace: class { show() { this.shown = (this.shown || 0) + 1; } } },
				standard_pages: {
					Workspaces() {
						const w = document.createElement("div");
						w.className = "page-container";
						document.body.appendChild(w);
						frappe.pages.Workspaces = w;
					},
				},
				pages: {},
				get_route: () => ["Workspaces"],
				call(o) { window.__calls.push(o); },
			};
			window.themate = { enabled: () => true };`,
		});
		await page.addScriptTag({ content: read("sidebar/modern_sidebar.js") });
		await page.addScriptTag({ content: read("core/page_head.js") });
		const out = await page.evaluate(async () => {
			const proto = frappe.ui.ModernSidebar.prototype;
			const pages = [
				{ name: "Home", title: "Home", icon: "home", public: 1 },
				{ name: "Projects", title: "Projects", icon: "project", public: 1 },
			];
			const bar = Object.create(proto);
			bar.sidebar_menu = $('<div><div class="modern-sidebar-section" data-group="Operations"></div></div>');
			bar.setup_workspace_menu = () => { bar.rebuilt = (bar.rebuilt || 0) + 1; };
			bar.update_active_items = () => { bar.marked = (bar.marked || 0) + 1; };
			bar._ws_signature = proto.workspace_signature(pages);
			bar.refresh_workspaces(pages.map((p) => ({ ...p })));
			const same = { rebuilt: bar.rebuilt || 0, marked: bar.marked || 0 };
			bar.refresh_workspaces([...pages, { name: "Mine", title: "Mine", public: 0, for_user: "a@b.c" }]);
			const changed = bar.rebuilt || 0;

			bar.sidebar = $('<div class="modern-sidebar"></div>');
			bar.settings = {};
			proto.toggle_sidebar.call(bar);
			const during = bar.sidebar.hasClass("tm-sb-toggling") && bar.sidebar.hasClass("collapsed");
			await new Promise((r) => setTimeout(r, 420));
			const after = bar.sidebar.hasClass("tm-sb-toggling");

			frappe.standard_pages.Workspaces();
			const w = frappe.pages.Workspaces;
			const pending = w.classList.contains("tm-title-pending");
			const ws = new frappe.views.Workspace();
			ws.wrapper = $(w);
			ws.show();
			const stillPending = w.classList.contains("tm-title-pending");
			ws.all_pages = [];
			ws.show();
			return { same, changed, during, after, pending, stillPending, named: !w.classList.contains("tm-title-pending"), shown: ws.shown };
		});
		check("sidebar: the same workspace list is not redrawn", out.same, { rebuilt: 0, marked: 1 });
		check("sidebar: a changed list is", out.changed, 1);
		check("sidebar: labels animate while it is toggled", out.during, true);
		check("sidebar: and only then", out.after, false);
		check("workspace title: Frappe's placeholder is held while the list loads", [out.pending, out.stillPending], [true, true]);
		check("workspace title: and shown once show() has named the page", [out.named, out.shown], [true, 2]);
		await page.close();
	}

	/* ---- 6. Sort by --------------------------------------------------------- */
	{
		const page = await fresh();
		await page.addScriptTag({
			content: `
			window.__ = (s) => s;
			window.cint = (v) => parseInt(v, 10) || 0;
			window.frappe = {
				views: { BaseList: class { setup_filter_area() {} get_args() { return {}; } refresh() {} } },
				db: { count() {} },
				utils: { escape_html: (s) => s, icon: () => "<svg></svg>" },
				ui: {
					SortSelector: class {
						constructor(o) { Object.assign(this, o); this.make(); }
						make() {
							this.parent.find(".sort-selector").remove();
							this.wrapper = $('<div class="sort-selector"><div class="btn-group"><button class="btn-order"></button><button class="sort-selector-button"><span class="dropdown-text">Last Updated On</span></button></div></div>').appendTo(this.parent);
						}
					},
				},
			};
			document.body.innerHTML =
				'<div id="list" class="page-form"><div class="tm-fbar"></div><div class="filter-section"></div></div>' +
				'<div id="other" class="page-form"><div class="filter-section"></div></div>';`,
		});
		await page.addScriptTag({ content: read("core/list_filters.js") });
		const out = await page.evaluate(() => {
			const list = new frappe.ui.SortSelector({ parent: $("#list .filter-section") });
			/* the Report view's GroupBy: inserted before .sort-selector (group_by.js:229) */
			$("#list").find(".sort-selector").before('<div class="group-by-selector"></div>');
			const plain = new frappe.ui.SortSelector({ parent: $("#other .filter-section") });
			/* read now: a second selector on the same row removes this one (sort_selector.js:17) */
			const noBar = plain.wrapper.parent().hasClass("filter-section");
			window.themate = { enabled: () => false };
			document.querySelector("#other").insertAdjacentHTML("afterbegin", '<div class="tm-fbar"></div>');
			const off = new frappe.ui.SortSelector({ parent: $("#other .filter-section") });
			return {
				inBar: list.wrapper.parent().hasClass("tm-fbar"),
				cls: list.wrapper.hasClass("tm-fsort"),
				label: list.wrapper.find(".sort-selector-button").text(),
				order: $("#list .tm-fbar").children().map((i, el) => el.className.split(" ")[0]).get(),
				noBar,
				off: off.wrapper.parent().hasClass("filter-section"),
			};
		});
		check("sort: Frappe's sort control lands in the filter bar", [out.inBar, out.cls], [true, true]);
		check("sort: and says what it is", out.label, "Sort byLast Updated On");
		check("sort: the Report view's Add Group follows it in", out.order, ["group-by-selector", "sort-selector"]);
		check("sort: a view without the bar keeps Frappe's placement", out.noBar, true);
		check("sort: so does the theme switched off", out.off, true);
		await page.close();
	}

	await browser.close();

	/* ---- 3, 4 and the rest: the built CSS ------------------------------------ */
	for (const [dir, label] of [["css", "ltr"], ["css-rtl", "rtl"]]) {
		const css = builtCss(dir);
		if (!css) {
			check(`css (${label}): built bundle found`, false, true);
			continue;
		}
		check(`css (${label}): the freeze layer shows only after 400ms, and not for the grid editor`,
			css.includes("#freeze:not(.grid-form){transition:opacity .15s linear .4s}"), true);
		check(`css (${label}): sidebar labels fade only while toggling`,
			css.includes(".modern-sidebar.tm-sb-toggling:not(.collapsed) .sidebar-item-label{animation:") &&
				!/\.modern-sidebar:not\(\.collapsed\) \.sidebar-item-label\{animation/.test(css), true);
		check(`css (${label}): the sidebar animates its width and position, never all of it`,
			/--sidebar-transition:\s*width [^;]*transform/.test(css) && !/--sidebar-transition:\s*all/.test(css), true);
		check(`css (${label}): the workspace placeholder title keeps its line, unseen`,
			css.includes(".tm-title-pending .page-head .title-text{visibility:hidden}"), true);
		const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
		check(`css (${label}): every weekday can be the weekend`,
			days.every((d, i) => css.includes(`[data-tm-weekend~="${i}"] .fc-bg td.fc-day.fc-${d}{background-image:`)), true);
	}

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
	console.log(`\nflicker: ${pass} passed, ${failures.length} failed`);
	process.exit(failures.length ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

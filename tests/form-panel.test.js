/* The record's side panel folds to a rail and back (core/form_overview.js,
 * _form-page.scss).
 *
 * Measured with the built desk and theme stylesheets (LTR and RTL), the page
 * markup page.html writes and the sidebar form_sidebar.html writes, and the
 * real form_overview.js on a saved record. What matters is geometry and
 * memory: the form gains the panel's width, the rail stays a rail on the
 * next record, and the narrow-screen drawer never folds. */

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

function pick(dir, re) {
	if (!fs.existsSync(dir)) return "";
	const f = fs.readdirSync(dir).find((x) => re.test(x));
	return f ? fs.readFileSync(path.join(dir, f), "utf8") : "";
}

const css = {
	ltr: [pick(path.join(BENCH, "sites/assets/frappe/dist/css"), /^desk\.bundle\..*\.css$/), pick(path.join(BENCH, "sites/assets/themate/dist/css"), /^themate\.bundle\..*\.css$/)],
	rtl: [pick(path.join(BENCH, "sites/assets/frappe/dist/css-rtl"), /^desk\.bundle\..*\.css$/), pick(path.join(BENCH, "sites/assets/themate/dist/css-rtl"), /^themate\.bundle\..*\.css$/)],
};
const overviewSrc = fs.readFileSync(path.join(ROOT, "themate/public/js/core/form_overview.js"), "utf8");
const scrollSrc = fs.readFileSync(path.join(ROOT, "themate/public/js/core/scroll_chrome.js"), "utf8");

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

/* page.html's layout, the form sidebar as form_sidebar.html writes it */
const SIDEBAR = `<div class="form-sidebar overlay-sidebar hidden-xs hidden-sm">
	<ul class="list-unstyled sidebar-menu user-actions hidden"></ul>
	<ul class="list-unstyled sidebar-menu form-assignments"><li><span class="form-sidebar-items"><span class="add-assignment-label"><span class="ellipsis">Assigned To</span></span><button class="add-assignment-btn btn btn-link icon-btn">+</button></span><div class="assignments"></div></li></ul>
	<ul class="list-unstyled sidebar-menu form-attachments"><li class="attachments-actions"><span class="form-sidebar-items"><span><a class="pill-label ellipsis explore-link">Attachments</a></span><button class="add-attachment-btn btn btn-link icon-btn">+</button></span></li></ul>
	<ul class="list-unstyled sidebar-menu form-tags"><li><span class="form-sidebar-items"><span>Tags</span></span></li></ul>
	<ul class="list-unstyled sidebar-menu text-muted"><li class="pageview-count">Rawda Islam last edited this</li></ul>
</div>`;

const pageHtml = (dir) => `<!DOCTYPE html>
<html dir="${dir}" data-tm-enabled="on" data-tm-form="on"><head>
<style>${css[dir][0]}</style><style>${css[dir][1]}</style><style>body{margin:0}</style></head>
<body><div class="page-head"><span class="indicator-pill orange">50%</span></div>
<div class="page-container" id="page-Leave"><div class="container page-body"><div class="page-wrapper"><div class="page-content">
<div class="row layout-main">
	<div class="col-lg-2 layout-side-section">${SIDEBAR}</div>
	<div class="col layout-main-section-wrapper"><div class="layout-main-section"><div class="form-layout"><div class="form-page"><div class="form-section card-section">Details</div></div></div></div></div>
</div></div></div></div></div></body></html>`;

const MOCK = `
window.__ = (s, r) => (r ? String(s).replace(/{(\\d+)}/g, (m, i) => r[i]) : s);
window.__saved = [];
const state = { forms: {} };
window.themate = {
	enabled: () => true,
	deskState: {
		get: (s, k) => state[s]?.[k] ?? null,
		set: (s, k, v) => { state[s][k] = Object.assign({}, state[s][k], v); window.__saved.push([s, k, v]); },
	},
};
window.frappe = {
	utils: { escape_html: (s) => String(s ?? ""), icon: (n) => '<svg class="icon icon-sm" viewBox="0 0 10 10"><path d="M7 1 3 5l4 4"/></svg>' },
	meta: { get_docfield: (dt, fn) => window.FIELDS.find((d) => d.fieldname === fn) },
	format: (v) => String(v ?? ""),
};
window.FIELDS = [
	{ fieldname: "employee_name", label: "Employee Name", fieldtype: "Data", in_list_view: 1 },
	{ fieldname: "from_date", label: "From Date", fieldtype: "Date", reqd: 1 },
];
window.frm = {
	doctype: "Leave Application", docname: "HR-LAP-0001",
	meta: { name: "Leave Application", fields: window.FIELDS, title_field: "employee_name" },
	doc: { employee_name: "Rawda Islam", from_date: "2026-09-21" },
	is_new: () => false,
	$wrapper: $(".page-container"),
};
window.refresh = () => $(document).trigger("form-refresh", [frm]);
`;

const geometry = (page) => page.evaluate(() => {
	const side = document.querySelector(".layout-side-section");
	const fold = document.querySelector(".tm-panel-fold");
	const svg = fold?.querySelector("svg");
	const shown = (el) => !!el && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
	return {
		side: Math.round(side.getBoundingClientRect().width),
		main: Math.round(document.querySelector(".layout-main-section-wrapper").getBoundingClientRect().width),
		rail: side.classList.contains("tm-panel-rail"),
		fold: shown(fold),
		expanded: fold?.getAttribute("aria-expanded"),
		chevron: svg ? getComputedStyle(svg).transform : null,
		rows: shown(document.querySelector(".form-assignments")),
		fields: shown(document.querySelector(".tm-overview-fields")),
		label: getComputedStyle(document.querySelector(".tm-overview .tm-panel-label")).writingMode,
		labelText: document.querySelector(".tm-overview .tm-panel-label").textContent,
	};
});

const MIRROR = "matrix(-1, 0, 0, 1, 0, 0)";

/* where the panel, the form and the fold chevron sit, left to right */
const place = (page) => page.evaluate(() => {
	const box = (sel) => document.querySelector(sel).getBoundingClientRect();
	const side = box(".layout-side-section"), main = box(".layout-main-section-wrapper"), fold = box(".tm-panel-fold");
	const fs = document.querySelector(".layout-side-section .form-sidebar");
	return {
		panel: side.left < main.left ? "left" : "right",
		fold: fold.left + fold.width / 2 < side.left + side.width / 2 ? "left" : "right",
		overflow: getComputedStyle(fs).overflowY,
		scrolls: fs.scrollHeight > fs.clientHeight + 1,
		chevron: getComputedStyle(document.querySelector(".tm-panel-fold svg")).transform,
	};
});
/* a DOM click: without the navbar above it, this page's sticky head sits
 * over the panel's top edge, which a pointer click would hit instead */
const click = (page, sel) => page.$eval(sel, (el) => el.click());

(async () => {
	if (!css.ltr[1] || !css.ltr[0] || !css.rtl[1]) {
		console.log("  FAIL form-panel: built stylesheets not found — run `bench build --app themate`");
		process.exit(1);
	}
	const { chromium } = require("playwright");
	const browser = await chromium.launch({ executablePath: chromiumPath() });

	for (const dir of ["ltr", "rtl"]) {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const errors = [];
		page.on("pageerror", (e) => errors.push(String(e.message)));
		await page.setContent(pageHtml(dir));
		await page.addScriptTag({ path: JQUERY });
		await page.addScriptTag({ content: MOCK });
		await page.addScriptTag({ content: overviewSrc });
		await page.evaluate(() => refresh());

		const open = await geometry(page);
		check(`${dir}: the panel opens beside the form, with the fold chevron`, [open.side, open.rail, open.fold, open.expanded], [300, false, true, "true"]);
		check(`${dir}: the chevron points at the edge it folds to`, open.chevron, dir === "ltr" ? MIRROR : "none");

		await click(page, ".tm-panel-fold");
		const folded = await geometry(page);
		check(`${dir}: folded, the panel is a 44px rail`, [folded.side, folded.rail, folded.expanded], [44, true, "false"]);
		check(`${dir}: and the form takes the room`, folded.main - open.main, 300 - 44);
		check(`${dir}: the rail keeps the chevron and the panel's name, sideways`, [folded.fold, folded.label, folded.labelText], [true, "vertical-rl", "Leave Application Overview"]);
		check(`${dir}: the panel's rows are out of the rail`, [folded.rows, folded.fields], [false, false]);
		check(`${dir}: the chevron turns to point back`, folded.chevron, dir === "ltr" ? "none" : MIRROR);
		check(`${dir}: the choice is remembered for every form`, await page.evaluate(() => __saved.pop()), ["forms", "_panel", { rail: 1 }]);

		/* the next record (or this one, saved) opens folded */
		await page.evaluate(() => refresh());
		check(`${dir}: the next record opens folded`, (await geometry(page)).side, 44);

		await click(page, ".tm-overview .tm-panel-label");
		const reopened = await geometry(page);
		check(`${dir}: a click on the rail opens it again`, [reopened.side, reopened.rows, reopened.fields], [300, true, true]);

		/* Theme Customizer > Form Side Panel: html[data-tm-panel] puts the panel
		 * on the start edge. Left in English, right in Arabic — and the chevron
		 * keeps pointing at the screen edge the panel sits against. */
		const outer = (d, edge) => (edge === "end") === (d === "ltr") ? "right" : "left";
		const end = await place(page);
		check(`${dir}: by default the panel is on the end edge, chevron in its outer corner`,
			[end.panel, end.fold, end.chevron], [outer(dir, "end"), outer(dir, "end"), dir === "ltr" ? MIRROR : "none"]);
		check(`${dir}: a short panel does not scroll`, [end.overflow, end.scrolls], ["auto", false]);

		await page.evaluate(() => { document.documentElement.dataset.tmPanel = "start"; });
		const start = await place(page);
		check(`${dir}: on the start edge the panel moves across, chevron to its new outer corner`,
			[start.panel, start.fold], [outer(dir, "start"), outer(dir, "start")]);
		check(`${dir}: and the chevron points at that screen edge`, start.chevron, dir === "ltr" ? "none" : MIRROR);
		check(`${dir}: the panel keeps its width and the form its room`, [(await geometry(page)).side, (await geometry(page)).main], [300, reopened.main]);

		await click(page, ".tm-panel-fold");
		const startRail = await geometry(page);
		const startRailAt = await place(page);
		check(`${dir}: folded on the start edge it is still a 44px rail beside the form`, [startRail.side, startRail.main - folded.main, startRailAt.panel], [44, 0, outer(dir, "start")]);
		check(`${dir}: and the chevron points back at the form`, startRail.chevron, dir === "ltr" ? MIRROR : "none");
		await click(page, ".tm-panel-fold");
		await page.evaluate(() => { document.documentElement.dataset.tmPanel = "end"; });
		check(`${dir}: back on the end edge nothing is left behind`, [(await place(page)).panel, (await geometry(page)).side], [outer(dir, "end"), 300]);
		check(`${dir}: no page errors`, errors, []);
		await page.close();
	}

	/* Scrolling: the page head tucks away going down and comes back going
	 * up (core/scroll_chrome.js). The panel sticks under the head while it
	 * shows, and under the navbar once it is tucked — never behind it. */
	{
		const page = await browser.newPage({ viewport: { width: 1440, height: 700 } });
		await page.setContent(pageHtml("ltr").replace('<div class="form-section card-section">Details</div>', '<div class="form-section card-section" style="height:3000px">Details</div>'));
		await page.addScriptTag({ path: JQUERY });
		await page.addScriptTag({ content: MOCK });
		await page.addScriptTag({ content: overviewSrc });
		await page.evaluate(() => {
			frappe.ui = { Page: class {} };
			frappe.container = { page: document.querySelector(".page-container") };
			refresh();
		});
		await page.addScriptTag({ content: scrollSrc });
		/* two frames for the scroll handler, then the 0.5s the offset eases over */
		const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 600)))));
		const state = () => page.evaluate(() => {
			const side = document.querySelector(".layout-side-section");
			const head = document.querySelector(".page-head");
			return {
				tucked: document.querySelector(".page-container").classList.contains("tm-head-tucked"),
				top: parseFloat(getComputedStyle(side).top),
				headBottom: parseFloat(getComputedStyle(head).top) + parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--page-head-height")),
			};
		});
		const rest = await state();
		await page.evaluate(() => window.scrollTo(0, 800));
		await frame();
		const down = await state();
		await page.evaluate(() => window.scrollTo(0, 600));
		await frame();
		const back = await state();
		check("scroll: at rest the panel sticks below the page head", rest.top >= rest.headBottom, true);
		check("scroll: scrolling down tucks the head and lifts the panel under the navbar", [down.tucked, down.top < rest.top], [true, true]);
		check("scroll: scrolling back up brings the head back and the panel below it", [back.tucked, back.top], [false, rest.top]);

		/* Many attachments: the card is as tall as the screen allows and
		 * scrolls inside itself. Left at full height, a sticky panel shows
		 * only its top until the page is scrolled to its very end. */
		await page.evaluate(() => {
			const list = document.querySelector(".form-attachments");
			for (let i = 1; i <= 30; i++) {
				const li = document.createElement("li");
				li.className = "attachment-row";
				li.style.height = "40px";
				li.textContent = "Quotation-" + i + ".csv";
				list.appendChild(li);
			}
			window.scrollTo(0, 0);
		});
		await frame();
		const card = () => page.evaluate(() => {
			const fs = document.querySelector(".layout-side-section .form-sidebar");
			const r = fs.getBoundingClientRect();
			const last = [...fs.querySelectorAll(".attachment-row")].pop().getBoundingClientRect();
			return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, tall: fs.scrollHeight, shown: fs.clientHeight, lastIn: last.bottom <= innerHeight && last.top >= 0, y: fs.scrollTop };
		});
		const tall = await card();
		check("scroll: a tall panel stops above the bottom of the screen", [tall.bottom <= tall.vh, tall.tall > tall.shown + 500], [true, true]);
		await page.evaluate(() => window.scrollTo(0, 800));
		await frame();
		const lifted = await card();
		check("scroll: with the head tucked it takes the room that frees, never more", [lifted.bottom <= lifted.vh, lifted.shown > tall.shown], [true, true]);
		await page.evaluate(() => { const fs = document.querySelector(".layout-side-section .form-sidebar"); fs.scrollTop = fs.scrollHeight; });
		const end = await card();
		check("scroll: the panel's own scroll reaches its last row without scrolling the page", [end.lastIn, end.y > 0, await page.evaluate(() => scrollY)], [true, true, 800]);
		await page.close();
	}

	/* Narrow: Frappe's drawer. Nothing folds, and a click in it (on
	 * "Assigned To") does not flip the desktop choice. */
	{
		const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
		await page.setContent(pageHtml("ltr"));
		await page.addScriptTag({ path: JQUERY });
		await page.addScriptTag({ content: MOCK });
		await page.addScriptTag({ content: overviewSrc });
		await page.evaluate(() => {
			themate.deskState.set("forms", "_panel", { rail: 1 });
			refresh();
			/* the drawer, opened (page.js setup_overlay_sidebar) */
			document.querySelector(".form-sidebar").classList.add("opened");
			document.querySelector(".form-assignments").click();
		});
		const g = await geometry(page);
		check("drawer: no fold chevron", g.fold, false);
		check("drawer: a click in it leaves the choice alone", await page.evaluate(() => themate.deskState.get("forms", "_panel")), { rail: 1 });
		await page.close();
	}

	await browser.close();
	const failed = results.filter((r) => !r.pass);
	results.forEach((r) => console.log(`  ${r.pass ? "ok  " : "FAIL"} ${r.name}${r.pass ? "" : `\n        got      ${r.actual}\n        expected ${r.expected}`}`));
	console.log(`\nform panel: ${results.length - failed.length} passed, ${failed.length} failed`);
	process.exit(failed.length ? 1 : 0);
})();

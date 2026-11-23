/* The page head stays one line tall.
 *
 * Frappe's head is a fixed 60px box around a Bootstrap .row that wraps. On a
 * User form at 1110px beside the collapsed sidebar (a laptop at 125% zoom),
 * the icon box, the title, another viewer's avatar, three custom buttons, the
 * icon group, ⋯ and Save did not fit, and the buttons dropped to a second
 * line painted over the tab bar and the document panel (reported with a
 * screenshot). layout/_page.scss stops the wrap and lets the title give way;
 * core/page_fit.js moves the custom buttons into the ⋯ menu, then drops the
 * icon group, only while the head still overflows.
 *
 * These run the built stylesheets and the real page_fit.js against Frappe's
 * page.html markup, and measure: whether the buttons reach the tab bar is a
 * question of geometry, which a selector being present cannot answer. The
 * "sidebar" is a margin on the page, so the viewport stays desktop-wide (≥992px) —
 * where Frappe's own breakpoint swap does NOT happen and the defect lived.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BENCH = path.resolve(ROOT, "../..");

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

const deskCss = pick(path.join(BENCH, "sites/assets/frappe/dist/css"), /^desk\.bundle\..*\.css$/);
const tmCss = pick(path.join(BENCH, "sites/assets/themate/dist/css"), /^themate\.bundle\..*\.css$/);
const fitSrc = fs.readFileSync(path.join(ROOT, "themate/public/js/core/page_fit.js"), "utf8");

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

/* ui/page.html, with what form.js adds: the viewers slot prepended to the
 * actions (form.js:102) and each custom button mirrored in the ⋯ menu as a
 * .hidden-xl item, on the <li> and its link (ui/page.js add_inner_button). */
const CUSTOM = ["Permissions", "Password", "Create User Email"];
const customHtml = CUSTOM.map(
	(l) => `<div class="inner-group-button"><button type="button" class="btn btn-default btn-sm ellipsis">${l}</button></div>`
).join("");
const mirrorHtml = CUSTOM.map(
	(l) => `<li class="user-action hidden-xl"><a class="grey-link dropdown-item hidden-xl" href="#"><span class="menu-item-label">${l}</span></a></li>`
).join("");

const pageHtml = ({ themed = true, buttons = true, rtl = false } = {}) => `<!DOCTYPE html>
<html dir="${rtl ? "rtl" : "ltr"}" data-tm-enabled="${themed ? "on" : "off"}" data-tm-form="${themed ? "on" : "off"}"><head>
<style>${deskCss}</style><style>${tmCss}</style>
<style>body{margin:0} .icon{width:16px;height:16px}</style></head>
<body><div style="block-size:var(--navbar-height)"></div><div class="page-container" id="shell">
<div class="page-head flex"><div class="container">
 <div class="row flex align-center page-head-content justify-between">
  <div class="col-md-4 col-sm-6 col-xs-7 page-title">
   <div class="tm-page-icon"><svg class="icon"></svg></div>
   <div class="flex fill-width title-area"><div>
    <div class="flex"><h3 class="ellipsis title-text">Abdelrahman</h3><span class="indicator-pill whitespace-nowrap green"><span>Active</span></span></div>
    <div class="ellipsis sub-heading text-muted">abdelrahman.fakhri@gmail.com</div>
   </div></div>
  </div>
  <div class="flex col page-actions justify-content-end">
   <div class="form-viewers d-flex"><span class="avatar avatar-small"><span class="avatar-frame standard-image">A</span></span></div>
   <div class="custom-actions hidden-xs hidden-md${buttons ? "" : " hide"}">${buttons ? customHtml : ""}</div>
   <div class="standard-actions flex">
    <span class="page-icon-group hidden-xs hidden-sm">${'<button class="btn btn-default icon-btn"><svg class="icon"></svg></button>'.repeat(4)}</span>
    <div class="menu-btn-group"><button type="button" class="btn btn-default icon-btn">…</button>
     <ul class="dropdown-menu dropdown-menu-right show" role="menu">${buttons ? mirrorHtml : ""}<li><a class="grey-link dropdown-item" href="#">Print</a></li></ul></div>
    <button class="btn btn-primary btn-sm primary-action">Save</button>
   </div>
  </div>
 </div>
</div></div>
<div class="container"><div class="form-tabs-list"><ul class="nav form-tabs"><li class="nav-item"><a class="nav-link">User Details</a></li></ul></div></div>
</div></body></html>`;

const MOCK = `
window.__ = (s) => s;
window.frappe = { ui: { Page: class { setup_page() {} } } };
window.themate = { enabled: () => document.documentElement.dataset.tmEnabled !== "off" };`;

const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function load(browser, width, sidebar, opts) {
	const page = await browser.newPage({ viewport: { width, height: 600 } });
	await page.setContent(pageHtml(opts));
	await page.evaluate((px) => (document.getElementById("shell").style.marginInlineStart = px + "px"), sidebar);
	await page.addScriptTag({ content: MOCK });
	await page.addScriptTag({ content: fitSrc });
	await frame(page);
	return page;
}

async function resize(page, width, sidebar) {
	await page.setViewportSize({ width, height: 600 });
	await page.evaluate((px) => (document.getElementById("shell").style.marginInlineStart = px + "px"), sidebar);
	await frame(page);
}

function state(page) {
	return page.evaluate(() => {
		const head = document.querySelector(".page-head");
		const row = head.querySelector(".page-head-content").getBoundingClientRect();
		const a = head.querySelector(".page-actions").getBoundingClientRect();
		const tabs = document.querySelector(".form-tabs-list").getBoundingClientRect();
		const shown = (s) => [...head.querySelectorAll(s)].some((e) => e.getClientRects().length > 0);
		return {
			steps: ["tm-head-compact", "tm-head-tight"].filter((c) => head.classList.contains(c)),
			/* the reported defect: buttons on top of the tab bar */
			clearOfTabs: a.bottom <= tabs.top,
			withinHead: a.left >= row.left - 1 && a.right <= row.right + 1,
			custom: shown(".custom-actions .btn"),
			icons: shown(".page-icon-group"),
			save: shown(".primary-action") && shown(".menu-btn-group > .btn"),
			mirrors: [...head.querySelectorAll(".dropdown-menu > li.hidden-xl")].filter((li) => li.getBoundingClientRect().height > 0).length,
		};
	});
}

(async () => {
	if (!tmCss || !deskCss) {
		console.log("  FAIL page-head: built stylesheets not found — run `bench build --app themate`");
		process.exit(1);
	}
	const { chromium } = require("playwright");
	const browser = await chromium.launch({ executablePath: chromiumPath() });

	for (const rtl of [false, true]) {
		const dir = rtl ? "rtl" : "ltr";
		const page = await load(browser, 1500, 50, { rtl });
		let s = await state(page);
		check(`${dir} wide: every button on the head, nothing moved`, [s.steps, s.custom, s.icons, s.mirrors], [[], true, true, 0]);
		check(`${dir} wide: one line, clear of the tab bar`, [s.clearOfTabs, s.withinHead], [true, true]);

		/* the report: 1110px beside the collapsed sidebar */
		await resize(page, 1110, 50);
		s = await state(page);
		check(`${dir} 1110 + collapsed sidebar: the title gives way, the buttons stay`, [s.steps, s.custom], [[], true]);
		check(`${dir} 1110 + collapsed sidebar: one line, clear of the tab bar`, [s.clearOfTabs, s.withinHead, s.save], [true, true, true]);

		await resize(page, 1110, 270);
		s = await state(page);
		check(`${dir} 1110 + open sidebar: custom buttons move into the ⋯ menu`, [s.steps, s.custom, s.mirrors, s.icons], [["tm-head-compact"], false, 3, true]);
		check(`${dir} 1110 + open sidebar: one line, clear of the tab bar`, [s.clearOfTabs, s.withinHead, s.save], [true, true, true]);

		await resize(page, 1000, 520);
		s = await state(page);
		check(`${dir} very narrow content: the icon group goes too`, [s.steps, s.icons, s.mirrors], [["tm-head-compact", "tm-head-tight"], false, 3]);
		check(`${dir} very narrow content: one line, Save and ⋯ still there`, [s.clearOfTabs, s.withinHead, s.save], [true, true, true]);

		await resize(page, 1500, 50);
		s = await state(page);
		check(`${dir} widened again: every button comes back`, [s.steps, s.custom, s.icons, s.mirrors], [[], true, true, 0]);
		await page.close();
	}

	/* Frappe adds the custom buttons on refresh, after the head exists: the
	 * head must re-fit without any resize. */
	{
		const page = await load(browser, 1110, 270, { buttons: false });
		let s = await state(page);
		check("buttons added later: nothing to fit before", s.steps, []);
		await page.evaluate(
			([c, m]) => {
				const ca = document.querySelector(".custom-actions");
				ca.innerHTML = c;
				ca.classList.remove("hide");
				document.querySelector(".menu-btn-group .dropdown-menu").insertAdjacentHTML("afterbegin", m);
			},
			[customHtml, mirrorHtml]
		);
		await frame(page);
		s = await state(page);
		check("buttons added later: re-fitted with no resize", [s.steps, s.clearOfTabs, s.withinHead], [["tm-head-compact"], true, true]);
		await page.close();
	}

	/* The defect, to prove the assertions above can fail: theme off, same
	 * head, same width — the buttons wrap onto the tab bar. */
	{
		const page = await load(browser, 1110, 270, { themed: false });
		const s = await state(page);
		check("without the theme the buttons do land on the tab bar (the reported defect)", s.clearOfTabs, false);
		await page.close();
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
	console.log(`\npage head: ${pass} passed, ${failures.length} failed`);
	process.exit(failures.length ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

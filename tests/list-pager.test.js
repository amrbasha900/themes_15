/* The list's pages fit a phone (core/list_pager.js, _list.scss).
 *
 * Reported on a phone: "Page 1 of 6 ‹ 1 2 3 4 … 6 ›" ran past the list
 * card, which clipped it mid-button, with Frappe's "Load More" squeezed in
 * after it. Two causes: the paging row never wrapped (Frappe's .level is a
 * nowrap flex row, and the page sizes 20 / 100 / 500 / 2500 share it), and
 * Load More was hidden by a :has() rule — absent from Safari before 15.4.
 *
 * Measured with the built desk and theme stylesheets, the paging markup as
 * base_list.js setup_paging_area writes it, and the real list_pager.js on a
 * ListView reduced to what it calls. */

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

const deskCss = pick(path.join(BENCH, "sites/assets/frappe/dist/css"), /^desk\.bundle\..*\.css$/);
const tmCss = pick(path.join(BENCH, "sites/assets/themate/dist/css"), /^themate\.bundle\..*\.css$/);
const pagerSrc = fs.readFileSync(path.join(ROOT, "themate/public/js/core/list_pager.js"), "utf8");

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

/* base_list.js setup_paging_area, verbatim in shape */
const PAGING = `<div class="list-paging-area level">
	<div class="level-left"><div class="btn-group">
		${[20, 100, 500, 2500].map((v) => `<button type="button" class="btn btn-default btn-sm btn-paging${v === 20 ? " btn-info" : ""}" data-value="${v}">${v}</button>`).join("")}
	</div></div>
	<div class="level-right"><button class="btn btn-default btn-more btn-sm">Load More</button></div>
</div>`;

const pageHtml = () => `<!DOCTYPE html>
<html dir="ltr" data-tm-enabled="on" data-tm-list="on"><head>
<style>${deskCss}</style><style>${tmCss}</style><style>body{margin:0}</style></head>
<body><div class="page-container"><div class="container page-body"><div class="layout-main-section frappe-card">
<div class="frappe-list"><div class="result"></div>${PAGING}</div></div></div></div></body></html>`;

const MOCK = `
window.__ = (s, r) => (r ? String(s).replace(/{(\\d+)}/g, (m, i) => r[i]) : s);
window.themate = { enabled: () => true };
window.frappe = { utils: { icon: () => "<svg></svg>" }, views: {} };
frappe.views.BaseList = class { refresh() { return Promise.resolve(); } reset_defaults() {} };
frappe.views.ListView = class extends frappe.views.BaseList { get_count_str() { return Promise.resolve(); } render_list() {} };
`;

async function measure(page) {
	return page.evaluate(() => {
		const area = document.querySelector(".list-paging-area");
		const card = document.querySelector(".layout-main-section").getBoundingClientRect();
		const box = area.getBoundingClientRect();
		const shown = [...area.querySelectorAll("button, .tm-pager-label, .tm-pager-gap")].filter((el) => el.offsetParent);
		const outside = shown.filter((el) => {
			const r = el.getBoundingClientRect();
			return r.left < Math.floor(Math.max(box.left, card.left)) || r.right > Math.ceil(Math.min(box.right, card.right));
		}).map((el) => el.textContent.trim());
		return {
			overflow: area.scrollWidth - area.clientWidth,
			outside,
			loadMore: !!document.querySelector(".btn-more").offsetParent,
			pages: [...area.querySelectorAll(".tm-pager button, .tm-pager-gap")].map((b) => b.textContent.trim()),
			sizes: !!area.querySelector(".btn-paging").offsetParent,
		};
	});
}

(async () => {
	if (!tmCss || !deskCss) {
		console.log("  FAIL list-pager: built stylesheets not found — run `bench build --app themate`");
		process.exit(1);
	}
	const { chromium } = require("playwright");
	const browser = await chromium.launch({ executablePath: chromiumPath() });

	for (const [w, label] of [[360, "phone 360px"], [414, "phone 414px"], [1280, "desktop"]]) {
		const page = await browser.newPage({ viewport: { width: w, height: 800 } });
		await page.setContent(pageHtml());
		await page.addScriptTag({ path: JQUERY });
		await page.addScriptTag({ content: MOCK });
		await page.addScriptTag({ content: pagerSrc });
		await page.evaluate(async () => {
			const lv = new frappe.views.ListView();
			Object.assign(lv, { view_name: "List", page_length: 20, total_count: 120, $paging_area: $(".list-paging-area"), $result: $(".result") });
			window.cur_list = lv;
			await lv.get_count_str();
			await new Promise((r) => setTimeout(r, 0));
		});
		const m = await measure(page);
		check(`${label}: the paging row stays inside the card`, [m.overflow <= 0, m.outside], [true, []]);
		check(`${label}: Load More gives way to the pages`, m.loadMore, false);
		check(`${label}: the page sizes are still there`, m.sizes, true);
		if (w < 576) check(`${label}: first, current and last page`, m.pages, ["‹", "1", "…", "6", "›"]);
		else if (w >= 992) check(`${label}: the full run of pages`, m.pages, ["‹", "1", "2", "3", "4", "…", "6", "›"]);

		if (w === 1280) {
			/* a window dragged narrow redraws for the new width */
			await page.setViewportSize({ width: 360, height: 800 });
			await page.waitForTimeout(50);
			const narrow = await measure(page);
			check("resize: dragged to phone width it redraws compact", [narrow.pages, narrow.outside], [["‹", "1", "…", "6", "›"], []]);
		}
		await page.close();
	}

	/* Without :has() (Safari < 15.4) the class still hides Load More: drop
	 * every rule that uses :has() and look again. */
	{
		const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
		await page.setContent(pageHtml());
		await page.evaluate(() => {
			for (const sheet of document.styleSheets) {
				const walk = (rules, owner) => {
					for (let i = rules.length - 1; i >= 0; i--) {
						const r = rules[i];
						if (r.cssRules && !r.selectorText) walk(r.cssRules, r);
						else if (r.selectorText?.includes(":has(")) owner.deleteRule(i);
					}
				};
				walk(sheet.cssRules, sheet);
			}
		});
		await page.addScriptTag({ path: JQUERY });
		await page.addScriptTag({ content: MOCK });
		await page.addScriptTag({ content: pagerSrc });
		await page.evaluate(async () => {
			const lv = new frappe.views.ListView();
			Object.assign(lv, { view_name: "List", page_length: 20, total_count: 120, $paging_area: $(".list-paging-area"), $result: $(".result") });
			await lv.get_count_str();
			await new Promise((r) => setTimeout(r, 0));
		});
		const m = await measure(page);
		check("no :has(): Load More is still hidden", m.loadMore, false);
		await page.close();
	}

	await browser.close();
	const failed = results.filter((r) => !r.pass);
	results.forEach((r) => console.log(`  ${r.pass ? "ok  " : "FAIL"} ${r.name}${r.pass ? "" : `\n        got      ${r.actual}\n        expected ${r.expected}`}`));
	console.log(`\nlist pager: ${results.length - failed.length} passed, ${failed.length} failed`);
	process.exit(failed.length ? 1 : 0);
})();

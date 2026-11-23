/* The list row's trailing meta column stays put.
 *
 * Native sizes that column from its own content (desk/list.scss:104-152) and
 * floors the subject side at 80% of the row, while .level-item is
 * flex-shrink: 0. A row carrying an assignment avatar therefore asks for
 * more width than the row has, and the whole group — age, comment count,
 * favourite — slides. Measured off a real Customer list: 65px to the right
 * of the same three on every other row, heart clipped by the card edge.
 *
 * What makes this worth a test rather than a rule is that the amount of the
 * slide depends on the data: how many people a row is assigned to, how long
 * its timestamp reads, whether its comment count is 0 or 99+. A selector
 * being present proves nothing; these measure geometry.
 *
 * The "stressed" pass re-creates the failure mode directly — the meta column
 * anchored to its start edge — and asserts the fix holds anyway. That is the
 * point of the layout: the avatar slot absorbs the slack from INSIDE, so
 * nothing outside it can push the parts that are on every row.
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

/* Only .level-right's justification can move anything: .list-row-activity is
 * sized by its content, so justifying inside it has no free space to act on. */
const FORCE = `html .list-row .level-right, html .list-row-head .level-right { justify-content: flex-start !important; }`;

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

/* list_view.js:962-996 markup, verbatim in shape. */
const one = `<span class="avatar avatar-small"><div class="avatar-frame standard-image" style="background:#c33">AF</div></span>`;
const avatars = (n) =>
	`<div class="list-assignments d-flex align-items-center"><div class="avatar-group right overlap">${one.repeat(n)}</div></div>`;

const meta = (n, count) => `
  <div class="level-item list-row-activity hidden-xs">
    <div class="hidden-md hidden-xs">${n ? avatars(n) : ""}</div>
    <span class="modified"><span class="frappe-timestamp">1 M</span></span>
    <span class="comment-count d-flex align-items-center"><svg class="icon icon-sm"><use href="#icon-small-message"></use></svg>${count}</span>
    <span class="mx-2">·</span>
    <span class="list-row-like hidden-xs" style="margin-bottom:1px;"><span class="like-action not-liked"><svg class="icon icon-sm tm-icon"><use class="like-icon" href="#icon-tm-heart"></use></svg></span></span>
  </div>
  <div class="level-item visible-xs text-right"></div>`;

const cols = (name, group) => `
  <div class="list-row-col ellipsis list-subject level"><input class="level-item list-row-checkbox" type="checkbox"><span class="level-item bold ellipsis"><a class="ellipsis" href="#">${name}</a></span></div>
  <div class="list-row-col hidden-xs ellipsis"><span class="indicator-pill gray">Enabled</span></div>
  <div class="list-row-col ellipsis hidden-xs"><span class="ellipsis">${group}</span></div>
  <div class="list-row-col ellipsis hidden-xs"><span class="ellipsis"></span></div>
  <div class="list-row-col ellipsis hidden-xs"><span class="ellipsis">${name}</span></div>`;

const row = (id, name, group, n, count) => `
 <div class="list-row-container" data-probe="${id}"><div class="level list-row">
  <div class="level-left ellipsis">${cols(name, group)}</div>
  <div class="level-right text-muted ellipsis">${meta(n, count)}</div>
 </div><div class="list-row-border"></div></div>`;

const header = `<header class="level list-row-head text-muted" data-probe="head">
  <div class="level-left list-header-subject">${cols("Customer Name", "Customer Group")}</div>
  <div class="level-right"><div class="level-item list-row-activity"><span class="modified">20 of 125</span></div></div>
</header>`;

const pageHtml = (w, { themed = true, force = false } = {}) => `<!DOCTYPE html>
<html dir="ltr" data-tm-enabled="on" data-tm-list="${themed ? "on" : "off"}"><head>
<style>${deskCss}</style><style>${tmCss}</style>${force ? `<style>${FORCE}</style>` : ""}
<style>body{margin:0}.page-container{width:${w}px}</style></head>
<body><div id="body"><div class="page-container"><div class="frappe-list"><div class="result">
${header}
${row("plain", "Dr Ahmed Mohamed", "", 0, 0)}
${row("avatar", "Modern Office Group", "", 1, 1)}
${row("crowd", "Grant Plastics Ltd. and a very long trailing name", "Demo Customer Group", 3, "99+")}
</div></div></div></div></body></html>`;

async function measure(page) {
	return page.evaluate(() => {
		const at = (probe, sel) => {
			const r = document.querySelector(`[data-probe="${probe}"]`);
			const el = sel ? r.querySelector(sel) : r;
			const b = el.getBoundingClientRect();
			return { l: Math.round(b.left), r: Math.round(b.right) };
		};
		const listRight = Math.round(document.querySelector(".result").getBoundingClientRect().right);
		const read = (p) => ({ modified: at(p, ".modified").l, like: at(p, ".list-row-like").r, leftEdge: at(p, ".level-left").r });
		return {
			listRight,
			head: at("head", ".level-left").r,
			plain: read("plain"),
			avatar: read("avatar"),
			crowd: read("crowd"),
		};
	});
}

const WIDTHS = [1160, 1000, 820];

(async () => {
	if (!tmCss) {
		console.log("  FAIL list-row: built themate stylesheet not found — run `bench build --app themate`");
		process.exit(1);
	}
	const { chromium } = require("playwright");
	const browser = await chromium.launch({ executablePath: chromiumPath() });

	for (const w of WIDTHS) {
		for (const force of [false, true]) {
			const label = `${w}px${force ? ", meta column start-anchored" : ""}`;
			const page = await browser.newPage({ viewport: { width: w + 40, height: 500 } });
			await page.setContent(pageHtml(w, { themed: true, force }));
			const m = await measure(page);

			/* The favourite is the rightmost thing in the row and the one the
			 * eye tracks down the column: it may not move for any row. */
			check(`row @${label}: the favourite sits on one line for every row`,
				[m.avatar.like - m.plain.like, m.crowd.like - m.plain.like], [0, 0]);
			/* The age too, so the whole group reads as a column. */
			check(`row @${label}: so does the age`,
				[m.avatar.modified - m.plain.modified, m.crowd.modified - m.plain.modified], [0, 0]);
			/* Header and body must split the row identically or the column
			 * labels stop sitting over their own data. */
			check(`row @${label}: the header splits the row exactly where the rows do`,
				[m.plain.leftEdge - m.head, m.avatar.leftEdge - m.head], [0, 0]);
			/* And none of it may leave the card. */
			check(`row @${label}: nothing overflows the list`,
				Math.max(m.avatar.like, m.crowd.like) <= m.listRight, true);
			await page.close();
		}
	}

	/* The defect, to prove the assertions above can fail: with the theme's
	 * list rules off, the same forced condition moves the whole group. */
	{
		const page = await browser.newPage({ viewport: { width: 1200, height: 500 } });
		await page.setContent(pageHtml(1160, { themed: false, force: true }));
		const m = await measure(page);
		check("row: without the theme's meta column the group does slide (the reported defect)",
			m.avatar.like - m.plain.like > 20, true);
		await page.close();
	}

	/* A long name stays inside its column and gets an ellipsis. It used to leave
	 * the column and be cut with no ellipsis, which in RTL cut its first letters. */
	{
		const page = await browser.newPage({ viewport: { width: 1200, height: 500 } });
		await page.setContent(pageHtml(1160));
		const fits = await page.evaluate(() => {
			const r = document.querySelector('[data-probe="crowd"] .list-subject');
			return r.querySelector(".level-item.ellipsis").getBoundingClientRect().right <= r.getBoundingClientRect().right + 1;
		});
		check("row: a long name stays inside the subject column", fits, true);
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
	console.log(`\nlist row: ${pass} passed, ${failures.length} failed`);
	process.exit(failures.length ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

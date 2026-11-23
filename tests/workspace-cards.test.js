/* Workspace chips: a real colour and the right icon in any language.
 *
 * Both defects were silent. Every chip was blue, because the tone index was
 * taken inside a .ce-block that holds one widget. Every Arabic card had a
 * hashed icon, because the rules are English and .widget-title is translated.
 * Runs the real core file against the markup Frappe's block.js leaves. */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "themate/public/js/workspace/cards.js"), "utf8");
const jquery = fs.readFileSync(path.resolve(ROOT, "../frappe/node_modules/jquery/dist/jquery.min.js"), "utf8");

const shortcut = (name, title) => `<div class="ce-block"><div shortcut_name="${name}">
	<div class="widget shortcut-widget-box"><div class="widget-head"><div class="widget-label"><div class="widget-title">${title}</div></div></div></div>
</div></div>`;
const card = (name, title) => `<div class="ce-block"><div card_name="${name}">
	<div class="widget links-widget-box"><div class="widget-head"><div class="widget-label"><div class="widget-title">${title}</div></div></div></div>
</div></div>`;

(async () => {
	const browser = await chromium.launch();
	const page = await browser.newPage();
	await page.setContent(`<!DOCTYPE html><body><div id="body"><div class="codex-editor__redactor">
		${shortcut("Item", "الصنف")}${shortcut("Customer", "العميل")}${shortcut("Supplier", "المورد")}${shortcut("Leaderboard", "المتصدرون")}
		${card("Accounting", "المحاسبة")}${card("Stock", "المخازن")}
	</div></div></body>`);
	await page.addScriptTag({ content: jquery });
	await page.addScriptTag({ content: `window.frappe = { utils: { icon: (n) => '<svg class="icon"></svg>' } }; window.themate = { enabled: () => true };` });
	await page.addScriptTag({ content: src.replace(/^export /gm, ""), type: "module" });
	await page.waitForFunction(() => document.querySelectorAll(".tm-shortcut-icon").length === 6);

	const got = await page.evaluate(() => {
		const chips = (sel) => [...document.querySelectorAll(`${sel} .tm-shortcut-icon`)];
		return {
			icons: chips(".shortcut-widget-box").map((c) => c.dataset.tmIcon),
			tones: chips(".shortcut-widget-box").map((c) => c.dataset.tmTone),
			cardTones: chips(".links-widget-box").map((c) => c.dataset.tmTone),
			bands: [...document.querySelectorAll(".links-widget-box .widget-head")].map((h) => h.dataset.tmTone),
		};
	});
	await browser.close();

	const checks = [
		["icons come from the untranslated name", got.icons, ["stock", "users", "truck", "trophy"]],
		["neighbouring shortcuts differ in tone", new Set(got.tones).size, 4],
		["link cards differ in tone", new Set(got.cardTones).size, 2],
		["a link card's band matches its chip", got.bands, got.cardTones],
	];
	let failed = 0;
	for (const [name, actual, expected] of checks) {
		const ok = JSON.stringify(actual) === JSON.stringify(expected);
		if (!ok) failed++;
		console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n         expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
	}
	console.log(`\nworkspace cards: ${checks.length - failed} passed, ${failed} failed`);
	process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

/* The sidebar art reaches the screen, and only safe colours reach the stylesheet.
 *
 * The first version generated a valid image that never showed: a later
 * `background:` shorthand in _modern-sidebar.scss reset it. So this reads the
 * built stylesheets and the rendered pixels, not the source. */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const BENCH = path.resolve(ROOT, "../..");
const pick = (dir, re) => {
	const f = fs.readdirSync(dir).find((x) => re.test(x));
	return f ? fs.readFileSync(path.join(dir, f), "utf8") : "";
};
const deskCss = pick(path.join(BENCH, "sites/assets/frappe/dist/css"), /^desk\.bundle\..*\.css$/);
const tmCss = pick(path.join(BENCH, "sites/assets/themate/dist/css"), /^themate\.bundle\..*\.css$/);
const { execFileSync } = require("child_process");
const src = ["art_svgs", "art"].map((f) => fs.readFileSync(path.join(ROOT, `themate/public/js/core/${f}.js`), "utf8")).join("\n");

const page_html = (dir) => `<!DOCTYPE html><html dir="${dir}" data-tm-sidebar-theme="dark" data-tm-sidebar-art="on"><head>
<style>${deskCss}</style><style>${tmCss}</style></head><body>
<div class="modern-sidebar" style="width:224px"><div class="modern-sidebar-header" style="height:48px"></div></div>
<div class="tm-home tm-ws-card"><div class="page-head"><div class="page-head-content"></div></div></div></body></html>`;

(async () => {
	const browser = await chromium.launch();
	const checks = [];
	const check = (name, actual, expected) => checks.push([name, actual, expected]);

	for (const dir of ["ltr", "rtl"]) {
		const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
		await page.setContent(page_html(dir));
		await page.addScriptTag({ content: src });
		const got = await page.evaluate(async () => {
			const art = window.themate.art;
			art.sidebar(art.DEFAULTS);
			art.greeting("#1677ff");
			const side = document.querySelector(".modern-sidebar");
			const light = getComputedStyle(document.querySelector(".page-head-content")).backgroundImage;
			document.documentElement.dataset.theme = "dark";
			const dark = getComputedStyle(document.querySelector(".page-head-content")).backgroundImage;
			const cs = getComputedStyle(side);
			const url = document.getElementById("tm-sidebar-art").textContent.match(/url\("(.*)"\)/)[1];
			const svg = decodeURIComponent(url.split(",").slice(1).join(","));
			return {
				image: cs.backgroundImage.startsWith('url("data:image/svg+xml'),
				size: cs.backgroundSize,
				header: getComputedStyle(side.querySelector(".modern-sidebar-header")).backgroundColor,
				mirrored: svg.includes("matrix(-1 0 0 1 1024 0)"),
				greeting: light.startsWith('url("data:image/svg+xml') && dark.startsWith('url("data:image/svg+xml') && light !== dark,
			};
		});
		check(`${dir}: the image survives the stylesheets`, got.image, true);
		check(`${dir}: a fixed width, so the rail crops it`, /^\d+px 100%$/.test(got.size), true);
		check(`${dir}: the header does not cover it`, got.header, "rgba(0, 0, 0, 0)");
		check(`${dir}: ribbons follow the content edge`, got.mirrored, dir === "rtl");
		check(`${dir}: the greeting has its own light and dark art`, got.greeting, true);
		await page.close();
	}

	const page = await browser.newPage();
	await page.setContent(page_html("ltr"));
	await page.addScriptTag({ content: src });
	const logic = await page.evaluate(() => {
		const art = window.themate.art;
		const bad = ["#111111", "red;}body{display:none}", "#222222", "#333333", "#444444"];
		const own = ["#111111", "#222222", "#333333", "#444444", "#555555"];
		art.sidebar(art.DEFAULTS);
		art.sidebar(bad);
		const injected = !!document.getElementById("tm-sidebar-art");
		return {
			injected,
			fromBad: art.colors({}, { sidebar_art_colors: bad }),
			own: art.colors({ sidebar_bg: "#0f2e2a" }, { sidebar_art_colors: own }),
			derived: art.colors({ sidebar_bg: "#0f2e2a" }, {}),
			black: art.colors({}, { sidebar_bg: "#000000" }),
			wrongCount: art.colors({}, { sidebar_art_colors: ["#111111", "#222222"] }),
			hue: (() => {
				const key = (b) => { art.greeting(b); return document.getElementById("tm-greeting-art").textContent; };
				return [key("#1677ff") === key("#1677ff"), key("#7a0c3e") !== key("#1677ff")];
			})(),
			DEFAULTS: art.DEFAULTS,
		};
	});
	await browser.close();

	check("an unsafe colour drops the rule instead of writing it", logic.injected, false);
	check("unsafe custom colours are ignored", logic.fromBad, logic.DEFAULTS);
	check("custom colours beat the sidebar colour", logic.own[0], "#111111");
	check("one sidebar colour gives all the file's colours", logic.derived.every((c) => /^#[0-9a-f]{6}$/i.test(c)) && logic.derived.length, logic.DEFAULTS.length);
	check("a list of the wrong length is ignored", logic.wrongCount, logic.DEFAULTS);
	check("the greeting follows the accent's hue", logic.hue, [true, true]);
	let fresh = true;
	try { execFileSync("python3", [path.join(__dirname, "tools/build_art.py"), "--check"]); } catch (e) { fresh = false; }
	check("art_svgs.js matches the SVGs (else run tools/build_art.py)", fresh, true);
	check("the sidebar colour stays the base", logic.derived[1], "#0f2e2a");
	check("black has no hue to break on", logic.black.every((c) => /^#[0-9a-f]{6}$/i.test(c)), true);

	let failed = 0;
	for (const [name, actual, expected] of checks) {
		const ok = JSON.stringify(actual) === JSON.stringify(expected);
		if (!ok) failed++;
		console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n         expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
	}
	console.log(`\nsidebar art: ${checks.length - failed} passed, ${failed} failed`);
	process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

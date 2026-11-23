/* Icon-swap consequences.
 *
 * core/icons.js re-points every <use> at the Themate sprite when it has the
 * symbol. That is invisible for an icon nobody colours — and a silent
 * regression for one Frappe colours THROUGH the symbol, because the two
 * sprites are drawn differently:
 *
 *   Frappe  es-solid-heart : <path fill="var(--icon-stroke)">
 *   Themate icon-tm-heart  : <g class="tm-fill" fill="currentColor">
 *
 * common/icons.scss:22,44 turns a favourited row's heart red by declaring
 * --icon-stroke on the <use>. Against the Themate symbol that does nothing:
 * fill="currentColor" is a presentation attribute on the referenced content,
 * and inheritance only supplies what is not already specified. The heart
 * therefore stayed the row's muted grey whether or not it was a favourite —
 * the state was invisible.
 *
 * These render the real sprites through the real built stylesheet and read
 * the pixels, because "is the heart red" is not a question a selector test
 * can answer: every rule involved can be present and correct and still lose
 * to an attribute inside the symbol.
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
const tmSprite = fs.readFileSync(path.join(ROOT, "themate/public/icons.svg"), "utf8");
const esSprite = fs.readFileSync(path.join(BENCH, "apps/frappe/frappe/public/icons/espresso/icons.svg"), "utf8");

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

/* list_view.js:2227 markup, after core/icons.js has swapped the sprite. */
const heart = (state, swapped) =>
	`<span class="like-action ${state}"><svg class="icon icon-sm ${swapped ? "tm-icon" : "es-icon es-solid"}">` +
	`<use class="like-icon" href="${swapped ? "#icon-tm-heart" : "#es-solid-heart"}"></use></svg></span>`;

const CELLS = ["tm-off", "tm-on", "fr-off", "fr-on"];

function pageHtml(themeOn) {
	return `<!DOCTYPE html><html data-tm-enabled="${themeOn ? "on" : "off"}" data-tm-list="on"><head>
<style>${deskCss}</style><style>${tmCss}</style>
<style>body{margin:0;background:#fff;color:#6b7280}
 .cell{width:60px;height:60px;display:flex;align-items:center;justify-content:center;float:left}
 .icon-sm{width:32px;height:32px}</style></head><body>
<div id="all-symbols" style="display:none">${tmSprite}${esSprite}</div>
<div class="cell">${heart("not-liked", true)}</div>
<div class="cell">${heart("liked liked-by", true)}</div>
<div class="cell">${heart("not-liked", false)}</div>
<div class="cell">${heart("liked liked-by", false)}</div>
</body></html>`;
}

/* The darkest opaque pixel in each cell is the heart itself. Decoded by the
 * browser that drew it, so no image library is needed. */
async function sample(page) {
	const shot = await page.screenshot();
	return page.evaluate(
		async ([b64, cells]) => {
			const img = new Image();
			await new Promise((r) => {
				img.onload = r;
				img.src = "data:image/png;base64," + b64;
			});
			const c = document.createElement("canvas");
			c.width = img.width;
			c.height = img.height;
			const ctx = c.getContext("2d");
			ctx.drawImage(img, 0, 0);
			const d = ctx.getImageData(0, 0, img.width, img.height).data;
			const out = {};
			cells.forEach((id, i) => {
				let best = null;
				let score = 1e9;
				for (let y = 10; y < 50; y++) {
					for (let x = i * 60 + 10; x < i * 60 + 50; x++) {
						const o = (y * img.width + x) << 2;
						if (d[o + 3] < 200) continue;
						const lum = d[o] + d[o + 1] + d[o + 2];
						if (lum < score) {
							score = lum;
							best = [d[o], d[o + 1], d[o + 2]];
						}
					}
				}
				out[id] = best;
			});
			return out;
		},
		[shot.toString("base64"), cells()]
	);
}
const cells = () => CELLS;

const isRed = (p) => !!p && p[0] > 150 && p[1] < 90 && p[2] < 90;
const isGrey = (p) => !!p && Math.max(...p) - Math.min(...p) < 30;

(async () => {
	if (!tmCss) {
		console.log("  FAIL icons: built themate stylesheet not found — run `bench build --app themate`");
		process.exit(1);
	}
	const { chromium } = require("playwright");
	const browser = await chromium.launch({ executablePath: chromiumPath() });

	{
		const page = await browser.newPage({ viewport: { width: 400, height: 120 } });
		await page.setContent(pageHtml(true));
		const px = await sample(page);

		check("heart: a favourite is red with the Themate symbol", isRed(px["tm-on"]), true);
		check("heart: and red with Frappe's, when this sprite has no heart to swap in",
			isRed(px["fr-on"]), true);
		check("heart: not a favourite stays muted (Themate symbol)", isGrey(px["tm-off"]), true);
		check("heart: not a favourite stays muted (Frappe symbol)", isGrey(px["fr-off"]), true);
		/* The defect itself: the two states were the same pixel. */
		check("heart: favourite and not-favourite are not the same colour",
			JSON.stringify(px["tm-on"]) !== JSON.stringify(px["tm-off"]), true);
		await page.close();
	}

	/* The master kill-switch must give the heart back to Frappe untouched —
	 * including the defect, which is Frappe's, not the theme's to carry. */
	{
		const page = await browser.newPage({ viewport: { width: 400, height: 120 } });
		await page.setContent(pageHtml(false));
		const px = await sample(page);
		check("heart: theme off leaves the Themate symbol to Frappe's own rules",
			isRed(px["tm-on"]), false);
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
	console.log(`\nicons: ${pass} passed, ${failures.length} failed`);
	process.exit(failures.length ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

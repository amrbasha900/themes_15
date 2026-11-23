/* Placeholder timing and the two surfaces that use it.
 *
 * The defect this suite guards is the one the whole feature exists to avoid:
 * a placeholder that paints for a few milliseconds and disappears reads as a
 * glitch, and a placeholder that outlives its data delays the screen. Both
 * are timing, so both are tested against the clock rather than by eye.
 *
 * Also pins the two CSS contracts the skeletons depend on — a list row the
 * same height as a real one, and a form page that hides the PREVIOUS
 * record's title and body while the next one is on its way. The list rule
 * shipped broken once already (scoped to `.result-list`, a class Frappe does
 * not emit), which is exactly the kind of silence a selector test catches.
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

/* core/loading.js is an ES module; the page runs it as one. */
const loadingSrc = fs.readFileSync(path.join(JS_DIR, "core/loading.js"), "utf8");

/* The built desk stylesheet, so these assert what a browser actually gets
 * after Sass, autoprefixer and esbuild — not what the source says. */
function builtCss() {
	const dir = path.resolve(ROOT, "../../sites/assets/themate/dist/css");
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

const ORIGIN = "http://themate.test/";

(async () => {
	const { chromium } = require("playwright");
	const browser = await chromium.launch({ executablePath: chromiumPath() });

	/* ---- pending(): the clock --------------------------------------------- */
	{
		const page = await browser.newPage();
		await page.route("**/*", (route) =>
			route.fulfill({ status: 200, contentType: "text/html", body: "<!DOCTYPE html><html><body></body></html>" })
		);
		await page.goto(ORIGIN);
		await page.addScriptTag({ content: loadingSrc.replace(/^export /gm, ""), type: "module" });
		await page.waitForFunction(() => !!window.themate?.pending);

		/* A wait shorter than the delay must not paint at all: this is the
		 * flicker that a naive "show a spinner while loading" always has, and
		 * on a desk that keeps visited pages in the DOM it is the common case. */
		const quick = await page.evaluate(async () => {
			let shown = 0;
			const h = window.themate.pending({ show: () => shown++, hide: () => {} });
			await new Promise((r) => setTimeout(r, 60));
			h.done();
			await new Promise((r) => setTimeout(r, 400));
			return shown;
		});
		check("pending: a 60ms wait draws nothing", quick, 0);

		/* A wait past the delay must paint once, and only once. */
		const slow = await page.evaluate(async () => {
			let shown = 0;
			const h = window.themate.pending({ show: () => shown++, hide: () => {} });
			await new Promise((r) => setTimeout(r, 400));
			h.done();
			return shown;
		});
		check("pending: a 400ms wait draws once", slow, 1);

		/* Once drawn it is held, so an answer arriving right after the
		 * placeholder appears cannot strobe it away. */
		const floor = await page.evaluate(async () => {
			const t0 = Date.now();
			let hidden = -1;
			const h = window.themate.pending({ show: () => {}, hide: () => (hidden = Date.now() - t0) });
			await new Promise((r) => setTimeout(r, 210));
			h.done();
			await new Promise((r) => setTimeout(r, 400));
			return hidden;
		});
		check("pending: a placeholder is held past the floor", floor >= 330, true);
		/* ...but never for long. The floor exists to stop a strobe, not to
		 * delay the screen: content is held back by at most the floor. */
		check("pending: and no longer than the floor", floor < 520, true);

		/* Routing away drops it now — nobody is waiting on that screen, so
		 * the floor that exists to keep a placeholder from strobing has
		 * nothing left to protect. Measured from the cancel, not the start. */
		const cancelled = await page.evaluate(async () => {
			let hidden = -1;
			const h = window.themate.pending({ show: () => {}, hide: () => (hidden = Date.now() - asked) });
			await new Promise((r) => setTimeout(r, 210));
			var asked = Date.now();
			h.cancel();
			await new Promise((r) => setTimeout(r, 300));
			return hidden;
		});
		check("pending: cancel() drops the placeholder without waiting out the floor",
			cancelled >= 0 && cancelled < 40, true);

		/* done() twice (freeze(false) after a cancel, a double render) must
		 * not schedule a second hide. */
		const once = await page.evaluate(async () => {
			let hidden = 0;
			const h = window.themate.pending({ show: () => {}, hide: () => hidden++ });
			await new Promise((r) => setTimeout(r, 250));
			h.done();
			h.done();
			h.cancel();
			await new Promise((r) => setTimeout(r, 400));
			return hidden;
		});
		check("pending: settles exactly once", once, 1);

		/* A throwing callback is decoration failing, not the screen failing. */
		const threw = await page.evaluate(async () => {
			let reached = false;
			const h = window.themate.pending({
				show: () => { throw new Error("boom"); },
				hide: () => { reached = true; },
			});
			await new Promise((r) => setTimeout(r, 250));
			h.done();
			await new Promise((r) => setTimeout(r, 400));
			return reached;
		});
		check("pending: a throwing show() does not stop hide()", threw, true);
		await page.close();
	}

	/* ---- the CSS the skeletons rely on ------------------------------------ */
	{
		const css = builtCss();
		if (!css) {
			check("css: built desk bundle found", false, true);
		} else {
			/* base_list.js:352 builds the area as `.result`. The rule this
			 * replaced was scoped to `.result-list` and matched nothing. */
			check("list: the skeleton row is scoped to Frappe's .result area",
				css.includes(".result>.list-row-container.skeleton"), true);
			check("list: and is exactly one row tall, so nothing moves when data lands",
				/\.result>\.list-row-container\.skeleton\{[^}]*block-size:var\(--tm-row-h\)/.test(css), true);
			check("list: .result-list, which Frappe never emits, is gone",
				css.includes(".result-list"), false);

			/* The form page is switched to before the document arrives, so
			 * what is already in it belongs to the previous record. */
			check("form: loading hides the body under the outline",
				/\[data-tm-form-loading\][^{]*\.layout-main-section>\*:not\(\.tm-form-skeleton\)\{display:none\}/.test(css), true);
			check("form: and holds the previous record's title and actions invisible",
				/\[data-tm-form-loading\][^{]*\.page-head \.title-area/.test(css) &&
					/\[data-tm-form-loading\][^{]*\.page-head \.page-actions/.test(css), true);
			/* visibility, not display: the head must keep its height or the
			 * outline jumps when the real form replaces it. */
			check("form: the head keeps its space while hidden",
				/\[data-tm-form-loading\][^{]*\.page-head \.page-actions\{visibility:hidden\}/.test(css), true);

			/* Both skeletons stop moving for a person who asked for that. */
			check("both: the shimmer stops under prefers-reduced-motion",
				/@media \(prefers-reduced-motion:\s*reduce\)\{[^@]*\.result>\.list-row-container\.skeleton\{animation:none\}/.test(css), true);
		}
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
	console.log(`\nloading: ${pass} passed, ${failures.length} failed`);
	process.exit(failures.length ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

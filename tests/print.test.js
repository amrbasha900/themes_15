/* The print studio counts pages honestly (core/print_studio.js, _print.scss).
 *
 * Reported from a Social Insurance Filing: the bar said "Page 1 of 3" for a
 * document whose PDF is 2 pages, and drew a page boundary where the format
 * had put its own. Measured on this bench with wkhtmltopdf and pypdf:
 *
 *   SIF-2026-00256 / 00257 / 00258 → 2 PDF pages each, 0 .page-break divs
 *   Employee, Salary Structure (Standard) → 1 PDF page, 1 .page-break div
 *
 * So .page-break is a container (one per layout page, see frappe
 * templates/print_formats/standard.html), not a separator; a format that
 * breaks on its own CSS has none at all; and the HTML flow has no pages to
 * read a current page from. Fast mode therefore says "about N pages" and
 * never a current page, and the exact count comes from the browser's own
 * PDF viewer over the server's PDF, on a button.
 *
 * Driven against the real print_studio.js with the print page's own markup
 * (frappe printing/page/print/print.js make()) and a PrintView reduced to
 * what the studio calls. */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BENCH = path.resolve(ROOT, "../..");
const JQUERY = path.join(BENCH, "apps/frappe/node_modules/jquery/dist/jquery.min.js");
const SRC = fs.readFileSync(path.join(ROOT, "themate/public/js/core/print_studio.js"), "utf8");

function pick(dir, re) {
	if (!fs.existsSync(dir)) return "";
	const f = fs.readdirSync(dir).find((x) => re.test(x));
	return f ? fs.readFileSync(path.join(dir, f), "utf8") : "";
}

/* the built sheets, so the exact-mode rules in _print.scss are the ones under test */
const deskCss = pick(path.join(BENCH, "sites/assets/frappe/dist/css"), /^desk\.bundle\..*\.css$/);
const tmCss = pick(path.join(BENCH, "sites/assets/themate/dist/css"), /^themate\.bundle\..*\.css$/);
if (!tmCss) {
	console.error("print studio: no built themate stylesheet — run `bench build --app themate`");
	process.exit(1);
}

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

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

/* print.js make(), verbatim in shape */
const PAGE_HTML = `<!DOCTYPE html><html dir="ltr" data-tm-enabled="on"><head><meta charset="utf-8">
<style>${deskCss}</style><style>${tmCss}</style>
<style>body{margin:0}.tm-viewer{height:600px}</style></head><body>
<div id="page-print" class="page-container"><div class="page-head"></div>
<div class="layout-side-section"></div>
<div class="layout-main-section page-main">
	<div class="print-preview-wrapper"><div class="print-preview">
		<iframe class="print-format-container" width="100%" height="0" frameBorder="0" scrolling="no"></iframe>
	</div><div class="page-break-message"></div></div>
	<div class="preview-beta-wrapper"><iframe width="100%" height="0" frameBorder="0"></iframe></div>
</div>
<div class="custom-actions"><button class="btn">PDF</button><button class="btn">Full Page</button><button class="btn">Refresh</button></div>
</div></body></html>`;

const MOCK = `
window.__ = (s, r) => (r ? String(s).replace(/{(\\d+)}/g, (m, i) => r[i]) : s);
window.cint = (v) => parseInt(v) || 0;
window.locals = { "Print Format": {
	"Plain": {},
	"Designer": { print_format_builder_beta: 1 },
	"Label": { raw_printing: 1 },
} };
window.themate = { enabled: () => window.__tmOn !== false, deskState: null };
window.frappe = {
	boot: { lang: "en", themate: { navbar: { languages: [{ code: "en", label: "English" }, { code: "ar", label: "العربية" }] } } },
	utils: { escape_html: (s) => String(s), icon: () => "<svg></svg>", copy_to_clipboard: (u) => (window.__copied = u) },
	urllib: { get_full_url: (u) => "https://site.test" + u },
	meta: { get_print_formats: () => ["Plain", "Designer", "Label"] },
	get_indicator: () => null,
	views: { Page: class { trigger_page_event() {} } },
	ui: { form: {} },
};
/* every PDF request this studio makes is one frame navigation, so each
 * frame put on the desk is one trip to the server; count them */
window.__pdfRequests = [];
new MutationObserver((ms) => {
	for (const m of ms) {
		for (const n of m.addedNodes) {
			if (n.nodeType === 1 && n.classList?.contains("tm-viewer-pdf")) window.__pdfRequests.push(n.getAttribute("src"));
		}
	}
}).observe(document.documentElement, { childList: true, subtree: true });

frappe.ui.form.PrintView = class {
	constructor(wrapper) {
		this.page = wrapper.page;
		this.print_wrapper = this.page.main;
		this.print_settings = { pdf_page_size: "A4" };
		this.additional_settings = {};
		this.lang_code = "en";
		this.letterhead_selector = $('<div class="frappe-control"><input></div>').find("input");
		this.sidebar_dynamic_section = $("<div></div>");
		this._format = "Plain";
		this.print_format_selector = { val: (v) => (v === undefined ? this._format : (this._format = v)) };
		this.language_selector = { val: (v) => (v === undefined ? this.lang_code : (this.lang_code = v)) };
		this.make();
	}
	make() {}
	show() {}
	preview() {}
	selected_format() { return this._format; }
	with_letterhead() { return true; }
	get_letterhead() { return "Head"; }
	set_user_lang() {}
	refresh_print_format() { this.preview(); }
	edit_print_format() {}
	go_to_form_view() {}
	printit() { window.__nativePrint = (window.__nativePrint || 0) + 1; }
	is_raw_printing() { return false; }
	get_mapped_printer() { return []; }
	render_page() {}
};

window.__makeStudio = () => {
	const $w = $("#page-print");
	$w.page = {
		wrapper: $w, main: $w.find(".page-main"), sidebar: $w.find(".layout-side-section"),
		custom_actions: $w.find(".custom-actions"),
		add_button: (label) => $('<button class="btn"></button>').text(label).appendTo($w.find(".custom-actions")),
		add_menu_item: () => {}, set_indicator: () => {}, set_title_sub: () => {}, set_primary_action: () => {},
	};
	const pv = new frappe.ui.form.PrintView($w);
	pv.preview = function () { this._tm?.onPreview(); };
	/* make() is what the patch wraps; call the patched chain by hand */
	return pv;
};
`;

/* the patch hangs off trigger_page_event; fire it the way the print page does */
const BOOT = () => {
	const p = new frappe.views.Page();
	p.name = "print";
	p.trigger_page_event("on_page_load");
	window.__pv = window.__makeStudio();
	window.__st = window.__pv._tm;
	if (window.__st) {
		window.__st.frm = {
			doctype: "Social Insurance Filing",
			doc: { doctype: "Social Insurance Filing", name: "SIF-2026-00258" },
		};
	}
};

/* give the preview iframe N page-break containers and a content height,
 * then let it resize — which is the signal the studio waits on */
const FILL = ([breaks, heightPx]) => {
	const f = document.querySelector(".print-preview iframe");
	const d = f.contentDocument;
	d.body.innerHTML =
		'<div class="print-format">' +
		Array.from({ length: breaks }, () => '<div class="page-break"></div>').join("") +
		"</div>";
	window.__pv.$print_format_body = window.jQuery(d);
	f.style.height = heightPx + "px";
	f.setAttribute("height", heightPx);
	return new Promise((r) => setTimeout(r, 80));
};

const read = () => {
	const bar = document.querySelector(".tm-viewer-bar");
	const pdf = document.querySelector(".tm-viewer-pdf");
	const wait = document.querySelector(".tm-viewer-wait");
	return {
		page: bar.querySelector(".tm-viewer-page").textContent,
		exactLabel: bar.querySelector(".tm-viewer-exact").textContent,
		exactHidden: bar.querySelector(".tm-viewer-exact").hidden,
		zoomShown: bar.querySelector(".tm-viewer-zoom").offsetParent !== null,
		isExact: document.querySelector(".tm-viewer").classList.contains("is-exact"),
		pdfCount: document.querySelectorAll(".tm-viewer-pdf").length,
		src: pdf ? pdf.getAttribute("src") : null,
		requests: window.__pdfRequests.length,
		waiting: !!wait && wait.style.display !== "none",
		pdfVisible: !!pdf && pdf.offsetParent !== null && pdf.offsetHeight > 0,
		paperVisible: document.querySelector(".print-preview").offsetParent !== null,
	};
};

(async () => {
	const { chromium } = require("playwright");
	const browser = await chromium.launch({ executablePath: chromiumPath() });

	const open = async (on = true) => {
		const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
		await page.setContent(PAGE_HTML);
		await page.addScriptTag({ path: JQUERY });
		await page.addScriptTag({ content: MOCK });
		if (!on) await page.evaluate(() => (window.__tmOn = false));
		await page.addScriptTag({ content: SRC });
		await page.evaluate(BOOT);
		return page;
	};

	/* ---- 1. the kill switch: nothing of ours at all ---------------------- */
	{
		const page = await open(false);
		const bare = await page.evaluate(() => ({
			studio: !!window.__st,
			bar: !!document.querySelector(".tm-viewer-bar"),
			sidebar: document.querySelector(".layout-side-section").children.length,
			printit: (window.__pv.printit(), window.__nativePrint),
		}));
		check("themate off: no studio, no bar, no panel, Frappe's own printit", bare, {
			studio: false, bar: false, sidebar: 0, printit: 1,
		});
		await page.close();
	}

	const page = await open();

	/* ---- 2. the count, against the real PDFs measured on this bench ------ */
	{
		/* Standard format: 1 .page-break container, under one sheet.
		 * Measured: Employee/EMP-00002 → 1 PDF page. */
		await page.evaluate(() => window.__pv.preview());
		await page.evaluate(FILL, [1, 900]);
		check("one container under a sheet reads as one page", (await page.evaluate(read)).page, "1 page");

		/* The Social Insurance Form: no .page-break at all (it breaks on its
		 * own .pg CSS), ~2.4 sheets of preview height. Measured: 2 PDF
		 * pages. The old bar claimed "Page 1 of 3"; this one does not claim. */
		await page.evaluate(() => window.__pv.preview());
		await page.evaluate(FILL, [0, 2700]);
		const sif = await page.evaluate(read);
		check("no containers: an estimate, said to be one", sif.page, "about 3 pages");
		check("fast mode never claims a current page", /Page \d+ of/.test(sif.page), false);

		/* One container holding a long child table: the container is a floor,
		 * the height catches the overflow. */
		await page.evaluate(() => window.__pv.preview());
		await page.evaluate(FILL, [1, 5600]);
		check("one container, five sheets of child table", (await page.evaluate(read)).page, "about 5 pages");

		/* Five containers that each fit: the containers win. */
		await page.evaluate(() => window.__pv.preview());
		await page.evaluate(FILL, [5, 2000]);
		check("five containers, short content", (await page.evaluate(read)).page, "about 5 pages");
	}

	/* ---- 3. readiness is the resize, not a timeout ----------------------- */
	{
		await page.evaluate(() => window.__pv.preview());
		check("while the server renders, no stale number", (await page.evaluate(read)).page, "Measuring…");
		await page.evaluate(FILL, [3, 3000]);
		check("the iframe getting its height is the ready signal", (await page.evaluate(read)).page, "about 3 pages");
	}

	/* ---- 4. zoom does not change the page count or fetch a PDF ----------- */
	{
		const before = await page.evaluate(read);
		await page.click('.tm-viewer-zoom [data-z="+"]');
		await page.click('.tm-viewer-zoom [data-z="+"]');
		await page.click(".tm-viewer-fit");
		const after = await page.evaluate(read);
		check("zoom leaves the count alone and renders no PDF", [after.page, after.pdfCount], [before.page, 0]);
	}

	/* ---- 5. exact mode: the server's own PDF, on a button ---------------- */
	{
		check("the button is offered for an ordinary format", (await page.evaluate(read)).exactHidden, false);
		/* read at once: the frame is put up synchronously, and the loading
		 * state has to be true before it finishes loading */
		await page.click(".tm-viewer-exact");
		const on = await page.evaluate(read);
		check("one PDF frame, the paper and the zoom row stand down", [on.pdfCount, on.paperVisible, on.zoomShown, on.isExact], [1, false, false, true]);
		check("a loading state, not a stale number", [on.waiting, on.page], [true, "Exact pages — from the PDF"]);
		/* the frame must load the URL itself: a blob: src leaves the viewer
		 * titled after a UUID, which is the whole reason for the route */
		check("exactly one request, made by the frame", [on.requests, on.src.startsWith("blob:")], [1, false]);
		check("the path ends in the document's name", /\/themate-print\/SIF-2026-00258\.pdf\?/.test(on.src), true);
		check("while rendering, the empty frame stays out of sight", on.pdfVisible, false);
		check(
			"the URL carries every print parameter",
			on.src,
			"https://site.test/themate-print/SIF-2026-00258.pdf?doctype=Social%20Insurance%20Filing&name=SIF-2026-00258&format=Plain&no_letterhead=0&letterhead=Head&settings=%7B%7D&_lang=en"
		);
		await page.evaluate(() => window.__st.$pdf.trigger("load"));
		const shown = await page.evaluate(read);
		/* the wait is hidden, not removed: anything keyed on it as a sibling
		 * would hide the PDF for good — which is what it did. */
		check("loaded: the wait goes and the PDF is on screen", [shown.waiting, shown.pdfVisible], [false, true]);
		check("the label offers the way back", (await page.evaluate(read)).exactLabel, "Fast preview");
	}

	/* ---- 6. no repeated server renders for the same document ------------- */
	{
		const src = (await page.evaluate(read)).src;
		await page.evaluate(() => window.__pv.preview()); /* a plain refresh */
		await page.waitForTimeout(60);
		const same = await page.evaluate(read);
		check("an unchanged preview does not re-render the PDF", [same.src, same.pdfCount, same.requests], [src, 1, 1]);

		await page.evaluate(() => { window.__pv.language_selector.val("ar"); window.__pv.preview(); });
		await page.waitForTimeout(60);
		const ar = await page.evaluate(read);
		check("a language change re-renders exactly once", [ar.src.includes("_lang=ar"), ar.pdfCount, ar.requests], [true, 1, 2]);

		/* Refresh means render it again, even though the URL has not moved */
		await page.evaluate(() => { window.__st.src = null; window.__pv.preview(); });
		await page.waitForTimeout(60);
		check("Refresh renders again", (await page.evaluate(read)).requests, 3);
	}

	/* ---- 7. Print follows what is on screen ------------------------------ */
	{
		/* park the frame on about:blank so its window is reachable from here:
		 * on a real site the PDF is same-origin with the desk */
		await page.evaluate(() => {
			window.__nativePrint = 0;
			window.__st.$pdf[0].src = "about:blank";
		});
		await page.waitForTimeout(200);
		const printed = await page.evaluate(() => {
			const w = window.__st.$pdf[0].contentWindow;
			let n = 0;
			w.print = () => n++;
			w.focus = () => {};
			window.__pv.printit();
			return [n, window.__nativePrint];
		});
		check("in exact mode Print prints the PDF, not the HTML", printed, [1, 0]);
	}

	/* ---- 8. back to fast, and the unsupported formats -------------------- */
	{
		await page.click(".tm-viewer-exact");
		await page.waitForTimeout(60);
		const off = await page.evaluate(read);
		check("back to fast: the PDF frame is released, the paper returns", [off.pdfCount, off.paperVisible, off.zoomShown, off.isExact], [0, true, true, false]);

		for (const [fmt, why] of [["Designer", "Print Format Builder Beta"], ["Label", "raw printing"]]) {
			await page.evaluate((f) => { window.__pv.print_format_selector.val(f); window.__pv.preview(); }, fmt);
			check(`${why}: no exact button, native fallback`, (await page.evaluate(read)).exactHidden, true);
		}

		/* switching to one of them while exact is on drops back to fast */
		await page.evaluate(() => { window.__pv.print_format_selector.val("Plain"); window.__pv.preview(); });
		await page.click(".tm-viewer-exact");
		await page.waitForTimeout(60);
		check("exact is on", (await page.evaluate(read)).isExact, true);
		await page.evaluate(() => { window.__pv.print_format_selector.val("Designer"); window.__pv.preview(); });
		await page.waitForTimeout(60);
		const fell = await page.evaluate(read);
		check("switching to an unsupported format falls back cleanly", [fell.isExact, fell.pdfCount, fell.exactHidden], [false, 0, true]);
	}

	/* ---- 9. nothing accumulates ------------------------------------------ */
	{
		await page.evaluate(() => { window.__pv.print_format_selector.val("Plain"); });
		for (let i = 0; i < 12; i++) {
			await page.evaluate(() => window.__pv.preview());
			await page.evaluate(FILL, [2, 2400]);
		}
		const n = await page.evaluate(() => ({
			frames: document.querySelectorAll(".tm-viewer-pdf").length,
			waits: document.querySelectorAll(".tm-viewer-wait").length,
			bars: document.querySelectorAll(".tm-viewer-bar").length,
			page: document.querySelector(".tm-viewer-page").textContent,
		}));
		check("twelve refreshes leave one bar and no spare frames", n, { frames: 0, waits: 0, bars: 1, page: "about 3 pages" });
	}

	/* ---- 10. Copy link still carries the same parameters ----------------- */
	{
		await page.evaluate(() => window.__st.copyLink());
		check(
			"Copy link is unchanged",
			await page.evaluate(() => window.__copied),
			"https://site.test/printview?doctype=Social%20Insurance%20Filing&name=SIF-2026-00258&format=Plain&no_letterhead=0&letterhead=Head&settings=%7B%7D&_lang=ar"
		);
	}

	await page.close();
	await browser.close();
	const failed = results.filter((r) => !r.pass);
	results.forEach((r) => console.log(`  ${r.pass ? "ok  " : "FAIL"} ${r.name}${r.pass ? "" : `\n        got      ${r.actual}\n        expected ${r.expected}`}`));
	console.log(`\nprint studio: ${results.length - failed.length} passed, ${failed.length} failed`);
	process.exit(failed.length ? 1 : 0);
})();

/* A long-text value reads as one line in its child-table cell.
 *
 * core/grid_text.js turns the <br> that frappe.format() puts in a Small Text /
 * Text / Long Text cell into spaces, so a remark typed on several lines fills
 * the cell instead of stopping at its first break. GridRow is not exported,
 * so the file reaches it through ControlTable.make -> Grid.make_head ->
 * header_row.constructor; these mocks keep exactly that shape (table.js:8,
 * grid.js:351/:431/:507, grid_row.js:921/:1085/:1517).
 *
 * These run the real file against those mocks.
 */

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

const gridTextSrc = fs.readFileSync(path.join(ROOT, "themate/public/js/core/grid_text.js"), "utf8");

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

/* frappe.format() for Small Text: line breaks become <br>. */
const MOCK = `
window.frappe = { ui: { form: {} }, format: (v) => String(v ?? "").replace(/\\n/g, "<br>") };

class GridRow {
  constructor(opts) { Object.assign(this, opts); this.columns = {}; this.columns_list = []; }
  make_column(df, colsize, txt) {
    const $col = $('<div class="col grid-static-col"></div>');
    $col.field_area = $('<div class="field-area"></div>').appendTo($col).toggle(false);
    $col.static_area = $('<div class="static-area ellipsis"></div>').appendTo($col).html(txt);
    $col.df = df;
    this.columns[df.fieldname] = $col;
    this.columns_list.push($col);
    return $col;
  }
  refresh_field(fieldname) {
    const column = this.columns[fieldname];
    if (column) column.static_area.html(frappe.format(this.doc[fieldname], column.df));
  }
}

class Grid {
  make_head() { this.header_row = new GridRow({ grid: this }); }
  row(doc) { return new GridRow({ grid: this, doc }); }
}

frappe.ui.form.ControlTable = class ControlTable {
  make() { this.grid = new Grid(); }
};
`;

(async () => {
	const { chromium } = require("playwright");
	const browser = await chromium.launch({ executablePath: chromiumPath() });
	const page = await browser.newPage();
	await page.route("**/*", (route) =>
		route.fulfill({ status: 200, contentType: "text/html", body: "<!DOCTYPE html><html><body></body></html>" })
	);
	await page.goto("http://themate.test/");
	await page.addScriptTag({ content: fs.readFileSync(JQUERY, "utf8") });
	await page.addScriptTag({ content: MOCK });
	await page.addScriptTag({ content: gridTextSrc });

	const out = await page.evaluate(() => {
		const table = new frappe.ui.form.ControlTable();
		table.make();
		const grid = table.grid;
		grid.make_head(); /* grid.js:431, before any data row */

		const remark = { fieldname: "user_remark", fieldtype: "Small Text", label: "User Remark" };
		const data = { fieldname: "reference", fieldtype: "Data" };
		const doc = { user_remark: "line one\nline two\nline three", reference: "a\nb" };

		const header = grid.header_row;
		const $head = header.make_column(remark, 2, "User<br>Remark");

		const row = grid.row(doc);
		const $col = row.make_column(remark, 2, frappe.format(doc.user_remark));
		const $data = row.make_column(data, 2, frappe.format(doc.reference));
		const made = $col.static_area.text();
		const brs = $col.static_area.find("br").length;

		doc.user_remark = "first\nsecond";
		row.refresh_field("user_remark");
		const refreshed = row.columns.user_remark.static_area.text();

		window.themate = { enabled: () => false };
		const off = grid.row(doc).make_column(remark, 2, frappe.format(doc.user_remark));
		delete window.themate;

		return {
			made,
			brs,
			returned: $col.hasClass("grid-static-col") && row.columns.user_remark === $col,
			data: $data.static_area.html(),
			header: $head.static_area.html(),
			refreshed,
			value: doc.user_remark,
			off: off.static_area.html(),
		};
	});

	check("a remark on three lines reads as one line", out.made, "line one line two line three");
	check("no line break is left in the cell", out.brs, 0);
	check("Frappe's make_column still builds and returns the column", out.returned, true);
	check("a refreshed value is flattened too", out.refreshed, "first second");
	check("the value itself keeps its line breaks", out.value, "first\nsecond");
	check("a Data cell is left alone", out.data, "a<br>b");
	check("the header row is left alone", out.header, "User<br>Remark");
	check("theme off: the cell is Frappe's", out.off, "first<br>second");

	await page.close();
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
	console.log(`\ngrid text: ${pass} passed, ${failures.length} failed`);
	process.exit(failures.length ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

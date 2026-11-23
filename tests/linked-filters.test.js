/* Filtering a list by a field of a linked document (core/linked_filters.js).
 *
 * The parts of Frappe this leans on are run for real, from the bench:
 * field_select.js, filter.js, filter_list.js and base_list.js (BaseList and
 * its FilterArea). What would be easy to get wrong lives exactly there —
 * a restored filter whose field is not in the picker drops itself
 * (filter.js set_field), FilterGroup rejects a field the doctype does not
 * have (validate_args), BaseList.refresh sends whatever get_filters_for_args
 * returns. Around them: jQuery from the bench, and stubs for the controls,
 * Awesomplete and the server.
 *
 * ListView's URL methods and the Calendar's get_args are copied verbatim
 * from list_view.js (get_search_params, parse_filters_from_route_options)
 * and calendar.js (get_args): those files pull in most of the desk. */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BENCH = path.resolve(ROOT, "../..");
const FRAPPE_JS = path.join(BENCH, "apps/frappe/frappe/public/js/frappe");
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

const read = (p) => fs.readFileSync(p, "utf8");
const FRAPPE_FILES = ["ui/filters/field_select.js", "ui/filters/filter.js", "ui/filters/filter_list.js", "list/base_list.js"];

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

/* A desk with Leave Application's meta loaded and Employee's NOT — as on a
 * real Leave Application list. The server knows three departments. */
const DESK = `
window.__ = (s, r) => (r ? String(s).replace(/{(\\d+)}/g, (m, i) => r[i]) : s);
window.cint = (v) => parseInt(v, 10) || 0;
window.strip = (s) => String(s).trim();
window.copy_dict = (d) => JSON.parse(JSON.stringify(d));
window.repl = (s, d) => s.replace(/%\\((\\w+)\\)s/g, (m, k) => d[k]);
window.format_number = (v) => String(v);
Array.prototype.uniqBy = function (fn) { const seen = new Set(); return this.filter((x) => { const k = fn(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
window.__calls = [];
window.__alerts = [];
window.__warned = [];
const warn = console.warn;
console.warn = (...a) => { window.__warned.push(a.join(" ")); warn.apply(console, a); };

const LEAVE = [
	{ fieldname: "employee", label: "Employee", fieldtype: "Link", options: "Employee", reqd: 1, parent: "Leave Application" },
	{ fieldname: "leave_type", label: "Leave Type", fieldtype: "Link", options: "Leave Type", parent: "Leave Application" },
	...["Company", "Department", "Leave Approver", "Holiday List", "Letter Head", "Branch"].map((label) => ({
		fieldname: label.toLowerCase().replace(" ", "_"), label, fieldtype: "Link", options: label, parent: "Leave Application",
	})),
	{ fieldname: "from_date", label: "From Date", fieldtype: "Date", parent: "Leave Application" },
	{ fieldname: "status", label: "Status", fieldtype: "Select", options: "Open\\nApproved", parent: "Leave Application" },
];
const STD = [
	{ fieldname: "name", fieldtype: "Link", label: "ID" },
	{ fieldname: "owner", fieldtype: "Link", label: "Created By", options: "User" },
	{ fieldname: "modified", fieldtype: "Datetime", label: "Last Updated On" },
];
const EMPLOYEES = { Sales: ["EMP-1", "EMP-2"], HR: ["EMP-9"], Nowhere: [] };

window.locals = { DocType: { "Leave Application": { name: "Leave Application", istable: 0 } } };
window.frappe = {
	provide() {},
	router: { on() {} },
	boot: { additional_filters_config: {}, nested_set_doctypes: [], treeviews: [] },
	session: { user: "test@example.com" },
	user: { full_name: (u) => u, has_role: () => false },
	utils: {
		escape_html: (s) => String(s ?? ""),
		icon: (n) => '<svg class="icon" data-icon="' + n + '"></svg>',
		sort: (list, key) => list.slice().sort((a, b) => String(a[key] || "").localeCompare(String(b[key] || ""))),
		arrays_equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
		debounce: (fn) => fn,
		is_rtl: () => false,
		to_title_case: (s) => s,
	},
	meta: {
		docfield_list: { "Leave Application": LEAVE },
		get_docfield: (dt, fn) => (dt === "Leave Application" ? LEAVE.find((d) => d.fieldname === fn) : undefined),
		has_field: (dt, fn) => dt === "Leave Application" && LEAVE.some((d) => d.fieldname === fn),
		get_table_fields: () => [],
		get_doctype_for_field: (dt, fn) => (STD.some((d) => d.fieldname === fn) || LEAVE.some((d) => d.fieldname === fn) ? dt : null),
	},
	model: {
		std_fields: STD,
		std_fields_list: STD.map((d) => d.fieldname),
		is_submittable: () => false,
		table_fields: ["Table", "Table MultiSelect"],
		no_value_type: ["Section Break", "Column Break", "Tab Break", "HTML", "Table", "Table MultiSelect", "Button", "Image", "Fold", "Heading"],
		is_value_type: (t) => !["Section Break", "Column Break", "HTML", "Table", "Button"].includes(t),
		is_non_std_field: (f) => !STD.some((d) => d.fieldname === f),
		get_full_column_name: (f, dt) => "\`tab" + dt + "\`.\`" + f + "\`",
	},
	perm: { has_perm: () => true },
	get_meta: (dt) => (dt === "Leave Application" ? { name: dt, fields: LEAVE, istable: 0, title_field: null } : undefined),
	run_serially: (tasks) => tasks.reduce((p, t) => p.then(() => t()), Promise.resolve()),
	render_template: (name, { conditions }) => \`<div class="filter-box"><div class="list_filter row">
		<div class="fieldname-select-area"></div>
		<div><select class="condition form-control">\${conditions.map((c) => '<option value="' + c[0] + '">' + c[1] + "</option>").join("")}</select></div>
		<div><div class="filter-field"></div><div class="filter-description"></div></div>
		<div class="remove-filter"></div></div></div>\`,
	format: (v) => String(v ?? ""),
	show_alert: (a) => window.__alerts.push(a.message),
	msgprint: (m) => window.__alerts.push("msgprint: " + (m.message || m)),
	views: {},
	ui: {
		form: {
			make_control({ df, parent }) {
				const $input = $('<input class="form-control">').appendTo(parent);
				return {
					df, $input, wrapper: parent, value: "",
					refresh() {},
					get_value() { return this.value; },
					set_value(v) { this.value = v; $input.val(v); return Promise.resolve(); },
					get_label_value() { return this.value; },
				};
			},
		},
	},
	xcall(method, args) {
		window.__calls.push([method, JSON.parse(JSON.stringify(args))]);
		if (method === "themate.api.get_linked_filter_fields") {
			return Promise.resolve({
				links: [
					{ fieldname: "employee", label: "Employee", doctype: "Employee" },
					{ fieldname: "leave_type", label: "Leave Type", doctype: "Leave Type" },
					...["Company", "Department", "Leave Approver", "Holiday List", "Letter Head", "Branch"].map((label) => ({
						fieldname: label.toLowerCase().replace(" ", "_"), label, doctype: label,
					})),
				],
				doctypes: {
					Employee: [
						{ fieldname: "department", label: "Department", fieldtype: "Link", options: "Department" },
						{ fieldname: "gender", label: "Gender", fieldtype: "Link", options: "Gender" },
					],
					"Leave Type": [{ fieldname: "is_lwp", label: "Is Leave Without Pay", fieldtype: "Check" }],
					...Object.fromEntries(["Company", "Department", "Leave Approver", "Holiday List", "Letter Head", "Branch"].map((dt) => [dt, [{ fieldname: "disabled", label: "Disabled", fieldtype: "Check" }]])),
				},
			});
		}
		if (method === "frappe.desk.reportview.get_list") {
			const f = args.filters[0];
			return Promise.resolve((EMPLOYEES[f[3]] || []).map((name) => ({ name })));
		}
		return Promise.resolve(0);
	},
	call(opts) {
		window.__calls.push([opts.method, JSON.parse(JSON.stringify(opts.args || {}))]);
		return Promise.resolve({ message: [] });
	},
	db: { count: () => Promise.resolve(0), get_list: () => Promise.resolve([]) },
};
window.themate = { enabled: () => true, deskState: { get: () => null, set() {} } };

/* Awesomplete, as much as FieldSelect uses: it keeps the options array it
 * was given (awesomplete.js \`set list\`) and filters labels by "contains". */
window.Awesomplete = class {
	constructor(input, o) { this.input = input; this._list = o.list; this.suggestions = []; }
	evaluate() {
		const v = this.input.value.trim().toLowerCase();
		this.suggestions = this._list.filter((i) => String(i.label).toLowerCase().includes(v)).map((i) => i.label);
	}
	get_item(value) { return this._list.find((i) => i.value === value); }
};
window.__hidden = 0;
$.fn.popover = function (cmd) { if (cmd === "hide") window.__hidden++; return this; };
`;

/* list_view.js get_search_params / parse_filters_from_route_options and
 * calendar.js get_args, verbatim. */
const VIEWS = `
frappe.views.ListView = class ListView extends frappe.views.BaseList {
	get_search_params() {
		let search_params = new URLSearchParams();
		this.get_filters_for_args().forEach((filter) => {
			const doctype = filter[0];
			const field = filter[1];
			const operator = filter[2];
			const value = filter[3];

			const query_key = doctype === this.doctype ? field : \`\${doctype}.\${field}\`;
			const query_value = operator === "=" ? value : JSON.stringify([operator, value]);

			search_params.append(query_key, query_value);
		});

		return search_params;
	}
	parse_filters_from_route_options() {
		const filters = [];

		let params = new URLSearchParams(window.location.search);
		if (!params.toString() && frappe.route_options) {
			params = new Map(Object.entries(frappe.route_options));
		}

		params.forEach((value, field) => {
			let doctype = null;

			let value_array;
			if ($.isArray(value) && value[0].startsWith("[") && value[0].endsWith("]")) {
				value_array = [];
				for (var i = 0; i < value.length; i++) {
					value_array.push(JSON.parse(value[i]));
				}
			} else if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
				value = JSON.parse(value);
			}

			// if \`Child DocType.fieldname\`
			if (field.includes(".")) {
				doctype = field.split(".")[0];
				field = field.split(".")[1];
			}

			if (!doctype) {
				doctype = frappe.meta.get_doctype_for_field(this.doctype, field);
			}

			if (doctype) {
				if (value_array) {
					for (var j = 0; j < value_array.length; j++) {
						if ($.isArray(value_array[j])) {
							filters.push([doctype, field, value_array[j][0], value_array[j][1]]);
						} else {
							filters.push([doctype, field, "=", value_array[j]]);
						}
					}
				} else if ($.isArray(value)) {
					filters.push([doctype, field, value[0], value[1]]);
				} else {
					filters.push([doctype, field, "=", value]);
				}
			}
		});

		return filters;
	}
};
frappe.views.Calendar = class Calendar {
	get_args(start, end) {
		var args = {
			doctype: this.doctype,
			start: start,
			end: end,
			fields: this.fields,
			filters: this.list_view.filter_area.get(),
			field_map: this.field_map,
		};
		return args;
	}
};
`;

/* A list as BaseList.init leaves it, minus the parts these tests don't render. */
const MAKE_LIST = `
window.makeList = (filters, ListClass = frappe.views.ListView) => {
	const list = new ListClass({ doctype: "Leave Application" });
	Object.assign(list, {
		meta: frappe.get_meta("Leave Application"),
		settings: { hide_name_filter: 1 },
		filters,
		method: "frappe.desk.reportview.get",
		fields: [],
		start: 0,
		page_length: 20,
		page: { page_form: $('<div class="page-form"></div>').appendTo("body"), fields_dict: {}, main: $("<div>"), custom_actions: $("<div>") },
		prepare_data() {}, toggle_result_area() {}, before_render() {}, render() {}, after_render() {}, freeze() {},
	});
	return list;
};
window.lastGetArgs = () => {
	const c = window.__calls.filter((x) => x[0] === "frappe.desk.reportview.get").pop();
	return c && c[1];
};
window.tick = () => new Promise((r) => setTimeout(r, 0));
`;

(async () => {
	const missing = [JQUERY, ...FRAPPE_FILES.map((f) => path.join(FRAPPE_JS, f))].filter((p) => !fs.existsSync(p));
	if (missing.length) {
		console.log(`  FAIL linked filters: Frappe sources not found (${missing[0]}) — run from apps/themate on a bench`);
		process.exit(1);
	}
	const { chromium } = require("playwright");
	const browser = await chromium.launch({ executablePath: chromiumPath() });
	const page = await browser.newPage();
	await page.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!DOCTYPE html><html><body></body></html>" }));
	await page.goto("http://themate.test/app/leave-application");
	const errors = [];
	page.on("pageerror", (e) => errors.push(String(e.message)));

	await page.addScriptTag({ content: read(JQUERY) });
	await page.addScriptTag({ content: DESK });
	for (const f of FRAPPE_FILES) await page.addScriptTag({ content: read(path.join(FRAPPE_JS, f)) });
	await page.addScriptTag({ content: VIEWS + MAKE_LIST });
	await page.addScriptTag({ content: read(path.join(ROOT, "themate/public/js/core/linked_filters.js")) });
	await page.addScriptTag({ content: read(path.join(ROOT, "themate/public/js/core/list_filters.js")) });

	/* ---- a saved linked filter comes back -------------------------------- */
	const restored = await page.evaluate(async () => {
		const list = makeList([["Leave Application", "employee.department", "=", "Sales"]]);
		window.list = list;
		await list.setup_filter_area();
		const fields = __calls.filter((c) => c[0] === "themate.api.get_linked_filter_fields").length;
		const row = list.filter_area.filter_list.filters[0];
		return {
			kept: list.filter_area.get().map((f) => f.slice(0, 4)),
			control: row?.field && [row.field.df.fieldtype, row.field.df.options],
			picker: row?.fieldselect.$input.val(),
			fields,
			alerts: __alerts.slice(),
			dropped: __warned.filter((w) => w.includes("not selectable")),
		};
	});
	check("restore: a saved linked filter is kept as written", restored.kept, [["Leave Application", "employee.department", "=", "Sales"]]);
	check("restore: its row gets the linked field's own control (a Link to Department)", restored.control, ["Link", "Department"]);
	check("restore: and its picker names it", restored.picker, "Employee › Department");
	check("restore: the linked fields are asked for once", restored.fields, 1);
	check("restore: Frappe neither rejects it nor drops it", [restored.alerts, restored.dropped], [[], []]);

	/* ---- what the server is sent ---------------------------------------- */
	const sent = await page.evaluate(async () => {
		__calls.length = 0;
		await list.refresh();
		const first = lastGetArgs();
		const asked = __calls.filter((c) => c[0] === "frappe.desk.reportview.get_list").map((c) => [c[1].doctype, c[1].filters]);
		__calls.length = 0;
		list.last_args = null;
		await list.refresh();
		const again = __calls.filter((c) => c[0] === "frappe.desk.reportview.get_list").length;
		return { filters: first?.filters, asked, again, count: list.get_filters_for_args() };
	});
	check("refresh: the condition is answered on the linked doctype first", sent.asked, [["Employee", [["Employee", "department", "=", "Sales"]]]]);
	check("refresh: the list is filtered by the answer", sent.filters, [["Leave Application", "employee", "in", ["EMP-1", "EMP-2"]]]);
	check("refresh: a second refresh reuses the answer", sent.again, 0);
	check("count and group-by get the same filters", sent.count, [["Leave Application", "employee", "in", ["EMP-1", "EMP-2"]]]);

	const none = await page.evaluate(async () => {
		const list = makeList([["Leave Application", "employee.department", "=", "Nowhere"]]);
		await list.setup_filter_area();
		__calls.length = 0;
		await list.refresh();
		return lastGetArgs()?.filters;
	});
	check("refresh: a condition nothing matches shows nothing (not everything)", none, [["Leave Application", "name", "in", [""]]]);

	/* ---- the any-of group ------------------------------------------------- */
	const or = await page.evaluate(async () => {
		list._tm_or = [["Leave Application", "employee.department", "=", "HR"], ["Leave Application", "status", "=", "Open"]];
		__calls.length = 0;
		list.last_args = null;
		await list.refresh();
		return lastGetArgs()?.or_filters;
	});
	check("any-of group: a linked condition in it is answered too", or, [["Leave Application", "employee", "in", ["EMP-9"]], ["Leave Application", "status", "=", "Open"]]);
	await page.evaluate(() => { list._tm_or = []; });

	/* ---- the URL ------------------------------------------------------------ */
	const url = await page.evaluate(async () => {
		const query = list.get_search_params().toString();
		frappe.route_options = { "employee.department": "Sales", status: "Open" };
		const back = list.parse_filters_from_route_options();
		frappe.route_options = null;
		return { query, back };
	});
	check("url: the address bar keeps the condition, not the names", url.query, "employee.department=Sales");
	check("url: and reads it back as the same filter", url.back, [["Leave Application", "employee.department", "=", "Sales"], ["Leave Application", "status", "=", "Open"]]);

	/* ---- the calendar --------------------------------------------------------- */
	const cal = await page.evaluate(() => {
		const c = new frappe.views.Calendar();
		c.list_view = list;
		return c.get_args().filters.map((f) => f.slice(0, 4));
	});
	check("calendar: its events query gets the answered filter", cal, [["Leave Application", "employee", "in", ["EMP-1", "EMP-2"]]]);

	/* ---- the builder: picker, chip, "Linked documents" ------------------------- */
	const built = await page.evaluate(async () => {
		const fl = list.filter_area.filter_list;
		const $pop = $('<div class="filter-popover"><div class="popover-body"></div></div>').appendTo("body");
		$pop.find(".popover-body").append(fl.get_filter_area_template());
		list.filter_area.filter_button.trigger("shown.bs.popover");
		await tick();
		await tick();
		const chips = list._tm_bar.$chips.text();
		const picks = $pop.find(".tm-flinked [data-link]:not([hidden])").map((i, b) => b.textContent).get();
		/* "+2 more", clicked the way a person does: the click bubbles to
		 * Frappe's body handler, which closes the popover for any click it
		 * cannot place inside it (filter_list.js set_popover_events) */
		const hiddenBefore = __hidden;
		$pop.find(".tm-flinked-more")[0].click();
		const more = {
			closed: __hidden - hiddenBefore,
			all: $pop.find(".tm-flinked [data-link]:not([hidden])").length,
			button: $pop.find(".tm-flinked-more:not([hidden])").length,
		};
		$pop.find('.tm-flinked [data-link="employee"]')[0].click();
		await tick();
		const row = fl.filters[fl.filters.length - 1];
		const shown = row.fieldselect.awesomplete.suggestions.slice().sort();
		const typed = row.fieldselect.$input.val();
		/* pick "Employee › Gender" the way Awesomplete reports it */
		const ev = new CustomEvent("awesomplete-select");
		ev.text = { value: "Leave Application.employee.gender" };
		row.fieldselect.$input[0].dispatchEvent(ev);
		await row.field.set_value("Female");
		return { chips, picks, more, typed, shown, value: row.get_value().slice(0, 4), control: [row.field.df.fieldtype, row.field.df.options] };
	});
	check("chip: reads Employee › Department", built.chips.includes("Employee › Department"), true);
	check("builder: Linked documents shows six links, required first", built.picks, ["Employee", "Leave Type", "Company", "Department", "Leave Approver", "Holiday List"]);
	check("builder: \"+2 more\" shows the rest and goes", [built.more.all, built.more.button], [8, 0]);
	check("builder: and the filter popover stays open", built.more.closed, 0);
	check("builder: a pick opens a row narrowed to that document's fields", [built.typed, built.shown], ["Employee › ", ["Employee › Department", "Employee › Gender"]]);
	check("builder: choosing a field makes the row a linked condition", built.value, ["Leave Application", "employee.gender", "=", "Female"]);
	check("builder: with the target field's control", built.control, ["Link", "Gender"]);

	/* ---- other filter groups are left alone ----------------------------------- */
	const other = await page.evaluate(() => {
		__alerts.length = 0;
		const group = new frappe.ui.FilterGroup({ parent: $("<div>").appendTo("body"), doctype: "Leave Application", on_change() {} });
		const ok = group.add_filter("Leave Application", "employee.department", "=", "Sales");
		group.add_filter("Leave Application", "name");
		const options = group.filters[0].fieldselect.options.filter((o) => o.fieldname.includes("."));
		return { ok, alerts: __alerts.slice(), options: options.length };
	});
	check("other groups: a dashboard's filter group gets no linked fields", other.options, 0);
	check("other groups: and Frappe still rejects a dotted name there", [other.ok, other.alerts], [false, ["msgprint: Invalid filter: <b>employee.department</b>"]]);

	check("no page errors", errors, []);
	await browser.close();

	const failed = results.filter((r) => !r.pass);
	results.forEach((r) => console.log(`  ${r.pass ? "ok  " : "FAIL"} ${r.name}${r.pass ? "" : `\n        got      ${r.actual}\n        expected ${r.expected}`}`));
	console.log(`\nlinked filters: ${results.length - failed.length} passed, ${failed.length} failed`);
	process.exit(failed.length ? 1 : 0);
})();

/* Calendar Layout and the weekend (core/calendar.js).
 *
 * Runs the real file against mocks with the shape of Frappe's calendar
 * (views/calendar/calendar.js): CalendarView.get_calendar_preferences builds
 * the options, Calendar's constructor runs make_page -> setup_options -> make
 * -> setup_view_mode_button -> bind, the events source hands prepared events
 * to FullCalendar's callback, eventRender gets the event and its element.
 *
 * What is pinned:
 *  - the weekend is FullCalendar's hiddenDays with the configured days, the
 *    button toggles it and the choice survives a reload (Frappe read its own
 *    "false" back as truthy);
 *  - a layout's dates give a document type without a calendar one, read by
 *    the standard query; its fields ride on that query; a document type with
 *    its own events method gets the missing fields in one get_list by name;
 *  - the lines under the title, their formats, and that a value or label
 *    carrying markup is shown as text and never runs;
 *  - calendar settings written for the old core patch (field_map.percentage
 *    / .currency) keep their lines;
 *  - with the theme off, the calendar is Frappe's. */

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

const calendarSrc = fs.readFileSync(path.join(ROOT, "themate/public/js/core/calendar.js"), "utf8");

const results = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	results.push({ name, actual: a, expected: e, pass: a === e });
};

const MOCK = `
window.__ = (s, args) => (args ? String(s).replace(/\\{(\\d)\\}/g, (m, i) => args[i]) : s);
window.flt = (v) => parseFloat(v) || 0;
window.cint = (v) => parseInt(v, 10) || 0;
window.format_number = (v, fmt, p) =>
	Number(v).toLocaleString("en-US", { minimumFractionDigits: p ?? 0, maximumFractionDigits: p ?? 0 });
window.__calls = [];
window.__fc = [];
$.fn.fullCalendar = function (...args) { window.__fc.push(args); return this; };

const META = {
	Project: {
		project_name: { fieldname: "project_name", fieldtype: "Data" },
		expected_start_date: { fieldname: "expected_start_date", fieldtype: "Date" },
		expected_end_date: { fieldname: "expected_end_date", fieldtype: "Date" },
		estimated_costing: { fieldname: "estimated_costing", fieldtype: "Currency", options: "currency" },
		currency: { fieldname: "currency", fieldtype: "Link", options: "Currency" },
		percent_complete: { fieldname: "percent_complete", fieldtype: "Percent" },
		status: { fieldname: "status", fieldtype: "Select" },
		notes: { fieldname: "notes", fieldtype: "Data" },
		empty_one: { fieldname: "empty_one", fieldtype: "Data" },
	},
	"Sales Order": {
		customer_name: { fieldname: "customer_name", fieldtype: "Data" },
		delivery_date: { fieldname: "delivery_date", fieldtype: "Date" },
		grand_total: { fieldname: "grand_total", fieldtype: "Currency", options: "currency" },
		currency: { fieldname: "currency", fieldtype: "Link", options: "Currency" },
		per_billed: { fieldname: "per_billed", fieldtype: "Percent" },
		status: { fieldname: "status", fieldtype: "Select" },
	},
};

window.LAYOUTS = {
	Project: {
		layout: {
			name: "Project", event_style: "Card", title_field: "project_name",
			start_date_field: "expected_start_date", end_date_field: "expected_end_date", all_day: 1,
			color_by: "Status", event_color: null,
			fields: [
				{ fieldname: "estimated_costing", label: null, display: "Number", bold: 1, hide_if_empty: 1 },
				{ fieldname: "percent_complete", label: null, display: "Progress Bar", bold: 0, hide_if_empty: 1 },
				{ fieldname: "empty_one", label: "Never", display: "Value", bold: 0, hide_if_empty: 1 },
				{ fieldname: "notes", label: "<img src=x onerror=window.__pwned=1>", display: "Value", bold: 0, hide_if_empty: 1 },
			],
		},
		weekend: [5, 6],
	},
	"Sales Order": {
		layout: {
			name: "Sales Order", event_style: "Single Line", title_field: null,
			start_date_field: null, end_date_field: null, all_day: 0,
			color_by: "Fixed Color", event_color: "#7c3aed",
			fields: [
				{ fieldname: "grand_total", label: "Total", display: "Value", bold: 0, hide_if_empty: 1 },
				{ fieldname: "per_billed", label: null, display: "Number", bold: 0, hide_if_empty: 1 },
				{ fieldname: "status", label: null, display: "Badge", bold: 0, hide_if_empty: 1 },
			],
		},
		weekend: [5],
	},
	Legacy: { layout: null, weekend: [0, 6] },
};

window.frappe = {
	boot: {
		themate: {
			calendar_weekend: [5, 6],
			calendar_shade_weekend: 1,
			calendar_layouts: {
				Project: { start: "expected_start_date", end: "expected_end_date", title: "project_name", all_day: 1 },
				"Sales Order": { start: "delivery_date", end: "delivery_date", title: null, all_day: 1 },
			},
		},
	},
	views: {
		calendar: {
			"Sales Order": {
				field_map: { start: "delivery_date", end: "delivery_date", id: "name", title: "customer_name", allDay: "allDay" },
				get_events_method: "erpnext.selling.doctype.sales_order.sales_order.get_events",
			},
			Legacy: {
				field_map: { start: "day", end: "day", id: "name", title: "who", allDay: 1, percentage: "per", currency: "amt" },
				get_events_method: "legacy.get_events",
			},
		},
	},
	utils: {
		escape_html: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
		html2text: (h) => new DOMParser().parseFromString(String(h ?? ""), "text/html").body.textContent,
	},
	meta: {
		get_docfield: (dt, f) => META[dt]?.[f] || null,
		has_field: (dt, f) => !!META[dt]?.[f],
		get_field_precision: (df) => (df.fieldtype === "Currency" ? 2 : 3),
	},
	model: { std_fields: [{ fieldname: "name", fieldtype: "Link" }, { fieldname: "docstatus", fieldtype: "Int" }] },
	format: (v, df) => (df.fieldtype === "Currency" ? "EGP " + format_number(v, null, 2) : String(v)),
	get_meta: () => ({ title_field: "project_name" }),
	get_indicator: (d) => (d.status === "Completed" ? ["Completed", "green"] : ["Open", "orange"]),
	listview_settings: {},
	xcall(method, args) {
		window.__calls.push({ method, args });
		if (method === "themate.calendars.get_calendar_layout") return Promise.resolve(window.LAYOUTS[args.doctype]);
		if (method === "frappe.client.get_list") {
			return Promise.resolve([
				{ name: "SO-1", grand_total: 1000, per_billed: 40, status: "To Deliver", currency: "EGP" },
				{ name: "SO-2", grand_total: 2500.5, per_billed: 0, status: "Draft", currency: "EGP" },
			]);
		}
		return Promise.resolve(null);
	},
};

/* Frappe's CalendarView / Calendar, reduced to the calls calendar.js hooks */
frappe.views.CalendarView = class CalendarView {
	constructor(o) { Object.assign(this, o); }
	get_calendar_preferences() {
		const options = { doctype: this.doctype };
		if (this.calendar_name === "default") Object.assign(options, frappe.views.calendar[this.doctype]);
		return Promise.resolve(options);
	}
	render() { this.rendered = (this.rendered || 0) + 1; }
};

frappe.views.Calendar = class Calendar {
	constructor(options) {
		$.extend(this, options);
		this.field_map = this.field_map || { id: "name", start: "start", end: "end", allDay: "all_day", convertToUserTz: "convert_to_user_tz" };
		const defaults = { defaultView: "month", weekends: true };
		this.make_page();
		this.setup_options(defaults);
		this.make();
		this.setup_view_mode_button(defaults);
		this.bind();
	}
	make_page() {}
	make() {
		this.$wrapper = this.parent;
		this.$cal = $("<div>").appendTo(this.$wrapper);
		this.$wrapper.append('<div class="fc-toolbar"><button class="fc-today-button"></button><div class="fc-button-group"><button class="btn fc-agendaWeek-button"></button></div></div>');
		this.footnote_area = $('<div class="footnote-area"></div>').appendTo(this.$wrapper);
	}
	setup_view_mode_button(defaults) {
		this.footnote_area.find(".btn-weekend").detach();
		this.footnote_area.append('<button class="btn-weekend">' + (defaults.weekends ? "Hide Weekends" : "Show Weekends") + "</button>");
	}
	set_localStorage_option(o, v) { localStorage.setItem(o, v); }
	bind() {
		this.$wrapper.on("click", ".btn-weekend", () => { window.__native_weekend = (window.__native_weekend || 0) + 1; });
	}
	set_css() {
		this.$wrapper.find(".fc-today-button").prepend("<svg></svg>");
		window.__set_css = (window.__set_css || 0) + 1;
	}
	setup_options(defaults) {
		const me = this;
		this.cal_options = {
			weekends: defaults.weekends,
			events(start, end, tz, callback) {
				const list = me.prepare_events(JSON.parse(JSON.stringify(window.__server_events || [])));
				callback(list);
			},
			eventRender(event, element) { element.attr("title", event.tooltip); },
		};
		if (this.options) $.extend(this.cal_options, this.options);
	}
	get_args() { return { doctype: this.doctype, fields: this.fields, field_map: this.field_map }; }
	prepare_events(events) {
		return events.map((d) => {
			$.each(this.field_map, (target, source) => { d[target] = d[source]; });
			if (typeof d.allDay === "undefined") d.allDay = this.field_map.allDay;
			d.title = frappe.utils.html2text(d.title);
			return d;
		});
	}
};

window.eventElement = (title) =>
	$('<a class="fc-event"><div class="fc-content"><span class="fc-time"></span><span class="fc-title"></span></div></a>')
		.find(".fc-title").text(title).end();
window.loadEvents = (cal) => new Promise((resolve) => cal.cal_options.events(null, null, null, resolve));
`;

(async () => {
	const { chromium } = require("playwright");
	const browser = await chromium.launch({ executablePath: chromiumPath() });

	async function fresh() {
		const page = await browser.newPage();
		await page.route("**/*", (route) =>
			route.fulfill({ status: 200, contentType: "text/html", body: "<!DOCTYPE html><html><body></body></html>" })
		);
		await page.goto("http://themate.test/");
		await page.addScriptTag({ content: fs.readFileSync(JQUERY, "utf8") });
		await page.addScriptTag({ content: MOCK });
		return page;
	}

	/* ---- a layout that gives Project a calendar ---------------------------- */
	{
		const page = await fresh();
		await page.evaluate(() => localStorage.setItem("cal_weekends", "false"));
		await page.addScriptTag({ content: calendarSrc });
		const out = await page.evaluate(async () => {
			const registered = frappe.views.calendar.Project;
			const soKept = frappe.views.calendar["Sales Order"].get_events_method;
			const view = new frappe.views.CalendarView({ doctype: "Project", calendar_name: "default" });
			const options = await view.get_calendar_preferences();
			const cal = new frappe.views.Calendar(Object.assign(options, { parent: $("<div>").appendTo(document.body), list_view: view }));

			const args = cal.get_args();
			window.__server_events = [
				{ name: "PROJ-2", project_name: "Ali Yehia - Fit-out", expected_start_date: "2026-09-05", expected_end_date: "2026-09-05",
					estimated_costing: 1107904.72, currency: "EGP", percent_complete: 99.95, status: "Open", docstatus: 0,
					notes: "<b>x</b><img src=x onerror=window.__pwned=1>", empty_one: null },
			];
			const events = await loadEvents(cal);
			const ev = events[0];
			const $el = eventElement(ev.title);
			cal.cal_options.eventRender(ev, $el);
			$el.appendTo(document.body);
			await new Promise((r) => setTimeout(r, 50));

			const weekendBefore = { hidden: cal.cal_options.hiddenDays, weekends: cal.cal_options.weekends, label: cal.footnote_area.find(".btn-weekend").text() };
			window.__fc.length = 0;
			cal.$wrapper.find(".btn-weekend").trigger("click");
			const weekendAfter = { fc: window.__fc.slice(), label: cal.footnote_area.find(".btn-weekend").text(), stored: localStorage.getItem("cal_weekends"), native: window.__native_weekend || 0, set_css: window.__set_css || 0, todayIcons: cal.$wrapper.find(".fc-today-button svg").length };

			return {
				registered,
				soKept,
				map: options.field_map,
				method: options.get_events_method,
				weekendDays: options.tm_weekend,
				shade: cal.$cal.attr("data-tm-weekend"),
				fields: (args.fields || []).slice().sort(),
				listCalls: window.__calls.filter((c) => c.method === "frappe.client.get_list").length,
				title: ev.title,
				bg: ev.backgroundColor,
				text: ev.textColor,
				card: $el.hasClass("tm-cal-card"),
				head: $el.find(".tm-cal-head .fc-title").text(),
				lines: $el.find(".tm-cal-line").map((i, l) => $(l).text()).get(),
				bold: $el.find(".tm-cal-line").first().hasClass("is-bold"),
				bar: $el.find(".tm-cal-bar > i").attr("style"),
				ltr: $el.find(".tm-cal-line").slice(0, 2).map((i, l) => $(l).find(".tm-cal-value").attr("dir")).get(),
				imgs: $el.find("img").length,
				pwned: window.__pwned || 0,
				tooltip: $el.attr("title"),
				weekendBefore,
				weekendAfter,
			};
		});

		check("boot: a layout with dates gives the document type a calendar", out.registered,
			{ field_map: { id: "name", start: "expected_start_date", end: "expected_end_date", title: "project_name", allDay: 1 } });
		check("boot: a document type's own calendar is left alone", out.soKept, "erpnext.selling.doctype.sales_order.sales_order.get_events");
		check("layout: its dates and title are the field map", [out.map.start, out.map.end, out.map.title, out.map.allDay],
			["expected_start_date", "expected_end_date", "project_name", 1]);
		check("layout: dates from the layout are read by the standard query", out.method, null);
		check("weekend: the layout's days", out.weekendDays, [5, 6]);
		check("weekend: written on the calendar for the shading", out.shade, "5 6");
		check("query: the line fields ride on the standard query, with the amount's currency and the status",
			out.fields, ["currency", "docstatus", "estimated_costing", "expected_end_date", "expected_start_date", "name", "notes", "percent_complete", "project_name", "empty_one", "status"].sort());
		check("query: nothing to fetch a second time", out.listCalls, 0);
		check("status colour: the pill colour, blended for the card", out.bg,
			"color-mix(in srgb, var(--bg-orange) var(--tm-cal-status-mix, 100%), var(--tm-surface, transparent))");
		check("status colour: its text colour", out.text, "var(--text-on-orange)");
		check("card: the event is a card", out.card, true);
		check("card: the title heads it", out.head, "Ali Yehia - Fit-out");
		/* the label is shown as written; a value is the formatter's output
		 * (HTML) read as text in an inert document, so its tags drop out */
		check("lines: a number, a percentage bar, a value; an empty one is left out",
			out.lines, ["1,107,904.72", "99.95 %", "<img src=x onerror=window.__pwned=1>x"]);
		check("lines: Bold is bold", out.bold, true);
		check("lines: the bar is as long as the percentage", out.bar, "inline-size:99.95%");
		check("lines: figures read left to right in an RTL page", out.ltr, ["ltr", "ltr"]);
		check("safety: markup in a label or a value is text, not elements", out.imgs, 0);
		check("safety: and never runs", out.pwned, 0);
		check("tooltip: the title and every line", out.tooltip.split("\n").slice(0, 3), ["Ali Yehia - Fit-out", "1,107,904.72", "99.95 %"]);
		check("weekend: a hidden weekend survives the reload (Frappe read \"false\" as true)", out.weekendBefore,
			{ hidden: [5, 6], weekends: true, label: "Show Weekends" });
		check("weekend: the button shows it again through hiddenDays", out.weekendAfter.fc, [["option", "hiddenDays", []]]);
		check("weekend: and says so, and remembers it", [out.weekendAfter.label, out.weekendAfter.stored], ["Hide Weekends", "true"]);
		check("weekend: Frappe's Sat/Sun toggle does not run", out.weekendAfter.native, 0);
		check("weekend: the redrawn toolbar is styled again, with one Today icon", [out.weekendAfter.set_css, out.weekendAfter.todayIcons], [1, 1]);
		await page.close();
	}

	/* ---- a document type with its own events method ------------------------ */
	{
		const page = await fresh();
		await page.addScriptTag({ content: calendarSrc });
		const out = await page.evaluate(async () => {
			const view = new frappe.views.CalendarView({ doctype: "Sales Order", calendar_name: "default" });
			const options = await view.get_calendar_preferences();
			const cal = new frappe.views.Calendar(Object.assign(options, { parent: $("<div>").appendTo(document.body), list_view: view }));
			const args = cal.get_args();
			window.__server_events = [
				{ name: "SO-1", customer_name: "Karim Yasser", delivery_date: "2026-09-07" },
				{ name: "SO-2", customer_name: "Nour Clinic", delivery_date: "2026-09-08" },
			];
			const events = await loadEvents(cal);
			const $el = eventElement(events[0].title);
			cal.cal_options.eventRender(events[0], $el);
			const call = window.__calls.find((c) => c.method === "frappe.client.get_list");
			return {
				method: options.get_events_method,
				fields: args.fields === undefined,
				call: call && { fields: call.args.fields.slice().sort(), filters: call.args.filters },
				merged: [events[0].grand_total, events[1].status],
				oneline: $el.hasClass("tm-cal-oneline"),
				inline: $el.find(".tm-cal-inline").text(),
				badge: $el.find('.tm-cal-line[data-display="badge"] .tm-cal-value').text(),
				bg: events[0].backgroundColor,
				weekend: options.tm_weekend,
				hidden: cal.cal_options.hiddenDays,
			};
		});
		check("own method: kept, since the layout does not name dates", out.method, "erpnext.selling.doctype.sales_order.sales_order.get_events");
		check("own method: its arguments are not touched", out.fields, true);
		check("own method: what it did not return is read in one call, by name",
			out.call, { fields: ["currency", "grand_total", "name", "per_billed", "status"], filters: [["name", "in", ["SO-1", "SO-2"]]] });
		check("own method: and merged into the events", out.merged, [1000, "Draft"]);
		check("single line: the fields follow the title", [out.oneline, out.inline], [true, "TotalEGP 1,000.00·40 %·To Deliver"]);
		check("badge: the value in a tag", out.badge, "To Deliver");
		check("fixed colour: a wash of it on the surface", out.bg, "color-mix(in srgb, #7c3aed 18%, var(--tm-surface, #fff))");
		check("weekend: a calendar's own weekend", [out.weekend, out.hidden], [[5], []]);
		await page.close();
	}

	/* ---- settings written for the old core patch --------------------------- */
	{
		const page = await fresh();
		await page.addScriptTag({ content: calendarSrc });
		const out = await page.evaluate(async () => {
			const view = new frappe.views.CalendarView({ doctype: "Legacy", calendar_name: "default" });
			const options = await view.get_calendar_preferences();
			const cal = new frappe.views.Calendar(Object.assign(options, { parent: $("<div>").appendTo(document.body), list_view: view }));
			window.__server_events = [{ name: "L-1", who: "(2) Aesha ElKassem", day: "2026-09-30", per: 100, amt: 1000041.65 }];
			const events = await loadEvents(cal);
			const $el = eventElement(events[0].title);
			cal.cal_options.eventRender(events[0], $el);
			return { lines: $el.find(".tm-cal-line").map((i, l) => $(l).text()).get(), card: $el.hasClass("tm-cal-card") };
		});
		check("legacy: field_map.currency and .percentage keep their lines", out.lines, ["1,000,041.65", "100 %"]);
		check("legacy: drawn as a card", out.card, true);
		await page.close();
	}

	/* ---- theme off, and a layout saved while a calendar is open ------------ */
	{
		const page = await fresh();
		await page.addScriptTag({ content: "window.themate = { enabled: () => false };" });
		await page.addScriptTag({ content: calendarSrc });
		const out = await page.evaluate(async () => {
			const view = new frappe.views.CalendarView({ doctype: "Project", calendar_name: "default" });
			const options = await view.get_calendar_preferences();
			const cal = new frappe.views.Calendar(Object.assign(options, { parent: $("<div>").appendTo(document.body), list_view: view }));
			cal.$wrapper.find(".btn-weekend").trigger("click");
			const off = { layout: "tm_layout" in options, hidden: cal.cal_options.hiddenDays, native: window.__native_weekend || 0, calls: window.__calls.length };

			window.themate.enabled = () => true;
			const open = new frappe.views.CalendarView({ doctype: "Project", calendar_name: "default", $result: $("<div><p>old</p></div>") });
			open.calendar = { tm_version: 1, $cal: $("<div>") };
			window.__fc.length = 0;
			window.themate.calendarLayouts.clear();
			open.render();
			return { off, rebuilt: open.calendar === null && open.$result.children().length === 0, destroyed: window.__fc, rendered: open.rendered };
		});
		check("theme off: no layout is asked for", [out.off.layout, out.off.calls], [false, 0]);
		check("theme off: the weekend button is Frappe's", [out.off.hidden, out.off.native], [undefined, 1]);
		check("saved layout: an open calendar is rebuilt the next time it shows", [out.rebuilt, out.rendered], [true, 1]);
		check("saved layout: FullCalendar is destroyed first", out.destroyed, [["destroy"]]);
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
	console.log(`\ncalendar: ${pass} passed, ${failures.length} failed`);
	process.exit(failures.length ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

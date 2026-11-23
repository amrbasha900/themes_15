/* Calendar: what an event shows, and which days are the weekend.
 *
 * Native (views/calendar/calendar.js) draws an event as its title alone, and
 * its Hide Weekends button sets FullCalendar v3's `weekends: false`, which
 * hides Saturday and Sunday and nothing else (fullcalendar.min.js pushes 0
 * and 6). A desk whose weekend is Friday and Saturday had to patch the
 * library and calendar.js to show an amount or a percentage on an event.
 *
 * Both are settings now (themate/calendars.py):
 *  - Calendar Layout, per document type (or per saved Calendar View): the
 *    fields drawn under the title and how, card or single-line events, the
 *    colour, the event's own title / start / end fields, its own weekend;
 *  - Theme Settings > Calendar: the site's weekend, and whether it is shaded.
 *
 * Nothing in Frappe or FullCalendar is edited. Prototype hooks only:
 *  - CalendarView.get_calendar_preferences resolves the layout with the
 *    options it already builds, so the calendar is made once, already right;
 *  - Calendar.setup_options wraps the options FullCalendar is given: the
 *    events source (extra fields, colours), eventRender (the lines), and
 *    hiddenDays for the weekend button — FullCalendar's own option for
 *    hiding any set of days;
 *  - Calendar.get_args asks the standard events query for the extra fields,
 *    so a calendar on frappe.desk.calendar.get_events needs no second call.
 *    A document type with its own events method (Sales Order's joins its
 *    items) returns only its own columns; what is missing is read in one
 *    frappe.client.get_list by name, permission-checked like the list.
 *
 * Calendars built on the old core patch — a doctype's calendar settings with
 * field_map.percentage / field_map.currency — keep their lines without it. */
(function () {
	const frappe = window.frappe;
	const $ = window.jQuery;
	const CalendarView = frappe?.views?.CalendarView;
	const Calendar = frappe?.views?.Calendar;
	if (!CalendarView || !Calendar || !$ || Calendar.prototype._tm_layout) return;
	Calendar.prototype._tm_layout = true;

	const enabled = () => window.themate?.enabled?.() !== false;
	const theme = () => frappe.boot?.themate || {};
	const STD = ["name", "owner", "creation", "modified", "modified_by", "docstatus"];
	const DEFAULT_EVENTS_METHOD = "frappe.desk.calendar.get_events";
	const DEFAULT_FIELD_MAP = { id: "name", start: "start", end: "end", allDay: "all_day", convertToUserTz: "convert_to_user_tz" };
	/* frappe.get_indicator colour -> the --bg-* / --text-on-* pair Frappe
	 * defines for indicator pills, in both modes (css_variables.scss, dark.scss) */
	const PILL = { blue: "blue", cyan: "cyan", green: "green", orange: "orange", red: "red", yellow: "yellow", purple: "purple", pink: "pink", gray: "gray", grey: "gray", darkgrey: "gray", "light-gray": "gray", "dark-blue": "blue", "light-blue": "blue" };

	/* ---- document types whose calendar is a layout's ---------------------
	 * The Calendar view is offered only where frappe.views.calendar[doctype]
	 * exists (list_view_select.js:77), which a document type without its own
	 * *_calendar.js never has. One whose layout names its dates gets one. A
	 * document type's own settings, loaded with its meta, replace this. */
	Object.entries(theme().calendar_layouts || {}).forEach(([doctype, c]) => {
		if (frappe.views.calendar[doctype] || !c?.start) return;
		frappe.views.calendar[doctype] = {
			field_map: { id: "name", start: c.start, end: c.end || c.start, title: c.title || "name", allDay: c.all_day ? 1 : 0 },
		};
	});

	/* ---- the layout, fetched once per calendar ---------------------------- */
	const cache = {};
	let version = 1;

	function siteWeekend() {
		return days(theme().calendar_weekend ?? [5, 6]);
	}

	function days(list) {
		return [...new Set((list || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
	}

	function loadLayout(doctype, calendar) {
		const view = calendar && calendar !== "default" ? calendar : null;
		const key = `${doctype}::${view || ""}`;
		if (!cache[key]) {
			cache[key] = frappe
				.xcall("themate.calendars.get_calendar_layout", { doctype, calendar_view: view })
				.catch(() => ({ layout: null, weekend: siteWeekend() }));
		}
		return cache[key];
	}

	/* Calendar Layout's form clears this after a save; a calendar already
	 * open in the tab is rebuilt the next time it is shown. */
	window.themate = window.themate || {};
	window.themate.calendarLayouts = {
		clear() {
			Object.keys(cache).forEach((k) => delete cache[k]);
			version++;
		},
	};

	const fieldDf = (doctype, fieldname) =>
		frappe.meta.get_docfield(doctype, fieldname) ||
		frappe.model.std_fields.find((df) => df.fieldname === fieldname) ||
		null;
	const isField = (doctype, f) => typeof f === "string" && !!f && (STD.includes(f) || !!frappe.meta.has_field(doctype, f));

	/* The layout's dates and title go into the options the calendar is made
	 * from. Dates from the layout are read by the standard events query: a
	 * document type's own events method knows nothing of these fields. */
	function withLayout(view, options, result) {
		const layout = result?.layout || null;
		options.tm_layout = layout;
		options.tm_weekend = result?.weekend ? days(result.weekend) : siteWeekend();
		options.tm_version = version;
		if (!layout) return options;

		const meta = frappe.get_meta(view.doctype);
		const map = Object.assign({}, options.field_map || DEFAULT_FIELD_MAP);
		if (layout.start_date_field) {
			map.start = layout.start_date_field;
			map.end = layout.end_date_field || layout.start_date_field;
			map.allDay = isField(view.doctype, map.allDay) && !layout.all_day ? map.allDay : layout.all_day ? 1 : 0;
			options.get_events_method = null;
		}
		if (layout.title_field) map.title = layout.title_field;
		if (!map.title) map.title = meta?.title_field || "name";
		options.field_map = map;
		return options;
	}

	const preferences = CalendarView.prototype.get_calendar_preferences;
	CalendarView.prototype.get_calendar_preferences = function () {
		const base = preferences.apply(this, arguments);
		if (!enabled()) return base;
		return Promise.all([base, loadLayout(this.doctype, this.calendar_name)]).then(([options, result]) =>
			withLayout(this, options, result)
		);
	};

	const viewRender = CalendarView.prototype.render;
	CalendarView.prototype.render = function () {
		const cal = this.calendar;
		if (cal?.tm_version && cal.tm_version !== version) {
			try {
				cal.$cal.fullCalendar("destroy");
			} catch (e) {
				/* already gone */
			}
			this.$result.empty();
			this.calendar = null;
		}
		return viewRender.apply(this, arguments);
	};

	/* ---- the fields an event needs ---------------------------------------- */
	function neededFields(cal) {
		const layout = cal.tm_layout;
		const dt = cal.doctype;
		if (!layout) return [];
		const out = new Set();
		(layout.fields || []).forEach((row) => {
			out.add(row.fieldname);
			/* an amount is formatted in its own currency when the record says which */
			const df = fieldDf(dt, row.fieldname);
			if (df?.fieldtype === "Currency" && df.options && isField(dt, df.options)) out.add(df.options);
		});
		if (layout.title_field) out.add(layout.title_field);
		if (layout.color_by === "Status") {
			["status", "docstatus", ...(frappe.listview_settings[dt]?.add_fields || [])].forEach((f) => out.add(f));
		}
		return [...out].filter((f) => isField(dt, f));
	}

	function queryFields(cal) {
		const dt = cal.doctype;
		const map = cal.field_map || {};
		const base = cal.fields || [];
		const all = new Set([...base, "name", "docstatus", ...Object.values(map), ...cal.tm_needed]);
		return [...all].filter((f) => isField(dt, f));
	}

	/* What the events method did not return, read by name in one call. */
	function enrich(cal, events) {
		const missing = cal.tm_needed.filter((f) => events.length && !events.every((d) => f in d));
		if (!missing.length) return Promise.resolve();
		const names = [...new Set(events.map((d) => d.name).filter(Boolean))];
		if (!names.length) return Promise.resolve();
		return frappe
			.xcall(
				"frappe.client.get_list",
				{ doctype: cal.doctype, fields: ["name", ...missing], filters: [["name", "in", names]], limit_page_length: 0 }
			)
			.then((rows) => {
				const by = {};
				(rows || []).forEach((r) => (by[r.name] = r));
				events.forEach((d) => {
					const row = by[d.name];
					if (row) missing.forEach((f) => !(f in d) && (d[f] = row[f]));
				});
			});
	}

	function finish(cal, events) {
		const layout = cal.tm_layout;
		if (!layout) return;
		events.forEach((d) => {
			const tf = layout.title_field;
			if (tf && d[tf] !== undefined && d[tf] !== null) d.title = frappe.utils.html2text(String(d[tf]));
			if (layout.color_by === "Status") statusColor(cal, d);
			else if (layout.color_by === "Fixed Color") fixedColor(d, layout.event_color);
		});
	}

	function statusColor(cal, d) {
		let indicator = null;
		try {
			indicator = frappe.get_indicator(d, cal.doctype);
		} catch (e) {
			return;
		}
		const color = PILL[indicator?.[1]] || "gray";
		/* the pill colours are sized for a pill; on a whole card the dark
		 * ones are blended into the surface (--tm-cal-status-mix, _calendar.scss) */
		d.backgroundColor = `color-mix(in srgb, var(--bg-${color}) var(--tm-cal-status-mix, 100%), var(--tm-surface, transparent))`;
		d.borderColor = d.backgroundColor;
		d.textColor = `var(--text-on-${color})`;
	}

	/* A wash of the colour on the surface and the colour for the text, so
	 * one strong colour reads the same in light and dark. */
	function fixedColor(d, hex) {
		if (!/^#[0-9a-f]{3,8}$/i.test(hex || "")) return;
		d.backgroundColor = `color-mix(in srgb, ${hex} 18%, var(--tm-surface, #fff))`;
		d.borderColor = d.backgroundColor;
		d.textColor = `color-mix(in srgb, ${hex} 78%, var(--tm-text, #000))`;
	}

	/* ---- the lines under the title ---------------------------------------- */
	const esc = (s) => frappe.utils.escape_html(String(s ?? ""));
	const NUMERIC = ["Currency", "Float", "Int", "Percent"];

	/* Formatter output as text. An inert document: a value carrying markup
	 * is read, never run (a detached <div> still loads an <img onerror>). */
	function asText(html) {
		if (html === null || html === undefined) return "";
		const doc = new DOMParser().parseFromString(String(html), "text/html");
		return (doc.body.textContent || "").trim();
	}

	function trimmed(v) {
		const decimals = Number.isInteger(v) ? 0 : Math.min(2, (String(v).split(".")[1] || "").length);
		return format_number(v, null, decimals);
	}

	function percentText(raw) {
		return `${trimmed(flt(raw))} %`;
	}

	function numberText(raw, df, d) {
		if (df?.fieldtype === "Percent") return percentText(raw);
		const precision = df?.fieldtype === "Int" ? 0 : df ? frappe.meta.get_field_precision(df, d) : null;
		return precision === null || precision === undefined ? trimmed(flt(raw)) : format_number(flt(raw), null, precision);
	}

	function valueText(raw, df, d) {
		if (!df) return String(raw);
		if (df.fieldtype === "Check") return cint(raw) ? __("Yes") : __("No");
		if (df.fieldtype === "Percent") return percentText(raw);
		return asText(frappe.format(raw, df, { only_value: 1, inline: 1 }, d));
	}

	function line(cal, row, d) {
		const df = fieldDf(cal.doctype, row.fieldname);
		const raw = d[row.fieldname];
		const empty = raw === undefined || raw === null || raw === "";
		if (empty && row.hide_if_empty) return null;
		const numeric = !!df && NUMERIC.includes(df.fieldtype);
		let text;
		let body = "";
		if (empty) {
			text = "–";
		} else if (row.display === "Progress Bar") {
			const pct = Math.max(0, Math.min(100, flt(raw)));
			text = percentText(raw);
			body = `<span class="tm-cal-bar" aria-hidden="true"><i style="inline-size:${pct}%"></i></span>`;
		} else if (row.display === "Number") {
			text = numberText(raw, df, d);
		} else {
			text = valueText(raw, df, d);
		}
		const label = row.label ? __(row.label) : "";
		const kind = String(row.display || "Value").toLowerCase().replace(/\s+/g, "-");
		const dir = numeric || row.display === "Number" || row.display === "Progress Bar" ? ' dir="ltr"' : "";
		return {
			text: label ? `${label}: ${text}` : text,
			html:
				`<span class="tm-cal-line${row.bold ? " is-bold" : ""}" data-display="${kind}">` +
				(label ? `<span class="tm-cal-label">${esc(label)}</span>` : "") +
				body +
				`<span class="tm-cal-value"${dir}>${esc(text)}</span></span>`,
		};
	}

	/* The old core patch's two lines, for calendar settings written for it. */
	function legacyLines(cal, d) {
		const out = [];
		if (cal.tm_layout || !cal.field_map) return out;
		if (cal.field_map.currency && d.currency !== undefined && d.currency !== null && d.currency !== "") {
			const text = typeof d.currency === "number" ? format_number(d.currency, null, 2) : String(d.currency);
			out.push({ text, html: `<span class="tm-cal-line" data-display="number"><span class="tm-cal-value" dir="ltr">${esc(text)}</span></span>` });
		}
		if (cal.field_map.percentage && d.percentage !== undefined && d.percentage !== null && d.percentage !== "") {
			const text = percentText(d.percentage);
			out.push({ text, html: `<span class="tm-cal-line" data-display="number"><span class="tm-cal-value" dir="ltr">${esc(text)}</span></span>` });
		}
		return out;
	}

	function renderEvent(cal, event, element) {
		const rows = cal.tm_layout?.fields || [];
		const lines = rows.length ? rows.map((row) => line(cal, row, event)).filter(Boolean) : legacyLines(cal, event);
		const $content = element.find(".fc-content");
		if (!lines.length || !$content.length) return;
		const oneLine = cal.tm_layout?.event_style === "Single Line";
		if (oneLine) {
			element.addClass("tm-cal-oneline");
			$content.append(`<span class="tm-cal-inline">${lines.map((l) => l.html).join('<span class="tm-cal-sep" aria-hidden="true">·</span>')}</span>`);
		} else {
			element.addClass("tm-cal-card");
			const $head = $('<span class="tm-cal-head"></span>');
			$content.children(".fc-time, .fc-title").appendTo($head);
			$content.prepend($head).append(`<span class="tm-cal-lines">${lines.map((l) => l.html).join("")}</span>`);
		}
		element.attr("title", [event.tooltip || event.title, ...lines.map((l) => l.text)].filter(Boolean).join("\n"));
	}

	/* ---- the calendar ----------------------------------------------------- */
	const canHide = (list) => list.length > 0 && list.length < 7;
	function readHidden() {
		try {
			/* Frappe stores the button's state as "true" / "false" and read the
			 * string back as truthy, so a hidden weekend never survived a reload */
			return localStorage.getItem("cal_weekends") === "false";
		} catch (e) {
			return false;
		}
	}

	const setupOptions = Calendar.prototype.setup_options;
	Calendar.prototype.setup_options = function () {
		const out = setupOptions.apply(this, arguments);
		if (!enabled() || !this.tm_weekend) return out;
		try {
			decorate(this);
		} catch (e) {
			console.error("themate: calendar", e);
		}
		return out;
	};

	function decorate(cal) {
		const o = cal.cal_options;
		cal.tm_needed = neededFields(cal);
		cal.tm_standard_query = !cal.get_events_method || cal.get_events_method === DEFAULT_EVENTS_METHOD;
		cal.tm_hide_weekend = readHidden() && canHide(cal.tm_weekend);

		/* the weekend is ours to hide, whichever days it is */
		o.weekends = true;
		o.hiddenDays = cal.tm_hide_weekend ? cal.tm_weekend : [];

		const source = o.events;
		o.events = function (start, end, timezone, callback) {
			return source.call(this, start, end, timezone, (events) => {
				const list = events || [];
				enrich(cal, list)
					.catch(() => {})
					.then(() => {
						finish(cal, list);
						callback(list);
					});
			});
		};

		const render = o.eventRender;
		o.eventRender = function (event, element) {
			const result = render?.apply(this, arguments);
			try {
				renderEvent(cal, event, element);
			} catch (e) {
				/* an event with its title is better than none */
			}
			return result;
		};
	}

	const getArgs = Calendar.prototype.get_args;
	Calendar.prototype.get_args = function () {
		const args = getArgs.apply(this, arguments);
		if (this.tm_needed?.length && this.tm_standard_query) args.fields = queryFields(this);
		return args;
	};

	/* the weekend's days on the calendar, for the shading (_calendar.scss) */
	const make = Calendar.prototype.make;
	Calendar.prototype.make = function () {
		const out = make.apply(this, arguments);
		if (this.tm_weekend && theme().calendar_shade_weekend !== 0) {
			this.$cal?.attr("data-tm-weekend", this.tm_weekend.join(" "));
		}
		return out;
	};

	const viewModeButton = Calendar.prototype.setup_view_mode_button;
	Calendar.prototype.setup_view_mode_button = function () {
		if (!this.tm_weekend) return viewModeButton.apply(this, arguments);
		this.footnote_area.find(".btn-weekend").remove();
		if (!canHide(this.tm_weekend)) return;
		const label = this.tm_hide_weekend ? __("Show Weekends") : __("Hide Weekends");
		this.footnote_area.append(`<button type="button" class="btn btn-default btn-xs btn-weekend">${label}</button>`);
	};

	const bind = Calendar.prototype.bind;
	Calendar.prototype.bind = function () {
		const out = bind.apply(this, arguments);
		if (!this.tm_weekend) return out;
		/* replaces the native handler, which toggles `weekends` (Sat + Sun) */
		this.$wrapper.off("click", ".btn-weekend").on("click", ".btn-weekend", () => {
			this.tm_hide_weekend = !this.tm_hide_weekend;
			try {
				localStorage.setItem("cal_weekends", String(!this.tm_hide_weekend));
			} catch (e) {
				/* the choice lasts for this page */
			}
			this.$cal.fullCalendar("option", "hiddenDays", this.tm_hide_weekend ? this.tm_weekend : []);
			restyleToolbar(this);
			this.setup_view_mode_button();
		});
		return out;
	};

	/* Changing an option makes FullCalendar draw its toolbar anew, without
	 * what Frappe's set_css() and bind() put on it: the button classes, the
	 * arrow and Today icons, and the handler that remembers the chosen view.
	 * (Frappe's own weekend toggle calls set_css and loses the handler.) */
	function restyleToolbar(cal) {
		cal.$wrapper.find(".fc-today-button svg").remove();
		cal.set_css();
		cal.$wrapper.find(".fc-button-group").off("click.tm-view").on("click.tm-view", ".btn", function () {
			const value = $(this).hasClass("fc-agendaWeek-button") ? "agendaWeek" : $(this).hasClass("fc-agendaDay-button") ? "agendaDay" : "month";
			cal.set_localStorage_option("cal_defaultView", value);
		});
	}
})();

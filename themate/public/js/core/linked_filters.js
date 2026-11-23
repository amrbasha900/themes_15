/* Filtering a list by a field of a linked document.
 *
 * Leave Application links to Employee; the question is "the leaves of the
 * employees in Sales". Frappe's filter rows offer the doctype's own fields
 * and its child tables', and its query engine cannot answer it either: a
 * filter on another doctype is joined as a child table (db_query.py
 * prepare_args: `parent = name`), dotted names are honoured for fields only,
 * and generated queries may not hold a subquery.
 *
 * So the condition is answered first, and the list filtered by the answer:
 *   ["Leave Application", "employee.department", "=", "Sales"]
 *     -> the Employees whose department is Sales (frappe.get_list on
 *        Employee, so the user's own permissions apply)
 *     -> ["Leave Application", "employee", "in", [those names]]
 *
 * The dotted form — the link field, then the field on the linked document,
 * the notation db_query already uses for fields — is what the filter row,
 * the chip, the list settings, saved views and the URL keep. Only what goes
 * to the server is translated: get_filters_for_args (list, count, group-by
 * and tag counts, Report view, export), the any-of group (list_filters.js)
 * and the Calendar's events query. A refresh answers the conditions first;
 * each answer is kept for TTL, so paging and realtime refreshes reuse it.
 * Past LIMIT matching documents, the first LIMIT are used and an alert says so.
 *
 * Only the filter groups the theme's bar owns offer linked fields — a list's
 * own filter area and its any-of group (list_filters.js sets the flags). A
 * dashboard chart's or a number card's FilterGroup stores what it gets and
 * sends it to the server as it is, where a dotted name would fail.
 *
 * The fields come from themate.api.get_linked_filter_fields, one request per
 * doctype per session, made when a filter needs them: the builder opening,
 * or a saved / routed filter being restored. */
(function () {
	const frappe = window.frappe;
	const ui = frappe?.ui;
	if (!frappe?.views?.BaseList || !ui?.Filter || !ui?.FilterGroup || !ui?.FieldSelect) return;
	if (window.themate?.enabled?.() === false) return; /* master switch off: Frappe's own filters */
	const BaseList = frappe.views.BaseList;
	if (BaseList.prototype._tm_linked_filters) return;
	BaseList.prototype._tm_linked_filters = true;

	const LIMIT = 10000;
	const TTL = 60 * 1000;
	/* U+203A is bidi-mirrored: it points the reading direction in RTL too */
	const SEP = " › ";

	const requests = {}; /* doctype -> Promise of its linked fields */
	const loaded = {}; /* doctype -> { links: [{fieldname, label, doctype}], doctypes: {doctype: [df]} } */
	const answers = new Map(); /* condition key -> { names, at } */
	const asking = new Map(); /* condition key -> Promise */

	function load(doctype) {
		if (!requests[doctype]) {
			requests[doctype] = frappe
				.xcall("themate.api.get_linked_filter_fields", { doctype })
				.then((r) => r || {})
				.catch(() => ({}))
				.then((r) => (loaded[doctype] = { links: r.links || [], doctypes: r.doctypes || {} }));
		}
		return requests[doctype];
	}

	/* "employee.department" on a doctype whose `employee` is a Link -> its parts */
	function parse(doctype, fieldname) {
		if (typeof fieldname !== "string") return null;
		const i = fieldname.indexOf(".");
		if (i < 1 || i === fieldname.length - 1 || fieldname.indexOf(".", i + 1) !== -1) return null;
		const link = fieldname.slice(0, i);
		const df = frappe.meta.get_docfield(doctype, link);
		if (!df || df.fieldtype !== "Link" || !df.options) return null;
		return { link, field: fieldname.slice(i + 1), target: df.options, label: df.label || link };
	}

	const isLinked = (doctype, f) => Array.isArray(f) && f[0] === doctype && !!parse(doctype, f[1]);

	/* the row a linked field gets: its own type and options, labelled
	 * "Employee › Department" */
	function docfield(doctype, fieldname) {
		const p = parse(doctype, fieldname);
		if (!p) return null;
		const df = (loaded[doctype]?.doctypes[p.target] || []).find((d) => d.fieldname === p.field) || frappe.meta.get_docfield(p.target, p.field) || {};
		return {
			fieldname,
			label: `${__(p.label, null, doctype)}${SEP}${__(df.label || p.field, null, p.target)}`,
			fieldtype: df.fieldtype || "Data",
			options: df.options,
			parent: doctype,
		};
	}

	/* The linked fields join a filter row's field picker: one option per
	 * field of each linked document, under the same fields_by_name table
	 * Filter.set_field reads, so the row makes the control the target field
	 * would have (a Link stays a Link to Department, a Select keeps its
	 * options). Awesomplete holds the options array itself, so options added
	 * after the request lands are searchable at once. */
	function addOptions(select, doctype) {
		const data = loaded[doctype];
		if (!data || select._tm_linked) return;
		select._tm_linked = true;
		const byName = (select.fields_by_name[doctype] = select.fields_by_name[doctype] || {});
		data.links.forEach((link) => {
			(data.doctypes[link.doctype] || []).forEach((df) => {
				const fieldname = `${link.fieldname}.${df.fieldname}`;
				if (byName[fieldname]) return;
				const row = docfield(doctype, fieldname);
				if (!row) return;
				byName[fieldname] = row;
				select.options.push({ label: row.label, value: `${doctype}.${fieldname}`, fieldname, doctype });
			});
		});
	}

	/* A list whose filters may be linked: the theme's bar marks it
	 * (_tm_linked). A filter row reaches it through filter_list, which is
	 * the list for its own filter area and the group itself for the any-of
	 * group (marked with _tm_list). */
	const hostOf = (owner) => (owner?._tm_linked ? owner : owner?._tm_list?._tm_linked ? owner._tm_list : null);

	/* ---- the filter rows ------------------------------------------------ */
	const Filter = ui.Filter;
	const makeSelect = Filter.prototype.make_select;
	Filter.prototype.make_select = function () {
		const out = makeSelect.apply(this, arguments);
		const doctype = this.parent_doctype;
		if (!hostOf(this.filter_list) || !this.fieldselect) return out;
		const select = this.fieldselect;
		if (loaded[doctype]) {
			addOptions(select, doctype);
			/* make_select set the row's field before the linked ones existed */
			if (parse(doctype, this.fieldname)) select.set_value(this.doctype, this.fieldname);
		} else {
			load(doctype).then(() => addOptions(select, doctype));
		}
		return out;
	};

	const FilterGroup = ui.FilterGroup;
	const groupHost = (group) => hostOf(group.base_list || group);

	/* Frappe rejects a field the doctype does not have ("Invalid filter") */
	const validate = FilterGroup.prototype.validate_args;
	FilterGroup.prototype.validate_args = function (doctype, fieldname) {
		if (doctype === this.doctype && groupHost(this) && parse(doctype, fieldname)) return true;
		return validate.apply(this, arguments);
	};

	/* Every restored filter passes here — list settings, the URL, a saved
	 * view, the any-of group: a linked one waits for the fields, or its row
	 * would find nothing to select and drop itself (filter.js set_field). */
	const addFilters = FilterGroup.prototype.add_filters;
	FilterGroup.prototype.add_filters = function (filters) {
		const doctype = this.doctype;
		if (!loaded[doctype] && groupHost(this) && (filters || []).some((f) => isLinked(doctype, f))) {
			const args = arguments;
			return load(doctype).then(() => addFilters.apply(this, args));
		}
		return addFilters.apply(this, arguments);
	};

	/* ---- answering the conditions ---------------------------------------- */
	const keyOf = (p, f) => JSON.stringify([p.target, p.field, f[2], f[3] ?? null]);

	function ask(list, p, f, key) {
		if (asking.has(key)) return asking.get(key);
		const promise = frappe
			.xcall("frappe.desk.reportview.get_list", {
				doctype: p.target,
				fields: ["name"],
				filters: [[p.target, p.field, f[2], f[3]]],
				limit: LIMIT + 1,
			})
			.then((rows) => {
				const names = (rows || []).map((r) => (Array.isArray(r) ? r[0] : r.name));
				if (names.length > LIMIT) {
					frappe.show_alert({
						message: __("{0}: more than {1} matching {2}. The first {1} are used; narrow the condition to see every match.", [
							docfield(list.doctype, f[1]).label, format_number(LIMIT, null, 0), __(p.target)]),
						indicator: "orange",
					}, 10);
				}
				return names.slice(0, LIMIT);
			})
			/* the server said why (frappe.call shows it); nothing matches a condition that cannot be read */
			.catch(() => [])
			.then((names) => {
				answers.set(key, { names, at: Date.now() });
				asking.delete(key);
			});
		asking.set(key, promise);
		return promise;
	}

	/* the conditions the list is about to send, as written (dotted) */
	function conditions(list) {
		list._tm_raw = true;
		let own;
		try {
			own = list.get_filters_for_args();
		} finally {
			list._tm_raw = false;
		}
		return own.concat(list._tm_or || []).filter((f) => isLinked(list.doctype, f));
	}

	/* null when every condition has a fresh answer, so the refresh stays as
	 * synchronous as Frappe's own */
	function pending(list) {
		const now = Date.now();
		const waits = [];
		conditions(list).forEach((f) => {
			const p = parse(list.doctype, f[1]);
			const key = keyOf(p, f);
			const known = answers.get(key);
			if (!known || now - known.at > TTL) waits.push(ask(list, p, f, key));
		});
		return waits.length ? Promise.all(waits) : null;
	}

	/* dotted conditions -> filters the server can run. One not answered yet
	 * is left out rather than sent as a column the server does not have. */
	function translate(list, filters) {
		if (!list?._tm_linked || !Array.isArray(filters)) return filters;
		let changed = false;
		const out = [];
		filters.forEach((f) => {
			if (!isLinked(list.doctype, f)) {
				out.push(f);
				return;
			}
			changed = true;
			const p = parse(list.doctype, f[1]);
			const known = answers.get(keyOf(p, f));
			if (!known) return;
			/* `name in ('')` matches nothing: name is never null, never empty */
			out.push(known.names.length ? [list.doctype, p.link, "in", known.names] : [list.doctype, "name", "in", [""]]);
		});
		return changed ? out : filters;
	}

	const forArgs = BaseList.prototype.get_filters_for_args;
	BaseList.prototype.get_filters_for_args = function () {
		const filters = forArgs.apply(this, arguments);
		return this._tm_raw ? filters : translate(this, filters);
	};

	const refresh = BaseList.prototype.refresh;
	BaseList.prototype.refresh = function () {
		const wait = this._tm_linked ? pending(this) : null;
		if (!wait) return refresh.apply(this, arguments);
		const args = arguments;
		return wait.then(() => refresh.apply(this, args));
	};

	/* ---- the URL ----------------------------------------------------------- */
	const ListView = frappe.views.ListView;
	if (ListView) {
		/* the address bar keeps the condition, not ten thousand names */
		const search = ListView.prototype.get_search_params;
		if (search) {
			ListView.prototype.get_search_params = function () {
				this._tm_raw = true;
				try {
					return search.apply(this, arguments);
				} finally {
					this._tm_raw = false;
				}
			};
		}
		/* and reads it back: list_view.js splits "employee.department" into a
		 * doctype "employee" and a field "department" (a child table's key is
		 * "Sales Invoice Item.item_code") */
		const fromRoute = ListView.prototype.parse_filters_from_route_options;
		if (fromRoute) {
			ListView.prototype.parse_filters_from_route_options = function () {
				const filters = fromRoute.apply(this, arguments);
				if (!this._tm_linked || !Array.isArray(filters)) return filters;
				return filters.map((f) => {
					const fieldname = `${f[0]}.${f[1]}`;
					if (window.locals?.DocType?.[f[0]] || !parse(this.doctype, fieldname)) return f;
					return [this.doctype, fieldname, ...f.slice(2)];
				});
			};
		}
	}

	/* ---- the Calendar's events query ---------------------------------------- */
	const Calendar = frappe.views.Calendar;
	if (Calendar?.prototype.get_args) {
		const calendarArgs = Calendar.prototype.get_args;
		Calendar.prototype.get_args = function () {
			const args = calendarArgs.apply(this, arguments);
			if (args && this.list_view) args.filters = translate(this.list_view, args.filters);
			return args;
		};
	}

	window.themate = window.themate || {};
	window.themate.linkedFilters = {
		SEP,
		load,
		parse,
		docfield,
		translate,
		links: (doctype) => loaded[doctype]?.links || null,
	};
})();

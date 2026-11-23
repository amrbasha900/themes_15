/* Global search: results in named groups, each row with an icon for its type.
 *
 * Frappe's awesomebar builds one flat list sorted by score, so "invoice" gives
 * thirty rows of List / Report / New mixed together. This only rearranges what
 * Frappe already allowed and found: the options, their routes and their click
 * behaviour stay Frappe's, and the best match stays first, so Enter opens the
 * same thing it always did.
 *
 * Group titles are CSS content on the <li>, not rows of their own: Awesomplete
 * maps ul.children to suggestions by index (awesomplete.js goto, select), so an
 * extra child would make the keyboard open the wrong result. */

(function () {
	const __ = (s, args) => (window.__ ? window.__(s, args) : s);

	/* Order on screen, and how many rows each may show. Typing narrows the rest. */
	const GROUPS = [
		["best", 1, () => __("Best match")],
		["recent", 6, () => __("Recent")],
		["frequent", 6, () => __("Frequently visited")],
		["open", 6, () => __("Open")],
		["dashboard", 4, () => __("Dashboards")],
		["report", 4, () => __("Reports")],
		["create", 4, () => __("Create new")],
		["action", 4, () => __("Actions")],
		["help", 1, () => __("Help")],
	];

	const ACTIONS = ["Search", "Current", "Calculator"];

	function groupOf(o, typed) {
		if (o.default === "Help") return "help";
		if (ACTIONS.includes(o.default)) return "action";
		if (o.type === "New") return "create";
		if (o.type === "Report") return "report";
		if (o.type === "Dashboard") return "dashboard";
		if (o.recent) return "recent";
		return !typed && !o.type ? "frequent" : "open";
	}

	/* Returns new row objects carrying _tm_group, _tm_title on the first of each group. */
	function arrange(options, typed) {
		typed = (typed || "").trim();
		/* Tag results are their own list, with their own meaning. */
		if (typed.startsWith("#")) return options;

		/* get_item() finds a row by its value, so two rows sharing one always act as
		 * the first. The same page often arrives as both recent and frequent. */
		const seen = new Set();
		const sorted = options
			.filter((o) => !(typed && o.default === "Help"))
			.map((o, i) => ({ o, i }))
			.sort((a, b) => (b.o.index || 0) - (a.o.index || 0) || a.i - b.i)
			.map(({ o }) => o)
			.filter((o) => !seen.has(o.value) && seen.add(o.value));

		/* "Search for x" is an action, not a match. When it scores highest the
		 * actions go first instead, so Enter still does what it always did. */
		const actionFirst = sorted.length && groupOf(sorted[0], typed) === "action";
		const buckets = {};
		sorted.forEach((o, i) => {
			const key = typed && i === 0 && !actionFirst ? "best" : groupOf(o, typed);
			(buckets[key] = buckets[key] || []).push(o);
		});

		const order = actionFirst ? [...GROUPS].sort((a, b) => (b[0] === "action") - (a[0] === "action")) : GROUPS;
		const out = [];
		order.forEach(([key, cap, title]) => {
			(buckets[key] || []).slice(0, cap).forEach((o, i) => {
				out.push(Object.assign({}, o, { _tm_group: key, _tm_title: i === 0 ? title() : "" }));
			});
		});
		return out;
	}

	function iconFor(d) {
		if (d.default === "Help") return "help";
		if (d.default === "Search") return "search";
		if (d.default === "Current") return "filter";
		if (d.default === "Calculator") return "hash";
		if (d.recent) return "clock";
		return { New: "add", Report: "report", Page: "file", Workspace: "home", Calendar: "calendar", Dashboard: "dashboard" }[d.type] || "list";
	}

	function enhance() {
		const input = document.getElementById("navbar-search");
		const aw = input?.awesomplete;
		if (!aw || aw._tm_search || window.themate?.enabled?.() === false) return;
		aw._tm_search = true;

		const setList = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(aw), "list").set;
		Object.defineProperty(aw, "list", {
			configurable: true,
			set(list) {
				setList.call(this, Array.isArray(list) ? arrange(list, input.value) : list);
			},
		});
		aw.sort = false; /* arrange() has already ordered them */

		const item = aw.item;
		aw.item = function (text, value, index) {
			const li = item.call(this, text, value, index);
			const d = this.get_item(text.value);
			const a = li.querySelector("a");
			if (!a || !d?._tm_group) return li;
			const body = document.createElement("span");
			body.className = "tm-sr-text";
			body.append(...a.childNodes);
			const glyph = document.createElement("span");
			glyph.className = "tm-sr-icon";
			glyph.innerHTML = window.frappe.utils.icon(iconFor(d), "sm");
			a.append(glyph, body);
			if (d._tm_title) li.dataset.tmGroup = d._tm_title;
			return li;
		};

		aw.ul.dataset.tmHint = __("↑↓ to move, Enter to open, Esc to close");
		/* Awesomplete scrolls by offset alone, which leaves the row under the hints. */
		input.addEventListener("awesomplete-highlight", () => {
			aw.ul.children[aw.index]?.scrollIntoView({ block: "nearest" });
		});
	}

	/* Dashboards. Frappe's source (search_utils.get_dashboards) reads
	 * boot.dashboards, which is every Dashboard on the site whoever asks. It is
	 * emptied at load and refilled, on the search box's first focus, with the
	 * ones this user may open (themate.api.get_searchable_dashboards). The
	 * source itself also matches the translated name, so "الأفراد" finds People. */
	function dashboards() {
		const frappe = window.frappe;
		const utils = frappe?.search?.utils;
		if (!utils || utils._tm_dashboards || window.themate?.enabled?.() === false) return;
		utils._tm_dashboards = true;
		frappe.boot.dashboards = [];
		let asked = false;
		document.addEventListener("focusin", (e) => {
			if (asked || e.target?.id !== "navbar-search") return;
			asked = true;
			frappe.xcall("themate.api.get_searchable_dashboards").then((rows) => { frappe.boot.dashboards = rows || []; }).catch(() => { asked = false; });
		});
		utils.get_dashboards = function (keywords) {
			return (frappe.boot.dashboards || []).map((item) => {
				const own = this.fuzzy_search(keywords, item.name, true);
				const local = __(item.name) !== item.name ? this.fuzzy_search(keywords, __(item.name), true) : { score: 0 };
				const hit = local.score > own.score ? local : own;
				if (!(hit.score > 0)) return null;
				return {
					type: "Dashboard",
					label: __("{0} Dashboard", [hit === local ? hit.marked_string : own.marked_string || __(item.name)]),
					value: __("{0} Dashboard", [__(item.name)]),
					index: hit.score,
					route: ["dashboard-view", item.name],
				};
			}).filter(Boolean);
		};
	}

	window.themate = window.themate || {};
	window.themate.arrangeSearch = arrange;

	if (window.jQuery) {
		window.jQuery(document).on("toolbar_setup", enhance);
		window.jQuery(enhance);
		window.jQuery(dashboards);
	}
})();

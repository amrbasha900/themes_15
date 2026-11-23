/* List filters, one bar: search, a Filter button with its count, a chip per
 * applied filter, Clear all — then the sort control (moved in as Frappe
 * makes it, after the bar). Above it, saved views as tabs. The builder is
 * Frappe's own filter popover restyled into "Where / And" rows, plus an
 * "any of the following" group that becomes the query's or_filters.
 *
 * Every view that extends frappe.views.BaseList (List, Report, Kanban,
 * Gantt, Calendar, Image, Map) builds the same FilterArea, so one
 * decoration covers them all. The engine stays Frappe's: the standard
 * filter controls keep living in .standard-filter-section (hidden — route
 * options and saved filters still set them), frappe.ui.FilterGroup keeps
 * the rows, List Filter records keep the saved views. This file only moves
 * the pieces into the bar and reads them back as chips.
 *
 * The or-group is the one thing Frappe's list views cannot express, and
 * the API can (frappe.desk.reportview.get/get_count take or_filters), so
 * get_args() and frappe.db.count() are wrapped to carry it; the group is
 * remembered per doctype in the desk state (lists.<doctype>.or).
 *
 * Both the builder's rows and the group also offer the fields of the
 * documents a list links to ("Employee › Department" on Leave Application),
 * answered before the query by linked_filters.js; "Linked documents" in the
 * builder opens a row on one of them. */
(function () {
	const frappe = window.frappe;
	const $ = window.jQuery;
	if (!frappe || !$ || !frappe.views?.BaseList) return;
	const BaseList = frappe.views.BaseList;
	if (BaseList.prototype._tm_filters) return;
	BaseList.prototype._tm_filters = true;

	const enabled = () => window.themate?.enabled?.() !== false;
	const esc = (s) => frappe.utils.escape_html(String(s ?? ""));
	const icon = (n, s = "xs") => frappe.utils.icon(n, s);
	const ds = () => window.themate?.deskState;
	const linked = () => window.themate?.linkedFilters;
	/* the any-of group as the server can run it (linked conditions answered) */
	const orFilters = (list) => linked()?.translate(list, list._tm_or) || list._tm_or;
	const CONDITIONS = {
		"=": __("is"), "!=": __("is not"), like: __("contains"), "not like": __("does not contain"), in: __("is any of"),
		"not in": __("is none of"), ">": ">", "<": "<", ">=": "≥", "<=": "≤", Between: __("between"), Timespan: "",
		is: "", "descendants of": __("within"), "descendants of (inclusive)": __("within"), "not descendants of": __("not within"),
		"ancestors of": __("above"), "not ancestors of": __("not above"),
	};

	/* ---- hooks -------------------------------------------------------- */
	const origSetup = BaseList.prototype.setup_filter_area;
	BaseList.prototype.setup_filter_area = function () {
		/* before the filter area exists: it restores the saved filters at once */
		if (enabled() && linked()) this._tm_linked = true;
		const out = origSetup.apply(this, arguments);
		if (enabled() && this.filter_area?.filter_list) {
			try {
				new Bar(this);
			} catch (e) {
				console.error("themate: list filters", e);
			}
		}
		return out;
	};
	const origArgs = BaseList.prototype.get_args;
	BaseList.prototype.get_args = function () {
		const args = origArgs.apply(this, arguments);
		if (this._tm_or?.length) args.or_filters = orFilters(this);
		return args;
	};
	const origRefresh = BaseList.prototype.refresh;
	BaseList.prototype.refresh = function () {
		const out = origRefresh.apply(this, arguments);
		this._tm_bar?.render();
		return out;
	};
	/* the count under the list is fetched by frappe.db.count, which has no
	 * or_filters argument; the server side does (get_form_params) */
	const origCount = frappe.db.count;
	frappe.db.count = function (doctype, args = {}) {
		const list = window.cur_list;
		if (list?.doctype === doctype && list._tm_or?.length) {
			return frappe.xcall("frappe.desk.reportview.get_count", {
				doctype, filters: args.filters || [], or_filters: orFilters(list), fields: [], distinct: false, limit: args.limit,
			});
		}
		return origCount.call(this, doctype, args);
	};

	/* A row appends itself to every ".filter-edit-area" under its parent
	 * (filter.js make(): appendTo on a multi-element set clones). With the
	 * or-group's own edit area inside the popover, each main row would also
	 * land in the group — so a row goes to the first edit area under its
	 * parent: the main one for the popover, the group's own for the group. */
	const Filter = frappe.ui.Filter;
	if (Filter && !Filter.prototype._tm_first_area) {
		Filter.prototype._tm_first_area = true;
		const origMake = Filter.prototype.make;
		Filter.prototype.make = function () {
			const parent = this.parent;
			if (parent?.find) {
				this.parent = { find: (sel) => (sel === ".filter-edit-area" ? parent.find(sel).first() : parent.find(sel)) };
				try {
					return origMake.apply(this, arguments);
				} finally {
					this.parent = parent;
				}
			}
			return origMake.apply(this, arguments);
		};
	}

	/* The sort control joins the bar. base_list.js:309 runs
	 * setup_filter_area and THEN setup_sort_selector, so when the bar is
	 * built there is no .sort-selector yet: Frappe then appended it to
	 * .filter-section — which the bar hides — and "Sort by" disappeared from
	 * every list. The selector is moved as it is made, whoever makes it (the
	 * List, the Report view's own setup_sort_selector at report_view.js:116
	 * — whose "Add Group" button is inserted before .sort-selector, so it
	 * follows it into the bar). */
	const SortSelector = frappe.ui.SortSelector;
	if (SortSelector && !SortSelector.prototype._tm_bar) {
		SortSelector.prototype._tm_bar = true;
		const origSortMake = SortSelector.prototype.make;
		SortSelector.prototype.make = function () {
			const out = origSortMake.apply(this, arguments);
			try {
				const $bar = enabled() ? this.parent?.closest?.(".page-form")?.children(".tm-fbar") : null;
				if ($bar?.length && this.wrapper) {
					$bar.children(".sort-selector").not(this.wrapper).remove();
					this.wrapper.addClass("tm-fsort").appendTo($bar);
					this.wrapper.find(".sort-selector-button").prepend(`<span class="tm-fsort-prefix">${__("Sort by")}</span>`);
				}
			} catch (e) {
				console.error("themate: sort selector", e);
			}
			return out;
		};
	}

	/* ---- the bar ------------------------------------------------------ */
	class Bar {
		constructor(list) {
			this.list = list;
			list._tm_bar = this;
			this.doctype = list.doctype;
			this.fa = list.filter_area;
			this.fl = this.fa.filter_list;
			this.meta = frappe.get_meta(this.doctype);
			list._tm_or = (ds()?.get("lists", this.doctype) || {}).or || [];
			this.build();
			this.bindBuilder();
			this.tabs = new Tabs(this);
		}

		build() {
			const $form = this.list.page.page_form;
			const std = this.fa.standard_filters_wrapper;
			this.$bar = $(`<div class="tm-fbar" role="group" aria-label="${__("Filters")}"></div>`);
			/* search: the ID / title standard filter, moved into the bar */
			const dict = this.list.page.fields_dict || {};
			this.searchField = dict.name || dict[this.meta.title_field] || Object.values(dict).find((f) => f.df.fieldtype === "Data");
			if (this.searchField) {
				const $w = this.searchField.$wrapper.addClass("tm-fsearch");
				this.searchField.$input?.attr("placeholder", __("Search {0}…", [__(this.searchField.df.label || "ID")]));
				$w.prepend(`<span class="tm-fsearch-icon">${icon("search", "sm")}</span>`);
				this.$bar.append($w);
			}
			/* Frappe's Filter button keeps its popover, re-pointed before its first
			 * show: Frappe centres it and shifts it 100px left, which puts a 680px
			 * builder off the page next to a sidebar. The instance is mutated, not
			 * re-made — popover("dispose") would also strip Frappe's own
			 * shown/hidden handlers (jQuery .off(".bs.popover") takes every
			 * handler in the namespace), and with them the wrapper every row is
			 * appended to. Bootstrap's placement list has no -start; Popper's
			 * start is the physical left, so the end edge is the one in RTL. */
			const inst = this.fa.filter_button.data("bs.popover");
			if (inst) {
				inst.config.placement = "bottom";
				inst.config.offset = "0, 6";
				/* popperConfig replaces Bootstrap's modifiers wholesale, so all four
				 * are named: no flip (a builder that opens upwards grows off the
				 * top of the page once it has a few rows), kept inside the viewport */
				inst.config.popperConfig = {
					placement: frappe.utils.is_rtl() ? "bottom-end" : "bottom-start",
					modifiers: { offset: { offset: "0, 6" }, flip: { enabled: false }, arrow: { element: ".arrow" }, preventOverflow: { boundariesElement: "viewport", padding: 8 } },
				};
			}
			this.inst = inst;
			this.fa.filter_x_button?.hide();
			this.$bar.append($form.find(".filter-selector").addClass("tm-fselector"));
			this.$chips = $(`<div class="tm-fchips"></div>`).appendTo(this.$bar);
			this.$clear = $(`<button type="button" class="btn-reset tm-fclear" hidden>${__("Clear all")}</button>`).appendTo(this.$bar);
			this.$clear.on("click", () => {
				this.setOr([]);
				this.fa.clear();
			});
			/* normally not made yet — SortSelector.make above moves it in */
			this.$bar.append($form.find(".group-by-selector"), $form.find(".sort-selector").addClass("tm-fsort"));
			std?.addClass("tm-fstd");
			$form.find(".filter-section").addClass("tm-fsection-old");
			$form.prepend(this.$bar);
			$form.addClass("tm-fform");
			/* chips follow the engine: Frappe repaints its button after every change */
			const fl = this.fl, origUpdate = fl.update_filter_button.bind(fl);
			fl.update_filter_button = () => {
				origUpdate();
				this.render();
			};
			this.render();
		}

		/* [dt, field, cond, value] -> "Label" + "cond value" */
		chipText(f, filterObj) {
			const [, fieldname, cond, value] = f;
			const df = this.meta.fields.find((d) => d.fieldname === fieldname) || frappe.model.std_fields.find((d) => d.fieldname === fieldname)
				|| linked()?.docfield(this.doctype, fieldname) || { label: fieldname, fieldtype: "Data" };
			let shown = value;
			const person = ["owner", "modified_by", "_assign", "_liked_by"].includes(fieldname);
			if (person && typeof value === "string") shown = esc(frappe.user.full_name(value.replace(/%/g, "")));
			else if (df.fieldtype === "Check" || filterObj?.field?.df.original_type === "Check") shown = cint(value) ? __("Yes") : __("No");
			else if (filterObj?.field) shown = filterObj.utils.get_formatted_value(filterObj.field, filterObj.get_selected_label() || value);
			else if (Array.isArray(value)) shown = value.map((v) => frappe.format(v, df, { only_value: 1 })).join(", ");
			else if (cond === "Timespan") shown = __(frappe.utils.to_title_case(String(value)));
			else if (typeof value === "string" && cond === "like") shown = value.replace(/^%|%$/g, "");
			else if (cond === "is") shown = __(value === "set" ? "is set" : "is not set");
			else shown = frappe.format(value, df, { only_value: 1 });
			const label = fieldname === "_assign" ? __("Assigned To") : fieldname === "owner" ? __("Created By") : fieldname === "_user_tags" ? __("Tag") : fieldname === "_liked_by" ? __("Liked By") : __(df.label || fieldname);
			/* "Disabled: No" reads as a sentence; "Disabled is No" reads as a query. */
			if (cond === "=") return `<span>${esc(label)}:</span><b>${shown}</b>`;
			return `<span>${esc(label)}</span><b>${esc(CONDITIONS[cond] ?? cond)} ${shown}</b>`;
		}

		render() {
			if (!this.$chips) return;
			const chips = [];
			const searchName = this.searchField?.df.fieldname;
			/* standard controls with a value (the search box is visible already) */
			this.fa.get_standard_filters().forEach((f) => {
				if (f[1] === searchName) return;
				chips.push(`<button type="button" class="tm-fchip" data-std="${esc(f[1])}" title="${__("Remove")}">${this.chipText(f)}<i>${icon("close")}</i></button>`);
			});
			(this.fl.filters || []).forEach((filter, i) => {
				if (!filter.field || filter.hidden) return;
				const f = filter.get_value();
				if (f[3] === undefined || f[3] === null || f[3] === "") return;
				chips.push(`<button type="button" class="tm-fchip" data-i="${i}" title="${__("Edit")}">${this.chipText(f, filter)}<i data-remove title="${__("Remove")}">${icon("close")}</i></button>`);
			});
			if (this.list._tm_or?.length) {
				const parts = this.list._tm_or.map((f) => `<em>${this.chipText(f)}</em>`).join(`<u>${__("or")}</u>`);
				chips.push(`<button type="button" class="tm-fchip is-or" data-or="1" title="${__("Edit")}"><span>${__("Any of")}</span>${parts}<i data-remove title="${__("Remove")}">${icon("close")}</i></button>`);
			}
			this.$chips.html(chips.join(""));
			this.$clear.prop("hidden", !chips.length && !this.searchField?.get_value());
			/* the button counts every chip, not only the builder's rows */
			const n = chips.length;
			this.fa.filter_button.toggleClass("btn-primary-light", n > 0).toggleClass("btn-default", n === 0)
				.find(".button-label").html(n ? `${__("Filter")} <span class="filter-label">${n}</span>` : __("Filter"));
			this.$chips.find(".tm-fchip").on("click", (e) => {
				const chip = e.currentTarget, remove = e.target.closest("[data-remove]");
				if (chip.dataset.std) {
					this.list.page.fields_dict[chip.dataset.std]?.set_value("");
				} else if (chip.dataset.or) {
					if (remove) this.setOr([]); else this.open();
				} else if (remove) {
					const f = this.fl.filters[Number(chip.dataset.i)];
					f?.remove();
					this.fl.apply();
				} else {
					this.open();
				}
			});
			this.tabs?.mark();
		}

		open() {
			this.fa.filter_button.popover("show");
		}

		/* ---- the builder: Frappe's popover, decorated once it exists ---- */
		bindBuilder() {
			this.fa.filter_button.on("shown.bs.popover", () => {
				const $pop = $(".filter-popover").addClass("tm-fpop");
				const $area = $pop.find(".filter-area");
				/* never taller than what is left under the button: the rows scroll */
				const below = window.innerHeight - this.fa.filter_button[0].getBoundingClientRect().bottom - 16;
				$pop.css("max-height", `${Math.max(240, below)}px`);
				if (!$area.length || $area.data("tmDecorated")) {
					this.syncOr();
					return;
				}
				$area.data("tmDecorated", 1);
				$area.children(".filter-action-buttons").find(".add-filter").html(`${icon("add")}<span>${__("Add condition")}</span>`);
				/* "Where" on the first row, "And" on the rest, as rows come and go */
				const edit = $area.find(".filter-edit-area")[0];
				const label = () => edit.querySelectorAll(":scope > .filter-box").forEach((box, i) => { box.dataset.tmJoin = i ? __("And") : __("Where"); });
				new MutationObserver(label).observe(edit, { childList: true });
				label();
				/* a row added or removed moves the popover's edges: re-place it */
				new MutationObserver(() => this.inst?._popper?.scheduleUpdate()).observe($area[0], { childList: true, subtree: true });
				/* the or-group */
				/* order: the And rows, their buttons, then the group, then Clear / Apply */
				const $actions = $area.children(".filter-action-buttons");
				const $footer = $(`<div class="tm-ffoot"></div>`).insertAfter($actions);
				$footer.append($actions.children("div"));
				this.$or = $(`<div class="tm-for" hidden>
					<div class="tm-for-title"><em>${__("And")}</em><span>${__("any of the following are true")}</span><button type="button" class="btn-reset tm-for-x" title="${__("Remove group")}">${icon("close")}</button></div>
					<div class="tm-for-body"></div>
				</div>`).insertAfter($actions);
				this.orGroup = new frappe.ui.FilterGroup({
					parent: this.$or.find(".tm-for-body"), doctype: this.doctype, parent_doctype: this.doctype, _tm_list: this.list,
					on_change: () => this.setOr(this.orGroup.get_filters().map((f) => f.slice(0, 4)).filter((f) => f[3] !== undefined && f[3] !== null && f[3] !== ""), true),
				});
				this.orGroup.update_filter_button = () => {}; /* an inline group has no button to repaint */
				this.$or.find(".tm-for-body .add-filter").html(`${icon("add")}<span>${__("Add condition")}</span>`);
				this.$or.find(".tm-for-body .clear-filters").remove();
				this.$or.find(".tm-for-x").on("click", () => {
					this.setOr([]);
					this.$or.prop("hidden", true);
				});
				const $addGroup = $(`<button type="button" class="btn-reset tm-for-add">${icon("add")}<span>${__("Add an “any of” group")}</span></button>`);
				$actions.append($addGroup);
				$addGroup.on("click", () => {
					this.$or.prop("hidden", false);
					$addGroup.prop("hidden", true);
					if (!this.orGroup.filters.length) this.orGroup.add_filter(this.doctype, "name");
				});
				this.$addGroup = $addGroup;
				/* quick picks: the standard filters, one click each */
				const picks = [];
				const seen = new Set([this.searchField?.df.fieldname]);
				Object.values(this.list.page.fields_dict || {}).forEach((f) => {
					if (!seen.has(f.df.fieldname)) { seen.add(f.df.fieldname); picks.push([f.df.fieldname, f.df.label]); }
				});
				this.meta.fields.forEach((df) => {
					if (df.in_standard_filter && !seen.has(df.fieldname) && frappe.model.is_value_type(df.fieldtype)) { seen.add(df.fieldname); picks.push([df.fieldname, df.label]); }
				});
				if (picks.length) {
					const $q = $(`<div class="tm-fquick"><span>${__("Quick picks")}</span>${picks.map(([f, l]) => `<button type="button" class="btn-reset" data-field="${esc(f)}">${esc(__(l))}</button>`).join("")}</div>`).appendTo($area);
					$q.on("click", "button", (e) => {
						$pop.find(".empty-filters").hide();
						this.fl.add_filter(this.doctype, e.currentTarget.dataset.field);
					});
				}
				this.linkedPicks($area, $pop);
				$pop.on("keydown", (e) => { if (e.key === "Escape") this.fl.hide_popover(); });
				/* the field and value pickers are Awesomplete lists, positioned
				 * inside the row — and the popover body scrolls, so it clipped
				 * them. On open the list is pinned to the viewport under its
				 * input; a scroll of the body closes it (the input moved). */
				const pin = (input) => {
					const list = input.closest(".awesomplete")?.querySelector("ul");
					if (!list) return;
					const r = input.getBoundingClientRect();
					/* Popper places the popover with a transform, which makes
					 * "fixed" relative to the popover: coordinates are taken from it */
					const p = $pop[0].getBoundingClientRect();
					const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
					const up = below < 180 && above > below;
					const h = Math.min(320, Math.max(120, up ? above : below));
					Object.assign(list.style, { position: "fixed", left: `${r.left - p.left}px`, width: `${Math.max(r.width, 260)}px`, minWidth: "0", overflowY: "auto", zIndex: 1080, bottom: "" });
					list.style.top = `${(up ? Math.max(8, r.top - 2 - h) : r.bottom + 2) - p.top}px`;
					list.style.setProperty("max-height", `${h}px`, "important");
				};
				$pop[0].addEventListener("awesomplete-open", (e) => pin(e.target), true);
				$pop.find(".popover-body").on("scroll", () => $pop.find(".awesomplete > ul:not([hidden])").attr("hidden", ""));
				this.syncOr();
			});
		}

		/* "Linked documents": one button per link field (Employee, Leave Type…).
		 * A click opens a row — the blank one Frappe adds, else a new one — with
		 * its field picker narrowed to that document's fields; typing narrows
		 * further. The same fields are in every row's picker, found by name. */
		linkedPicks($area, $pop) {
			const api = linked();
			if (!api || !this.list._tm_linked) return;
			api.load(this.doctype).then(() => {
				const links = (api.links(this.doctype) || []).slice();
				if (!links.length || $area.children(".tm-flinked").length) return;
				/* required links first (Employee on a leave), then the list's own filters and columns */
				const rank = (l) => {
					const df = this.meta.fields.find((d) => d.fieldname === l.fieldname) || {};
					return df.reqd ? 0 : df.in_standard_filter ? 1 : df.in_list_view ? 2 : 3;
				};
				links.sort((a, b) => rank(a) - rank(b));
				const SHOWN = 6;
				const button = (l, i) => `<button type="button" class="btn-reset" data-link="${esc(l.fieldname)}"${i >= SHOWN ? " hidden" : ""} title="${esc(__(l.doctype))}">${esc(__(l.label || l.fieldname, null, this.doctype))}</button>`;
				const more = links.length > SHOWN ? `<button type="button" class="btn-reset tm-flinked-more">${__("+{0} more", [links.length - SHOWN])}</button>` : "";
				const $l = $(`<div class="tm-flinked"><span>${__("Linked documents")}</span>${links.map(button).join("")}${more}</div>`);
				const $quick = $area.children(".tm-fquick");
				if ($quick.length) $l.insertAfter($quick); else $l.appendTo($area);
				/* hidden, not removed: the click still bubbles to Frappe's body
				 * handler (filter_list.js set_popover_events), which closes the
				 * popover for any target with no .filter-popover ancestor — and a
				 * detached button has none */
				$l.on("click", ".tm-flinked-more", (e) => {
					$l.find("[data-link]").prop("hidden", false);
					e.currentTarget.hidden = true;
				});
				$l.on("click", "[data-link]", (e) => {
					const link = links.find((l) => l.fieldname === e.currentTarget.dataset.link);
					$pop.find(".empty-filters").hide();
					const blank = () => this.fl.filters.find((f) => f.field && f.fieldselect?.selected_fieldname === "name" && !f.get_selected_value());
					Promise.resolve(blank() || this.fl.add_filter(this.doctype, "name")).then(() => {
						const select = (blank() || this.fl.filters[this.fl.filters.length - 1])?.fieldselect;
						if (!select || !link) return;
						select.$input.val(`${__(link.label || link.fieldname, null, this.doctype)}${api.SEP}`).trigger("focus");
						select.awesomplete.evaluate();
						/* left without a pick: the row shows its field again */
						select.$input.one("blur", () => setTimeout(() => select.set_value(select.selected_doctype, select.selected_fieldname), 250));
					});
				});
			});
		}

		/* the group's rows follow the remembered or-filters */
		syncOr() {
			if (!this.orGroup) return;
			const or = this.list._tm_or || [];
			this.$or.prop("hidden", !or.length);
			this.$addGroup?.prop("hidden", !!or.length);
			const shown = this.orGroup.get_filters().map((f) => f.slice(0, 4));
			if (JSON.stringify(shown) === JSON.stringify(or)) return;
			this.orGroup.clear_filters();
			if (or.length) this.orGroup.add_filters(or);
		}

		setOr(or, fromGroup) {
			const same = JSON.stringify(or) === JSON.stringify(this.list._tm_or || []);
			this.list._tm_or = or;
			ds()?.set("lists", this.doctype, { or: or.length ? or : null });
			if (!fromGroup) this.syncOr();
			if (!same) this.list.refresh();
			this.render();
		}
	}

	/* ---- saved views as tabs ----------------------------------------- */
	class Tabs {
		constructor(bar) {
			this.bar = bar;
			this.list = bar.list;
			this.doctype = bar.doctype;
			this.$el = $(`<div class="tm-vtabs" role="tablist"></div>`).insertBefore(bar.$bar);
			this.$el.on("click", "[data-view]", (e) => this.pick(e.currentTarget.dataset.view));
			this.$el.on("click", ".tm-vtab-x", (e) => { e.stopPropagation(); this.remove(e.currentTarget.closest("[data-view]").dataset.view); });
			this.$el.on("click", ".tm-vtab-add", () => this.save());
			this.load();
		}

		load() {
			return frappe.db.get_list("List Filter", {
				fields: ["name", "filter_name", "for_user", "filters"],
				filters: { reference_doctype: this.doctype, for_user: ["in", [frappe.session.user, ""]] },
				order_by: "filter_name asc", limit: 50,
			}).then((rows) => {
				this.views = rows || [];
				this.draw();
			});
		}

		draw() {
			const tabs = [`<button type="button" class="tm-vtab" data-view="" role="tab">${__("All")}</button>`];
			this.views.forEach((v) => {
				tabs.push(`<button type="button" class="tm-vtab" data-view="${esc(v.name)}" role="tab" title="${v.for_user ? __("Only you") : __("Everyone")}">${esc(v.filter_name)}${v.for_user ? "" : `<span class="tm-vtab-shared">${icon("users")}</span>`}<span class="tm-vtab-x" title="${__("Delete view")}">${icon("close")}</span></button>`);
			});
			tabs.push(`<button type="button" class="tm-vtab tm-vtab-add">${icon("add")}<span>${__("Save view")}</span></button>`);
			this.$el.html(tabs.join(""));
			this.mark();
		}

		key(filters) {
			return JSON.stringify((filters || []).map((f) => f.slice(0, 4)).sort());
		}

		mark() {
			if (!this.views) return;
			const now = this.key(this.bar.fa.get());
			let active = "";
			this.views.forEach((v) => { if (this.key(JSON.parse(v.filters || "[]")) === now) active = v.name; });
			if (!active && now !== "[]") active = null; /* custom: no tab lit */
			this.$el.find(".tm-vtab[data-view]").each((_, el) => el.classList.toggle("is-active", active !== null && el.dataset.view === active));
		}

		pick(name) {
			const v = this.views.find((x) => x.name === name);
			this.bar.setOr([]);
			return this.bar.fa.clear(false).then(() => {
				if (!v) return this.list.refresh();
				return this.bar.fa.add(JSON.parse(v.filters || "[]"));
			});
		}

		save() {
			const filters = this.bar.fa.get();
			if (!filters.length) {
				frappe.show_alert({ message: __("Set a filter first, then save it as a view."), indicator: "orange" });
				return;
			}
			frappe.prompt([
				{ fieldname: "filter_name", fieldtype: "Data", label: __("View name"), reqd: 1 },
				{ fieldname: "is_global", fieldtype: "Check", label: __("Share with everyone"), depends_on: `eval:${frappe.user.has_role("System Manager") ? 1 : 0}` },
			], (v) => {
				if (this.views.some((x) => x.filter_name === v.filter_name)) {
					frappe.show_alert({ message: __("A view with this name exists."), indicator: "orange" });
					return;
				}
				frappe.db.insert({
					doctype: "List Filter", reference_doctype: this.doctype, filter_name: v.filter_name,
					for_user: v.is_global ? "" : frappe.session.user, filters: JSON.stringify(filters),
				}).then(() => this.load());
			}, __("Save view"), __("Save"));
		}

		remove(name) {
			const v = this.views.find((x) => x.name === name);
			if (!v) return;
			frappe.confirm(__("Delete the view {0}?", [`<b>${esc(v.filter_name)}</b>`]), () => {
				frappe.db.delete_doc("List Filter", name).then(() => this.load());
			});
		}
	}
})();

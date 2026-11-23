/* List page: the Explore panel + the record count beside the title.
 *
 * Frappe's list sidebar is a column of dropdowns (Assigned To, Created By,
 * Edit Filters, Tags) and a Save Filter box. The panel keeps Frappe's
 * controllers (ListGroupBy for the counts and the field picker, the
 * sidebar's stats call for tags) and draws them as something a person
 * reads at a glance: Mine shortcuts, facets with a count and a share bar,
 * a time row on the doctype's main date, tags, and a total. Every click is
 * one filter through list.filter_area, so the bar's chips and the tabs
 * follow. Saved views moved to tabs above the list (list_filters.js), so
 * the Save Filter box is hidden.
 *
 * The panel folds to a rail; the choice is the user's (desk state lists._panel). */
(function () {
	const frappe = window.frappe;
	const $ = window.jQuery;
	if (!frappe || !$) return;

	const enabled = () => window.themate?.enabled?.() !== false;
	const esc = (s) => frappe.utils.escape_html(String(s ?? ""));
	const icon = (n, s = "xs") => frappe.utils.icon(n, s);
	const ds = () => window.themate?.deskState; /* the fold lives with the list state (lists._panel) */
	const SPANS = [["today", __("Today")], ["this week", __("This week")], ["this month", __("This month")], ["this quarter", __("This quarter")], ["this year", __("This year")]];
	const LABELS = { assigned_to: __("Assigned To"), owner: __("Created By") };

	class Panel {
		constructor(sidebar, list) {
			this.sidebar = sidebar;
			this.list = list;
			this.doctype = list.doctype;
			this.meta = frappe.get_meta(this.doctype);
			this.fa = list.filter_area;
			this.groupBy = list.list_sidebar?.list_group_by;
			this.dateField = this.meta.fields.find((df) => ["Date", "Datetime"].includes(df.fieldtype) && (df.in_standard_filter || df.in_list_view || df.reqd))?.fieldname || "creation";
			this.moneyField = this.meta.fields.find((df) => df.fieldtype === "Currency" && df.in_list_view && !df.hidden);
			this.build();
			list._tm_panel = this;
			this.update();
		}

		build() {
			const collapsed = !!(ds()?.get("lists", "_panel") || {}).rail;
			this.$el = $(`<div class="tm-explore">
				<div class="tm-explore-head"><span>${__("Explore")}</span><button type="button" class="btn-reset tm-explore-fold" title="${__("Collapse")}">${icon("es-line-left-chevron")}</button></div>
				<div class="tm-explore-body">
					<section class="tm-x-mine"><h4>${__("Mine")}</h4><div class="tm-x-chips">
						<button type="button" data-f="_assign" data-c="like" data-v="%${esc(frappe.session.user)}%">${__("Assigned to me")}</button>
						<button type="button" data-f="owner" data-c="=" data-v="${esc(frappe.session.user)}">${__("Created by me")}</button>
						<button type="button" data-f="_liked_by" data-c="like" data-v="%${esc(frappe.session.user)}%">${__("Liked")}</button>
					</div></section>
					<div class="tm-x-facets"></div>
					<button type="button" class="btn-reset tm-x-add">${icon("add")}<span>${__("Add group")}</span></button>
					<section class="tm-x-time"><h4>${__("Time")} · ${esc(__(this.dateLabel()))}</h4><div class="tm-x-chips">${SPANS.map(([v, l]) => `<button type="button" data-f="${esc(this.dateField)}" data-c="Timespan" data-v="${esc(v)}">${l}</button>`).join("")}</div></section>
					<section class="tm-x-tags" hidden><h4>${__("Tags")}</h4><div class="tm-x-chips"></div></section>
					<div class="tm-x-total" hidden></div>
				</div>
			</div>`);
			this.sidebar.classList.add("tm-explore-host");
			this.sidebar.prepend(this.$el[0]);
			this.$el.toggleClass("is-rail", collapsed);
			this.$el.find(".tm-explore-fold").on("click", () => {
				const rail = this.$el.toggleClass("is-rail").hasClass("is-rail");
				ds()?.set("lists", "_panel", { rail: rail ? 1 : 0 });
				if (!rail) this.update();
			});
			this.$el.on("click", ".tm-x-chips button[data-f]", (e) => this.toggle(e.currentTarget.dataset));
			this.$el.on("click", ".tm-x-facet button[data-v]", (e) => {
				const b = e.currentTarget, f = b.closest(".tm-x-facet").dataset.field;
				if (b.classList.contains("is-on")) this.fa.remove(f === "assigned_to" ? "_assign" : f);
				else this.groupBy?.apply_filter(f === "assigned_to" ? "_assign" : f, b.dataset.v);
			});
			this.$el.on("click", ".tm-x-more", (e) => {
				$(e.currentTarget).closest(".tm-x-facet").addClass("is-all");
				e.currentTarget.remove();
			});
			this.$el.find(".tm-x-add").on("click", () => this.sidebar.querySelector(".add-list-group-by a")?.click());
			/* the field picker's Save re-renders Frappe's dropdowns: follow it */
			if (this.groupBy && !this.groupBy._tm_hooked) {
				this.groupBy._tm_hooked = true;
				const orig = this.groupBy.render_group_by_items.bind(this.groupBy);
				this.groupBy.render_group_by_items = () => {
					orig();
					this.update();
				};
			}
			this.$el.on("click", ".tm-x-pick", (e) => this.pick(e.currentTarget.closest(".tm-x-facet")));
		}

		/* a Link control under the facet: any value the field allows, not only
		 * the ones with a count (Assigned To / Created By: any user) */
		pick($f) {
			const field = $f.dataset.field;
			if ($f.querySelector(".tm-x-picker")) return $f.querySelector(".tm-x-picker input")?.focus();
			const df = field === "assigned_to" || field === "owner" ? { fieldtype: "Link", options: "User" } : this.meta.fields.find((d) => d.fieldname === field);
			if (!df) return;
			const holder = document.createElement("div");
			holder.className = "tm-x-picker";
			$f.appendChild(holder);
			const control = frappe.ui.form.make_control({
				parent: holder, render_input: true, only_input: true,
				df: {
					fieldtype: df.fieldtype === "Select" ? "Select" : "Link", fieldname: field, options: df.options, placeholder: __("Choose…"),
					get_query: df.options === "User" ? () => ({ filters: { enabled: 1, user_type: "System User" } }) : undefined,
					onchange: () => {
						const value = control.get_value();
						if (!value) return;
						this.groupBy?.apply_filter(field === "assigned_to" ? "_assign" : field, value);
						holder.remove();
					},
				},
			});
			control.$input?.attr("aria-label", __("Choose…")).focus();
		}

		dateLabel() {
			return this.dateField === "creation" ? __("Created") : frappe.meta.get_label(this.doctype, this.dateField) || this.dateField;
		}

		has(f, c, v) {
			return this.fa.get().some((x) => x[1] === f && x[2] === c && String(x[3]) === String(v));
		}

		toggle({ f, c, v }) {
			if (this.has(f, c, v)) return this.fa.remove(f);
			/* one timespan on the date at a time */
			if (c === "Timespan") this.fa.filter_list.get_filter(f)?.remove();
			return this.fa.add(this.doctype, f, c, v);
		}

		/* everything that depends on the current filters, after each refresh */
		update() {
			if (this.$el.hasClass("is-rail")) return;
			const filters = this.fa.get();
			this.$el.find(".tm-x-chips button[data-f]").each((_, b) => b.classList.toggle("is-on", this.has(b.dataset.f, b.dataset.c, b.dataset.v)));
			this.facets(filters);
			this.tags();
			this.total();
		}

		facets(filters) {
			const fields = this.groupBy?.group_by_fields || ["assigned_to", "owner"];
			const $box = this.$el.find(".tm-x-facets");
			fields.forEach((field) => {
				let $f = $box.find(`.tm-x-facet[data-field="${field}"]`);
				if (!$f.length) $f = $(`<section class="tm-x-facet" data-field="${esc(field)}"><h4>${esc(LABELS[field] || frappe.meta.get_label(this.doctype, field) || field)}</h4><div class="tm-x-rows"><i class="tm-x-wait"></i></div></section>`).appendTo($box);
				const key = field === "assigned_to" ? "_assign" : field;
				const active = filters.filter((x) => x[1] === key).map((x) => String(x[3]).replace(/%/g, ""));
				this.groupBy?.get_group_by_count(field).then((rows) => {
					const top = Math.max(...rows.map((r) => r.count), 1);
					const items = rows.slice(0, 40).map((r) => {
						const value = r.name ?? "", label = r.name === "" || r.name === null ? __("Not set") : (field === "assigned_to" || field === "owner" ? frappe.user.full_name(r.name) : __(r.name));
						return `<button type="button" data-v="${esc(value)}" class="${active.includes(String(value)) ? "is-on" : ""}" style="--w:${Math.round((r.count / top) * 100)}%"><b>${esc(label)}</b><span>${r.count}</span></button>`;
					});
					$f.prop("hidden", !items.length && !active.length && !["assigned_to", "owner"].includes(field));
					/* An empty facet is one quiet line: its name and the way to choose. */
					$f.toggleClass("is-empty", !items.length);
					$f.find(".tm-x-rows").html(items.join(""));
					$f.find(".tm-x-more, .tm-x-pick").remove();
					if (items.length > 6 && !$f.hasClass("is-all")) $f.append(`<button type="button" class="btn-reset tm-x-more">${__("Show all {0}", [items.length])}</button>`);
					$f.append(`<button type="button" class="btn-reset tm-x-pick">${icon("add")}<span>${__("Choose…")}</span></button>`);
				});
			});
			$box.find(".tm-x-facet").each((_, el) => { if (!fields.includes(el.dataset.field)) el.remove(); });
		}

		tags() {
			frappe.xcall("frappe.desk.reportview.get_sidebar_stats", { stats: ["_user_tags"], doctype: this.doctype, filters: this.list.get_filters_for_args() }).then((r) => {
				const tags = ((r?.stats || {})._user_tags || []).filter((t) => t[0] && t[1] > 0 && !t[0].startsWith("_") && t[0] !== __("No Tags") && t[0] !== "No Tags");
				const $s = this.$el.find(".tm-x-tags").prop("hidden", !tags.length);
				$s.find(".tm-x-chips").html(tags.map(([t, n]) => `<button type="button" data-f="_user_tags" data-c="like" data-v="%${esc(t)}%" class="${this.has("_user_tags", "like", `%${t}%`) ? "is-on" : ""}">${esc(t)}<span>${n}</span></button>`).join(""));
			}).catch(() => {});
		}

		total() {
			const $t = this.$el.find(".tm-x-total");
			if (!this.moneyField) return $t.prop("hidden", true);
			const args = this.list.get_args();
			frappe.xcall("frappe.desk.reportview.get", {
				doctype: this.doctype, fields: [`sum(\`tab${this.doctype}\`.\`${this.moneyField.fieldname}\`) as total`],
				filters: args.filters, or_filters: args.or_filters || [],
			}).then((r) => {
				const total = r?.values?.[0]?.[0];
				if (total === undefined || total === null) return $t.prop("hidden", true);
				$t.prop("hidden", false).html(`<b>${frappe.format(total, this.moneyField, { only_value: 1 })}</b><span>${__("{0} in {1} records", [esc(__(this.moneyField.label)), this.list.total_count ?? "–"])}</span>`);
			}).catch(() => $t.prop("hidden", true));
		}
	}

	/* The sidebar is built before the filter area (base_list.js: setup_side_bar
	 * runs in setup_page, setup_filter_area in setup_view), and the panel
	 * needs both — so it is made when the filter area is. */
	const BaseList = frappe.views?.BaseList;
	if (BaseList && !BaseList.prototype._tm_panel_patched) {
		BaseList.prototype._tm_panel_patched = true;
		const orig = BaseList.prototype.setup_filter_area;
		BaseList.prototype.setup_filter_area = function () {
			const out = orig.apply(this, arguments);
			const sidebar = this.list_sidebar?.sidebar?.[0];
			if (enabled() && sidebar && this.filter_area && !sidebar.dataset.tmExplore) {
				sidebar.dataset.tmExplore = "1";
				try {
					new Panel(sidebar, this);
				} catch (e) {
					console.error("themate: explore panel", e);
				}
			}
			return out;
		};
	}

	/* Record count beside the title, and the panel's numbers, after each
	 * count: Frappe computes total_count inside get_count_str()'s promise
	 * (list_view.js:1001-1011), so both wait for it. */
	const ListView = frappe.views?.ListView;
	if (ListView && !ListView.prototype._tm_count_patched) {
		const original = ListView.prototype.get_count_str;
		ListView.prototype.get_count_str = function () {
			const promise = original.apply(this, arguments);
			Promise.resolve(promise).then(() => {
				try {
					const title = this.page?.wrapper?.[0]?.querySelector(".page-head .title-area .flex");
					if (!title) return;
					let el = title.querySelector(".tm-page-count");
					if (!enabled()) {
						el?.remove();
						return;
					}
					if (!el) {
						el = document.createElement("span");
						el.className = "tm-page-count";
						title.appendChild(el);
					}
					const total = this.total_count;
					el.textContent = total === undefined || total === null ? "" : __("{0} records", [total]);
					el.hidden = !el.textContent;
					clearTimeout(this._tm_panel_t);
					this._tm_panel_t = setTimeout(() => this._tm_panel?.update(), 150);
				} catch (e) {
					/* never break the list for a label */
				}
			}).catch(() => {});
			return promise;
		};
		ListView.prototype._tm_count_patched = true;
	}
})();

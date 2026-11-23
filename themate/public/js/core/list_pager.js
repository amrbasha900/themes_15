/* List view: numbered pages and a per-row menu.
 *
 * Native: frappe/public/js/frappe/list/base_list.js pages with "Load More"
 * — each click appends the next page and reset_defaults() then folds the
 * loaded rows into page_length, so a later refresh reloads everything seen
 * so far. The design pages instead: "Page 2 of 10 · ‹ 1 2 3 … 10 ›".
 *
 *  - the pager is drawn from total_count (set by get_count_str, which the
 *    count hook in list_panel.js already waits on) and the page-length
 *    buttons Frappe keeps on the left;
 *  - a page click fetches that page only (start = (p-1)·length, an empty
 *    data array so update_data does not concatenate) and remembers it;
 *  - reset_defaults keeps page_length at the chosen size instead of
 *    growing it, and any refresh the pager did not start (filters, sort,
 *    realtime) goes back to page 1 — with new filters page 7 may not exist.
 *  - each row gets a ⋮ menu: Open, Open in new tab, Duplicate.
 *
 * On a phone the pages are fewer (first, current, last) and the row wraps
 * (_list.scss): "Page 1 of 6 ‹ 1 2 3 4 … 6 ›" next to the page sizes is
 * wider than the screen, and the card clipped it. */
(function () {
	const frappe = window.frappe;
	const $ = window.jQuery;
	if (!frappe?.views?.ListView || !$) return;
	const ListView = frappe.views.ListView;
	const BaseList = frappe.views.BaseList;
	if (ListView.prototype._tm_pager) return;

	const enabled = () => window.themate?.enabled?.() !== false;
	/* only the plain list: Report / Kanban / Calendar extend BaseList (Report
	 * even extends ListView) and keep Frappe's own Load More */
	const paged = (lv) => enabled() && lv instanceof ListView && lv.view_name === "List" && !!lv.$paging_area;

	/* ---- paging ------------------------------------------------------------ */
	const length = (lv) => lv.selected_page_count || lv._tm_len || lv.page_length || 20;

	const phone = window.matchMedia?.("(max-width: 575px)");

	/* compact: first, current and last only — what fits a phone's width */
	function pages(total, len, current, compact = false) {
		const n = Math.max(1, Math.ceil(total / len));
		const set = new Set(compact ? [1, n, current] : [1, n, current - 1, current, current + 1]);
		if (!compact && current <= 3) [2, 3, 4].forEach((p) => set.add(p));
		if (!compact && current >= n - 2) [n - 1, n - 2, n - 3].forEach((p) => set.add(p));
		const list = [...set].filter((p) => p >= 1 && p <= n).sort((a, b) => a - b);
		const out = [];
		list.forEach((p, i) => {
			if (i && p - list[i - 1] > 1) out.push("…");
			out.push(p);
		});
		return { n, out };
	}

	function renderPager(lv) {
		const area = lv.$paging_area?.[0];
		if (!area) return;
		let el = area.querySelector(".tm-pager");
		if (!paged(lv)) {
			el?.remove();
			area.classList.remove("tm-paged");
			return;
		}
		if (!el) {
			el = document.createElement("div");
			el.className = "tm-pager";
			(area.querySelector(".level-right") || area).prepend(el);
			el.addEventListener("click", (e) => {
				const b = e.target.closest("button[data-page]");
				if (!b) return;
				goTo(lv, +b.dataset.page);
			});
		}
		const total = lv.total_count;
		if (total === undefined || total === null) {
			el.hidden = true;
			area.classList.remove("tm-paged");
			return;
		}
		const len = length(lv);
		const current = lv._tm_page || 1;
		const { n, out } = pages(total, len, current, !!phone?.matches);
		el.hidden = n <= 1;
		/* hides Load More (_list.scss) — a class: :has() is missing on older mobile Safari */
		area.classList.toggle("tm-paged", n > 1);
		if (n <= 1) return;
		el.innerHTML = `<span class="tm-pager-label">${__("Page {0} of {1}", [current, n])}</span>
			<button type="button" class="btn btn-default btn-sm" data-page="${current - 1}" ${current === 1 ? "disabled" : ""} aria-label="${__("Previous")}">‹</button>
			${out.map((p) => (p === "…" ? `<span class="tm-pager-gap">…</span>` : `<button type="button" class="btn btn-sm ${p === current ? "btn-primary" : "btn-default"}" data-page="${p}" ${p === current ? 'aria-current="page"' : ""}>${p}</button>`)).join("")}
			<button type="button" class="btn btn-default btn-sm" data-page="${current + 1}" ${current === n ? "disabled" : ""} aria-label="${__("Next")}">›</button>`;
	}

	function goTo(lv, page) {
		const len = length(lv);
		lv._tm_page = Math.max(1, page);
		lv._tm_len = len;
		lv._tm_paging = true;
		lv.start = (lv._tm_page - 1) * len;
		lv.page_length = len;
		lv.data = []; /* update_data concatenates past start 0 */
		const done = () => { lv._tm_paging = false; };
		const r = lv.refresh();
		if (r?.then) r.then(done, done); else done();
		lv.$result?.[0]?.scrollIntoView?.({ block: "start", behavior: "smooth" });
	}

	/* turning a tablet, or a window dragged narrow: redraw at the new width */
	phone?.addEventListener?.("change", () => {
		const lv = window.cur_list;
		if (lv?.$paging_area) {
			try { renderPager(lv); } catch (e) { /* keep the list */ }
		}
	});

	/* a refresh the pager did not start goes back to page 1 */
	const refresh = BaseList.prototype.refresh;
	BaseList.prototype.refresh = function () {
		if (!this._tm_paging && paged(this)) {
			this._tm_page = 1;
			this.start = 0;
			this.page_length = length(this);
		}
		return refresh.apply(this, arguments);
	};

	/* Frappe folds loaded pages into page_length; keep the chosen size */
	const reset = BaseList.prototype.reset_defaults;
	BaseList.prototype.reset_defaults = function () {
		if (!paged(this)) return reset.apply(this, arguments);
		this.page_length = length(this);
		this.start = 0;
	};

	/* draw after the count is known (render_count -> get_count_str) */
	const count = ListView.prototype.get_count_str;
	ListView.prototype.get_count_str = function () {
		const promise = count.apply(this, arguments);
		Promise.resolve(promise).then(() => { try { renderPager(this); } catch (e) { /* keep the list */ } }).catch(() => {});
		return promise;
	};

	/* ---- rendering: chunked, so a long page never freezes the tab --------- */
	/* base_list.js:644 appends every row in one synchronous loop. Measured on
	 * this bench, 866 rows (33k nodes) is ~580ms of unbroken main-thread work
	 * — the tab stops responding to clicks and scrolls for that whole time,
	 * and it grows linearly: 2500 rows is nearer two seconds.
	 *
	 * The total work is the same here; what changes is that it is cut into
	 * frame-sized pieces, so the browser paints and handles input between
	 * them. The first chunk is synchronous, so the list appears exactly as
	 * fast as it did before and the rest streams in behind it.
	 *
	 * Below THRESHOLD the native path runs untouched — chunking a 20-row list
	 * would add a frame of latency for nothing. */
	const CHUNK = 60;
	const THRESHOLD = 150;

	function addRowMenus(lv, scope) {
		scope.querySelectorAll(".list-row-container .list-row .level-right").forEach((right) => {
			if (right.querySelector(".tm-row-menu")) return;
			const b = document.createElement("button");
			b.type = "button";
			b.className = "btn btn-xs tm-row-menu";
			b.title = __("Actions");
			b.innerHTML = frappe.utils.icon("dot-horizontal", "xs");
			right.appendChild(b);
		});
		if (!lv._tm_row_menu_bound) {
			lv._tm_row_menu_bound = true;
			lv.$result.on("click", ".tm-row-menu", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const row = e.currentTarget.closest(".list-row-container");
				const name = row?.querySelector(".list-row-checkbox")?.dataset.name || row?.querySelector("a.list-id")?.getAttribute("href")?.split("/").pop();
				if (name) openRowMenu(lv, e.currentTarget, decodeURIComponent(name));
			});
		}
	}

	const renderList = ListView.prototype.render_list;
	ListView.prototype.render_list = function () {
		/* A refresh that lands mid-stream must not race the previous one. */
		if (this._tm_chunk) {
			cancelAnimationFrame(this._tm_chunk);
			this._tm_chunk = null;
		}

		if (!paged(this) || this.data.length <= THRESHOLD) {
			const out = renderList.apply(this, arguments);
			if (paged(this)) {
				try { addRowMenus(this, this.$result[0]); } catch (e) { /* never break rendering */ }
			}
			return out;
		}

		try {
			const result = this.$result[0];
			result.querySelectorAll(".list-row-container").forEach((r) => r.remove());

			let i = 0;
			const step = () => {
				const end = Math.min(i + CHUNK, this.data.length);
				let html = "";
				for (; i < end; i++) {
					this.data[i]._idx = i;
					html += this.get_list_row_html(this.data[i]);
				}
				/* One parse per chunk instead of one per row: the browser
				 * still does the same layout, but jQuery's per-call HTML
				 * parse and node import happen 15 times, not 866. */
				const slot = document.createElement("template");
				slot.innerHTML = html;
				const first = slot.content.firstElementChild;
				result.appendChild(slot.content);
				addRowMenus(this, result);
				if (first) this.$result.trigger("tm-rows-added", [first]);

				if (i < this.data.length) {
					this._tm_chunk = requestAnimationFrame(step);
				} else {
					this._tm_chunk = null;
					/* render() ran these before the last row existed. */
					this.set_rows_as_checked?.();
					this.toggle_result_area?.();
				}
			};
			step(); /* first chunk now, so nothing appears slower than before */
		} catch (e) {
			/* Any surprise in the chunked path falls back to Frappe's own. */
			this._tm_chunk = null;
			renderList.apply(this, arguments);
			try { addRowMenus(this, this.$result[0]); } catch (e2) { /* keep the list */ }
		}
	};

	function openRowMenu(lv, anchor, name) {
		document.querySelector(".tm-row-menu-pop")?.remove();
		const dt = lv.doctype;
		const pop = document.createElement("div");
		pop.className = "tm-row-menu-pop";
		pop.innerHTML = `
			<button type="button" data-act="open">${frappe.utils.icon("view", "xs")}<span>${__("Open")}</span></button>
			<button type="button" data-act="tab">${frappe.utils.icon("external-link", "xs")}<span>${__("Open in new tab")}</span></button>
			<button type="button" data-act="duplicate">${frappe.utils.icon("duplicate", "xs")}<span>${__("Duplicate")}</span></button>`;
		document.body.appendChild(pop);
		const r = anchor.getBoundingClientRect();
		const w = pop.offsetWidth;
		const rtl = document.documentElement.dir === "rtl";
		pop.style.top = `${r.bottom + window.scrollY + 4}px`;
		pop.style.left = `${Math.max(8, rtl ? r.left + window.scrollX : r.right + window.scrollX - w)}px`;
		const close = () => { pop.remove(); document.removeEventListener("click", close); };
		setTimeout(() => document.addEventListener("click", close), 0);
		pop.addEventListener("click", (e) => {
			const act = e.target.closest("[data-act]")?.dataset.act;
			if (!act) return;
			close();
			if (act === "open") frappe.set_route("Form", dt, name);
			if (act === "tab") window.open(frappe.utils.get_form_link(dt, name), "_blank");
			if (act === "duplicate") frappe.model.with_doc(dt, name, () => { const copy = frappe.model.copy_doc(frappe.get_doc(dt, name)); frappe.set_route("Form", dt, copy.name); });
		});
	}

	ListView.prototype._tm_pager = true;
})();

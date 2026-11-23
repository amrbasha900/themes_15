/* Report View: freeze the first columns so the identifying ones stay put.
 *
 * Native: frappe/public/js/frappe/views/reports/report_view.js builds a
 * frappe-datatable (1.19.0). The table has no frozen-column feature at all —
 * scroll right to reach Status and you have lost the ID you were reading,
 * which on a wide report is every column that matters.
 *
 * Two DOM facts decide the implementation, both from the library's own source:
 *
 *  1. `.dt-scrollable` scrolls natively, so a cell inside it can be pinned
 *     with `position: sticky` and nothing has to run on scroll.
 *  2. `.dt-header` does NOT scroll — style.js:51 mirrors the body by writing
 *     `transform: translateX(-scrollLeft)` on it. Sticky is therefore
 *     meaningless in the header, and the frozen header cells instead get the
 *     opposite translate, from a custom property this file keeps in step with
 *     the scroll position.
 *
 * Rows are re-rendered constantly (the body is virtualised with HyperList),
 * so nothing may live in an inline style on a cell. The offsets go in a
 * <style> element instead, which is how the library sizes its own columns.
 *
 * The menu the choice lives in is the library's column dropdown. Its list is
 * built once from `options.headerDropdown` (columnmanager.js:478) and the
 * click handler looks the action up BY INDEX at click time, so appending an
 * item to that array and a matching row to the rendered list is enough —
 * no re-render, and the delegated handler keeps working. */
(function () {
	const frappe = window.frappe;
	const ReportView = frappe?.views?.ReportView;
	if (!ReportView || ReportView.prototype._tm_freeze) return;

	const KEY = "tm-report-freeze";
	const enabled = () => window.themate?.enabled?.() !== false;

	function readAll() {
		try {
			return JSON.parse(localStorage.getItem(KEY) || "{}");
		} catch {
			return {};
		}
	}

	function remember(doctype, colIndex) {
		try {
			const all = readAll();
			if (colIndex < 0) delete all[doctype];
			else all[doctype] = colIndex;
			localStorage.setItem(KEY, JSON.stringify(all));
		} catch {
			/* private mode: freezing still works, it just does not persist */
		}
	}

	/* Column 0 is the checkbox and column 1 the serial number
	 * (report_view.js passes checkboxColumn: true). Freezing "up to" a column
	 * always includes those two, or the pinned block would start in mid-air. */
	function apply(view) {
		const dt = view.datatable;
		/* `wrapper` is the element report_view.js handed the library;
		 * `.datatable` is the box the library builds inside it
		 * (datatable.js:113), and that is what carries dir="rtl" and what the
		 * stylesheet below is scoped to. */
		const wrapper = dt?.datatableWrapper;
		if (!wrapper) return;

		let style = view._tm_freeze_style;
		if (!style || !style.isConnected) {
			style = document.createElement("style");
			style.className = "tm-freeze-style";
			(dt.wrapper || wrapper).appendChild(style);
			view._tm_freeze_style = style;
		}

		const upto = enabled() ? view._tm_freeze_upto ?? -1 : -1;
		wrapper.classList.toggle("tm-freeze-on", upto >= 0);
		if (upto < 0) {
			style.textContent = "";
			return;
		}

		/* Offsets come from the rendered header, not from the column config:
		 * the user can resize a column and the pinned block has to follow. */
		const header = wrapper.querySelector(".dt-row-header");
		if (!header) return;
		let offset = 0;
		let css = "";
		for (let i = 0; i <= upto; i++) {
			const cell = header.querySelector(`.dt-cell--col-${i}`);
			if (!cell) continue;
			css +=
				`.datatable.tm-freeze-on .dt-cell--col-${i}{position:sticky;` +
				`inset-inline-start:${offset}px;z-index:${20 - i};}\n` +
				`.datatable.tm-freeze-on .dt-header .dt-cell--col-${i}{position:static;` +
				`transform:translateX(var(--tm-dt-x,0px));z-index:${30 - i};}\n`;
			offset += cell.getBoundingClientRect().width;
		}
		css += `.datatable.tm-freeze-on .dt-cell--col-${upto}{box-shadow:1px 0 0 var(--tm-border-strong);}\n`;
		style.textContent = css;

		/* Keep the header's frozen cells still while the rest of it slides. */
		if (!view._tm_freeze_scroll) {
			const body = wrapper.querySelector(".dt-scrollable");
			if (body) {
				let frame = 0;
				view._tm_freeze_scroll = () => {
					if (frame) return;
					frame = requestAnimationFrame(() => {
						frame = 0;
						wrapper.style.setProperty("--tm-dt-x", `${body.scrollLeft}px`);
					});
				};
				body.addEventListener("scroll", view._tm_freeze_scroll, { passive: true });
			}
		}
		wrapper.style.setProperty(
			"--tm-dt-x",
			`${wrapper.querySelector(".dt-scrollable")?.scrollLeft || 0}px`
		);

		/* A resize of any frozen column moves every offset after it. */
		if (!view._tm_freeze_ro && window.ResizeObserver) {
			view._tm_freeze_ro = new ResizeObserver(() => {
				clearTimeout(view._tm_freeze_t);
				view._tm_freeze_t = setTimeout(() => apply(view), 80);
			});
			view._tm_freeze_ro.observe(header);
		}
	}

	function addMenuItems(view) {
		const dt = view.datatable;
		const cm = dt?.columnmanager;
		const list = cm?.$dropdownList;
		const items = dt?.options?.headerDropdown;
		if (!list || !items || list.querySelector(".tm-freeze-item")) return;

		const add = (label, action) => {
			const index = items.length;
			items.push({ label, action });
			const el = document.createElement("div");
			el.className = "dt-dropdown__list-item tm-freeze-item";
			el.dataset.index = String(index);
			el.textContent = label;
			list.appendChild(el);
		};

		add(__("Freeze up to this column"), (column) => {
			view._tm_freeze_upto = column.colIndex;
			remember(view.doctype, column.colIndex);
			apply(view);
		});
		add(__("Unfreeze columns"), () => {
			view._tm_freeze_upto = -1;
			remember(view.doctype, -1);
			apply(view);
		});
	}

	const setup = ReportView.prototype.setup_datatable;
	ReportView.prototype.setup_datatable = function () {
		const out = setup.apply(this, arguments);
		try {
			/* A new DataTable means a new wrapper, list and observer. */
			this._tm_freeze_ro?.disconnect();
			this._tm_freeze_ro = null;
			this._tm_freeze_scroll = null;
			this._tm_freeze_style = null;
			if (this._tm_freeze_upto === undefined) {
				const stored = readAll()[this.doctype];
				this._tm_freeze_upto = Number.isInteger(stored) ? stored : -1;
			}
			addMenuItems(this);
			/* The header has to be laid out before its widths mean anything. */
			requestAnimationFrame(() => {
				try {
					apply(this);
				} catch (e) {
					/* a report that renders is worth more than a frozen column */
				}
			});
		} catch (e) {
			/* never break the report */
		}
		return out;
	};

	ReportView.prototype._tm_freeze = true;
})();

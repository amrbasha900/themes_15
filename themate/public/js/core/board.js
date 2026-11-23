/* Board and timeline behaviour Frappe does not ship.
 *
 * Three additions, each one a thing the Jira board/timeline does and the
 * Frappe view does not:
 *
 *  1. A card count in every Kanban column header.
 *  2. The document name on every Kanban card — Jira's issue key. Frappe's
 *     card shows the title field and nothing else, so two orders for the
 *     same customer are indistinguishable until you open them.
 *  3. Collapsible Kanban columns, and a Today control on the Gantt that
 *     scrolls the chart to the current date. The Gantt opens at the earliest
 *     task in the set, which on a range that spans quarters is months away
 *     from anything anyone is looking at.
 *
 * Why an observer for the board and a prototype patch for the Gantt: the
 * board is a self-contained store in kanban_board.bundle.js with no
 * view-level render hook — add_card, the Sortable drop handler and every
 * filter refresh mutate .kanban-cards directly, and counting the DOM is the
 * one place that sees all three. The Gantt has render_gantt(), which is a
 * precise hook, so it does not need one.
 *
 * Re-entrancy: writing into the board mutates the tree the observer watches.
 * The rAF debounce collapses that into one extra pass, which finds nothing
 * changed, writes nothing, and ends the cycle. */
(function () {
	const frappe = window.frappe;
	if (!frappe || typeof MutationObserver === "undefined") return;

	const enabled = () => window.themate?.enabled?.() !== false;
	const COLLAPSE_KEY = "tm-kanban-collapsed";

	/* ---- Kanban ---------------------------------------------------------- */

	function readCollapsed() {
		try {
			return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]"));
		} catch {
			return new Set();
		}
	}

	function writeCollapsed(set) {
		try {
			localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
		} catch {
			/* private mode: collapsing still works, it just does not persist */
		}
	}

	/* The board is identified by its route so two boards on the same doctype
	 * do not share collapse state. */
	function columnKey(column) {
		return `${frappe.get_route().slice(0, 4).join("/")}::${column.dataset.columnValue || ""}`;
	}

	function paintBoard() {
		const board = document.querySelector(".kanban");
		if (!board || !enabled()) return;
		const collapsed = readCollapsed();

		board.querySelectorAll(".kanban-column:not(.add-new-column)").forEach((column) => {
			const title = column.querySelector(".kanban-column-title");
			const cards = column.querySelector(".kanban-cards");
			if (!title || !cards) return;

			/* The dragged card is rendered twice while a drag is in flight —
			 * the placeholder carries .sortable-ghost — so counting raw
			 * children would flicker +1 over the column being dragged from. */
			const count = String(
				cards.querySelectorAll(".kanban-card-wrapper:not(.sortable-ghost)").length
			);

			let chip = title.querySelector(".tm-kanban-count");
			if (!chip) {
				chip = document.createElement("span");
				chip.className = "tm-kanban-count";
				title.appendChild(chip);
			}
			if (chip.textContent !== count) {
				chip.textContent = count;
				chip.title = __("{0} cards", [count]);
			}

			/* Collapse toggle, before the status dot. */
			if (!column.querySelector(".tm-column-toggle")) {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.className = "tm-column-toggle";
				/* "chevron-left" is not a symbol in any of the three sprites —
				 * Frappe's timeless set has `left`, espresso has
				 * `es-line-left-chevron`, and Themate's has `tm-left-chevron`.
				 * The espresso name is the one that resolves in all cases:
				 * core/icons.js strips the `es-line-` prefix and finds
				 * `tm-left-chevron`, and with the theme off espresso's own
				 * symbol is there. `chevron-left` rendered an empty <svg>. */
				btn.innerHTML = frappe.utils.icon("es-line-left-chevron", "xs");
				title.prepend(btn);
			}
			column.classList.toggle("tm-column-collapsed", collapsed.has(columnKey(column)));

			/* The document name (Jira's issue key) and the record's real status,
			 * as the coloured pill the list view shows for the same record.
			 * The board's own columns are the Kanban field, which is usually
			 * NOT the status — an order can sit in "Sales" and be draft,
			 * submitted or cancelled, and nothing on the card said which. */
			cards.querySelectorAll(".kanban-card-wrapper[data-name]").forEach((wrapper) => {
				const meta = wrapper.querySelector(".kanban-card-meta");
				if (!meta) return;
				let name = "";
				try {
					name = decodeURIComponent(wrapper.dataset.name || "");
				} catch {
					name = wrapper.dataset.name || "";
				}
				if (!name) return;

				if (!meta.querySelector(".tm-card-key")) {
					const key = document.createElement("span");
					key.className = "tm-card-key";
					key.textContent = name;
					key.title = name;
					meta.prepend(key);
				}
				if (!meta.querySelector(".tm-card-status")) {
					const pill = statusPill(name);
					if (pill) meta.prepend(pill);
				}
			});

			emptyState(column, cards);
		});
	}

	/* cur_list is the KanbanView, which extends ListView and keeps the fetched
	 * documents — the board's own store holds only what the card template
	 * needed, so the status has to come from here. */
	function statusPill(name) {
		const view = window.cur_list;
		const doc = view?.data?.find?.((d) => d.name === name);
		if (!doc || !frappe.get_indicator) return null;
		let indicator = null;
		try {
			indicator = frappe.get_indicator(doc, view.doctype);
		} catch {
			return null;
		}
		if (!indicator || !indicator[0]) return null;
		const pill = document.createElement("span");
		pill.className = `indicator-pill ${indicator[1] || "gray"} tm-card-status`;
		pill.textContent = indicator[0];
		pill.title = indicator[0];
		return pill;
	}

	/* An empty column said nothing at all — not even that it was a column you
	 * can drop onto.
	 *
	 * The hint is a child of the COLUMN, never of .kanban-cards: Sortable
	 * reports the drop position as the child index of that list
	 * (kanban_board.bundle.js:601 passes e.newIndex straight to
	 * update_order_for_single_card), so one extra element inside it would
	 * put every card one place further down than the user dropped it. */
	function emptyState(column, cards) {
		const empty = !cards.querySelector(".kanban-card-wrapper");
		let hint = column.querySelector(":scope > .tm-column-empty");
		if (empty && !hint) {
			hint = document.createElement("div");
			hint.className = "tm-column-empty";
			hint.textContent = __("Nothing here yet — drop a card, or add one below.");
			column.appendChild(hint);
		} else if (!empty && hint) {
			hint.remove();
		}
	}

	/* "+ Add <doctype>" opens the real create flow, not a textarea.
	 *
	 * bind_add_card (kanban_board.bundle.js:614) shows a bare <textarea> and
	 * on Enter posts ONLY a title — every other field, mandatory ones
	 * included, is left at its default, so the board quietly creates
	 * half-made documents that then fail validation the first time somebody
	 * opens them. frappe.new_doc() is what "new record" means everywhere
	 * else in the Desk: Quick Entry where the doctype supports it, the full
	 * form where it does not, both with the column's own value prefilled so
	 * the record lands in the column it was started from.
	 *
	 * Capture phase on the document, because the native handler is bound to
	 * the button itself and would otherwise run first. */
	document.addEventListener(
		"click",
		(e) => {
			const add = e.target.closest?.(".kanban .kanban-column .add-card");
			if (!add || !enabled()) return;
			const view = window.cur_list;
			const doctype = view?.doctype;
			if (!doctype) return; /* let the native textarea handle it */
			e.preventDefault();
			e.stopPropagation();

			const column = add.closest(".kanban-column");
			const field = view.board?.field_name;
			const value = column?.dataset.columnValue;
			const opts = field && value ? { [field]: value } : {};
			frappe.new_doc(doctype, opts);
		},
		true
	);

	let frame = 0;
	function schedule() {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			try {
				paintBoard();
			} catch (e) {
				/* a board that renders is worth more than a count */
			}
		});
	}

	let observer = null;
	let watched = null;

	function attachBoard() {
		const board = document.querySelector(".kanban");
		if (!board) {
			observer?.disconnect();
			observer = null;
			watched = null;
			return;
		}
		if (board === watched) {
			schedule();
			return;
		}
		observer?.disconnect();
		watched = board;
		observer = new MutationObserver(schedule);
		observer.observe(board, { childList: true, subtree: true });
		schedule();
	}

	/* One delegated listener for the whole document: the board is rebuilt
	 * wholesale on every refresh, so a listener bound to a column would be
	 * thrown away with it. */
	document.addEventListener("click", (e) => {
		const column = e.target.closest?.(".kanban .kanban-column:not(.add-new-column)");
		if (!column) return;
		const onToggle = e.target.closest(".tm-column-toggle");
		/* A collapsed column is one big button — there is nothing else in it
		 * to click — so any click on it expands it again. */
		if (!onToggle && !column.classList.contains("tm-column-collapsed")) return;
		e.preventDefault();
		e.stopPropagation();
		const key = columnKey(column);
		const collapsed = readCollapsed();
		if (collapsed.has(key)) collapsed.delete(key);
		else collapsed.add(key);
		writeCollapsed(collapsed);
		column.classList.toggle("tm-column-collapsed", collapsed.has(key));
	});

	/* ---- Gantt ----------------------------------------------------------- */

	/* Both scroll directions, without reading scrollLeft: in RTL its sign and
	 * origin differ between engines, while getBoundingClientRect does not. */
	function scrollToToday(container) {
		const marker = container.querySelector(".today-highlight");
		if (!marker) return false;
		const delta =
			marker.getBoundingClientRect().left - container.getBoundingClientRect().left;
		const inset = Math.min(160, container.clientWidth / 3);
		container.scrollLeft += delta - inset;
		return true;
	}

	function setupTimeline(view) {
		const container = view.$result?.[0]?.querySelector(".gantt-container");
		if (!container || !enabled()) return;

		/* Opening on the earliest task in the set puts the viewport months
		 * away from today whenever the range spans quarters. */
		scrollToToday(container);

		const group = view.$paging_area?.[0]?.querySelector(".gantt-view-mode");
		if (!group || group.parentElement.querySelector(".tm-gantt-today")) return;
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "btn btn-default btn-sm tm-gantt-today";
		btn.textContent = __("Today");
		btn.addEventListener("click", () => {
			const live = view.$result?.[0]?.querySelector(".gantt-container");
			if (live) scrollToToday(live);
		});
		group.parentElement.insertBefore(btn, group);
	}

	const GanttView = frappe.views?.GanttView;
	if (GanttView && !GanttView.prototype._tm_timeline) {
		const render = GanttView.prototype.render_gantt;
		GanttView.prototype.render_gantt = function () {
			const out = render.apply(this, arguments);
			/* The library lays the SVG out synchronously but the container is
			 * sized by the browser, so the scroll maths needs one frame. */
			requestAnimationFrame(() => {
				try {
					setupTimeline(this);
				} catch (e) {
					/* a chart that renders is worth more than a scroll offset */
				}
			});
			return out;
		};
		GanttView.prototype._tm_timeline = true;
	}

	/* ---- Wiring ---------------------------------------------------------- */

	/* The board renders after the view's data call resolves, so a single
	 * check on page-change is too early; attach is idempotent. */
	function watch() {
		[0, 150, 600].forEach((ms) => setTimeout(attachBoard, ms));
	}

	if (window.jQuery) {
		window.jQuery(document).on("page-change", watch);
	}
	watch();
})();

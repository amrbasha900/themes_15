/* List View: rows in outline while the first page is on its way.
 *
 * Native shows nothing at all. base_list.js:495 refresh() calls freeze(true),
 * waits on the server, then renders — so from the click until the answer the
 * result area is simply empty, and on a cold list that is the whole screen.
 * list_view.js:539 freeze() only rewrites the count to "Refreshing…", which
 * is in the toolbar, not where the person is looking.
 *
 * The rows drawn here are the same height as the real ones (--tm-row-h), so
 * when the data lands nothing moves: render_list() removes every
 * .list-row-container — the placeholders included — and appends the real
 * rows in their place.
 *
 * Only when there is nothing to replace. A refresh over rows that are already
 * on screen (a filter change, a sort, realtime) leaves them alone: swapping
 * fifty readable rows for fifty grey bars loses information and reads as a
 * reload. Frappe's "Refreshing…" count covers that case.
 *
 * Painted through core/loading.js, so a list that answers in under 200ms — a
 * cached page, a small doctype — never draws anything at all. */
import { pending } from "./loading";

(function () {
	const frappe = window.frappe;
	const $ = window.jQuery;
	if (!frappe?.views?.ListView || !$) return;
	const ListView = frappe.views.ListView;
	if (ListView.prototype._tm_skeleton) return;

	const ROWS = 12;
	const enabled = () => window.themate?.enabled?.() !== false;
	/* Report, Kanban, Calendar and Gantt extend ListView or BaseList and draw
	 * something else entirely; .list-row-container is the plain list's row. */
	const plain = (lv) => enabled() && lv.view_name === "List" && !!lv.$result?.length;

	function paint(lv) {
		const result = lv.$result[0];
		if (result.querySelector(".list-row-container")) return; /* rows arrived first */
		const n = Math.max(3, Math.min(ROWS, Number(lv.page_length) || ROWS));
		const slot = document.createElement("template");
		slot.innerHTML = `<div class="list-row-container skeleton" aria-hidden="true"></div>`.repeat(n);
		result.appendChild(slot.content);
		result.setAttribute("aria-busy", "true");
		/* toggle_result_area() hid these the last time the list came back
		 * empty; the placeholders have to be visible to be a placeholder */
		lv.$result.show();
		lv.$no_result?.hide();
	}

	function clear(lv) {
		const result = lv.$result?.[0];
		if (!result) return;
		result.querySelectorAll(".list-row-container.skeleton").forEach((r) => r.remove());
		result.removeAttribute("aria-busy");
		/* paint() forced the area open; hand the decision back to Frappe */
		lv.toggle_result_area?.();
	}

	/* every list with an outline in flight, so a route away can drop them all
	 * without hunting the DOM; entries are removed as they settle */
	const inflight = new Set();

	function stop(lv, how) {
		const handle = lv._tm_skeleton;
		if (!handle) return;
		lv._tm_skeleton = null;
		inflight.delete(lv);
		handle[how]();
	}

	/* base_list.js:501/510 brackets the request with freeze(true/false). */
	const freeze = ListView.prototype.freeze;
	ListView.prototype.freeze = function (on) {
		const out = freeze.apply(this, arguments);
		try {
			if (!plain(this)) return out;
			if (!on) {
				stop(this, "done");
			} else if (!this._tm_skeleton) {
				this._tm_skeleton = pending({ show: () => paint(this), hide: () => clear(this) });
				inflight.add(this);
			}
		} catch (e) {
			/* never let a placeholder break the list */
		}
		return out;
	};

	/* A request that never answers — a failed call, a route away mid-flight —
	 * would otherwise leave the outline standing on a page the person comes
	 * back to. cancel() drops it now, with no floor to honour: nobody is
	 * waiting on this list any more. */
	$(document).on("page-change", () => {
		inflight.forEach((lv) => stop(lv, "cancel"));
	});

	ListView.prototype._tm_skeleton = true;
})();

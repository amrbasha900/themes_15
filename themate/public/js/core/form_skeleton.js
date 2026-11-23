/* Form: the record's shell while the document is being fetched.
 *
 * Native waits in silence. views/formview.js:79 fetch_and_render() asks the
 * server for the document and only switches to the form page in its callback
 * (render() -> frappe.container.change_to), so from the click until the
 * answer the person is still looking at the LIST they clicked from, with
 * nothing to say their click registered. On a slow connection or a heavy
 * doctype that is a second or more of a screen that appears to have ignored
 * them — and clicking again just queues a second fetch.
 *
 * Here, once the wait is long enough to feel (core/loading.js: 200ms), the
 * page is switched and the record's shape is drawn into it: a title, then
 * section cards with field-sized lines. Three things make that safe rather
 * than another flash of wrong content:
 *
 *  - the switch and the outline happen in the same task, so the browser never
 *    paints the form page holding the PREVIOUS record, nor an empty one;
 *  - a document that arrives inside those 200ms is switched to by Frappe's
 *    own render(), straight from the list — nothing is drawn in between.
 *    (This used to switch at once and draw the outline 200ms later, which
 *    put a blank white page between the list and every form.);
 *  - the page head's title and actions belong to that previous record too,
 *    so they are held invisible (their space kept) until the real one lands.
 *
 * Only fetch_and_render is wrapped. show_doc()'s other branch renders a
 * document that is already loaded and fresh — there is nothing to wait for
 * and nothing to cover. */
import { pending } from "./loading";

(function () {
	const frappe = window.frappe;
	const Factory = frappe?.views?.FormFactory;
	if (!Factory || Factory.prototype._tm_skeleton) return;

	const enabled = () => window.themate?.enabled?.() !== false;
	const SECTIONS = 3;
	const FIELDS = 6;

	function outline() {
		const el = document.createElement("div");
		el.className = "tm-form-skeleton";
		el.setAttribute("aria-busy", "true");
		el.setAttribute("aria-label", window.__ ? __("Loading...") : "Loading...");
		const field = '<span class="tm-skeleton-field"><span class="tm-skeleton-line is-short"></span><span class="tm-skeleton-line"></span></span>';
		el.innerHTML = `<div class="tm-form-skeleton-head"><span class="tm-skeleton-line is-tall"></span></div>`
			+ `<div class="tm-form-skeleton-section">${field.repeat(FIELDS)}</div>`.repeat(SECTIONS);
		return el;
	}

	/* frappe.views.formview[layout] is the .page-container jQuery object that
	 * container.js add_page() returned — not a frappe.ui.Page. Its
	 * .layout-main-section only exists once form.js setup() has run
	 * (make_app_page, on the first refresh of that doctype), so the very
	 * first record of a doctype has a bare container to draw into. */
	const root = (page) => page?.[0] || (page?.nodeType ? page : null);

	function show(page) {
		const el = root(page);
		if (!el || el.querySelector(".tm-form-skeleton")) return;
		const main = el.querySelector(".layout-main-section") || el;
		main.appendChild(outline());
		el.dataset.tmFormLoading = "1";
	}

	function hide(page) {
		const el = root(page);
		if (!el) return;
		el.querySelector(".tm-form-skeleton")?.remove();
		delete el.dataset.tmFormLoading;
	}

	let handle = null;
	let backstop = 0;
	/* the page-change our own switch fires is not a route away */
	let switching = false;
	function stop(how) {
		const h = handle;
		handle = null;
		clearTimeout(backstop);
		backstop = 0;
		h?.[how]();
	}

	/* The outline covers the form body, so anything that leaves it standing
	 * leaves a dead screen. render() and page-change cover every normal
	 * ending; this covers the one that is neither — formview.js:81 returns
	 * silently on a 403, with no render and no re-route. */
	const BACKSTOP = 15000;
	function arm(page, layout) {
		clearTimeout(backstop);
		backstop = setTimeout(() => stop("cancel"), BACKSTOP);
		const route = frappe.get_route_str();
		return pending({
			show: () => {
				/* still on the record that was asked for */
				if (frappe.get_route_str() !== route) return;
				/* The page render() would have switched to anyway, switched
				 * now. page-change therefore fires once here and once from
				 * render(); both are idempotent for every listener the theme
				 * adds. */
				switching = true;
				try {
					frappe.container.change_to(layout);
				} finally {
					switching = false;
				}
				show(page);
			},
			hide: () => hide(page),
		});
	}

	const fetch_and_render = Factory.prototype.fetch_and_render;
	Factory.prototype.fetch_and_render = function (doctype, name, doctype_layout) {
		const page = enabled() ? frappe.views.formview[doctype_layout] : null;
		if (!root(page)) return fetch_and_render.apply(this, arguments);

		stop("cancel"); /* a fetch the person routed away from */
		try {
			handle = arm(page, doctype_layout);
		} catch (e) {
			handle = null;
			hide(page);
		}
		return fetch_and_render.apply(this, arguments);
	};

	/* The document arrived (or the route was abandoned). render() is the only
	 * way fetch_and_render's callback reaches the form, and show_not_found /
	 * a re-route lands on page-change. */
	const render = Factory.prototype.render;
	Factory.prototype.render = function () {
		stop("done");
		return render.apply(this, arguments);
	};
	window.jQuery?.(document).on("page-change", () => {
		if (!switching) stop("cancel");
	});

	Factory.prototype._tm_skeleton = true;
})();

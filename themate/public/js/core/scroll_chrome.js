/* Sticky chrome on scroll: the page head and the form's tab bar.
 *
 * Native binds one throttled window-scroll handler per Page (ui/page.js:47)
 * and one per tabbed Layout (form/layout.js:500), and Frappe keeps every
 * screen the user has visited in the DOM for the life of the session, so
 * neither handler is ever removed. Two consequences:
 *
 *  - speed. After twenty screens a single scroll tick runs twenty handlers,
 *    each doing a document-wide $(".page-head") / $(".form-tabs-list") and
 *    writing inline styles onto every page head in the document — including
 *    the nineteen nobody can see.
 *
 *  - correctness. The layout handler captures its $(".form-tabs-list") set
 *    ONCE, when the layout is built. Bars that appear later are not in it,
 *    so they never receive .form-tabs-sticky-up / -down — and those classes
 *    are the only thing that gives the bar a `top`. `position: sticky` with
 *    `top: auto` does not stick, which is why the tabs scrolled away on a
 *    form opened part-way through a session and came back after a reload:
 *    a reload rebuilds the set from a document holding one form.
 *
 * Both methods are replaced here by ONE passive, rAF-throttled listener that
 * writes to the page Frappe is currently showing (frappe.container.page) and
 * only when the scroll direction actually changes. components/_form-page.scss
 * gives the bar its resting offset in CSS as well, so it sticks before the
 * first scroll event and even if this file never runs.
 *
 * Behaviour is Frappe's, unchanged: scrolling down tucks the page head away
 * and lifts the tab bar under the navbar; scrolling up brings both back.
 * The page carries .tm-head-tucked meanwhile, so the form's side panel
 * (sticky too) moves with them instead of sliding under the head. */
(function () {
	const frappe = window.frappe;
	const $ = window.jQuery;
	if (!frappe?.ui?.Page || !$) return;
	if (window.themate?.enabled?.() === false) return; /* master switch off: Frappe's own handlers */
	const Page = frappe.ui.Page;
	const Layout = frappe.ui.form?.Layout;
	if (Page.prototype._tm_scroll) return;

	const HEAD_REST = "var(--navbar-height)";
	const HEAD_UP = "-15px";

	let last = 0;
	let up = null; /* null: unknown, so the next tick always paints */
	let frame = 0;

	/* The one .page-container Frappe is showing; every other one is a cached
	 * screen the user cannot see, and writing to it is wasted work. */
	function current() {
		const page = frappe.container?.page;
		const el = page && (page.nodeType ? page : page[0]);
		return el && el.isConnected ? el : null;
	}

	function paint() {
		frame = 0;
		const el = current();
		if (!el) return;
		const top = document.documentElement.scrollTop;
		const head = el.querySelector(".page-head");
		if (head) head.classList.toggle("drop-shadow", top > 0);
		const next = top > 0 && last <= top;
		last = top;
		if (next === up) return; /* same direction: nothing to rewrite */
		up = next;
		if (head) head.style.top = next ? HEAD_UP : HEAD_REST;
		/* the form's side panel follows the head (_form-page.scss) */
		el.classList.toggle("tm-head-tucked", next);
		const bar = el.querySelector(".form-tabs-list");
		if (bar) {
			bar.classList.toggle("form-tabs-sticky-up", next);
			bar.classList.toggle("form-tabs-sticky-down", !next);
		}
	}

	function schedule() {
		if (!frame) frame = requestAnimationFrame(paint);
	}

	window.addEventListener("scroll", schedule, { passive: true });

	/* A new screen starts at rest: Frappe scrolls to the top on page-change,
	 * and the head of the page being shown may still carry the inline `top`
	 * it was left with when the user walked away from it. */
	$(document).on("page-change", () => {
		last = document.documentElement.scrollTop || 0;
		up = null;
		schedule();
	});

	/* Frappe's own handler, minus the window scroll binding. */
	Page.prototype.setup_scroll_handler = function () {};

	/* form/layout.js:500 — the tab click behaviour is kept verbatim; only the
	 * scroll binding is dropped and the two global selectors are scoped to
	 * the layout that was clicked. */
	if (Layout) {
		Layout.prototype.setup_events = function () {
			if (!this.tab_link_container) return;
			const page = this.page;
			const content = this.tabs_content?.[0];
			this.tab_link_container.off("click").on("click", ".nav-link", (e) => {
				e.preventDefault();
				e.stopImmediatePropagation();
				$(e.currentTarget).tab("show");
				if (!content || content.getBoundingClientRect().top >= 100) return;
				content.scrollIntoView();
				setTimeout(() => {
					const el = current();
					const head = el?.querySelector(".page-head");
					if (head) head.style.top = HEAD_UP;
					el?.classList.add("tm-head-tucked");
					up = true;
					/* looked up now, not closed over: core/form_tabs.js moves
					 * the bar around inside .form-page after this runs */
					const bar = page?.children?.(".form-tabs-list")[0];
					if (!bar) return;
					bar.classList.add("form-tabs-sticky-up");
					bar.classList.remove("form-tabs-sticky-down");
				}, 3);
			});
		};
	}

	Page.prototype._tm_scroll = true;
})();

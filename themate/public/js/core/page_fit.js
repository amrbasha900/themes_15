/* Page head on one line.
 *
 * Frappe's head is a fixed 60px box (--page-head-height, desk/page.scss:110)
 * holding the title and the buttons in a Bootstrap .row, which wraps. When
 * the buttons did not fit beside the title — a form with a few custom
 * buttons, someone else viewing it, a laptop at 125% zoom — the whole
 * .page-actions column dropped to a second line the box never grew for: it
 * was painted over the form's tab bar and the document panel.
 *
 * Frappe has an answer, keyed to the viewport rather than to the space: each
 * custom button is mirrored in the ⋯ menu as a `.hidden-xl` item (ui/page.js
 * add_inner_button / add_button, form.js add_custom_button), the inline copies
 * are hidden under 992px (`.custom-actions.hidden-md`) and the icon group
 * under 768px. Beside the sidebar, far wider viewports than that are already
 * too narrow.
 *
 * layout/_page.scss stops the row wrapping and lets the title shrink to a
 * floor. When the buttons still overflow the head, the same steps Frappe
 * takes on a phone are taken here, on that one head, one at a time:
 *   1. .tm-head-compact  custom buttons → their copies in the ⋯ menu
 *   2. .tm-head-tight    print / previous / next icons hidden
 * Every check starts from the full head, so a wider window brings the buttons
 * back. Checks run in ResizeObserver / MutationObserver callbacks, which the
 * browser runs before it paints: no frame shows the overflowing head. */
(function () {
	const frappe = window.frappe;
	const Page = frappe?.ui?.Page;
	if (!Page || Page.prototype._tm_fit || !window.ResizeObserver) return;

	const shown = (el) => !!el && el.getClientRects().length > 0;

	/* [class, is there anything for this step to take away] */
	const STEPS = [
		[
			"tm-head-compact",
			(head) =>
				shown(head.querySelector(".custom-actions")) &&
				!!head.querySelector(".menu-btn-group li.hidden-xl"),
		],
		["tm-head-tight", (head) => shown(head.querySelector(".page-icon-group"))],
	];
	const CLASSES = STEPS.map(([cls]) => cls);

	/* The buttons reach outside the head's box: past either end, or (when a
	 * narrow screen lets them wrap, layout/_responsive.scss) above or below
	 * its padding. Measured on the column, not its dropdowns, which are
	 * absolutely placed and overflow by design. */
	function overflows(content) {
		const actions = content.querySelector(":scope > .page-actions");
		if (!actions) return false;
		const box = content.getBoundingClientRect();
		const cs = getComputedStyle(content);
		const a = actions.getBoundingClientRect();
		return (
			a.right > box.right + 1 ||
			a.left < box.left - 1 ||
			a.top < box.top + parseFloat(cs.paddingTop) - 1 ||
			a.bottom > box.bottom - parseFloat(cs.paddingBottom) + 1
		);
	}

	function fit(head) {
		if (!head) return;
		const content = head.querySelector(".page-head-content");
		head.classList.remove(...CLASSES);
		/* a cached page Frappe is not showing has no width to measure; the
		 * resize observer calls again when it is shown */
		if (!content?.clientWidth || !window.themate?.enabled?.()) return;
		for (const [cls, applies] of STEPS) {
			if (!overflows(content)) return;
			if (applies(head)) head.classList.add(cls);
		}
	}

	/* The head's own class changes are outside what is observed (only the
	 * row inside it), and they do not change the row's size, so fitting
	 * never re-triggers itself. */
	const resized = new ResizeObserver((entries) => {
		entries.forEach((e) => fit(e.target.closest(".page-head")));
	});
	const changed = new MutationObserver((records) => {
		const heads = new Set();
		records.forEach((r) => {
			const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
			const head = el?.closest(".page-head");
			if (head) heads.add(head);
		});
		heads.forEach(fit);
	});

	function watch(head) {
		const content = head?.querySelector(".page-head-content");
		if (!content || head._tm_fit) return;
		head._tm_fit = true;
		resized.observe(content);
		/* buttons added / removed / shown, the title and indicator written */
		changed.observe(content, {
			childList: true,
			subtree: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["class", "style"],
		});
	}

	const setup = Page.prototype.setup_page;
	Page.prototype.setup_page = function () {
		const out = setup.apply(this, arguments);
		watch(this.wrapper?.find(".page-head")[0]);
		return out;
	};
	document.querySelectorAll(".page-head").forEach(watch);
	Page.prototype._tm_fit = true;
})();

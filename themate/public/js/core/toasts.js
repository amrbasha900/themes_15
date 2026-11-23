/* Toasts (frappe.show_alert, ui/messages.js:414) past three collapse behind a
 * "+N more" pill above the stack; the pill shows them all, or folds them again.
 * Native appends each toast to #alert-container and removes it when it times
 * out or is closed, so one observer on that container keeps the count right.
 * Layout and look: scss/components/_dropdowns.scss. */
(function () {
	const frappe = window.frappe;
	if (!frappe?.show_alert || frappe.show_alert._tm) return;

	const MAX = 3;
	const native = frappe.show_alert;
	let box = null;
	let more = null;
	let obs = null;

	function update() {
		const shown = [...box.children].filter((el) => el.classList.contains("desk-alert") && !el.classList.contains("out"));
		const extra = window.themate?.enabled?.() === false ? 0 : shown.length - MAX;
		if (extra <= 0) box.classList.remove("is-expanded");
		const open = box.classList.contains("is-expanded");
		shown.forEach((el, i) => el.classList.toggle("tm-alert-folded", !open && i < extra));
		more.hidden = extra <= 0;
		more.textContent = open ? __("Show less") : __("+{0} more", [extra], "Toasts");
		more.setAttribute("aria-expanded", String(open));
		obs?.takeRecords(); /* drop the records this update made itself, or it loops */
	}

	function watch() {
		box = document.getElementById("alert-container");
		if (!box) return;
		more = document.createElement("button");
		more.type = "button";
		more.className = "tm-alert-more";
		more.hidden = true;
		more.addEventListener("click", () => {
			box.classList.toggle("is-expanded");
			update();
		});
		box.prepend(more);
		/* toasts coming and going; a leaving one gets .out 800 ms before it goes */
		obs = new MutationObserver(update);
		obs.observe(box, { childList: true, subtree: true, attributeFilter: ["class"] });
		update();
	}

	frappe.show_alert = function () {
		const out = native.apply(this, arguments);
		if (!box) watch();
		return out;
	};
	frappe.show_alert._tm = true;
})();

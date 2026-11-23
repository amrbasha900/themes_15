/* Whitelabel: no Frappe / ERPNext references on the desk.
 *
 * Theme Settings > Whitelabel (boot.themate.whitelabel, also mirrored to
 * html[data-tm-whitelabel] for the CSS half in components/_whitelabel.scss).
 *
 * What this file removes, and where it comes from:
 *   Help menu        Navbar Settings > help_dropdown: Documentation, User
 *                    Forum, Frappe School, Report an Issue, About, Frappe
 *                    Support — everything but Keyboard Shortcuts goes.
 *   Apps             Navbar Settings > settings_dropdown "/apps": the apps
 *                    screen shows Frappe/ERPNext names and logos.
 *   Watch Tutorial   onboarding steps' YouTube button. A step with a video
 *                    shows ONLY that button and reveals its real action
 *                    after the video (onboarding_widget.js show_step), so
 *                    the video url is blanked before the step renders and
 *                    the action button appears straight away.
 *   Brand words      "ERPNext" / "Frappe" inside onboarding titles and step
 *                    text (Module Onboarding data) become the App Name.
 * Links to those domains anywhere else (banners, onboarding text, login)
 * are hidden by CSS on href. Nothing is deleted from the database. */
(function () {
	const frappe = window.frappe;
	if (!frappe) return;

	const on = () => (frappe.boot?.themate?.whitelabel ?? 1) && window.themate?.enabled?.() !== false;
	const EXTERNAL = /(frappe\.io|erpnext\.com|frappeframework\.com|frappecloud\.com|frappe\.cloud|github\.com\/frappe|frappe\.school)/i;

	function pruneHelpMenu() {
		const menu = document.getElementById("toolbar-help");
		if (!menu) return;
		menu.querySelectorAll("a.dropdown-item, button.dropdown-item, .dropdown-divider").forEach((el) => {
			const keep = (el.getAttribute("onclick") || "").includes("show_shortcuts");
			if (!keep) el.remove();
		});
		const apps = document.querySelector('#toolbar-user a.dropdown-item[href="/apps"]');
		apps?.remove();
	}

	const BRAND = /\bERPNext\b|\bFrappe(?: Framework)?\b/g;

	function appName() {
		const name = frappe.boot?.themate?.app_name || frappe.boot?.sysdefaults?.app_name || "";
		return /^(frappe|erpnext|frappe framework)$/i.test(name) ? "" : name;
	}

	function rebrand(root) {
		const name = appName();
		if (!name) return;
		const boxes = root.matches?.(".onboarding-widget-box") ? [root] : root.querySelectorAll(".onboarding-widget-box");
		boxes.forEach((box) => {
			const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				BRAND.lastIndex = 0;
				if (BRAND.test(node.nodeValue)) node.nodeValue = node.nodeValue.replace(BRAND, name);
			}
		});
	}

	function pruneOnboarding(scope) {
		const root = scope && scope.querySelectorAll ? scope : document;
		const wanted = __("Watch Tutorial");
		root.querySelectorAll(".onboarding-step-footer button, .onboarding-step-footer .btn").forEach((b) => {
			if (b.textContent.trim() === wanted) b.remove();
		});
		rebrand(root);
	}

	/* The tutorial button is rendered when a step is shown, after page load. */
	const Onboarding = frappe.widget?.widget_factory?.onboarding;
	if (Onboarding && !Onboarding.prototype._tm_whitelabel) {
		const original = Onboarding.prototype.show_step;
		Onboarding.prototype.show_step = function (step) {
			if (on() && step && step.intro_video_url) step.intro_video_url = "";
			const out = original.apply(this, arguments);
			try { if (on()) pruneOnboarding(this.widget?.[0]); } catch (e) { /* keep the widget */ }
			return out;
		};
		Onboarding.prototype._tm_whitelabel = true;
	}

	function run() {
		if (!on()) return;
		pruneHelpMenu();
		pruneOnboarding();
	}

	if (window.jQuery) {
		window.jQuery(document).on("toolbar_setup page-change form-refresh", () => setTimeout(run, 0));
		window.jQuery(run);
	}
	window.themate = window.themate || {};
	window.themate.applyWhitelabel = run;
})();

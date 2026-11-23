/* Connections tab — the form dashboard (Frappe's Connections and the 360
 * panel, core/form_360.js) in a tab of its own.
 *
 * Native: frappe/public/js/frappe/form/form.js setup_std_layout puts
 * .form-dashboard into the tab flagged show_dashboard, else at the top of
 * the FIRST tab, else (no Tab Break at all) at the top of the form page —
 * above every field. ERPNext's transactional doctypes ship a "Connections"
 * tab; custom doctypes usually do not, and the 360 panel then pushes the
 * fields down the page.
 *
 * Here, once the layout is built and no tab carries the dashboard:
 *  - a tabbed form gets one more tab, "Connections", holding the dashboard;
 *  - a plain form becomes two tabs — "Details" (every section, untouched)
 *    and "Connections" (the dashboard) — on Frappe's own tab bar
 *    (layout.setup_tabbed_layout), so the look and the sticky behaviour
 *    are the ones every other form has.
 * The tab hides itself while the dashboard has nothing to show (a new
 * record, a doctype without links), exactly like Frappe's own Connections
 * tab; on a plain form the bar disappears with it. */
(function () {
	const frappe = window.frappe;
	if (!frappe?.ui?.form?.Form || !frappe.ui.form.Dashboard || !window.jQuery) return;
	const $ = window.jQuery;
	const Form = frappe.ui.form.Form;
	const Dashboard = frappe.ui.form.Dashboard;
	if (Form.prototype._tm_form_tabs) return;

	const enabled = () => window.themate?.enabled?.() !== false;

	/* form.js:2066 set_active_tab records the tab on the form and then fires
	 * "on_tab_change" through frm.script_manager — which form.js:112 creates
	 * AFTER setup_std_layout, the hook this file runs from. Frappe's own
	 * comment there says that order cannot change ("client script must be
	 * called after setup - there are no fields_dict attached to the frm
	 * otherwise"), and its native tabs never trip over it because they only
	 * reach set_active_tab through a shown.bs.tab event, which fires later.
	 * place() calls it straight away, so on every plain form the initial
	 * layout threw
	 *
	 *   TypeError: Cannot read properties of undefined (reading 'trigger')
	 *
	 * The catch around place() swallowed it and took the rest of update()
	 * with it, leaving the bar with no decided active tab until something
	 * else refreshed the dashboard.
	 *
	 * The record is the half update() reads back through get_active_tab, so
	 * it is written either way; only the event waits for something to fire
	 * it on. */
	function activate(frm, tab) {
		if (!frm) return;
		if (frm.script_manager) {
			frm.set_active_tab?.(tab);
			return;
		}
		frm.active_tab_map = frm.active_tab_map || {};
		frm.active_tab_map[frm.docname] = tab;
	}

	/* The same interface as frappe/public/js/frappe/form/tab.js (not
	 * exported), so layout.refresh_tabs / set_tab_as_active treat it as one
	 * of theirs. */
	class Tab {
		constructor(layout, df, frm) {
			this.layout = layout;
			this.df = df;
			this.frm = frm;
			this.doctype = frm.doctype;
			this.label = df.label;
			this.tab_link_container = layout.tab_link_container;
			this.tabs_content = layout.tabs_content;
			this.make();
			this.tab_link.find(".nav-link").on("shown.bs.tab", () => activate(this.frm, this));
			this.refresh();
		}

		make() {
			const id = `${frappe.scrub(this.doctype, "-")}-${this.df.fieldname}`;
			this.tab_link = $(`
				<li class="nav-item tm-form-tab">
					<button class="nav-link ${this.df.active ? "active" : ""}" id="${id}-tab" data-toggle="tab"
						data-fieldname="${this.df.fieldname}" href="#${id}" role="tab" aria-controls="${id}">
						${frappe.utils.escape_html(__(this.label))}
					</button>
				</li>`).appendTo(this.tab_link_container);
			this.wrapper = $(`<div class="tab-pane fade show ${this.df.active ? "active" : ""}" id="${id}" role="tabpanel" aria-labelledby="${id}-tab">`)
				.appendTo(this.tabs_content);
		}

		/* Details: always; Connections: while the dashboard shows something */
		refresh() {
			let show = true;
			if (this.df.show_dashboard) {
				const dash = this.wrapper.find(".form-dashboard");
				show = dash.hasClass("visible-section") || dash.find(".tm-360").length > 0;
			}
			this.toggle(show);
		}

		toggle(show) {
			this.tab_link.toggleClass("hide", !show).toggleClass("show", show);
			this.wrapper.toggleClass("hide", !show).toggleClass("show", show);
			this.hidden = !show;
		}

		show() { this.tab_link.show(); }
		hide() { this.tab_link.hide(); }
		add_field(f) { f.tab = this; }
		replace_field(f) { f.tab = this; }
		set_active() {
			this.tab_link.find(".nav-link").tab("show");
			this.wrapper.addClass("show");
			activate(this.frm, this);
		}
		is_active() { return this.wrapper.hasClass("active"); }
		is_hidden() { return this.wrapper.hasClass("hide") && this.tab_link.hasClass("hide"); }
	}

	/* ---- placement -------------------------------------------------------- */
	function place(frm) {
		if (!enabled()) return;
		const layout = frm.layout;
		const dash = frm.dashboard?.parent;
		if (!layout || !dash?.length || frm.meta?.istable) return;
		if (["DocType", "Customize Form"].includes(frm.doctype)) return; /* the form builder reads its own tabs */
		if (layout.tabs.some((t) => t.df?.show_dashboard)) return; /* Frappe placed it in a Connections tab */

		const state = { plain: !layout.tabs.length };
		if (state.plain) {
			layout.setup_tabbed_layout(); /* the bar and the pane container, appended to .form-page */
			const page = layout.page;
			const bar = page.children(".form-tabs-list");
			const content = page.children(".form-tab-content");
			/* everything else on the page — the sections and the dashboard — goes into Details */
			const rest = page.children().not(bar).not(content);
			page.prepend(content).prepend(bar);
			state.details = new Tab(layout, { fieldtype: "Tab Break", fieldname: "tm_details", label: "Details", active: 1 }, frm);
			state.details.wrapper.append(rest);
			layout.tabs.push(state.details);
		}
		state.connections = new Tab(layout, { fieldtype: "Tab Break", fieldname: "tm_connections", label: "Connections", show_dashboard: 1 }, frm);
		state.connections.wrapper.append(dash);
		layout.tabs.push(state.connections);
		frm._tm_tabs = state;
		update(frm);
	}

	/* after every dashboard change: the tab's visibility, the bar on a plain
	 * form, and the active tab when nothing is */
	function update(frm) {
		const state = frm?._tm_tabs;
		if (!state?.connections) return;
		state.connections.refresh();
		if (!state.plain) return;
		const only = state.connections.hidden;
		frm.layout.page.children(".form-tabs-list").toggleClass("tm-tabs-single", only);
		if (only && state.connections.is_active()) state.details.set_active();
		const active = frm.get_active_tab?.();
		if (!active || active.hidden) state.details.set_active();
	}

	const setup = Form.prototype.setup_std_layout;
	Form.prototype.setup_std_layout = function () {
		const out = setup.apply(this, arguments);
		try { place(this); } catch (e) { console.warn("[themate] connections tab:", e); }
		return out;
	};

	/* loads after core/form_360.js, so the 360 panel is there when this runs */
	["refresh", "show", "hide", "update_badges"].forEach((name) => {
		const original = Dashboard.prototype[name];
		if (!original) return;
		Dashboard.prototype[name] = function () {
			const out = original.apply(this, arguments);
			try { update(this.frm); } catch (e) { /* keep the form */ }
			return out;
		};
	});

	Form.prototype._tm_form_tabs = true;
})();

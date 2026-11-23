/* Form 360 — the Dashboard tab of a master record as one working panel.
 *
 * Native: frappe/public/js/frappe/form/dashboard.js renders "Connections"
 * as link groups with counts (templates/form_links.html), plus heatmap,
 * graph and stats sections. This module keeps those data and replaces the
 * connections block with:
 *
 *   left   Addresses and Contacts as cards (from the record's onload
 *          addr_list / contact_list, which frappe.contacts loads for
 *          Customer, Supplier, Lead, Company…); files stay in the document
 *          panel's Attachments, which get a type badge (_form-page.scss);
 *   right  the record's own statistics when the app provides them — ERPNext
 *          party dashboards put per-company Annual Billing / Total Unpaid /
 *          Loyalty Points in doc.__onload.dashboard_info, and any doctype
 *          may add indicators with frm.dashboard.add_indicator — shown as
 *          tiles, one group per company; then a summary of the linked
 *          doctype with the most documents — total, count, outstanding and
 *          a status bar (Paid / Unpaid / Overdue…); then one tab per linked
 *          doctype with a searchable table of its documents. Nothing is
 *          keyed to a particular doctype: the fields are found on the meta.
 *
 * Timing: the panel is built on Dashboard.refresh — the same moment Frappe
 * draws the tab — from what the form already holds (links, stats, addresses),
 * so nothing waits on the network; Dashboard.update_badges, which Frappe
 * calls once the open counts are back, then fills the tab counts and the
 * status bar. Link filters follow Frappe's own rules: the dashboard's
 * fieldname, the per-doctype overrides in non_standard_fieldnames, and the
 * names Frappe found through child tables (internal_links_found) when they
 * are known. Rows come from frappe.db.get_list, so permissions apply; the
 * summary comes from themate.api.get_link_summary. Nothing here changes the
 * record. */
(function () {
	const frappe = window.frappe;
	if (!frappe?.ui?.form?.Dashboard || !window.jQuery) return;
	const $ = window.jQuery;
	const Dashboard = frappe.ui.form.Dashboard;
	if (Dashboard.prototype._tm_360) return;

	const enabled = () => window.themate?.enabled?.() !== false;
	const esc = (s) => frappe.utils.escape_html(String(s ?? ""));
	const TOTAL_FIELDS = ["grand_total", "base_grand_total", "total", "total_amount", "amount", "paid_amount", "net_total"];
	const DATE_FIELDS = ["posting_date", "transaction_date", "date", "due_date", "start_date", "creation"];
	const PAGE = 10; /* rows per page in the related table */

	/* status word -> tone; Frappe's guess_colour fills the gaps */
	function tone(status) {
		const s = String(status || "");
		if (/on leave|half day|work from home|holiday/i.test(s)) return "info";
		if (/paid|completed|complete|delivered|closed|converted|approved|submitted|active|billed|received|success|finished|done|present/i.test(s) && !/unpaid|partly|not /i.test(s)) return "good";
		if (/overdue|cancel|reject|fail|expired|lost|error|stopped|disabled|inactive|absent/i.test(s)) return "bad";
		if (/unpaid|draft|open|pending|to |partly|return|on hold|in progress|quotation|replied/i.test(s)) return "warn";
		const g = frappe.utils.guess_colour?.(s);
		return g === "green" ? "good" : g === "red" ? "bad" : g === "orange" || g === "yellow" ? "warn" : "muted";
	}

	function money(v, currency) {
		return currency && window.format_currency ? format_currency(v, currency) : frappe.format(v, { fieldtype: "Float" }, { inline: true });
	}

	/* ---- link model ------------------------------------------------------ */
	function links(frm, dash) {
		const data = dash.data || {};
		const out = [];
		(data.transactions || []).forEach((group) => {
			(group.items || []).forEach((dt) => {
				if (!frappe.model.can_read(dt) || !data.fieldname) return;
				const filters = dash.get_document_filter(dt);
				out.push({ doctype: dt, group: group.label, filters, route: Object.assign({}, filters), count: null, open: 0, internal: false });
			});
		});
		return out;
	}

	/* Frappe's open counts: numbers for the tabs, and for a link found
	 * through a child table the exact names (faster than the child join) */
	function applyCounts(list, count) {
		const internal = {};
		(count?.internal_links_found || []).forEach((d) => (internal[d.doctype] = d));
		const external = {};
		(count?.external_links_found || []).forEach((d) => (external[d.doctype] = d));
		list.forEach((l) => {
			const hit = internal[l.doctype] || external[l.doctype];
			if (!hit) { l.count = 0; return; }
			l.count = hit.count || 0;
			l.open = hit.open_count || 0;
			if (internal[l.doctype] && Array.isArray(hit.names)) {
				l.internal = true;
				l.filters = { name: ["in", hit.names] };
				l.route = { name: ["in", hit.names] };
			}
		});
	}

	/* Frappe's dashboard filter is {fieldname: docname} for every linked
	 * doctype. The field may live on the doctype itself (customer on Sales
	 * Invoice), in one of its child tables (item_code on Sales Invoice
	 * Item — the list view resolves it the same way), or nowhere (a
	 * dynamic-link key such as quotation_to on Opportunity): resolved to
	 * list filters, child-table keys pointed at the child, unknown ones
	 * dropped. Needs the doctype's meta loaded. */
	function cleanFilters(doctype, filters) {
		if (!filters || Array.isArray(filters)) return filters;
		const out = [];
		Object.keys(filters).forEach((k) => {
			const v = filters[k];
			const cond = Array.isArray(v) ? v : ["=", v];
			if (k === "name" || frappe.meta.has_field(doctype, k)) {
				out.push([doctype, k, cond[0], cond[1]]);
				return;
			}
			const child = (frappe.get_meta(doctype)?.fields || []).find((df) => df.fieldtype === "Table" && frappe.meta.has_field(df.options, k));
			if (child) out.push([child.options, k, cond[0], cond[1]]);
		});
		return out;
	}

	/* the linked doctype the status bar is about: the one with the most
	 * documents (a tie keeps the dashboard's own order) */
	function primary(list) {
		if (!list.length) return null;
		return list.reduce((best, l) => ((l.count || 0) > (best.count || 0) ? l : best), list[0]);
	}

	/* ---- the record's own stats ------------------------------------------
	 * 1. doc.__onload.dashboard_info: [{company, currency, annual_billing,
	 *    total_unpaid, loyalty_points, …}] (ERPNext party dashboards);
	 * 2. else the indicators the form added to Frappe's Stats section. */
	const STAT_LABELS = { annual_billing: "Annual Billing", total_unpaid: "Total Unpaid", loyalty_points: "Loyalty Points", billing_this_year: "Billing This Year" };
	const isMoney = (key) => !/points|count|qty|quantity|days|rate$/i.test(key);
	const statTone = (key, value) => (/unpaid|outstanding|overdue|due/i.test(key) ? (value > 0 ? "warn" : "good") : "");

	function stats(frm, dash) {
		const info = frm.doc.__onload?.dashboard_info;
		if (Array.isArray(info) && info.length) {
			return info.map((row) => ({
				group: row.company || "",
				items: Object.keys(row)
					.filter((k) => !["company", "currency", "party_type", "party"].includes(k) && typeof row[k] === "number")
					.map((k) => ({
						key: k,
						label: __(STAT_LABELS[k] || frappe.model.unscrub(k)),
						value: isMoney(k) ? money(row[k], row.currency || frappe.boot.sysdefaults?.currency) : frappe.format(row[k], { fieldtype: "Float" }, { inline: true }),
						tone: statTone(k, row[k]),
					})),
			})).filter((g) => g.items.length);
		}
		/* Frappe's Stats section: "<label>: <value>" indicators */
		const nodes = dash.stats_area_row?.[0]?.querySelectorAll?.(".indicator") || [];
		const items = Array.from(nodes).map((n) => {
			const text = n.textContent.trim();
			const i = text.indexOf(":");
			return i > 0 ? { key: text.slice(0, i), label: text.slice(0, i).trim(), value: text.slice(i + 1).trim(), tone: n.classList.contains("red") || n.classList.contains("orange") ? "warn" : n.classList.contains("green") ? "good" : "" } : null;
		}).filter(Boolean);
		return items.length ? [{ group: "", items }] : [];
	}

	function renderStats(frm, dash, main, el) {
		const groups = stats(frm, dash);
		if (!groups.length) return;
		const box = document.createElement("section");
		box.className = "tm-360-stats";
		box.innerHTML = groups.map((g) => `
			<div class="tm-360-stats-group">
				${groups.length > 1 || g.group ? `<div class="tm-360-stats-title">${esc(g.group)}</div>` : ""}
				<div class="tm-360-tiles">${g.items.map((it) => `
					<div class="tm-360-tile ${it.tone ? `is-${it.tone}` : ""}">
						<span class="tm-360-tile-label">${esc(it.label)}</span>
						<span class="tm-360-tile-value"><bdi>${esc(it.value)}</bdi></span>
					</div>`).join("")}</div>
			</div>`).join("");
		main.appendChild(box);
		el.classList.add("tm-360-has-stats"); /* hides Frappe's own Stats section */
	}

	/* ---- render ------------------------------------------------------------ */
	function mount(dash) {
		const parent = dash.parent?.[0] || dash.parent;
		if (!parent) return null;
		let el = parent.querySelector(":scope > .tm-360");
		if (!el) {
			el = document.createElement("div");
			el.className = "tm-360";
			parent.prepend(el);
		}
		return el;
	}

	function render(frm, dash) {
		if (!enabled() || frm.is_new()) return null;
		const el = mount(dash);
		if (!el) return null;
		const key = `${frm.doctype}/${frm.docname}`;
		if (el.dataset.key === key && el._tm) return el; /* built already for this record */
		const list = links(frm, dash);
		if (!list.length) { el.remove(); return null; }
		el.dataset.key = key;
		el.innerHTML = "";
		const side = renderSide(frm);
		const main = document.createElement("div");
		main.className = "tm-360-main";
		el.appendChild(side);
		el.appendChild(main);
		el.classList.toggle("tm-360-no-side", !side.children.length);
		el.classList.remove("tm-360-has-stats");
		renderStats(frm, dash, main, el);
		const summary = document.createElement("section");
		summary.className = "tm-360-summary tm-360-pending";
		summary.innerHTML = `<div class="tm-360-skeleton"><span></span><span></span></div>`;
		main.appendChild(summary);
		const tabs = renderTabs(frm, main, list);
		el._tm = { list, summary, tabs };
		return el;
	}

	/* counts arrived (Dashboard.update_badges): badges, then the status bar */
	function complete(frm, dash, count) {
		const el = render(frm, dash);
		if (!el?._tm || el._tm.done) return;
		el._tm.done = true;
		applyCounts(el._tm.list, count);
		el._tm.tabs.refreshCounts();
		renderSummary(frm, el._tm.summary, primary(el._tm.list));
	}

	/* ---- left: addresses, contacts, files ---------------------------------- */
	function renderSide(frm) {
		const side = document.createElement("div");
		side.className = "tm-360-side";
		const onload = frm.doc.__onload || {};
		const addresses = onload.addr_list || [];
		const contacts = onload.contact_list || [];
		if (addresses.length) side.appendChild(block(__("Addresses"), "map", addresses.map(addressCard).join(""), () => newLinked(frm, "Address")));
		if (contacts.length) side.appendChild(block(__("Contacts"), "users", contacts.map(contactCard).join(""), () => newLinked(frm, "Contact")));
		side.querySelectorAll("[data-route]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); frappe.set_route(a.dataset.route); }));
		return side;
	}

	function block(title, icon, body, onAdd) {
		const b = document.createElement("section");
		b.className = "tm-360-block";
		b.innerHTML = `<header><span class="tm-360-block-title">${frappe.utils.icon(icon, "sm")}<span>${esc(title)}</span></span>
			<button type="button" class="btn btn-xs btn-default tm-360-add" title="${__("Add")}">${frappe.utils.icon("add", "xs")}</button></header>
			<div class="tm-360-block-body">${body}</div>`;
		b.querySelector(".tm-360-add").addEventListener("click", onAdd);
		return b;
	}

	function newLinked(frm, doctype) {
		frappe.route_options = { link_doctype: frm.doctype, link_name: frm.docname };
		frappe.new_doc(doctype);
	}

	function addressCard(a) {
		const kind = a.is_shipping_address ? __("Shipping Address") : a.is_primary_address ? __("Billing Address") : __(a.address_type || "Address");
		const lines = [a.address_line1, a.address_line2, [a.city, a.state].filter(Boolean).join(", "), [a.country, a.pincode].filter(Boolean).join(" ")].filter(Boolean);
		return `<a class="tm-360-card ${a.is_primary_address ? "is-primary" : ""}" data-route="/app/address/${encodeURIComponent(a.name)}" href="/app/address/${encodeURIComponent(a.name)}">
			<span class="tm-360-card-icon">${frappe.utils.icon(a.is_shipping_address ? "stock" : "home", "sm")}</span>
			<span class="tm-360-card-body">
				<span class="tm-360-card-title">${esc(kind)}</span>
				<span class="tm-360-card-text">${lines.map(esc).join("<br>")}</span>
				${a.phone ? `<span class="tm-360-card-meta"><bdi>${esc(a.phone)}</bdi></span>` : ""}
			</span>
		</a>`;
	}

	function contactCard(c) {
		const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.name;
		const meta = [c.designation, c.email_id, c.mobile_no || c.phone].filter(Boolean);
		return `<a class="tm-360-card ${c.is_primary_contact ? "is-primary" : ""}" data-route="/app/contact/${encodeURIComponent(c.name)}" href="/app/contact/${encodeURIComponent(c.name)}">
			<span class="tm-360-card-avatar">${frappe.avatar(c.email_id || name, "avatar-small")}</span>
			<span class="tm-360-card-body">
				<span class="tm-360-card-title">${esc(name)}${c.is_primary_contact ? ` <span class="tm-360-tag">${__("Primary")}</span>` : ""}</span>
				<span class="tm-360-card-meta">${meta.map((m) => `<bdi>${esc(m)}</bdi>`).join(" · ")}</span>
			</span>
		</a>`;
	}

	/* ---- right: summary ------------------------------------------------------- */
	/* one summary request per linked doctype: the card on top and the
	 * status tiles under the sidebar read the same answer */
	function summaryOf(link) {
		link._summary = link._summary || (async () => {
			await frappe.model.with_doctype(link.doctype);
			link.filters = cleanFilters(link.doctype, link.filters);
			return frappe.xcall("themate.api.get_link_summary", { doctype: link.doctype, filters: link.filters });
		})();
		link._summary.catch(() => { link._summary = null; });
		return link._summary;
	}

	async function renderSummary(frm, box, link) {
		if (!link) { box.remove(); return; }
		let s;
		try {
			s = await summaryOf(link);
		} catch (e) {
			box.remove();
			return;
		}
		if (!s.count) {
			box.remove();
			return;
		}
		box.classList.remove("tm-360-pending");
		const rows = s.rows || [];
		const bar = s.has_status && rows.length
			? `<div class="tm-360-bar" role="img">${rows.map((r) => `<span class="is-${tone(r.status)}" style="width:${((r.count / s.count) * 100).toFixed(1)}%" title="${esc(r.status)}: ${r.count}"></span>`).join("")}</div>
			   <ul class="tm-360-legend">${rows.map((r) => `<li><span class="tm-360-dot is-${tone(r.status)}"></span><span class="tm-360-legend-label">${esc(__(r.status || "None"))}</span><span class="tm-360-legend-count">${r.count} ${__("docs")}</span>${s.total_field ? `<b><bdi>${esc(money(r.total, s.currency))}</bdi></b>` : ""}</li>`).join("")}</ul>`
			: "";
		box.innerHTML = `<header class="tm-360-summary-head">
				<span class="tm-360-summary-title">${esc(__(link.doctype))}</span>
				<span class="tm-360-summary-facts">
					${s.total_field ? `<span>${__("Total")}: <b><bdi>${esc(money(s.total, s.currency))}</bdi></b></span>` : ""}
					<span>${__("{0} documents", [s.count])}</span>
					${s.has_outstanding ? `<span class="${s.outstanding > 0 ? "is-warn" : ""}">${__("Outstanding")}: <b><bdi>${esc(money(s.outstanding, s.currency))}</bdi></b></span>` : ""}
				</span>
			</header>${bar}`;
	}

	/* ---- right: the linked documents ---------------------------------------------
	 * A sidebar of the linked doctypes (icon, name, count; the empty ones
	 * dimmed at the end, the list scrolling in its own box) with the picked one's status tiles under it, and its
	 * records beside: search, Open list, New and a paged table (PAGE rows,
	 * searched on the server: name or the title field), so a customer with
	 * 400 invoices is as light as one with 4.
	 *
	 * Fast on purpose: a page once fetched is kept (going back to a doctype
	 * paints at once), hovering or focusing a doctype fetches its first page
	 * ahead, and only the latest pick may paint. */
	const ICONS = [
		[/attendance|leave|holiday|shift|checkin/i, "calendar"], [/salary|payroll|payment|invoice|expense|loan|advance|claim/i, "expenses"],
		[/exit|separation|resignation/i, "arrow-right"], [/grievance|appraisal|feedback|interview|quality/i, "quality"],
		[/policy|assignment|permission/i, "permission"], [/employee|contact|applicant|user|lead/i, "users"],
		[/order|quotation|opportunity/i, "sell"], [/stock|item|delivery|receipt|material/i, "stock"], [/project|task|timesheet/i, "projects"],
	];
	const iconOf = (dt) => (ICONS.find(([re]) => re.test(dt)) || [null, "file"])[1];
	const TILE_ICON = { bad: "close", good: "check", info: "calendar", warn: "clock", muted: "primitive-dot" };

	function renderTabs(frm, main, list) {
		const box = document.createElement("section");
		box.className = "tm-360-related";
		const count = (n) => `<span class="tm-360-count">${n}</span>`;
		const tabHtml = (l, i) => `<button type="button" role="tab" class="tm-360-tab" data-i="${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">
			<span class="tm-360-tab-icon" aria-hidden="true">${frappe.utils.icon(iconOf(l.doctype), "sm")}</span>
			<span class="tm-360-tab-label">${esc(__(l.doctype))}</span>${l.open ? `<span class="tm-360-open" title="${__("Open")}">${l.open}</span>` : ""}${l.count === null ? "" : count(l.count)}</button>`;
		box.innerHTML = `<aside class="tm-360-nav">
				<h3 class="tm-360-nav-title"><span>${__("Connections")}</span><span class="tm-360-badge" hidden></span></h3>
				<div class="tm-360-tabs" role="tablist" aria-orientation="vertical">${list.map(tabHtml).join("")}</div>
				<section class="tm-360-status" hidden><h4></h4><div class="tm-360-status-tiles"></div></section>
			</aside>
			<div class="tm-360-pane">
				<h3 class="tm-360-pane-title"><span></span><span class="tm-360-badge" hidden></span></h3>
				<div class="tm-360-toolbar">
					<label class="tm-360-search">${frappe.utils.icon("search", "sm")}<input type="search" placeholder="${__("Search...")}"></label>
					<button type="button" class="btn btn-sm btn-default tm-360-list">${frappe.utils.icon("list", "xs")}<span>${__("Open list")}</span></button>
					<button type="button" class="btn btn-sm btn-primary tm-360-new">${frappe.utils.icon("add", "xs")}<span>${__("New")}</span></button>
				</div>
				<div class="tm-360-table"></div>
				<div class="tm-360-pager" hidden></div>
			</div>`;
		main.appendChild(box);
		const state = { i: 0, meta: {}, metaP: {}, page: {}, query: "", timer: null, seq: 0, last: null, chosen: false, rows: new Map(), ahead: null };
		const tabs = box.querySelector(".tm-360-tabs");
		const table = box.querySelector(".tm-360-table");
		const pager = box.querySelector(".tm-360-pager");
		const search = box.querySelector(".tm-360-search input");
		const paneTitle = box.querySelector(".tm-360-pane-title");
		const status = box.querySelector(".tm-360-status");

		const badge = (el, n) => {
			el.hidden = n === null || n === undefined;
			el.textContent = el.hidden ? "" : n;
		};
		/* meta, then one page; kept, so a second visit costs nothing */
		const rowsOf = async (link, page, query) => {
			if (!state.meta[link.doctype]) {
				state.metaP[link.doctype] = state.metaP[link.doctype] || describe(link); /* a hover and a click ask once */
				state.meta[link.doctype] = await state.metaP[link.doctype];
			}
			const key = `${link.doctype}|${page}|${query}`;
			if (!state.rows.has(key)) state.rows.set(key, fetchRows(link, state.meta[link.doctype], page, query).catch(() => { state.rows.delete(key); return { rows: [], more: false }; }));
			return state.rows.get(key);
		};
		const tiles = async (link, seq) => {
			status.hidden = true;
			if (!link.count) return;
			let s;
			try { s = await summaryOf(link); } catch (e) { return; }
			if (seq !== state.seq || !s?.has_status || !(s.rows || []).length) return;
			status.querySelector("h4").textContent = __("{0} Summary", [__(link.doctype)]);
			status.querySelector(".tm-360-status-tiles").innerHTML = s.rows.slice(0, 6).map((r) => {
				const t = tone(r.status);
				return `<div class="tm-360-stile is-${t}"><span class="tm-360-stile-icon" aria-hidden="true">${frappe.utils.icon(TILE_ICON[t] || "primitive-dot", "xs")}</span><b>${r.count}</b><span>${esc(__(r.status || "None"))}</span></div>`;
			}).join("");
			status.hidden = false;
		};

		const show = async (i, page = 1) => {
			state.i = i;
			tabs.querySelectorAll(".tm-360-tab").forEach((t) => {
				const on = +t.dataset.i === i;
				t.setAttribute("aria-selected", String(on));
				t.tabIndex = on ? 0 : -1;
			});
			const link = list[i];
			const seq = ++state.seq;
			paneTitle.firstElementChild.textContent = __("{0} Records", [__(link.doctype)]);
			badge(paneTitle.lastElementChild, link.count);
			tiles(link, seq);
			state.page[link.doctype] = page;
			const key = `${link.doctype}|${page}|${state.query}`;
			if (!state.rows.has(key)) {
				if (state.meta[link.doctype]) table.classList.add("is-loading");
				else table.innerHTML = `<div class="tm-skeleton tm-360-skeleton-rows" aria-busy="true">${'<span class="tm-skeleton-line"></span>'.repeat(4)}</div>`;
			}
			const data = await rowsOf(link, page, state.query);
			if (seq !== state.seq) return;
			table.classList.remove("is-loading");
			state.last = { data, page };
			paint(table, link, state.meta[link.doctype], data, state.query, frm);
			paintPager(pager, link, data, page, state.query, (p) => show(i, p));
		};
		const pick = (t) => {
			state.chosen = true; /* the order stops moving under the person's hand */
			show(+t.dataset.i, state.page[list[+t.dataset.i].doctype] || 1);
		};
		tabs.addEventListener("click", (e) => {
			const t = e.target.closest(".tm-360-tab");
			if (t) pick(t);
		});
		/* a vertical tablist: up / down move between the shown doctypes */
		tabs.addEventListener("keydown", (e) => {
			if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
			const shown = [...tabs.querySelectorAll(".tm-360-tab")];
			const at = shown.indexOf(document.activeElement);
			const next = e.key === "Home" ? shown[0] : e.key === "End" ? shown[shown.length - 1] : shown[at + (e.key === "ArrowDown" ? 1 : -1)];
			if (!next) return;
			e.preventDefault();
			next.focus();
			pick(next);
		});
		/* the first page of a doctype the pointer or the focus rests on */
		const ahead = (e) => {
			const t = e.target.closest?.(".tm-360-tab");
			clearTimeout(state.ahead);
			if (!t || navigator.connection?.saveData) return;
			state.ahead = setTimeout(() => rowsOf(list[+t.dataset.i], 1, "").catch(() => {}), 120);
		};
		tabs.addEventListener("pointerover", ahead);
		tabs.addEventListener("focusin", ahead);
		search.addEventListener("input", () => {
			clearTimeout(state.timer);
			state.timer = setTimeout(() => { state.query = search.value.trim(); show(state.i, 1); }, 300);
		});
		box.querySelector(".tm-360-list").addEventListener("click", () => {
			const link = list[state.i];
			frappe.route_options = link.route;
			frappe.set_route("List", link.doctype, "List");
		});
		box.querySelector(".tm-360-new").addEventListener("click", () => {
			const link = list[state.i];
			if (!link.internal) frappe.route_options = Object.assign({}, link.route);
			frappe.new_doc(link.doctype);
		});
		table.addEventListener("click", (e) => {
			const row = e.target.closest("tr[data-name]");
			if (row) frappe.set_route("Form", list[state.i].doctype, row.dataset.name);
		});
		show(0);
		return {
			refreshCounts() {
				const buttons = [...tabs.querySelectorAll(".tm-360-tab")];
				buttons.forEach((t) => {
					const l = list[+t.dataset.i];
					t.classList.toggle("is-empty", l.count === 0);
					t.querySelector(".tm-360-count")?.remove();
					t.querySelector(".tm-360-open")?.remove();
					if (l.open) t.insertAdjacentHTML("beforeend", `<span class="tm-360-open" title="${__("Open")}">${l.open}</span>`);
					if (l.count !== null) t.insertAdjacentHTML("beforeend", count(l.count));
				});
				badge(box.querySelector(".tm-360-nav-title .tm-360-badge"), list.reduce((n, l) => n + (l.count || 0), 0));
				/* The linked doctypes that actually hold documents read first;
				 * the empty ones keep their place at the end. sort() is stable,
				 * so a tie keeps the dashboard's own grouping. data-i still
				 * points into `list`, so nothing else has to know the order. */
				const order = buttons.slice().sort((a, b) => (list[+b.dataset.i].count || 0) - (list[+a.dataset.i].count || 0));
				if (order.some((t, i) => t !== buttons[i])) tabs.append(...order);
				/* the first one shown is the first one worth reading —
				 * unless the person has already picked one */
				const first = order.find((t) => (list[+t.dataset.i].count || 0) > 0);
				const target = !state.chosen && first ? +first.dataset.i : state.i;
				const cur = list[state.i];
				/* a child-table link now has exact names: its rows must be refetched */
				if (cur.internal) {
					delete state.meta[cur.doctype];
					delete state.metaP[cur.doctype];
					[...state.rows.keys()].forEach((k) => k.startsWith(`${cur.doctype}|`) && state.rows.delete(k));
				}
				if (target !== state.i || cur.internal) {
					show(target, state.page[list[target].doctype] || 1);
					return;
				}
				/* nothing to fetch again: the count, the tiles and the pager were waiting */
				badge(paneTitle.lastElementChild, cur.count);
				tiles(cur, state.seq);
				if (state.last) paintPager(pager, cur, state.last.data, state.last.page, state.query, (p) => show(state.i, p));
			},
		};
	}

	/* which fields the table shows for a linked doctype */
	async function describe(link) {
		await frappe.model.with_doctype(link.doctype);
		const meta = frappe.get_meta(link.doctype);
		/* client meta has no has_field(); frappe.meta.has_field(dt, fn) does the lookup */
		const has = (f) => !!frappe.meta.has_field(link.doctype, f);
		/* Frappe's dynamic-link filter (e.g. quotation_to) is written for every
		 * doctype under the same fieldname; keep only the keys this one has */
		link.filters = cleanFilters(link.doctype, link.filters);
		const total = TOTAL_FIELDS.find(has);
		const date = DATE_FIELDS.find((f) => f === "creation" || has(f)) || "creation";
		const status = has("status") ? "status" : null;
		let title = meta.title_field && meta.title_field !== "name" && has(meta.title_field) ? meta.title_field : null;
		/* the title is this record itself on every row (customer_name on a
		 * customer's invoices): nothing to read there */
		const linkField = Object.keys(link.route || {})[0];
		if (title && linkField && (title === linkField || title === `${linkField}_name`)) title = null;
		const outstanding = has("outstanding_amount") ? "outstanding_amount" : null;
		const field = (f) => frappe.meta.get_docfield(link.doctype, f);
		const currency = total && field(total)?.fieldtype === "Currency" ? frappe.boot.sysdefaults?.currency : null;
		return { total, date, status, title, outstanding, currency };
	}

	/* one page of rows; a query matches the name or the title field. A
	 * filter on a child-table field (sales_order on Sales Invoice Item)
	 * joins the child, one row per matching child row: grouped by name, as
	 * Frappe's list view does (base_list.js get_group_by), so an invoice
	 * with three items from this order is listed once; columns are named
	 * with their table, since the child may share them (creation). */
	async function fetchRows(link, meta, page, query) {
		const col = (f) => `\`tab${link.doctype}\`.\`${f}\``;
		const fields = ["name", meta.date, meta.total, meta.status, meta.title, meta.outstanding, "docstatus"].filter(Boolean);
		const args = {
			doctype: link.doctype, fields, filters: link.filters, group_by: col("name"),
			order_by: `${col(meta.date)} desc`, limit_start: (page - 1) * PAGE, limit_page_length: PAGE + 1,
		};
		if (query) {
			const like = `%${query}%`;
			args.or_filters = [[link.doctype, "name", "like", like]].concat(meta.title ? [[link.doctype, meta.title, "like", like]] : []);
		}
		try {
			const rows = await frappe.xcall("frappe.client.get_list", args);
			return { rows: rows.slice(0, PAGE), more: rows.length > PAGE };
		} catch (e) {
			return { rows: [], more: false };
		}
	}

	function paint(table, link, meta, data, query, frm) {
		const rows = data.rows || [];
		if (!rows.length) {
			table.innerHTML = `<div class="tm-360-state">${query ? __("No match") : __("No {0} yet", [__(link.doctype)])}</div>`;
			return;
		}
		/* a title that is this record on every row (the customer's name on
		 * its own quotations) says nothing: drop the column for this page */
		const self = new Set([frm?.docname, frm?.doc?.[frm?.meta?.title_field], frm?.doc?.title].filter(Boolean));
		meta = Object.assign({}, meta, { title: meta.title && rows.every((r) => self.has(r[meta.title])) ? null : meta.title });
		const label = (f) => __(frappe.meta.get_docfield(link.doctype, f)?.label || f);
		const head = [__("Name"), meta.title ? label(meta.title) : null, __("Date"), meta.total ? label(meta.total) : null, meta.outstanding ? __("Outstanding") : null, meta.status ? __("Status") : null].filter((h) => h !== null);
		table.innerHTML = `<div class="tm-360-scroll"><table class="tm-360-grid"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `
			<tr data-name="${esc(r.name)}">
				<td class="tm-360-name">${esc(r.name)}</td>
				${meta.title ? `<td>${esc(r[meta.title] ?? "")}</td>` : ""}
				<td class="tm-360-date">${esc(frappe.datetime.str_to_user(String(r[meta.date] || "").slice(0, 10)))}</td>
				${meta.total ? `<td class="tm-360-num"><bdi>${esc(money(r[meta.total], meta.currency))}</bdi></td>` : ""}
				${meta.outstanding ? `<td class="tm-360-num"><bdi>${esc(money(r.outstanding_amount, meta.currency))}</bdi></td>` : ""}
				${meta.status ? `<td><span class="tm-360-pill is-${tone(r.docstatus === 2 ? "Cancelled" : r.status)}">${esc(__(r.docstatus === 2 ? "Cancelled" : r.status || ""))}</span></td>` : ""}
			</tr>`).join("")}</tbody></table></div>`;
	}

	/* numbered pages from the tab's count; while searching (count unknown)
	 * just previous / next from whether a further row exists */
	function pageList(n, current) {
		const set = new Set([1, n, current - 1, current, current + 1]);
		if (current <= 3) [2, 3, 4].forEach((p) => set.add(p));
		if (current >= n - 2) [n - 1, n - 2, n - 3].forEach((p) => set.add(p));
		const list = [...set].filter((p) => p >= 1 && p <= n).sort((a, b) => a - b);
		const out = [];
		list.forEach((p, i) => { if (i && p - list[i - 1] > 1) out.push("…"); out.push(p); });
		return out;
	}

	function paintPager(pager, link, data, page, query, goTo) {
		const total = query ? null : link.count;
		const n = total === null || total === undefined ? null : Math.max(1, Math.ceil(total / PAGE));
		const single = n === null ? page === 1 && !data.more : n <= 1;
		pager.hidden = single;
		if (single) return;
		const btn = (p, label, extra = "") => `<button type="button" class="btn btn-sm ${p === page ? "btn-primary" : "btn-default"}" data-page="${p}" ${extra}>${label}</button>`;
		pager.innerHTML = `<span class="tm-360-pager-label">${n ? __("Page {0} of {1}", [page, n]) : __("Page {0}", [page])}</span>
			${btn(page - 1, "‹", page === 1 ? "disabled" : "")}
			${n ? pageList(n, page).map((p) => (p === "…" ? `<span class="tm-360-pager-gap">…</span>` : btn(p, p))).join("") : ""}
			${btn(page + 1, "›", (n ? page >= n : !data.more) ? "disabled" : "")}`;
		pager.onclick = (e) => { const b = e.target.closest("button[data-page]"); if (b && !b.disabled) goTo(+b.dataset.page); };
	}

	/* ---- hooks ------------------------------------------------------------------ */
	/* the shell, as soon as Frappe draws the tab */
	const refresh = Dashboard.prototype.refresh;
	Dashboard.prototype.refresh = function () {
		const out = refresh.apply(this, arguments);
		try {
			if (this.data?.transactions?.length && render(this.frm, this)) {
				/* Frappe fetches the counts only when its Connections block
				 * scrolls into view (observe_link_render) — hidden behind the
				 * panel it never would. Ask now; set_open_count guards repeats. */
				this.set_open_count();
			}
		} catch (e) { console.warn("[themate] form 360:", e); }
		return out;
	};
	/* counts and the status bar, when Frappe has them */
	const original = Dashboard.prototype.update_badges;
	Dashboard.prototype.update_badges = function (count) {
		const out = original.apply(this, arguments);
		try { complete(this.frm, this, count); } catch (e) { console.warn("[themate] form 360:", e); }
		return out;
	};
	/* another record: drop the panel so the shell is rebuilt for it */
	const reset = Dashboard.prototype.reset;
	Dashboard.prototype.reset = function () {
		const out = reset.apply(this, arguments);
		const el = (this.parent?.[0] || this.parent)?.querySelector?.(":scope > .tm-360");
		if (el && el.dataset.key !== `${this.frm.doctype}/${this.frm.docname}`) el.remove();
		return out;
	};
	Dashboard.prototype._tm_360 = true;
})();

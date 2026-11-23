/* The way from a workspace to its dashboards, and around them.
 *
 *  1. Strip and panel. Under a workspace's head, one link per Dashboard of
 *     its module (themate.api.get_workspace_dashboards: names and order).
 *     A Workspace Panel (themate/panels.py) states the dashboards, their
 *     order, the default and what the panel shows of each; the picked one
 *     (last picked, else the default) is marked, and the panel under the
 *     strip draws that content through InnoDash's summary, with Open
 *     dashboard and, for a module's pair, Management | Desk. Links that do not fit fold into "View all". The head gets chips:
 *     how many dashboards and shortcuts, and when the page was drawn.
 *  2. Prefetch. Hovering or focusing a link (on a pointer device, without
 *     Save-Data) asks for that dashboard's layout after a short pause, so the
 *     page opens on it; tabs.js takes it through dashboardLayout().
 *  3. Page nav. On /app/dashboard-view: back to the workspace it was opened
 *     from (else its module's), a Management | Desk switch when the module
 *     has both, and the module's other dashboards in a menu.
 *
 * Remembered: the last dashboard per workspace in the desk state
 * (core/store.js, follows the user); where a dashboard was opened from, for
 * this browser tab only (sessionStorage). Nothing about the figures. */
(function () {
	const frappe = window.frappe;
	if (!frappe) return;
	const esc = (s) => frappe.utils.escape_html(String(s ?? ""));
	const enabled = () => window.themate?.enabled?.() !== false;
	const ws = () => frappe.workspace;
	const route = () => frappe.get_route?.() || [];
	const ds = () => window.themate?.deskState;
	const ICON = { Management: "chart", Desk: "list" };
	const PREFETCH_DELAY = 150;
	const LAYOUT_TTL = 60 * 1000;

	/* ---- lists, one request per workspace visit -------------------------
	 * Never drawn from a copy kept in the browser: a dashboard whose role was
	 * taken away must not flash in the strip before the server says so. The
	 * answer is kept for this page's life only, and dropped on every route. */
	const lists = new Map();
	/* a request that fails is asked again (twice, spaced) rather than
	 * leaving the workspace with no strip until the next visit; null after
	 * that, which paints nothing and lets the next render ask once more */
	const ask = (w, tries = 2) => frappe.xcall("themate.api.get_workspace_dashboards", { workspace: w })
		.then((rows) => rows || [])
		.catch(() => (tries ? new Promise((r) => setTimeout(r, tries === 2 ? 400 : 1200)).then(() => ask(w, tries - 1)) : null));
	function dashboardsOf(w) {
		if (!lists.has(w)) {
			const promise = ask(w);
			lists.set(w, promise);
			promise.then((rows) => {
				if (rows !== null) return;
				setTimeout(() => { if (lists.get(w) === promise) { lists.delete(w); renderStrip(); } }, 5000);
			});
		}
		return lists.get(w);
	}

	/* Frappe asks for the user's Dashboard Settings on every workspace with a
	 * chart, and the panel and the dashboard page ask again beside it: one
	 * request serves the callers of the same moment.
	 * shortcut: a chart setting changed within these 10s is read stale once; drop the TTL if that shows. */
	const utils = frappe.dashboard_utils;
	if (utils?.get_dashboard_settings && !utils._tm_shared) {
		const original = utils.get_dashboard_settings;
		let hit = null;
		utils.get_dashboard_settings = function () {
			if (hit && Date.now() - hit.at < 10000) return hit.promise;
			const promise = original.apply(this, arguments);
			hit = { at: Date.now(), promise };
			promise.catch(() => { if (hit?.promise === promise) hit = null; });
			return promise;
		};
		utils._tm_shared = true;
	}

	/* ---- layouts, prefetched -------------------------------------------- */
	const layouts = new Map(); /* name -> { at, user, promise } */
	function dashboardLayout(name, { fresh } = {}) {
		const hit = layouts.get(name);
		if (!fresh && hit && hit.user === frappe.session.user && Date.now() - hit.at < LAYOUT_TTL) return hit.promise;
		const promise = frappe.xcall("themate.api.get_dashboard_layout", { name });
		layouts.set(name, { at: Date.now(), user: frappe.session.user, promise });
		promise.catch(() => layouts.delete(name));
		return promise;
	}
	const canPrefetch = () => window.matchMedia?.("(hover: hover) and (pointer: fine)").matches && !navigator.connection?.saveData;
	let prefetchTimer = null;
	function armPrefetch(e) {
		const link = e.target.closest?.("[data-tm-dash]");
		if (!link || !canPrefetch()) return;
		clearTimeout(prefetchTimer);
		prefetchTimer = setTimeout(() => dashboardLayout(link.dataset.tmDash).catch(() => {}), PREFETCH_DELAY);
	}
	const disarm = () => clearTimeout(prefetchTimer);

	/* ---- going to a dashboard ------------------------------------------- */
	const FROM = "tm-dash-from:";
	function cameFrom(name) {
		try { return JSON.parse(sessionStorage.getItem(FROM + name) || "null"); } catch (e) { return null; }
	}
	function open(name, from, e) {
		if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return; /* a new tab is the browser's */
		e?.preventDefault();
		if (from) {
			ds()?.set("workspaces", from.name, { dash: name });
			try { sessionStorage.setItem(FROM + name, JSON.stringify(from)); } catch (err) { /* back goes to the module */ }
		}
		frappe.set_route("dashboard-view", name);
	}
	const href = (name) => `/app/dashboard-view/${encodeURIComponent(name)}`;

	/* ---- 1. the strip --------------------------------------------------- */
	function strip(body) {
		let el = body.querySelector(":scope > .tm-ws-dashes");
		if (!el) {
			el = document.createElement("nav");
			el.className = "tm-ws-dashes";
			el.hidden = true;
			el.setAttribute("aria-label", __("Dashboards"));
			el.innerHTML = `
				<div class="tm-ws-dashes-head">
					<span class="tm-ws-dashes-icon" aria-hidden="true">${frappe.utils.icon("dashboard", "md")}</span>
					<span class="tm-ws-dashes-text"><strong>${__("Dashboards")}</strong><small></small></span>
				</div>
				<ul class="tm-ws-dashes-list"></ul>
				<div class="tm-ws-dashes-all dropdown" hidden>
					<button type="button" class="btn btn-link tm-ws-dashes-all-btn" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
						<span>${__("View all")}</span>${frappe.utils.icon("arrow-right", "sm")}
					</button>
					<div class="dropdown-menu dropdown-menu-right" role="menu"></div>
				</div>`;
			body.prepend(el);
			el.addEventListener("pointerover", armPrefetch);
			el.addEventListener("focusin", armPrefetch);
			el.addEventListener("pointerout", disarm);
			/* a pick shows that dashboard in the panel under the strip; a
			 * new-tab click still opens its page (the link's own href) */
			el.addEventListener("click", (e) => {
				const link = e.target.closest("[data-tm-dash]");
				if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
				e.preventDefault();
				e.stopPropagation(); /* Frappe's link handler on the document would route anyway */
				ds()?.set("workspaces", el._from.name, { dash: link.dataset.tmDash });
				renderStrip();
			});
			if (window.ResizeObserver) new ResizeObserver(() => fit(el)).observe(el);
		}
		return el;
	}

	/* `early`: the workspace prepare() is drawing, before Frappe has set its page */
	function renderStrip(early) {
		if (!enabled() || route()[0] !== "Workspaces") return;
		const name = ws()?._page?.name || early;
		const body = ws()?.body?.[0];
		if (!name || !body) return;
		const el = strip(body);
		const editing = ws().is_read_only === false;
		el._from = { name, route: location.pathname.replace(/^\/app\//, "") };
		const paint = (rows, final) => {
			if (el._from?.name !== name || !rows) return; /* left for another workspace, or not known yet */
			el.classList.remove("is-pending");
			const remembered = ds()?.get("workspaces", name)?.dash;
			/* nothing picked yet: the module's management dashboard, which has
			 * cards to show, before a plain Frappe one that has only its page */
			/* the person's last pick, else the panel's default, else the first */
			const last = rows.some((r) => r.name === remembered) ? remembered : (rows.find((r) => r.is_default) || rows.find((r) => r.kind === "Management") || rows[0])?.name;
			chips(rows);
			el.hidden = editing || !rows.length;
			if (final) panel(el, rows.find((r) => r.name === last), rows, editing);
			if (el.hidden) return;
			const key = rows.map((r) => r.name).join("|") + `#${last || ""}`;
			if (el._key === key) return fit(el);
			el._key = key;
			el.querySelector(".tm-ws-dashes-text small").textContent = remembered === last
				? __("Continue where you left off") : __("Open the numbers behind this area");
			/* what kind each one is, so a module's own pair reads apart from the
			 * dashboards ERPNext ships (Standard) */
			const tag = (r) => r.kind ? __(r.kind) : r.native ? __("Standard") : "";
			const item = (r, i) => `${i && r.native && !rows[i - 1].native ? '<li class="tm-ws-dash-sep" aria-hidden="true"></li>' : ""}<li><a class="tm-ws-dash${r.name === last ? " is-last" : ""}${r.native ? " is-native" : ""}" href="${href(r.name)}" data-tm-dash="${esc(r.name)}"${r.name === last ? ` aria-current="true" title="${esc(__("Last opened"))}"` : ""}>
					${frappe.utils.icon(ICON[r.kind] || "dashboard", "sm")}<span>${esc(r.label)}</span>${tag(r) ? `<small class="tm-ws-dash-kind">${esc(tag(r))}</small>` : ""}</a></li>`;
			el.querySelector(".tm-ws-dashes-list").innerHTML = rows.map(item).join("");
			el.querySelector(".dropdown-menu").innerHTML = rows.map((r) =>
				`<a class="dropdown-item" href="${href(r.name)}" data-tm-dash="${esc(r.name)}" role="menuitem">${esc(r.label)}${tag(r) ? ` <small class="text-muted">${esc(tag(r))}</small>` : ""}</a>`).join("");
			fit(el);
		};
		dashboardsOf(name).then((rows) => paint(rows, true));
	}

	/* ---- the panel: the picked dashboard's first cards ------------------- */
	/* the panel under the strip, made once with its listeners */
	function panelEl(strip, make = true) {
		let el = strip.nextElementSibling?.classList.contains("tm-ws-dash-panel") ? strip.nextElementSibling : null;
		if (el || !make) return el;
		el = document.createElement("section");
		el.className = "tm-ws-dash-panel";
		strip.after(el);
		el.addEventListener("pointerover", armPrefetch);
		el.addEventListener("focusin", armPrefetch);
		el.addEventListener("pointerout", disarm);
		el.addEventListener("click", (e) => {
			const go = e.target.closest("[data-tm-open]");
			if (go) return open(go.dataset.tmOpen, strip._from, e);
			const pick = e.target.closest("[data-tm-dash]");
			if (!pick || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
			e.preventDefault();
			e.stopPropagation();
			ds()?.set("workspaces", strip._from.name, { dash: pick.dataset.tmDash });
			renderStrip();
		});
		return el;
	}

	const SKELETON = '<div class="tm-skeleton tm-skeleton-dashboard" aria-busy="true"><div class="tm-skeleton-row"><span class="tm-skeleton-card"></span><span class="tm-skeleton-card"></span><span class="tm-skeleton-card"></span></div></div>';

	/* The shell first. Called the moment Frappe starts drawing a workspace
	 * (tabs.js wraps show_page), before its blocks, its data or the editor:
	 * the list is asked now, and a workspace that has a Workspace Panel
	 * (boot.themate.panels) gets its strip and panel at once, as skeletons,
	 * which the data then fills. Nothing here waits on the editor. */
	function prepare(name) {
		if (!enabled() || !name) return;
		/* the moment the list is in, the picked dashboard's layout and numbers
		 * are asked too, without waiting for Frappe to finish the page */
		dashboardsOf(name).then((rows) => {
			const remembered = ds()?.get("workspaces", name)?.dash;
			const row = rows && (rows.find((r) => r.name === remembered) || rows.find((r) => r.is_default) || rows.find((r) => r.kind === "Management") || rows[0]);
			if (!row) return;
			renderStrip(name);
			dashboardLayout(row.name).catch(() => {});
			const seg = ds()?.get("dashboards", row.name)?.segments;
			window.themate?.dashboardSummary?.prefetch?.(row.name, seg && Object.keys(seg).length ? seg : null, row.panel || null);
		});
		const body = ws()?.body?.[0];
		if (!body || !(frappe.boot?.themate?.panels || []).includes(name)) return;
		const el = strip(body);
		if (el._from?.name === name && !el.hidden && !el.classList.contains("is-pending")) return; /* drawn for it already */
		el._from = { name, route: location.pathname.replace(/^\/app\//, "") };
		el._key = null;
		el.hidden = false;
		el.classList.remove("is-pending");
		el.querySelector(".tm-ws-dashes-text small").textContent = "";
		el.querySelector(".tm-ws-dashes-list").innerHTML = '<li><span class="tm-skeleton-line tm-ws-dash-skel"></span></li>'.repeat(4);
		el.querySelector(".tm-ws-dashes-all").hidden = true;
		const p = panelEl(el);
		p.hidden = false;
		p._view = null;
		p._skeleton = true;
		p.classList.remove("is-pending");
		p.innerHTML = `<div class="tm-ws-dashboard tm-ws-dash-body">${SKELETON}</div>`;
	}

	function panel(strip, row, rows, editing) {
		hideBlocks(row && !editing ? row.panel?.hide : null);
		let el = panelEl(strip, !!row && !editing);
		if (!row || editing) {
			if (el) { el.hidden = true; el._view = null; }
			return;
		}
		el.hidden = false;
		if (el._view === row.name) return;
		el._view = row.name;
		const management = rows.find((r) => r.kind === "Management");
		const desk = rows.find((r) => r.kind === "Desk");
		const pair = management && desk && [management.name, desk.name].includes(row.name);
		const title = /dashboard/i.test(row.label) ? row.label : __("{0} Dashboard", [row.label]);
		/* The new panel is built beside the one on screen. On the first draw
		 * its skeleton shows at once; after that the previous panel stays
		 * (faded) until the new one is complete, then they swap in one step:
		 * one change on screen per switch, not shrink, skeleton, grow. */
		const shell = document.createElement("div");
		shell.innerHTML = `
			<header class="tm-ws-dash-head">
				<span class="tm-ws-dash-tile" aria-hidden="true">${frappe.utils.icon(ICON[row.kind] || "dashboard", "md")}</span>
				<span class="tm-ws-dash-title"><strong>${esc(title)}</strong><small>${esc([row.module ? __(row.module) : "", row.kind ? __(row.kind) : row.native ? __("Standard") : ""].filter(Boolean).join(" · "))}</small></span>
				<span class="tm-ws-dash-actions">
					<a class="btn btn-link btn-sm tm-ws-dash-open" href="${href(row.name)}" data-tm-open="${esc(row.name)}">${__("Open dashboard")}${frappe.utils.icon("arrow-right", "sm")}</a>
					${pair ? `<span class="tm-dash-switch" role="group" aria-label="${esc(__("Dashboard"))}">${[management, desk].map((r) =>
						`<a class="btn btn-sm${r.name === row.name ? " is-active" : ""}" href="${href(r.name)}" data-tm-dash="${esc(r.name)}"${r.name === row.name ? ' aria-current="true"' : ""}>${esc(__(r.kind))}</a>`).join("")}</span>` : ""}
				</span>
			</header>
			<div class="tm-ws-dashboard tm-ws-dash-body">${SKELETON}</div>`;
		const [head, body] = shell.children;
		const name = row.name;
		if (!el.childElementCount || el._skeleton) {
			el._skeleton = false;
			el.replaceChildren(head, body);
			el.classList.remove("is-pending");
		} else {
			el.classList.add("is-pending");
		}
		const show = (content) => {
			if (el._view !== name) return;
			if (typeof content === "string") body.innerHTML = content;
			else body.replaceChildren(...content.childNodes);
			if (head.parentNode !== el) el.replaceChildren(head, body);
			el.classList.remove("is-pending");
		};
		/* its numbers are asked now, beside the layout, not after it */
		const seg = ds()?.get("dashboards", name)?.segments;
		window.themate?.dashboardSummary?.prefetch?.(name, seg && Object.keys(seg).length ? seg : null, row.panel || null);
		Promise.all([frappe.dashboard_utils?.get_dashboard_settings?.() || null, dashboardLayout(name)])
			.then(([settings, layout]) => {
				if (el._view !== name) return; /* picked another one meanwhile */
				const summary = !!window.themate?.dashboardSummary;
				if ((!layout?.items?.length && !summary) || !window.themate?.renderDashboard) {
					return show(`<p class="tm-ws-dash-note">${__("Its charts are on the dashboard's own page.")}</p>`);
				}
				/* drawn off the page, shown once its numbers are in. What the
				 * Workspace Panel states for this dashboard; without one InnoDash picks. */
				const next = document.createElement("div");
				const drawn = window.themate.renderDashboard(next, layout || {}, settings?.chart_config ? JSON.parse(settings.chart_config) : {}, name, { spec: row.panel || null });
				Promise.resolve(drawn).catch(() => {}).then(() => show(next));
			})
			.catch(() => show(`<p class="tm-ws-dash-note">${__("Could not load. Try refreshing.")}</p>`));
	}

	/* The workspace's own chart blocks that the panel draws instead (the
	 * Workspace Panel names them: panel.hide, rows of Workspace.charts) are
	 * hidden by a rule naming them, not by marking the blocks: the browser
	 * applies it whenever such a block appears, so a block that lands after
	 * the panel is hidden too, with no render to wait for. */
	function hideBlocks(names) {
		let style = document.getElementById("tm-panel-hide");
		const css = (names || []).map((n) => `.layout-main-section:not(.edit-mode) .codex-editor .ce-block:has(.widget[data-widget-name="${CSS.escape(n)}"]){display:none}`).join("");
		if (!css) return style?.remove();
		if (!style) {
			style = document.createElement("style");
			style.id = "tm-panel-hide";
			document.head.appendChild(style);
		}
		if (style.textContent !== css) style.textContent = css;
	}

	/* "Configure dashboards" in the workspace's ⋯ menu, for whoever may edit
	 * a Workspace Panel: this workspace's, or a new one for it */
	function configureItem() {
		const page = ws()?.page;
		if (!page?.add_menu_item || page._tm_panel_item || !frappe.model.can_write("Workspace Panel")) return;
		page._tm_panel_item = page.add_menu_item(__("Configure dashboards"), async () => {
			const name = ws()?._page?.name;
			if (!name) return;
			if (await frappe.db.exists("Workspace Panel", name)) frappe.set_route("Form", "Workspace Panel", name);
			else frappe.new_doc("Workspace Panel", { workspace: name });
		}, true);
	}

	/* ---- chips in the workspace head: what this workspace holds ---------- */
	function chips(rows) {
		/* under the title and its sub-title, in the title's own column */
		const area = ws()?.page?.$title_area?.[0]?.firstElementChild;
		const name = ws()?._page?.name;
		if (!area || !name) return;
		let el = area.querySelector(".tm-ws-chips");
		if (!el) {
			el = document.createElement("div");
			el.className = "tm-ws-chips";
			area.appendChild(el);
		}
		if (el.dataset.ws !== name) {
			el.dataset.ws = name;
			el.dataset.at = frappe.datetime.now_datetime();
		}
		const shortcuts = ws()?.body?.[0]?.querySelectorAll(".shortcut-widget-box").length || 0;
		const chip = (icon, text) => `<span class="tm-ws-chip">${frappe.utils.icon(icon, "sm")}<span>${esc(text)}</span></span>`;
		const html = [
			rows.length ? chip("dashboard", rows.length === 1 ? __("1 dashboard") : __("{0} dashboards", [rows.length])) : "",
			shortcuts ? chip("shortcut", shortcuts === 1 ? __("1 shortcut") : __("{0} shortcuts", [shortcuts])) : "",
			/* the shortcuts' counts were read when the page was drawn */
			chip("clock", __("Updated {0}", [frappe.datetime.prettyDate(el.dataset.at)])),
		].join("");
		if (el.innerHTML !== html) el.innerHTML = html;
	}

	/* the links that do not fit wait in "View all" */
	function fit(el) {
		if (el.hidden) return;
		const list = el.querySelector(".tm-ws-dashes-list");
		const items = [...list.children].filter((li) => !li.classList.contains("tm-ws-dash-sep"));
		[...list.children].forEach((li) => { li.hidden = false; });
		const box = list.getBoundingClientRect();
		let hidden = 0;
		items.forEach((li) => {
			const r = li.getBoundingClientRect();
			if (r.right > box.right + 1 || r.left < box.left - 1) { li.hidden = true; hidden += 1; }
		});
		/* the hairline before the standard ones goes with them */
		list.querySelectorAll(".tm-ws-dash-sep").forEach((sep) => { sep.hidden = !sep.nextElementSibling || sep.nextElementSibling.hidden; });
		el.querySelector(".tm-ws-dashes-all").hidden = !hidden;
	}

	/* ---- 3. page nav ---------------------------------------------------- */
	async function pageNav(page, name, layout) {
		const actions = page?.page_actions?.[0];
		if (!actions) return;
		page.wrapper?.[0]?.querySelectorAll(".tm-dash-nav").forEach((n) => n.remove());
		/* a short line under the title, as the reference: the module, then the
		 * dashboard's kind once the list says it (the intro stays on the page) */
		const sub = (kind) => page.set_title_sub?.([layout.module ? __(layout.module) : "", kind ? __(kind) : ""].filter(Boolean).join(" · "));
		sub();
		const from = cameFrom(name);
		const home = from?.name || layout.workspace;
		const nav = document.createElement("div");
		nav.className = "tm-dash-nav";
		place(nav, page);
		if (home) {
			const back = document.createElement("a");
			back.className = "btn btn-link btn-sm tm-dash-back";
			back.href = from?.route ? `/app/${from.route}` : `/app/${frappe.router.slug(home)}`;
			back.innerHTML = `${frappe.utils.icon("arrow-left", "sm")}<span>${__("Back to {0}", [__(home)])}</span>`;
			back.addEventListener("click", (e) => {
				if (e.metaKey || e.ctrlKey || e.shiftKey) return;
				e.preventDefault();
				frappe.set_route(from?.route || frappe.router.slug(home));
			});
			nav.appendChild(back);
		}
		if (!home) return;
		const rows = await dashboardsOf(home).catch(() => []);
		if (!nav.isConnected) return;
		const keep = from || { name: home, route: frappe.router.slug(home) };
		if (from) ds()?.set("workspaces", home, { dash: name });
		sub(rows.find((r) => r.name === name)?.kind);
		const management = rows.find((r) => r.kind === "Management");
		const desk = rows.find((r) => r.kind === "Desk");
		if (management && desk && (name === management.name || name === desk.name)) {
			const sw = document.createElement("div");
			sw.className = "tm-dash-switch";
			sw.setAttribute("role", "group");
			sw.setAttribute("aria-label", __("Dashboard"));
			sw.innerHTML = [management, desk].map((r) =>
				`<a class="btn btn-sm${r.name === name ? " is-active" : ""}" href="${href(r.name)}" data-tm-dash="${esc(r.name)}"${r.name === name ? ' aria-current="page"' : ""} title="${esc(r.label)}">${esc(__(r.kind))}</a>`).join("");
			nav.appendChild(sw);
		}
		const others = rows.filter((r) => r.name !== name);
		if (others.length) {
			const more = document.createElement("div");
			more.className = "dropdown tm-dash-more";
			more.innerHTML = `<button type="button" class="btn btn-default btn-sm" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">${frappe.utils.icon("dashboard", "sm")}<span>${__("Dashboards")}</span>${frappe.utils.icon("down", "xs")}</button>
				<div class="dropdown-menu dropdown-menu-right" role="menu">${others.map((r) =>
					`<a class="dropdown-item" href="${href(r.name)}" data-tm-dash="${esc(r.name)}" role="menuitem">${esc(r.label)}${r.kind ? ` <small class="text-muted">${esc(__(r.kind))}</small>` : ""}</a>`).join("")}</div>`;
			nav.appendChild(more);
		}
		nav.addEventListener("pointerover", armPrefetch);
		nav.addEventListener("focusin", armPrefetch);
		nav.addEventListener("pointerout", disarm);
		nav.addEventListener("click", (e) => {
			const link = e.target.closest("[data-tm-dash]");
			if (!link) return;
			/* the switch carries the segment across; the target keeps what it declares */
			try { sessionStorage.setItem("tm-dash-carry", JSON.stringify(ds()?.get("dashboards", name)?.segments || {})); } catch (err) { /* nothing carried */ }
			open(link.dataset.tmDash, keep, e);
		});
	}

	/* Beside the title where there is room; on a phone the head has none, so
	 * the bar is a row of its own above the cards (and moves on a resize). */
	const narrow = window.matchMedia?.("(max-width: 767px)");
	function place(nav, page) {
		const row = page.wrapper?.[0]?.querySelector(".page-content");
		const actions = page.page_actions?.[0];
		const small = !!narrow?.matches && !!row;
		nav.classList.toggle("is-row", small);
		if (small) row.prepend(nav);
		else actions?.prepend(nav);
	}
	narrow?.addEventListener?.("change", () => {
		const page = frappe.dashboard?.page;
		const nav = page?.wrapper?.[0]?.querySelector(".tm-dash-nav");
		if (nav) place(nav, page);
	});

	/* segments carried over by the switch, for a dashboard with none of its own */
	function carried() {
		try {
			const raw = sessionStorage.getItem("tm-dash-carry");
			sessionStorage.removeItem("tm-dash-carry");
			return raw ? JSON.parse(raw) : null;
		} catch (e) { return null; }
	}

	let lastRoute = null;
	function onRoute() {
		/* page-change and the router both fire, and Frappe also fires for a
		 * route that did not change: only a real move counts */
		const now = frappe.get_route_str?.() || "";
		if (now === lastRoute) return;
		lastRoute = now;
		if (route()[0] !== "Workspaces") hideBlocks(null);
		lists.clear(); /* asked again on the next visit: permissions may have moved */
		disarm();
		/* coming back draws the panel again; until then the previous
		 * workspace's strip and panel fade instead of standing for this one */
		document.querySelectorAll(".tm-ws-dash-panel").forEach((p) => { p._view = null; p.classList.add("is-pending"); });
		document.querySelectorAll(".tm-ws-dashes").forEach((s) => s.classList.add("is-pending"));
		if (route()[0] === "Workspaces") setTimeout(renderStrip, 0);
	}
	window.jQuery?.(document).on("page-change", onRoute);
	frappe.router?.on?.("change", onRoute);

	window.themate = window.themate || {};
	window.themate.dashboards = { renderStrip, prepare, dashboardLayout, pageNav, carried, configureItem, list: dashboardsOf };
})();

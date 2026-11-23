/* Workspace blocks, the guided tour, and real dashboards.
 *
 * Native: frappe/public/js/frappe/views/workspace/workspace.js renders a
 * workspace as editor.js blocks in the order the workspace stores them, and
 * widgets/onboarding_widget.js renders the "Let's set up…" card inline as
 * one of those blocks.
 *
 * After every render this module
 *  1. tags each .ce-block with data-tm-kind / data-tm-group so the CSS in
 *     components/_workspace.scss can order and filter by type. Groups:
 *     dashboard (number cards, charts, quick lists, custom blocks) and
 *     records (shortcuts, link groups). A header or paragraph belongs to
 *     the block that follows it;
 *  2. takes the set-up card out of the page: a "Start Tour" button in the
 *     page head opens it in a dialog. The widget's own node is moved into
 *     the dialog and back (never cloned, never jQuery-emptied), so every
 *     step handler Frappe attached keeps working;
 *  3. draws a real Dashboard (/app/dashboard-view/<name>) from its Themate
 *     Layout — intro, segments, insights, headed sections — when it has
 *     one; otherwise Frappe's own view stays. The workspace itself shows
 *     its cards, charts, shortcuts and links as Frappe renders them;
 *  4. workspace actions: Frappe's New / Edit footer buttons are hidden
 *     (_workspace.scss). A private workspace (the user's own) gets an Edit
 *     button in the page head plus Rename / Delete in the page menu; a
 *     public (module) workspace gets none of these — a Workspace Manager
 *     still finds "Edit Workspace" in the page menu. New private
 *     workspaces are created from the sidebar's "+" (modern_sidebar.js)
 *     through window.themate.newWorkspace(), which reuses Frappe's own
 *     New Workspace dialog and editor.
 * Edit mode (.layout-main-section.edit-mode) switches all of it off so the
 * blocks can be arranged the native way. */
(function () {
	const frappe = window.frappe;
	if (!frappe || !window.jQuery) return;
	const $ = window.jQuery;

	/* [kind, group, selector] — first match wins. */
	const KINDS = [
		["smart", "dashboard", ".tm-widget-box"],
		["number", "dashboard", ".number-widget-box"],
		["chart", "dashboard", ".dashboard-widget-box, .chart-widget-box"],
		["quick-list", "dashboard", ".quick-list-widget-box"],
		["custom", "dashboard", ".custom-block-widget-box"],
		["onboarding", "tour", ".onboarding-widget-box"],
		["shortcut", "records", ".shortcut-widget-box"],
		["links", "records", ".links-widget-box"],
		["spacer", "none", ".widget.spacer"],
		["header", null, ".ce-header"],
		["paragraph", null, ".ce-paragraph"],
	];
	const NO_EDIT = { allow_sorting: false, allow_create: false, allow_delete: false, allow_hiding: false, allow_edit: false };

	/* block/widget: the current page's set-up card; moved: the card that is
	 * in the dialog right now (may belong to a page already left). */
	const state = { block: null, widget: null, moved: null, dialog: null, timer: null, observer: null };
	/* the dashboard on screen at /app/dashboard-view */
	const dash = { view: null };

	const enabled = () => window.themate?.enabled?.() !== false;
	const ws = () => frappe.workspace;
	const editing = () => !!ws() && ws().is_read_only === false;
	const onWorkspace = () => (frappe.get_route?.() || [])[0] === "Workspaces";
	/* ---- 1. classify ---------------------------------------------------- */
	function classify(redactor) {
		const info = Array.from(redactor.children)
			.filter((b) => b.classList.contains("ce-block"))
			.map((el) => {
				/* the set-up card is away in the dialog: keep its kind */
				if (el === state.moved?.block && el.dataset.tmKind === "onboarding") {
					return { el, kind: "onboarding", group: "tour" };
				}
				const hit = KINDS.find(([, , sel]) => el.querySelector(sel));
				return { el, kind: hit ? hit[0] : "other", group: hit ? hit[1] : "records" };
			});

		/* headers and paragraphs travel with the next real block */
		for (let i = info.length - 1; i >= 0; i--) {
			if (info[i].group !== null) continue;
			let j = i + 1;
			while (j < info.length && (info[j].group === "none" || info[j].group === "tour")) j++;
			info[i].group = j < info.length ? info[j].group : "records";
		}

		info.forEach((x) => {
			x.el.dataset.tmKind = x.kind;
			x.el.dataset.tmGroup = x.group;
		});
		return info;
	}

	/* ---- 2. tabs ------------------------------------------------------- */
	function tools() {
		const actions = ws()?.page?.page_actions?.[0];
		if (!actions) return null;
		let el = actions.querySelector(".tm-ws-tools");
		if (!el) {
			el = document.createElement("div");
			el.className = "tm-ws-tools";
			el.innerHTML = `<button type="button" class="btn btn-default btn-sm tm-ws-tour" hidden></button>
				<button type="button" class="btn btn-default btn-sm tm-ws-edit" hidden>${frappe.utils.icon("edit", "sm")}<span>${__("Edit")}</span></button>`;
			actions.prepend(el);
			el.querySelector(".tm-ws-edit").addEventListener("click", () => {
				/* Frappe's own handler on the (hidden) footer button */
				ws()?.body?.find(".btn-edit-workspace").trigger("click");
			});
			el.querySelector(".tm-ws-tour").addEventListener("click", openTour);
		}
		return el;
	}

	/* ---- 4. real dashboards -------------------------------------------- */
	/* dashboard_view.js (core/page/dashboard_view) keeps its class private
	 * and assigns `frappe.dashboard = new Dashboard(wrapper)` before the
	 * page's first show(), so the class is patched at that assignment. */
	let current = frappe.dashboard;
	Object.defineProperty(frappe, "dashboard", {
		configurable: true,
		get: () => current,
		set(v) {
			current = v;
			patchDashboard(v?.constructor);
		},
	});
	patchDashboard(current?.constructor);

	function patchDashboard(Dash) {
		const proto = Dash?.prototype;
		if (!proto || proto._tm_layout || typeof proto.refresh !== "function") return;
		const refresh = proto.refresh;
		proto.refresh = function () {
			const native = () => refresh.apply(this, arguments);
			const el = this.container?.[0];
			const name = this.dashboard_name;
			if (!enabled() || !el) return native();
			el.classList.add("tm-ws-dashboard");
			dash.view = name;
			el.innerHTML = dashSkeleton();
			const layoutOf = window.themate?.dashboards?.dashboardLayout || ((n) => frappe.xcall("themate.api.get_dashboard_layout", { name: n }));
			Promise.all([
				frappe.dashboard_utils.get_dashboard_settings(),
				layoutOf(name), /* prefetched when its link was hovered (dashboards.js) */
			])
				.then(([settings, layout]) => {
					if (dash.view !== name) return; /* switched while loading */
					el.innerHTML = "";
					window.themate?.dashboards?.pageNav(this.page, name, layout || {});
					if (!layout?.items?.length) {
						/* a Themate Layout with nothing this user may read: say so, rather
						 * than Frappe's "No Permitted Charts" dialog over an empty page */
						if (layout?.has_layout) return void (el.innerHTML = `<div class="tm-ws-dashboard-state">${__("Nothing on this dashboard is available to you yet.")}</div>`);
						return native();
					}
					renderLayout(el, layout, settings?.chart_config ? JSON.parse(settings.chart_config) : {}, name);
				})
				.catch(() => {
					if (dash.view !== name) return;
					el.innerHTML = "";
					native();
				});
			/* ?tv=1 (or a number of seconds) on the URL: straight into TV mode */
			if (frappe.utils.get_url_arg("tv") && !tv.on) setTimeout(startTv, 300);
		};
		const setDropdown = proto.set_dropdown;
		proto.set_dropdown = function () {
			const out = setDropdown.apply(this, arguments);
			this.page.add_menu_item(__("TV mode"), startTv);
			return out;
		};
		proto._tm_layout = true;
	}

	/* A narrated dashboard (Dashboard > Themate Layout): an intro, then
	 * headings with a note and the cards under them on a 12-column grid.
	 * Each card is the same Frappe widget class the groups use, made one at
	 * a time into its own cell so headings can sit between them; item types
	 * other apps add draw themselves through window.themate.dashboardItems. */
	const SPAN = { Third: 4, Half: 6, "Two Thirds": 8, Full: 12 };
	function renderLayout(el, layout, config, name, opts = {}) {
		const esc = frappe.utils.escape_html;
		if (layout.intro && !opts.preview) {
			const intro = document.createElement("p");
			intro.className = "tm-dash-intro";
			intro.textContent = __(layout.intro);
			el.appendChild(intro);
		}
		/* the segment: remembered per dashboard in the desk state; a personal
		 * dashboard (mine_locked) is always the viewer's own records */
		/* only the dimensions this dashboard declares: a key without its picker
		 * would narrow every card with nothing on screen saying so. One carried
		 * over by the Management | Desk switch fills a dashboard with none. */
		const declared = new Set((layout.segments || []).map((s) => s.field).concat(layout.mine ? ["mine"] : []));
		const stored = window.themate?.deskState?.get("dashboards", name)?.segments;
		const carried = window.themate?.dashboards?.carried();
		const source = stored && Object.keys(stored).length ? stored : carried || {};
		const segments = Object.fromEntries(Object.entries(source).filter(([k]) => declared.has(k)));
		if (layout.mine_locked) segments.mine = 1;
		const widgets = [];
		let live = segments;
		if ((layout.segments && layout.segments.length) || layout.mine) {
			el.appendChild(segmentBar(layout, segments, name, (next) => {
				live = next;
				window.themate?.deskState?.set("dashboards", name, { segments: next });
				el.dispatchEvent(new CustomEvent("tm:segments", { detail: next }));
				widgets.forEach((w) => {
					try {
						w.tm_segments = next;
						if (typeof w.set_segments === "function") w.set_segments(next);
						else if (typeof w.fetch_and_update_chart === "function") w.fetch_and_update_chart();
					} catch (e) { /* one card, not the page */ }
				});
			}));
		}
		/* insights: the hero sentence and the list, fetched after the cards
		 * (they read the same cached numbers) and again on a segment change */
		const insightsBox = document.createElement("div");
		insightsBox.className = "tm-dash-insights";
		insightsBox.hidden = true;
		el.appendChild(insightsBox);
		const loadInsights = (seg) => {
			if (opts.preview) return; /* the workspace panel shows cards only */
			frappe.xcall("themate.api.get_dashboard_insights", { name, segments: seg && Object.keys(seg).length ? seg : null })
				.then((items) => { if (dash.view === name) renderInsights(insightsBox, items || [], el); })
				.catch(() => {});
		};
		setTimeout(() => loadInsights(segments), 800);
		el.addEventListener("tm:segments", (e) => loadInsights(e.detail));
		const grid = document.createElement("div");
		grid.className = "tm-dash-grid";
		el.appendChild(grid);
		let section = 0;
		(opts.preview ? previewItems(layout.items) : layout.items).forEach((item) => {
			if (item.item_type === "Heading") {
				section += 1;
				const h = document.createElement("div");
				h.className = "tm-dash-heading";
				h.innerHTML = `<h3><span class="tm-dash-heading-n" aria-hidden="true">${section}</span>${esc(__(item.heading))}</h3>${item.note ? `<p>${esc(__(item.note))}</p>` : ""}`;
				grid.appendChild(h);
				return;
			}
			if (!["Number Card", "Chart"].includes(item.item_type) && !window.themate?.dashboardItems?.[item.item_type]) return;
			const cell = document.createElement("div");
			cell.className = `tm-dash-cell tm-dash-${item.item_type.toLowerCase().replace(" ", "-")}`;
			cell.dataset.w = SPAN[item.width] ? item.width : "Third";
			/* the name an insight jumps to, before the card exists */
			cell.dataset.widget = item.widget || item.chart || item.number_card || "";
			cell._tmBuild = () => build(cell, item);
			grid.appendChild(cell);
			lazy.observe(cell);
		});

		/* Built when near the screen: a card below the fold costs nothing until
		 * it is scrolled to, and the first screen's cards ask in one batch. */
		function build(cell, item) {
			if (cell._tmBuilt) return;
			cell._tmBuilt = true;
			cell.classList.add("is-built");
			lazy.unobserve(cell);
			const $cell = $(cell);
			try {
				let made = null;
				if (item.item_type === "Number Card") {
					made = new frappe.widget.widget_factory.number_card({ container: $cell, widget_type: "number_card", name: item.number_card, options: NO_EDIT });
				} else if (item.item_type === "Chart") {
					made = new frappe.widget.widget_factory.chart({
						container: $cell, widget_type: "chart", name: item.chart, chart_name: item.chart, label: item.chart,
						chart_settings: config[item.chart] || {}, width: item.width === "Full" || item.width === "Two Thirds" ? "Full" : "Half", options: NO_EDIT,
						tm_segments: live,
					});
				} else {
					/* an item type another app added to the layout table (InnoDash's
					 * "Widget"): window.themate.dashboardItems[type]($cell, item, config, segments) */
					made = window.themate.dashboardItems[item.item_type]($cell, item, config, live);
				}
				if (made) widgets.push(made);
			} catch (e) {
				console.warn("[themate] dashboard item failed:", item, e);
				cell.remove();
			}
		}
	}

	/* The workspace panel's share of a dashboard: its first section, without
	 * the heading, at most six cards, so a workspace never computes a whole
	 * dashboard. */
	const PREVIEW_CARDS = 6;
	function previewItems(items) {
		const out = [];
		for (const item of items) {
			if (item.item_type === "Heading") {
				if (out.length) break;
				continue;
			}
			out.push(item);
			if (out.length === PREVIEW_CARDS) break;
		}
		return out;
	}

	/* one observer for every dashboard cell; without IntersectionObserver
	 * every card is built at once, as before */
	const lazy = window.IntersectionObserver
		? new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && e.target._tmBuild?.()), { rootMargin: "400px 0px" })
		: { observe: (cell) => cell._tmBuild(), unobserve() {} };
	const buildAll = (root) => root?.querySelectorAll(".tm-dash-cell").forEach((c) => c._tmBuild?.());

	/* Insights: the first (most severe) as the hero line, the rest as a list;
	 * each names its card and scrolls to it. */
	function renderInsights(box, items, el) {
		const esc = frappe.utils.escape_html;
		const thumbs = (i) => i.feedback ? `<span class="tm-dash-votes"><button type="button" class="tm-dash-vote" data-vote="1" title="${__("Useful")}">${frappe.utils.icon("like", "xs")}</button><button type="button" class="tm-dash-vote" data-vote="-1" title="${__("Not useful")}">${frappe.utils.icon("dislike", "xs")}</button></span>` : "";
		if (!items.length) { box.hidden = true; box.innerHTML = ""; return; }
		const icon = { bad: "alert-triangle", warn: "alert-circle", good: "check", info: "help" };
		const [hero, ...rest] = items;
		box.innerHTML = `
			<div class="tm-dash-hero is-${esc(hero.severity)}" ${hero.widget ? `data-widget="${esc(hero.widget)}" role="button" tabindex="0"` : ""}>
				<span class="tm-dash-hero-icon">${frappe.utils.icon(icon[hero.severity] || "help", "sm")}</span>
				<span class="tm-dash-hero-text">${esc(hero.text)}</span>
				${hero.widget ? `<span class="tm-dash-hero-go">${frappe.utils.icon("arrow-up-right", "xs")}</span>` : ""}
			</div>
			${rest.length ? `<ul class="tm-dash-insight-list">${rest.map((i, n) => `<li class="is-${esc(i.severity)}" data-n="${n + 1}" ${i.widget ? `data-widget="${esc(i.widget)}" role="button" tabindex="0"` : ""}><i></i><span>${esc(i.text)}</span>${thumbs(i)}</li>`).join("")}</ul>` : ""}`;
		box.querySelector(".tm-dash-hero")?.insertAdjacentHTML("beforeend", thumbs(hero));
		box.hidden = false;
		/* thumbs: the owning app records the vote (item.feedback names its method) */
		box.addEventListener("click", (e) => {
			const t = e.target.closest(".tm-dash-vote");
			if (!t) return;
			e.stopImmediatePropagation(); /* a vote is not a jump to the card */
			const holder = t.closest("[data-n], .tm-dash-hero");
			const item = holder.classList.contains("tm-dash-hero") ? hero : rest[Number(holder.dataset.n) - 1];
			if (!item?.feedback) return;
			frappe.xcall(item.feedback, { dashboard: item.dashboard, widget: item.widget, rule: item.rule, vote: t.dataset.vote, text: item.text })
				.then((r) => {
					holder.querySelector(".tm-dash-votes").innerHTML = `<small>${r?.muted ? __("Muted for you") : __("Thanks — noted")}</small>`;
					if (r?.muted) holder.classList.add("is-muted");
				})
				.catch(() => {});
		});
		const jump = (target) => {
			const name = target?.dataset.widget;
			if (!name) return;
			const cell = el.querySelector(`.tm-dash-cell[data-widget="${CSS.escape(name)}"]`);
			cell?._tmBuild?.(); /* not scrolled to yet */
			const card = el.querySelector(`.widget[data-widget-name="${CSS.escape(name)}"]`) || cell;
			if (!card) return;
			card.scrollIntoView({ behavior: "smooth", block: "center" });
			card.classList.add("tm-dash-lit");
			setTimeout(() => card.classList.remove("tm-dash-lit"), 1600);
		};
		box.addEventListener("click", (e) => jump(e.target.closest("[data-widget]")));
		box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jump(e.target.closest("[data-widget]")); } });
	}

	/* The segment bar: one Link picker per dimension the dashboard declares
	 * (company, territory, warehouse…) and a "Mine" switch; a change reloads
	 * every card through the segment. Frappe's own Link control, so the
	 * pickers search and validate like a form field. */
	function segmentBar(layout, segments, name, onChange) {
		const bar = document.createElement("div");
		bar.className = "tm-dash-segments";
		bar.innerHTML = `<span class="tm-dash-segments-label">${frappe.utils.icon("filter", "xs")}${__("Segment")}</span><div class="tm-dash-segments-fields"></div>`;
		const fields = bar.querySelector(".tm-dash-segments-fields");
		const clear = document.createElement("button");
		clear.type = "button";
		clear.className = "btn btn-sm tm-dash-segments-clear";
		clear.textContent = __("Clear");
		const chosen = () => Object.keys(segments).filter((k) => !(layout.mine_locked && k === "mine")).length;
		clear.hidden = !chosen();
		const emit = () => {
			clear.hidden = !chosen();
			onChange(Object.assign({}, segments));
		};
		(layout.segments || []).forEach((seg) => {
			const holder = document.createElement("div");
			holder.className = "tm-dash-segment";
			fields.appendChild(holder);
			const control = frappe.ui.form.make_control({
				parent: holder,
				render_input: true,
				only_input: true,
				df: {
					fieldtype: "Link", fieldname: seg.field, options: seg.doctype, label: __(seg.label || seg.field),
					placeholder: __(seg.label || seg.field),
					onchange() {
						const value = control.get_value();
						if (value) segments[seg.field] = value; else delete segments[seg.field];
						holder.classList.toggle("is-set", !!value);
						emit();
					},
				},
			});
			control.$input?.attr("aria-label", __(seg.label || seg.field));
			if (segments[seg.field]) {
				control.set_value(segments[seg.field]);
				holder.classList.add("is-set");
			}
		});
		if (layout.mine_locked) {
			const chip = document.createElement("span");
			chip.className = "tm-dash-mine is-locked";
			chip.innerHTML = `${frappe.utils.icon("user", "xs")}<span>${__("Only yours")}</span>`;
			chip.title = __("Only the records you created or are assigned to");
			fields.appendChild(chip);
		} else if (layout.mine) {
			const mine = document.createElement("button");
			mine.type = "button";
			mine.className = "btn btn-sm tm-dash-mine";
			mine.setAttribute("aria-pressed", String(!!segments.mine));
			mine.innerHTML = `${frappe.utils.icon("user", "xs")}<span>${__("Mine")}</span>`;
			mine.title = __("Only the records you created or are assigned to");
			mine.addEventListener("click", () => {
				if (segments.mine) delete segments.mine; else segments.mine = 1;
				mine.setAttribute("aria-pressed", String(!!segments.mine));
				emit();
			});
			fields.appendChild(mine);
		}
		clear.addEventListener("click", () => {
			Object.keys(segments).forEach((k) => { if (!(layout.mine_locked && k === "mine")) delete segments[k]; });
			bar.querySelectorAll(".tm-dash-segment").forEach((h) => h.classList.remove("is-set"));
			bar.querySelectorAll(".tm-dash-segment input").forEach((i) => { i.value = ""; });
			bar.querySelector(".tm-dash-mine")?.setAttribute("aria-pressed", "false");
			emit();
		});
		fields.appendChild(clear);
		return bar;
	}

	/* ---- 3. tour ------------------------------------------------------- */
	function currentWidget(info) {
		const onb = info.find((x) => x.kind === "onboarding");
		if (!onb) return { block: null, widget: null };
		let widget = onb.el.querySelector(".onboarding-widget-box");
		if (!widget && onb.el === state.moved?.block && state.moved.widget.isConnected) widget = state.moved.widget;
		return { block: onb.el, widget };
	}

	/* The tour is an occasional action, so it belongs in the page's own menu
	 * rather than in a button competing with Dashboard | Records for the top
	 * of every workspace. Registered once per page; the menu is rebuilt with
	 * the page, so `_tm_tour` is checked against the page object. */
	function tourMenuItem() {
		const page = ws()?.page;
		if (!page?.add_menu_item || page._tm_tour) return;
		page._tm_tour = true;
		const $item = page.add_menu_item(__("Start Tour"), () => openTour(), true);
		page._tm_tour_item = $item?.parent?.() || null;
	}

	function renderTour(box, info) {
		const btn = box.querySelector(".tm-ws-tour");
		btn.hidden = true; /* the menu carries it now */
		const { block, widget } = currentWidget(info);
		const dismissed = !widget || widget.style.display === "none" || widget.classList.contains("zoom-out");
		const available = !!block && !dismissed && !editing();
		if (available) tourMenuItem();
		ws()?.page?._tm_tour_item?.toggle(available);
		if (!available) {
			return;
		}
		state.block = block;
		state.widget = widget;
	}

	function dialog() {
		if (state.dialog) return state.dialog;
		const d = new frappe.ui.Dialog({ title: __("Start Tour"), size: "large" });
		d.$wrapper.addClass("tm-tour-dialog");
		d.onhide = () => {
			restore();
			refreshTourButton();
		};
		state.dialog = d;
		return d;
	}

	function openTour() {
		const widget = state.widget;
		if (!widget || !widget.isConnected) return;
		const d = dialog();
		restore(); /* a card from another page still in the body */
		d.set_title(widget.querySelector(".widget-title")?.textContent.trim() || __("Start Tour"));
		/* native move: jQuery .empty()/.html() would strip the widget's handlers */
		state.moved = { block: state.block, widget };
		d.$body[0].appendChild(widget);
		d.show();
	}

	/* Put the card back where editor.js keeps it, hidden by CSS as before. */
	function restore() {
		const moved = state.moved;
		state.moved = null;
		if (!moved || !moved.widget.isConnected || moved.block.contains(moved.widget)) return;
		(moved.block.querySelector(".ce-block__content") || moved.block).appendChild(moved.widget);
	}

	function refreshTourButton() {
		const box = ws()?.page?.page_actions?.[0]?.querySelector(".tm-ws-tools");
		const redactor = ws()?.body?.[0]?.querySelector(".codex-editor__redactor");
		if (box && redactor) renderTour(box, classify(redactor));
	}

	/* Dismiss inside the dialog: the widget removes itself after its 300ms
	 * zoom-out (base_widget.js delete). Close the dialog with it. */
	const Onboarding = frappe.widget?.widget_factory?.onboarding;
	if (Onboarding && !Onboarding.prototype._tm_tour) {
		const original = Onboarding.prototype.delete;
		Onboarding.prototype.delete = function (animate, dismissed) {
			const out = original.apply(this, arguments);
			const el = this.widget?.[0];
			if (dismissed && el && (el === state.widget || el === state.moved?.widget)) {
				if (el === state.widget) state.widget = null;
				if (el === state.moved?.widget) {
					state.moved.block.dataset.tmGroup = "none";
					state.moved = null;
				}
				setTimeout(() => {
					closeTour();
					refreshTourButton();
				}, animate ? 320 : 0);
			}
			return out;
		};
		Onboarding.prototype._tm_tour = true;
	}

	/* ---- run ----------------------------------------------------------- */
	function apply() {
		if (!enabled() || !onWorkspace() || !ws()?.body) return;
		const editor = ws().body[0].querySelector("#editorjs");
		const redactor = editor?.querySelector(".codex-editor__redactor");
		const box = tools();
		if (!editor || !redactor || !box) return;
		box.hidden = editing();
		const info = classify(redactor);
		renderTour(box, info);
		window.themate?.dashboards?.configureItem(); /* before renderActions decides whether the ⋯ shows */
		renderActions(box);
		window.themate?.dashboards?.renderStrip();
	}

	/* ---- TV mode --------------------------------------------------------
	 * The dashboard on screen, full screen, no chrome. Esc, the exit button,
	 * or leaving full screen ends it. */
	const tv = { on: false, bar: null };
	function startTv() {
		if (tv.on) return;
		tv.on = true;
		buildAll(frappe.dashboard?.container?.[0]); /* nobody scrolls a wall display */
		document.documentElement.dataset.tmTv = "1";
		document.documentElement.requestFullscreen?.().catch(() => {});
		const bar = document.createElement("div");
		bar.className = "tm-tv-bar";
		bar.innerHTML = `<button type="button" class="tm-tv-exit" title="${__("Exit TV mode (Esc)")}">${frappe.utils.icon("close", "sm")}</button>`;
		bar.querySelector(".tm-tv-exit").addEventListener("click", stopTv);
		document.body.appendChild(bar);
		tv.bar = bar;
		document.addEventListener("keydown", tvKey);
		document.addEventListener("fullscreenchange", tvFullscreen);
	}
	function tvKey(e) { if (e.key === "Escape") stopTv(); }
	function tvFullscreen() { if (!document.fullscreenElement) stopTv(); }
	function stopTv() {
		if (!tv.on) return;
		tv.on = false;
		delete document.documentElement.dataset.tmTv;
		tv.bar?.remove();
		tv.bar = null;
		document.removeEventListener("keydown", tvKey);
		document.removeEventListener("fullscreenchange", tvFullscreen);
		if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
	}
	window.themate = window.themate || {};
	window.themate.tv = { start: startTv, stop: stopTv };

	/* ---- 5. workspace actions ------------------------------------------ */
	const isPrivate = (page) => !!page && !page.public && (!page.for_user || page.for_user === frappe.session.user);

	function menuItem(key, label, handler) {
		const page = ws()?.page;
		if (!page?.add_menu_item) return null;
		state.menu = state.menu || {};
		if (!state.menu[key]) state.menu[key] = page.add_menu_item(label, handler, true);
		return state.menu[key];
	}

	function renderActions(box) {
		const page = ws()?._page;
		const edit = box.querySelector(".tm-ws-edit");
		const mine = isPrivate(page);
		edit.hidden = !mine || editing();
		/* page menu: Rename / Delete on my workspaces, Edit Workspace for
		 * managers on public ones (the footer button they had is hidden) */
		const rename = menuItem("rename", __("Rename Workspace"), () => page && ws().edit_page(page));
		const del = menuItem("delete", __("Delete Workspace"), () => page && ws().delete_page(page));
		const editPublic = menuItem("edit", __("Edit Workspace"), () => ws()?.body?.find(".btn-edit-workspace").trigger("click"));
		const showMine = mine && !editing();
		const showEdit = !mine && !!ws()?.has_access && !!page?.is_editable && !editing();
		rename?.parent().toggle(showMine);
		del?.parent().toggle(showMine);
		editPublic?.parent().toggle(showEdit);
		/* the … button only when it has something to show */
		ws()?.page?.menu_btn_group?.toggleClass("hide", !(showMine || showEdit || (ws()?.page?._tm_panel_item && !editing())));
	}

	/* The sidebar's "+": Frappe's New Workspace dialog, which ends in the
	 * editor on the new (private by default) page. Works from any route. */
	async function newWorkspace() {
		if (!onWorkspace()) await frappe.set_route("/app/home");
		for (let i = 0; i < 50 && !ws()?.all_pages; i++) await new Promise((r) => setTimeout(r, 100));
		ws()?.initialize_new_page?.();
	}

	/* Frappe rebuilds its (hidden) sidebar after create / rename / delete;
	 * the theme's sidebar follows. */
	const Workspace = frappe.views?.Workspace;
	if (Workspace && !Workspace.prototype._tm_sidebar) {
		const original = Workspace.prototype.make_sidebar;
		Workspace.prototype.make_sidebar = function () {
			const out = original.apply(this, arguments);
			try { frappe.themate_sidebar?.refresh_workspaces?.(this.sidebar_pages?.pages); } catch (e) { /* sidebar stays */ }
			return out;
		};
		Workspace.prototype._tm_sidebar = true;
	}

	/* A workspace drawn without a route event after it — the first page of a
	 * load when it is the user's home (/app/hr with HR as Home) — used to get
	 * no strip and no panel: the route event came before Frappe had a body to
	 * watch, and nothing came after. show_page is where Frappe draws every
	 * workspace, so once it is done the watch starts and the page is applied. */
	if (Workspace && !Workspace.prototype._tm_shown) {
		const showPage = Workspace.prototype.show_page;
		/* Frappe's show_page keeps the page, its content and its data on the
		 * instance and waits (frappe.after_ajax) for EVERY request in flight
		 * before asking for the data. Two loads that overlap — a second click
		 * on a slow server — then drew one workspace's blocks from another's
		 * data (most of the page missing until a reload), and the data was
		 * asked for only after the theme's own requests had finished. So the
		 * data is fetched here, at once, into Frappe's own cache (this.pages);
		 * only the latest call goes on to Frappe's show_page, which then finds
		 * it cached and draws without waiting. */
		let turn = 0;
		const loading = {}; /* workspace -> its data request in flight */
		Workspace.prototype.show_page = async function (page) {
			const mine = ++turn;
			window.themate?.dashboards?.prepare(page?.name); /* the strip and panel, before any data */
			const list = page?.public && this.public_pages?.length ? this.public_pages : this.private_pages;
			const current = list?.find((p) => p.title == page.name);
			if (current && this.pages && !this.pages[current.name]) {
				this.create_page_skeleton();
				this._page = current; /* as Frappe does before its wait: the strip reads it */
				/* get_data asks for these after the page data, one round trip
				 * later; asked now, it is handed the same request (dashboards.js) */
				frappe.dashboard_utils?._tm_shared && frappe.dashboard_utils.get_dashboard_settings().catch?.(() => {});
				/* on a stand-in, so get_data's `this.page_data = …` cannot land on
				 * the workspace on screen; this.pages is the shared cache */
				loading[current.name] = loading[current.name] || Promise.resolve(this.get_data.call(Object.create(this), current)).finally(() => delete loading[current.name]);
				try { await loading[current.name]; } catch (e) { /* Frappe's show_page asks once more */ }
				if (mine !== turn) return; /* another workspace was asked for meanwhile */
			}
			try {
				return await showPage.apply(this, arguments);
			} finally {
				window.themate?.dashboards?.renderStrip();
				setTimeout(onRoute, 0);
			}
		};
		Workspace.prototype._tm_shown = true;
	}

	function schedule() {
		clearTimeout(state.timer);
		state.timer = setTimeout(apply, 60);
	}

	function observe() {
		const body = ws()?.body?.[0];
		if (!body || state.observer) return;
		state.observer = new MutationObserver((records) => {
			/* only the editor's own blocks matter, not the tour dialog */
			const relevant = records.some((r) => {
				const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
				return t && !t.closest(".tm-tour-dialog");
			});
			if (!relevant) return;
			schedule();
		});
		state.observer.observe(body, { childList: true, subtree: true });
	}

	/* Any route change ends the tour: Frappe only closes `cur_dialog`, which
	 * Bootstrap sets after the fade — too late for a click right after
	 * opening — so the dialog is closed here regardless. */
	function closeTour(attempt = 0) {
		const d = state.dialog;
		if (!d) return;
		if (d.$wrapper.hasClass("show")) {
			d.hide(); /* ignored by Bootstrap while the show transition runs */
			if (attempt < 3) setTimeout(() => closeTour(attempt + 1), 400);
		} else {
			restore();
		}
	}

	function onRoute() {
		closeTour();
		if (!onWorkspace()) {
			const box = ws()?.page?.page_actions?.[0]?.querySelector(".tm-ws-tools");
			if (box) box.hidden = true;
			return;
		}
		observe();
		schedule();
	}

	/* The outline of a dashboard on its way: three cards, two charts — the
	 * shape of what lands. */
	function dashSkeleton() {
		return `<div class="tm-skeleton tm-skeleton-dashboard" aria-busy="true" aria-label="${__("Loading...")}">
			<div class="tm-skeleton-row"><span class="tm-skeleton-card"></span><span class="tm-skeleton-card"></span><span class="tm-skeleton-card"></span></div>
			<div class="tm-skeleton-row"><span class="tm-skeleton-chart"></span><span class="tm-skeleton-chart"></span></div>
		</div>`;
	}

	$(document).on("page-change", () => setTimeout(onRoute, 0));
	frappe.router?.on?.("change", () => setTimeout(onRoute, 0));
	$(onRoute);

	window.themate = window.themate || {};
	window.themate.workspaceTabs = { apply, openTour };
	/* the workspace's dashboard panel (dashboards.js) draws through the same code */
	/* With InnoDash: its summary (three figures, a chart, what needs
	 * attention; opts.spec is what the Workspace Panel states) under the
	 * dashboard's segment bar; without it, the first section of the layout. */
	window.themate.renderDashboard = (el, layout, config, name, opts = {}) => {
		const summary = window.themate.dashboardSummary;
		if (!summary) return renderLayout(el, layout, config, name, { preview: true });
		const declared = new Set((layout.segments || []).map((x) => x.field).concat(layout.mine ? ["mine"] : []));
		const stored = window.themate?.deskState?.get("dashboards", name)?.segments || {};
		const segments = Object.fromEntries(Object.entries(stored).filter(([k]) => declared.has(k)));
		if (layout.mine_locked) segments.mine = 1;
		const box = document.createElement("div");
		const draw = (seg) => summary(box, name, seg, config, opts);
		if ((layout.segments && layout.segments.length) || layout.mine) {
			el.appendChild(segmentBar(layout, segments, name, (next) => {
				window.themate?.deskState?.set("dashboards", name, { segments: next });
				draw(next);
			}));
		}
		el.appendChild(box);
		return draw(segments);
	};
	window.themate.newWorkspace = newWorkspace;
})();

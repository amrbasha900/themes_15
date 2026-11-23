/* Workspace Records: the item count on each link panel, the "+" on a
 * shortcut, and the permissions note. The "Filter this page" box that used
 * to sit above the blocks was removed on 2026-11-03 (the dashboards strip
 * took its place); apply() still hides by query for the console handle.
 *
 * Native: frappe/public/js/frappe/views/workspace/workspace.js renders the
 * page into an Editor.js redactor — shortcuts and link cards are `.ce-block`s
 * holding `.shortcut-widget-box` / `.links-widget-box`. workspace/tabs.js
 * tags every block with data-tm-group, and the Records tab is the blocks
 * tagged "records".
 *
 * Why a filter and not a second list: the page already holds every shortcut
 * and link the reader is allowed to see, each one rendered by Frappe with the
 * permissions and the destination it was configured with. Hiding what does
 * not match is therefore the ONLY approach that cannot invent a destination,
 * lose a filter, or show something the reader may not open — a rebuilt list
 * would have to re-derive all three. It also means typing costs no request.
 *
 * What it deliberately does not do (the brief is explicit): no All /
 * Transactions / Reports / Setup filters, no guessing an item's kind from
 * words in its title, and nothing is excluded for being unclassified.
 *
 * Mounting: one delegated listener on the bar itself, and the bar is rebuilt
 * with the workspace, so navigating between workspaces cannot accumulate
 * listeners. The index is rebuilt only when the block set changes. */
(function () {
	const frappe = window.frappe;
	const $ = window.jQuery;
	if (!frappe || !$) return;

	const enabled = () => window.themate?.enabled?.() !== false;
	const onWorkspace = () => (frappe.get_route?.() || [])[0] === "Workspaces";

	/* Matching is done on a normalised string so "Sales Invoice",
	 * "sales-invoice" and "sales_invoice" are the same needle. */
	const norm = (s) =>
		String(s || "")
			.toLowerCase()
			.replace(/[_\-/]+/g, " ")
			.replace(/\s+/g, " ")
			.trim();

	/* signature starts as null, not "": the first pass runs before tabs.js has
	 * tagged the blocks, so blocksOf() is empty and the signature is the empty
	 * string. Against an initial "" that compared equal and the index was
	 * never built again — no counts, nothing to search. */
	const state = { host: null, bar: null, index: null, signature: null };

	/* ---- the searchable text of one element ----------------------------- */
	/* Both the translated title and the original name, per the brief. For a
	 * link the original name is in its href — /app/sales-invoice — which is
	 * the doctype slugged, so it survives translation. For a shortcut the
	 * label is what the DOM carries; page_data.shortcuts adds link_to when
	 * the workspace has finished loading it. */
	function shortcutHay(el, byName) {
		const label = el.getAttribute("aria-label") || el.querySelector(".widget-title")?.textContent;
		const conf = byName[el.dataset.widgetName];
		return norm([label, conf?.link_to, conf?.label, conf?.type, el.dataset.icon].filter(Boolean).join(" "));
	}

	function linkHay(a) {
		const href = a.getAttribute("href") || "";
		return norm([a.getAttribute("title"), a.textContent, href.replace(/^\/app\//, "")].filter(Boolean).join(" "));
	}

	/* page_data.shortcuts is not one shape. On this bench it is an OBJECT
	 * whose values are arrays of rows; elsewhere it is the array itself, or a
	 * map keyed by the child row name. All three are read here, flattened one
	 * level, and an absent one is read as empty rather than as a reason to
	 * give up on the whole index — that is what a `.forEach is not a
	 * function` once did, silently, for the life of the page. */
	function shortcutIndex() {
		const raw = frappe.workspace?.page_data?.shortcuts;
		const seed = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
		const out = {};
		seed.forEach((entry) => {
			(Array.isArray(entry) ? entry : [entry]).forEach((s) => {
				if (s && s.name) out[s.name] = s;
			});
		});
		return out;
	}

	/* ---- index ----------------------------------------------------------- */
	function blocksOf(root) {
		return Array.from(root.querySelectorAll(':scope > .ce-block[data-tm-group="records"]'));
	}

	function build(root) {
		const byName = shortcutIndex();
		const blocks = blocksOf(root).map((el) => {
			const shortcut = el.querySelector(".shortcut-widget-box");
			const card = el.querySelector(".links-widget-box");
			const header = el.querySelector(".ce-header");
			if (shortcut) {
				quickCreate(shortcut, byName[shortcut.dataset.widgetName]);
				return { el, kind: "shortcut", hay: shortcutHay(shortcut, byName) };
			}
			if (card) {
				return {
					el,
					kind: "card",
					hay: norm(card.querySelector(".widget-title")?.textContent),
					links: Array.from(card.querySelectorAll(".link-item")).map((a) => ({ el: a, hay: linkHay(a) })),
					control: card.querySelector(".widget-control"),
				};
			}
			if (header) return { el, kind: "header", hay: norm(header.textContent) };
			/* Anything else on the Records side — a Custom HTML block, a
			 * spacer, a block type this file has never heard of — is indexed
			 * as "always shown". Hiding a block because it was not recognised
			 * is how a workspace quietly loses a customisation. */
			return { el, kind: "other", hay: "" };
		});
		return blocks;
	}

	/* The block set as a string: rebuilding the index on every keystroke is
	 * wasted work, and rebuilding it never means a shortcut added in edit
	 * mode is unsearchable. */
	/* The link rows are rendered into a card AFTER the card's block exists, so
	 * a signature built from block identity alone never changed and the first
	 * index was built against empty cards — no counts, nothing to search. The
	 * row count is part of the signature for that reason. */
	function signature(root) {
		return blocksOf(root)
			.map(
				(el) =>
					el.dataset.tmKind +
					":" +
					(el.querySelector("[data-widget-name]")?.dataset.widgetName || "") +
					":" +
					el.querySelectorAll(".link-item").length
			)
			.join("|");
	}

	/* ---- counts ----------------------------------------------------------- */
	/* "N items" on a link panel counts the rows the reader can actually see,
	 * and follows the filter, so it never claims more than it is showing. */
	function setCount(entry, shown) {
		if (!entry.control) return;
		let el = entry.control.querySelector(".tm-ws-count");
		if (!el) {
			el = document.createElement("span");
			el.className = "tm-ws-count";
			entry.control.appendChild(el);
		}
		/* <bdi>: the string starts with a digit, and in an RTL panel that made
		 * "6 items" reorder to "items 6". */
		el.innerHTML = shown ? `<bdi>${frappe.utils.escape_html(__("{0} items", [shown]))}</bdi>` : "";
		el.hidden = !shown;
	}

	/* ---- filter ------------------------------------------------------------ */
	function apply(query) {
		const index = state.index;
		if (!index) return;
		const q = norm(query);
		let matches = 0;

		index.forEach((entry) => {
			if (entry.kind === "other") return; /* never hidden — see build() */
			if (entry.kind === "header") return; /* decided in the pass below */

			if (entry.kind === "shortcut") {
				const hit = !q || entry.hay.includes(q);
				entry.el.hidden = !hit;
				if (hit && q) matches++;
				return;
			}

			/* A panel whose own title matches keeps all of its rows: someone
			 * searching "Tax" wants the Tax panel, not three of its seven
			 * rows. */
			const titleHit = !!q && entry.hay.includes(q);
			let shown = 0;
			entry.links.forEach((l) => {
				const hit = !q || titleHit || l.hay.includes(q);
				l.el.hidden = !hit;
				if (hit) shown++;
			});
			entry.el.hidden = !!q && !titleHit && shown === 0;
			setCount(entry, shown);
			if (q && !entry.el.hidden) matches += titleHit ? 1 : shown;
		});

		/* A section header goes with its section: shown only while something
		 * under it is still shown. */
		for (let i = 0; i < index.length; i++) {
			if (index[i].kind !== "header") continue;
			let any = false;
			for (let j = i + 1; j < index.length && index[j].kind !== "header"; j++) {
				if (index[j].kind === "other" || !index[j].el.hidden) {
					any = true;
					break;
				}
			}
			index[i].el.hidden = !any;
		}

	}

	/* ---- a number on each link ---------------------------------------------
	 * As a shortcut has one: "3 Open" on Leave Application, "14" on
	 * Department (themate.api.get_link_counts decides what it counts, with the
	 * reader's permissions). A row's doctype is read from its own route,
	 * against the doctypes the reader may open (boot.user.can_read) — not from
	 * page_data, which right after a route change still holds the previous
	 * workspace's cards and left the new one without numbers. Runs on every
	 * render against the rows on screen; one request per set of doctypes, and
	 * the page is written only where a number changed. */
	const counts = new Map(); /* doctypes key -> promise, for this visit */
	let bySlug = null;
	function slugMap() {
		if (!bySlug) {
			bySlug = {};
			(frappe.boot?.user?.can_read || []).forEach((dt) => { bySlug[`/app/${frappe.router.slug(dt)}`] = dt; });
		}
		return bySlug;
	}
	function countLinks(host) {
		const routes = slugMap();
		const rows = [];
		host.querySelectorAll(".links-widget-box .link-item").forEach((a) => {
			const dt = routes[(a.getAttribute("href") || "").split("?")[0]];
			if (dt) rows.push([a, dt]);
		});
		if (!rows.length) return;
		const doctypes = [...new Set(rows.map((r) => r[1]))].sort();
		const key = doctypes.join("|");
		if (!counts.has(key)) counts.set(key, frappe.xcall("themate.api.get_link_counts", { doctypes }).catch(() => { counts.delete(key); return {}; }));
		counts.get(key).then((got) => rows.forEach(([a, dt]) => {
			const c = got?.[dt];
			let el = a.querySelector(".tm-link-count");
			if (!c) return el?.remove();
			const n = frappe.format(c.count, { fieldtype: "Int" }, { inline: true });
			const KIND = { Open: __("{0} open", [n]), Pending: __("{0} pending", [n]), Active: __("{0} active", [n]), Draft: __("{0} draft", [n]) };
			const text = KIND[c.label] || n;
			if (el?.textContent === text) return;
			if (!el) {
				el = document.createElement("span");
				el.className = "tm-link-count";
				a.appendChild(el);
			}
			el.classList.toggle("is-zero", !c.count);
			/* <bdi>: a number first, in an Arabic row */
			el.innerHTML = `<bdi>${frappe.utils.escape_html(text)}</bdi>`;
		}));
	}

	/* ---- quick create ------------------------------------------------------ */
	/* A "+" on a shortcut, and only where it means something: the destination
	 * has to be a DocType, it has to be creatable at all (a Single has no
	 * "new"), and the reader has to hold create permission on it. Frappe's
	 * own shortcut has no such button, so there is nothing to keep in step —
	 * but there is something to be careful about: the whole tile is a link,
	 * so the button stops the click from also opening the list behind it. */
	function quickCreate(el, conf) {
		const dt = conf && conf.type === "DocType" ? conf.link_to : null;
		const ok =
			dt &&
			conf.doc_view !== "New" &&
			!(frappe.boot?.single_types || []).includes(dt) &&
			frappe.model?.can_create?.(dt);
		const control = el.querySelector(".widget-control");
		const existing = control?.querySelector(".tm-ws-new");
		if (!ok || !control) {
			existing?.remove();
			return;
		}
		if (existing) return;
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "tm-ws-new";
		btn.title = __("New {0}", [__(dt)]);
		btn.setAttribute("aria-label", btn.title);
		btn.innerHTML = frappe.utils.icon("add", "xs");
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			frappe.new_doc(dt);
		});
		/* keyboard: the tile is the link, the button is its own stop */
		btn.addEventListener("keydown", (e) => e.stopPropagation());
		control.appendChild(btn);
	}

	/* Everything on this page is filtered by the reader's own permissions —
	 * Frappe renders only what they may see — and saying so is cheaper than
	 * letting someone wonder why a colleague's workspace has a card theirs
	 * does not. */
	function note(host, editor) {
		let el = host.querySelector(":scope > .tm-ws-note");
		if (!el) {
			el = document.createElement("div");
			el.className = "tm-ws-note";
			el.innerHTML = `${frappe.utils.icon("info", "xs")}<span>${__("Shortcuts and links follow your permissions.")}</span>`;
			host.appendChild(el);
		}
		el.hidden = !blocksOf(editor).some((b) => b.offsetParent !== null);
	}

	/* ---- mount --------------------------------------------------------------- */
	function mount() {
		if (!onWorkspace() || !enabled()) return;
		const editor = document.querySelector(".desk-page .codex-editor__redactor");
		const host = document.querySelector(".desk-page");
		if (!editor || !host) return;
		/* still the workspace being left: counting its links was a wasted request on every move */
		if (document.querySelector("#page-Workspaces .workspace-skeleton")) return;

		/* Edit mode is Frappe's; a filter that hides blocks while they are
		 * being dragged would be a trap. The bar goes away and everything it
		 * hid comes back. */
		const editing = frappe.workspace && frappe.workspace.is_read_only === false;
		if (editing) {
			host.querySelector(":scope > .tm-ws-note")?.remove();
			state.index = null;
			state.signature = "";
			return;
		}

		state.host = host;

		/* The signature is recorded only AFTER a successful build. Marking it
		 * first meant that if build() threw once — the caller swallows it so a
		 * workspace still renders — the signature already matched and the
		 * index was never attempted again for the life of the page. */
		const sig = signature(editor);
		if (sig !== state.signature) {
			const index = build(editor);
			state.index = index;
			state.signature = sig;
			apply(""); /* the panels' counts */
		}

		countLinks(host);
		note(host, editor);
	}

	let frame = 0;
	function schedule() {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			try {
				mount();
			} catch (e) {
				/* A workspace that renders is worth more than a search box, so
				 * this never rethrows — but it says so, because a silent
				 * catch here once hid a broken index behind a working page. */
				console.warn("themate: workspace search", e);
			}
		});
	}

	/* The page is rebuilt on every workspace change and the blocks arrive
	 * asynchronously, so this watches the page container — scoped, never
	 * document.body — and re-runs on route change. */
	let observer = null;
	function watch() {
		counts.clear(); /* asked again on the next visit */
		observer?.disconnect();
		observer = null;
		if (!onWorkspace()) return;
		[0, 200, 700, 1600].forEach((ms) => setTimeout(schedule, ms));
		const host = document.querySelector(".desk-page") || document.querySelector(".page-container:not(.hide)");
		if (!host) return;
		observer = new MutationObserver(schedule);
		observer.observe(host, { childList: true, subtree: true });
	}

	/* A handle for diagnosing this surface from the console, and for the
	 * visual tests: which blocks were indexed and what the filter did with
	 * them is otherwise only visible as an absence. */
	window.themate = window.themate || {};
	window.themate.workspaceSearch = {
		state,
		index: () => (state.index || []).map((e) => ({ kind: e.kind, hay: e.hay, links: e.links?.length || 0, hidden: !!e.el.hidden })),
		apply,
	};

	$(document).on("page-change", watch);
	frappe.router?.on?.("change", watch);
	watch();
})();

/* Page head: document name under the title, an icon box before it, and the
 * Activity heading.
 *
 * 1. Sub-title. form/toolbar.js:58 calls page.set_title_sub(docname) whenever
 *    a document's title differs from its name — but ui/page.js:117 binds
 *    $sub_title_area to `h6`, and page.html:24 renders the slot as
 *    `div.sub-heading`. The lookup finds nothing, so stock Frappe 15.111
 *    never shows the name. Re-point the area at the element that exists.
 *
 * 2. Icon. The design puts the module's icon in a box before the title on
 *    List and Form pages. The icon is the one the sidebar shows for the
 *    workspace Frappe's breadcrumbs resolved (parent workspace when the
 *    active item is a child), so sidebar, breadcrumb and page head agree.
 *
 * 3. Activity. Frappe titles the comment box "Comments"; the design names
 *    the whole card Activity, which is what it contains (comments + timeline). */
(function () {
	const frappe = window.frappe;
	const Page = frappe?.ui?.Page;
	if (!Page) return;

	if (!Page.prototype._tm_subtitle_patched) {
		const original = Page.prototype.set_title_sub;
		Page.prototype.set_title_sub = function (txt) {
			if (!this.$sub_title_area || !this.$sub_title_area.length) {
				this.$sub_title_area = this.wrapper.find(".sub-heading");
			}
			return original.call(this, txt);
		};
		Page.prototype._tm_subtitle_patched = true;
	}

	const ICON_VIEWS = new Set(["Form", "List", "Report", "Tree", "Dashboard", "Workspaces", "dashboard-view"]);

	function sidebarIcon() {
		const item =
			document.querySelector(".modern-sidebar-item.has-active-child .sidebar-item-icon svg") ||
			document.querySelector(".modern-sidebar-item.active .sidebar-item-icon svg");
		return item ? item.cloneNode(true) : null;
	}

	function currentPageTitle() {
		/* Frappe keeps every visited page in the DOM; only one is shown. */
		const pages = [...document.querySelectorAll(".page-container")];
		const visible = pages.find((p) => p.offsetParent !== null) || pages[0];
		return visible?.querySelector(".page-head .page-title") || null;
	}

	function placeIcon() {
		const page = currentPageTitle();
		if (!page) return;
		const route = frappe.get_route() || [];
		let box = page.querySelector(".tm-page-icon");

		/* a dashboard page carries its own icon: the sidebar still marks wherever it was opened from */
		const fallback = route[0] === "dashboard-view" ? Object.assign(document.createElement("template"), { innerHTML: frappe.utils.icon("dashboard", "md") }).content.firstElementChild : null;
		const svg = ICON_VIEWS.has(route[0]) && window.themate?.enabled?.() ? fallback || sidebarIcon() : null;
		if (!svg) {
			box?.remove();
			return;
		}
		if (!box) {
			box = document.createElement("div");
			box.className = "tm-page-icon";
			box.setAttribute("aria-hidden", "true");
			page.insertBefore(box, page.querySelector(".title-area"));
		}
		svg.setAttribute("class", "icon tm-icon");
		box.replaceChildren(svg);
	}

	function labelActivity() {
		if (!window.themate?.enabled?.()) return;
		const wanted = __("Activity");
		document.querySelectorAll(".form-footer .comment-input-header span").forEach((el) => {
			if (el.textContent.trim() !== wanted) el.textContent = wanted;
		});
	}

	/* Breadcrumbs resolve after the route event, and the sidebar re-marks
	 * its active item in its own wrapper around breadcrumbs.update — one
	 * registered after this file ran, i.e. OUTSIDE this one, so its code
	 * runs after ours. Deferred to a microtask, which runs once that whole
	 * call has returned but before the browser paints — a setTimeout could
	 * land after a frame had shown the title without its icon. */
	if (frappe.breadcrumbs && !frappe.breadcrumbs._tm_page_head_wrapped) {
		const original = frappe.breadcrumbs.update;
		frappe.breadcrumbs.update = function () {
			const out = original.apply(this, arguments);
			queueMicrotask(placeIcon);
			return out;
		};
		frappe.breadcrumbs._tm_page_head_wrapped = true;
	}

	/* Workspaces: the name is the title; "Workspace" under it says what the
	 * page is, as the design shows. */
	function labelWorkspace() {
		const route = frappe.get_route() || [];
		if (route[0] !== "Workspaces" || !window.themate?.enabled?.()) return;
		/* On the first page-change the route is still ["Workspaces"] with no
		 * page name, which used to read as "this is Home" and print the
		 * greeting on every workspace. Without a name there is nothing to
		 * label yet. */
		if (!route[1]) return;
		const page = frappe.container?.page?.page;
		if (!page?.set_title_sub) return;
		/* Home greets the person. Every other workspace used to print
		 * "Workspace" under its own name, which is a line of page height
		 * spent saying what the reader just clicked; it now carries the
		 * workspace's own description when it has one, and nothing when it
		 * does not. */
		const home = frappe.boot?.user?.default_workspace?.name || "Home";
		const isHome = route[1] === home || route[1] === "Home";
		page.wrapper?.toggleClass("tm-home", isHome);
		/* every workspace opens on a head card, as Home does (layout/_page.scss) */
		page.wrapper?.addClass("tm-ws-card");
		if (isHome) {
			const { hello, today } = greeting();
			/* not set_title: the browser tab keeps the page's name */
			page.$title_area?.find(".title-text").text(hello);
			page.set_title_sub(today);
			return;
		}
		const ws = window.frappe?.workspace;
		const sub = ws?._page?.name === route[1] ? __(ws._page.description || "") : "";
		page.set_title_sub(sub || "");
	}

	function greeting() {
		const h = new Date().getHours();
		const word = h < 12 ? __("Good morning") : h < 17 ? __("Good afternoon") : __("Good evening");
		const user = frappe.boot?.user?.name || frappe.session.user;
		const name = (frappe.boot?.user_info?.[user]?.fullname || frappe.session.user_fullname || "").split(" ")[0];
		const today = frappe.datetime.str_to_user(frappe.datetime.get_today());
		const day = new Date().toLocaleDateString(frappe.boot?.lang || "en", { weekday: "long" });
		const comma = frappe.boot?.lang === "ar" ? "،" : ",";
		return { hello: `${word}${name ? `${comma} ${name}` : ""}`, today: `${day} ${today}` };
	}

	/* Frappe creates the workspace page titled "Workspace" (workspace.js:10)
	 * and names it only in show() (:329), once the workspace list has
	 * arrived — on a reload, a visible "Workspace" that turned into "Home"
	 * a moment later. The placeholder is held invisible, its space kept,
	 * until show() has named the page; the sub-title is written in that
	 * same call, not on a timer after it. */
	const Workspace = frappe.views?.Workspace;
	if (Workspace && !Workspace.prototype._tm_title) {
		const makePage = frappe.standard_pages?.Workspaces;
		if (makePage) {
			frappe.standard_pages.Workspaces = function () {
				const out = makePage.apply(this, arguments);
				try {
					if (window.themate?.enabled?.()) frappe.pages?.Workspaces?.classList.add("tm-title-pending");
				} catch (e) {
					/* the placeholder stays visible, as in Frappe */
				}
				return out;
			};
		}
		const show = Workspace.prototype.show;
		Workspace.prototype.show = function () {
			const out = show.apply(this, arguments);
			/* show() returns early (and retries) until all_pages is in */
			if (this.all_pages) {
				this.wrapper?.[0]?.classList.remove("tm-title-pending");
				labelWorkspace();
				placeIcon();
			}
			return out;
		};
		Workspace.prototype._tm_title = true;
	}

	if (window.jQuery) {
		/* The workspace object arrives after the route does, so the label is
		 * set again once it is there rather than only on the first tick. */
		window.jQuery(document).on("page-change", () => {
			[0, 250, 900].forEach((ms) => setTimeout(() => { placeIcon(); labelWorkspace(); }, ms));
		});
		window.jQuery(document).on("form-load form-refresh", () => {
			labelActivity();
			placeIcon();
		});
	}

	window.themate = window.themate || {};
	window.themate.placePageIcon = placeIcon;
})();

/* User profile page: an identity header in front of the charts.
 *
 * Native: frappe/desk/page/user_profile/. The page opens on an activity
 * heatmap and two charts, and everything that identifies the person —
 * picture, name, email, roles, when they were last here — is a thin column
 * of links on the side. On this bench that column shows four zeros and three
 * links, and the page never says whose profile it is beyond the title.
 *
 * This adds the header the page was missing: picture, name, handle, status,
 * a grid of the facts a colleague actually looks one another up for, the
 * roles as chips, an Actions menu, and the four point/rank stats lifted out
 * of the side column into a tile row.
 *
 * The stats element is MOVED, not rebuilt. render_points_and_rank()
 * (user_profile_controller.js:394) fills `.user-stats` asynchronously, after
 * two xcalls, and finds it with `this.wrapper.find(".user-stats")` — a search
 * of the whole page wrapper, which the header card is inside. So moving the
 * element keeps the controller's own numbers arriving in it, with no second
 * implementation of the rank and energy-point calls.
 *
 * Driven by route events, not by patching frappe.ui.UserProfile: that class
 * is in user_profile_controller.bundle.js, which is `frappe.require`d when
 * the page opens — long after this file runs. */
(function () {
	const frappe = window.frappe;
	const $ = window.jQuery;
	if (!frappe || !$) return;

	const enabled = () => window.themate?.enabled?.() !== false;
	const onProfile = () => (frappe.get_route?.() || [])[0] === "user-profile";

	function esc(v) {
		return frappe.utils.escape_html(String(v == null ? "" : v));
	}

	function when(value) {
		if (!value) return __("Never");
		try {
			return frappe.datetime.comment_when(value);
		} catch {
			return esc(value);
		}
	}

	/* The controller's own stats block, wherever it currently is. */
	function adoptStats(root, card) {
		const stats = root.querySelector(".user-stats");
		const slot = card.querySelector(".tm-profile-stats");
		if (!stats || !slot || stats.parentElement === slot) return;
		slot.appendChild(stats);
	}

	/* boot.lang_dict is {label: code}; the profile should read "English",
	 * not "en". Falls back to the code when the site has no dictionary. */
	function languageName(code) {
		if (!code) return "—";
		const dict = frappe.boot?.lang_dict || {};
		const hit = Object.keys(dict).find((label) => dict[label] === code);
		return esc(hit || code);
	}

	function facts(doc, info) {
		const rows = [
			[__("Email"), esc(doc.email || info?.email || "—")],
			[__("Username"), doc.username ? "@" + esc(doc.username) : "—"],
			[__("Language"), languageName(doc.language)],
			[__("Time Zone"), esc(doc.time_zone || "—")],
			[__("Last Login"), when(doc.last_login)],
			[__("Last Active"), when(doc.last_active)],
		];
		if (info?.location) rows.push([__("Location"), esc(info.location)]);
		if (info?.interest) rows.push([__("Interests"), esc(info.interest)]);
		return rows
			.map(
				([k, v]) =>
					`<div class="tm-profile-fact"><dt>${k}</dt><dd>${v}</dd></div>`
			)
			.join("");
	}

	function roles(doc) {
		const list = (doc.roles || []).map((r) => r.role).filter(Boolean).sort();
		if (!list.length) return "";
		const shown = list.slice(0, 8);
		const rest = list.length - shown.length;
		return `<div class="tm-profile-roles">
			<dt>${__("Roles")}</dt>
			<dd>${shown.map((r) => `<span class="tm-role-chip">${esc(r)}</span>`).join("")}
			${rest > 0 ? `<span class="tm-role-chip tm-role-more" title="${esc(list.slice(8).join(", "))}">+${rest}</span>` : ""}</dd>
		</div>`;
	}

	function actions(userId, root) {
		const own = userId === frappe.session.user;
		return `<div class="tm-profile-actions">
			${own ? `<button type="button" class="btn btn-default btn-sm" data-act="edit">${__("Edit Profile")}</button>` : ""}
			<button type="button" class="btn btn-default btn-sm" data-act="record">${__("Open User Record")}</button>
			<a class="btn btn-default btn-sm" href="/app/leaderboard/User">${__("Leaderboard")}</a>
		</div>`;
	}

	function paint(card, userId, root, doc) {
		const info = frappe.user_info(userId) || {};
		const name = doc.full_name || info.fullname || userId;
		const image = doc.user_image || info.image;
		const status = doc.enabled === 0 ? "red" : "green";
		const statusText = doc.enabled === 0 ? __("Disabled") : __("Enabled");

		card.innerHTML = `
			<div class="tm-profile-top">
				<div class="tm-profile-avatar">${
					image
						? `<img src="${esc(image)}" alt="${esc(name)}">`
						: `<span>${esc(info.abbr || name.slice(0, 2))}</span>`
				}</div>
				<div class="tm-profile-id">
					<div class="tm-profile-name">
						<h2>${esc(name)}</h2>
						<span class="indicator-pill ${status}">${statusText}</span>
					</div>
					<div class="tm-profile-sub">${
						doc.username ? "@" + esc(doc.username) + " · " : ""
					}${esc(doc.user_type || "")}</div>
					${doc.bio || info.bio ? `<p class="tm-profile-bio">${esc(doc.bio || info.bio)}</p>` : ""}
				</div>
				${actions(userId, root)}
			</div>
			<dl class="tm-profile-facts">${facts(doc, info)}</dl>
			${roles(doc)}
			<div class="tm-profile-stats"></div>`;

		card.addEventListener("click", (e) => {
			const act = e.target.closest("[data-act]")?.dataset.act;
			if (!act) return;
			if (act === "record") frappe.set_route("Form", "User", userId);
			/* The controller binds Edit Profile to its own dialog; reuse that
			 * rather than rebuilding the dialog here. */
			if (act === "edit") root.querySelector(".edit-profile-link")?.click();
		});

		adoptStats(root, card);
	}

	function build() {
		if (!onProfile() || !enabled()) return;
		const root = document.querySelector(".page-container:not(.hide) .page-content") || document;
		const main = root.querySelector(".layout-main-section");
		const graphs = main?.querySelector(".performance-graphs");
		if (!main || !graphs) return;

		const userId = frappe.get_route()[1] || frappe.session.user;
		let card = main.querySelector(".tm-profile-head");
		if (card && card.dataset.user === userId) {
			adoptStats(root, card);
			return;
		}
		card?.remove();

		card = document.createElement("div");
		card.className = "tm-profile-head";
		card.dataset.user = userId;
		/* prepend, not insertBefore(graphs): `.performance-graphs` is three
		 * levels down (.layout-main-section > .row.user-profile > .col-md-12),
		 * so it is not a child of `main` and insertBefore throws NotFoundError
		 * — which the caller's try/catch then swallowed, leaving no header and
		 * no error. It is only looked up to confirm the page has rendered. */
		main.prepend(card);

		/* One call for everything the header shows. A user without read
		 * permission on another User still gets the name and picture that
		 * frappe.user_info already has. */
		frappe.db
			.get_doc("User", userId)
			.then((doc) => paint(card, userId, root, doc || {}))
			.catch(() => paint(card, userId, root, {}));
	}

	let frame = 0;
	function schedule() {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			try {
				build();
			} catch (e) {
				/* a profile that renders is worth more than a header */
			}
		});
	}

	/* The page is built by a lazily-loaded controller and then filled by two
	 * async calls, so one check on page-change is always too early. */
	let observer = null;
	function watch() {
		observer?.disconnect();
		observer = null;
		if (!onProfile()) return;
		[0, 200, 600, 1500].forEach((ms) => setTimeout(schedule, ms));
		const host = document.querySelector(".page-container:not(.hide)") || document.body;
		observer = new MutationObserver(schedule);
		observer.observe(host, { childList: true, subtree: true });
	}

	$(document).on("page-change", watch);
	watch();
})();

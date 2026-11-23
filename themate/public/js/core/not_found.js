/* Desk "not found" / "not permitted" pages in the theme's frame.
 *
 * Native: frappe/public/js/frappe/views/pageview.js show_not_found and
 * show_not_permitted render a bubble-tea illustration and a "Home" button
 * through show_message_page. Same entry points, the theme's own card: the
 * status as a large numeral, the route that failed, and three ways out —
 * Home, back, and the search bar (Ctrl+G). show_message_page itself is
 * untouched for the other messages that use it. The website 404 is
 * www/404.html. */
(function () {
	const frappe = window.frappe;
	if (!frappe?.show_not_found || frappe.show_not_found._tm) return;
	const esc = (s) => frappe.utils.escape_html(String(s ?? ""));

	function page(opts) {
		const name = opts.page_name || frappe.get_route_str();
		const el = frappe.pages[name] || frappe.container.add_page(name);
		const home = frappe.boot?.user?.default_workspace?.name ? `/app/${frappe.router.slug(frappe.boot.user.default_workspace.name)}` : "/app";
		$(el).html(`<div class="page tm-error-page">
			<div class="tm-error-card" role="alert">
				<div class="tm-error-code" aria-hidden="true">${opts.code.slice(0, 1)}<span>${opts.code.slice(1, 2)}</span>${opts.code.slice(2)}</div>
				<h2 class="tm-error-title">${esc(opts.title)}</h2>
				<p class="tm-error-text">${esc(opts.message)}</p>
				<code class="tm-error-route">/app/${esc(name)}</code>
				<div class="tm-error-actions">
					<a class="btn btn-primary btn-sm" href="${home}">${__("Home")}</a>
					<button type="button" class="btn btn-default btn-sm tm-error-back">${__("Go back")}</button>
					<button type="button" class="btn btn-default btn-sm tm-error-search">${__("Search")} <kbd>Ctrl+G</kbd></button>
				</div>
			</div>
		</div>`);
		$(el).find(".tm-error-back").on("click", () => window.history.back());
		$(el).find(".tm-error-search").on("click", () => $("#navbar-search").focus());
		frappe.container.change_to(name);
	}

	frappe.show_not_found = function (page_name) {
		if (window.themate?.enabled?.() === false) return native_not_found(page_name);
		page({ page_name, code: "404", title: __("There's nothing here"), message: __("The page you are looking for has gone missing.") });
		/* the request layer's own "Not found" alert (request.js 404 handler)
		 * has nothing to add to the card; it opens a tick after the error */
		const isAlert = () => {
			const d = frappe.msg_dialog;
			if (!d?.$wrapper) return false;
			const title = d.$wrapper.find(".modal-title").text().trim();
			return (d.display || d.$wrapper.hasClass("show")) && (title === __("Not found") || title === "Not found");
		};
		let tries = 0;
		const timer = setInterval(() => {
			if (isAlert()) frappe.msg_dialog.hide();
			if (++tries > 12) clearInterval(timer); /* ~2.4s: covers the modal fade */
		}, 200);
	};

	/* A desk Page that does not exist: pageview.js with_page asks the server
	 * and, on 404, leaves the area blank behind the request layer's alert —
	 * show_not_found is never reached. Same lookup, with the miss routed
	 * to the card. */
	const pageview = frappe.views?.pageview;
	if (pageview?.with_page && !pageview.with_page._tm) {
		const original = pageview.with_page;
		pageview.with_page = function (name, callback) {
			const known = frappe.standard_pages[name] || (locals.Page && locals.Page[name] && locals.Page[name].script) || name == window.page_name || (localStorage["_page:" + name] && frappe.boot.developer_mode != 1);
			if (known || !name) return original.call(this, name, callback);
			return frappe.call({
				method: "frappe.desk.desk_page.getpage",
				args: { name },
				callback(r) {
					if (!r.docs._dynamic_page) {
						try { localStorage["_page:" + name] = JSON.stringify(r.docs); } catch (e) { console.warn(e); }
					}
					callback();
				},
				error: () => setTimeout(() => frappe.show_not_found(name), 30),
				freeze: true,
			});
		};
		pageview.with_page._tm = true;
	}
	frappe.show_not_permitted = function (page_name) {
		if (window.themate?.enabled?.() === false) return native_not_permitted(page_name);
		page({ page_name, code: "403", title: __("Not permitted"), message: __("You do not have permission to view this page.") });
	};
	const native_not_found = (page_name) => frappe.show_message_page({ page_name, message: __("Sorry! I could not find what you were looking for."), img: "/assets/frappe/images/ui/bubble-tea-sorry.svg" });
	const native_not_permitted = (page_name) => frappe.show_message_page({ page_name, message: __("Sorry! You are not permitted to view this page."), img: "/assets/frappe/images/ui/bubble-tea-sorry.svg" });
	frappe.show_not_found._tm = true;
})();

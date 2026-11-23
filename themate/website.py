import frappe


def get_home_page(user):
	"""`/` and `/index` for someone who works in the desk: the desk.

	Frappe resolves both paths through website/utils.py get_home_page(). With
	nothing configured it ends at its own fallback, "me" for any signed-in
	user — the portal's My Account page in Frappe's website styling, which
	the theme does not dress. For a desk user that was the old design
	standing in front of the system.

	Returning "login" sends them through www/login.py, which already
	redirects a signed-in desk user to their default app or /app (with
	no-store, so the browser does not keep the redirect after logout).
	Nothing new to render, nothing to keep in step with Frappe.

	Hook: get_website_user_home_page. Frappe calls it for every session,
	Guest included, and moves on to its own rules when it returns None, so:
	  - Guest: "home", the company's front page with the way to log in
	    (the login page, as before, when the theme is off);
	  - Website (portal) users: None -> My Account, as before;
	  - an explicit choice wins: Role.home_page and Portal Settings are read
	    before this hook, and a Website Settings home page is respected here,
	    so a site that publishes a website keeps it at `/`.
	"""
	if not user or user == "Guest":
		# a visitor: the company's front page (www/home.html), unless the
		# site publishes a home page of its own or the theme is off
		if frappe.db.get_single_value("Website Settings", "home_page"):
			return None
		from themate.api import _flag

		return "home" if _flag("enable_theme") else None
	if frappe.get_cached_value("User", user, "user_type") != "System User":
		return None
	if frappe.db.get_single_value("Website Settings", "home_page"):
		return None
	return "login"

import frappe
from frappe.utils.jinja_globals import is_rtl

from themate.api import _flag, get_theme_settings_dict

no_cache = 1


def get_context(context):
	"""The website 404 (any path Frappe cannot resolve) in the theme's own
	frame: brand, colours and fonts from Theme Settings, the same tokens the
	login page uses (themate-login.bundle.css). Frappe keeps the 404 status."""
	# Theme Settings > Enable Theme off: Frappe's own 404 (404.html's else branch)
	context.themate_on = bool(_flag("enable_theme"))
	if not context.themate_on:
		context.title = frappe._("Not Found")
		context.web_include_css = [c for c in (context.get("web_include_css") or []) if "themate" not in c]
		return context
	theme = get_theme_settings_dict()
	context.themate = theme
	context.app_name = theme.get("app_name") or frappe.get_system_settings("app_name") or "INNOMATE"
	context.logo = theme.get("app_logo") or theme.get("favicon") or "/assets/themate/images/favicon.png"
	context.layout_direction = "rtl" if is_rtl() else "ltr"
	context.body_class = "tm-error-page-body"
	context.title = frappe._("Page not found")
	context.home = "/app" if frappe.session.user != "Guest" else "/"
	if theme.get("favicon"):
		context.favicon = theme["favicon"]
	return context

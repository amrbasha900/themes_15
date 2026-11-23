import frappe
from frappe.utils.jinja_globals import is_rtl
from frappe.www.login import get_context as frappe_get_context

from themate.api import _flag, get_theme_settings_dict


def get_context(context):
	# Call the original login controller to handle session checking, redirections, and social logins
	context = frappe_get_context(context)
	# Theme Settings > Enable Theme off: the template's own "not installed"
	# branch, which is Frappe's stock login page and stylesheet.
	context["themate_installed"] = "themate" in frappe.get_installed_apps() and bool(_flag("enable_theme"))
	if not context["themate_installed"]:
		context["layout_direction"] = "rtl" if is_rtl() else "ltr"
		# hooks.py web_include_css adds the login bundle to every website
		# page; its few unscoped rules (.form-label, .indicator) would still
		# restyle Frappe's own login
		context["web_include_css"] = [c for c in (context.get("web_include_css") or []) if "themate" not in c]
		return context

	# Theme Settings > Brand / Login. Read through the same function as the
	# desk boot payload so the two pages can never disagree on a value.
	theme = get_theme_settings_dict()
	context["themate"] = theme
	context["login_layout"] = (theme.get("login_layout") or "Centered").lower()
	# Only the desk sets layout_direction (www/app.py:64); website pages,
	# this one included, never did — so an Arabic login rendered LTR.
	context["layout_direction"] = "rtl" if is_rtl() else "ltr"
	# The layout class goes on <body> in the markup (base.html renders
	# body_class), not from the ready script: added after load, the form
	# painted at the left of the page first and then jumped to its place.
	has_bg = bool(theme.get("login_background")) and context["login_layout"] == "centered"
	context["body_class"] = "tm-login-page-body" + (" tm-login-has-bg" if has_bg else "")
	if theme.get("favicon"):
		context["favicon"] = theme["favicon"]
	return context

"""The desk's splash screen (templates/includes/splash_screen.html).

Frappe's app.html shows `.splash` until the desk has booted and then removes
it. Themate draws it from Theme Settings — the same logo the sidebar shows
(App Logo, App Logo (Dark) in dark mode, else the Innomate mark), the brand
colour for its progress line, and the app name — so the first thing a person
sees is their company, not a framework logo.
"""

import frappe

DEFAULT_LOGO = "/assets/themate/images/Innomate-logo.png"


def context(context):
	"""Hook update_website_context: values for the splash template."""
	if context.get("tm_splash") is not None:
		return None
	try:
		from themate.api import get_theme_settings_dict

		theme = get_theme_settings_dict()
	except Exception:
		theme = {}
	if not (theme.get("flags") or {}).get("theme", True):
		return {"tm_splash": False}  # the theme switched off: Frappe's own splash
	logo = theme.get("app_logo") or DEFAULT_LOGO
	return {
		"tm_splash": {
			"logo": logo,
			"logo_dark": theme.get("app_logo_dark") or logo,
			"brand": theme.get("brand_color") or "#1677ff",
			"name": theme.get("app_name") or context.get("app_name") or "",
		}
	}

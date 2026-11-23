"""The company's front page: /home, what a visitor sees at `/` (website.py
sends a Guest here; Website Settings > Home Page "home" does the same), and
the way in to log in.

It takes the route of ERPNext's home page (templates/pages/home.html): Frappe
looks for pages in the apps installed last first, so this one is found
before ERPNext's. With the theme off it hands the page back to ERPNext's own
controller and template, so nothing changes for a site that does not use it.

It is the customer's page, not the theme's: the name is the Company
(Homepage > Company, else the default company), the logo the Company's
logo, else Website Settings' or Theme Settings' (else the name's first
letter, never the theme's own logo), the footer the Company's website,
phone and email. Words come from Homepage (Tag Line, Description, Hero
Image) when filled, else Theme Settings' Login Tagline; the colour is
Theme Settings'. The apps shown are the ones installed
with an apps-screen entry (hooks add_to_apps_screen) — names and logos only,
nothing a visitor could not read off the login page's own app links.
"""

import frappe
from frappe import _
from frappe.utils import nowdate
from frappe.utils.jinja_globals import is_rtl

from themate.api import _flag, get_theme_settings_dict
from themate.www.apps import PURPOSE, TONE, TONES, company_brand

no_cache = 1


def _homepage():
	if "erpnext" not in frappe.get_installed_apps() or not frappe.db.exists("DocType", "Homepage"):
		return frappe._dict()
	return frappe.get_cached_doc("Homepage")


def get_context(context):
	if not _flag("enable_theme"):
		if "erpnext" in frappe.get_installed_apps():
			from erpnext.templates.pages.home import get_context as erpnext_home

			erpnext_home(context)
			context.template = "erpnext/templates/pages/home.html"
			return context
		frappe.local.flags.redirect_location = "/login"
		raise frappe.Redirect

	theme = get_theme_settings_dict()
	homepage = _homepage()
	b = company_brand(theme, homepage.get("company"))
	name, logo, co = b.name, b.logo, b.company
	contacts = [
		{"href": co.website if "://" in co.website else f"https://{co.website}", "text": co.website.split("://")[-1].rstrip("/")} if co.website else None,
		{"href": f"tel:{co.phone_no}", "text": co.phone_no} if co.phone_no else None,
		{"href": f"mailto:{co.email}", "text": co.email} if co.email else None,
	]

	apps, seen = [], set()
	for entry in frappe.get_hooks("add_to_apps_screen") or []:
		app = entry.get("name")
		if not app or app in seen or not entry.get("logo"):
			continue
		seen.add(app)
		purpose = PURPOSE.get(app)
		if not purpose:
			hooks = frappe.get_hooks("app_description", app_name=app) or []
			purpose = hooks[0] if hooks else ""
		apps.append({
			"title": _(entry.get("title") or app),
			"logo": entry["logo"],
			"purpose": _(purpose) if purpose else "",
			"tone": TONE.get(app) or TONES[len(apps) % len(TONES)],
		})

	signed_in = frappe.session.user != "Guest"
	context.update({
		"no_header": 1,
		"body_class": "tm-apps-body tm-welcome-body",
		"dir": "rtl" if is_rtl() else "ltr",
		"title": name or _("Welcome"),
		"tm": {
			"logo": logo,
			"logo_dark": b.logo_dark,
			"initial": b.initial,
			"contacts": [c for c in contacts if c],
			"hero_image": homepage.get("hero_image") or "",
			"name": name,
			"brand": theme.get("brand_color") or "#1677ff",
			"tagline": homepage.get("tag_line") or theme.get("login_tagline") or "",
			"description": homepage.get("description") or "",
			"year": nowdate()[:4],
		},
		"apps": apps,
		"signed_in": signed_in,
	})
	if theme.get("favicon"):
		context.favicon = theme["favicon"]
	return context

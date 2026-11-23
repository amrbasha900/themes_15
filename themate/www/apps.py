"""/apps — the app picker, in the theme's design.

Frappe's controller (frappe/www/apps.py) decides who sees which app and
redirects when there is none; it runs first and is not changed. This adds
the customer's brand (company_brand: the Company's name and logo), a line
saying what each app is for, and a colour per app. With the theme switched
off the template draws Frappe's own page.
"""

import frappe
from frappe import _
from frappe.utils.jinja_globals import is_rtl
from frappe.www.apps import get_context as frappe_get_context

from themate.api import _flag, get_theme_settings_dict

no_cache = 1

# What each app is for, in a few words; others say their hooks' app_description.
PURPOSE = {
	"erpnext": "Enterprise Resource Planning",
	"hrms": "People, Attendance and Payroll",
	"hris": "Advanced HR & Workforce Management",
	"innomate_pos": "Point of Sale (Retail · Distribution · F&B)",
	"lending": "Loans and Credit Management",
	"crm": "Leads, Deals and Customers",
	"helpdesk": "Customer Support Tickets",
	"insights": "Reports and Data Exploration",
	"lms": "Courses and Learning",
	"pulse_surveys": "Surveys and Feedback",
}
TONES = ("blue", "green", "purple", "cyan", "orange", "pink")
TONE = {"erpnext": "blue", "hrms": "green", "hris": "purple", "innomate_pos": "cyan", "lending": "green"}


def company_brand(theme, company=None):
	"""The customer's name and logo: the Company first (else the default
	company), then Website Settings' and Theme Settings' logo; with none, the
	name's first letter is drawn, never the theme's own logo."""
	has_company = frappe.db.exists("DocType", "Company")
	company = company or frappe.defaults.get_global_default("company")
	if not company and has_company:
		company = frappe.db.get_value("Company", {}, "name")
	co = frappe._dict()
	if company and has_company:
		co = frappe.db.get_value("Company", company, ["company_logo", "website", "phone_no", "email"], as_dict=True) or co
	name = company or theme.get("app_name") or ""
	logo = co.company_logo or frappe.db.get_single_value("Website Settings", "app_logo") or theme.get("app_logo") or ""
	return frappe._dict(
		name=name,
		logo=logo,
		logo_dark=(theme.get("app_logo_dark") if logo == theme.get("app_logo") else "") or logo,
		initial=(name or "?")[:1].upper(),
		company=co,
	)


def get_context(context):
	out = frappe_get_context() or {}
	context.update(out)
	context.tm_on = bool(_flag("enable_theme"))
	if not context.tm_on:
		return context

	theme = get_theme_settings_dict()
	for i, app in enumerate(context.get("apps") or []):
		name = app.get("name")
		purpose = PURPOSE.get(name)
		if not purpose:
			hooks = frappe.get_hooks("app_description", app_name=name) or []
			purpose = hooks[0] if hooks else ""
		app["purpose"] = _(purpose) if purpose else ""
		app["tone"] = TONE.get(name) or TONES[i % len(TONES)]

	user = frappe.session.user
	first = frappe.db.get_value("User", user, "first_name") if user != "Guest" else ""
	b = company_brand(theme)
	context.tm = {
		"logo": b.logo,
		"logo_dark": b.logo_dark,
		"initial": b.initial,
		"name": b.name,
		"brand": theme.get("brand_color") or "#1677ff",
		"first_name": first or "",
		"dark": (frappe.db.get_value("User", user, "desk_theme") or "Light") if user != "Guest" else "Light",
	}
	context.dir = "rtl" if is_rtl() else "ltr"
	context.body_class = "tm-apps-body"
	if theme.get("favicon"):
		context.favicon = theme["favicon"]
	context.title = _("Apps")
	return context

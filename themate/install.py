import frappe

from themate import arabic_pdf
from themate.api import THEME_DEFAULTS


def after_install():
	create_custom_fields()
	arabic_pdf.setup()

	if not frappe.db.exists("DocType", "Theme Settings"):
		return

	values = {
		"enable_theme": THEME_DEFAULTS["flags"]["theme"],
		"brand_color": THEME_DEFAULTS["brand_color"],
		"accent_preset": THEME_DEFAULTS["accent_preset"],
		"font_family": THEME_DEFAULTS["font_family"],
		"font_size": THEME_DEFAULTS["font_size"],
		"icon_style": THEME_DEFAULTS["icon_style"],
		"icon_stroke": THEME_DEFAULTS["icon_stroke"],
		"icon_size": THEME_DEFAULTS["icon_size"],
		"icon_color": THEME_DEFAULTS["icon_color"],
		"radius_preset": THEME_DEFAULTS["radius_preset"],
		"density": THEME_DEFAULTS["density"],
		"default_mode": THEME_DEFAULTS["default_mode"],
		"enable_sidebar": THEME_DEFAULTS["flags"]["sidebar"],
		"enable_navbar_restyle": THEME_DEFAULTS["flags"]["navbar"],
		"enable_list_restyle": THEME_DEFAULTS["flags"]["list"],
		"enable_form_restyle": THEME_DEFAULTS["flags"]["form"],
		"show_workspace_icons": THEME_DEFAULTS["show_workspace_icons"],
		"sidebar_default": THEME_DEFAULTS["sidebar_default"],
		"login_layout": THEME_DEFAULTS["login_layout"],
		"show_language_switcher": THEME_DEFAULTS["show_language_switcher"],
		"show_customizer_button": THEME_DEFAULTS["show_customizer_button"],
	}

	for fieldname, value in values.items():
		frappe.db.set_single_value("Theme Settings", fieldname, value)
	frappe.local.tm_raw_settings = None  # api._raw_settings, read again after these writes


def after_migrate():
	create_custom_fields()
	arabic_pdf.setup()
	seed_missing_flags()
	apply_item_layout()
	apply_whitelabel()
	apply_chart_types()


# Dashboard: a narrated layout (headings with notes, charts and number cards
# in one order — other apps add their own item types, InnoDash its Business
# Overview widget) and a sequence among a workspace's dashboards. Read by
# themate.api.get_dashboard_layout and drawn by public/js/workspace/tabs.js.
DASHBOARD_FIELDS = [
	{"fieldname": "tm_layout_section", "fieldtype": "Section Break", "label": "Themate Layout", "insert_after": "cards", "collapsible": 0},
	{"fieldname": "tm_intro", "fieldtype": "Small Text", "label": "Introduction", "insert_after": "tm_layout_section",
		"description": "One paragraph shown above the cards: what this dashboard answers and for whom."},
	{"fieldname": "tm_sequence", "fieldtype": "Int", "label": "Sequence", "insert_after": "tm_intro",
		"description": "Order among the workspace's dashboards: 1 comes first, then 2; blank or 0 goes after them."},
	{"fieldname": "tm_layout", "fieldtype": "Table", "label": "Layout", "options": "Themate Dashboard Item", "insert_after": "tm_sequence",
		"description": "When filled, this layout is drawn instead of the plain cards and charts: headings with a note, charts and number cards (and the cards other apps add), in this order and width."},
]


def apply_dashboard_layout():
	if not frappe.db.exists("DocType", "Dashboard") or not frappe.db.exists("DocType", "Themate Dashboard Item"):
		return
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields as make_custom_fields

	make_custom_fields({"Dashboard": DASHBOARD_FIELDS}, ignore_validate=True)
	# Frappe insists on at least one chart; a narrated layout may be all cards
	from frappe.custom.doctype.property_setter.property_setter import make_property_setter

	make_property_setter("Dashboard", "charts", "reqd", "0", "Check", validate_fields_for_doctype=False)
	frappe.clear_cache(doctype="Dashboard")


# Dashboard Chart > Type, extended while the chart engine is ECharts. The
# first six are Frappe's own; the rest are drawn by charts/adapter.js
# (core/charts.js maps the label to the adapter key and falls back to the
# nearest native look when the engine is Frappe Charts).
CHART_TYPES_NATIVE = "Line\nBar\nPercentage\nPie\nDonut\nHeatmap"
CHART_TYPES_EXTENDED = CHART_TYPES_NATIVE + "\nArea\nStacked Bar\nHorizontal Bar\nScatter\nRadar\nFunnel\nGauge\nTreemap\nSunburst\nRose"


def apply_chart_types():
	"""Add the ECharts types to Dashboard Chart > Type, or put the Select
	back the way Frappe ships it when the engine is Frappe Charts."""
	if not frappe.db.exists("DocType", "Dashboard Chart"):
		return
	from frappe.custom.doctype.property_setter.property_setter import make_property_setter

	settings = frappe.get_cached_doc("Theme Settings")
	engine = settings.get("chart_engine") or THEME_DEFAULTS.get("chart_engine", "ECharts")
	existing = frappe.db.get_value(
		"Property Setter", {"doc_type": "Dashboard Chart", "field_name": "type", "property": "options"}
	)
	if engine == "ECharts":
		make_property_setter("Dashboard Chart", "type", "options", CHART_TYPES_EXTENDED, "Text", validate_fields_for_doctype=False)
	elif existing:
		frappe.delete_doc("Property Setter", existing, ignore_permissions=True, force=True)
	frappe.clear_cache(doctype="Dashboard Chart")


def apply_whitelabel():
	"""Theme Settings > Whitelabel: the references the client cannot reach.

	Emails: Frappe appends "Sent via …" through the standard footer.
	Website: the footer says "Powered by ERPNext" unless Website Settings >
	footer_powered has text. Titles: <title> and the login wordmark read
	System / Website Settings > App Name, which ship as "Frappe".
	Only ever writes when the flag is on and the value is still the stock
	one, so a site's own choices are never overwritten."""
	from themate.api import _flag, get_theme_settings_dict

	if not _flag("whitelabel"):
		return

	name = (get_theme_settings_dict().get("app_name") or "").strip()

	frappe.db.set_single_value("System Settings", "disable_standard_email_footer", 1)
	stock = ("Frappe", "ERPNext", "Frappe Framework")
	if name and (frappe.db.get_single_value("System Settings", "app_name") or "Frappe") in stock:
		frappe.db.set_single_value("System Settings", "app_name", name)

	if frappe.db.exists("DocType", "Website Settings"):
		if not (frappe.db.get_single_value("Website Settings", "footer_powered") or "").strip():
			frappe.db.set_single_value("Website Settings", "footer_powered", name or "&nbsp;")
		if name and (frappe.db.get_single_value("Website Settings", "app_name") or "Frappe") in stock:
			frappe.db.set_single_value("Website Settings", "app_name", name)

	frappe.clear_cache()


ITEM_LAYOUT_FIELDS = [
	# The Details tab of Item opens with an unlabeled section (the Tab Break
	# itself). A Section Break right after it gives that block a title, and
	# a second one before the stock/valuation fields splits them out — the
	# design's "Basic Information" / "Stock & Valuation". Standard fields
	# keep their order, tab, permissions and depends_on; only two headings
	# are added. Verified field order on ERPNext 15.111: has_variants is
	# idx 11, opening_stock idx 12.
	{
		"fieldname": "tm_basic_information_section",
		"fieldtype": "Section Break",
		"label": "Basic Information",
		"insert_after": "details",
	},
	{
		"fieldname": "tm_stock_valuation_section",
		"fieldtype": "Section Break",
		"label": "Stock & Valuation",
		"insert_after": "has_variants",
	},
	# Three columns inside it: rates | asset settings | allowances.
	{
		"fieldname": "tm_stock_valuation_column_1",
		"fieldtype": "Column Break",
		"insert_after": "standard_rate",
	},
	{
		"fieldname": "tm_stock_valuation_column_2",
		"fieldtype": "Column Break",
		"insert_after": "asset_naming_series",
	},
]

# The design shows Description and Units of Measure open. ERPNext marks both
# sections collapsible, and Frappe folds a collapsible section whose fields
# are empty on an existing document. A Property Setter is the supported way
# to change that; it is removed again when the layout is switched off.
ITEM_LAYOUT_PROPERTIES = [
	("section_break_11", "collapsible", "0", "Check"),
	("unit_of_measure_conversion", "collapsible", "0", "Check"),
]


def apply_item_layout():
	"""Theme Settings > Forms > Item layout: add or remove the two section
	breaks. Only ERPNext sites have Item; everything else is a no-op."""
	if not frappe.db.exists("DocType", "Item"):
		return

	from themate.api import _flag

	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields as make_custom_fields

	from frappe.custom.doctype.property_setter.property_setter import make_property_setter

	wanted = _flag("item_layout")
	names = [f["fieldname"] for f in ITEM_LAYOUT_FIELDS]

	if wanted:
		make_custom_fields({"Item": ITEM_LAYOUT_FIELDS}, ignore_validate=True)
		for fieldname, prop, value, ptype in ITEM_LAYOUT_PROPERTIES:
			if frappe.db.exists("DocField", {"parent": "Item", "fieldname": fieldname}):
				make_property_setter("Item", fieldname, prop, value, ptype, validate_fields_for_doctype=False)
	else:
		for fieldname in names:
			name = frappe.db.get_value("Custom Field", {"dt": "Item", "fieldname": fieldname})
			if name:
				frappe.delete_doc("Custom Field", name, ignore_permissions=True, force=True)
		for fieldname, prop, _value, _ptype in ITEM_LAYOUT_PROPERTIES:
			name = frappe.db.get_value(
				"Property Setter", {"doc_type": "Item", "field_name": fieldname, "property": prop}
			)
			if name:
				frappe.delete_doc("Property Setter", name, ignore_permissions=True, force=True)
	frappe.clear_cache(doctype="Item")


def seed_missing_flags():
	"""Give every feature flag an explicit stored value.

	after_install only runs on a fresh install, so a flag added in a later
	release has no row in tabSingles on existing sites. themate.api._flag treats
	an absent row as enabled, but writing the value makes the state visible in
	the Theme Settings form instead of leaving the checkbox rendered as off
	while the feature is actually on.
	"""
	if not frappe.db.exists("DocType", "Theme Settings"):
		return

	from themate.api import DEFAULT_ON_CHECKS

	for fieldname in DEFAULT_ON_CHECKS:
		# Raw row read: get_single_value casts a missing Check to 0 (see
		# api._flag), so it can never answer "is there a row at all?".
		row = frappe.db.get_value(
			"Singles", {"doctype": "Theme Settings", "field": fieldname}, "value", order_by=None
		)
		if row is None:
			frappe.db.set_single_value("Theme Settings", fieldname, 1)
	frappe.local.tm_raw_settings = None  # api._raw_settings


def create_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields as make_custom_fields

	custom_fields = {
		"Number Card": [
			{
				"fieldname": "custom_icon",
				"label": "Icon",
				"fieldtype": "Icon",
				"insert_after": "label",
			}
		]
	}
	make_custom_fields(custom_fields)


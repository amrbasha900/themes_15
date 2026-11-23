import json

import frappe
from frappe import _
from frappe.utils import cint, flt


# Keep in step with DEFAULT_BRAND in public/js/core/bootstrap.js and
# --tm-brand-500 in public/scss/tokens/_palette.scss.
THEME_DEFAULTS = {
	"brand_color": "#1677ff",
	"app_name": None,
	"accent_preset": "Blue",
	"radius_preset": "Default",
	"density": "Comfortable",
	"default_mode": "Light",
	"font_family": "Inter",
	"font_size": 14,
	"text_styles": {},
	"chart_engine": "ECharts",
	"chart_detail": "Rich",
	"chart_palette": "Brand",
	"chart_colors": None,
	"sidebar_art": "On",
	"sidebar_art_colors": None,
	"sidebar_hidden_groups": "",
	"sidebar_group_order": "",
	"sidebar_show_my_workspaces": 1,
	"sidebar_show_user_card": 1,
	"icon_style": "Duotone",
	"icon_stroke": "Regular",
	"icon_size": 18,
	"icon_color": "Inherit",
	"app_logo": None,
	"app_logo_dark": None,
	"favicon": None,
	"login_layout": "Centered",
	"login_background": None,
	"login_tagline": None,
	"default_workspace": None,
	"show_workspace_icons": 1,
	"hide_workspace_shortcuts": 0,
	"sidebar_default": "Expanded",
	"show_language_switcher": 1,
	"show_customizer_button": 1,
	"whitelabel": 1,
	"sidebar_theme": "Dark",
	"sidebar_bg": None,
	"item_layout": 1,
	# Where a record's comments + timeline live: "Dialog" (button in the page
	# head, core/form_activity.js) or "Inline" (under the form, as in stock Frappe)
	"activity_display": "Dialog",
	# Which edge a record's side panel sits on: "Auto" = the end of the line
	# (right in English, left in Arabic), "Left" / "Right" = that side of the
	# screen whatever the language. Read through html[data-tm-panel].
	"form_panel_side": "Auto",
	# Theme Settings > Calendar (themate/calendars.py): FullCalendar day
	# numbers, 0 = Sunday
	"calendar_weekend": [5, 6],
	"calendar_shade_weekend": 1,
	"flags": {
		"theme": 1,
		"sidebar": 1,
		"navbar": 1,
		"list": 1,
		"form": 1,
	},
}

PREF_DEFAULTS = {
	"sidebar_collapsed": 0,
	"pinned_workspaces": [],
	"theme_mode": None,
	"font_size": None,
	"accent_color": None,
	"font_family": None,
	"radius_preset": None,
	"density": None,
	"icon_size": None,
	"icon_style": None,
	"sidebar_theme": None,
	"sidebar_bg": None,
	"sidebar_art": None,
	"sidebar_art_colors": None,
	"text_styles": {},
	"activity_display": None,
	"form_panel_side": None,
	# The master switch, per user: "On" / "Off" over the site's Enable Theme.
	"use_theme": None,
	# The sidebar department chosen (Themate Department name, or "All")
	"department": None,
}

THEME_FIELDS = {
	"enable_theme",
	"app_name",
	"brand_color",
	"accent_preset",
	"app_logo",
	"app_logo_dark",
	"favicon",
	"font_family",
	"font_size",
	"text_styles",
	"chart_engine",
	"chart_detail",
	"chart_palette",
	"chart_colors",
	"sidebar_art",
	"sidebar_art_colors",
	"sidebar_hidden_groups",
	"sidebar_group_order",
	"sidebar_show_my_workspaces",
	"sidebar_show_user_card",
	"icon_style",
	"icon_stroke",
	"icon_size",
	"icon_color",
	"radius_preset",
	"density",
	"default_mode",
	"enable_sidebar",
	"enable_navbar_restyle",
	"enable_list_restyle",
	"enable_form_restyle",
	"default_workspace",
	"show_workspace_icons",
	"hide_workspace_shortcuts",
	"sidebar_default",
	"show_language_switcher",
	"show_customizer_button",
	"whitelabel",
	"sidebar_theme",
	"sidebar_bg",
	"item_layout",
	"activity_display",
	"form_panel_side",
	"login_layout",
	"login_background",
	"login_tagline",
}

FONT_SIZE_RANGE = (11, 20)
ICON_SIZE_RANGE = (12, 28)

PREF_FIELDS = {
	"sidebar_collapsed",
	"pinned_workspaces",
	"theme_mode",
	"font_size",
	"accent_color",
	"font_family",
	"radius_preset",
	"density",
	"icon_size",
	"icon_style",
	"sidebar_theme",
	"sidebar_bg",
	"text_styles",
	"chart_palette",
	"chart_colors",
	"sidebar_art",
	"sidebar_art_colors",
	"activity_display",
	"form_panel_side",
	"use_theme",
	"desk_state",
	"department",
}

# Per-user Selects mirror the site-level options exactly.
PREF_OPTIONS = {
	"font_family": ("Inter", "Cairo", "System"),
	"radius_preset": ("Sharp", "Default", "Round"),
	"density": ("Comfortable", "Compact"),
	"icon_style": ("Duotone", "Outline"),
	"sidebar_theme": ("Dark", "Light"),
	"chart_palette": ("Brand", "Ocean", "Sunset", "Forest", "Slate", "Pastel", "Custom"),
	"activity_display": ("Dialog", "Inline"),
	"form_panel_side": ("Auto", "Left", "Right"),
	"use_theme": ("On", "Off"),
	"sidebar_art": ("On", "Off"),
}


def _chart_colors(value):
	"""Up to eight hex colours from a list, JSON list or comma string; None if none."""
	if isinstance(value, str):
		raw = value.strip()
		if raw.startswith("["):
			try:
				value = json.loads(raw)
			except ValueError:
				value = []
		else:
			value = raw.split(",")
	colors = [_hex_or_none(str(v).strip()) for v in (value or [])]
	colors = [c for c in colors if c][:8]
	return colors or None


def _clamp_int(value, lo, hi):
	"""0 / blank / junk -> None (follow the default); otherwise clamped."""
	value = cint(value)
	if not value:
		return None
	return max(lo, min(hi, value))


TEXT_STYLE_KEYS = ("title", "subtitle", "section", "tab", "label", "body", "menu")
TEXT_WEIGHTS = (400, 500, 600, 700)


def _text_styles(value):
	"""Whitelisted per-element typography: {key: {size, weight, italic, color}}.
	Anything outside the known keys/ranges is dropped, never stored."""
	data = frappe.parse_json(value) if isinstance(value, str) else value
	if not isinstance(data, dict):
		return {}
	out = {}
	for key, spec in data.items():
		if key not in TEXT_STYLE_KEYS or not isinstance(spec, dict):
			continue
		clean = {}
		size = cint(spec.get("size"))
		if 10 <= size <= 40:
			clean["size"] = size
		weight = cint(spec.get("weight"))
		if weight in TEXT_WEIGHTS:
			clean["weight"] = weight
		if spec.get("italic"):
			clean["italic"] = 1
		color = _hex_or_none(spec.get("color"))
		if color:
			clean["color"] = color
		if clean:
			out[key] = clean
	return out


def _hex_or_none(value):
	value = (value or "").strip().lower()
	if len(value) == 7 and value[0] == "#" and all(c in "0123456789abcdef" for c in value[1:]):
		return value
	return None


FLAG_FIELDS = (
	"enable_theme",
	"enable_sidebar",
	"enable_navbar_restyle",
	"enable_list_restyle",
	"enable_form_restyle",
)

# Other default-on Checks with the same "unset means on" semantics; seeded by
# install.seed_missing_flags so the form shows the state that is in force.
DEFAULT_ON_CHECKS = FLAG_FIELDS + (
	"show_language_switcher", "show_customizer_button", "item_layout", "whitelabel",
	"sidebar_show_my_workspaces", "sidebar_show_user_card",
	# Theme Settings > Calendar: the default weekend and its shading
	"weekend_friday", "weekend_saturday", "calendar_shade_weekend",
)


def _flag(fieldname, default=1):
	"""Read a Check flag, treating "never configured" as enabled.

	A loaded Document can NEVER report an unset Check field as None:
	BaseDocument._fix_numeric_types (frappe/model/base_document.py:723) runs
	cint() over every Check field when a Single loads, so an unset field reads
	back as 0. Testing `is not None` on the document therefore cannot tell
	"switched off on purpose" from "this field did not exist when the site was
	installed" — and a newly added flag silently disables whatever it guards.

	That is not hypothetical: adding `enable_theme` disabled the entire theme on
	every existing site, because the field had never been written and read back
	as 0.

	And `frappe.db.get_single_value` is NOT the escape hatch the previous
	revision believed: database.py runs `cast_fieldtype(df.fieldtype, val)`
	on the way out, and cast_fieldtype turns None into 0 for Check and Int
	(utils/data.py:854). Verified on 15.111.1 when two new navbar Checks read
	0 on a site that had no row for them. The only read that keeps NULL as
	NULL is the tabSingles row itself.
	"""
	try:
		row = _raw_settings().get(fieldname)
	except Exception:
		frappe.log_error(title="Themate flag read failed", message=frappe.get_traceback())
		return default

	return default if row is None else cint(row)


def _raw_settings():
	"""Theme Settings' tabSingles rows, read once per request: get_theme_settings_dict
	asks _flag for some twenty fields on every boot and page, one query each
	until this. Request-scoped, so nothing is stale after a save
	(ThemeSettings.on_update also drops it for the rest of that request)."""
	rows = getattr(frappe.local, "tm_raw_settings", None)
	if rows is None:
		rows = frappe.local.tm_raw_settings = dict(
			frappe.db.sql("select field, value from `tabSingles` where doctype = 'Theme Settings'")
		)
	return rows


def get_theme_settings_dict():
	try:
		settings = frappe.get_cached_doc("Theme Settings")
	except Exception:
		return THEME_DEFAULTS.copy()

	return {
		"brand_color": settings.brand_color or THEME_DEFAULTS["brand_color"],
		"app_name": (settings.app_name or "").strip() or None,
		"accent_preset": settings.accent_preset or THEME_DEFAULTS["accent_preset"],
		"radius_preset": settings.radius_preset or THEME_DEFAULTS["radius_preset"],
		"density": settings.density or THEME_DEFAULTS["density"],
		"default_mode": settings.default_mode or THEME_DEFAULTS["default_mode"],
		"font_family": settings.font_family or THEME_DEFAULTS["font_family"],
		"font_size": _clamp_int(settings.font_size, *FONT_SIZE_RANGE) or THEME_DEFAULTS["font_size"],
		"text_styles": _text_styles(settings.text_styles),
		"chart_engine": settings.chart_engine or THEME_DEFAULTS["chart_engine"],
		"chart_detail": settings.chart_detail or THEME_DEFAULTS["chart_detail"],
		"chart_palette": settings.get("chart_palette") or THEME_DEFAULTS["chart_palette"],
		"chart_colors": _chart_colors(settings.get("chart_colors")),
		"sidebar_art": "Off" if settings.get("sidebar_art") == "Off" else "On",
		"sidebar_art_colors": _chart_colors(settings.get("sidebar_art_colors")),
		"activity_display": settings.get("activity_display") if settings.get("activity_display") in PREF_OPTIONS["activity_display"] else THEME_DEFAULTS["activity_display"],
		"form_panel_side": settings.get("form_panel_side") if settings.get("form_panel_side") in PREF_OPTIONS["form_panel_side"] else THEME_DEFAULTS["form_panel_side"],
		"icon_style": settings.icon_style or THEME_DEFAULTS["icon_style"],
		"icon_stroke": settings.icon_stroke or THEME_DEFAULTS["icon_stroke"],
		"icon_size": _clamp_int(settings.icon_size, *ICON_SIZE_RANGE) or THEME_DEFAULTS["icon_size"],
		"icon_color": settings.icon_color or THEME_DEFAULTS["icon_color"],
		"app_logo": settings.app_logo,
		"app_logo_dark": settings.app_logo_dark,
		"favicon": settings.favicon,
		"login_layout": settings.login_layout or THEME_DEFAULTS["login_layout"],
		"login_background": settings.login_background,
		"login_tagline": settings.login_tagline,
		"default_workspace": settings.default_workspace,
		"show_workspace_icons": cint(settings.show_workspace_icons),
		"hide_workspace_shortcuts": cint(settings.get("hide_workspace_shortcuts")),
		"sidebar_default": settings.sidebar_default or THEME_DEFAULTS["sidebar_default"],
		"sidebar_theme": settings.sidebar_theme or THEME_DEFAULTS["sidebar_theme"],
		"sidebar_bg": _hex_or_none(settings.sidebar_bg),
		"sidebar_groups": {r.workspace: r.group_label for r in (settings.get("sidebar_groups") or []) if r.workspace and r.group_label and not cint(r.get("hidden"))},
		# Theme Settings > Sidebar > Groups and Hidden Items (rows with Hide),
		# Hidden Groups, and the two section switches (raw reads: new Checks)
		"sidebar_hidden": [r.workspace for r in (settings.get("sidebar_groups") or []) if r.workspace and cint(r.get("hidden"))],
		"sidebar_hidden_groups": [g.strip() for g in (settings.get("sidebar_hidden_groups") or "").split(",") if g.strip()],
		# Theme Settings > Sidebar > Group Order: one section title per line
		# (a comma-separated line is accepted too), top to bottom
		"sidebar_group_order": [g.strip() for g in (settings.get("sidebar_group_order") or "").replace(",", "\n").splitlines() if g.strip()],
		"sidebar_show_my_workspaces": _flag("sidebar_show_my_workspaces"),
		"sidebar_outside_departments": "Hide" if settings.get("sidebar_outside_departments") == "Hide" else "Show",
		"sidebar_show_user_card": _flag("sidebar_show_user_card"),
		# Raw reads: a loaded Check can never be None (see _flag), and these
		# two are new fields that existing sites have no row for yet.
		"whitelabel": _flag("whitelabel"),
		# Theme Settings > Calendar (raw reads: new Checks, see _flag)
		"calendar_weekend": _site_weekend(),
		"calendar_shade_weekend": _flag("calendar_shade_weekend"),
		"navbar": {
			"language_switcher": _flag("show_language_switcher"),
			"customizer_button": _flag("show_customizer_button"),
			"languages": _navbar_languages(settings),
		},
		"flags": {
			"theme": _flag("enable_theme"),
			"sidebar": _flag("enable_sidebar"),
			"navbar": _flag("enable_navbar_restyle"),
			"list": _flag("enable_list_restyle"),
			"form": _flag("enable_form_restyle"),
		},
	}


def _site_weekend():
	from themate.calendars import site_weekend

	return site_weekend()


DEFAULT_NAVBAR_LANGUAGES = (("en", "English"), ("ar", "العربية"))


def _navbar_languages(settings):
	"""Theme Settings > Navbar > Languages, falling back to English + Arabic.
	Only languages that exist (and are enabled) are offered."""
	rows = [(r.language, r.label) for r in (settings.get("navbar_languages") or [])]
	if not rows:
		rows = list(DEFAULT_NAVBAR_LANGUAGES)

	out = []
	for code, label in rows:
		info = frappe.db.get_value("Language", code, ["language_name", "enabled"], as_dict=True)
		if not info or not cint(info.enabled):
			continue
		out.append({"code": code, "label": label or info.language_name or code})
	return out


def get_user_prefs(user=None):
	user = user or frappe.session.user
	if not user or user == "Guest":
		return PREF_DEFAULTS.copy()

	defaults = _get_legacy_sidebar_prefs(user)
	defaults["theme_mode"] = _get_desk_theme(user)

	try:
		if not frappe.db.exists("Themate User Preference", user):
			return defaults

		doc = frappe.get_cached_doc("Themate User Preference", user)
	except Exception:
		return defaults

	return {
		"sidebar_collapsed": cint(doc.sidebar_collapsed),
		"pinned_workspaces": _parse_json_list(doc.pinned_workspaces),
		"theme_mode": _get_desk_theme(user),
		"font_size": _clamp_int(doc.font_size, *FONT_SIZE_RANGE),
		"accent_color": _hex_or_none(doc.accent_color),
		"font_family": doc.font_family or None,
		"radius_preset": doc.radius_preset or None,
		"density": doc.density or None,
		"icon_size": _clamp_int(doc.icon_size, *ICON_SIZE_RANGE),
		"icon_style": doc.icon_style or None,
		"sidebar_theme": doc.sidebar_theme or None,
		"sidebar_bg": _hex_or_none(doc.sidebar_bg),
		"text_styles": _text_styles(doc.text_styles),
		"chart_palette": doc.get("chart_palette") or None,
		"chart_colors": _chart_colors(doc.get("chart_colors")),
		"sidebar_art": doc.get("sidebar_art") or None,
		"sidebar_art_colors": _chart_colors(doc.get("sidebar_art_colors")),
		"activity_display": doc.get("activity_display") or None,
		"form_panel_side": doc.get("form_panel_side") or None,
		"use_theme": doc.get("use_theme") or None,
		"desk_state": _desk_state(doc.get("desk_state")),
		"department": doc.get("department") or None,
	}


DESK_STATE_LIMIT = 32 * 1024


def _desk_state(value):
	"""The desk's own memory of where the user left things: a dict of dicts
	(workspaces → tab / dashboard, widgets → period / comparison, forms →
	the record panel folded or not). Anything else, or anything oversized,
	is dropped."""
	if not value:
		return {}
	try:
		data = json.loads(value) if isinstance(value, str) else value
	except ValueError:
		return {}
	if not isinstance(data, dict):
		return {}
	out = {}
	for section in ("workspaces", "widgets", "dashboards", "lists", "prints", "forms"):
		part = data.get(section)
		if isinstance(part, dict):
			out[section] = {str(k)[:140]: v for k, v in part.items() if isinstance(v, dict)}
	if out and isinstance(data.get("updated"), (int, float)):
		out["updated"] = int(data["updated"])  # lets a browser tell which copy is newer
	return out


@frappe.whitelist()
def get_theme_settings():
	return get_theme_settings_dict()


@frappe.whitelist()
def update_theme_settings(values):
	frappe.only_for("System Manager")
	values = frappe.parse_json(values) or {}
	doc = frappe.get_single("Theme Settings")

	for fieldname, value in values.items():
		if fieldname not in THEME_FIELDS:
			continue
		if fieldname == "text_styles":
			styles = _text_styles(value)
			value = json.dumps(styles) if styles else None
		if fieldname == "chart_colors":
			colors = _chart_colors(value)
			value = ",".join(colors) if colors else None
		if fieldname == "sidebar_art_colors":
			colors = _chart_colors(value)
			value = ",".join(colors) if colors else None
		if fieldname == "enable_theme":
			# the Customizer sends On / Off (or 1 / 0); a Check wants 1 or 0
			value = 0 if str(value).strip().lower() in ("0", "off", "false", "no", "") else 1
		doc.set(fieldname, value)

	doc.save()
	frappe.clear_cache(doctype="Theme Settings")
	return get_theme_settings_dict()


@frappe.whitelist()
def get_preferences():
	return get_user_prefs()


@frappe.whitelist()
def save_pref(key, value):
	if frappe.session.user == "Guest":
		frappe.throw("Login required")

	if key not in PREF_FIELDS:
		frappe.throw(f"Unsupported preference: {key}")

	value = frappe.parse_json(value)
	doc = _get_or_create_pref_doc(frappe.session.user)
	_set_pref(doc, key, value)
	doc.save(ignore_permissions=True)
	frappe.clear_document_cache("Themate User Preference", frappe.session.user)
	return get_user_prefs()


@frappe.whitelist()
def save_prefs(values):
	"""The Theme Customizer's Apply: every preference in one write."""
	if frappe.session.user == "Guest":
		frappe.throw("Login required")

	values = frappe.parse_json(values) or {}
	doc = _get_or_create_pref_doc(frappe.session.user)
	for key, value in values.items():
		if key not in PREF_FIELDS:
			frappe.throw(f"Unsupported preference: {key}")
		_set_pref(doc, key, value)

	doc.save(ignore_permissions=True)
	frappe.clear_document_cache("Themate User Preference", frappe.session.user)
	return get_user_prefs()


@frappe.whitelist()
def reset_prefs():
	"""Back to the site defaults for everything the customizer owns."""
	if frappe.session.user == "Guest":
		frappe.throw("Login required")

	if frappe.db.exists("Themate User Preference", frappe.session.user):
		doc = frappe.get_doc("Themate User Preference", frappe.session.user)
		# "use_theme" stays: Reset is about looks, and must not flip the theme
		# off at the next load for someone who forced it on over a site that
		# has it off.
		for key in PREF_FIELDS - {"sidebar_collapsed", "pinned_workspaces", "theme_mode", "use_theme"}:
			doc.set(key, None)
		doc.save(ignore_permissions=True)
		frappe.clear_document_cache("Themate User Preference", frappe.session.user)
	return get_user_prefs()


NATIVE_ITEMS = ("Heading", "Chart", "Number Card")


def _dashboard_allowed(name):
	"""A dashboard another app hides from this user (InnoDash: by role,
	through the themate_dashboard_filter hook) is not readable by name."""
	rows = [{"name": name}]
	for method in frappe.get_hooks("themate_dashboard_filter") or []:
		rows = frappe.get_attr(method)(rows) or []
	return any(r.get("name") == name for r in rows)


@frappe.whitelist()
def get_workspace_dashboards(workspace=None, module=None):
	"""The dashboards a workspace leads to (the strip under its head,
	public/js/workspace/dashboards.js) or that sit beside one dashboard (the
	switcher on its page). A workspace's Workspace Panel states them, in its
	order, each with the panel's content (themate/panels.py); without one,
	the dashboards of its module (Home: of no module). Other apps hide what
	this user may not see (hook themate_dashboard_filter(rows) -> rows) and
	may label a row (`kind`: InnoDash's Management / Desk)."""
	from themate.panels import module_rows, panel_rows

	if not frappe.has_permission("Dashboard", "read"):
		return []
	if workspace and not frappe.db.exists("Workspace", workspace):
		return []
	panel = frappe.get_cached_doc("Workspace Panel", workspace) if workspace and frappe.db.exists("Workspace Panel", workspace) else None
	if panel and not panel.enabled:
		return []
	try:
		rows = panel_rows(panel) if panel else module_rows(workspace, module)
		for method in frappe.get_hooks("themate_dashboard_filter") or []:
			rows = frappe.get_attr(method)(rows) or []
	except Exception:
		# an intermittent failure here never reached the Error Log: keep its trace in logs/themate.log
		frappe.logger("themate").exception(f"get_workspace_dashboards({workspace!r})")
		raise
	return [{
		"name": r["name"], "label": _(r["name"]), "kind": r.get("kind"), "module": r.get("module"),
		"native": 1 if r.get("native") else 0, "is_default": 1 if panel and r.get("is_default") else 0, "panel": r.get("panel"),
	} for r in rows]


@frappe.whitelist()
def get_searchable_dashboards():
	"""Every dashboard this user may open, for the awesomebar (core/search.js).
	Frappe's boot.dashboards is every Dashboard, unfiltered; this one passes
	the same gate as the workspace strip and the page itself."""
	if not frappe.has_permission("Dashboard", "read"):
		return []
	rows = frappe.get_list("Dashboard", fields=["name"], order_by="name asc", limit_page_length=500)
	for method in frappe.get_hooks("themate_dashboard_filter") or []:
		rows = frappe.get_attr(method)(rows) or []
	return [{"name": r["name"]} for r in rows]


LINK_COUNT_LIMIT = 60
LINK_COUNT_SECONDS = 60


def _link_count_rule(meta):
	"""What a link's number means, the way a shortcut's does: the open ones
	when the document has an Open status (Leave Application, Issue), the
	pending ones, the active ones (Employee), the drafts of a submittable document, else all records
	(Company, Department)."""
	status = meta.get_field("status")
	options = (status.options or "").split("\n") if status and status.fieldtype == "Select" else []
	for wanted in ("Open", "Pending", "Active"):
		if wanted in options:
			return [["status", "=", wanted]], wanted
	if meta.is_submittable:
		return [["docstatus", "=", 0]], "Draft"
	return [], ""


@frappe.whitelist()
def get_link_counts(doctypes):
	"""One number per link on a workspace's link panels (workspace/records.js),
	counted with the reader's own permissions through frappe.get_list, so a
	link never shows more than its list would. Cached a minute per user and
	per set of roles and User Permissions, so a permission change is seen on
	the next request."""
	import hashlib

	from frappe.permissions import get_user_permissions

	if isinstance(doctypes, str):
		try:
			doctypes = json.loads(doctypes)
		except ValueError:
			return {}
	if not isinstance(doctypes, list):
		return {}
	doctypes = [d for d in dict.fromkeys(doctypes) if isinstance(d, str)][:LINK_COUNT_LIMIT]
	stamp = hashlib.md5((",".join(sorted(frappe.get_roles())) + json.dumps(get_user_permissions(frappe.session.user), sort_keys=True, default=str)).encode()).hexdigest()[:10]
	out = {}
	for dt in doctypes:
		key = f"tm_link_count:{frappe.session.user}:{stamp}:{dt}"
		hit = frappe.cache().get_value(key)
		if hit is not None:
			out[dt] = hit
			continue
		if not frappe.db.exists("DocType", dt) or not frappe.has_permission(dt, "read"):
			continue
		meta = frappe.get_meta(dt)
		if meta.issingle or meta.istable:
			continue
		filters, label = _link_count_rule(meta)
		try:
			rows = frappe.get_list(dt, fields=["count(*) as n"], filters=filters, limit_page_length=1)
		except Exception:
			continue
		# the kind, untranslated: the desk words it ("{0} open"), since Frappe's
		# own "Open" is the verb ("فتح"), not the state
		value = {"count": cint(rows[0].n) if rows else 0, "label": label}
		frappe.cache().set_value(key, value, expires_in_sec=LINK_COUNT_SECONDS)
		out[dt] = value
	return out


def _module_workspace(module):
	"""Where "Back to workspace" goes when the page was not opened from one:
	the module's top-level public workspace, else Home."""
	if module:
		name = frappe.db.get_value("Workspace", {"module": module, "public": 1, "parent_page": ["is", "not set"]}, "name", order_by="sequence_id asc")
		if name:
			return name
	return "Home" if frappe.db.exists("Workspace", "Home") else None


@frappe.whitelist()
def get_dashboard_layout(name):
	"""The narrated layout of a Dashboard (Themate Layout table): headings
	with a note, charts and number cards in order, each with a width, plus
	whatever item types other apps add to the table (InnoDash's "Widget").
	Charts and cards the user may not read are dropped, the way
	frappe.desk.doctype.dashboard.dashboard.get_permitted_charts does; for
	other types the owning app decides through the hook
	themate_dashboard_item_check(row) -> bool."""
	if not frappe.has_permission("Dashboard", "read"):
		return {"intro": "", "items": []}
	meta = frappe.get_meta("Dashboard")
	if not meta.has_field("tm_layout"):
		return {"intro": "", "items": []}
	if not _dashboard_allowed(name):
		frappe.throw(_("You are not allowed to view this dashboard"), frappe.PermissionError)
	doc = frappe.get_cached_doc("Dashboard", name)
	checks = [frappe.get_attr(m) for m in (frappe.get_hooks("themate_dashboard_item_check") or [])]
	items = []
	for row in doc.get("tm_layout") or []:
		kind = row.item_type
		if kind == "Chart":
			if not row.chart or not frappe.db.exists("Dashboard Chart", row.chart):
				continue
			if not frappe.has_permission("Dashboard Chart", doc=row.chart):
				continue
		elif kind == "Number Card":
			if not row.number_card or not frappe.db.exists("Number Card", row.number_card):
				continue
			if not frappe.has_permission("Number Card", doc=row.number_card):
				continue
		elif kind == "Heading":
			if not row.heading:
				continue
		elif not checks or not all(check(row) for check in checks):
			continue  # an item type nobody claims, or one its app refused
		item = {k: v for k, v in row.as_dict().items() if not k.startswith("_") and k not in ("doctype", "parent", "parentfield", "parenttype", "idx", "docstatus", "name", "owner", "creation", "modified", "modified_by")}
		item["width"] = row.width or ("Half" if kind == "Chart" else "Third")
		items.append(item)
	# a heading with nothing under it, and a layout of headings only, are no layout
	kept = []
	for i, item in enumerate(items):
		if item["item_type"] == "Heading":
			nxt = items[i + 1] if i + 1 < len(items) else None
			if not nxt or nxt["item_type"] == "Heading":
				continue
		kept.append(item)
	if not any(i["item_type"] != "Heading" for i in kept):
		kept = []
	# the segment bar: dimensions another app declares for this dashboard
	# (hook themate_dashboard_segments(name) -> {"segments": [...], "mine": bool, "mine_locked": bool})
	segments, mine, mine_locked = [], False, False
	for method in frappe.get_hooks("themate_dashboard_segments") or []:
		got = frappe.get_attr(method)(name) or {}
		segments += [x for x in got.get("segments") or [] if isinstance(x, dict) and x.get("field")]
		mine = mine or bool(got.get("mine"))
		mine_locked = mine_locked or bool(got.get("mine_locked"))
	return {
		"intro": doc.get("tm_intro") or "", "items": kept, "segments": segments, "mine": mine or mine_locked, "mine_locked": mine_locked,
		# a layout whose every card was withheld is not a plain Frappe dashboard:
		# the page says so instead of falling back to "No Permitted Charts"
		"has_layout": 1 if doc.get("tm_layout") else 0,
		"module": doc.module, "workspace": _module_workspace(doc.module),
	}


@frappe.whitelist()
def get_dashboard_insights(name, segments=None):
	"""The sentences under a dashboard's title: what stands out in its cards
	right now, for this user and segment. Other apps write them (hook
	themate_dashboard_insights(name, segments) -> [{severity, text, widget}]);
	the theme only draws them."""
	if not frappe.has_permission("Dashboard", "read") or not frappe.db.exists("Dashboard", name) or not _dashboard_allowed(name):
		return []
	if isinstance(segments, str):
		segments = frappe.parse_json(segments) if segments.strip() and segments.strip() != "null" else None
	out = []
	for method in frappe.get_hooks("themate_dashboard_insights") or []:
		try:
			out += [i for i in (frappe.get_attr(method)(name, segments) or []) if isinstance(i, dict) and i.get("text")]
		except Exception:
			frappe.log_error(title=f"Dashboard insights {name}")
	return out


@frappe.whitelist()
def get_chart_annotations(chart=None):
	"""Marks for a chart: its own and the company-wide ones (blank chart).
	Drawn by charts/adapter.js as dashed lines on time-series charts."""
	if not frappe.db.exists("DocType", "Themate Chart Annotation"):
		return []
	key = f"themate_chart_annotations:{chart or ''}"
	cached = frappe.cache().get_value(key)
	if cached is not None:
		return cached
	filters = [["chart", "is", "not set"]]
	if chart:
		filters = None
	rows = frappe.get_all(
		"Themate Chart Annotation",
		filters=filters,
		or_filters=[["chart", "=", chart], ["chart", "is", "not set"]] if chart else None,
		fields=["name", "date", "label", "note", "chart", "color"],
		order_by="date asc",
		limit_page_length=200,
	)
	out = [dict(r, date=str(r.date)) for r in rows]
	frappe.cache().set_value(key, out, expires_in_sec=120)
	return out


TOTAL_FIELDS = ("grand_total", "base_grand_total", "total", "total_amount", "amount", "paid_amount", "net_total")
DATE_FIELDS = ("posting_date", "transaction_date", "date", "due_date", "start_date", "creation")


@frappe.whitelist()
def get_link_summary(doctype, filters):
	"""Totals for the documents linked to a record (form 360 panel,
	public/js/core/form_360.js): count, the sum of the first money field the
	doctype has, the outstanding sum where there is one, split by `status`
	when the doctype has that field. Cancelled documents are left out.
	Runs through frappe.get_list, so the user's permissions apply."""
	filters = frappe.parse_json(filters) if isinstance(filters, str) else filters
	meta = frappe.get_meta(doctype)
	if not frappe.has_permission(doctype, "read"):
		return {"count": 0, "rows": []}
	total_field = next((f for f in TOTAL_FIELDS if meta.has_field(f)), None)
	date_field = next((f for f in DATE_FIELDS if f == "creation" or meta.has_field(f)), "creation")
	has_status = meta.has_field("status")
	has_outstanding = meta.has_field("outstanding_amount")
	if isinstance(filters, dict):
		filters = [[doctype, k, "=", v] for k, v in filters.items()]
	# A dashboard filter field may sit on a child table (item_code on Sales
	# Invoice Item): point the filter at that child. A field found nowhere (a
	# dynamic-link key such as quotation_to) is dropped, as the list view does.
	resolved = []
	for f in filters or []:
		f = list(f)
		if len(f) == 4 and f[0] == doctype and f[1] != "name" and not meta.has_field(f[1]):
			child = next((df.options for df in meta.get_table_fields() if frappe.get_meta(df.options).has_field(f[1])), None)
			if not child:
				continue
			f[0] = child
		resolved.append(f)
	filters = resolved
	if meta.is_submittable:
		filters.append([doctype, "docstatus", "!=", 2])
	# A child-table filter joins the child, one row per matching child row:
	# an invoice with three items from the same order would count three times
	# and add its total three times. Find the matching documents first, then
	# total each once (grouped by name, as Frappe's list view does).
	if any(len(f) == 4 and f[0] != doctype for f in filters):
		names = frappe.get_list(doctype, filters=filters, pluck="name", group_by=f"`tab{doctype}`.`name`")
		if not names:
			return {"count": 0, "rows": []}
		filters = [[doctype, "name", "in", names]]
	fields = ["count(*) as n"]
	if total_field:
		fields.append(f"sum(`{total_field}`) as v")
	if has_outstanding:
		fields.append("sum(`outstanding_amount`) as o")
	if has_status:
		rows = frappe.get_list(doctype, fields=fields + ["`status` as k"], filters=filters, group_by="`status`", order_by="n desc")
	else:
		rows = frappe.get_list(doctype, fields=fields, filters=filters)
	rows = [r for r in rows if r.get("n")]
	currency = None
	if total_field and meta.get_field(total_field).fieldtype == "Currency":
		currency = frappe.defaults.get_global_default("currency")
	return {
		"doctype": doctype,
		"total_field": total_field,
		"date_field": date_field,
		"currency": currency,
		"has_status": has_status,
		"has_outstanding": has_outstanding,
		"count": sum(cint(r.n) for r in rows),
		"total": sum(flt(r.get("v")) for r in rows) if total_field else None,
		"outstanding": sum(flt(r.get("o")) for r in rows) if has_outstanding else None,
		"rows": [{"status": r.get("k"), "count": cint(r.n), "total": flt(r.get("v")) if total_field else None, "outstanding": flt(r.get("o")) if has_outstanding else None} for r in rows],
	}


# What a linked-document filter offers (public/js/core/linked_filters.js): the
# field types a person filters by. Long text, code, attachments, tables and
# passwords are left out; so is amended_from, a link to the doctype itself.
LINKED_FILTER_TYPES = frozenset((
	"Data", "Link", "Dynamic Link", "Select", "Autocomplete", "Int", "Float", "Currency", "Percent",
	"Date", "Datetime", "Time", "Duration", "Check", "Rating", "Phone", "Small Text", "Read Only",
))


@frappe.whitelist()
def get_linked_filter_fields(doctype):
	"""The fields of the documents `doctype` links to, so its list can be
	filtered by one of them: Leave Application by its Employee's department.

	`links` is one entry per visible Link field of `doctype` (fieldname,
	label, target doctype); `doctypes` holds each target's filterable fields
	once, however many links point at it (Sales Invoice links to Account ten
	times). A target the user cannot read, a child table or a Single is left
	out, and so is any field above the permission levels the user can read.
	Nothing here filters anything: the list resolves a condition through
	frappe.get_list on the target, under the user's own permissions."""
	meta = frappe.get_meta(doctype)
	if not frappe.has_permission(doctype, "read"):
		return {"links": [], "doctypes": {}}
	links, doctypes = [], {}
	for df in meta.get_link_fields():
		target = df.options
		if df.hidden or df.is_virtual or df.fieldname == "amended_from" or not target:
			continue
		if target not in doctypes:
			doctypes[target] = _linked_fields(target)
		if doctypes[target]:
			links.append({"fieldname": df.fieldname, "label": df.label, "doctype": target})
	return {"links": links, "doctypes": {k: v for k, v in doctypes.items() if v}}


def _linked_fields(doctype):
	try:
		meta = frappe.get_meta(doctype)
	except frappe.DoesNotExistError:
		return []  # a link to a doctype of an app that is not installed
	if meta.istable or meta.issingle or not frappe.has_permission(doctype, "read"):
		return []
	levels = set(meta.get_permlevel_access("read")) | {0}
	return [
		{"fieldname": f.fieldname, "label": f.label, "fieldtype": f.fieldtype, "options": f.options}
		for f in meta.fields
		if f.fieldtype in LINKED_FILTER_TYPES and not f.hidden and not f.is_virtual and (f.permlevel or 0) in levels
	]


def _set_pref(doc, key, value):
	if key == "sidebar_collapsed":
		doc.sidebar_collapsed = cint(value)
	elif key == "pinned_workspaces":
		doc.pinned_workspaces = json.dumps(_ensure_list(value))
	elif key == "font_size":
		doc.font_size = _clamp_int(value, *FONT_SIZE_RANGE)
	elif key == "icon_size":
		doc.icon_size = _clamp_int(value, *ICON_SIZE_RANGE)
	elif key == "accent_color":
		doc.accent_color = _hex_or_none(value)
	elif key == "sidebar_bg":
		doc.sidebar_bg = _hex_or_none(value)
	elif key == "text_styles":
		styles = _text_styles(value)
		doc.text_styles = json.dumps(styles) if styles else None
	elif key == "chart_colors":
		colors = _chart_colors(value)
		doc.chart_colors = json.dumps(colors) if colors else None
	elif key == "sidebar_art_colors":
		colors = _chart_colors(value)
		doc.sidebar_art_colors = json.dumps(colors) if colors else None
	elif key == "department":
		# only "All" or one of the person's own departments
		from themate.themate.doctype.themate_department.themate_department import boot_departments

		mine = {d["name"] for d in boot_departments()["list"]}
		doc.department = value if value == "All" or value in mine else None
	elif key == "desk_state":
		state = _desk_state(value)
		dumped = json.dumps(state) if state else None
		doc.desk_state = dumped if not dumped or len(dumped) <= DESK_STATE_LIMIT else None
	elif key in PREF_OPTIONS:
		doc.set(key, value if value in PREF_OPTIONS[key] else None)
	elif key == "theme_mode":
		value = _normalize_mode(value)
		doc.theme_mode = value or None
		# Frappe's own theme dialog writes User.desk_theme
		# (frappe.core.doctype.user.user.switch_theme). Writing through to the
		# same field keeps ONE effective store: whichever UI the user changes
		# the theme in, the other reads the same value back. Without this the
		# two drift and a choice made in one place is silently undone by the
		# other on the next page load.
		if value:
			frappe.db.set_value("User", frappe.session.user, "desk_theme", _to_frappe_mode(value))


# Themate's Select historically offered "Auto"; Frappe's User.desk_theme uses
# "Automatic". Both are accepted and normalised so neither UI can store a value
# the other cannot read.
_MODE_ALIASES = {
	"light": "Light",
	"dark": "Dark",
	"auto": "Auto",
	"automatic": "Auto",
}


def _normalize_mode(value):
	if not value:
		return None
	return _MODE_ALIASES.get(str(value).strip().lower())


def _to_frappe_mode(value):
	"""Themate's vocabulary -> the Literal values User.desk_theme accepts."""
	return "Automatic" if value == "Auto" else value


def _get_desk_theme(user):
	"""The user's own saved theme, or None if they have never chosen.

	Deliberately reads the raw column rather than bootinfo: frappe.sessions
	collapses a null into "Light" (sessions.py:184), which would make "never
	chose" indistinguishable from "chose Light" and let the site default
	override a real user preference.
	"""
	try:
		return _normalize_mode(frappe.db.get_value("User", user, "desk_theme"))
	except Exception:
		return None


def _get_or_create_pref_doc(user):
	if frappe.db.exists("Themate User Preference", user):
		return frappe.get_doc("Themate User Preference", user)

	return frappe.get_doc(
		{
			"doctype": "Themate User Preference",
			"user": user,
		}
	).insert(ignore_permissions=True)


def _get_legacy_sidebar_prefs(user):
	defaults = PREF_DEFAULTS.copy()
	defaults["theme_mode"] = _get_desk_theme(user)
	try:
		settings = frappe.db.get_value("User", user, "sidebar_settings")
	except Exception:
		return defaults

	if not settings:
		return defaults

	try:
		settings = frappe.parse_json(settings)
	except Exception:
		return defaults

	defaults["sidebar_collapsed"] = cint(settings.get("collapsed"))
	return defaults


def _parse_json_list(value):
	if not value:
		return []

	try:
		return _ensure_list(frappe.parse_json(value))
	except Exception:
		return []


def _ensure_list(value):
	if isinstance(value, list):
		return value
	return []

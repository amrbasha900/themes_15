"""Calendar: what an event shows, and which days are the weekend.

Frappe's calendar (frappe/public/js/frappe/views/calendar/calendar.js) draws
an event as its title and nothing else, and hard-codes the weekend as
Saturday and Sunday — FullCalendar v3's `weekends: false` hides exactly
those two days (fullcalendar.min.js pushes 0 and 6). A desk whose weekend is
Friday and Saturday, or Friday alone, had to patch the library.

Here both are settings:

- **Theme Settings > Calendar > Weekend**: the site's weekend days, shaded in
  every calendar and hidden by its Hide Weekends button (FullCalendar's own
  `hiddenDays`, so the library is not patched).
- **Calendar Layout** (one per document type, or per saved Calendar View):
  the fields drawn under the title and how (a value, a number alone, a
  progress bar, a badge), card or single-line events, the colour, the event's
  own title/start/end fields, and optionally a weekend of its own.

Read by public/js/core/calendar.js (the API is themate.calendars.get_calendar_layout).
"""

import frappe
from frappe.utils import cint

WEEKDAYS = ("sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday")
# The weekend a site has before anyone sets one: the deployments this theme
# is built for rest on Friday and Saturday.
DEFAULT_WEEKEND = ("friday", "saturday")

EVENT_STYLES = ("Card", "Single Line")
COLOR_BY = ("Calendar Default", "Status", "Fixed Color")
DISPLAYS = ("Value", "Number", "Progress Bar", "Badge")


def site_weekend():
	"""Theme Settings > Calendar > Weekend as FullCalendar day numbers
	(0 = Sunday). Raw reads: a site that has not migrated the fields yet has
	no rows, and must get the default weekend, not an empty one."""
	from themate.api import _flag

	return [i for i, day in enumerate(WEEKDAYS) if _flag(f"weekend_{day}", 1 if day in DEFAULT_WEEKEND else 0)]


def _layout_weekend(doc):
	return [i for i, day in enumerate(WEEKDAYS) if cint(doc.get(f"weekend_{day}"))]


def _find_layout(doctype, calendar_view=None):
	"""The layout for this calendar: the one made for the saved Calendar View,
	else the document type's own."""
	filters = {"reference_doctype": doctype, "enabled": 1}
	if calendar_view:
		name = frappe.db.get_value("Calendar Layout", {**filters, "calendar_view": calendar_view})
		if name:
			return frappe.get_cached_doc("Calendar Layout", name)
	name = frappe.db.get_value("Calendar Layout", {**filters, "calendar_view": ("is", "not set")})
	return frappe.get_cached_doc("Calendar Layout", name) if name else None


def layout_dict(doc):
	return {
		"name": doc.name,
		"event_style": doc.event_style if doc.event_style in EVENT_STYLES else EVENT_STYLES[0],
		"title_field": doc.title_field or None,
		"start_date_field": doc.start_date_field or None,
		"end_date_field": doc.end_date_field or None,
		"all_day": _is_date_only(doc.reference_doctype, doc.start_date_field),
		"color_by": doc.color_by if doc.color_by in COLOR_BY else COLOR_BY[0],
		"event_color": doc.event_color if doc.color_by == "Fixed Color" else None,
		"fields": [
			{
				"fieldname": row.fieldname,
				"label": row.label or None,
				"display": row.display if row.display in DISPLAYS else DISPLAYS[0],
				"bold": cint(row.bold),
				"hide_if_empty": cint(row.hide_if_empty),
			}
			for row in doc.fields
			if row.fieldname
		],
	}


def _is_date_only(doctype, fieldname):
	if not fieldname:
		return 0
	df = frappe.get_meta(doctype).get_field(fieldname)
	return 1 if df and df.fieldtype == "Date" else 0


@frappe.whitelist()
def get_calendar_layout(doctype: str, calendar_view: str | None = None) -> dict:
	"""The layout and weekend a calendar of `doctype` is drawn with. Nothing
	but configuration, and only for someone who may read the document type."""
	if not frappe.has_permission(doctype, "read"):
		return {"layout": None, "weekend": site_weekend()}

	doc = _find_layout(doctype, calendar_view)
	weekend = _layout_weekend(doc) if doc and cint(doc.own_weekend) else site_weekend()
	return {"layout": layout_dict(doc) if doc else None, "weekend": weekend}


def boot_calendars():
	"""Document types that have a calendar only through a layout (their
	Starts On is set here): the Desk offers the Calendar view for a document
	type only when frappe.views.calendar[doctype] exists, which a document
	type without its own *_calendar.js never has. The client registers these."""
	try:
		rows = frappe.get_all(
			"Calendar Layout",
			filters={"enabled": 1, "calendar_view": ("is", "not set"), "start_date_field": ("is", "set")},
			fields=["reference_doctype", "title_field", "start_date_field", "end_date_field"],
		)
	except Exception:
		# before the migration that creates the table
		return {}
	out = {}
	for r in rows:
		if not frappe.has_permission(r.reference_doctype, "read"):
			continue
		out[r.reference_doctype] = {
			"start": r.start_date_field,
			"end": r.end_date_field or r.start_date_field,
			"title": r.title_field or None,
			"all_day": _is_date_only(r.reference_doctype, r.start_date_field),
		}
	return out

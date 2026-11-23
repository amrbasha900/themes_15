import frappe
from frappe import _
from frappe.model import no_value_fields
from frappe.model.document import Document

DATE_TYPES = ("Date", "Datetime")
# Standard columns every document has, offered beside the document type's own
STD_FIELDS = ("name", "owner", "creation", "modified", "modified_by", "docstatus")
STD_DATES = ("creation", "modified")


class CalendarLayout(Document):
	def autoname(self):
		# One layout per calendar: the document type's own, or one saved view.
		self.name = f"{self.reference_doctype} - {self.calendar_view}" if self.calendar_view else self.reference_doctype

	def validate(self):
		meta = frappe.get_meta(self.reference_doctype)
		if meta.istable or meta.issingle:
			frappe.throw(_("{0} has no list of records, so it has no calendar.").format(_(self.reference_doctype)))

		if self.calendar_view:
			view_doctype = frappe.db.get_value("Calendar View", self.calendar_view, "reference_doctype")
			if view_doctype != self.reference_doctype:
				frappe.throw(
					_("The saved calendar {0} belongs to {1}, not {2}.").format(
						frappe.bold(self.calendar_view), _(view_doctype or "?"), _(self.reference_doctype)
					)
				)

		def check(fieldname, label, dates_only=False):
			if not fieldname:
				return
			if fieldname in STD_FIELDS:
				if dates_only and fieldname not in STD_DATES:
					frappe.throw(_("{0} must be a date field.").format(_(label)))
				return
			df = meta.get_field(fieldname)
			if not df or df.fieldtype in no_value_fields:
				frappe.throw(_("{0}: {1} is not a field of {2}.").format(_(label), frappe.bold(fieldname), _(self.reference_doctype)))
			if dates_only and df.fieldtype not in DATE_TYPES:
				frappe.throw(_("{0} must be a date field.").format(_(label)))

		check(self.title_field, "Title")
		check(self.start_date_field, "Starts On", dates_only=True)
		check(self.end_date_field, "Ends On", dates_only=True)
		if self.end_date_field and not self.start_date_field:
			frappe.throw(_("Set Starts On as well as Ends On."))
		for row in self.fields:
			check(row.fieldname, _("Row {0}").format(row.idx) + " " + _("Field"))

		if self.own_weekend and all(self.get(f"weekend_{d}") for d in ("sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday")):
			frappe.throw(_("A weekend cannot be every day of the week."))

	def on_update(self):
		self._clear()

	def on_trash(self):
		self._clear()

	def _clear(self):
		# The boot payload lists the document types that have a calendar only
		# through a layout (themate.calendars.boot_calendars), cached per user.
		frappe.cache.delete_key("bootinfo")


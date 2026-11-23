import frappe
from frappe.model.document import Document


class ThemateUserPreference(Document):
	def validate(self):
		if self.pinned_workspaces:
			frappe.parse_json(self.pinned_workspaces)

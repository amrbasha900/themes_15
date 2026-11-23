"""The Business Overview widget engine moved to the InnoDash app
(2026-09-18): the doctype "Themate Widget" became "InnoDash Widget".

With InnoDash installed its own pre-sync patch renames the doctype and keeps
every widget. Without it the old doctype would be an orphan (no controller,
no JSON), so it is dropped here, widgets included; the feature now needs
InnoDash."""

import frappe


def execute():
	if not frappe.db.exists("DocType", "Themate Widget"):
		return
	if "innodash" in frappe.get_installed_apps():
		return
	frappe.delete_doc("DocType", "Themate Widget", ignore_permissions=True, force=True)
	frappe.db.commit()

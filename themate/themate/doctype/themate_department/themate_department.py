"""A department of the sidebar (js/sidebar/modern_sidebar.js): a named set
of workspaces, in order, for the people holding any of its roles; a row's
Category puts it under a heading of its own inside the department. Someone
with two or more departments switches between them at the top of the
sidebar; the choice is their preference (Themate User Preference >
Department). Nothing here grants access: the sidebar draws only workspaces
Frappe already lets the person open (boot.allowed_workspaces).
Read by boot_departments() into boot.themate.departments."""

import frappe
from frappe import _
from frappe.model.document import Document


class ThemateDepartment(Document):
	def validate(self):
		listed = [row.workspace for row in self.workspaces]
		if len(listed) != len(set(listed)):
			frappe.throw(_("A workspace is listed twice"))
		if self.default_workspace and self.default_workspace not in listed:
			frappe.throw(_("{0} is not one of this department's workspaces").format(self.default_workspace))

	def on_update(self):
		frappe.cache.delete_key("bootinfo")  # boot carries each person's departments

	def on_trash(self):
		frappe.cache.delete_key("bootinfo")


def boot_departments(user=None):
	"""The enabled departments this person gets, in order, and every
	workspace that belongs to any enabled department (`assigned`), so the
	sidebar knows which leftovers are another department's."""
	if not frappe.db.table_exists("Themate Department"):
		return {"list": [], "assigned": []}
	rows = frappe.get_all(
		"Themate Department",
		filters={"enabled": 1},
		fields=["name", "icon", "color", "default_workspace"],
		order_by="sequence asc, name asc",
	)
	if not rows:
		return {"list": [], "assigned": []}
	names = [r.name for r in rows]
	roles, spaces, cats = {}, {}, {}
	for r in frappe.get_all("Has Role", filters={"parenttype": "Themate Department", "parent": ["in", names]}, fields=["parent", "role"]):
		roles.setdefault(r.parent, set()).add(r.role)
	for r in frappe.get_all(
		"Themate Department Workspace",
		filters={"parenttype": "Themate Department", "parent": ["in", names]},
		fields=["parent", "workspace", "category"],
		order_by="idx asc",
	):
		spaces.setdefault(r.parent, []).append(r.workspace)
		if r.category and r.category.strip():
			cats.setdefault(r.parent, {})[r.workspace] = r.category.strip()

	mine = set(frappe.get_roles(user))
	out = []
	for r in rows:
		need = roles.get(r.name)
		if need and not (need & mine):
			continue
		out.append({
			"name": r.name,
			"icon": r.icon or "",
			"color": r.color or "",
			"workspaces": spaces.get(r.name, []),
			"categories": cats.get(r.name, {}),
			"default_workspace": r.default_workspace or "",
		})
	assigned = sorted({w for ws in spaces.values() for w in ws})
	return {"list": out, "assigned": assigned}

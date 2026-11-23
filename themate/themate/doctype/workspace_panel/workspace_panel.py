"""What a workspace shows above its own blocks (public/js/workspace/dashboards.js):
the dashboards it leads to, in order, and for each the panel's chart, figures
and lists that need attention — stated, not guessed. Read by
themate.api.get_workspace_dashboards; written once per workspace on migrate
(themate.panels.ensure_panels) and then left to whoever edits it."""

import frappe
from frappe import _
from frappe.model.document import Document

MAX = {"Figure": 3, "Attention": 4}


class WorkspacePanel(Document):
	def validate(self):
		listed = [row.dashboard for row in self.dashboards]
		if len(listed) != len(set(listed)):
			frappe.throw(_("A dashboard is listed twice"))
		if sum(1 for row in self.dashboards if row.is_default) > 1:
			frappe.throw(_("Only one dashboard can be the default"))
		seen = {}
		for row in self.items:
			if row.dashboard not in listed:
				frappe.throw(_("Row {0}: {1} is not one of this workspace's dashboards").format(row.idx, row.dashboard))
			if row.section == "Attention" and row.item_type != "InnoDash Widget":
				frappe.throw(_("Row {0}: a list that needs attention is an InnoDash Widget").format(row.idx))
			key = (row.dashboard, row.section)
			seen[key] = seen.get(key, 0) + 1
			if seen[key] > MAX.get(row.section, 0):
				frappe.throw(_("{0}: at most {1} rows of {2}").format(row.dashboard, MAX[row.section], _(row.section)))

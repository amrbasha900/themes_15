"""Workspace Panel: what a workspace shows above its blocks, stated.

The dashboards strip and the panel under it (public/js/workspace/dashboards.js)
used to work it out on every render — the module's dashboards, the first
chart block on the page, the first three figures of a layout — and the
guessing is what made them slow and, on a slow page, wrong. A Workspace
Panel states it: the dashboards in order (one default) and for each the
panel's chart, figures and lists that need attention.

ensure_panels writes one per workspace that leads to dashboards, once, from
what used to be guessed (other apps fill the content through the hook
themate_panel_defaults(dashboard) -> {chart, figures, attention}); after
that it is the Workspace Manager's, and a migrate never touches it again.
"""

import frappe
from frappe.utils import cint


def module_rows(workspace, module=None):
	"""The dashboards of a workspace's module (and on Home those of no
	module), sorted: narrated ones by sequence, then the standard ones, the
	one named after the workspace first. Not yet filtered for the reader."""
	home = workspace == "Home"
	if workspace:
		module = frappe.db.get_value("Workspace", workspace, "module")
	filters = ([["module", "=", module]] if module else []) + ([["module", "is", "not set"]] if home else [])
	if not filters:
		return []
	rows = frappe.get_list("Dashboard", fields=_fields(), or_filters=filters, order_by="is_default desc, name asc", limit_page_length=100)
	_mark_native(rows)
	rows.sort(key=lambda r: (r["native"], not cint(r.get("tm_sequence")), cint(r.get("tm_sequence")), r.get("name") != (workspace or ""), not r.get("is_default"), r.get("name")))
	return rows


def panel_rows(panel):
	"""The dashboards a Workspace Panel lists, in its order, with each one's
	stated content (`panel`): the chart, figures and attention lists, and the
	names of the workspace's own chart blocks that the panel's chart replaces."""
	listed = [r.dashboard for r in panel.dashboards]
	if not listed:
		return []
	found = {r["name"]: r for r in frappe.get_list("Dashboard", fields=_fields(), filters={"name": ["in", listed]}, limit_page_length=100)}
	rows = [found[name] for name in listed if name in found]
	_mark_native(rows)
	charts = frappe.get_all("Workspace Chart", filters={"parent": panel.workspace, "parenttype": "Workspace"}, fields=["name", "chart_name"])
	for row, conf in zip(rows, [r for r in panel.dashboards if r.dashboard in found]):
		items = [i for i in panel.items if i.dashboard == row["name"]]
		chart = {"doctype": conf.chart_type, "name": conf.chart} if conf.chart_type and conf.chart else None
		row["is_default"] = cint(conf.is_default)
		row["panel"] = {
			"chart": chart,
			"figures": [{"doctype": i.item_type, "name": i.item} for i in items if i.section == "Figure"],
			"attention": [{"doctype": i.item_type, "name": i.item} for i in items if i.section == "Attention"],
			# a workspace chart drawn in the panel is not drawn again below it
			"hide": [c.name for c in charts if chart and chart["doctype"] == "Dashboard Chart" and c.chart_name == chart["name"]],
		}
	return rows


def _fields():
	fields = ["name", "module", "is_default"]
	if frappe.get_meta("Dashboard").has_field("tm_sequence"):
		fields.append("tm_sequence")
	return fields


def _mark_native(rows):
	"""native: a dashboard with no Themate Layout, as ERPNext ships them."""
	names = [r["name"] for r in rows]
	laid_out = set(frappe.get_all("Themate Dashboard Item", filters={"parent": ["in", names], "parenttype": "Dashboard"}, pluck="parent", distinct=True)) if names else set()
	for r in rows:
		r["native"] = r["name"] not in laid_out


def ensure_panels():
	"""After migrate: a Workspace Panel for every public workspace that leads
	to dashboards and has none yet. Never rewrites an existing one."""
	if not frappe.db.exists("DocType", "Workspace Panel"):
		return
	have = set(frappe.get_all("Workspace Panel", pluck="workspace"))
	for ws in frappe.get_all("Workspace", filters={"public": 1}, fields=["name", "module"]):
		if ws.name in have:
			continue
		try:
			_create(ws.name)
		except Exception:
			frappe.log_error(title=f"Workspace Panel for {ws.name}")


def _create(workspace):
	rows = module_rows(workspace)
	for method in frappe.get_hooks("themate_dashboard_filter") or []:
		rows = frappe.get_attr(method)(rows) or []  # InnoDash labels Management / Desk
	if not rows:
		return None
	default = next((r for r in rows if r.get("kind") == "Management"), rows[0])["name"]
	own_chart = frappe.get_all("Workspace Chart", filters={"parent": workspace, "parenttype": "Workspace"}, pluck="chart_name", order_by="idx asc", limit=1)
	hooks = [frappe.get_attr(m) for m in frappe.get_hooks("themate_panel_defaults") or []]
	doc = frappe.new_doc("Workspace Panel")
	doc.workspace = workspace
	doc.enabled = 1
	for r in rows:
		spec = next((s for s in (h(r["name"]) for h in hooks) if s), None) or {}
		# the workspace's own chart is the panel's chart, as the design has it
		chart = {"doctype": "Dashboard Chart", "name": own_chart[0]} if own_chart else spec.get("chart")
		doc.append("dashboards", {
			"dashboard": r["name"], "is_default": 1 if r["name"] == default else 0,
			"chart_type": chart["doctype"] if chart else None, "chart": chart["name"] if chart else None,
		})
		for section, key in (("Figure", "figures"), ("Attention", "attention")):
			for item in spec.get(key) or []:
				doc.append("items", {"dashboard": r["name"], "section": section, "item_type": item["doctype"], "item": item["name"]})
	doc.insert(ignore_permissions=True)
	return doc.name

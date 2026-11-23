#!/usr/bin/env python3
"""The Workspace Panel (themate/panels.py, doctype Workspace Panel):

  * a migrate writes a panel once and never rewrites one that was edited;
  * the panel's order, default and stated content are what the strip gets,
    with the workspace's own chart blocks it replaces named in `hide`;
  * a disabled panel shows nothing;
  * the form refuses a dashboard twice, two defaults, more than three
    figures, and a "needs attention" row that is not an InnoDash Widget.

Needs a site; everything happens in one transaction that is rolled back:
    cd ../.. && env/bin/python apps/themate/tests/panels.test.py [site]
"""

import os
import sys

BENCH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
os.chdir(os.path.join(BENCH, "sites"))

import frappe  # noqa: E402

passed = failed = 0


def check(name, got, want):
	global passed, failed
	if got == want:
		passed += 1
		print(f"  ok   {name}")
	else:
		failed += 1
		print(f"  FAIL {name}\n       got  {got}\n       want {want}")


def refused(doc):
	try:
		doc.validate()
		return False
	except frappe.ValidationError:
		return True


frappe.init(site=sys.argv[1] if len(sys.argv) > 1 else "site.local", sites_path=".")
frappe.connect()
frappe.set_user("Administrator")
try:
	from themate.api import get_workspace_dashboards
	from themate.panels import ensure_panels

	ws = "Selling"
	if frappe.db.exists("Workspace Panel", ws):
		frappe.delete_doc("Workspace Panel", ws, force=True, ignore_permissions=True)
	ensure_panels()
	panel = frappe.get_doc("Workspace Panel", ws)
	check("a migrate writes the missing panel", bool(panel.dashboards), True)

	# edited by hand: the last dashboard first and the default, no items
	last = panel.dashboards[-1].dashboard
	for r in panel.dashboards:
		r.is_default = 1 if r.dashboard == last else 0
	panel.dashboards = [r for r in panel.dashboards if r.dashboard == last] + [r for r in panel.dashboards if r.dashboard != last]
	for i, r in enumerate(panel.dashboards, 1):
		r.idx = i  # Frappe keeps a child row's idx, not its place in the list
	panel.items = []
	panel.save(ignore_permissions=True)
	frappe.clear_document_cache("Workspace Panel", ws)
	ensure_panels()
	again = frappe.get_doc("Workspace Panel", ws)
	check("a second migrate leaves an edited panel alone", (again.dashboards[0].dashboard, len(again.items)), (last, 0))

	rows = get_workspace_dashboards(ws)
	check("the strip follows the panel's order", rows[0]["name"], last)
	check("and its default", [r["name"] for r in rows if r["is_default"]], [last])
	own = frappe.get_all("Workspace Chart", filters={"parent": ws}, fields=["name", "chart_name"])
	stated = again.dashboards[0].chart
	want = [c.name for c in own if c.chart_name == stated] if again.dashboards[0].chart_type == "Dashboard Chart" else []
	check("the workspace chart it draws is named for hiding", rows[0]["panel"]["hide"], want)

	again.enabled = 0
	again.save(ignore_permissions=True)
	frappe.clear_document_cache("Workspace Panel", ws)
	check("a disabled panel shows no dashboards", get_workspace_dashboards(ws), [])

	d = frappe.get_doc({"doctype": "Workspace Panel", "workspace": "Buying", "dashboards": [{"dashboard": "Buying"}, {"dashboard": "Buying"}]})
	check("a dashboard listed twice is refused", refused(d), True)
	d = frappe.get_doc({"doctype": "Workspace Panel", "workspace": "Buying", "dashboards": [{"dashboard": "Buying", "is_default": 1}, {"dashboard": "Purchasing Desk", "is_default": 1}]})
	check("two defaults are refused", refused(d), True)
	cards = frappe.get_all("Number Card", pluck="name", limit=4)
	if len(cards) == 4:
		d = frappe.get_doc({"doctype": "Workspace Panel", "workspace": "Buying", "dashboards": [{"dashboard": "Buying"}],
			"items": [{"dashboard": "Buying", "section": "Figure", "item_type": "Number Card", "item": c} for c in cards]})
		check("a fourth figure is refused", refused(d), True)
		d = frappe.get_doc({"doctype": "Workspace Panel", "workspace": "Buying", "dashboards": [{"dashboard": "Buying"}],
			"items": [{"dashboard": "Buying", "section": "Attention", "item_type": "Number Card", "item": cards[0]}]})
		check("a number card as a list that needs attention is refused", refused(d), True)
finally:
	frappe.db.rollback()
	frappe.clear_document_cache("Workspace Panel", "Selling")
	frappe.destroy()

print(f"\npanels: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)

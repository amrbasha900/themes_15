#!/usr/bin/env python3
"""What the number on a workspace link counts (themate.api._link_count_rule /
get_link_counts), against the real doctypes of a site:

  * Open where the status has it (Leave Application), then Pending (Material
    Request), then Active (Employee), then the drafts of a submittable
    document (Sales Invoice), else every record (Department);
  * counted through get_list, so a doctype the reader may not open gets no
    number at all.

Needs a site (ERPNext + HRMS installed); nothing is written:
    cd ../.. && env/bin/python apps/themate/tests/link_counts.test.py [site]
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


frappe.init(site=sys.argv[1] if len(sys.argv) > 1 else "site.local", sites_path=".")
frappe.connect()
try:
	from themate.api import _link_count_rule, get_link_counts

	for dt, want in (("Leave Application", "Open"), ("Material Request", "Pending"), ("Employee", "Active"), ("Sales Invoice", "Draft"), ("Department", "")):
		if frappe.db.exists("DocType", dt):
			check(f"{dt} counts {want or 'every record'}", _link_count_rule(frappe.get_meta(dt))[1], want)
	frappe.set_user("Guest")
	check("a reader who may not open a doctype gets no number", get_link_counts(["Sales Invoice"]), {})
	frappe.set_user("Administrator")
	got = get_link_counts(["Department"]).get("Department", {})
	check("a total is a count without a kind", (got.get("count") == frappe.db.count("Department"), got.get("label")), (True, ""))
	check("only a list is accepted", get_link_counts("not a list"), {})
finally:
	frappe.destroy()

print(f"\nlink counts: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)

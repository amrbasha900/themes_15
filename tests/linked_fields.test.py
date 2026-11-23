#!/usr/bin/env python3
"""themate.api.get_linked_filter_fields: what a list may filter by, one link away.

Its answer becomes filter rows (public/js/core/linked_filters.js), and every
condition on them runs frappe.get_list on the linked doctype. So it must not
offer a doctype the user cannot read, a field above the permission levels
they can read, or a target get_list cannot query (a child table, a Single,
a doctype whose app is not installed). It should also send each target's
fields once: Sales Invoice links to Account ten times.

Runs without a bench: python3 tests/linked_fields.test.py
"""

import importlib
import os
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class DF(dict):
	__getattr__ = dict.get


def df(fieldname, fieldtype, options=None, **kw):
	return DF(fieldname=fieldname, label=fieldname.replace("_", " ").title(), fieldtype=fieldtype, options=options, **kw)


class Meta:
	def __init__(self, fields, istable=0, issingle=0, read_levels=(0,)):
		self.fields = fields
		self.istable = istable
		self.issingle = issingle
		self.read_levels = list(read_levels)

	def get_link_fields(self):
		return [f for f in self.fields if f.fieldtype == "Link" and f.options != "[Select]"]

	def get_permlevel_access(self, permission_type="read"):
		return self.read_levels


class DoesNotExistError(Exception):
	pass


METAS = {
	"Leave Application": Meta([
		df("employee", "Link", "Employee"),
		df("leave_approver_employee", "Link", "Employee"),
		df("leave_type", "Link", "Leave Type"),
		df("company", "Link", "Company"),
		df("amended_from", "Link", "Leave Application"),
		df("secret_link", "Link", "Employee", hidden=1),
		df("ghost", "Link", "Ghost"),
		df("row", "Link", "Leave Row"),
		df("settings", "Link", "HR Settings"),
		df("from_date", "Date"),
	]),
	"Employee": Meta([
		df("department", "Link", "Department"),
		df("gender", "Link", "Gender"),
		df("notes", "Small Text"),
		df("bio", "Text Editor"),
		df("salary", "Currency", permlevel=1),
		df("internal", "Data", hidden=1),
		df("details", "Section Break"),
	]),
	"Leave Type": Meta([df("is_lwp", "Check")]),
	"Company": Meta([df("abbr", "Data")]),
	"Leave Row": Meta([df("x", "Data")], istable=1),
	"HR Settings": Meta([df("y", "Data")], issingle=1),
}
READABLE = {"Leave Application", "Employee", "Leave Type", "Leave Row", "HR Settings"}


def load_api():
	frappe = types.ModuleType("frappe")
	frappe._ = lambda s: s
	frappe.whitelist = lambda *a, **k: (lambda fn: fn)
	frappe.DoesNotExistError = DoesNotExistError

	def get_meta(doctype):
		if doctype not in METAS:
			raise DoesNotExistError(doctype)
		return METAS[doctype]

	frappe.get_meta = get_meta
	frappe.has_permission = lambda doctype, ptype="read", *a, **k: doctype in READABLE
	utils = types.ModuleType("frappe.utils")
	utils.cint = lambda v: int(float(v or 0))
	utils.flt = lambda v, precision=None: float(v or 0)
	frappe.utils = utils
	for mod in ("frappe", "frappe.utils", "themate", "themate.api"):
		sys.modules.pop(mod, None)
	sys.modules["frappe"] = frappe
	sys.modules["frappe.utils"] = utils
	sys.path.insert(0, ROOT)
	pkg = types.ModuleType("themate")
	pkg.__path__ = [os.path.join(ROOT, "themate")]
	sys.modules["themate"] = pkg
	return importlib.import_module("themate.api")


results = []


def check(name, actual, expected):
	results.append((name, actual, expected, actual == expected))


api = load_api()
out = api.get_linked_filter_fields("Leave Application")
links = [(l["fieldname"], l["doctype"]) for l in out["links"]]

check("links: the visible Link fields whose target can be queried",
	links, [("employee", "Employee"), ("leave_approver_employee", "Employee"), ("leave_type", "Leave Type")])
check("links: no amended_from, no hidden link, nothing the user cannot read",
	any(f in ("amended_from", "secret_link", "company") for f, _ in links), False)
check("links: no child table, no Single, no doctype that is not installed",
	any(f in ("row", "settings", "ghost") for f, _ in links), False)
check("doctypes: each target once, however many links point at it",
	sorted(out["doctypes"]), ["Employee", "Leave Type"])
check("fields: the filterable types, not long text or layout",
	[f["fieldname"] for f in out["doctypes"]["Employee"]], ["department", "gender", "notes"])
check("fields: a field keeps its type and options for the filter control",
	out["doctypes"]["Employee"][0], {"fieldname": "department", "label": "Department", "fieldtype": "Link", "options": "Department"})

METAS["Employee"].read_levels = [0, 1]
check("fields: a higher permission level shows once the user can read it",
	"salary" in [f["fieldname"] for f in load_api().get_linked_filter_fields("Leave Application")["doctypes"]["Employee"]], True)

READABLE.discard("Leave Application")
check("a doctype the user cannot read offers nothing",
	load_api().get_linked_filter_fields("Leave Application"), {"links": [], "doctypes": {}})

failed = [r for r in results if not r[3]]
for name, actual, expected, ok in results:
	print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"\n        got      {actual!r}\n        expected {expected!r}"))
print(f"\nlinked fields: {len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)

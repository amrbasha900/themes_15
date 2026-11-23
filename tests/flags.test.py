#!/usr/bin/env python3
"""Regression test for feature-flag resolution.

THE BUG THIS GUARDS: `enable_theme` was added as a Check field and read with

    cint(settings.get("enable_theme")) if settings.get("enable_theme") is not None else 1

which looks defensive and is not. BaseDocument._fix_numeric_types
(frappe/model/base_document.py:723) runs cint() over EVERY Check field when a
Single loads, so an unset Check reads back as 0, never None. The guard could
never fire, the new flag read as 0 on every existing site, and the master
switch disabled the entire theme — the Desk rendered as stock Frappe.

The stub below reproduces that exact Frappe behaviour rather than an idealised
one, so the test fails if anyone reintroduces a document-level `is not None`
check on a Check field.

Runs without a bench: python3 tests/flags.test.py
"""

import os
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def cint(value):
    """Frappe's cint, faithfully enough for Check fields."""
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


class FakeSingleDoc:
    """A loaded Single, with Frappe's Check-field coercion applied.

    Frappe sets every Check field to cint(raw) on load, so a field absent from
    tabSingles becomes 0 on the document — the whole point of this test.
    """

    def __init__(self, stored, check_fields):
        self._data = dict(stored)
        for f in check_fields:
            self._data[f] = cint(self._data.get(f))

    def get(self, key, default=None):
        return self._data.get(key, default)

    def __getattr__(self, key):
        return self._data.get(key)


def build_frappe_stub(stored, check_fields):
    """Minimal frappe module: the document view coerces, the db view does not."""
    frappe = types.ModuleType("frappe")

    def get_cached_doc(_doctype):
        return FakeSingleDoc(stored, check_fields)

    def get_value(dt, filters=None, fieldname=None, *a, **k):
        # The raw tabSingles row is the only read where NULL survives — and
        # only with order_by=None: the table has no `modified`, and the
        # default ordering raises OperationalError (seen on 15.111.1).
        if dt == "Singles" and isinstance(filters, dict):
            if k.get("order_by", "modified") is not None:
                raise Exception("(1054, \"Unknown column 'modified' in 'ORDER BY'\")")
            return stored.get(filters["field"])
        return None

    db = types.SimpleNamespace(
        # get_single_value casts through cast_fieldtype: a missing Check comes
        # back 0, never None (database.py get_single_value -> utils/data.py:854).
        # Modelled faithfully so nobody "simplifies" _flag back onto it.
        get_single_value=lambda _dt, fieldname: cint(stored.get(fieldname)),
        exists=lambda *a, **k: True,
        get_value=get_value,
        set_single_value=lambda dt, f, v: stored.__setitem__(f, v),
    )

    frappe.get_cached_doc = get_cached_doc
    frappe.db = db
    frappe.session = types.SimpleNamespace(user="Administrator")
    frappe.get_installed_apps = lambda: ["frappe", "themate"]
    frappe.parse_json = lambda v: v
    frappe.throw = lambda msg: (_ for _ in ()).throw(Exception(msg))
    frappe.only_for = lambda *a, **k: None
    frappe.log_error = lambda *a, **k: None
    frappe.get_traceback = lambda: ""
    frappe.clear_cache = lambda **k: None
    frappe._ = lambda s: s
    frappe.clear_document_cache = lambda *a, **k: None
    frappe.get_doc = lambda *a, **k: None
    frappe.get_single = lambda *a, **k: None
    frappe.whitelist = lambda *a, **k: (lambda fn: fn)
    frappe.__version__ = "15.0.0-stub"

    utils = types.ModuleType("frappe.utils")
    utils.cint = cint
    utils.flt = lambda v, precision=None: float(v or 0)  # api.py get_link_summary sums
    utils.get_bench_path = lambda: "/tmp"
    frappe.utils = utils
    return frappe, utils


CHECK_FIELDS = [
    "enable_theme",
    "enable_sidebar",
    "enable_navbar_restyle",
    "enable_list_restyle",
    "enable_form_restyle",
    "show_workspace_icons",
]

results = []


def check(name, actual, expected):
    results.append((name, actual, expected, actual == expected))


def load_api(stored):
    """Import themate.api fresh against a stub with this stored state."""
    frappe, utils = build_frappe_stub(stored, CHECK_FIELDS)
    for mod in ("frappe", "frappe.utils", "themate", "themate.api"):
        sys.modules.pop(mod, None)
    sys.modules["frappe"] = frappe
    sys.modules["frappe.utils"] = utils
    sys.path.insert(0, ROOT)
    import importlib

    pkg = types.ModuleType("themate")
    pkg.__path__ = [os.path.join(ROOT, "themate")]
    sys.modules["themate"] = pkg
    api = importlib.import_module("themate.api")
    return api


# --- 1. THE REGRESSION -------------------------------------------------------
# An existing site: every original flag was written by after_install, but
# enable_theme was added later and has no row. The document reports it as 0.
stored = {
    "enable_sidebar": 1,
    "enable_navbar_restyle": 1,
    "enable_list_restyle": 1,
    "enable_form_restyle": 1,
    "brand_color": "#1677ff",
}
api = load_api(stored)

doc = FakeSingleDoc(stored, CHECK_FIELDS)
check(
    "Frappe really does coerce an unset Check to 0 (not None)",
    doc.get("enable_theme"),
    0,
)
check(
    "so a document-level `is not None` guard can never fire",
    doc.get("enable_theme") is not None,
    True,
)

check("unset enable_theme resolves to ENABLED", api._flag("enable_theme"), 1)
flags = api.get_theme_settings_dict()["flags"]
check("the theme is not silently disabled on an existing site", flags["theme"], 1)
check("area flags still read their stored values", flags["sidebar"], 1)

# --- 2. An explicit off must still be honoured ------------------------------
api = load_api({**stored, "enable_theme": 0})
check("an explicitly stored 0 really disables the theme", api._flag("enable_theme"), 0)
check(
    "and reaches the boot payload",
    api.get_theme_settings_dict()["flags"]["theme"],
    0,
)

# --- 3. An explicit on ------------------------------------------------------
api = load_api({**stored, "enable_theme": 1})
check("an explicitly stored 1 enables the theme", api._flag("enable_theme"), 1)

# --- 4. A brand-new site with nothing stored at all -------------------------
api = load_api({})
flags = api.get_theme_settings_dict()["flags"]
check("a completely unconfigured site defaults to fully enabled", flags,
      {"theme": 1, "sidebar": 1, "navbar": 1, "list": 1, "form": 1})

# --- 5. Every flag field is covered by the seeding list ----------------------
api = load_api(stored)
check(
    "FLAG_FIELDS covers every flag the boot payload exposes",
    sorted(api.FLAG_FIELDS),
    sorted(["enable_theme", "enable_sidebar", "enable_navbar_restyle",
            "enable_list_restyle", "enable_form_restyle"]),
)

passed = 0
failed = []
for name, actual, expected, ok in results:
    if ok:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name}\n         expected {expected!r}\n         got      {actual!r}")

print(f"\nflags: {passed} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)

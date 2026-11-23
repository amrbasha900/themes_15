"""Answer "why does the theme look like stock Frappe?" from the bench.

Run it with:

    bench --site <site> execute themate.diagnostics.run

A theme that fails to apply looks exactly like a theme that was never
installed, so guessing is expensive. This prints, in order, every layer that
has to be true for a single pixel to change: the app installed, the assets
built, the hooks registered, the master flag on, and the settings readable.
"""

import os

import frappe


def _ok(label, value, detail=""):
	return {"status": "ok", "label": label, "value": value, "detail": detail}


def _bad(label, value, detail=""):
	return {"status": "PROBLEM", "label": label, "value": value, "detail": detail}


def _warn(label, value, detail=""):
	return {"status": "note", "label": label, "value": value, "detail": detail}


def collect(site=None):
	checks = []

	# --- 1. Is the app on this site at all? --------------------------------
	try:
		installed = frappe.get_installed_apps()
	except Exception as e:
		installed = []
		checks.append(_bad("installed apps", "could not read", str(e)))

	if "themate" in installed:
		checks.append(_ok("app installed on site", "yes"))
	else:
		checks.append(
			_bad(
				"app installed on site",
				"NO",
				"bench --site <site> install-app themate",
			)
		)

	# --- 2. Were the assets actually built? --------------------------------
	# hooks.py names the bundles by their *logical* names ("themate.bundle.css").
	# Frappe's esbuild writes them out content-hashed
	# (dist/css/themate.bundle.YYDY47T6.css) and records the mapping in
	# sites/assets/assets.json — that is what `bundled_asset()` reads at render
	# time. So the truth is: is the logical name in assets.json, and does the
	# file it points at exist? Checking an unhashed path is always MISSING.
	bench_path = frappe.utils.get_bench_path()
	try:
		assets_json = frappe.utils.get_assets_json() or {}
	except Exception as e:
		assets_json = {}
		checks.append(_bad("assets.json", "could not read", str(e)))

	for name in ("themate.bundle.css", "themate.bundle.js", "themate-login.bundle.css"):
		rel = assets_json.get(name)
		if not rel:
			checks.append(_bad(f"asset {name}", "not in assets.json", "bench build --app themate"))
			continue
		path = os.path.join(bench_path, "sites", rel.lstrip("/"))
		if not os.path.exists(path):
			checks.append(_bad(f"asset {name}", f"{rel} MISSING on disk", "bench build --app themate"))
			continue
		size = os.path.getsize(path)
		if size < 1024:
			checks.append(_bad(f"asset {name}", f"{size} bytes", "suspiciously small — the build likely failed"))
		else:
			checks.append(_ok(f"asset {name}", f"{size // 1024} KB  {rel}"))

	# The RTL build is a separate output; Arabic users get rtl_<name>.
	for name in ("themate.bundle.css", "themate-login.bundle.css"):
		rel = assets_json.get(f"rtl_{name}")
		if not rel:
			checks.append(_bad(f"asset rtl_{name}", "not in assets-rtl.json", "bench build --app themate"))
		elif not os.path.exists(os.path.join(bench_path, "sites", rel.lstrip("/"))):
			checks.append(_bad(f"asset rtl_{name}", f"{rel} MISSING on disk", "bench build --app themate"))
		else:
			checks.append(_ok(f"asset rtl_{name}", rel))

	# --- 3. Are the hooks registered? --------------------------------------
	try:
		css = frappe.get_hooks("app_include_css") or []
		js = frappe.get_hooks("app_include_js") or []
		boot = frappe.get_hooks("extend_bootinfo") or []
		checks.append(
			_ok("app_include_css", "themate.bundle.css present")
			if "themate.bundle.css" in css
			else _bad("app_include_css", "themate.bundle.css NOT in hooks", "bench restart after changing hooks.py")
		)
		checks.append(
			_ok("app_include_js", "themate.bundle.js present")
			if "themate.bundle.js" in js
			else _bad("app_include_js", "themate.bundle.js NOT in hooks", "bench restart")
		)
		checks.append(
			_ok("extend_bootinfo", "themate.boot.extend_bootinfo present")
			if "themate.boot.extend_bootinfo" in boot
			else _bad("extend_bootinfo", "NOT registered", "frappe.boot.themate will be undefined in the browser")
		)
	except Exception as e:
		checks.append(_bad("hooks", "could not read", str(e)))

	# --- 4. The master switch and the area flags ---------------------------
	# Read RAW, because a loaded Check field can never read back as None:
	# BaseDocument._fix_numeric_types cint()s every Check on load, so an unset
	# flag is indistinguishable from one switched off on purpose.
	from themate.api import FLAG_FIELDS, _flag

	if frappe.db.exists("DocType", "Theme Settings"):
		for fieldname in FLAG_FIELDS:
			raw = frappe.db.get_single_value("Theme Settings", fieldname)
			effective = _flag(fieldname)
			if raw is None:
				checks.append(
					_warn(
						f"flag {fieldname}",
						f"unset -> defaulting to {effective}",
						"bench --site <site> migrate  will write an explicit value",
					)
				)
			elif fieldname == "enable_theme" and not effective:
				checks.append(
					_bad(
						"flag enable_theme",
						"OFF",
						"THE WHOLE THEME IS DISABLED. Theme Settings > Enable Theme",
					)
				)
			else:
				checks.append(_ok(f"flag {fieldname}", "on" if effective else "off"))
	else:
		checks.append(_bad("Theme Settings DocType", "MISSING", "bench --site <site> migrate"))

	# --- 5. What the browser will actually receive -------------------------
	try:
		from themate.api import get_theme_settings_dict

		settings = get_theme_settings_dict()
		checks.append(_ok("boot payload flags", str(settings.get("flags"))))
		checks.append(_ok("boot payload brand_color", str(settings.get("brand_color"))))
		checks.append(_ok("boot payload default_mode", str(settings.get("default_mode"))))
	except Exception as e:
		checks.append(_bad("boot payload", "raised", f"{type(e).__name__}: {e}"))

	# --- 6. Versions --------------------------------------------------------
	try:
		checks.append(_warn("frappe version", frappe.__version__))
	except Exception:
		pass

	return checks


def run(site=None):
	checks = collect(site)

	width = max(len(c["label"]) for c in checks) + 2
	problems = 0

	print("\nThemate diagnostics")
	print("=" * 72)
	for c in checks:
		mark = {"ok": "  ok  ", "note": "  ..  ", "PROBLEM": "  !!  "}[c["status"]]
		if c["status"] == "PROBLEM":
			problems += 1
		print(f"{mark}{c['label']:<{width}} {c['value']}")
		if c["detail"]:
			print(f"{'':>8}{'':<{width}} -> {c['detail']}")
	print("=" * 72)

	if problems:
		print(f"\n{problems} problem(s) found. Fix the ones marked !! top-down: the app has to be")
		print("installed before assets matter, and assets have to exist before flags matter.\n")
	else:
		print("\nEverything the server controls is in order.")
		print("If the Desk still looks unthemed, it is client-side. In the browser console:")
		print("    frappe.boot.themate                     -> should be an object")
		print("    document.documentElement.dataset.tmEnabled  -> should be 'on'")
		print("    getComputedStyle(document.documentElement).getPropertyValue('--tm-brand-500')")
		print("                                            -> should be #1677ff")
		print("If those look right but the page does not, hard-reload to clear the asset cache.\n")

	return checks

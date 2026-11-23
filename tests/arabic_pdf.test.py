#!/usr/bin/env python3
"""Regression test for the Arabic PDF font (themate/arabic_pdf.py).

THE BUG THIS GUARDS: Frappe PDFs of Arabic documents came out in DejaVu Sans,
because on a plain server it is the only installed face that covers Arabic.
Measured on this bench with PyMuPDF — an Arabic Employee printed with the
Standard format embedded exactly ['DejaVuSans'].

Two things were tried first and are worth not trying again:

  * a fontconfig rule scoped to `lang=ar` moves `fc-match sans-serif:lang=ar`
    but NOT the PDF — Qt WebKit does not put a language on the pattern it
    hands fontconfig, so the rule never matches. The rule has to be on
    `sans-serif` itself.
  * writing ~/.config/fontconfig/fonts.conf would overwrite whatever the
    server's owner has there. conf.d/ is additive and is read just the same.

Runs without a bench: python3 tests/arabic_pdf.test.py
"""

import os
import struct
import sys
import tempfile
import types
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# arabic_pdf imports frappe only to log a failure; a stub keeps this bench-free
sys.modules.setdefault("frappe", types.SimpleNamespace(log_error=lambda **kw: None))
sys.path.insert(0, ROOT)

results = []


def check(name, actual, expected):
    results.append((name, actual, expected, actual == expected))


home = tempfile.mkdtemp(prefix="themate-fonts-")
os.environ["HOME"] = home
import themate.arabic_pdf as ap  # noqa: E402  (after HOME, which the paths read)

# the module resolves its paths at import time, so point them at the temp home
ap.FONT_DIR = os.path.join(home, ".local/share/fonts/themate")
ap.CONF = os.path.join(home, ".config/fontconfig/conf.d/60-themate-arabic.conf")
ap._fc_cache = lambda: None  # do not touch the real font cache from a test

# ---- the shipped font is a real TrueType file, not a placeholder ------------
ttfs = sorted(n for n in os.listdir(ap.SOURCE) if n.endswith(".ttf"))
check("a regular and a bold face ship with the app", ttfs,
      ["IBMPlexSansArabic-Bold.ttf", "IBMPlexSansArabic-Regular.ttf"])
check("the licence ships with them", os.path.exists(os.path.join(ap.SOURCE, "OFL.txt")), True)
for name in ttfs:
    with open(os.path.join(ap.SOURCE, name), "rb") as f:
        head = f.read(4)
    check(f"{name} is TrueType", head, b"\x00\x01\x00\x00")

# ---- the rule is on sans-serif, and additive ---------------------------------
root = ET.fromstring(ap.CONF_XML)
alias = root.find("alias")
check("the rule is an alias on sans-serif", alias.find("family").text, "sans-serif")
check("…preferring the Arabic face", alias.find("prefer/family").text, ap.FAMILY)
# Qt WebKit sends no language, so a lang test would never fire: see the docstring
check("no lang test, which wkhtmltopdf would ignore", root.findall(".//test[@name='lang']"), [])
check("it goes in conf.d, never over the owner's fonts.conf",
      ap.CONF.endswith("/fontconfig/conf.d/60-themate-arabic.conf"), True)
# families a stylesheet names outright must keep whatever the server gives them
check("it claims no other family", [a.find("family").text for a in root.findall("alias")], ["sans-serif"])
check("and edits no pattern", root.findall("match"), [])

# ---- install, re-install, remove ---------------------------------------------
check("first run installs", ap.setup(), True)
check("the faces are where fontconfig reads them",
      sorted(os.listdir(ap.FONT_DIR)), ttfs)
check("the rule is written", open(ap.CONF).read(), ap.CONF_XML)
check("a second run changes nothing (every migrate calls it)", ap.setup(), False)

with open(os.path.join(ap.FONT_DIR, ttfs[0]), "wb") as f:
    f.write(b"truncated")
check("a damaged face is replaced", ap.setup(), True)
check("…and is whole again",
      os.path.getsize(os.path.join(ap.FONT_DIR, ttfs[0])),
      os.path.getsize(os.path.join(ap.SOURCE, ttfs[0])))

with open(ap.CONF, "w") as f:
    f.write("<fontconfig/>")
check("an edited rule is restored", ap.setup(), True)

ap.remove()
check("remove takes the faces away", os.path.exists(ap.FONT_DIR), False)
check("remove takes the rule away", os.path.exists(ap.CONF), False)
check("remove on a clean server does not raise", (ap.remove(), True)[1], True)

# ---- a home it cannot write to must not fail an install ----------------------
ap.FONT_DIR = "/proc/themate-cannot-write/fonts"
ap.CONF = "/proc/themate-cannot-write/conf/60.conf"
check("an unwritable home is survived, not raised", ap.setup(), False)

passed = 0
failed = []
for name, actual, expected, ok in results:
    if ok:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name}\n         expected {expected!r}\n         got      {actual!r}")

print(f"\narabic pdf font: {passed} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)

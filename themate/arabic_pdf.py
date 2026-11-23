"""Arabic in Frappe's PDFs.

wkhtmltopdf chooses its faces through fontconfig, and a plain Frappe server
carries exactly one that covers Arabic — DejaVu Sans — so every Arabic PDF
comes out in it whatever the stylesheet asks for. CSS cannot fix that: an
@font-face has to carry an absolute URL or a base64 copy of the font in every
render, and Print Settings' font list has no Arabic entry at all.

So the face goes where wkhtmltopdf looks. No root needed — fontconfig reads
the user's own font directory and conf.d, and wkhtmltopdf runs as the bench
user.

Measured on Frappe 15.121 / wkhtmltopdf 0.12.6: a rule scoped to `lang=ar`
changes fc-match but not the PDF, because Qt WebKit does not put a language on
the pattern it asks fontconfig for. The rule is therefore on `sans-serif`
itself, which also moves Latin from DejaVu Sans to IBM Plex Sans. Families
named outright — Arial, Courier, serif, monospace — are untouched.

  bench execute themate.arabic_pdf.setup     # install (also runs on migrate)
  bench execute themate.arabic_pdf.remove    # put the server back
"""

import os
import shutil
import subprocess

import frappe

FAMILY = "IBM Plex Sans Arabic"
SOURCE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
FONT_DIR = os.path.expanduser("~/.local/share/fonts/themate")
CONF = os.path.expanduser("~/.config/fontconfig/conf.d/60-themate-arabic.conf")

CONF_XML = f"""<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<!-- Written by themate (themate/arabic_pdf.py). Delete it and run
     `fc-cache -f` to put the server's PDF fonts back as they were. -->
<fontconfig>
  <alias binding="strong">
    <family>sans-serif</family>
    <prefer><family>{FAMILY}</family></prefer>
  </alias>
</fontconfig>
"""


def _fc_cache():
	try:
		subprocess.run(["fc-cache", "-f"], check=False, capture_output=True, timeout=180)
	except (OSError, subprocess.SubprocessError):
		pass  # no fontconfig here; the files are in place for when there is


def setup():
	"""Idempotent: run on install and on every migrate, does nothing once done."""
	try:
		os.makedirs(FONT_DIR, exist_ok=True)
		os.makedirs(os.path.dirname(CONF), exist_ok=True)
		changed = False

		for name in sorted(os.listdir(SOURCE)):
			if not name.endswith(".ttf"):
				continue
			src, dest = os.path.join(SOURCE, name), os.path.join(FONT_DIR, name)
			if not os.path.exists(dest) or os.path.getsize(dest) != os.path.getsize(src):
				shutil.copyfile(src, dest)
				changed = True

		if not os.path.exists(CONF) or open(CONF, encoding="utf-8").read() != CONF_XML:
			with open(CONF, "w", encoding="utf-8") as f:
				f.write(CONF_XML)
			changed = True

		if changed:
			_fc_cache()
		return changed
	except OSError:
		# a read-only or unusual home is not a reason to fail an install
		frappe.log_error(title="themate: could not install the Arabic PDF font")
		return False


def remove():
	shutil.rmtree(FONT_DIR, ignore_errors=True)
	if os.path.exists(CONF):
		os.remove(CONF)
	_fc_cache()

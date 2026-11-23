"""The print studio's exact preview, at a URL that ends in the document's name.

The browser's built-in PDF viewer titles itself after the last segment of the
URL it loaded: a blob: URL leaves it showing a UUID, and Frappe's own endpoint
leaves it showing "frappe.utils.print_format.download_pdf". Only the path can
change that (measured against the PDF's /Title, a File name and a fragment —
none of them move it), so this serves the very same PDF from
/themate-print/<name>.pdf and puts everything functional in the query string,
which also keeps document names containing "/" out of the path.

The PDF itself, and the permission check on it, are Frappe's: download_pdf
calls validate_print_permission before it renders anything.
"""

import frappe
from frappe.utils import cint
from frappe.utils.print_format import download_pdf
from frappe.utils.response import as_pdf
from frappe.website.page_renderers.base_renderer import BaseRenderer

PREFIX = "themate-print/"


class PrintPDF(BaseRenderer):
	def can_render(self):
		return self.path.startswith(PREFIX) and self.path.endswith(".pdf")

	def render(self):
		args = frappe.form_dict
		download_pdf(
			args.get("doctype"),
			args.get("name"),
			format=args.get("format"),
			no_letterhead=cint(args.get("no_letterhead")),
			letterhead=args.get("letterhead"),
			language=args.get("_lang"),
		)
		response = as_pdf()
		# the viewer asks for the same URL a second time to paint it; answer
		# that from the browser's cache instead of running wkhtmltopdf again
		response.headers["Cache-Control"] = "private, max-age=60"
		return response

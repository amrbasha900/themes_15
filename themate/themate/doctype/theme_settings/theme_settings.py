import frappe
from frappe.model.document import Document

# Ant Design seed colours, so the runtime ramp generator (core/palette.js)
# produces the same ramp shape the frozen Blue palette was built from.
# "Custom" leaves brand_color exactly as entered.
ACCENT_PRESETS = {
	"Blue": "#1677ff",
	"Indigo": "#2f54eb",
	"Violet": "#722ed1",
	"Teal": "#13c2c2",
}


class ThemeSettings(Document):
	def validate(self):
		preset = ACCENT_PRESETS.get(self.accent_preset)
		if preset:
			self.brand_color = preset
		elif self.accent_preset != "Custom":
			self.accent_preset = "Custom"

	def on_update(self):
		# Everything reads through get_cached_doc; the login page and the
		# boot payload must not serve a stale colour after a save.
		frappe.clear_cache(doctype="Theme Settings")
		frappe.local.tm_raw_settings = None  # themate.api._raw_settings
		if self.has_value_changed("chart_engine"):
			from themate.install import apply_chart_types

			apply_chart_types()

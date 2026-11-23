import frappe
from frappe.model.document import Document


class ThemateChartAnnotation(Document):
	def on_update(self):
		frappe.cache().delete_keys("themate_chart_annotations:")

	def on_trash(self):
		frappe.cache().delete_keys("themate_chart_annotations:")

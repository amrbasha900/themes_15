// The field pickers list the chosen document type's own fields, the way
// Frappe's Calendar View form does (desk/doctype/calendar_view).

const STD_FIELDS = [
	["name", "ID"],
	["owner", "Created By"],
	["creation", "Created On"],
	["modified", "Last Updated On"],
	["modified_by", "Last Updated By"],
	["docstatus", "Document Status"],
];

frappe.ui.form.on("Calendar Layout", {
	onload(frm) {
		frm.set_query("reference_doctype", () => ({ filters: { istable: 0, issingle: 0 } }));
		frm.set_query("calendar_view", () => ({ filters: { reference_doctype: frm.doc.reference_doctype || "" } }));
	},

	refresh(frm) {
		frm.trigger("reference_doctype");
		if (!frm.is_new() && frm.doc.reference_doctype) {
			frm.add_custom_button(__("Show Calendar"), () =>
				frappe.set_route("List", frm.doc.reference_doctype, "Calendar", frm.doc.calendar_view || "default")
			);
		}
	},

	after_save() {
		// a calendar already open in this tab is rebuilt with the new layout
		window.themate?.calendarLayouts?.clear?.();
	},

	reference_doctype(frm) {
		const doctype = frm.doc.reference_doctype;
		if (!doctype) return;
		frappe.model.with_doctype(doctype, () => {
			const meta = frappe.get_meta(doctype);
			const option = (df) => ({ value: df.fieldname, label: `${__(df.label || df.fieldname)} (${df.fieldname})` });
			const own = meta.fields.filter((df) => !frappe.model.no_value_type.includes(df.fieldtype));
			const std = STD_FIELDS.map(([fieldname, label]) => ({ fieldname, label }));
			const dates = own.filter((df) => ["Date", "Datetime"].includes(df.fieldtype));

			const any = [""].concat(own.map(option), std.map(option));
			frm.set_df_property("title_field", "options", any);
			frm.set_df_property("start_date_field", "options", [""].concat(dates.map(option)));
			frm.set_df_property("end_date_field", "options", [""].concat(dates.map(option)));
			frm.fields_dict.fields.grid.update_docfield_property("fieldname", "options", any);
			frm.refresh_fields(["title_field", "start_date_field", "end_date_field", "fields"]);
		});
	},
});

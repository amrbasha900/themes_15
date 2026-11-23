// Preset <-> colour stay in step while editing; the server enforces the same
// rule in validate(), so a value posted through the API cannot drift either.
const ACCENT_PRESETS = {
	Blue: "#1677ff",
	Indigo: "#2f54eb",
	Violet: "#722ed1",
	Teal: "#13c2c2",
};

frappe.ui.form.on("Theme Settings", {
	accent_preset(frm) {
		const hex = ACCENT_PRESETS[frm.doc.accent_preset];
		if (hex && (frm.doc.brand_color || "").toLowerCase() !== hex) {
			frm.set_value("brand_color", hex);
		}
	},
	brand_color(frm) {
		const hex = ACCENT_PRESETS[frm.doc.accent_preset];
		if (hex && (frm.doc.brand_color || "").toLowerCase() !== hex) {
			frm.set_value("accent_preset", "Custom");
		}
	},
	after_save() {
		frappe.show_alert({ message: __("Reload to see the theme changes"), indicator: "blue" }, 4);
	},
	refresh(frm) {
		/* Calendar tab: what each calendar's events show lives in its own
		 * Calendar Layout record, one per document type */
		const html = frm.fields_dict.calendar_layouts_html;
		if (html) {
			html.$wrapper.html(`<div class="form-group">
				<label class="control-label">${__("Event Layouts")}</label>
				<p class="text-muted small">${__("What each calendar's events show — fields under the title such as an amount or a percentage, their format and the colour — is set per document type.")}</p>
				<a class="btn btn-default btn-xs" href="/app/calendar-layout">${__("Open Calendar Layouts")}</a>
			</div>`);
		}
	},
});

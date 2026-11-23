/* Adds an Icon field to the workspace Shortcut and Number Card editors, and
 * carries the stored icon onto the rendered widget so workspace/cards.js can
 * use it instead of guessing from the title.
 *
 * WHY A PATCH IS NEEDED HERE (brief §4 requires each patch to be justified):
 * Frappe builds these dialogs inline inside frappe.widget.widget_factory and
 * exposes no hook for adding a field to them, so there is no supported
 * extension point to use instead. CSS cannot add a form field. The patch is
 * therefore the narrowest available mechanism, and is kept to:
 *   - one subclass of frappe.ui.Dialog that only ever appends a field,
 *   - three widget-prototype wrappers that only copy an already-saved value
 *     onto a DOM attribute.
 * No native method is replaced outright and every wrapper calls through.
 *
 * FIXED FROM THE PREVIOUS REVISION: dialogs were matched with
 *   opts.title.includes("Shortcut" | "Number Card" | "Link")
 * against the *translated* title. That matched unrelated dialogs whose title
 * happened to contain the word in English, and matched nothing at all in a
 * non-English UI (FRAPPE_UI_MAP.md §5 finding 13). Matching is now on the
 * dialog's field signature, which is language-independent. */

const ICON_FIELD = {
	fieldtype: "Icon",
	fieldname: "icon",
	label: "Icon",
};

/* A dialog is the shortcut editor if it carries the fields the shortcut editor
 * is built from. Field names are code, not copy, so this survives translation. */
function is_shortcut_dialog(fields) {
	const names = new Set(fields.map((f) => f.fieldname));
	return names.has("label") && names.has("link_to") && names.has("type");
}

function is_number_card_dialog(fields) {
	const names = new Set(fields.map((f) => f.fieldname));
	return names.has("label") && (names.has("number_card_name") || names.has("new_or_existing"));
}

function insert_after_label(fields, field) {
	if (fields.some((f) => f.fieldname === field.fieldname)) {
		return; /* idempotent — never add the field twice */
	}

	const idx = fields.findIndex((f) => f.fieldname === "label");
	if (idx === -1) return;

	fields.splice(idx + 1, 0, field);
}

function patch_dialog(frappe) {
	if (!frappe.ui?.Dialog || frappe.ui.Dialog._tm_patched) return;

	const Base = frappe.ui.Dialog;

	frappe.ui.Dialog = class ThemateDialog extends Base {
		constructor(opts) {
			try {
				const fields = opts?.fields;
				if (Array.isArray(fields)) {
					if (is_shortcut_dialog(fields)) {
						insert_after_label(fields, {
							...ICON_FIELD,
							default: opts.values?.icon || "",
						});
					} else if (is_number_card_dialog(fields)) {
						insert_after_label(fields, {
							...ICON_FIELD,
							fieldname: "custom_icon",
							default: opts.values?.custom_icon || "",
						});
					}
				}
			} catch (e) {
				/* A theme must never stop a dialog from opening. */
				console.warn("[themate] icon field injection skipped:", e);
			}

			super(opts);
		}
	};

	/* Preserve statics assigned to the original constructor. */
	Object.setPrototypeOf(frappe.ui.Dialog, Base);
	frappe.ui.Dialog._tm_patched = true;
}

/* Wraps a widget method so the saved icon reaches the DOM. Always calls
 * through; never swallows the return value (render_card is async). */
function wrap_widget(factory, key, method, apply_attr) {
	const Widget = factory?.[key];
	if (!Widget?.prototype || Widget.prototype._tm_patched) return;

	const original = Widget.prototype[method];
	if (typeof original !== "function") return;

	Widget.prototype[method] = function (...args) {
		const result = original.apply(this, args);

		const finish = () => {
			try {
				apply_attr(this);
			} catch (e) {
				console.warn("[themate] widget icon attribute skipped:", e);
			}
			window.themate?.decorate_cards?.();
		};

		/* render_card is async; chain rather than racing it. */
		if (result && typeof result.then === "function") {
			return result.then((value) => {
				finish();
				return value;
			});
		}

		finish();
		return result;
	};

	Widget.prototype._tm_patched = true;
}

function patch_widgets(frappe) {
	const factory = frappe.widget?.widget_factory;
	if (!factory) return;

	wrap_widget(factory, "shortcut", "refresh", (w) => {
		if (w.icon && w.widget) w.widget.attr("data-icon", w.icon);
	});

	wrap_widget(factory, "number_card", "render_card", (w) => {
		if (w.card_doc?.custom_icon && w.widget) {
			w.widget.attr("data-icon", w.card_doc.custom_icon);
		}
	});

	wrap_widget(factory, "onboarding", "set_body", (w) => {
		if (w.onboarding_name && w.widget) {
			w.widget.attr(
				"data-onboarding-name",
				w.onboarding_name.toLowerCase().replace(/\s+/g, "-")
			);
		}
	});
}

function init() {
	const frappe = window.frappe;
	if (!frappe) return;
	if (window.themate?.enabled?.() === false) return; /* master switch off: Frappe's own editors */

	patch_dialog(frappe);
	patch_widgets(frappe);
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init);
} else {
	init();
}

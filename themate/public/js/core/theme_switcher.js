/* Adds an accent-colour picker to Frappe's Theme Switcher dialog.
 *
 * WHY A PATCH (brief §4): frappe.ui.ThemeSwitcher builds its dialog in
 * setup_dialog() and offers no hook for extra content. The subclass below
 * overrides only setup_dialog, calls super() first, and appends to the existing
 * body — it replaces no native behaviour, and the three native theme choices
 * keep working exactly as before.
 *
 * CHANGED FROM THE PREVIOUS REVISION:
 *  - the second "Secondary Color" picker is gone. It fed a --tm-secondary-*
 *    scale that only existed at runtime and that the contract rejects outright:
 *    one accent, neutral default actions (DESIGN_CONTRACT.md §1).
 *  - the swatch list is derived from the configured brand colour rather than a
 *    hard-coded palette that ignored Theme Settings.
 *  - choices are written through the versioned preference key so they can be
 *    reset, and so a server-side brand colour still wins on next load
 *    (FRAPPE_UI_MAP.md §5 finding 5). */

const SWATCHES = [
	{ name: "blue", label: "Daybreak Blue", hex: "#1677ff" },
	{ name: "cyan", label: "Cyan", hex: "#13c2c2" },
	{ name: "green", label: "Polar Green", hex: "#52c41a" },
	{ name: "gold", label: "Calendula Gold", hex: "#faad14" },
	{ name: "volcano", label: "Volcano", hex: "#fa541c" },
	{ name: "red", label: "Dust Red", hex: "#f5222d" },
	{ name: "purple", label: "Golden Purple", hex: "#722ed1" },
	{ name: "geekblue", label: "Geek Blue", hex: "#2f54eb" },
];

/* Delegates to core/bootstrap.js so the picker and the page can never disagree.
 *
 * This function used to resolve the accent itself, preferring localStorage,
 * while bootstrap preferred the configured brand colour. With both set to
 * different values the page painted one colour and the picker highlighted
 * another. There is now one resolver. */
function current_accent() {
	return window.themate?.effectiveAccent?.() || window.themate?.DEFAULT_BRAND || "#1677ff";
}

function store_accent(hex) {
	const themate = window.themate || {};
	try {
		localStorage.setItem(themate.PREF_VERSION_KEY, themate.PREF_VERSION);
		localStorage.setItem(themate.BRAND_KEY, hex);
	} catch {
		/* storage unavailable — the colour still applies for this page */
	}
}

function build_section($, __) {
	const active = current_accent().toLowerCase();

	const $section = $(`
		<div class="tm-accent-section">
			<h5 class="theme-title">${__("Accent Color")}</h5>
			<div class="tm-accent-grid" role="radiogroup" aria-label="${__("Accent Color")}"></div>
			<button type="button" class="btn btn-xs btn-default tm-accent-reset">
				${__("Reset to default")}
			</button>
		</div>
	`);

	const $grid = $section.find(".tm-accent-grid");

	SWATCHES.forEach((swatch) => {
		const selected = swatch.hex.toLowerCase() === active;
		const $dot = $(`
			<button type="button"
				class="tm-accent-dot ${selected ? "selected" : ""}"
				role="radio"
				aria-checked="${selected}"
				aria-label="${__(swatch.label)}"
				title="${__(swatch.label)}"
				data-hex="${swatch.hex}">
				<span class="tm-accent-swatch" style="background-color: ${swatch.hex};"></span>
			</button>
		`);

		$dot.on("click", () => {
			$grid.find(".tm-accent-dot")
				.removeClass("selected")
				.attr("aria-checked", "false");
			$dot.addClass("selected").attr("aria-checked", "true");

			store_accent(swatch.hex);
			window.themate?.applyBrandScale?.(document.documentElement, swatch.hex);

			window.frappe?.show_alert?.(
				{ message: __("Accent color updated"), indicator: "green" },
				2
			);
		});

		$dot.appendTo($grid);
	});

	$section.find(".tm-accent-reset").on("click", () => {
		window.themate?.resetLocalPreferences?.();
		$grid.find(".tm-accent-dot").removeClass("selected").attr("aria-checked", "false");
		window.frappe?.show_alert?.({ message: __("Accent color reset"), indicator: "blue" }, 2);
	});

	return $section;
}

/* The rest of the per-user choices (font size, family, radius, density,
 * icons) live in the Theme Customizer drawer — one place, live preview. */
function build_customizer_link($, __) {
	const $section = $(`
		<div class="tm-customizer-link">
			<button type="button" class="btn btn-sm btn-default">
				${__("Open Theme Customizer")}
			</button>
			<p class="text-muted">${__("Font size, font, corners, density and icons — with live preview.")}</p>
		</div>
	`);
	$section.find("button").on("click", () => {
		window.themate?.openCustomizer?.();
	});
	return $section;
}

function patch(frappe) {
	if (!frappe.ui?.ThemeSwitcher || frappe.ui.ThemeSwitcher._tm_patched) return;

	const Base = frappe.ui.ThemeSwitcher;
	const $ = window.jQuery;
	const __ = window.__ || ((s) => s);

	frappe.ui.ThemeSwitcher = class ThemateThemeSwitcher extends Base {
		setup_dialog() {
			super.setup_dialog();

			try {
				build_section($, __).appendTo(this.dialog.$body);
				build_customizer_link($, __).appendTo(this.dialog.$body);
			} catch (e) {
				/* Never prevent the native theme dialog from opening. */
				console.warn("[themate] accent picker skipped:", e);
			}
		}
	};

	Object.setPrototypeOf(frappe.ui.ThemeSwitcher, Base);
	frappe.ui.ThemeSwitcher._tm_patched = true;
}

function init() {
	if (!window.frappe || !window.jQuery) return;
	if (window.themate?.enabled?.() === false) return; /* master switch off: Frappe's own dialog */
	patch(window.frappe);
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init);
} else {
	init();
}

/* Theme Customizer — a drawer with live preview.
 *
 * Every control writes through window.themate.preview(), which merges the
 * change into the boot copy of the user's preferences and re-runs the same
 * apply() that runs on page load, so what the drawer shows IS what the next
 * load will show. Nothing is saved until Apply; Cancel restores the snapshot
 * taken when the drawer opened.
 *
 * Two scopes:
 *  - "Just me"  -> themate.api.save_prefs (Themate User Preference)
 *  - "Everyone" -> themate.api.update_theme_settings (Theme Settings), shown
 *                  to System Managers only. The user's own overrides for the
 *                  fields being published are cleared so they see the default
 *                  they just set, not a stale personal copy.
 *
 * Opened from the user menu ("Theme Customizer"), from the native theme
 * dialog (Ctrl+Shift+G) and window.themate.openCustomizer(). */

const ACCENTS = [
	{ label: "Blue", hex: "#1677ff" },
	{ label: "Indigo", hex: "#2f54eb" },
	{ label: "Violet", hex: "#722ed1" },
	{ label: "Teal", hex: "#13c2c2" },
	{ label: "Green", hex: "#52c41a" },
	{ label: "Gold", hex: "#faad14" },
	{ label: "Volcano", hex: "#fa541c" },
	{ label: "Rose", hex: "#eb2f96" },
];

const FONT_RANGE = [11, 20];
const ICON_RANGE = [12, 28];

/* Preference keys the drawer owns, and the Theme Settings field each maps to
 * when publishing as the site default. */
const SITE_MAP = {
	theme_mode: "default_mode",
	accent_color: "brand_color",
	font_family: "font_family",
	font_size: "font_size",
	radius_preset: "radius_preset",
	density: "density",
	icon_size: "icon_size",
	icon_style: "icon_style",
	sidebar_theme: "sidebar_theme",
	sidebar_bg: "sidebar_bg",
	sidebar_art: "sidebar_art",
	sidebar_art_colors: "sidebar_art_colors",
	text_styles: "text_styles",
	chart_palette: "chart_palette",
	chart_colors: "chart_colors",
	activity_display: "activity_display",
	form_panel_side: "form_panel_side",
	use_theme: "enable_theme",
};

/* Text styles: one element at a time, four properties. */
const TEXT_ELEMENTS = [
	{ key: "title", label: "Page title", size: 20 },
	{ key: "subtitle", label: "Sub-title", size: 13 },
	{ key: "section", label: "Section titles", size: 16 },
	{ key: "tab", label: "Tabs", size: 13 },
	{ key: "label", label: "Field labels", size: 13 },
	{ key: "body", label: "Body text", size: 14 },
	{ key: "menu", label: "Menu items", size: 13 },
];
const TEXT_WEIGHTS = [
	{ value: 400, label: "Regular" },
	{ value: 500, label: "Medium" },
	{ value: 600, label: "Semibold" },
	{ value: 700, label: "Bold" },
];
const TEXT_COLORS = [
	{ label: "Default", hex: "" },
	{ label: "Text", hex: "#1f1f1f" },
	{ label: "Muted", hex: "#8c8c8c" },
	{ label: "Brand", hex: "#1677ff" },
	{ label: "Red", hex: "#f5222d" },
	{ label: "Green", hex: "#389e0d" },
];

const SIDEBAR_COLORS = [
	{ label: "Navy", hex: "#0f1b3d" },
	{ label: "Slate", hex: "#1e293b" },
	{ label: "Graphite", hex: "#111827" },
	{ label: "Forest", hex: "#0f2e2a" },
	{ label: "Plum", hex: "#2a1440" },
	{ label: "Ink", hex: "#000000" },
];

let $drawer = null;
let snapshot = null;
let state = null;

const boot = () => window.frappe?.boot?.themate || {};
const __ = (s, args, context) => (window.__ ? window.__(s, args, context) : s);
const $ = () => window.jQuery;

function currentPrefs() {
	return Object.assign({}, boot().user_prefs || {});
}

function sidebarCollapsed() {
	return Boolean(document.querySelector(".modern-sidebar.collapsed"));
}

/* ---- rendering helpers -------------------------------------------------- */

/* Charts: one row per preset (eight dots + name), "Site default" first, and
 * a Custom row with eight colour inputs. Preview is live: bootstrap's
 * applyChartPalette sets --tm-chart-1..8 and live charts redraw. */
function buildChartPalette(prefs, site, set) {
	const palettes = window.themate?.CHART_PALETTES || {};
	const brand = () => {
		const cs = getComputedStyle(document.documentElement);
		return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cs.getPropertyValue(`--tm-chart-${i}`).trim() || "#999");
	};
	const rows = [{ key: "", label: __("Site default"), colors: null }]
		.concat([{ key: "Brand", label: __("Brand"), colors: null }])
		.concat(Object.keys(palettes).map((k) => ({ key: k, label: __(k), colors: palettes[k] })));
	const $el = $()(`<div class="tm-cz-palettes" role="radiogroup"></div>`);
	const custom = (prefs.chart_palette === "Custom" && prefs.chart_colors) || site.chart_colors || ["#1677ff", "#13c2c2", "#faad14", "#722ed1", "#52c41a", "#eb2f96", "#fa8c16", "#2f54eb"];
	const state = { colors: custom.slice(0, 8) };
	const mark = (key) => $el.find(".tm-cz-palette").each(function () { const on = this.dataset.key === (key || ""); this.classList.toggle("selected", on); this.setAttribute("aria-checked", on); });
	const dots = (colors) => `<span class="tm-cz-dots">${colors.map((c) => `<i style="--swatch:${c}"></i>`).join("")}</span>`;
	rows.forEach((r) => {
		const colors = r.colors || (r.key === "Brand" ? brand() : (site.chart_palette && palettes[site.chart_palette]) || brand());
		const $r = $()(`<button type="button" class="tm-cz-palette" role="radio" data-key="${r.key}">${dots(colors)}<span class="tm-cz-palette-name">${r.label}</span></button>`);
		$r.on("click", () => { mark(r.key); set("chart_palette", r.key || null); });
		$el.append($r);
	});
	const $c = $()(`<div class="tm-cz-palette tm-cz-palette-custom" role="radio" data-key="Custom">
		<span class="tm-cz-dots">${state.colors.map((c, i) => `<label title="${__("Colour {0}", [i + 1])}"><input type="color" value="${c}" data-i="${i}"><i style="--swatch:${c}"></i></label>`).join("")}</span>
		<span class="tm-cz-palette-name">${__("Custom")}</span></div>`);
	$c.on("click", (e) => { if (!e.target.closest("input")) { mark("Custom"); set("chart_colors", state.colors.slice()); set("chart_palette", "Custom"); } });
	$c.find("input").on("input", function () {
		state.colors[+this.dataset.i] = this.value;
		this.nextElementSibling.style.setProperty("--swatch", this.value);
		mark("Custom");
		set("chart_colors", state.colors.slice());
		set("chart_palette", "Custom");
	});
	$el.append($c);
	mark(prefs.chart_palette || "");
	return $el;
}

/* The colours of the sidebar's art. Picking a sidebar colour above clears
 * them, because otherwise that swatch would appear to do nothing. */
function buildSidebarArt(prefs, site, set) {
	const painter = window.themate.art;
	const shown = (p) => painter.colors(site, p);
	let current = shown(prefs);
	const $el = $()(`<div class="tm-cz-palette tm-cz-palette-custom">
		<span class="tm-cz-dots">${current.map((c, i) => `<label title="${__("Colour {0}", [i + 1])}"><input type="color" value="${c}" data-i="${i}"><i style="--swatch:${c}"></i></label>`).join("")}</span>
		<button type="button" class="btn btn-xs btn-default">${__("Reset")}</button></div>`);
	const paint = (list) => {
		current = list.map((c) => c.toLowerCase());
		$el.find("input").each(function (i) {
			this.value = current[i];
			this.nextElementSibling.style.setProperty("--swatch", current[i]);
		});
	};
	$el.find("input").on("input", function () {
		current[+this.dataset.i] = this.value;
		this.nextElementSibling.style.setProperty("--swatch", this.value);
		set("sidebar_art_colors", current.slice());
	});
	$el.find("button").on("click", () => $el[0]._follow(prefs.sidebar_bg));
	$el[0]._follow = (bg) => {
		set("sidebar_art_colors", null);
		paint(shown({ sidebar_bg: bg || null }));
	};
	paint(current);
	return $el;
}

function section(title, hint) {
	return $()(`
		<section class="tm-cz-section">
			<h6 class="tm-cz-title">${title}${hint ? `<span class="tm-cz-hint">${hint}</span>` : ""}</h6>
			<div class="tm-cz-body"></div>
		</section>
	`);
}

function segmented(key, options, current, onChange) {
	const $el = $()(`<div class="tm-cz-segmented" role="radiogroup"></div>`);
	options.forEach((opt) => {
		const value = typeof opt === "string" ? opt : opt.value;
		const label = typeof opt === "string" ? __(opt) : opt.label;
		const $b = $()(`<button type="button" class="tm-cz-seg" role="radio" data-value="${value}">${label}</button>`);
		$b.toggleClass("selected", value === current).attr("aria-checked", value === current);
		$b.on("click", () => {
			$el.find(".tm-cz-seg").removeClass("selected").attr("aria-checked", "false");
			$b.addClass("selected").attr("aria-checked", "true");
			onChange(value);
		});
		$el.append($b);
	});
	return $el;
}

function slider(key, [min, max], current, fallback, unit, onChange) {
	const value = Number(current) || fallback;
	const $el = $()(`
		<div class="tm-cz-slider">
			<input type="range" min="${min}" max="${max}" step="1" value="${value}" aria-label="${key}">
			<div class="tm-cz-number">
				<button type="button" class="tm-cz-step" data-step="-1" aria-label="${__("Smaller")}">−</button>
				<input type="number" min="${min}" max="${max}" step="1" value="${value}">
				<span>${unit}</span>
				<button type="button" class="tm-cz-step" data-step="1" aria-label="${__("Larger")}">+</button>
			</div>
		</div>
	`);
	const $range = $el.find("input[type=range]");
	const $num = $el.find("input[type=number]");
	const set = (v) => {
		v = Math.min(max, Math.max(min, Math.round(Number(v) || fallback)));
		$range.val(v);
		$num.val(v);
		onChange(v);
	};
	$range.on("input", () => set($range.val()));
	$num.on("change", () => set($num.val()));
	$el.find(".tm-cz-step").on("click", function () {
		set(Number($num.val()) + Number(this.dataset.step));
	});
	return $el;
}

function swatches(current, onChange) {
	const $el = $()(`<div class="tm-cz-swatches" role="radiogroup"></div>`);
	const brand = boot().brand_color || "#1677ff";
	const all = [{ label: __("Site brand"), hex: "", swatch: brand }].concat(ACCENTS);
	const mark = (hex) => {
		$el.find(".tm-cz-swatch").each(function () {
			const on = (this.dataset.hex || "") === (hex || "");
			this.classList.toggle("selected", on);
			this.setAttribute("aria-checked", on);
		});
	};
	all.forEach((a) => {
		const $s = $()(`<button type="button" class="tm-cz-swatch" role="radio" data-hex="${a.hex}" title="${a.label}" aria-label="${a.label}"
			style="--swatch:${a.swatch || a.hex}"></button>`);
		$s.on("click", () => { mark(a.hex); $el.find("input[type=color]").val(a.hex || brand); onChange(a.hex || null); });
		$el.append($s);
	});
	const $custom = $()(`<label class="tm-cz-custom" title="${__("Custom color")}"><input type="color" value="${current || brand}"><span>${__("Custom")}</span></label>`);
	$custom.find("input").on("input", function () { mark(this.value); onChange(this.value); });
	$el.append($custom);
	mark(current || "");
	return $el;
}

/* ---- text styles editor -------------------------------------------------- */

function buildTextStyles(prefs, site, set) {
	const $el = $()(`<div class="tm-cz-textstyles"></div>`);
	/* working copy: site defaults under the user's own entries */
	const styles = {};
	TEXT_ELEMENTS.forEach(({ key }) => {
		styles[key] = Object.assign({}, (site.text_styles || {})[key] || {}, (prefs.text_styles || {})[key] || {});
	});
	let current = TEXT_ELEMENTS[0].key;

	const commit = () => {
		const mine = {};
		Object.keys(styles).forEach((k) => { if (Object.keys(styles[k]).length) mine[k] = styles[k]; });
		set("text_styles", mine);
	};

	const $picker = $()(`<select class="form-control tm-cz-select" aria-label="${__("Element")}"></select>`);
	TEXT_ELEMENTS.forEach((e) => $picker.append(`<option value="${e.key}">${__(e.label)}</option>`));
	$el.append($picker);

	const $controls = $()(`<div class="tm-cz-ts-controls"></div>`).appendTo($el);

	function render() {
		const el = TEXT_ELEMENTS.find((e) => e.key === current);
		const spec = styles[current];
		$controls.empty();

		$controls.append($()(`<div class="tm-cz-label">${__("Size")}</div>`));
		$controls.append(slider("ts-size", [10, 40], spec.size, el.size, "px", (v) => { spec.size = v; commit(); }));

		$controls.append($()(`<div class="tm-cz-label">${__("Weight")}</div>`));
		$controls.append(segmented("ts-weight", TEXT_WEIGHTS.map((w) => ({ value: String(w.value), label: __(w.label) })), String(spec.weight || ""), (v) => { spec.weight = Number(v); commit(); }));

		const $row = $()(`<div class="tm-cz-ts-row"></div>`);
		const $italic = $()(`<button type="button" class="tm-cz-seg tm-cz-toggle ${spec.italic ? "selected" : ""}" aria-pressed="${!!spec.italic}"><i>${__("Italic")}</i></button>`);
		$italic.on("click", () => { spec.italic = spec.italic ? 0 : 1; $italic.toggleClass("selected", !!spec.italic).attr("aria-pressed", !!spec.italic); commit(); });
		$row.append($italic);
		const $reset = $()(`<button type="button" class="btn btn-xs btn-default tm-cz-ts-reset">${__("Reset element")}</button>`);
		$reset.on("click", () => { styles[current] = {}; commit(); render(); });
		$row.append($reset);
		$controls.append($()(`<div class="tm-cz-label">${__("Style")}</div>`)).append($row);

		$controls.append($()(`<div class="tm-cz-label">${__("Colour")}</div>`));
		const $sw = $()(`<div class="tm-cz-swatches" role="radiogroup"></div>`);
		const mark = (hex) => $sw.find(".tm-cz-swatch").each(function () { const on = (this.dataset.hex || "") === (hex || ""); this.classList.toggle("selected", on); this.setAttribute("aria-checked", on); });
		TEXT_COLORS.forEach((c) => {
			const swatch = c.hex || "var(--tm-text)";
			const $b = $()(`<button type="button" class="tm-cz-swatch" role="radio" data-hex="${c.hex}" title="${__(c.label)}" aria-label="${__(c.label)}" style="--swatch:${swatch}"></button>`);
			$b.on("click", () => { if (c.hex) spec.color = c.hex; else delete spec.color; mark(c.hex); $sw.find("input[type=color]").val(c.hex || "#1f1f1f"); commit(); });
			$sw.append($b);
		});
		const $custom = $()(`<label class="tm-cz-custom" title="${__("Custom color")}"><input type="color" value="${spec.color || "#1f1f1f"}"><span>${__("Custom")}</span></label>`);
		$custom.find("input").on("input", function () { spec.color = this.value; mark(this.value); commit(); });
		$sw.append($custom);
		mark(spec.color || "");
		$controls.append($sw);
	}

	$picker.on("change", () => { current = $picker.val(); render(); });
	render();
	return $el;
}

/* ---- the drawer ---------------------------------------------------------- */

function build() {
	const prefs = currentPrefs();
	const site = boot();
	const isAdmin = (window.frappe?.user_roles || []).includes("System Manager");

	$drawer = $()(`
		<aside class="tm-customizer" role="dialog" aria-label="${__("Theme Customizer")}" hidden>
			<header class="tm-cz-header">
				<div>
					<h5>${__("Theme Customizer")}</h5>
					<p>${__("Changes preview instantly. Apply to keep them.")}</p>
				</div>
				<button type="button" class="btn btn-sm btn-default tm-cz-close" aria-label="${__("Close")}">✕</button>
			</header>
			<div class="tm-cz-scroll"></div>
			<footer class="tm-cz-footer">
				${isAdmin ? `<label class="tm-cz-scope"><input type="checkbox" class="tm-cz-site"> ${__("Save as site default for everyone")}</label>` : ""}
				<div class="tm-cz-actions">
					<button type="button" class="btn btn-sm btn-default tm-cz-reset">${__("Reset")}</button>
					<button type="button" class="btn btn-sm btn-default tm-cz-cancel">${__("Cancel")}</button>
					<button type="button" class="btn btn-sm btn-primary tm-cz-apply">${__("Apply")}</button>
				</div>
			</footer>
		</aside>
	`);
	const $body = $drawer.find(".tm-cz-scroll");
	const set = (key, value) => {
		state[key] = value;
		/* The master switch is not previewed: switching it off would take the
		 * stylesheet this drawer is drawn with from under it. It is saved with
		 * Apply and the page reloads. Off is the only change; "On" is where
		 * the drawer already is. */
		if (key === "use_theme") {
			if (value === "On") delete state[key];
			return;
		}
		window.themate.preview({ [key]: value });
	};

	/* 0. The master switch: the theme at all, or the original Frappe desk */
	let $s = section(__("Themate Theme"), __("Off: original Frappe look"));
	$s.find(".tm-cz-body").append(segmented("use_theme", [
		{ value: "On", label: __("On", null, "Theme switch") },
		{ value: "Off", label: __("Off", null, "Theme switch") },
	], "On", (v) => set("use_theme", v)));
	$body.append($s);

	/* 1. Mode */
	$s = section(__("Appearance"));
	$s.find(".tm-cz-body").append(segmented("theme_mode", ["Light", "Dark", "Auto"], prefs.theme_mode || site.default_mode || "Light", (v) => set("theme_mode", v)));
	$body.append($s);

	/* 2. Accent */
	$s = section(__("Accent Color"), __("Buttons, links, active items"));
	$s.find(".tm-cz-body").append(swatches(prefs.accent_color, (v) => set("accent_color", v)));
	$body.append($s);

	/* 3. Typography */
	$s = section(__("Typography"));
	$s.find(".tm-cz-body")
		.append($()(`<div class="tm-cz-label">${__("Font")}</div>`))
		.append(segmented("font_family", ["Inter", "Cairo", "System"], prefs.font_family || site.font_family || "Inter", (v) => set("font_family", v)))
		.append($()(`<div class="tm-cz-label">${__("Base font size")} <span class="tm-cz-hint">${__("Site default: {0}px", [site.font_size || 14])}</span></div>`))
		.append(slider("font_size", FONT_RANGE, prefs.font_size, site.font_size || 14, "px", (v) => set("font_size", v)));
	$body.append($s);

	/* 4. Shape & density */
	$s = section(__("Shape & Density"));
	$s.find(".tm-cz-body")
		.append($()(`<div class="tm-cz-label">${__("Corners")}</div>`))
		.append(segmented("radius_preset", ["Sharp", "Default", "Round"], prefs.radius_preset || site.radius_preset || "Default", (v) => set("radius_preset", v)))
		.append($()(`<div class="tm-cz-label">${__("Density")}</div>`))
		.append(segmented("density", ["Comfortable", "Compact"], prefs.density || site.density || "Comfortable", (v) => set("density", v)));
	$body.append($s);

	/* 5. Icons */
	$s = section(__("Icons"), __("Themate Business set"));
	$s.find(".tm-cz-body")
		.append($()(`<div class="tm-cz-label">${__("Style")}</div>`))
		.append(segmented("icon_style", ["Duotone", "Outline"], prefs.icon_style || site.icon_style || "Duotone", (v) => set("icon_style", v)))
		.append($()(`<div class="tm-cz-label">${__("Size")} <span class="tm-cz-hint">${__("Site default: {0}px", [site.icon_size || 18])}</span></div>`))
		.append(slider("icon_size", ICON_RANGE, prefs.icon_size, site.icon_size || 18, "px", (v) => set("icon_size", v)));
	$body.append($s);

	/* 5b. Text styles */
	$s = section(__("Text Styles"), __("Size, weight, italic, colour"));
	$s.find(".tm-cz-body").append(buildTextStyles(prefs, site, set));
	$body.append($s);

	/* 6. Charts: the series palette */
	$s = section(__("Charts"), __("Series colours in charts and widgets"));
	$s.find(".tm-cz-body").append(buildChartPalette(prefs, site, set));
	$body.append($s);

	/* 7. Sidebar: theme, colour, art, state */
	const $art = buildSidebarArt(prefs, site, set);
	$s = section(__("Sidebar"));
	$s.find(".tm-cz-body")
		.append($()(`<div class="tm-cz-label">${__("Theme")}</div>`))
		.append(segmented("sidebar_theme", ["Dark", "Light"], prefs.sidebar_theme || site.sidebar_theme || "Dark", (v) => set("sidebar_theme", v)))
		.append($()(`<div class="tm-cz-label">${__("Background")} <span class="tm-cz-hint">${__("Dark theme only")}</span></div>`))
		.append((() => {
			const $el = $()(`<div class="tm-cz-swatches" role="radiogroup"></div>`);
			const current = prefs.sidebar_bg || "";
			const siteBg = site.sidebar_bg || "#0f1b3d";
			const all = [{ label: __("Site default"), hex: "", swatch: siteBg }].concat(SIDEBAR_COLORS);
			const follow = (hex) => $art[0]._follow(hex);
			const mark = (hex) => $el.find(".tm-cz-swatch").each(function () { const on = (this.dataset.hex || "") === (hex || ""); this.classList.toggle("selected", on); this.setAttribute("aria-checked", on); });
			all.forEach((a) => {
				const $sw = $()(`<button type="button" class="tm-cz-swatch" role="radio" data-hex="${a.hex}" title="${a.label}" aria-label="${a.label}" style="--swatch:${a.swatch || a.hex}"></button>`);
				$sw.on("click", () => { mark(a.hex); $el.find("input[type=color]").val(a.hex || siteBg); set("sidebar_bg", a.hex || null); follow(a.hex); });
				$el.append($sw);
			});
			const $custom = $()(`<label class="tm-cz-custom" title="${__("Custom color")}"><input type="color" value="${current || siteBg}"><span>${__("Custom")}</span></label>`);
			$custom.find("input").on("input", function () { mark(this.value); set("sidebar_bg", this.value); follow(this.value); });
			$el.append($custom);
			mark(current);
			return $el;
		})())
		.append($()(`<div class="tm-cz-label">${__("Background image")} <span class="tm-cz-hint">${__("Dark theme only")}</span></div>`))
		.append(segmented("sidebar_art", [
			{ value: "On", label: __("On", null, "Theme switch") },
			{ value: "Off", label: __("Off", null, "Theme switch") },
		], prefs.sidebar_art || site.sidebar_art || "On", (v) => set("sidebar_art", v)))
		.append($art)
		.append($()(`<div class="tm-cz-label">${__("State")}</div>`))
		.append(segmented("sidebar", [
		{ value: "expanded", label: __("Expanded") }, { value: "rail", label: __("Rail") },
	], sidebarCollapsed() ? "rail" : "expanded", (v) => {
		const wantCollapsed = v === "rail";
		if (sidebarCollapsed() !== wantCollapsed) window.frappe?.themate_sidebar?.toggle_sidebar?.();
	}));
	$body.append($s);

	/* 8. Form: Activity placement (Dialog vs Inline under form) */
	$s = section(__("Form Activity"), __("Comments and timeline placement"));
	$s.find(".tm-cz-body")
		.append(segmented("activity_display", [
			{ value: "Dialog", label: __("Dialog") },
			{ value: "Inline", label: __("Inline") },
		], prefs.activity_display || site.activity_display || "Dialog", (v) => set("activity_display", v)));
	$body.append($s);

	/* 9. Form: the edge the record's side panel sits on */
	$s = section(__("Form Side Panel"), __("Overview, attachments, tags, share"));
	$s.find(".tm-cz-body")
		.append($()(`<div class="tm-cz-label">${__("Panel position")} <span class="tm-cz-hint">${__("Auto follows the language")}</span></div>`))
		.append(segmented("form_panel_side", [
			{ value: "Auto", label: __("Auto") },
			{ value: "Left", label: __("Left", null, "Side panel position") },
			{ value: "Right", label: __("Right", null, "Side panel position") },
		], prefs.form_panel_side || site.form_panel_side || "Auto", (v) => set("form_panel_side", v)));
	$body.append($s);

	/* Footer actions */
	$drawer.find(".tm-cz-close, .tm-cz-cancel").on("click", () => cancel());
	$drawer.find(".tm-cz-apply").on("click", () => apply());
	$drawer.find(".tm-cz-reset").on("click", () => reset());

	$()(document.body).append($drawer);
	$()(document).on("keydown.tm-customizer", (e) => { if (e.key === "Escape" && isOpen()) cancel(); });
}

function isOpen() {
	return $drawer && !$drawer[0].hidden;
}

function open() {
	if (!$()) return;
	if ($drawer) $drawer.remove();
	snapshot = currentPrefs();
	state = {};
	build();
	$drawer[0].hidden = false;
	requestAnimationFrame(() => $drawer.addClass("open"));
}

function close() {
	if (!$drawer) return;
	$drawer.removeClass("open");
	setTimeout(() => { if ($drawer) $drawer[0].hidden = true; }, 220);
}

function cancel() {
	if (snapshot) {
		boot().user_prefs = Object.assign({}, snapshot);
		window.themate.apply();
	}
	close();
}

function apply() {
	const changed = Object.assign({}, state);
	const toSite = $drawer.find(".tm-cz-site").is(":checked");
	const $btn = $drawer.find(".tm-cz-apply").prop("disabled", true);

	/* Off (or back On) changes which scripts and stylesheets the page has at
	 * all: that is a reload, not a re-apply. */
	const reload = Object.prototype.hasOwnProperty.call(changed, "use_theme");
	const done = (prefs) => {
		if (reload) {
			window.frappe?.show_alert?.({ message: __("Reloading with the new theme setting…"), indicator: "blue" }, 3);
			setTimeout(() => window.location.reload(), 350);
			return;
		}
		if (prefs) boot().user_prefs = prefs;
		window.themate.apply();
		window.frappe?.show_alert?.({ message: toSite ? __("Saved as the site default") : __("Theme preferences saved"), indicator: "green" }, 3);
		close();
	};
	const fail = () => { $btn.prop("disabled", false); };

	if (!toSite) {
		window.frappe.call({ method: "themate.api.save_prefs", args: { values: changed }, callback: (r) => done(r.message), error: fail });
		return;
	}

	/* Publish: write Theme Settings, then clear this user's own copies of the
	 * same fields so the site value is what they keep seeing. */
	const siteValues = {};
	const clearMine = {};
	Object.keys(changed).forEach((k) => {
		if (!SITE_MAP[k]) return;
		if (k === "accent_color" && !changed[k]) return; /* "site brand" = leave the brand alone */
		siteValues[SITE_MAP[k]] = k === "use_theme" ? (changed[k] === "Off" ? 0 : 1) : changed[k];
		clearMine[k] = null;
	});
	if (siteValues.brand_color) siteValues.accent_preset = "Custom";

	window.frappe.call({
		method: "themate.api.update_theme_settings", args: { values: siteValues },
		callback: (r) => {
			if (r.message) Object.assign(boot(), r.message, { user_prefs: boot().user_prefs });
			const mine = Object.keys(changed).filter((k) => !SITE_MAP[k]).reduce((o, k) => ((o[k] = changed[k]), o), {});
			window.frappe.call({ method: "themate.api.save_prefs", args: { values: Object.assign(mine, clearMine) }, callback: (r2) => done(r2.message), error: fail });
		},
		error: fail,
	});
}

function reset() {
	window.frappe.call({
		method: "themate.api.reset_prefs",
		callback: (r) => {
			boot().user_prefs = r.message;
			window.themate.apply();
			window.frappe?.show_alert?.({ message: __("Back to the site defaults"), indicator: "blue" }, 3);
			close();
		},
	});
}

/* ---- entry points ------------------------------------------------------- */

/* With the theme off there is no drawer (its stylesheet is gone) — the user
 * menu keeps ONE plain, native-looking item that turns the theme back on for
 * this account. Hidden by Theme Settings > Show Customizer Button, unless the
 * account itself switched the theme off: that way back must always exist. */
function turnOn() {
	window.frappe.call({
		method: "themate.api.save_pref",
		args: { key: "use_theme", value: JSON.stringify("On") },
		callback: () => window.location.reload(),
	});
}

function addMenuItem() {
	const menu = document.getElementById("toolbar-user");
	if (!menu || menu.querySelector(".tm-cz-menu-item")) return;
	const off = window.themate?.enabled?.() === false;
	if (off && boot().navbar?.customizer_button === 0 && String(boot().user_prefs?.use_theme || "").toLowerCase() !== "off") return;
	const item = document.createElement("button");
	item.type = "button";
	item.className = "btn-reset dropdown-item tm-cz-menu-item";
	item.textContent = off ? __("Turn on Themate theme") : __("Theme Customizer");
	item.addEventListener("click", (e) => { e.preventDefault(); if (off) turnOn(); else open(); });
	/* Right after "My Settings" when it exists, otherwise first. */
	const anchor = menu.querySelector('a[href="/app/user-profile"], a[href^="/app/user/"]');
	if (anchor && anchor.nextSibling) menu.insertBefore(item, anchor.nextSibling);
	else menu.prepend(item);
}

if (window.jQuery) {
	window.jQuery(document).on("toolbar_setup", addMenuItem);
	window.jQuery(addMenuItem);
}

window.themate = window.themate || {};
window.themate.openCustomizer = open;
window.themate.closeCustomizer = close;

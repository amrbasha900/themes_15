/* Themate bootstrap — applies Theme Settings and user preferences to the
 * document root before the Desk renders.
 *
 * Runs from themate.bundle.js, loaded via hooks.py `app_include_js`, which
 * Frappe emits after its own desk bundle (verified: frappe/www/app.py:47).
 * `frappe.boot` is already populated at this point because frappe/www/app.html
 * writes it inline in the template, so no readiness polling is needed.
 *
 * Four defects from the previous revision are fixed here; see
 * FRAPPE_UI_MAP.md §5 findings 1, 2, 5, 6 and 7. */

/* Single source of truth for the default accent. Must stay in step with
 * --tm-brand-500 in scss/tokens/_palette.scss and THEME_DEFAULTS["brand_color"]
 * in themate/api.py — the previous revision had three different values. */
const DEFAULT_BRAND = "#1677ff";

/* Bumping this invalidates every locally stored preference. Local values are a
 * convenience, not a system of record: without a version an admin changing the
 * brand colour could never override a user's stale localStorage entry
 * (FRAPPE_UI_MAP.md §5 finding 5). */
const PREF_VERSION = "2";
const PREF_VERSION_KEY = "tm:pref-version";
const BRAND_KEY = "tm:brand-color";

/* Frappe's User.desk_theme stores Light/Dark/Automatic; Themate's own Select
 * historically used "Auto". Both spellings are accepted and mapped onto the
 * lowercase vocabulary frappe.ui.set_theme expects
 * (ui/theme_switcher.js:56-71). Never invent a third. */
const MODE_TO_FRAPPE = {
	Light: "light",
	Dark: "dark",
	Auto: "automatic",
	Automatic: "automatic",
};

function hexToRgb(hex) {
	const value = String(hex || "")
		.trim()
		.replace("#", "");

	if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) {
		return null;
	}

	const normalized =
		value.length === 3
			? value
					.split("")
					.map((char) => char + char)
					.join("")
			: value;

	return {
		r: parseInt(normalized.slice(0, 2), 16),
		g: parseInt(normalized.slice(2, 4), 16),
		b: parseInt(normalized.slice(4, 6), 16),
	};
}

function componentToHex(value) {
	return Math.round(Math.max(0, Math.min(255, value)))
		.toString(16)
		.padStart(2, "0");
}

function rgbToHex({ r, g, b }) {
	return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

function mix(hex, target, amount) {
	const source = hexToRgb(hex);
	const targetRgb = hexToRgb(target);

	if (!source || !targetRgb) {
		return hex;
	}

	return rgbToHex({
		r: source.r + (targetRgb.r - source.r) * amount,
		g: source.g + (targetRgb.g - source.g) * amount,
		b: source.b + (targetRgb.b - source.b) * amount,
	});
}

/* Applies a brand accent by emitting mode-scoped CSS rules.
 *
 * WHY NOT INLINE STYLES: the previous implementation wrote each stop with
 * root.style.setProperty(), i.e. an inline style on <html>. An inline style
 * beats every stylesheet rule, including the [data-theme="dark"] block in
 * tokens/_dark.scss — so in dark mode the light ramp was painted over the dark
 * one (--tm-brand-500 became #1677ff where the design says #1668dc) and
 * components rendered against colours the contract never specified. A single
 * inline value cannot be mode-aware; a stylesheet rule can.
 *
 * WHY IT IS OFTEN A NO-OP: when the configured accent is the default, the
 * frozen ramps in _palette.scss and _dark.scss are already exactly right, so
 * nothing is emitted and the CSS stays the single source of truth. Runtime
 * generation only happens for a genuinely custom brand colour.
 *
 * The ramps come from core/palette.js, which ports Ant Design's own palette
 * algorithm and reproduces both frozen ramps exactly (tests/palette.test.js). */
const BRAND_STYLE_ID = "tm-brand-scale";

function removeBrandStyle() {
	document.getElementById(BRAND_STYLE_ID)?.remove();
}

function applyBrandScale(root, color) {
	const palette = window.themate?.palette;
	if (!palette) return;

	const normalized = palette.hexToRgb(color) ? String(color).trim().toLowerCase() : null;

	/* Unknown colour, or the default: let the stylesheets own the ramp. */
	if (!normalized || normalized === DEFAULT_BRAND) {
		removeBrandStyle();
		return;
	}

	const light = palette.generate(normalized);
	const dark = palette.generateDark(normalized, palette.DARK_SURFACE);
	if (!light || !dark) {
		removeBrandStyle();
		return;
	}

	const decls = (ramp) =>
		palette.STEPS.map((step, i) => `--tm-brand-${step}:${ramp[i]};`).join("");

	/* Selectors mirror the compiled token blocks EXACTLY —
	 *   html:not([data-tm-enabled="off"])                     (_palette.scss)
	 *   html:not([data-tm-enabled="off"])[data-theme="dark"]  (_dark.scss)
	 * — so this sheet ties them on specificity and wins by being appended
	 * last, not by !important. A bare [data-theme="dark"] here is (0,1,0)
	 * against the dark block's (0,2,1): it never won, and every custom brand
	 * silently fell back to the frozen blue ramp in dark mode. */
	const css =
		`html:not([data-tm-enabled="off"]):not([data-theme="dark"]){${decls(light)}}` +
		`html:not([data-tm-enabled="off"])[data-theme="dark"]{${decls(dark)}}`;

	let el = document.getElementById(BRAND_STYLE_ID);
	if (!el) {
		el = document.createElement("style");
		el.id = BRAND_STYLE_ID;
		(document.head || document.documentElement).appendChild(el);
	}

	/* Keep it last so a later-loaded app stylesheet cannot silently outrank it. */
	if (el.parentNode && el.parentNode.lastChild !== el) {
		el.parentNode.appendChild(el);
	}

	if (el.textContent !== css) {
		el.textContent = css;
	}
}

/* Honours the configured font and uses bundled faces only.
 *
 * The previous revision read
 *   font && font !== "Inter" && stacks[font] ? font : "Outfit"
 * which substituted Outfit whenever Inter was chosen — and Inter is the
 * configured default (api.py THEME_DEFAULTS), so the default could never
 * apply. Outfit and Plus Jakarta Sans were CDN fonts and are gone; only the
 * faces actually shipped in public/fonts are offered
 * (FRAPPE_UI_MAP.md §5 findings 2 and 3). */
function applyFont(root, font) {
	const system = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
	const stacks = {
		Inter: `"InterVariable", "Cairo", ${system}`,
		Cairo: `"Cairo", "InterVariable", ${system}`,
		System: system,
	};

	const chosen = stacks[font] ? font : "Inter";
	root.style.setProperty("--tm-font-stack", stacks[chosen]);
	root.dataset.tmFont = chosen.toLowerCase();
}

/* Base font size in px: the user's own choice wins, then the site default,
 * then the 14px contract base. The whole type ramp (and Frappe's --text-*
 * through the bridge) is `<contract px> * --tm-font-scale`. */
const BASE_FONT_PX = 14;

function applyFontSize(root, theme, prefs) {
	const px = Number(prefs.font_size) || Number(theme.font_size) || BASE_FONT_PX;
	const clamped = Math.min(20, Math.max(11, px));
	root.style.setProperty("--tm-font-scale", (clamped / BASE_FONT_PX).toFixed(4));
	root.dataset.tmFontSize = String(clamped);
}

/* Sidebar theme and colour: user preference, then site. The navy tokens in
 * _semantic.scss are the default; a custom colour overrides --tm-sidebar-bg
 * inline and the hover/active/raised tones are derived with color-mix in
 * _modern-sidebar.scss, so one hex is enough. */
function applySidebarTheme(root, theme, prefs) {
	const mode = String(prefs.sidebar_theme || theme.sidebar_theme || "Dark").toLowerCase();
	root.dataset.tmSidebarTheme = mode === "light" ? "light" : "dark";
	const bg = prefs.sidebar_bg || theme.sidebar_bg;
	if (bg && /^#[0-9a-f]{6}$/i.test(bg)) {
		root.style.setProperty("--tm-sidebar-bg", bg);
		root.dataset.tmSidebarCustom = "on";
	} else {
		root.style.removeProperty("--tm-sidebar-bg");
		delete root.dataset.tmSidebarCustom;
	}
	/* The art is dark, so it needs the dark sidebar's light text. */
	const art = mode !== "light" && (prefs.sidebar_art || theme.sidebar_art) !== "Off";
	root.dataset.tmSidebarArt = art ? "on" : "off";
	const painter = window.themate.art;
	if (art) painter?.sidebar(painter.colors(theme, prefs));
	else painter?.clearSidebar();
	painter?.greeting(effectiveAccent());
}

/* Per-element typography (components/_typography.scss). Site defaults and
 * the user's own entries merge per element; each set property becomes an
 * inline custom property on <html>, and anything unset is removed so the
 * SCSS fallbacks apply. */
const TEXT_STYLE_KEYS = ["title", "subtitle", "section", "tab", "label", "body", "menu"];

function mergedTextStyles(theme, prefs) {
	const out = {};
	TEXT_STYLE_KEYS.forEach((key) => {
		const site = (theme.text_styles || {})[key] || {};
		const mine = (prefs.text_styles || {})[key] || {};
		out[key] = Object.assign({}, site, mine);
	});
	return out;
}

function applyTextStyles(root, theme, prefs) {
	const styles = mergedTextStyles(theme, prefs);
	TEXT_STYLE_KEYS.forEach((key) => {
		const spec = styles[key];
		const set = (prop, value) => {
			const name = `--tm-ts-${key}-${prop}`;
			if (value === undefined || value === null || value === "") root.style.removeProperty(name);
			else root.style.setProperty(name, value);
		};
		set("size", spec.size ? `${spec.size}px` : null);
		set("weight", spec.weight ? String(spec.weight) : null);
		set("style", spec.italic ? "italic" : null);
		set("color", spec.color || null);
	});
}

/* Chart palette — Theme Settings > Charts > Chart Palette, overridden by the
 * user's own choice (Theme Customizer > Charts). Sets --tm-chart-1..8, which
 * every chart (charts/adapter.js) and widget (widgets/smart_widget.js)
 * reads at render; "Brand" clears them so the compiled tokens apply (chart 1
 * = the brand colour). Charts already on screen re-render on themate:charts. */
const CHART_PALETTES = {
	Ocean: ["#0ea5e9", "#6366f1", "#14b8a6", "#3b82f6", "#8b5cf6", "#06b6d4", "#2563eb", "#0f766e"],
	Sunset: ["#f97316", "#ef4444", "#f59e0b", "#ec4899", "#d946ef", "#fb7185", "#f43f5e", "#ea580c"],
	Forest: ["#16a34a", "#65a30d", "#059669", "#84cc16", "#0d9488", "#22c55e", "#4d7c0f", "#10b981"],
	Slate: ["#334155", "#64748b", "#94a3b8", "#475569", "#1e293b", "#7c8aa3", "#cbd5e1", "#0f172a"],
	Pastel: ["#60a5fa", "#fbbf24", "#34d399", "#a78bfa", "#fb7185", "#2dd4bf", "#fb923c", "#93c5fd"],
};

function chartColors(theme, prefs) {
	const preset = prefs.chart_palette || theme.chart_palette || "Brand";
	if (preset === "Custom") {
		const own = prefs.chart_palette === "Custom" ? prefs.chart_colors : null;
		return { preset, colors: (own && own.length ? own : theme.chart_colors) || null };
	}
	return { preset, colors: CHART_PALETTES[preset] || null };
}

function applyChartPalette(root, theme, prefs) {
	const { preset, colors } = chartColors(theme, prefs);
	for (let i = 1; i <= 8; i++) {
		const c = colors && colors[i - 1];
		if (c) root.style.setProperty(`--tm-chart-${i}`, c);
		else root.style.removeProperty(`--tm-chart-${i}`);
	}
	root.dataset.tmChartPalette = preset.toLowerCase();
	document.dispatchEvent(new CustomEvent("themate:charts", { detail: { preset, colors } }));
}

/* Where a record's Activity (comments + timeline) shows: user preference,
 * then the site default. "dialog" = button in the page head (form_activity.js);
 * "inline" = the stock panel under the form. Read by _form-page.scss and
 * form_activity.js through html[data-tm-activity]. */
function activityMode(theme, prefs) {
	const v = String(prefs.activity_display || theme.activity_display || "Dialog").toLowerCase();
	return v === "inline" ? "inline" : "dialog";
}

function applyActivityDisplay(root, theme, prefs) {
	const mode = activityMode(theme, prefs);
	if (root.dataset.tmActivity === mode) return;
	root.dataset.tmActivity = mode;
	document.dispatchEvent(new CustomEvent("themate:activity", { detail: { mode } }));
}

/* Which edge the form's side panel (overview, attachments, tags, share) sits
 * on: user preference, then the site default. "Auto" is the end of the line —
 * right in English, left in Arabic; "Left" / "Right" pin it to that side of
 * the screen whatever the language. Settled here against the page's direction
 * into html[data-tm-panel="start|end"], so _form-page.scss never has to name
 * a screen side (rtlcss would mirror it). */
function panelEdge(theme, prefs, rtl) {
	const v = String(prefs.form_panel_side || theme.form_panel_side || "Auto").toLowerCase();
	if (v === "left") return rtl ? "end" : "start";
	if (v === "right") return rtl ? "start" : "end";
	return "end";
}

function applyPanelSide(root, theme, prefs) {
	const rtl = String(root.getAttribute("dir") || "ltr").toLowerCase() === "rtl";
	const edge = panelEdge(theme, prefs, rtl);
	if (root.dataset.tmPanel !== edge) root.dataset.tmPanel = edge;
}

/* THE master switch: the user's own choice (Theme Customizer > Themate
 * Theme, Themate User Preference) over the site's Enable Theme. "On" forces
 * the theme on where the site has it off, "Off" gives this account the
 * original Frappe desk where the site has it on. */
function themeOn(flags, prefs) {
	const own = String(prefs.use_theme || "").toLowerCase();
	if (own === "on") return true;
	if (own === "off") return false;
	return flags.theme === undefined ? true : Boolean(flags.theme);
}

/* Off means the browser is not given Themate's stylesheets at all. A
 * rollback that relied on every rule asking "am I on?" was only as good as
 * the last rule written — the old sidebar's never did, and left its logo,
 * its layout offsets and its hidden Workspaces sidebar on a "stock" desk. */
const THEMATE_CSS = 'link[rel="stylesheet"][href*="/assets/themate/dist/css"]';
function setStylesheets(on) {
	document.querySelectorAll(THEMATE_CSS).forEach((link) => {
		if (link.disabled === on) link.disabled = !on;
	});
}

/* Theme Settings > Show Workspace Icons. Read by _modern-sidebar.scss. */
function applyWorkspaceIcons(root, theme) {
	const show = theme.show_workspace_icons === undefined ? true : Boolean(theme.show_workspace_icons);
	root.dataset.tmWsIcons = show ? "on" : "off";
}

/* Theme Settings > Favicon. The <link rel="icon"> is server-rendered from
 * the static website_context hook (hooks.py), which cannot read a setting;
 * swapping it here is the only place that can. Only runs when one is set. */
function applyFavicon(theme) {
	if (!theme.favicon) return;
	document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach((el) => {
		if (el.getAttribute("href") !== theme.favicon) el.setAttribute("href", theme.favicon);
	});
}

/* Delegates the effective theme to Frappe instead of inventing a parallel
 * attribute.
 *
 * Frappe owns two attributes on <html> (ui/theme_switcher.js:129, 156-163):
 *   data-theme-mode  the user's choice: light | dark | automatic
 *   data-theme       the effective theme: light | dark
 * Both are server-rendered in frappe/www/app.html:2, so there is no flash to
 * avoid and nothing to set unless Themate's own preference disagrees.
 *
 * The previous revision wrote data-tm-mode, which no stylesheet read, while
 * tokens/_dark.scss targeted data-theme — so choosing Dark in Themate's
 * settings changed nothing at all (FRAPPE_UI_MAP.md §5 finding 1). */
/* Resolves which mode should apply, in the order that respects the user.
 *
 * THE BUG THIS FIXES: the previous version took `prefs.theme_mode ||
 * theme.default_mode` and applied whatever came out. `default_mode` is never
 * empty — api.py defaults it to "Light" — so the site default ALWAYS won. A
 * user who picked Dark in Frappe's own theme dialog got flipped back to Light
 * on the next page load, with no way to make it stick.
 *
 * `prefs.theme_mode` now mirrors Frappe's `User.desk_theme` (see
 * themate/api.py), which is the same field Frappe's own switcher writes via
 * frappe.core.doctype.user.user.switch_theme. One store, so the two can never
 * disagree. It is null when the user has genuinely never chosen, which is the
 * only case where the site default should speak. */
function resolveMode(theme, prefs) {
	/* 1. The user's own saved choice, wherever they made it. */
	if (prefs.theme_mode) {
		return { mode: prefs.theme_mode, source: "user" };
	}

	/* 2. Nobody has ever chosen: the site default applies. */
	if (theme.default_mode) {
		return { mode: theme.default_mode, source: "site-default" };
	}

	/* 3. Nothing configured: leave whatever the server rendered. */
	return { mode: null, source: "server" };
}

function applyThemeMode(root, theme, prefs) {
	const { mode, source } = resolveMode(theme, prefs);
	const frappeMode = MODE_TO_FRAPPE[mode];

	if (!frappeMode) {
		return source;
	}

	/* frappe/www/app.html:2 server-renders data-theme-mode from the same
	 * User.desk_theme value, so when the source is the user's own choice this
	 * is already correct and reassigning it is a no-op. Skipping the write
	 * avoids a needless style recalculation before first paint. */
	if (root.getAttribute("data-theme-mode") !== frappeMode) {
		root.setAttribute("data-theme-mode", frappeMode);
	} else if (root.getAttribute("data-theme")) {
		/* Mode already matches and an effective theme is rendered: nothing to do. */
		return source;
	}

	if (window.frappe?.ui?.set_theme) {
		/* Resolves "automatic" against the OS and writes data-theme. */
		window.frappe.ui.set_theme();

		/* Keep tracking the OS while the page is open. Frappe registers this
		 * itself during boot; calling it again would double-bind, so it is only
		 * registered here when Themate set the mode before boot ran. */
		if (frappeMode === "automatic" && !window.themate._systemListenerBound) {
			window.frappe.ui.add_system_theme_switch_listener?.();
			window.themate._systemListenerBound = true;
		}
	} else {
		/* Frappe's UI layer has not initialised yet. Resolve it the same way
		 * frappe.ui.set_theme does so the first paint is correct; Frappe will
		 * recompute the identical value during boot. */
		const effective =
			frappeMode === "automatic"
				? window.matchMedia?.("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light"
				: frappeMode;
		root.setAttribute("data-theme", effective);
	}

	return source;
}

/* Feature flags. Each maps to an html[data-tm-*="on"] scope in the SCSS, so
 * turning one off actually removes that area's rules — the previous revision
 * wrote these attributes but no stylesheet read them
 * (FRAPPE_UI_MAP.md §5 finding 11). */
function setFlag(root, name, enabled) {
	root.dataset[`tm${name}`] = enabled ? "on" : "off";
}

/* Reads a locally stored override, discarding anything written by an older
 * version of this file. */
function readLocalOverride(key) {
	try {
		if (localStorage.getItem(PREF_VERSION_KEY) !== PREF_VERSION) {
			return null;
		}
		return localStorage.getItem(key);
	} catch {
		/* Private mode / blocked storage: fall back to boot values. */
		return null;
	}
}

/* THE single answer to "which accent is in force?".
 *
 * Precedence: the configured brand colour is the system of record; a local
 * override applies only when nothing is configured and the stored value belongs
 * to the current preference version.
 *
 * THE BUG THIS FIXES: bootstrap used to resolve this inline while
 * core/theme_switcher.js had its own current_accent() that preferred
 * localStorage first. With a purple stored locally and a blue configured on the
 * site, the page painted blue while the picker showed purple as selected —
 * the UI disagreed with itself. Both now call this one function. */
function effectiveAccent() {
	const theme = window.frappe?.boot?.themate || {};
	const prefs = theme.user_prefs || {};
	/* The user's saved accent (Theme Customizer) beats the site brand; the
	 * localStorage override remains only as the pre-customizer fallback. */
	return prefs.accent_color || theme.brand_color || readLocalOverride(BRAND_KEY) || DEFAULT_BRAND;
}

function apply() {
	const theme = window.frappe?.boot?.themate || {};
	const root = document.documentElement;
	const flags = theme.flags || {};
	const prefs = theme.user_prefs || {};

	/* Master switch first: when the theme is off, every other attribute is
	 * forced off too, so no component rule can survive the rollback. The SCSS
	 * guard (scss/tokens/_guard.scss) keys off data-tm-enabled and removes the
	 * token layer and the Frappe variable bridge as well, which is what makes
	 * this a genuine rollback to stock Frappe rather than a partial one.
	 *
	 * Defaults to ON when the flag is absent, so a site that has not migrated
	 * the new field does not lose the theme. */
	const themeEnabled = themeOn(flags, prefs);
	root.dataset.tmEnabled = themeEnabled ? "on" : "off";
	setStylesheets(themeEnabled);

	if (!themeEnabled) {
		setFlag(root, "Sidebar", false);
		setFlag(root, "Navbar", false);
		setFlag(root, "List", false);
		setFlag(root, "Form", false);
		/* Nothing else may run: no brand stylesheet, no font override, and the
		 * user's Frappe theme choice is left exactly as the server rendered it. */
		removeBrandStyle();
		root.style.removeProperty("--tm-font-stack");
		delete root.dataset.tmFont;
		delete root.dataset.tmFontSize;
		delete root.dataset.tmSidebarTheme;
		delete root.dataset.tmSidebarCustom;
		delete root.dataset.tmSidebarArt;
		window.themate.art?.clear();
		delete root.dataset.tmActivity;
		delete root.dataset.tmPanel;
		delete root.dataset.tmWhitelabel;
		root.style.removeProperty("--tm-sidebar-bg");
		TEXT_STYLE_KEYS.forEach((k) => ["size", "weight", "style", "color"].forEach((p) => root.style.removeProperty(`--tm-ts-${k}-${p}`)));
		delete root.dataset.tmRadius;
		delete root.dataset.tmDensity;
		return;
	}

	setFlag(root, "Sidebar", Boolean(flags.sidebar));
	setFlag(root, "Navbar", Boolean(flags.navbar));
	setFlag(root, "List", Boolean(flags.list));
	setFlag(root, "Form", Boolean(flags.form));

	/* Each visual choice: the user's preference when set, else the site's. */
	root.dataset.tmRadius = (prefs.radius_preset || theme.radius_preset || "Default").toLowerCase();
	root.dataset.tmDensity = (prefs.density || theme.density || "Comfortable").toLowerCase();

	applyThemeMode(root, theme, prefs);
	applyFont(root, prefs.font_family || theme.font_family);
	applyFontSize(root, theme, prefs);
	applyWorkspaceIcons(root, theme);
	applyFavicon(theme);
	applySidebarTheme(root, theme, prefs);
	applyTextStyles(root, theme, prefs);
	applyChartPalette(root, theme, prefs);
	applyActivityDisplay(root, theme, prefs);
	applyPanelSide(root, theme, prefs);
	root.dataset.tmWhitelabel = theme.whitelabel === undefined || theme.whitelabel ? "on" : "off";
	window.themate?.applyIcons?.(root, theme, prefs);

	/* One resolver, shared with the accent picker — see effectiveAccent(). */
	applyBrandScale(root, effectiveAccent());

	/* Note: the previous revision forced
	 *   localStorage.setItem("container_fullwidth", "true")
	 * plus body.full-width on every boot, overwriting the user's own Frappe
	 * layout preference on every page load. Removed — Frappe owns that
	 * setting (FRAPPE_UI_MAP.md §5 finding 7). */
}

/* Live preview for the Theme Customizer: merge overrides into the boot copy
 * of the user's preferences and re-run apply(). The customizer keeps its own
 * snapshot to restore on cancel; nothing is persisted here. */
function preview(prefOverrides) {
	const theme = window.frappe?.boot?.themate;
	if (!theme) return;
	theme.user_prefs = Object.assign({}, theme.user_prefs, prefOverrides);
	apply();
}

/* For the JS modules that add markup (page icon, overview panel, search
 * chip): the master switch must silence them too, or the theme-off page
 * shows unstyled fragments. */
function enabled() {
	return document.documentElement.dataset.tmEnabled !== "off";
}

window.themate = window.themate || {};
window.themate.enabled = enabled;
window.themate.apply = apply;
window.themate.preview = preview;
window.themate.applyBrandScale = applyBrandScale;
window.themate.applyFontSize = applyFontSize;
window.themate.TEXT_STYLE_KEYS = TEXT_STYLE_KEYS;
window.themate.CHART_PALETTES = CHART_PALETTES;
window.themate.chartColors = chartColors;
window.themate.effectiveAccent = effectiveAccent;
window.themate.resolveMode = resolveMode;
window.themate.applyFont = applyFont;
window.themate.DEFAULT_BRAND = DEFAULT_BRAND;
window.themate.PREF_VERSION = PREF_VERSION;
window.themate.BRAND_KEY = BRAND_KEY;
window.themate.PREF_VERSION_KEY = PREF_VERSION_KEY;

/* Clears every local override so a user can get back to the configured theme.
 * The brief requires a defined reset path alongside preference precedence. */
window.themate.resetLocalPreferences = () => {
	try {
		localStorage.removeItem(BRAND_KEY);
		localStorage.removeItem(PREF_VERSION_KEY);
	} catch {
		/* storage unavailable — nothing to clear */
	}
	apply();
};

apply();

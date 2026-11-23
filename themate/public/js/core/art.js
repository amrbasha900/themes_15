/* The desk's background art, recoloured from the SVGs' own colour variables
 * (public/*.svg, bundled by tests/tools/build_art.py into core/art_svgs.js).
 *
 * A data URI on one <style> rule, not an inline <svg>: no DOM nodes, no ids to
 * collide, nothing inherited down the desk, and the browser rasterises it once.
 * Bundled rather than fetched, so there is no request and no flash on load.
 * Loaded before core/bootstrap.js, which calls it on every apply. */
(function () {
	const HEX = /^#[0-9a-f]{6}$/i;
	const VARS = /--([a-z-]+):\s*(#[0-9a-f]{6})/gi;
	const svgs = window.themate.artSvgs;
	const palette = (svg) => [...svg.matchAll(VARS)].map((m) => ({ name: m[1], hex: m[2] }));
	const SIDEBAR = palette(svgs.sidebar);
	const GREETING = palette(svgs.greeting);
	const DEFAULTS = SIDEBAR.map((v) => v.hex);
	/* The greeting file is drawn for the default accent; other accents turn its hue. */
	const DRAWN_FOR = "#1677ff";

	function toHsl(hex) {
		const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
		const mx = Math.max(r, g, b);
		const mn = Math.min(r, g, b);
		const d = mx - mn;
		const l = (mx + mn) / 2;
		if (!d) return [0, 0, l];
		const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
		return [h * 60, d / (1 - Math.abs(2 * l - 1)), l];
	}

	function toHex(h, s, l) {
		const f = (n) => {
			const k = (n + h / 30) % 12;
			const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
			return Math.round(v * 255).toString(16).padStart(2, "0");
		};
		return `#${f(0)}${f(8)}${f(4)}`;
	}

	/* One sidebar colour gives them all: same hue, the file's own lightness steps. */
	function derive(base) {
		const [h, s, l] = toHsl(base);
		const sat = (min) => Math.max(s, s ? min : 0);
		const steps = {
			"bg-top": toHex(h, s, l * 0.6),
			"bg-bottom": base,
			"wave-dark": toHex(h, sat(0.7), Math.min(l + 0.12, 0.3)),
			"wave-light": toHex(h, sat(0.8), 0.44),
			accent: toHex(h, sat(0.9), 0.6),
		};
		return SIDEBAR.map((v) => steps[v.name] || v.hex);
	}

	/* Own colours, then the site's, then derived from the sidebar colour, then the file's. */
	function colors(theme, prefs) {
		const own = [prefs.sidebar_art_colors, theme.sidebar_art_colors].find(
			(list) => Array.isArray(list) && list.length === DEFAULTS.length && list.every((c) => HEX.test(c))
		);
		if (own) return own;
		const bg = prefs.sidebar_bg || theme.sidebar_bg;
		return bg && HEX.test(bg) ? derive(bg) : DEFAULTS.slice();
	}

	/* The art runs along one side, so RTL mirrors it to stay clear of the text. */
	function url(svg, values) {
		let out = svg.replace(VARS, (m, name, hex) => `--${name}:${values[name] || hex}`);
		if (document.documentElement.dir === "rtl") {
			const width = svg.match(/viewBox="0 0 (\d+)/)[1];
			out = out.replace("</defs>", `</defs><g transform="matrix(-1 0 0 1 ${width} 0)">`).replace("</svg>", "</g></svg>");
		}
		return `url("data:image/svg+xml,${encodeURIComponent(out)}")`;
	}

	function write(id, key, css) {
		let el = document.getElementById(id);
		if (el?.dataset.key === key) return;
		if (!el) {
			el = document.createElement("style");
			el.id = id;
			document.head.appendChild(el);
		}
		el.dataset.key = key;
		el.textContent = css();
	}

	const clearSidebar = () => document.getElementById("tm-sidebar-art")?.remove();

	function sidebar(list) {
		if (list.length !== DEFAULTS.length || !list.every((c) => HEX.test(c))) return clearSidebar(); /* these go into a stylesheet */
		const values = Object.fromEntries(SIDEBAR.map((v, i) => [v.name, list[i]]));
		write("tm-sidebar-art", `${list.join()}|${document.documentElement.dir}`, () =>
			`html[data-tm-sidebar-art="on"] .modern-sidebar{background-image:${url(svgs.sidebar, values)}}`);
	}

	/* Both modes in one sheet, so a theme flip needs no JS; the dark one is only
	 * rasterised if it is ever painted. Lightness inverts, because the greeting's
	 * text is dark on the light card and light on the dark one. */
	function greeting(brand) {
		const accent = brand && HEX.test(brand) ? brand : DRAWN_FOR;
		const [brandHue, brandSat] = toHsl(accent);
		const turn = brandSat < 0.08 ? 0 : brandHue - toHsl(DRAWN_FOR)[0];
		const light = {};
		const dark = {};
		GREETING.forEach(({ name, hex }) => {
			const [h, s, l] = toHsl(hex);
			light[name] = toHex((h + turn + 360) % 360, s, l);
			dark[name] = toHex((h + turn + 360) % 360, s * 0.7, 0.1 + (1 - l) * 0.7);
		});
		const card = ".tm-ws-card .page-head .page-head-content";
		write("tm-greeting-art", `${accent}|${document.documentElement.dir}`, () =>
			`html:not([data-theme="dark"]) ${card}{background-image:${url(svgs.greeting, light)}}` +
			`html[data-theme="dark"] ${card}{background-image:${url(svgs.greeting, dark)}}`);
	}

	function clear() {
		clearSidebar();
		document.getElementById("tm-greeting-art")?.remove();
	}

	window.themate.art = { colors, sidebar, clearSidebar, greeting, clear, DEFAULTS };
})();

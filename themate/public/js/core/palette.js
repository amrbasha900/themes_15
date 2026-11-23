/* Brand ramp generation.
 *
 * This is Ant Design's own `@ant-design/colors` palette algorithm, ported so
 * that a runtime brand colour produces the SAME ramp shape the frozen palettes
 * in scss/tokens/_palette.scss and _dark.scss were built from.
 *
 * Verified: generate("#1677ff") reproduces the light ramp in _palette.scss
 * exactly, and generateDark("#1677ff") reproduces the dark ramp in _dark.scss
 * exactly — all 20 stops. tests/palette.test.js asserts this, so the CSS and the
 * JS can never drift apart silently again.
 *
 * The previous implementation mixed linearly toward white and black, which
 * produced a visibly different ramp (#4995ff where the contract says #4096ff)
 * and had no concept of dark mode at all.
 *
 * Attached to window rather than exported, so the module loads identically
 * through esbuild (the bundle) and as a plain script (the tests). */

(function () {
	const HUE_STEP = 2;
	const SAT_STEP = 0.16;
	const SAT_STEP_2 = 0.05;
	const BRI_STEP_1 = 0.05;
	const BRI_STEP_2 = 0.15;
	const LIGHT_COUNT = 5;
	const DARK_COUNT = 4;

	/* Ant's dark theme derives each stop by mixing the dark page background with
	 * a stop of the LIGHT ramp at a given weight. Index into the light ramp,
	 * then percentage of that colour over the background. */
	const DARK_MAP = [
		[7, 15], [6, 25], [5, 30], [5, 45], [5, 65],
		[5, 85], [4, 90], [3, 95], [2, 97], [1, 98],
	];

	const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

	function hexToRgb(hex) {
		let h = String(hex || "").trim().replace("#", "");
		if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)) return null;
		if (h.length === 3) h = h.split("").map((c) => c + c).join("");
		return {
			r: parseInt(h.slice(0, 2), 16),
			g: parseInt(h.slice(2, 4), 16),
			b: parseInt(h.slice(4, 6), 16),
		};
	}

	function rgbToHex({ r, g, b }) {
		return (
			"#" +
			[r, g, b]
				.map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0"))
				.join("")
		);
	}

	function rgbToHsv({ r, g, b }) {
		r /= 255;
		g /= 255;
		b /= 255;
		const mx = Math.max(r, g, b);
		const mn = Math.min(r, g, b);
		const d = mx - mn;
		let h = 0;
		if (d) {
			if (mx === r) h = ((g - b) / d) % 6;
			else if (mx === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h *= 60;
			if (h < 0) h += 360;
		}
		return { h, s: mx ? d / mx : 0, v: mx };
	}

	function hsvToRgb({ h, s, v }) {
		const c = v * s;
		const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		const m = v - c;
		let p;
		if (h < 60) p = [c, x, 0];
		else if (h < 120) p = [x, c, 0];
		else if (h < 180) p = [0, c, x];
		else if (h < 240) p = [0, x, c];
		else if (h < 300) p = [x, 0, c];
		else p = [c, 0, x];
		return { r: (p[0] + m) * 255, g: (p[1] + m) * 255, b: (p[2] + m) * 255 };
	}

	function getHue(hsv, i, light) {
		const round = Math.round(hsv.h);
		let hue;
		/* Warm hues rotate one way, cool hues the other, so tints stay in the
		 * same visual family instead of drifting toward a different hue. */
		if (round >= 60 && round <= 240) {
			hue = light ? round - HUE_STEP * i : round + HUE_STEP * i;
		} else {
			hue = light ? round + HUE_STEP * i : round - HUE_STEP * i;
		}
		if (hue < 0) hue += 360;
		if (hue >= 360) hue -= 360;
		return hue;
	}

	function getSaturation(hsv, i, light) {
		if (hsv.h === 0 && hsv.s === 0) return hsv.s; /* pure grey stays grey */
		let s;
		if (light) s = hsv.s - SAT_STEP * i;
		else if (i === DARK_COUNT) s = hsv.s + SAT_STEP;
		else s = hsv.s + SAT_STEP_2 * i;
		if (s > 1) s = 1;
		if (light && i === LIGHT_COUNT && s > 0.1) s = 0.1;
		if (s < 0.06) s = 0.06;
		return Number(s.toFixed(2));
	}

	function getValue(hsv, i, light) {
		const v = light ? hsv.v + BRI_STEP_1 * i : hsv.v - BRI_STEP_2 * i;
		return Number(Math.min(1, v).toFixed(2));
	}

	function mix(from, to, weight) {
		const a = hexToRgb(from);
		const b = hexToRgb(to);
		if (!a || !b) return to;
		const p = weight / 100;
		return rgbToHex({
			r: a.r + (b.r - a.r) * p,
			g: a.g + (b.g - a.g) * p,
			b: a.b + (b.b - a.b) * p,
		});
	}

	/* Ten stops, light to dark, matching --tm-brand-50 … --tm-brand-900. */
	function generate(color) {
		const rgb = hexToRgb(color);
		if (!rgb) return null;
		const hsv = rgbToHsv(rgb);
		const out = [];
		for (let i = LIGHT_COUNT; i > 0; i -= 1) {
			out.push(
				rgbToHex(
					hsvToRgb({
						h: getHue(hsv, i, true),
						s: getSaturation(hsv, i, true),
						v: getValue(hsv, i, true),
					})
				)
			);
		}
		out.push(rgbToHex(hsvToRgb(hsv)));
		for (let i = 1; i <= DARK_COUNT; i += 1) {
			out.push(
				rgbToHex(
					hsvToRgb({
						h: getHue(hsv, i),
						s: getSaturation(hsv, i),
						v: getValue(hsv, i),
					})
				)
			);
		}
		return out;
	}

	/* Dark-mode ramp. `background` must match --tm-surface in _dark.scss, since
	 * every stop is mixed over it. */
	function generateDark(color, background = "#141414") {
		const light = generate(color);
		if (!light) return null;
		return DARK_MAP.map(([index, amount]) => mix(background, light[index], amount));
	}

	const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

	window.themate = window.themate || {};
	window.themate.palette = {
		generate,
		generateDark,
		hexToRgb,
		rgbToHex,
		STEPS,
		DARK_SURFACE: "#141414",
	};
})();

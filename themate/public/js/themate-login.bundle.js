/* Login page: paint the configured brand colour.
 *
 * The login page has no desk boot payload, so core/bootstrap.js never runs
 * here and the login SCSS was stuck on the frozen default ramp whatever
 * Theme Settings said. www/login.py puts the colour on window.themate_login;
 * this uses the SAME ramp generator as the desk (core/palette.js) and the
 * SAME selectors as bootstrap's applyBrandScale, so a custom brand renders
 * identically on both sides of the login. */
import "./core/palette";

(function () {
	const cfg = window.themate_login || {};
	const palette = window.themate && window.themate.palette;
	const color = String(cfg.brand_color || "").trim().toLowerCase();
	if (!palette || !palette.hexToRgb(color) || color === "#1677ff") return;

	const light = palette.generate(color);
	const dark = palette.generateDark(color, palette.DARK_SURFACE);
	if (!light || !dark) return;

	const decls = (ramp) => palette.STEPS.map((step, i) => `--tm-brand-${step}:${ramp[i]};`).join("");
	const el = document.createElement("style");
	el.id = "tm-brand-scale";
	el.textContent =
		`html:not([data-tm-enabled="off"]):not([data-theme="dark"]){${decls(light)}}` +
		`html:not([data-tm-enabled="off"])[data-theme="dark"]{${decls(dark)}}`;
	(document.head || document.documentElement).appendChild(el);
})();

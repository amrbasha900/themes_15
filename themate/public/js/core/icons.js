/* Themate Business icons.
 *
 * public/icons.svg (built by tests/tools/build_icons.py, included through
 * hooks.py app_include_icons) defines `icon-tm-<name>` for every Frappe
 * workspace/shortcut icon name. Nothing in the database has to change: this
 * wraps frappe.utils.icon() so a request for "accounting" renders
 * `#icon-tm-accounting` when the sprite has it and falls through to Frappe's
 * own symbol when it does not. Espresso chrome icons ("es-line-*") are never
 * touched.
 *
 * Size, stroke weight, duotone tint and colour are CSS custom properties
 * (tokens/_semantic.scss --tm-icon-*), set here from Theme Settings and the
 * user's preference, so the customizer can change them live. */

/* The id set is read once and then cached, empty set included: this is asked
 * for on every single frappe.utils.icon() call, and re-running a
 * document-wide querySelectorAll on each of the hundreds of icons the desk
 * draws at boot is not free. watchSprite() below is what invalidates it — the
 * sprite arrives over the network, so "not there yet" is a real state, not a
 * reason to keep looking. */
let available = null;

function themateIds() {
	if (available) return available;
	available = new Set();
	document.querySelectorAll('symbol[id^="icon-tm-"]').forEach((s) => available.add(s.id.slice(8)));
	if (!available.size) watchSprite();
	return available;
}

/* The master switch (core/bootstrap.js) is read at call time: this file runs
 * before bootstrap does, and the renderer is asked for icons all session. */
const themeOff = () => document.documentElement.dataset.tmEnabled === "off";

function patchIconRenderer(frappe) {
	if (!frappe?.utils?.icon || frappe.utils.icon._tm_patched) return;
	const original = frappe.utils.icon;
	const patched = function (icon_name, size, icon_class, icon_style, svg_class) {
		if (typeof icon_name === "string" && !icon_name.startsWith("tm-") && !themeOff()) {
			/* timeless "add" and espresso "es-line-add" / "es-solid-add" all
			 * resolve to tm-add when the sprite has it; the sprite is built
			 * from both Frappe sets (tests/tools/build_icons.py) */
			const bare = icon_name.replace(/^es-(line|solid)-/, "");
			if (themateIds().has(bare)) {
				icon_name = "tm-" + bare;
				svg_class = (svg_class || "") + " tm-icon";
			}
		}
		return original.call(this, icon_name, size, icon_class, icon_style, svg_class);
	};
	patched._tm_patched = true;
	frappe.utils.icon = patched;
}

const STROKES = { light: "1.5", regular: "1.75", bold: "2" };

/* Theme Settings > Icons (site) overridden by the user's own choice. */
function applyIcons(root, theme, prefs) {
	const size = Number(prefs.icon_size) || Number(theme.icon_size) || 18;
	const style = String(prefs.icon_style || theme.icon_style || "Duotone").toLowerCase();
	const stroke = String(theme.icon_stroke || "Regular").toLowerCase();
	const color = String(theme.icon_color || "Inherit").toLowerCase();

	root.style.setProperty("--tm-icon-size", `${Math.min(28, Math.max(12, size))}px`);
	root.style.setProperty("--tm-icon-stroke", STROKES[stroke] || STROKES.regular);
	root.style.setProperty("--tm-icon-tint", style === "outline" ? "0" : "0.18");
	root.dataset.tmIconStyle = style === "outline" ? "outline" : "duotone";
	root.dataset.tmIconColor = color === "brand" ? "brand" : "inherit";
}

patchIconRenderer(window.frappe);

/* Icons written straight into templates (navbar.html, list settings, the
 * sidebar…) never pass through frappe.utils.icon. This rewrites their <use>
 * to the Themate symbol when one exists: once at start, on every page
 * change, and for nodes added later (rAF-coalesced, added subtrees only).
 * A swapped <svg> gets .tm-icon so stroke width and tint follow the theme. */
function swapUses(root) {
	if (themeOff()) return;
	const ids = themateIds();
	if (!ids.size) return;
	const scope = root && root.querySelectorAll ? root : document;
	scope.querySelectorAll('use[href^="#icon-"]:not([href^="#icon-tm-"]), use[href^="#es-line-"], use[href^="#es-solid-"]').forEach((use) => {
		const href = use.getAttribute("href");
		const bare = href.replace(/^#(icon|es-line|es-solid)-/, "");
		if (!ids.has(bare)) return;
		use.setAttribute("href", `#icon-tm-${bare}`);
		const svg = use.closest("svg");
		if (svg) {
			svg.classList.add("tm-icon");
			svg.classList.remove("es-icon", "es-line", "es-solid"); /* those reverse fill/stroke */
			if (!svg.classList.contains("icon")) svg.classList.add("icon");
		}
	});
}

let swapFrame = null;
const pending = new Set();
function scheduleSwap(node) {
	pending.add(node);
	if (swapFrame) return;
	swapFrame = requestAnimationFrame(() => {
		swapFrame = null;
		pending.forEach((n) => swapUses(n));
		pending.clear();
	});
}

/* www/app.html fetches every sprite — Frappe's and this one — and appends it
 * to #all-symbols AFTER the desk scripts have run. Icons rendered before that
 * lands keep Frappe's symbol, and Frappe's `website` is a browser window
 * where this set has a globe: the navbar's language button came up as one or
 * the other depending on how fast the fetch returned. Wait for the sprite,
 * then re-read the ids and swap the whole document once. */
let spriteWatcher = null;
function watchSprite() {
	const box = document.getElementById("all-symbols");
	if (!box || spriteWatcher) return;
	spriteWatcher = new MutationObserver(() => {
		available = null;
		if (!themateIds().size) return;
		spriteWatcher.disconnect();
		swapUses(document);
	});
	spriteWatcher.observe(box, { childList: true });
}

function watchUses() {
	swapUses(document);
	/* .main-section holds the navbar, the pages and the footer. The previous
	 * scope (#body) is a SIBLING of <header>, so nothing the navbar rendered
	 * was ever swapped by this observer — only by the page-change rescans,
	 * which is the second half of why the language icon changed on its own. */
	const scope = document.querySelector(".main-section") || document.body;
	new MutationObserver((mutations) => {
		for (const m of mutations) {
			for (const node of m.addedNodes) {
				if (node.nodeType !== 1) continue;
				if (node.tagName === "use" || node.tagName === "svg" || node.querySelector?.("use")) scheduleSwap(node);
			}
		}
	}).observe(scope, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchUses);
else watchUses();

window.themate = window.themate || {};
window.themate.applyIcons = applyIcons;

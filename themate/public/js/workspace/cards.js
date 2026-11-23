/* Workspace card decoration — injects an icon chip into number cards and
 * shortcuts, which Frappe renders without one.
 *
 * This file used to also patch frappe.ui.Dialog and frappe.ui.ThemeSwitcher.
 * Those are separate concerns and now live in their own modules
 * (workspace/icon_fields.js, core/theme_switcher.js) so each patch can be
 * justified and disabled on its own.
 *
 * Mounting strategy (brief §4: idempotent, bounded, cleaned up):
 *  - a scoped observer watching the workspace container, NOT document.body
 *    with subtree:true, which re-ran this sweep on every DOM mutation anywhere
 *    in the Desk (FRAPPE_UI_MAP.md §5 finding 12);
 *  - rAF-coalesced, so a burst of widget mounts costs one sweep;
 *  - frappe.router.on("change") to re-attach when the workspace container is
 *    replaced;
 *  - decorate() is idempotent — it no-ops when the correct icon is present. */

const TONES = ["blue", "green", "purple", "orange", "teal", "pink"];

/* keyword -> frappe icon id. First match wins, so these two come before the
 * people rule: "leaderboard" contains "lead" and a supplier is not a person. */
const ICON_RULES = [
	[/(leaderboard|rank|award|trophy)/i, "trophy"],
	[/(supplier|vendor)/i, "truck"],
	[
		/(value|amount|total\s*value|revenue|sales|balance|money|cost|price|payable|receivable)/i,
		"money-coins-1",
	],
	[/(warehouse|location|store|branch)/i, "folder-normal"],
	[/(stock|inventory|item|product|qty|quantity|unit)/i, "stock"],
	[/(user|customer|supplier|employee|lead|contact|people|member)/i, "users"],
	[/(order|invoice|quotation|document|entry|voucher|bill)/i, "file"],
	[/(report|chart|trend|analysis|growth|performance)/i, "chart"],
	[/(task|todo|activity|open|pending|list)/i, "list"],
	[/(date|due|today|month|year|schedule|appointment)/i, "calendar"],
	/* link-group titles on workspaces */
	[/(point of sale|pos\b|retail)/i, "retail"],
	[/(setting|configuration|setup)/i, "setting"],
	[/(selling|sales|quotation)/i, "sell"],
	[/(buying|purchase|procurement)/i, "buying"],
	[/(account|ledger|tax|payment|journal)/i, "accounting"],
	[/(manufactur|bom|production|work order)/i, "organization"],
	[/(hr|human|employee|payroll|attendance|leave)/i, "hr"],
	[/(project|task|timesheet)/i, "project"],
	[/(crm|lead|opportunity|campaign)/i, "crm"],
	[/(asset)/i, "assets"],
	[/(quality)/i, "quality"],
	[/(support|issue|warranty|maintenance)/i, "support"],
	[/(website|web|portal|blog)/i, "website"],
	[/(integration|connector|webhook|api)/i, "integration"],
	[/(tool|utility|import|export|print)/i, "tool"],
];

const FALLBACK_ICONS = ["dashboard", "stock", "chart", "file", "tag", "folder-normal"];
const COLORED_ICONS = [
	"money",
	"users",
	"stock",
	"file",
	"chart",
	"list",
	"calendar",
	"award",
	"folder",
	"settings",
	"dashboard",
];

const WIDGET_SELECTOR =
	".widget.number-widget-box, .widget.shortcut-widget-box, .widget.onboarding-widget-box";

function hash(str) {
	let h = 0;
	for (let i = 0; i < str.length; i++) {
		h = (h << 5) - h + str.charCodeAt(i);
		h |= 0;
	}
	return Math.abs(h);
}

function resolve_icon(icon) {
	if (!icon) return icon;
	let base = icon.toLowerCase();
	if (base.startsWith("icon-")) {
		base = base.replace("icon-", "");
	}
	/* Legacy "color-*" ids used to be preferred here. They now live in the
	 * same sprite as the Business set but without the .duotone-* classes
	 * this file's CSS keyed on, so their tint layer painted solid. The
	 * Business set (icon-tm-*, applied by core/icons.js on any plain name)
	 * carries its own tint/weight tokens; return the plain name. */
	/* Only this file's own legacy aliases are unwrapped. Frappe has real
	 * icons named color-monthly-rank, color-energy-points, color-rank and
	 * color-review-points; those keep their names. */
	if (base.startsWith("color-") && COLORED_ICONS.includes(base.slice(6))) base = base.slice(6);
	if (base === "money") base = "money-coins-1";
	if (base === "folder") base = "folder-normal";
	if (base === "settings") base = "setting";
	if (base === "award") base = "color-monthly-rank";
	return base;
}

/* The rules are English, and .widget-title is translated: in Arabic nothing
 * matched and every card fell to a hashed icon. workspace/blocks/block.js:27
 * leaves the untranslated name on the block's wrapper. */
function source_name(widget, title) {
	const block = widget.closest("[shortcut_name], [card_name], [number_card_name]");
	return (
		block?.getAttribute("shortcut_name") ||
		block?.getAttribute("card_name") ||
		block?.getAttribute("number_card_name") ||
		title
	);
}

function pick_icon(title) {
	for (const [re, icon] of ICON_RULES) {
		if (re.test(title)) return icon;
	}
	return FALLBACK_ICONS[hash(title) % FALLBACK_ICONS.length];
}

function icon_svg(name) {
	return window.frappe?.utils?.icon
		? window.frappe.utils.icon(name, "md")
		: `<svg class="icon icon-md"><use href="#icon-${name}"></use></svg>`;
}

/* Shared by number cards and shortcuts: both take an icon chip, differing only
 * in which element hosts it and where it is inserted. */
function decorate_widget(widget, { hostSelector, chipClass, siblingSelector, prepend }) {
	const $w = window.jQuery(widget);
	const $host = $w.find(hostSelector).first();
	if (!$host.length) return;

	const title = ($w.find(".widget-title").text() || $w.text() || "").trim();
	const resolved = resolve_icon($w.attr("data-icon") || pick_icon(source_name(widget, title)));

	const $existing = $w.find(`.${chipClass}`);
	if ($existing.length) {
		/* Idempotent: already correct, nothing to do. */
		if ($existing.attr("data-tm-icon") === resolved) return;
		$existing.remove();
	}

	/* Not .ce-block: each block holds one widget, so every index was 0 and every chip blue. */
	const siblings = $w.closest(".widget-group, .widgets, .codex-editor__redactor, body").find(siblingSelector);
	const tone = TONES[Math.max(0, siblings.index($w)) % TONES.length];

	const $chip = window.jQuery(
		`<div class="${chipClass}" data-tm-tone="${tone}" data-tm-icon="${resolved}" aria-hidden="true">${icon_svg(
			resolved
		)}</div>`
	);

	if (resolved.startsWith("color-")) {
		$chip.find("svg").addClass("tm-duotone");
	}

	if (prepend) {
		$chip.prependTo($host);
	} else {
		$chip.appendTo($host);
	}
}

function decorate(widget) {
	decorate_widget(widget, {
		hostSelector: ".widget-head",
		chipClass: "tm-card-icon",
		siblingSelector: ".widget.number-widget-box",
		prepend: false,
	});
}

/* Link groups on a workspace ("Selling", "Point of Sale", "Items and
 * Pricing"): a chip before the group title, keyed on the title words. */
function decorate_links(widget) {
	decorate_widget(widget, {
		hostSelector: ".widget-head .widget-label",
		chipClass: "tm-shortcut-icon",
		siblingSelector: ".widget.links-widget-box",
		prepend: true,
	});
	/* the header band takes the chip's tone */
	const tone = widget.querySelector(".tm-shortcut-icon")?.dataset.tmTone;
	if (tone) widget.querySelector(".widget-head")?.setAttribute("data-tm-tone", tone);
}

function decorate_shortcut(widget) {
	decorate_widget(widget, {
		hostSelector: ".widget-label",
		chipClass: "tm-shortcut-icon",
		siblingSelector: ".widget.shortcut-widget-box",
		prepend: true,
	});
}

/* Onboarding widgets only get a stable attribute for CSS to target. */
function decorate_onboarding(widget) {
	const $w = window.jQuery(widget);
	if ($w.attr("data-onboarding-name")) return;

	const widgetName = $w.attr("data-widget-name");
	if (widgetName) {
		$w.attr("data-onboarding-name", widgetName.toLowerCase().replace(/\s+/g, "-"));
		return;
	}

	const route = window.frappe?.get_route?.();
	if (route && route[1]) {
		$w.attr("data-onboarding-name", String(route[1]).toLowerCase());
	}
}

function sweep(root) {
	const scope = root && root.querySelectorAll ? root : document;
	scope.querySelectorAll(".widget.number-widget-box").forEach(decorate);
	scope.querySelectorAll(".widget.shortcut-widget-box").forEach(decorate_shortcut);
	scope.querySelectorAll(".widget.links-widget-box").forEach(decorate_links);
	scope.querySelectorAll(".widget.onboarding-widget-box").forEach(decorate_onboarding);
}

/* ---- Bounded, scoped observation ----------------------------------------- */

let observer = null;
let observedRoot = null;
let pendingFrame = null;

function scheduleSweep() {
	if (pendingFrame) return;
	pendingFrame = requestAnimationFrame(() => {
		pendingFrame = null;
		if (observedRoot) sweep(observedRoot);
	});
}

function disconnect() {
	if (observer) {
		observer.disconnect();
		observer = null;
	}
	if (pendingFrame) {
		cancelAnimationFrame(pendingFrame);
		pendingFrame = null;
	}
	observedRoot = null;
}

/* Watches the desk's page area (#body: every .page-container), not one
 * workspace's editor. Cards live in more places than the editor — a module
 * dashboard the theme renders beside it (js/workspace/tabs.js), the
 * dashboard view, a doctype's dashboard — and an observer pinned to the
 * first .codex-editor missed all of them after the first route change. The
 * callback only schedules a sweep when an added node is a widget, so the
 * wider root costs nothing on ordinary mutations. */
function attach() {
	const root = document.querySelector("#body") || document.body;

	if (!root) return;
	if (root === observedRoot) {
		/* Same container, still connected — just re-sweep for new widgets. */
		sweep(root);
		return;
	}

	disconnect();
	observedRoot = root;
	sweep(root);

	observer = new MutationObserver((mutations) => {
		for (const m of mutations) {
			for (const node of m.addedNodes) {
				if (node.nodeType !== 1) continue;
				if (node.matches?.(WIDGET_SELECTOR) || node.querySelector?.(WIDGET_SELECTOR)) {
					scheduleSweep();
					return;
				}
			}
		}
	});

	observer.observe(root, { childList: true, subtree: true });
}

function init() {
	if (!window.jQuery || !window.document) return;
	if (window.themate?.enabled?.() === false) return; /* master switch off: Frappe's own cards */

	attach();

	/* Supported router hook — verified at frappe/public/js/frappe/router.js:161
	 * and views/container.js:78. No polling, no timers. */
	window.frappe?.router?.on?.("change", attach);
	window.jQuery(document).on("page-change", attach);

	window.addEventListener("beforeunload", disconnect, { once: true });
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init);
} else {
	init();
}

window.themate = window.themate || {};
window.themate.decorate_cards = () => observedRoot && sweep(observedRoot);
window.themate.resolve_icon = resolve_icon;
window.themate._cards_disconnect = disconnect;

/* Navbar tools: language switcher + Theme Customizer button.
 *
 * The language switcher is the feature of kimoamer/langumate brought into
 * the theme. Langumate ships a copy of Frappe's navbar.html and subclasses
 * frappe.ui.toolbar.Toolbar to fill a hard-coded <li>; every Frappe release
 * that touches the navbar template then has to be re-merged. This version
 * injects two <li>s into the live navbar instead, right before the user
 * menu, on the same toolbar_setup event Frappe fires when the navbar exists.
 * Use the site's existing switcher when Langumate or Fikrity Login adds one.
 *
 * Choices come from Theme Settings > Navbar (boot.themate.navbar):
 *   languages   – [{code, label}] from the Languages table, else en + ar
 *   language_switcher / customizer_button – show/hide each item
 *
 * Switching does exactly what Langumate did: write User.language, reload. */

const boot = () => window.frappe?.boot?.themate || {};
const __ = (s, args) => (window.__ ? window.__(s, args) : s);
const watchedNavbars = new WeakSet();

function icon(name, size = "md") {
	return window.frappe?.utils?.icon ? window.frappe.utils.icon(name, size) : "";
}

function currentLanguage() {
	return window.frappe?.boot?.user?.language || window.frappe?.boot?.lang || "en";
}

function buildLanguageItem(nav) {
	const languages = nav.languages || [];
	if (!languages.length) return null;

	const current = currentLanguage();

	const li = document.createElement("li");
	li.className = "nav-item dropdown dropdown-mobile tm-lang";
	li.innerHTML = `
		<button type="button" class="btn-reset nav-link tm-lang-toggle" data-toggle="dropdown"
			aria-haspopup="true" aria-expanded="false" title="${__("Language")}" aria-label="${__("Language")}">
			${icon("es-line-globe", "sm")}
			<span class="tm-lang-code"></span>
		</button>
		<div class="dropdown-menu dropdown-menu-right tm-lang-menu" role="menu"></div>`;
	li.querySelector(".tm-lang-code").textContent = current.toUpperCase();

	const menu = li.querySelector(".tm-lang-menu");
	languages.forEach((l) => {
		const a = document.createElement("a");
		a.href = "#";
		a.className = "dropdown-item tm-lang-option" + (l.code === current ? " active" : "");
		a.dataset.lang = l.code;
		a.innerHTML = '<span class="tm-lang-option-code"></span><span></span>';
		a.firstElementChild.textContent = l.code.toUpperCase();
		a.lastElementChild.textContent = l.label;
		a.addEventListener("click", (e) => {
			e.preventDefault();
			switchLanguage(l);
		});
		menu.appendChild(a);
	});
	return li;
}

/* A veil over the whole desk from the click until the reloaded page takes
 * over: Frappe's own freeze lifts when the call returns, which would leave
 * the old language on screen for the second or two the reload takes. */
function veil(message) {
	const el = document.createElement("div");
	el.className = "tm-veil";
	el.setAttribute("role", "status");
	el.setAttribute("aria-live", "polite");
	el.innerHTML = '<div class="tm-veil-card"><span class="tm-veil-spinner" aria-hidden="true"></span><span class="tm-veil-text"></span></div>';
	el.querySelector(".tm-veil-text").textContent = message;
	document.body.appendChild(el);
	document.body.classList.add("tm-veiled");
	return el;
}

function switchLanguage(lang) {
	if (lang.code === currentLanguage()) {
		window.frappe?.show_alert?.({ message: __("You are already using this language."), indicator: "blue" }, 3);
		return;
	}
	const message = __("Switching to {0}…", [lang.label]);
	const shade = veil(message);
	window.frappe.call({
		method: "frappe.client.set_value",
		args: { doctype: "User", name: window.frappe.session.user, fieldname: "language", value: lang.code },
		callback: () => window.location.reload(),
		error: () => {
			shade.remove();
			document.body.classList.remove("tm-veiled");
		},
	});
}

function buildCustomizerItem() {
	const li = document.createElement("li");
	li.className = "nav-item dropdown-mobile tm-customizer-nav";
	li.innerHTML = `
		<button type="button" class="btn-reset nav-link tm-customizer-toggle" title="${__("Theme Customizer")}"
			aria-label="${__("Theme Customizer")}">${icon("customization", "sm")}</button>`;
	li.querySelector("button").addEventListener("click", (e) => {
		e.preventDefault();
		window.themate?.openCustomizer?.();
	});
	return li;
}

/* The search box: "Search or type a command" with the shortcut as a chip at
 * the end, instead of "(Ctrl + G)" inside the placeholder text. Frappe builds
 * the placeholder in navbar.html with the platform's key; keep that key. */
function mountSearchShortcut() {
	const bar = document.querySelector(".navbar .search-bar");
	const input = bar?.querySelector("#navbar-search");
	if (!bar || !input || bar.querySelector(".tm-kbd") || !window.themate?.enabled?.()) return;
	const m = (input.getAttribute("placeholder") || "").match(/^(.*?)\s*\((.+)\)\s*$/);
	if (!m) return;
	input.setAttribute("placeholder", m[1]);
	const kbd = document.createElement("kbd");
	kbd.className = "tm-kbd";
	kbd.textContent = m[2];
	bar.appendChild(kbd);
}

function mount() {
	mountSearchShortcut();
	if (window.themate?.enabled?.() === false) return; /* master switch off: Frappe's own navbar */
	const userItem = document.querySelector(".navbar .dropdown-navbar-user");
	if (!userItem) return;
	const list = userItem.parentElement;

	const nav = boot().navbar || {};
	const language = list.querySelector(".tm-lang");
	const customizer = list.querySelector(".tm-customizer-nav");
	if (nav.language_switcher === 0 || list.querySelector(".dropdown-language, .fk-nav-lang")) {
		language?.remove();
	} else if (!language) {
		const item = buildLanguageItem(nav);
		if (item) list.insertBefore(item, customizer || userItem);
	}
	if (nav.customizer_button !== 0 && !customizer) list.insertBefore(buildCustomizerItem(), userItem);

	/* A companion app can insert its switcher after our toolbar_setup handler. */
	if (!watchedNavbars.has(list)) {
		watchedNavbars.add(list);
		new MutationObserver(mount).observe(list, { childList: true });
	}
}

if (window.jQuery) {
	window.jQuery(document).on("toolbar_setup", mount);
	window.jQuery(mount);
}

window.themate = window.themate || {};
window.themate.mountNavbarTools = mount;

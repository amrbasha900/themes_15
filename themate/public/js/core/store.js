/* User-preference store.
 *
 * Preferences here are user-owned (sidebar collapsed, pinned workspaces, theme
 * mode) and are persisted server-side through themate.api.save_pref, which
 * validates the key against PREF_FIELDS and enforces permissions. The local
 * copy is a latency cache for the current tab, not a system of record.
 *
 * Precedence, matching core/bootstrap.js:
 *   1. local value, only if it carries the current preference version
 *   2. frappe.boot.themate.user_prefs  (server truth)
 *   3. the supplied fallback
 *
 * The version gate is what makes a reset possible: bumping PREF_VERSION in
 * core/bootstrap.js invalidates every stored value at once. */

const PREFIX = "tm:";

function versionOk() {
	try {
		return (
			localStorage.getItem(window.themate.PREF_VERSION_KEY) === window.themate.PREF_VERSION
		);
	} catch {
		return false;
	}
}

function readLocal(key) {
	if (!versionOk()) {
		return null;
	}

	try {
		const raw = localStorage.getItem(`${PREFIX}${key}`);
		return raw === null ? null : JSON.parse(raw);
	} catch {
		/* Unparseable or blocked storage — fall through to boot values. */
		return null;
	}
}

function writeLocal(key, value) {
	try {
		localStorage.setItem(window.themate.PREF_VERSION_KEY, window.themate.PREF_VERSION);
		localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
	} catch {
		/* Private mode: the server write below still persists the choice. */
	}
}

function sync(key, value) {
	if (!window.frappe?.call) {
		return;
	}

	/* Server-side validation lives in themate/api.py save_pref; an unsupported
	 * key is rejected there rather than silently stored. */
	window.frappe.call("themate.api.save_pref", { key, value });
}

export const store = {
	get(key, fallback = null) {
		const localValue = readLocal(key);
		if (localValue !== null) {
			return localValue;
		}

		const bootPrefs = window.frappe?.boot?.themate?.user_prefs || {};
		return bootPrefs[key] ?? fallback;
	},

	set(key, value) {
		writeLocal(key, value);
		sync(key, value);
		return value;
	},

	clear() {
		try {
			Object.keys(localStorage)
				.filter((k) => k.startsWith(PREFIX))
				.forEach((k) => localStorage.removeItem(k));
		} catch {
			/* nothing to clear */
		}
	},
};

/* Desk state — where the user left things: the tab and dashboard open on
 * each workspace, the period chosen on each widget. One JSON preference
 * (desk_state) so it follows the user to another browser; localStorage
 * mirrors it for this one, and whichever copy was written last wins. Writes
 * are debounced: a click changes the copy at once, the server hears about
 * it a second later. */
const DESK_KEY = "desk_state";
let desk = null;
let deskTimer = null;

function deskLoad() {
	if (desk) return desk;
	const boot = window.frappe?.boot?.themate?.user_prefs?.desk_state;
	let local = null;
	try {
		const raw = localStorage.getItem(`${PREFIX}${DESK_KEY}`);
		local = raw ? JSON.parse(raw) : null;
	} catch {
		local = null;
	}
	const newest = local && (local.updated || 0) >= (boot?.updated || 0) ? local : boot;
	desk = Object.assign({ workspaces: {}, widgets: {}, dashboards: {}, lists: {}, prints: {}, forms: {}, updated: 0 }, newest || {});
	desk.workspaces = desk.workspaces || {};
	desk.widgets = desk.widgets || {};
	desk.dashboards = desk.dashboards || {};
	desk.lists = desk.lists || {};
	desk.prints = desk.prints || {};
	desk.forms = desk.forms || {};
	return desk;
}

function deskSync() {
	clearTimeout(deskTimer);
	deskTimer = setTimeout(() => {
		if (!window.frappe?.call) return;
		window.frappe.call({ method: "themate.api.save_pref", args: { key: DESK_KEY, value: desk }, no_spinner: true });
	}, 1200);
}

export const deskState = {
	get(section, key) {
		return deskLoad()[section]?.[key] ?? null;
	},
	/* value: an object merged into the entry, or null to forget it */
	set(section, key, value) {
		const state = deskLoad();
		state[section] = state[section] || {};
		if (value === null) delete state[section][key];
		else state[section][key] = Object.assign({}, state[section][key] || {}, value);
		state.updated = Date.now();
		try {
			localStorage.setItem(`${PREFIX}${DESK_KEY}`, JSON.stringify(state));
		} catch {
			/* private mode: the server write still lands */
		}
		deskSync();
		return state[section][key] || null;
	},
};

window.themate = window.themate || {};
window.themate.store = store;
window.themate.deskState = deskState;

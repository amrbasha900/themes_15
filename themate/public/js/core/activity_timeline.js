/* Activity timeline: which tab each entry belongs to and how each one reads.
 *
 * Native: frappe/public/js/frappe/form/footer/form_timeline.js builds the
 * entries, base_timeline.js turns each into a `.timeline-item`, and
 * templates/timeline_message_box.html is the markup of every comment and
 * email. None of it knows about categories, groups or a card layout, and the
 * entries other than comments and emails ("You changed the value of …") are
 * bare strings. This file adds those three things WITHOUT copying Frappe's
 * logic:
 *
 *  - the `get_*_timeline_contents` getters are wrapped, and what they return is
 *    tagged (`tm_cat`, `tm_kind`) — the category is known where the entry is
 *    made, so nothing has to guess it back from translated text later;
 *  - `get_timeline_item` is wrapped, and the element it returns is given the
 *    reference layout (rail node + card) and `data-tm-cat` / `data-tm-day`;
 *  - `frappe.render_template("timeline_message_box")` is answered with the
 *    card markup. Every hook FormTimeline relies on is kept — `.content`,
 *    `.custom-actions` (Edit, reply), `.more-actions .dropdown-menu li`
 *    (Delete, Publish) and `data-action="copy_link"` — so editing, deleting,
 *    publishing and replying are still Frappe's own code.
 *
 * The class is not reachable from here (it lives in form.bundle.js and is not
 * exported), so the prototype is taken from the first `frm.timeline`
 * (core/form_activity.js calls install()). Everything is a no-op once the
 * theme is switched off, and every wrapper falls back to the original on any
 * error: a timeline that renders the native way is worth more than a card. */

const frappe = window.frappe;
const $ = window.jQuery;

const enabled = () => window.themate?.enabled?.() !== false;

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/* ---- Icons -------------------------------------------------------------- */
/* Drawn here, not looked up in Frappe's sprite: the sprite has no
 * activity / list / paperclip / smile glyphs, and a missing symbol renders as
 * nothing. 24×24 outline, stroke follows the text colour. */
const PATHS = {
	activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
	list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
	ordered: '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
	message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
	file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/>',
	mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
	calendar: '<path d="M8 2v4M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
	gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
	bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
	italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
	link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
	smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
	paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
	send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
	chevron: '<path d="m6 9 6 6 6-6"/>',
	x: '<path d="M18 6 6 18M6 6l12 12"/>',
	pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
	dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
	bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
	globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
	lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
	eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
	heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
	user: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
	share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
	branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
	flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
	history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
	inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
};

export function icon(name, size = 18) {
	return `<svg class="tm-ic tm-ic-${name}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || ""}</svg>`;
}

/* ---- Categories --------------------------------------------------------- */
/* Order is the order of the pills. `tone` picks the colour pair in
 * _activity.scss (data-tm-tone) — a decorative identity, never a status. */
export const CATS = [
	{ key: "all", icon: "list", tone: "brand", label: () => __("All") },
	{ key: "comments", icon: "message", tone: "purple", label: () => __("Comments") },
	{ key: "updates", icon: "file", tone: "orange", label: () => __("Updates") },
	{ key: "emails", icon: "mail", tone: "green", label: () => __("Emails") },
	{ key: "events", icon: "calendar", tone: "pink", label: () => __("Events") },
	{ key: "system", icon: "gear", tone: "slate", label: () => __("System") },
];
const CAT_KEYS = new Set(CATS.map((c) => c.key));

/* The rail node: the category's icon, or something sharper where the entry is
 * a specific kind of thing. */
const NODE_ICON = {
	comments: "message",
	emails: "mail",
	events: "calendar",
	updates: "file",
	system: "gear",
};
const KIND_ICON = {
	viewed: "eye",
	liked: "heart",
	attachment: "paperclip",
	assignment: "user",
	share: "share",
	workflow: "branch",
	milestone: "flag",
	notification: "bell",
};

/* A Communication is an Event when it was written by one — Event.sync_
 * communication() files it under reference_doctype "Event" and links the
 * document it was created from — or when it records a call, meeting or visit.
 * Anything else (email, SMS, chat) is an email. */
export function commCategory(c) {
	if (c.reference_doctype === "Event" || c.communication_medium === "Event") return "events";
	if (["Phone", "Meeting", "Visit"].includes(c.communication_medium)) return "events";
	return "emails";
}

/* ---- Time --------------------------------------------------------------- */
const pad = (n) => String(n).padStart(2, "0");
const lang = () => document.documentElement.lang || frappe.boot?.lang || "en";

/* A Date whose local fields are the wall-clock time in the user's own time
 * zone (Settings > Time Zone), which is what the person reads. */
function wall(ts) {
	if (!ts) return null;
	try {
		const m = frappe.datetime.convert_to_user_tz(ts, false);
		if (m && m.isValid()) return new Date(m.year(), m.month(), m.date(), m.hours(), m.minutes(), m.seconds());
	} catch (e) {
		/* fall through to the plain parse */
	}
	const d = new Date(String(ts).replace(/-/g, "/").replace(/\.\d+$/, ""));
	return Number.isNaN(d.getTime()) ? null : d;
}

function nowWall() {
	try {
		return new Date(frappe.datetime.now_datetime().replace(/-/g, "/"));
	} catch (e) {
		return new Date();
	}
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/* >0 is that many days ago, 0 today, <0 in the future. */
const daysAgo = (d) => Math.round((startOfDay(nowWall()) - startOfDay(d)) / 864e5);
const fmtTime = (d) => new Intl.DateTimeFormat(lang(), { hour: "numeric", minute: "2-digit" }).format(d);
const fmtDay = (d) =>
	new Intl.DateTimeFormat(lang(), {
		weekday: "short",
		day: "numeric",
		month: "short",
		year: d.getFullYear() === nowWall().getFullYear() ? undefined : "numeric",
	}).format(d);

export function dayKey(ts) {
	const d = wall(ts);
	return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";
}

export function dayLabel(ts) {
	const d = wall(ts);
	if (!d) return "";
	const n = daysAgo(d);
	if (n === 0) return __("Today");
	if (n === 1) return __("Yesterday");
	if (n === -1) return __("Tomorrow");
	return fmtDay(d);
}

/* "just now" / "5 minutes ago" for today (Frappe's own, kept fresh by its
 * minute timer), "yesterday at 4:32 PM" and "Mon, 5 Oct at 4:32 PM" after
 * that, and an absolute time for what has not happened yet — an Event's
 * Communication carries its start time, which is usually ahead. */
export function whenHtml(ts) {
	const d = wall(ts);
	if (!d) return "";
	const n = daysAgo(d);
	if (n === 0 && nowWall() >= d && typeof window.comment_when === "function") return window.comment_when(ts);
	const time = fmtTime(d);
	let text;
	if (n === 0) text = __("today at {0}", [time]);
	else if (n === 1) text = __("yesterday at {0}", [time]);
	else if (n === -1) text = __("tomorrow at {0}", [time]);
	else text = __("{0} at {1}", [fmtDay(d), time]);
	let title = "";
	try {
		title = frappe.datetime.str_to_user(ts);
	} catch (e) {
		/* the tooltip is a convenience */
	}
	return `<span class="tm-when-static" title="${esc(title)}">${esc(text)}</span>`;
}

/* ---- Comments and emails ------------------------------------------------ */
const isMe = (who) => !!who && (who === frappe.session.user || who === frappe.session.user_email);

function messageKind(doc) {
	if (doc.communication_type === "Automated Message") return "notification";
	if (doc.comment_type === "Comment") return "comment";
	return commCategory(doc) === "events" ? "event" : "email";
}

function verbFor(kind, doc) {
	if (kind === "comment") return __("commented");
	if (kind === "event") {
		if (doc.reference_doctype === "Event") return __("scheduled an event");
		return { Phone: __("logged a call"), Meeting: __("logged a meeting"), Visit: __("logged a visit") }[doc.communication_medium] || __("scheduled an event");
	}
	return { SMS: __("sent an SMS"), Chat: __("sent a chat message"), Other: __("added an activity") }[doc.communication_medium] || __("sent an email");
}

/* "Notification sent to A, B, C …" — the first three, as the native card. */
function recipientsOf(doc) {
	const split = (s) => (s ? String(s).split(",").map((x) => x.trim()).filter(Boolean) : []);
	const all = [...split(doc.recipients), ...split(doc.cc), ...split(doc.bcc)];
	const names = all.slice(0, 3).map((e) => frappe.user_info(e).fullname || e);
	return esc(names.join(", ")) + (all.length > 3 ? " …" : "");
}

function filesHtml(files) {
	return files
		.map((a) => {
			const url = encodeURI(a.file_url || "").replace(/#/g, "%23");
			const name = (a.file_url || "").split("/").slice(-1)[0];
			return `<a class="tm-file" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon("paperclip", 13)}<span class="ellipsis">${esc(name)}</span>${a.is_private ? icon("lock", 13) : ""}</a>`;
		})
		.join("");
}

/* The markup of one comment / email / event / notification. Same hooks as
 * timeline_message_box.html — see the file header. */
export function renderMessage(doc) {
	const kind = messageKind(doc);
	const owner = doc.owner || doc.sender;
	const mine = isMe(owner) || isMe(doc.sender);
	const name = mine ? __("You") : doc.user_full_name || frappe.user?.full_name?.(owner) || owner || "";
	const ts = doc.communication_date || doc.creation;
	const files = Array.isArray(doc.attachments) ? doc.attachments.filter((a) => a && a.file_url) : [];
	const clamp = kind !== "comment";

	const lead =
		kind === "comment"
			? `<div class="tm-msg__lead">${frappe.avatar(doc.owner, "avatar-medium")}</div>`
			: `<div class="tm-msg__lead"><span class="tm-tile" data-tm-tone="${kind === "email" ? "brand" : kind === "event" ? "pink" : "slate"}">${icon(kind === "event" ? "calendar" : kind === "notification" ? "bell" : "mail", 16)}</span></div>`;

	const who =
		kind === "notification"
			? `<span class="tm-verb">${esc(__("Notification sent to"))}</span> <b class="tm-who">${recipientsOf(doc)}</b>`
			: `<b class="tm-who">${esc(name)}</b> <span class="tm-verb">${esc(verbFor(kind, doc))}</span>`;
	const published = doc.published
		? `<span class="tm-sep"> · </span><span class="tm-note" title="${esc(__("Visible to website/portal users."))}">${esc(__("Published"))}</span>`
		: "";
	const status =
		doc._doc_status && doc._doc_status_indicator
			? `<span class="indicator-pill ${esc(doc._doc_status_indicator)}" title="${esc(__(doc._doc_status))}"><span class="small">${esc(__(doc._doc_status))}</span></span>`
			: "";
	const openLink = doc._url
		? `<a class="action-btn tm-icon-btn" href="${esc(doc._url)}" title="${esc(__("Open Communication"))}" aria-label="${esc(__("Open Communication"))}">${icon("link", 14)}</a>`
		: "";
	const pill = files.length
		? `<button type="button" class="tm-attach-pill" data-action="tm_toggle_files" aria-expanded="false" title="${esc(__("Attachments"))}">${icon("paperclip", 13)}<span>${files.length}</span></button>`
		: "";
	const subject = kind !== "comment" && doc.subject ? `<div class="tm-msg__subject" dir="auto">${esc(doc.subject)}</div>` : "";

	return `<div class="timeline-message-box tm-msg tm-msg--${kind}${clamp ? " tm-msg--clamp" : ""}" data-communication-type="${esc(doc.communication_type || "")}">
	${lead}
	<div class="tm-msg__main">
		<div class="tm-msg__head">
			<div class="tm-msg__title">${who}<span class="tm-sep"> · </span><span class="tm-when">${whenHtml(ts)}</span>${published}</div>
			<div class="tm-msg__actions actions">
				${status}${openLink}
				<div class="custom-actions"></div>
				${pill}
				<div class="more-actions">
					<a type="button" class="action-btn tm-icon-btn tm-more" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" title="${esc(__("More"))}" aria-label="${esc(__("More"))}">${icon("dots", 16)}</a>
					<ul class="dropdown-menu dropdown-menu-right small"><li><a class="dropdown-item" data-action="copy_link">${esc(__("Copy Link"))}</a></li></ul>
				</div>
			</div>
		</div>
		${subject}
		<div class="content" dir="auto">${doc.content || ""}</div>
		${clamp ? `<button type="button" class="tm-more-btn" data-action="tm_toggle_open" aria-expanded="false" hidden><span class="tm-more-btn__more">${esc(__("Show more"))}</span><span class="tm-more-btn__less">${esc(__("Show less"))}</span></button>` : ""}
		${files.length ? `<div class="tm-files">${filesHtml(files)}</div>` : ""}
	</div>
</div>`;
}

/* ---- One entry ---------------------------------------------------------- */
const moreMenu = (frm) => {
	const history = frm?.meta?.track_changes && frappe.model.can_read("Version");
	return `<div class="more-actions tm-line-actions">
		<a type="button" class="action-btn tm-icon-btn tm-more" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" title="${esc(__("More"))}" aria-label="${esc(__("More"))}">${icon("dots", 16)}</a>
		<ul class="dropdown-menu dropdown-menu-right small"><li>
			<a class="dropdown-item" data-action="tm_copy_text">${esc(__("Copy text"))}</a>
			${history ? `<a class="dropdown-item" data-action="tm_open_history">${esc(__("View version history"))}</a>` : ""}
		</li></ul>
	</div>`;
};

/* What the creation / last-edit entries say under their title. */
function describe(kind, frm) {
	if (!frm?.doc) return "";
	const label = __(frm.doctype);
	let title = frm.docname;
	try {
		title = frm.get_title ? frm.get_title() : frm.docname;
	} catch (e) {
		/* the name is enough */
	}
	if (kind === "created") return __("{0} “{1}” was created.", [label, title]);
	if (kind === "edited") return __("{0} details were updated.", [label]);
	return "";
}

function decorate($el, item, frm) {
	if (item.name === "load-more") {
		$el.addClass("tm-load-more");
		return $el;
	}

	const doctype = item.doctype;
	const cat = CAT_KEYS.has(item.tm_cat) ? item.tm_cat : doctype === "Comment" ? "comments" : doctype === "Communication" ? "emails" : "system";
	const kind = item.tm_kind || "";
	$el.attr({ "data-tm-cat": cat, "data-tm-day": dayKey(item.creation), "data-tm-kind": kind });

	/* The rail node replaces the native badge / dot / energy-point bubble. */
	let bubble = "";
	if (item.timeline_badge) bubble = $(item.timeline_badge).text().trim();
	$el.children(".timeline-badge, .timeline-dot").remove();
	const glyph = KIND_ICON[kind] || NODE_ICON[cat];
	$el.prepend(`<span class="tm-node${bubble ? " tm-node--text" : ""}" aria-hidden="true">${bubble ? esc(bubble) : icon(glyph, 15)}</span>`);

	const $content = $el.children(".timeline-content");
	if (item.is_card) {
		$content.addClass("tm-card");
		return $el;
	}

	/* A plain entry: its text, the time, and a "…" menu, in the same card. */
	const text = typeof item.content === "string" ? item.content : "";
	const when = item.hide_timestamp ? "" : whenHtml(item.creation);
	const desc = describe(kind, frm);
	$content.empty().addClass("tm-card tm-card--line").append(`<div class="tm-msg tm-msg--line">
		<div class="tm-msg__lead"><span class="tm-tile" data-tm-tone="${cat === "updates" ? "orange" : cat === "events" ? "pink" : "slate"}">${icon(glyph, 16)}</span></div>
		<div class="tm-msg__main">
			<div class="tm-msg__head">
				<div class="tm-msg__title"><span class="tm-line-text">${text}</span>${when ? `<span class="tm-sep"> · </span><span class="tm-when">${when}</span>` : ""}</div>
				<div class="tm-msg__actions actions">${moreMenu(frm)}</div>
			</div>
			${desc ? `<div class="tm-msg__desc">${esc(desc)}</div>` : ""}
		</div>
	</div>`);
	if (typeof item.content !== "string" && item.content) $content.find(".tm-line-text").append(item.content);
	return $el;
}

/* ---- Wiring ------------------------------------------------------------- */
function patchRender() {
	if (!frappe.render_template || frappe.render_template._tm_patched) return;
	const original = frappe.render_template;
	const wrapped = function (name, data) {
		if (name === "timeline_message_box" && data?.doc && enabled()) {
			try {
				return renderMessage(data.doc);
			} catch (e) {
				/* the native card is the fallback */
			}
		}
		return original.apply(this, arguments);
	};
	wrapped._tm_patched = true;
	frappe.render_template = wrapped;
}

function patchTimeline(proto) {
	if (proto._tm_patched) return;
	proto._tm_patched = true;

	const wrap = (method, fn) => {
		const original = proto[method];
		if (typeof original !== "function") return;
		proto[method] = function () {
			const out = original.apply(this, arguments);
			try {
				fn.call(this, out, arguments);
			} catch (e) {
				/* an untagged entry falls back to "system" */
			}
			return out;
		};
	};
	const tag = (cat, kind) => (out) => (Array.isArray(out) ? out : [out]).forEach((it) => it && typeof it === "object" && Object.assign(it, { tm_cat: cat, tm_kind: kind }));

	wrap("get_creation_message", tag("system", "created"));
	wrap("get_modified_message", tag("system", "edited"));
	wrap("get_view_timeline_contents", tag("system", "viewed"));
	wrap("get_energy_point_timeline_contents", tag("system", "points"));
	wrap("get_like_timeline_contents", tag("system", "liked"));
	wrap("get_custom_timeline_contents", tag("system", "custom"));
	wrap("get_info_timeline_contents", tag("system", "info"));
	wrap("get_version_timeline_contents", tag("updates", "version"));
	wrap("get_share_timeline_contents", tag("updates", "share"));
	wrap("get_workflow_timeline_contents", tag("updates", "workflow"));
	wrap("get_assignment_timeline_contents", tag("updates", "assignment"));
	wrap("get_attachment_timeline_contents", tag("updates", "attachment"));
	wrap("get_milestone_timeline_contents", tag("updates", "milestone"));
	wrap("get_comment_timeline_item", tag("comments", "comment"));
	wrap("get_auto_messages_timeline_contents", tag("system", "notification"));
	wrap("get_email_communication_timeline_contents", function (out, args) {
		const raw = args[0] || this.doc_info?.communications || [];
		const byName = new Map(raw.map((c) => [c.name, c]));
		out.forEach((it) => {
			it.tm_cat = commCategory(byName.get(it.name) || {});
			it.tm_kind = it.tm_cat === "events" ? "event" : "email";
		});
	});

	const getItem = proto.get_timeline_item;
	proto.get_timeline_item = function (item) {
		const $el = getItem.apply(this, arguments);
		if (!enabled()) return $el;
		try {
			return decorate($el, item, this.frm);
		} catch (e) {
			return $el;
		}
	};

	/* data-action handlers: Frappe binds [data-action] clicks to the timeline
	 * instance (bind_actions_with_object), exactly as it does copy_link. */
	proto.tm_copy_text = function (e, $target) {
		const $card = $target.closest(".tm-msg");
		const text = [$card.find(".tm-line-text").text(), $card.find(".tm-msg__desc").text()].map((s) => s.trim()).filter(Boolean).join(" — ");
		frappe.utils.copy_to_clipboard(text);
	};
	proto.tm_open_history = function () {
		frappe.set_route("List", "Version", { ref_doctype: this.frm.doctype, docname: this.frm.docname });
	};
	proto.tm_toggle_files = function (e, $target) {
		const open = $target.closest(".tm-msg").toggleClass("has-files-open").hasClass("has-files-open");
		$target.attr("aria-expanded", String(open));
	};
	proto.tm_toggle_open = function (e, $target) {
		const open = $target.closest(".tm-msg").toggleClass("is-open").hasClass("is-open");
		$target.attr("aria-expanded", String(open));
	};
}

/* Frappe adds a comment you post to the document's docinfo twice: footer.js
 * pushes it when the request returns, and the realtime "docinfo_update"
 * (form.js setup_docinfo_change_listener) pushes it again for the author too.
 * Nothing shows it until the timeline is next rebuilt — then a comment you
 * deleted is still there once, because deleting removes one of the two. Any
 * array that holds entries by name is made to refuse a name it already has
 * (and is cleaned of those it already holds). */
export function healDocinfo(frm) {
	const info = frm?.get_docinfo?.();
	if (!info) return;
	["comments", "communications"].forEach((key) => {
		const list = info[key];
		if (!Array.isArray(list)) return;
		const seen = new Set();
		for (let i = 0; i < list.length; ) {
			const name = list[i]?.name;
			if (name && seen.has(name)) list.splice(i, 1);
			else {
				if (name) seen.add(name);
				i += 1;
			}
		}
		if (list._tm_guard) return;
		Object.defineProperty(list, "_tm_guard", { value: true });
		const push = list.push;
		Object.defineProperty(list, "push", {
			configurable: true,
			writable: true,
			value(...items) {
				return push.apply(
					this,
					items.filter((it) => !it?.name || !this.some((x) => x?.name === it.name))
				);
			},
		});
	});
}

/* Called with every frm that has a footer; cheap after the first. */
export function install(frm) {
	if (!frappe || !$ || !enabled()) return false;
	patchRender();
	const proto = frm?.timeline && Object.getPrototypeOf(frm.timeline);
	if (!proto) return false;
	const first = !proto._tm_patched;
	patchTimeline(proto);
	return first;
}

/* An email or event card shows three lines and offers "Show more" only when
 * there is more to show. Needs layout, so it waits until the panel is on
 * screen (a panel inside a closed dialog has no height to measure). */
export function measureClamps(root) {
	if (!root) return;
	root.querySelectorAll(".tm-msg--clamp").forEach((msg) => {
		const content = msg.querySelector(":scope > .tm-msg__main > .content");
		const button = msg.querySelector(":scope > .tm-msg__main > .tm-more-btn");
		if (!content || !button) return;
		if (msg.classList.contains("is-open")) {
			button.hidden = false;
		} else if (content.clientHeight > 0) {
			button.hidden = !(content.scrollHeight > content.clientHeight + 2);
		}
	});
}

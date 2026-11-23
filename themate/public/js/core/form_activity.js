/* Activity (comments + timeline): a composer, six tabs and a grouped timeline,
 * either in a dialog opened from the page head or inline under the form.
 *
 * Native: frappe/public/js/frappe/form/footer/footer.js renders
 * `.form-footer > .after-save > (.comment-box, .new-timeline)` at the bottom
 * of every saved document. On a record with any history that is the tallest
 * thing on the page — nine "You changed the value of …" entries pushing the
 * actual fields off-screen — and it is there whether or not anyone wants to
 * read it.
 *
 * The panel is MOVED into the dialog, never copied. `frm.comment_box` is a
 * live Control and `frm.timeline` holds a jQuery handle on the same nodes
 * (footer.js:20, :60); a clone would leave every handler bound to the copy
 * that is not on screen. Moving keeps posting a comment, editing it, adding an
 * email and every timeline action working with no re-implementation.
 *
 * What must not go wrong: the panel has to come home. It is put back when the
 * dialog hides, and the dialog is closed on route change — otherwise the
 * document would come back to a form whose footer lives in a dialog that has
 * been thrown away.
 *
 * What this file adds to the panel (the entries themselves — categories, the
 * card layout, the message markup — are core/activity_timeline.js):
 *  - a formatting bar under the editor (bold, italic, link, lists, emoji,
 *    attach) that drives the comment control's own Quill instance;
 *  - New Email / New Event, which are Frappe's own buttons moved into the bar
 *    (so they exist exactly when Frappe would show them);
 *  - Post, with "Post & close" and "Post & publish" behind its chevron;
 *  - the tabs, with live counts, and day headers between the entries. */
import { CATS, icon, esc, install, healDocinfo, measureClamps, dayLabel } from "./activity_timeline";

(function () {
	const frappe = window.frappe;
	const $ = window.jQuery;
	/* Do NOT guard on frappe.ui.form.Form here: it lives in form.bundle.js,
	 * which Frappe loads the first time a form is opened — long after this
	 * file runs. Everything below hangs off document events and cur_frm, both
	 * of which exist by then. */
	if (!frappe || !$) return;

	const enabled = () => window.themate?.enabled?.() !== false;

	/* html[data-tm-activity] is set by bootstrap.js (user preference, then the
	 * site default). "inline" leaves Frappe's panel under the form (the
	 * _form-page.scss rule that hides it is scoped to "dialog"), so there is
	 * nothing to open. */
	const dialogMode = () => document.documentElement.dataset.tmActivity !== "inline";

	function panelOf(frm) {
		/* Once it is in the dialog it is no longer under .form-footer. */
		return frm._tm_activity_panel || frm.page?.wrapper?.[0]?.querySelector(".form-footer .after-save") || null;
	}

	function commentCount(frm) {
		const info = frm.get_docinfo?.() || {};
		return (info.comments?.length || 0) + (info.communications?.length || 0);
	}

	const quillOf = (frm) => frm.comment_box?.quill || null;
	const docTitle = (frm) => {
		try {
			return frm.get_title ? frm.get_title() : frm.docname;
		} catch (e) {
			return frm.docname;
		}
	};

	/* The title block, shared by the dialog and the inline panel. */
	function headMarkup(frm) {
		const sub = frm.docname ? `${__(frm.doctype)} · ${docTitle(frm)}` : __(frm.doctype);
		return `<span class="tm-act-head"><span class="tm-act-head__icon" aria-hidden="true">${icon("activity", 18)}</span><span class="tm-act-head__text"><span class="tm-act-head__title">${esc(__("Activity"))}</span><span class="tm-act-head__sub">${esc(sub)}</span></span></span>`;
	}

	/* ---- Popover (link + emoji) ------------------------------------------- */
	const EMOJI = ["😀", "😃", "😄", "😁", "😊", "🙂", "😉", "😍", "🥰", "😘", "😎", "🤩", "🤔", "😐", "😢", "😭", "😡", "👍", "👎", "👏", "🙏", "💪", "🎉", "✅", "❌", "⚠️", "❓", "❗", "🔥", "⭐", "💡", "📌", "📎", "📞", "📧", "📅", "💰", "🚚", "📦", "❤️"];

	function closePop(panel) {
		$(panel).find(".tm-pop").remove();
		$(panel).find(".tm-tool.is-open").removeClass("is-open");
	}

	/* One popover at a time, anchored under the button that opened it. */
	function openPop(panel, $btn, html, ready) {
		const wasOpen = $btn.hasClass("is-open");
		closePop(panel);
		if (wasOpen) return;
		const $bar = $(panel).find(".tm-composer-bar");
		const $pop = $(`<div class="tm-pop" role="dialog">${html}</div>`).appendTo($bar);
		const barBox = $bar[0].getBoundingClientRect();
		const btnBox = $btn[0].getBoundingClientRect();
		/* inset-inline-start is measured from the bar's start edge, whichever way that points */
		const rtl = document.documentElement.dir === "rtl";
		$pop.css("inset-inline-start", `${Math.max(0, rtl ? barBox.right - btnBox.right : btnBox.left - barBox.left)}px`);
		$btn.addClass("is-open");
		ready($pop);
	}

	/* ---- Composer ---------------------------------------------------------- */
	const TOOLS = () => [
		["bold", "bold", __("Bold")],
		["italic", "italic", __("Italic")],
		["link", "link", __("Insert link")],
		["ul", "list", __("Bulleted list")],
		["ol", "ordered", __("Numbered list")],
		["emoji", "smile", __("Emoji")],
		["attach", "paperclip", __("Attach a file")],
	];

	function syncTools(frm, panel) {
		const q = quillOf(frm);
		if (!q) return;
		let f = {};
		try {
			f = q.getSelection() ? q.getFormat() : {};
		} catch (e) {
			/* no selection yet */
		}
		const on = { bold: !!f.bold, italic: !!f.italic, link: !!f.link, ul: f.list === "bullet", ol: f.list === "ordered" };
		$(panel)
			.find(".tm-tool")
			.each(function () {
				const k = this.dataset.tool;
				if (k in on) {
					this.classList.toggle("is-active", on[k]);
					this.setAttribute("aria-pressed", String(on[k]));
				}
			});
	}

	function insertAtCursor(frm, text, formats) {
		const q = quillOf(frm);
		if (!q) return;
		const r = q.getSelection(true) || { index: q.getLength() - 1, length: 0 };
		if (formats) q.insertText(r.index, text, formats, "user");
		else q.insertText(r.index, text, "user");
		q.setSelection(r.index + text.length, 0, "user");
	}

	function linkTool(frm, panel, $btn) {
		const q = quillOf(frm);
		if (!q) return;
		q.focus();
		const range = q.getSelection(true) || { index: 0, length: 0 };
		const current = (q.getFormat(range) || {}).link || "";
		openPop(
			panel,
			$btn,
			`<form class="tm-pop__form"><input type="text" class="form-control" inputmode="url" autocomplete="off" placeholder="${esc(__("Paste a link"))}" aria-label="${esc(__("Insert link"))}" value="${esc(current)}"><button type="submit" class="btn btn-primary btn-sm">${esc(current ? __("Update") : __("Add"))}</button></form>`,
			($pop) => {
				const $in = $pop.find("input");
				setTimeout(() => $in.trigger("focus").trigger("select"), 0);
				$pop.on("submit", (e) => {
					e.preventDefault();
					let url = String($in.val() || "").trim();
					closePop(panel);
					q.focus();
					if (!url) {
						if (current) q.formatText(range.index, range.length, "link", false, "user");
						return;
					}
					if (!/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) url = `https://${url}`;
					if (range.length) q.formatText(range.index, range.length, "link", url, "user");
					else {
						q.insertText(range.index, url, "link", url, "user");
						q.setSelection(range.index + url.length, 0, "user");
					}
				});
			}
		);
	}

	function emojiTool(frm, panel, $btn) {
		const q = quillOf(frm);
		if (!q) return;
		q.focus();
		openPop(panel, $btn, `<div class="tm-pop__emoji" role="listbox" aria-label="${esc(__("Emoji"))}">${EMOJI.map((e) => `<button type="button" class="tm-emoji" role="option" aria-label="${e}">${e}</button>`).join("")}</div>`, ($pop) => {
			$pop.on("mousedown", (e) => e.preventDefault());
			$pop.on("click", ".tm-emoji", function () {
				closePop(panel);
				q.focus();
				insertAtCursor(frm, this.textContent);
			});
		});
	}

	/* Uploads to the document — it shows in the sidebar and as an "attached"
	 * entry like any attachment — and leaves a link to it in the draft. */
	function attachTool(frm) {
		if (!frappe.ui.FileUploader) return;
		new frappe.ui.FileUploader({
			doctype: frm.doctype,
			docname: frm.docname,
			frm,
			folder: "Home/Attachments",
			make_attachments_public: frm.meta.make_attachments_public,
			on_success: (file) => {
				frm.attachments?.attachment_uploaded?.(file);
				const q = quillOf(frm);
				if (q && file?.file_url) insertAtCursor(frm, file.file_name || file.file_url.split("/").pop(), { link: file.file_url });
			},
		});
	}

	function runTool(frm, panel, $btn) {
		const q = quillOf(frm);
		const tool = $btn[0].dataset.tool;
		if (!q) return;
		if (tool === "link") return linkTool(frm, panel, $btn);
		if (tool === "emoji") return emojiTool(frm, panel, $btn);
		if (tool === "attach") return attachTool(frm);
		closePop(panel);
		q.focus();
		const f = q.getFormat();
		if (tool === "bold") q.format("bold", !f.bold, "user");
		else if (tool === "italic") q.format("italic", !f.italic, "user");
		else if (tool === "ul") q.format("list", f.list === "bullet" ? false : "bullet", "user");
		else if (tool === "ol") q.format("list", f.list === "ordered" ? false : "ordered", "user");
		syncTools(frm, panel);
	}

	/* Posting goes through Frappe's own submit (footer.js:31) so a comment is
	 * created, added to the timeline and counted exactly as natively. "Post &
	 * close" and "Post & publish" need the new comment, which Frappe does not
	 * hand back: they wait for it to appear in the timeline (see sync). */
	function post(frm, panel, opts = {}) {
		const box = frm.comment_box;
		if (!box) return;
		const html = box.get_value() || "";
		if (!(strip_html(html).trim() || html.includes("img"))) {
			box.quill?.focus();
			const $c = $(panel).find(".comment-input-container");
			$c.removeClass("tm-nudge");
			void $c[0]?.offsetWidth;
			$c.addClass("tm-nudge");
			return;
		}
		const names = new Set($(panel).find('.timeline-item[data-doctype="Comment"]').map((i, el) => el.dataset.name).get());
		frm._tm_posted_at = Date.now();
		frm._tm_pending = opts.close || opts.publish ? { ...opts, names, at: Date.now() } : null;
		box.submit();
	}

	function setMenu(panel, open) {
		const $split = $(panel).find(".tm-split");
		$split.find(".tm-menu").prop("hidden", !open);
		$split.find(".tm-post-more").attr("aria-expanded", String(open));
	}

	function buildComposer(frm, panel) {
		const $wrap = frm.comment_box?.comment_wrapper;
		if (!$wrap?.length || $wrap.find(".tm-composer-bar").length) return;

		const $bar = $(`<div class="tm-composer-bar">
			<div class="tm-tools" role="toolbar" aria-label="${esc(__("Formatting"))}">
				${TOOLS().map(([k, i, label]) => `<button type="button" class="tm-tool" data-tool="${k}" title="${esc(label)}" aria-label="${esc(label)}"${["bold", "italic", "ul", "ol"].includes(k) ? ' aria-pressed="false"' : ""}>${icon(i, 16)}</button>`).join("")}
			</div>
			<div class="tm-composer-actions"></div>
			<div class="tm-split">
				<button type="button" class="tm-post">${icon("send", 15)}<span>${esc(__("Post", null, "Post a comment"))}</span></button>
				<button type="button" class="tm-post-more" aria-haspopup="menu" aria-expanded="false" title="${esc(__("More ways to post"))}" aria-label="${esc(__("More ways to post"))}">${icon("chevron", 14)}</button>
				<ul class="tm-menu" role="menu" hidden>
					<li role="none"><button type="button" role="menuitem" data-act="post">${icon("send", 15)}<span>${esc(__("Post comment"))}</span><kbd>Ctrl ↵</kbd></button></li>
					<li role="none"><button type="button" role="menuitem" data-act="close">${icon("check", 15)}<span>${esc(__("Post and close"))}</span></button></li>
					<li role="none"><button type="button" role="menuitem" data-act="publish">${icon("globe", 15)}<span>${esc(__("Post and publish"))}<small>${esc(__("Visible to website/portal users."))}</small></span></button></li>
					<li role="none"><button type="button" role="menuitem" data-act="clear">${icon("x", 15)}<span>${esc(__("Discard draft"))}</span></button></li>
				</ul>
			</div>
		</div>`);
		$wrap.append($bar);

		/* The editor must keep its selection while a tool is pressed. */
		$bar.on("mousedown", ".tm-tool, .tm-post, .tm-post-more", (e) => e.preventDefault());
		$bar.on("click", ".tm-tool", function () {
			runTool(frm, panel, $(this));
		});
		$bar.on("click", ".tm-post", () => {
			setMenu(panel, false);
			post(frm, panel);
		});
		$bar.on("click", ".tm-post-more", () => setMenu(panel, $bar.find(".tm-menu").prop("hidden")));
		$bar.on("click", ".tm-menu [data-act]", function () {
			const act = this.dataset.act;
			setMenu(panel, false);
			if (act === "post") post(frm, panel);
			else if (act === "close") post(frm, panel, { close: true });
			else if (act === "publish") post(frm, panel, { publish: true });
			else if (act === "clear") {
				quillOf(frm)?.setText("");
				quillOf(frm)?.focus();
			}
		});

		/* New Email / New Event are Frappe's buttons, moved: they keep their
		 * handlers and exist only when the user may use them. */
		const $actions = $bar.find(".tm-composer-actions");
		const labels = { [__("New Email")]: "mail", [__("New Event")]: "calendar" };
		frm.timeline?.timeline_actions_wrapper?.find(".action-buttons .action-btn").each(function () {
			const $b = $(this);
			const name = labels[$b.text().trim()];
			$b.removeClass("btn-xs btn-default btn-secondary").addClass("tm-action");
			if (name) $b.find("svg").replaceWith(icon(name, 15));
			$actions.append($b);
		});

		const q = quillOf(frm);
		if (q) q.on("editor-change", () => syncTools(frm, panel));
	}

	/* Click elsewhere, or Esc, closes the Post menu and any popover. Esc goes
	 * first in the capture phase and stops there, whatever has focus: the
	 * dialog's own Esc must close the menu, not the dialog under it. */
	document.addEventListener(
		"keydown",
		(e) => {
			if (e.key !== "Escape") return;
			const open = document.querySelector(".after-save.tm-act .tm-menu:not([hidden]), .after-save.tm-act .tm-pop");
			if (!open) return;
			e.stopPropagation();
			e.preventDefault();
			const panel = open.closest(".after-save");
			setMenu(panel, false);
			closePop(panel);
		},
		true
	);
	document.addEventListener("click", (e) => {
		document.querySelectorAll(".after-save.tm-act").forEach((panel) => {
			if (!e.target.closest(".tm-split")) setMenu(panel, false);
			if (!e.target.closest(".tm-pop, .tm-tool")) closePop(panel);
		});
	});

	/* ---- Tabs, groups, empty state ----------------------------------------- */
	function buildChips(frm, panel) {
		const $panel = $(panel);
		if ($panel.children(".tm-activity-toolbar").length) return;
		const $toolbar = $(`<div class="tm-activity-toolbar"><div class="tm-activity-chips" role="tablist" aria-label="${esc(__("Activity"))}">
			${CATS.map((c) => `<button type="button" class="tm-chip${c.key === "all" ? " active" : ""}" role="tab" aria-selected="${c.key === "all"}" data-cat="${c.key}" data-tm-tone="${c.tone}">
				<span class="tm-chip-icon">${icon(c.icon, 16)}</span>
				<span class="tm-chip-label">${esc(c.label())}</span>
				<span class="tm-chip-count" data-count="${c.key}">0</span>
			</button>`).join("")}
		</div></div>`);
		const $box = $panel.children(".comment-box");
		if ($box.length) $box.after($toolbar);
		else $panel.prepend($toolbar);

		$toolbar.on("click", ".tm-chip", function () {
			panel._tm_filter = this.dataset.cat;
			sync(frm, panel);
		});
		/* Arrow keys move between tabs, as a tablist should. */
		$toolbar.on("keydown", ".tm-chip", function (e) {
			const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
			if (!dir) return;
			const rtl = document.documentElement.dir === "rtl";
			const chips = $toolbar.find(".tm-chip").get();
			const next = chips[(chips.indexOf(this) + (rtl ? -dir : dir) + chips.length) % chips.length];
			e.preventDefault();
			next.focus();
			next.click();
		});
	}

	function emptyEl($panel) {
		let $e = $panel.find(".new-timeline > .tm-empty");
		if (!$e.length) {
			$e = $(`<div class="tm-empty" hidden><span class="tm-empty__icon">${icon("inbox", 20)}</span><span class="tm-empty__text"></span></div>`);
			$panel.find(".new-timeline").append($e);
		}
		return $e;
	}

	/* Everything derived from the entries: day headers, tab counts, which
	 * entries the tab hides, the empty state, and what to do with a comment
	 * that was just posted. Idempotent; runs after every render. */
	function sync(frm, panel) {
		const $panel = $(panel);
		/* .timeline-actions carries the .timeline-items class too */
		const list = frm.timeline?.timeline_items_wrapper?.[0] || $panel.find(".timeline-items:not(.timeline-actions)")[0];
		if (!list) return;

		healDocinfo(frm);
		if (panel._tm_doc !== frm.docname) {
			panel._tm_doc = frm.docname;
			panel._tm_filter = "all";
			panel._tm_seen = null;
		}
		const filter = panel._tm_filter || "all";

		$(list).children(".tm-day").remove();
		let items = [...list.children].filter((el) => el.classList.contains("timeline-item") && el.dataset.tmCat);

		/* The same comment twice (see healDocinfo) is shown once. */
		const keys = new Set();
		items = items.filter((el) => {
			if (!el.dataset.doctype || !el.dataset.name) return true;
			const key = `${el.dataset.doctype}/${el.dataset.name}`;
			if (keys.has(key)) {
				el.remove();
				return false;
			}
			keys.add(key);
			return true;
		});

		/* Newest first, whatever order they arrived in: Frappe puts a comment
		 * you just posted at the very top even when an Event ahead of it is
		 * dated later, which would read "Today · Tomorrow · Today". */
		const when = (el) => Date.parse(String(el.dataset.timestamp || "").replace(" ", "T")) || 0;
		const sorted = items.slice().sort((a, b) => when(b) - when(a));
		if (sorted.some((el, i) => el !== items[i])) {
			const more = list.querySelector(":scope > .tm-load-more");
			sorted.forEach((el) => list.append(el));
			if (more) list.append(more);
			items = sorted;
		}

		const counts = Object.fromEntries(CATS.map((c) => [c.key, 0]));
		let last = null;
		let group = null;
		items.forEach((el) => {
			counts.all += 1;
			counts[el.dataset.tmCat] = (counts[el.dataset.tmCat] || 0) + 1;
			const show = filter === "all" || el.dataset.tmCat === filter;
			el.classList.toggle("tm-hidden", !show);

			const key = el.dataset.tmDay || "";
			if (key && key !== last) {
				last = key;
				group = { el: document.createElement("div"), visible: false };
				group.el.className = "tm-day";
				group.el.dataset.tmDay = key;
				group.el.innerHTML = `<span class="tm-day__dot" aria-hidden="true"></span><span class="tm-day__label">${esc(dayLabel(el.dataset.timestamp))}</span>`;
				el.before(group.el);
			}
			if (show && group) group.visible = true;
			if (group) el._tm_group = group;
		});
		items.forEach((el) => {
			if (el._tm_group) el._tm_group.el.hidden = !el._tm_group.visible;
			el._tm_group = null;
		});

		const $toolbar = $panel.children(".tm-activity-toolbar");
		CATS.forEach((c) => {
			const $chip = $toolbar.find(`.tm-chip[data-cat="${c.key}"]`);
			$chip.find(".tm-chip-count").text(counts[c.key] > 99 ? "99+" : String(counts[c.key]));
			$chip.toggleClass("active", c.key === filter).attr("aria-selected", String(c.key === filter)).toggleClass("is-empty", !counts[c.key]);
		});

		/* The rail runs from the first visible node to the last (_activity.scss
		 * masks what lies beyond them), so those two are marked. */
		list.querySelectorAll(":scope > .tm-first, :scope > .tm-last").forEach((el) => el.classList.remove("tm-first", "tm-last"));
		const visible = [...list.children].filter((el) => (el.classList.contains("tm-day") ? !el.hidden : !!el.dataset.tmCat && !el.classList.contains("tm-hidden")));
		visible[0]?.classList.add("tm-first");
		visible[visible.length - 1]?.classList.add("tm-last");

		const shown = items.filter((el) => !el.classList.contains("tm-hidden")).length;
		const $empty = emptyEl($panel);
		$empty.prop("hidden", shown > 0);
		const cat = CATS.find((c) => c.key === filter);
		$empty.find(".tm-empty__text").text(filter === "all" ? __("No activity yet.") : __("No {0} yet.", [cat.label().toLowerCase()]));

		/* New comments: flash them, scroll to them, and finish "Post & …". */
		const names = new Set();
		let fresh = null;
		items.forEach((el) => {
			if (el.dataset.doctype !== "Comment") return;
			names.add(el.dataset.name);
			if (panel._tm_seen && !panel._tm_seen.has(el.dataset.name) && !fresh) fresh = el;
		});
		const known = !!panel._tm_seen;
		panel._tm_seen = names;
		if (known && fresh) afterPost(frm, panel, fresh);

		measureClamps(panel);
		panel._tm_observer?.takeRecords();
	}

	function afterPost(frm, panel, el) {
		el.classList.add("tm-flash");
		setTimeout(() => el.classList.remove("tm-flash"), 1800);
		/* Only the author's own post takes the view back to the top and the
		 * cursor back to the editor; someone else's arriving over realtime
		 * must not move a reader. */
		if (frm._tm_posted_at && Date.now() - frm._tm_posted_at < 20000) {
			const scroller = $(panel).find(".new-timeline")[0];
			if (scroller) scroller.scrollTop = 0;
			quillOf(frm)?.focus();
		}

		const pending = frm._tm_pending;
		frm._tm_pending = null;
		if (!pending || Date.now() - pending.at > 20000 || pending.names.has(el.dataset.name)) return;
		if (pending.publish) {
			frappe
				.xcall("frappe.desk.form.utils.update_comment_publicity", { name: el.dataset.name, publish: 1 })
				.then(() => {
					const c = (frm.get_docinfo().comments || []).find((x) => x.name === el.dataset.name);
					if (c) c.published = 1;
					frm.timeline.refresh();
					frappe.show_alert({ message: __("Comment published"), indicator: "green" });
				});
		}
		if (pending.close) frm._tm_activity_dialog?.hide();
	}

	/* The entries are rebuilt by Frappe on every refresh and added one at a
	 * time when a comment is posted or more are loaded; either way the
	 * children of .timeline-items change, and that is the one signal needed. */
	function watch(frm, panel) {
		const list = frm.timeline?.timeline_items_wrapper?.[0];
		if (!list || panel._tm_observer) return;
		let queued = false;
		panel._tm_observer = new MutationObserver(() => {
			if (queued) return;
			queued = true;
			requestAnimationFrame(() => {
				queued = false;
				try {
					sync(frm, panel);
				} catch (e) {
					/* the entries stay readable without groups */
				}
			});
		});
		panel._tm_observer.observe(list, { childList: true });
	}

	function enhance(frm, panel) {
		const $panel = $(panel);
		if (!panel._tm_ready) {
			panel._tm_ready = true;
			$panel.addClass("tm-act");
			buildComposer(frm, panel);
			buildChips(frm, panel);
			watch(frm, panel);
		}
		/* The dialog has its own title; inline, the panel carries one. */
		$panel.children(".tm-act-head").remove();
		if (!dialogMode()) $panel.prepend(headMarkup(frm));
		sync(frm, panel);
	}

	/* ---- Dialog ------------------------------------------------------------ */
	function putBack(frm) {
		const slot = frm._tm_activity_slot;
		const panel = frm._tm_activity_panel;
		if (panel) {
			closePop(panel);
			setMenu(panel, false);
		}
		if (panel && slot?.parentNode) slot.parentNode.insertBefore(panel, slot);
		slot?.remove();
		frm._tm_activity_slot = null;
		frm._tm_activity_panel = null;
		frm._tm_activity_dialog = null;
		frm._tm_pending = null;
	}

	function open(frm) {
		if (frm._tm_activity_dialog) {
			frm._tm_activity_dialog.show();
			return;
		}
		const panel = panelOf(frm);
		if (!panel) return;

		/* A marker in the DOM, so the panel goes back exactly where it was
		 * even if Frappe re-rendered something around it meanwhile. */
		const slot = document.createElement("div");
		slot.className = "tm-activity-slot";
		panel.parentNode.insertBefore(slot, panel);
		frm._tm_activity_slot = slot;
		frm._tm_activity_panel = panel;

		const dialog = new frappe.ui.Dialog({
			title: headMarkup(frm),
			size: "large",
			onhide: () => putBack(frm),
		});
		dialog.$wrapper.addClass("tm-activity-dialog");
		dialog.$body.empty().append(panel);
		frm._tm_activity_dialog = dialog;

		enhance(frm, panel);
		/* Measured once it has a size; open on the newest entry, the one a
		 * reader wants first. */
		dialog.on_page_show = () => {
			measureClamps(panel);
			const scroller = $(panel).find(".new-timeline")[0];
			if (scroller) scroller.scrollTop = 0;
		};
		dialog.show();
	}

	/* ---- Page head button + lifecycle -------------------------------------- */
	function mount(frm) {
		const page = frm?.page;
		if (!page || !enabled()) return;

		/* The timeline class is only reachable through an instance. If this is
		 * the first one, the first render already happened unpatched: do it
		 * again so the entries carry their category. */
		healDocinfo(frm);
		if (install(frm) && frm.timeline && !frm.doc?.__islocal) {
			try {
				frm.timeline.render_timeline_items();
			} catch (e) {
				/* Frappe's next render will do it */
			}
		}

		const panel = panelOf(frm);
		if (panel) {
			enhance(frm, panel);
			/* Inline again: a dialog opened earlier has nothing left to show. */
			if (!dialogMode()) frm._tm_activity_dialog?.hide();
		}

		/* Inline: no button; a button made earlier is only hidden. */
		if (!dialogMode()) {
			page._tm_activity_btn?.addClass("hide");
			return;
		}

		/* isConnected check */
		if (!page._tm_activity_btn?.[0]?.isConnected) {
			const btn = page.add_action_icon(
				"small-message",
				() => open(window.cur_frm || frm),
				"tm-activity-btn",
				__("Activity")
			);
			if (!btn?.[0]?.isConnected) return;
			btn.append('<span class="tm-activity-count" hidden></span>');
			const menu = btn.closest(".standard-actions").children(".menu-btn-group");
			if (menu.length) btn.insertBefore(menu);
			page._tm_activity_btn = btn;
		} else {
			page._tm_activity_btn.removeClass("hide");
		}

		/* A document that has never been saved has no activity and no footer. */
		const isNew = !!frm.doc?.__islocal;
		page._tm_activity_btn.toggleClass("hide", isNew);
		if (isNew) return;

		const count = commentCount(frm);
		const chip = page._tm_activity_btn.find(".tm-activity-count")[0];
		if (chip) {
			chip.textContent = count > 99 ? "99+" : String(count);
			chip.hidden = count === 0;
		}
	}

	$(document).on("form-load form-refresh", () => {
		try {
			if (window.cur_frm) mount(window.cur_frm);
		} catch (e) {
			/* a form that renders is worth more than a button */
		}
	});

	/* Leaving the document with the dialog open would strand the panel. */
	$(document).on("page-change", () => {
		const frm = window.cur_frm;
		if (frm?._tm_activity_dialog) frm._tm_activity_dialog.hide();
	});

	/* The Theme Customizer previews the choice live: close the dialog (which
	 * puts the panel back under the form) and re-mount the button. */
	document.addEventListener("themate:activity", () => {
		try {
			const frm = window.cur_frm;
			if (!frm) return;
			if (!dialogMode()) frm._tm_activity_dialog?.hide();
			mount(frm);
		} catch (e) {
			/* never break the customizer over a button */
		}
	});
})();

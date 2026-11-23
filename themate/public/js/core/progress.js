/* Progress as a "Background tasks" panel in the corner, not a modal.
 *
 * Native frappe.show_progress (ui/messages.js:364) opens a modal Dialog that
 * blocks the page until it is hidden; realtime "progress" events from the
 * server (socketio_client.js:76, publish_progress) open the same modal. Here
 * every task is a row in one panel at the bottom inline-end corner:
 *
 *   - the panel's head says how many tasks run and their overall progress;
 *     collapsed, the head alone is left: title, task count, bar, percent;
 *   - one row per title (as native reuses the dialog for the same title);
 *     a row's chevron shows its details (description, count, state);
 *   - the panel sits above a minimised dialog; Frappe's toasts are centred
 *     at the bottom (_dropdowns.scss), apart from it;
 *   - closing a running row only hides it ("running in background");
 *   - a finished task (100% with hide_on_completion, as the realtime events
 *     send) turns green and leaves by itself; if it was hidden, the panel
 *     collapsed or the tab in the background, a toast — and a system
 *     notification when the browser already allows them — says it is done.
 *
 * The object returned keeps the parts of the native dialog callers use:
 * hide(), title, percent, is_visible, $wrapper, progress_bar.
 * The theme switch off gives Frappe's modal back. */
(function () {
	const frappe = window.frappe;
	if (!frappe?.show_progress || frappe.show_progress._tm) return;

	const enabled = () => window.themate?.enabled?.() !== false;
	const native = { show: frappe.show_progress, hide: frappe.hide_progress };
	const DONE_HOLD = 4000;
	const CTX = "Background task";
	const tasks = new Map();
	let dock = null;
	let list = null;
	let watch = null;

	const svg = (body, cls = "") =>
		`<svg class="tm-ic ${cls}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
	const ICON = {
		spin: svg('<path d="M21 12a9 9 0 1 1-6.22-8.56"/>', "tm-task__spin"),
		done: svg('<path d="M20 6 9 17l-5-5"/>'),
		close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
		chev: svg('<path d="m6 9 6 6 6-6"/>', "tm-chev"),
		layers: svg('<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'),
	};
	const esc = (s) => frappe.utils.escape_html(String(s ?? ""));
	const format = (n) => format_number(+n, null, Number.isInteger(+n) ? 0 : 1); /* plain text; frappe.format wraps numbers in a div */

	/* collapsed or open is the person's choice, kept for the next tasks */
	const FOLD_KEY = "tm-task-folded";
	const folded = () => {
		try { return localStorage.getItem(FOLD_KEY) === "1"; } catch (e) { return false; }
	};
	const keepFold = (on) => {
		try { localStorage.setItem(FOLD_KEY, on ? "1" : "0"); } catch (e) { /* private window */ }
	};
	function setFold(on) {
		dock.classList.toggle("is-folded", on);
		const btn = dock.querySelector(".tm-tasks__fold");
		btn.setAttribute("aria-expanded", String(!on));
		const label = on ? __("Expand", null, CTX) : __("Collapse");
		btn.setAttribute("aria-label", label);
		btn.title = label;
	}

	function ensureDock() {
		if (dock?.isConnected) return dock;
		dock = document.createElement("section");
		dock.className = "tm-task-dock";
		dock.hidden = true;
		dock.setAttribute("aria-label", __("Background tasks"));
		dock.innerHTML = `
			<div class="tm-tasks__head">
				<span class="tm-tasks__icon">${ICON.layers}</span>
				<div class="tm-tasks__titles">
					<span class="tm-tasks__title">${esc(__("Background tasks"))}</span>
					<span class="tm-tasks__sub" aria-live="polite"></span>
				</div>
				<span class="tm-tasks__pill"></span>
				<div class="tm-tasks__total">
					<span class="tm-tasks__pct"></span>
					<span class="tm-tasks__label">${esc(__("Overall progress"))}</span>
				</div>
				<button type="button" class="tm-tasks__fold">${ICON.chev}</button>
				<div class="tm-tasks__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(__("Overall progress"))}"><span class="tm-tasks__fill"></span></div>
			</div>
			<div class="tm-tasks__list" role="list"></div>`;
		list = dock.querySelector(".tm-tasks__list");
		setFold(folded());
		dock.querySelector(".tm-tasks__fold").addEventListener("click", () => {
			const on = !dock.classList.contains("is-folded");
			keepFold(on);
			setFold(on);
			track();
		});
		document.body.appendChild(dock);
		return dock;
	}

	/* the head: how many run, and all of them together */
	function summary() {
		if (!dock) return;
		const shown = [...tasks.values()].filter((t) => t.el);
		const running = shown.filter((t) => t.state === "running").length;
		const pct = shown.length ? Math.round(shown.reduce((a, t) => a + t.percent, 0) / shown.length) : 0;
		dock.dataset.state = running ? "running" : "done";
		dock.querySelector(".tm-tasks__sub").textContent = running
			? running === 1 ? __("1 task running") : __("{0} tasks running", [running])
			: __("All tasks done");
		dock.querySelector(".tm-tasks__pill").textContent = shown.length === 1 ? __("1 task") : __("{0} tasks", [shown.length]);
		dock.querySelector(".tm-tasks__pct").textContent = `${pct}%`;
		dock.querySelector(".tm-tasks__fill").style.inlineSize = `${pct}%`;
		dock.querySelector(".tm-tasks__bar").setAttribute("aria-valuenow", String(pct));
	}

	/* A minimised dialog shares the corner; the panel sits above it. Measured
	 * while any row is up (minimising changes only a class, which nothing
	 * cheap can watch). */
	function place() {
		if (!dock) return;
		const mini = [...document.querySelectorAll(".modal.modal-minimize .modal-dialog")].find((d) => d.offsetParent !== null);
		const under = mini ? mini.getBoundingClientRect().height : 0;
		dock.style.setProperty("--tm-dock-under", `${Math.round(under)}px`);
	}
	function track() {
		if (dock) {
			const empty = !list.childElementCount;
			if (empty !== dock.hidden) {
				dock.hidden = empty;
				dock.classList.remove("is-in");
				if (!empty) requestAnimationFrame(() => dock.classList.add("is-in"));
			}
			summary();
		}
		place();
		const busy = [...tasks.values()].some((t) => t.el?.isConnected);
		if (busy && !watch) watch = setInterval(place, 1000);
		if (!busy && watch) {
			clearInterval(watch);
			watch = null;
		}
	}

	function build(task) {
		ensureDock();
		const el = document.createElement("div");
		el.className = "tm-task";
		el.dataset.state = "running";
		el.setAttribute("role", "listitem");
		el.innerHTML = `
			<span class="tm-task__tile">${ICON.spin}</span>
			<div class="tm-task__main">
				<div class="tm-task__head"><span class="tm-task__title"></span><span class="tm-task__pct"></span></div>
				<div class="tm-task__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span class="tm-task__fill"></span></div>
				<div class="tm-task__more">
					<span class="tm-task__desc"></span>
					<span class="tm-task__foot"><span class="tm-task__count"></span><span class="tm-task__where"></span></span>
				</div>
			</div>
			<button type="button" class="tm-task__open" aria-expanded="false" aria-label="${esc(__("Show details"))}" title="${esc(__("Show details"))}">${ICON.chev}</button>
			<button type="button" class="tm-task__close" aria-label="${esc(__("Hide"))}" title="${esc(__("Hide"))}">${ICON.close}</button>`;
		el.querySelector(".tm-task__close").addEventListener("click", () => dismiss(task));
		el.querySelector(".tm-task__open").addEventListener("click", (e) => {
			const open = el.classList.toggle("is-open");
			const label = open ? __("Hide details") : __("Show details");
			e.currentTarget.setAttribute("aria-expanded", String(open));
			e.currentTarget.setAttribute("aria-label", label);
			e.currentTarget.title = label;
			track();
		});
		el.addEventListener("mouseenter", () => (task.hover = true));
		el.addEventListener("mouseleave", () => {
			task.hover = false;
			if (task.state === "done") later(task);
		});
		list.appendChild(el);
		requestAnimationFrame(() => el.classList.add("is-in"));
		return el;
	}

	function paint(task) {
		const el = task.el;
		if (!el) return;
		const done = task.state === "done";
		el.dataset.state = task.state;
		el.querySelector(".tm-task__title").textContent = task.title;
		el.querySelector(".tm-task__pct").textContent = done ? __("Done", null, CTX) : `${task.percent}%`;
		el.querySelector(".tm-task__tile").innerHTML = done ? ICON.done : ICON.spin;
		el.querySelector(".tm-task__fill").style.inlineSize = `${task.percent}%`;
		el.querySelector(".tm-task__bar").setAttribute("aria-valuenow", String(task.percent));
		el.querySelector(".tm-task__desc").textContent = done ? __("Done", null, CTX) : task.description || __("Working…");
		el.querySelector(".tm-task__count").textContent =
			task.total && task.total !== 100 && !done ? __("{0} of {1}", [format(task.count), format(task.total)]) : "";
		el.querySelector(".tm-task__where").textContent = done ? __("Completed", null, CTX) : __("Running in background");
		task.progress_bar = $(el.querySelector(".tm-task__fill"));
		task.$wrapper = $(el);
	}

	function leave(task) {
		clearTimeout(task.timer);
		tasks.delete(task.title);
		if (frappe.cur_progress === task) frappe.cur_progress = null;
		const el = task.el;
		task.el = null;
		task.is_visible = false;
		if (!el) return track();
		el.classList.remove("is-in");
		el.classList.add("is-out");
		let gone = false;
		const go = () => {
			if (gone) return;
			gone = true;
			el.remove();
			track();
		};
		el.addEventListener("transitionend", go, { once: true });
		setTimeout(go, 400);
	}
	function later(task) {
		clearTimeout(task.timer);
		task.timer = setTimeout(() => (task.hover ? null : leave(task)), DONE_HOLD);
	}

	function dismiss(task) {
		if (task.state === "done") return leave(task);
		/* the task goes on; its end will still be told */
		task.dismissed = true;
		const el = task.el;
		task.el = null;
		task.is_visible = false;
		if (el) {
			el.classList.add("is-out");
			setTimeout(() => {
				el.remove();
				track();
			}, 300);
		}
		summary();
	}

	function tell(task) {
		const away = document.hidden;
		if (task.dismissed || away || folded()) {
			frappe.show_alert({ message: __("{0} is done", [task.title]), indicator: "green" }, 7);
		}
		if (away && window.Notification?.permission === "granted") {
			try {
				const icon = document.querySelector("link[rel~='icon']")?.href;
				new Notification(task.title, { body: __("Done", null, CTX), icon, tag: `tm-task:${task.title}` });
			} catch (e) {
				/* some browsers allow Notification only from a service worker */
			}
		}
	}

	function finish(task) {
		if (task.state === "done") return;
		task.state = "done";
		task.percent = 100;
		tell(task);
		if (task.dismissed || !task.el) return leave(task);
		paint(task);
		summary();
		later(task);
	}

	function show(title, count, total = 100, description, hide_on_completion = false) {
		if (!enabled()) return native.show.apply(this, arguments);
		title = title || __("Progress");
		let task = tasks.get(title);
		if (!task || task.state === "done") {
			if (task) leave(task);
			task = { title, state: "running", is_visible: true, hide: () => leave(task) };
			tasks.set(title, task);
			task.el = build(task);
		}
		task.count = flt(count);
		task.total = flt(total) || 100;
		task.percent = Math.max(0, Math.min(100, cint((task.count * 100) / task.total)));
		if (description) task.description = description;
		frappe.cur_progress = task;
		if (hide_on_completion && task.percent === 100) {
			finish(task);
		} else if (task.el) {
			paint(task);
		}
		track();
		return task;
	}
	show._tm = true;

	frappe.show_progress = show;
	frappe.hide_progress = function () {
		const task = frappe.cur_progress;
		if (task && tasks.get(task.title) === task) {
			/* reached the end: the same finish as a completed realtime task */
			if (task.percent >= 100) return finish(task);
			return leave(task);
		}
		return native.hide.apply(this, arguments);
	};
})();

/* Overview block at the top of the form side panel.
 *
 * The design's right-hand panel opens with "<Doctype> Overview": the record's
 * image (or the module icon), its name, its status and its key fields; then
 * "Document" introduces Frappe's own rows (Assigned To, Attachments, Tags,
 * Share). Everything shown is read from the loaded document and its meta —
 * title field first, then the fields the doctype marks In List View — and
 * formatted with frappe.format, so it is exactly what the list view shows.
 *
 * The panel folds to a rail beside the form and back (the chevron in its
 * corner, or a click on the rail): one choice per user for every form, kept
 * in the desk state (forms._panel) like the list's Explore panel. Only where
 * the panel sits beside the form (≥ 992px, _form-page.scss); narrower,
 * Frappe makes it a drawer opened from the page head, and nothing folds.
 *
 * Rebuilt on every form-refresh (save, reload, rename) and idempotent. */
(function () {
	const frappe = window.frappe;
	if (!frappe || !window.jQuery) return;

	const SIMPLE = new Set(["Data", "Link", "Dynamic Link", "Select", "Int", "Float", "Currency", "Percent",
		"Date", "Datetime", "Time", "Check", "Duration", "Rating", "Phone", "Autocomplete"]);
	const MAX_FIELDS = 3;

	function pickFields(frm) {
		const meta = frm.meta;
		const out = [];
		const seen = new Set();
		const add = (df) => {
			if (!df || seen.has(df.fieldname) || !SIMPLE.has(df.fieldtype)) return;
			if (df.hidden || df.fieldname === meta.image_field) return;
			const value = frm.doc[df.fieldname];
			if (value === undefined || value === null || value === "") return;
			if (String(value) === String(frm.docname)) return; /* already the heading */
			seen.add(df.fieldname);
			out.push(df);
		};
		/* Title field, then what the list view shows, then the mandatory
		 * fields — the fields a person uses to recognise the record. */
		if (meta.title_field && meta.title_field !== "name") add(frappe.meta.get_docfield(frm.doctype, meta.title_field));
		(meta.fields || []).forEach((df) => { if (df.in_list_view && out.length < MAX_FIELDS) add(df); });
		(meta.fields || []).forEach((df) => { if (df.reqd && out.length < MAX_FIELDS) add(df); });
		return out;
	}

	/* Frappe's own image block (upload / change / remove, wired in
	 * form/sidebar/user_image.js to the <li> it renders) is MOVED into the
	 * overview's picture box, not copied: its handlers and the sidebar's
	 * image_wrapper reference travel with the node, so uploading a photo
	 * from the panel is exactly the native flow. The module icon sits
	 * behind it and shows only while the record has no image. */
	function adoptImageSection(frm, iconBox) {
		const sidebar = frm.$wrapper?.[0]?.querySelector(".layout-side-section .form-sidebar");
		const section = sidebar?.querySelector(".sidebar-image-section");
		if (!section || !frm.meta.image_field) return false;
		if (section.parentElement !== iconBox) iconBox.appendChild(section);
		return true;
	}

	/* ---- folding the panel -------------------------------------------- */
	const ds = () => window.themate?.deskState;
	/* _form-page.scss puts the panel beside the form from this width */
	const besideForm = () => window.matchMedia?.("(min-width: 992px)")?.matches !== false;

	function setRail(side, btn, rail) {
		side.classList.toggle("tm-panel-rail", rail);
		const label = rail ? __("Expand panel") : __("Collapse panel");
		btn.title = label;
		btn.setAttribute("aria-label", label);
		btn.setAttribute("aria-expanded", String(!rail));
	}

	function foldControl(sidebar) {
		const side = sidebar.closest(".layout-side-section");
		if (!side) return;
		let btn = sidebar.querySelector(":scope > .tm-panel-fold");
		if (!btn) {
			btn = document.createElement("button");
			btn.type = "button";
			btn.className = "btn-reset tm-panel-fold";
			btn.innerHTML = frappe.utils.icon("es-line-left-chevron", "sm");
			sidebar.prepend(btn);
			const toggle = (rail) => {
				ds()?.set("forms", "_panel", { rail: rail ? 1 : 0 });
				setRail(side, btn, rail);
			};
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				toggle(!side.classList.contains("tm-panel-rail"));
			});
			/* the whole rail opens it, not only the chevron — where it is a rail:
			 * in the narrow drawer a click is meant for the row under it */
			sidebar.addEventListener("click", () => {
				if (side.classList.contains("tm-panel-rail") && besideForm()) toggle(false);
			});
		}
		setRail(side, btn, !!ds()?.get("forms", "_panel")?.rail);
	}

	function build(frm) {
		const sidebar = frm.$wrapper?.[0]?.querySelector(".layout-side-section .form-sidebar");
		if (!sidebar || frm.is_new() || !window.themate?.enabled?.()) {
			sidebar?.querySelector(".tm-overview")?.remove();
			sidebar?.querySelector(".tm-panel-label-doc")?.remove();
			if (!window.themate?.enabled?.()) {
				sidebar?.querySelector(":scope > .tm-panel-fold")?.remove();
				sidebar?.closest(".layout-side-section")?.classList.remove("tm-panel-rail");
			}
			return;
		}
		foldControl(sidebar);

		const esc = frappe.utils.escape_html;
		let block = sidebar.querySelector(".tm-overview");
		if (!block) {
			block = document.createElement("div");
			block.className = "tm-overview";
			block.innerHTML = `
				<div class="tm-panel-label"></div>
				<div class="tm-overview-head">
					<div class="tm-overview-icon"></div>
					<div class="tm-overview-title">
						<div class="tm-overview-name"></div>
						<div class="tm-overview-status"></div>
					</div>
				</div>
				<div class="tm-overview-fields"></div>`;
			sidebar.prepend(block);
		}

		block.querySelector(".tm-panel-label").textContent = __("{0} Overview", [__(frm.meta.name)]);
		block.querySelector(".tm-overview-name").textContent = frm.docname;

		/* Picture box: the module icon, plus Frappe's image block on top. */
		const iconBox = block.querySelector(".tm-overview-icon");
		let svg = iconBox.querySelector(":scope > svg");
		const fresh = document.querySelector(".page-head .tm-page-icon svg");
		if (fresh && (!svg || svg.innerHTML !== fresh.innerHTML)) {
			svg?.remove();
			svg = fresh.cloneNode(true);
			iconBox.prepend(svg);
		} else if (!svg) {
			const tmp = document.createElement("div");
			tmp.innerHTML = frappe.utils.icon("file", "lg");
			iconBox.prepend(tmp.firstElementChild);
		}
		iconBox.classList.toggle("tm-overview-icon-uploadable", adoptImageSection(frm, iconBox));

		/* Status: a copy of the page-head pill, refreshed each time. */
		const statusHost = block.querySelector(".tm-overview-status");
		statusHost.replaceChildren();
		const status = document.querySelector(".page-head .indicator-pill:not(.hide)");
		if (status && status.textContent.trim()) statusHost.appendChild(status.cloneNode(true));

		/* Key fields. */
		const list = block.querySelector(".tm-overview-fields");
		list.replaceChildren();
		pickFields(frm).forEach((df) => {
			const row = document.createElement("div");
			row.className = "tm-overview-field";
			row.innerHTML = `<div class="tm-overview-label">${esc(__(df.label))}</div><div class="tm-overview-value"></div>`;
			row.querySelector(".tm-overview-value").innerHTML = frappe.format(frm.doc[df.fieldname], df, { inline: true }, frm.doc);
			list.appendChild(row);
		});

		/* "Document" introduces Frappe's own rows. */
		let label = sidebar.querySelector(".tm-panel-label-doc");
		const firstRow = sidebar.querySelector(".form-assignments, .form-attachments, .form-tags, .form-shared");
		if (firstRow) {
			if (!label) {
				label = document.createElement("div");
				label.className = "tm-panel-label tm-panel-label-doc";
				label.textContent = __("Document");
			}
			firstRow.parentNode.insertBefore(label, firstRow);
		} else {
			label?.remove();
		}
	}

	let timer = null;
	window.jQuery(document).on("form-refresh", (e, frm) => {
		try {
			if (frm) build(frm);
		} catch (err) {
			console.warn("[themate] overview skipped:", err);
		}
		/* The page-head indicator is set after this event; one more pass. */
		clearTimeout(timer);
		timer = setTimeout(() => window.themate?.refreshOverview?.(), 400);
	});

	/* The sidebar marks its active item after an async render; when that
	 * lands after form-refresh the icon cloned here is stale. The sidebar
	 * calls this after re-marking (modern_sidebar.js update_active_items). */
	window.themate = window.themate || {};
	window.themate.refreshOverview = () => {
		const frm = window.cur_frm;
		if (frm && frm.doc && !frm.is_new()) {
			try { build(frm); } catch (err) { /* keep quiet on a re-sync */ }
		}
	};
})();

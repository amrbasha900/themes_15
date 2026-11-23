/* Print studio: the print page (frappe/printing/page/print) as a desk with
 * the paper on it — a context strip (what is being printed: title, status,
 * party, date, total), a zoom row (Fit / 100% / 125%, the page size and the
 * page count), Prev / Next through the list the record came from — and a
 * settings panel that reads: the print formats as cards (type, default,
 * the one in use), the language as a segmented pair, the letter head and
 * the options as switches. The toolbar says what people do: Print, PDF,
 * Email (the document attached), Copy link, Open in tab; Refresh joins the
 * menu.
 *
 * Frappe's PrintView keeps every behaviour: its Link controls stay in the
 * sidebar (hidden) and are written to, its preview() is what renders, its
 * menu keeps Customize and Print Settings. The class is defined by the
 * page's own script the first time /app/print opens, so the prototype is
 * patched from frappe.views.Page.trigger_page_event just before on_page_load builds
 * the instance. Choices are remembered per doctype in the desk state
 * (prints.<doctype>: format, lang, letterhead; prints._zoom). */
(function () {
	const frappe = window.frappe;
	const $ = window.jQuery;
	if (!frappe || !$ || !frappe.views?.Page) return;

	const enabled = () => window.themate?.enabled?.() !== false;
	const esc = (s) => frappe.utils.escape_html(String(s ?? ""));
	const icon = (n, s = "xs") => frappe.utils.icon(n, s);
	const ds = () => window.themate?.deskState;
	/* Above this many formats the list gets a filter box; below it, scanning
	 * the list by eye is faster than typing. */
	const MANY_FORMATS = 6;
	const PAGE_W = { A4: 794, A3: 1123, A5: 559, Letter: 816, Legal: 816 };
	const PAGE_H = { A4: 1123, A3: 1587, A5: 794, Letter: 1056, Legal: 1344 };

	function patch() {
		const PV = frappe.ui.form?.PrintView;
		if (!PV || PV.prototype._tm_studio) return;
		PV.prototype._tm_studio = true;
		const make = PV.prototype.make, show = PV.prototype.show, preview = PV.prototype.preview;
		PV.prototype.make = function () {
			make.apply(this, arguments);
			if (!enabled()) return;
			try {
				this._tm = new Studio(this);
			} catch (e) {
				console.error("themate: print studio", e);
			}
		};
		PV.prototype.show = function (frm) {
			const out = show.apply(this, arguments);
			Promise.resolve(out).then(() => this._tm?.onShow(frm)).catch(() => {});
			return out;
		};
		PV.prototype.preview = function () {
			const out = preview.apply(this, arguments);
			this._tm?.onPreview();
			return out;
		};
	}
	const trigger = frappe.views.Page.prototype.trigger_page_event;
	frappe.views.Page.prototype.trigger_page_event = function (event) {
		if (this.name === "print" && event === "on_page_load") patch();
		return trigger.apply(this, arguments);
	};

	class Studio {
		constructor(pv) {
			this.pv = pv;
			this.page = pv.page;
			this.$wrap = this.page.wrapper.addClass("tm-print");
			this.settings = pv.print_settings || {};
			this.zoom = (ds()?.get("prints", "_zoom") || {}).level || "fit";
			this.buildDesk();
			this.buildPanel();
			this.buildToolbar();
			this.page.wrapper.on("keydown", (e) => { if (e.key === "Escape" && !document.querySelector(".modal.show")) this.pv.go_to_form_view(); });
		}

		/* ---- the viewer: a scrolling desk with the paper on it ------------- */
		buildDesk() {
			this.$desk = this.page.main.find(".print-preview-wrapper").addClass("tm-viewer");
			this.$bar = $(`<div class="tm-viewer-bar">
				<span class="tm-viewer-page"></span>
				<span class="tm-viewer-zoom">
					<button type="button" class="btn-reset" data-z="-" title="${__("Zoom out")}">${icon("dash")}</button>
					<b class="tm-viewer-level"></b>
					<button type="button" class="btn-reset" data-z="+" title="${__("Zoom in")}">${icon("add")}</button>
					<button type="button" class="btn-reset tm-viewer-fit" data-z="fit">${__("Fit width")}</button>
				</span>
				<span class="tm-viewer-right">
					<button type="button" class="btn-reset tm-viewer-exact" hidden></button>
					<span class="tm-viewer-size"></span>
				</span>
			</div>`).prependTo(this.$desk);
			this.$bar.on("click", "[data-z]", (e) => {
				const z = e.currentTarget.dataset.z, cur = this.level();
				this.zoom = z === "fit" ? "fit" : String(Math.min(2, Math.max(0.4, Math.round((cur + (z === "+" ? 0.1 : -0.1)) * 10) / 10)));
				ds()?.set("prints", "_zoom", { level: this.zoom });
				this.applyZoom();
			});
			this.$bar.on("click", ".tm-viewer-exact", () => this.setMode(!this.exact));
			this.$paper = this.$desk.find(".print-preview").addClass("tm-print-paper");
			this.ro = new ResizeObserver(() => { this.fitHeight(); if (this.zoom === "fit") this.applyZoom(); });
			this.ro.observe(this.page.main[0]);
			$(window).off("resize.tm-print").on("resize.tm-print", () => this.fitHeight());
			this.fitHeight();
			this.applyZoom();
			this.setMode(false);
		}

		pageSize() {
			return this.settings.pdf_page_size || "A4";
		}

		/* the viewer takes what is left of the window; the paper scrolls inside it */
		fitHeight() {
			const top = this.$desk[0]?.getBoundingClientRect().top || 0;
			if (top > 0) this.$desk.css("height", `${Math.max(320, window.innerHeight - top - 28)}px`);
		}

		level() {
			const width = PAGE_W[this.pageSize()] || 794;
			const room = this.$desk[0]?.clientWidth || 0;
			return this.zoom === "fit" ? Math.min(1.5, Math.max(0.3, (room - 56) / width)) : Number(this.zoom);
		}

		applyZoom() {
			const level = this.level();
			this.$paper.css({ zoom: level, width: `${PAGE_W[this.pageSize()] || 794}px`, maxWidth: "none" });
			this.$bar.find(".tm-viewer-level").text(`${Math.round(level * 100)}%`);
			this.$bar.find(".tm-viewer-fit").toggleClass("is-on", this.zoom === "fit");
			this.$bar.find(".tm-viewer-size").text(this.pageSize());
			this.showPages();
		}

		/* ---- how many pages, and how honestly ------------------------------
		 * Fast mode has no pages to count: the preview is one continuous HTML
		 * flow, and the only clues are the explicit .page-break divs (which a
		 * hand-written Jinja format need not use — it may break on its own
		 * CSS) and the height over a sheet (which ignores the margins, the
		 * headers and anything wkhtmltopdf decides to move). So fast mode
		 * gives a rough number and says it is rough; the exact count comes
		 * from the PDF itself, on request. */
		onPreview() {
			const can = this.canExact();
			this.$bar.find(".tm-viewer-exact").prop("hidden", !can);
			/* setMode compares the URL: a format, language or letter head
			 * change renders again, a plain re-preview does not */
			if (this.exact) this.setMode(can);
			this.pages = 0;
			this.showPages();
			/* Readiness, without a timeout racing the request: Frappe writes
			 * the server HTML into the preview iframe in one body.html()
			 * (setup_print_format_dom), so that one childList mutation is
			 * "the new document is in". Fonts and images land after it and
			 * change the height, which the resize picks up — but only once
			 * the mutation says the height belongs to this render and not to
			 * the one before it. */
			const frame = this.pv.print_wrapper.find(".print-preview iframe")[0];
			if (!frame) return;
			this.fresh = false;
			this.mo?.disconnect();
			this.fro?.disconnect();
			const body = frame.contentDocument?.body;
			if (body) {
				this.mo = new MutationObserver(() => {
					this.fresh = true;
					this.countPages(frame);
				});
				this.mo.observe(body, { childList: true });
			}
			this.fro = new ResizeObserver(() => this.fresh && this.countPages(frame));
			this.fro.observe(frame);
		}

		countPages(frame) {
			const fmt = this.pv.$print_format_body?.find(".print-format");
			const h = fmt?.outerHeight() || frame.offsetHeight || 0;
			if (!h) return;
			/* .page-break is a container, one per layout page (frappe
			 * templates/print_formats/standard.html), so it is a floor and
			 * not a count: a single container holding a long child table
			 * runs over several sheets. The height over a sheet catches that
			 * case and over-counts the other way. Take whichever is larger
			 * and call it approximate. */
			const breaks = fmt ? fmt.find(".page-break").length : 0;
			this.pages = Math.max(breaks || 1, Math.ceil(h / (PAGE_H[this.pageSize()] || 1123)));
			this.showPages();
		}

		showPages() {
			if (this.exact) return; /* the PDF viewer owns the counter */
			const $p = this.$bar.find(".tm-viewer-page");
			$p.text(!this.pages ? __("Measuring…") : this.pages === 1 ? __("1 page") : __("about {0} pages", [this.pages]));
		}

		/* Raw printing has no preview at all, and Print Format Builder Beta
		 * renders through WeasyPrint in its own iframe: both keep Frappe's
		 * path and lose the button. */
		canExact() {
			const pf = (window.locals["Print Format"] || {})[this.pv.selected_format()] || {};
			return !!this.frm?.doc && !pf.print_format_builder_beta && !pf.raw_printing;
		}

		/* Exact mode hands the server's own PDF to the browser's PDF viewer:
		 * the artifact that gets downloaded, paginated by the renderer that
		 * made it, counted, scrolled and zoomed by code that ships with the
		 * browser. It costs a wkhtmltopdf run, so it is a button and never
		 * automatic, and it re-renders only when the URL actually changes —
		 * not on scroll or zoom, which it no longer owns. */
		setMode(on) {
			this.exact = !!on && this.canExact();
			this.$desk.toggleClass("is-exact", this.exact);
			this.$bar.find(".tm-viewer-zoom").toggle(!this.exact);
			this.$bar.find(".tm-viewer-exact").text(this.exact ? __("Fast preview") : __("Exact pages"));
			if (!this.exact) {
				this.drop();
				this.src = null;
				this.showPages();
				return;
			}
			const src = this.pdfSrc();
			if (this.src === src && this.$pdf) return;
			this.src = src;
			this.$bar.find(".tm-viewer-page").text(__("Exact pages — from the PDF"));
			this.$desk.addClass("is-waiting");
			this.$wait = (this.$wait || $(`<div class="tm-viewer-wait"></div>`).appendTo(this.$desk))
				.text(__("Rendering the PDF…"))
				.show();
			this.$pdf?.remove();
			this.$pdf = null;
			/* The frame loads the URL itself. Not a blob — the viewer names
			 * itself after the last path segment, and a blob: URL leaves it
			 * showing a UUID — and not behind a fetch of our own either:
			 * measured, the frame does not reuse what fetch() cached, so a
			 * pre-flight costs a second wkhtmltopdf run. The viewer's own
			 * repeat request is answered from the cache the renderer allows
			 * (Cache-Control: private, max-age=60), so the server renders
			 * once. A failure arrives as Frappe's error page in the frame,
			 * in Frappe's own words. */
			this.$pdf = $(`<iframe class="tm-viewer-pdf" title="${__("Print preview")}"></iframe>`)
				.appendTo(this.$desk)
				.on("load", () => {
					clearTimeout(this.wt);
					this.$desk.removeClass("is-waiting");
					this.$wait?.hide();
				})
				.attr("src", src);
			/* A browser told to download PDFs rather than open them saves the
			 * file and never loads the frame: say so instead of waiting. */
			clearTimeout(this.wt);
			this.wt = setTimeout(() => {
				if (this.$wait?.is(":visible")) this.$wait.text(__("The PDF did not open here. Your browser may be set to download PDFs — check your downloads, or go back to Fast preview."));
			}, 20000);
		}

		drop() {
			clearTimeout(this.wt);
			this.$desk.removeClass("is-waiting");
			this.$pdf?.remove();
			this.$wait?.remove();
			this.$pdf = this.$wait = null;
		}

		/* themate/print_pdf.py: Frappe's own download_pdf, served from a path
		 * that ends in the document's name so the viewer has something to
		 * call it. Everything it needs stays in the query string. */
		pdfSrc() {
			return frappe.urllib.get_full_url(`/themate-print/${encodeURIComponent(this.frm.doc.name)}.pdf?${this.params()}`);
		}

		/* what Frappe's own PDF button sends (print.js render_page), so the
		 * preview and the download are the same artifact */
		params() {
			const pv = this.pv, doc = this.frm.doc;
			return `doctype=${encodeURIComponent(doc.doctype)}&name=${encodeURIComponent(doc.name)}&format=${encodeURIComponent(pv.selected_format())}&no_letterhead=${pv.with_letterhead() ? 0 : 1}&letterhead=${encodeURIComponent(pv.get_letterhead())}&settings=${encodeURIComponent(JSON.stringify(pv.additional_settings || {}))}${pv.lang_code ? `&_lang=${pv.lang_code}` : ""}`;
		}

		/* ---- what is being printed ----------------------------------------- */
		onShow(frm) {
			this.frm = frm;
			const doc = frm.doc, meta = frm.meta || frappe.get_meta(frm.doctype);
			if (!doc) return;
			const ind = frappe.get_indicator(doc, frm.doctype) || [];
			if (ind[0]) this.page.set_indicator(__(ind[0]), ind[1]);
			const field = (test) => meta.fields.find((df) => !df.hidden && test(df));
			const date = field((df) => ["Date", "Datetime"].includes(df.fieldtype) && (df.in_list_view || df.reqd));
			const party = field((df) => df.fieldtype === "Link" && df.in_list_view && !["Company", "Currency", "User"].includes(df.options));
			const money = field((df) => df.fieldtype === "Currency" && df.in_list_view);
			const bits = [__(frm.doctype), doc[meta.title_field] !== doc.name ? doc[meta.title_field] : null, party && doc[party.fieldname], date && doc[date.fieldname] && frappe.format(doc[date.fieldname], date, { only_value: 1 }), money && doc[money.fieldname] !== undefined && frappe.format(doc[money.fieldname], money, { only_value: 1 })];
			this.page.set_title_sub(bits.filter(Boolean).map((b) => esc(b)).join(`<span class="tm-print-dot">·</span>`));
			this.fitHeight();
			this.buildNav();
			this.renderFormats();
			this.renderLanguages();
			this.remembered();
			/* show() previews before it hands the record over, so the first
			 * onPreview ran without a doc to offer the exact count for */
			this.$bar.find(".tm-viewer-exact").prop("hidden", !this.canExact());
		}

		/* Prev / Next through the list the record was opened from */
		buildNav() {
			const list = Object.values(frappe.views.list_view || {}).find((v) => v?.doctype === this.frm.doctype && v.data?.length);
			const names = list ? list.data.map((d) => d.name) : [];
			const i = names.indexOf(this.frm.doc.name);
			if (!this.$nav) {
				this.$nav = $(`<div class="tm-print-nav"><button type="button" class="btn btn-default btn-sm" data-d="-1" title="${__("Previous")}">${icon("left")}</button><button type="button" class="btn btn-default btn-sm" data-d="1" title="${__("Next")}">${icon("right")}</button></div>`);
				this.page.custom_actions.prepend(this.$nav);
				this.$nav.on("click", "button", (e) => {
					const to = this._names?.[this._i + Number(e.currentTarget.dataset.d)];
					if (to) frappe.set_route("print", this.frm.doctype, to);
				});
			}
			this._names = names;
			this._i = i;
			this.$nav.toggle(i !== -1 && names.length > 1);
			this.$nav.find("[data-d='-1']").prop("disabled", i <= 0);
			this.$nav.find("[data-d='1']").prop("disabled", i === -1 || i >= names.length - 1);
		}

		/* ---- the panel ----------------------------------------------------- */
		buildPanel() {
			const $side = this.page.sidebar;
			this.$panel = $(`<div class="tm-print-side">
				<div class="tm-print-side-head"><span>${__("Print settings")}</span><button type="button" class="btn-reset tm-print-fold" title="${__("Collapse")}">${icon("es-line-left-chevron")}</button></div>
				<div class="tm-print-side-body">
					<h4><span>${__("Print format")}<i class="tm-print-count"></i></span><button type="button" class="btn-reset tm-print-customize">${__("Customize")}</button></h4>
					<input type="search" class="tm-print-find" hidden autocomplete="off" spellcheck="false" placeholder="${__("Find a format")}" aria-label="${__("Find a format")}">
					<div class="tm-print-formats"></div>
					<h4>${__("Language")}</h4>
					<div class="tm-print-langs"></div>
					<h4>${__("Letter head")}</h4>
					<div class="tm-print-lh"></div>
					<h4>${__("Options")}</h4>
					<div class="tm-print-opts"></div>
				</div>
			</div>`).prependTo($side);
			$side.addClass("tm-print-host");
			/* Frappe's own controls: the letter head keeps its Link, the options their checks */
			this.$panel.find(".tm-print-lh").append(this.pv.letterhead_selector.closest(".frappe-control"));
			this.$panel.find(".tm-print-opts").append(this.pv.sidebar_dynamic_section);
			this.$panel.find(".tm-print-customize").on("click", () => this.pv.edit_print_format());
			const rail = !!(ds()?.get("prints", "_panel") || {}).rail;
			this.$panel.toggleClass("is-rail", rail);
			this.$panel.find(".tm-print-fold").on("click", () => {
				const on = this.$panel.toggleClass("is-rail").hasClass("is-rail");
				ds()?.set("prints", "_panel", { rail: on ? 1 : 0 });
				setTimeout(() => this.applyZoom(), 250);
			});
			this.$panel.on("click", ".tm-print-format", (e) => this.pickFormat(e.currentTarget.dataset.name));
			this.$panel.on("input", ".tm-print-find", (e) => this.filterFormats(e.currentTarget.value));
			this.$panel.on("keydown", ".tm-print-find", (e) => {
				if (e.key !== "Escape") return;
				e.currentTarget.value = "";
				this.filterFormats("");
			});
			this.$panel.on("click", ".tm-print-lang", (e) => this.pickLang(e.currentTarget.dataset.code));
			this.pv.letterhead_selector.on("change", () => this.remember({ letterhead: this.pv.letterhead_selector.val() || "" }));
		}

		renderFormats() {
			const doctype = this.frm.doctype;
			const names = frappe.meta.get_print_formats(doctype);
			const current = this.pv.selected_format();
			const dflt = this.frm.meta?.default_print_format || "Standard";
			const kind = (name) => {
				const pf = (locals["Print Format"] || {})[name];
				if (!pf) return __("Standard");
				if (pf.print_format_builder_beta) return __("Designer");
				if (pf.raw_printing) return __("Raw");
				if (pf.custom_format) return __("Jinja");
				return pf.print_format_builder ? __("Builder") : __("Standard");
			};
			this.$panel.find(".tm-print-formats").html(names.map((n) => `
				<button type="button" class="tm-print-format ${n === current ? "is-on" : ""}" data-name="${esc(n)}" data-find="${esc((__(n) + " " + kind(n)).toLowerCase())}">
					<b>${esc(__(n))}${n === dflt ? ` <i class="tm-print-star" title="${__("Default")}">★</i>` : ""}</b>
					<small>${kind(n)}</small>
				</button>`).join("") + `<div class="tm-print-none" hidden>${__("No format matches")}</div>`);

			/* The list is capped and scrolls (see _print.scss). Everything
			 * below it — language, letter head, options — has to stay where it
			 * is however many formats a site has installed; before this, a
			 * doctype with a dozen formats pushed all three off the panel. The
			 * count says the list is longer than what is on screen, and the
			 * filter appears only once scanning by eye stops being realistic. */
			this.$panel.find(".tm-print-count").text(names.length > 1 ? ` (${names.length})` : "");
			const many = names.length > MANY_FORMATS;
			const $find = this.$panel.find(".tm-print-find");
			$find.prop("hidden", !many);
			if (!many) $find.val("");
			this.filterFormats(many ? $find.val() : "");

			/* A selection out of sight reads as no selection at all. */
			const $on = this.$panel.find(".tm-print-format.is-on")[0];
			if ($on) $on.scrollIntoView({ block: "nearest" });
		}

		/* Matches the translated name and the kind ("Jinja", "Designer", …),
		 * both baked into data-find at render time so typing costs no work
		 * beyond the comparison. */
		filterFormats(term) {
			const q = String(term || "").trim().toLowerCase();
			let shown = 0;
			this.$panel.find(".tm-print-format").each((_, el) => {
				const hit = !q || (el.dataset.find || "").includes(q);
				el.hidden = !hit;
				if (hit) shown++;
			});
			this.$panel.find(".tm-print-none").prop("hidden", shown > 0);
		}

		pickFormat(name) {
			if (name === this.pv.selected_format()) return;
			this.pv.print_format_selector.val(name);
			this.pv.refresh_print_format();
			this.renderFormats();
			this.remember({ format: name });
		}

		renderLanguages() {
			const langs = window.frappe?.boot?.themate?.navbar?.languages || [];
			const current = this.pv.language_selector.val() || frappe.boot.lang;
			const list = langs.length ? langs : [{ code: current, label: current }];
			if (!list.some((l) => l.code === current)) list.push({ code: current, label: current });
			this.$panel.find(".tm-print-langs").html(`<span class="tm-print-seg">${list.map((l) => `<button type="button" class="tm-print-lang ${l.code === current ? "is-on" : ""}" data-code="${esc(l.code)}" title="${esc(l.label)}">${esc(l.code.toUpperCase())}</button>`).join("")}</span>`);
		}

		pickLang(code) {
			if (code === this.pv.language_selector.val()) return;
			this.pv.language_selector.val(code);
			this.pv.set_user_lang();
			this.pv.preview();
			this.renderLanguages();
			this.remember({ lang: code });
		}

		remember(part) {
			ds()?.set("prints", this.frm.doctype, part);
		}

		/* the last choices for this doctype, applied after Frappe's defaults */
		remembered() {
			const m = ds()?.get("prints", this.frm.doctype) || {};
			let dirty = false;
			if (m.format && m.format !== this.pv.selected_format() && frappe.meta.get_print_formats(this.frm.doctype).includes(m.format)) {
				this.pv.print_format_selector.val(m.format);
				dirty = true;
			}
			if (m.lang && m.lang !== this.pv.language_selector.val()) {
				this.pv.language_selector.val(m.lang);
				this.pv.set_user_lang();
				dirty = true;
			}
			if (m.letterhead !== undefined && m.letterhead !== (this.pv.letterhead_selector.val() || "")) {
				this.pv.letterhead_selector.val(m.letterhead);
				dirty = true;
			}
			if (dirty) {
				this.pv.refresh_print_format();
				this.renderFormats();
				this.renderLanguages();
			}
		}

		/* ---- the toolbar --------------------------------------------------- */
		buildToolbar() {
			const $acts = this.page.custom_actions;
			const find = (label) => $acts.find(".btn").filter((_, b) => $(b).text().trim() === label);
			/* add_button renders "<svg/> label" as a text node after the icon */
			/* Frappe's bare /printview page is no place to send people: Full Page
			 * and Refresh join the menu, Print prints from here */
			find(__("Full Page")).hide();
			find(__("Refresh")).hide();
			this.page.add_menu_item(__("Open in tab"), () => this.pv.render_page("/printview?"), true);
			this.page.add_menu_item(__("Refresh"), () => {
				this.src = null; /* Refresh means render it again, same URL or not */
				this.pv.refresh_print_format();
			}, true);
			const $mail = this.page.add_button(__("Email"), () => this.email(), { icon: "mail" });
			const $link = this.page.add_button(__("Copy link"), () => this.copyLink(), { icon: "link-url" });
			/* PDF · Email · Copy link */
			$mail.insertAfter(find(__("PDF")));
			$link.insertAfter($mail);
			/* the paper is already here, rendered with the print stylesheet: the
			 * browser's print dialog opens on it instead of on a new tab that
			 * re-renders the document and then calls print() (Frappe's flow);
			 * server and raw printing keep Frappe's path */
			const pv = this.pv, printit = pv.printit.bind(pv);
			pv.printit = () => {
				const settings = pv.print_settings || {};
				if (cint(settings.enable_print_server) || pv.is_raw_printing() || pv.get_mapped_printer().length) return printit();
				/* in exact mode what is on screen is the PDF: print that, so the
				 * paper matches the preview the page count came from */
				const frame = (this.exact && this.$pdf?.[0]) || pv.print_wrapper.find(".print-preview-wrapper:visible iframe, .preview-beta-wrapper:visible iframe")[0];
				const win = frame?.contentWindow;
				if (!win) return printit();
				if (this.exact) {
					try {
						win.focus();
						win.print();
					} catch (e) {
						printit();
					}
					return;
				}
				if (!win.document?.body?.children.length) return printit();
				win.focus();
				win.print();
			};
		}

		email() {
			const frm = this.frm;
			if (!frm?.doc) return;
			try {
				new frappe.views.CommunicationComposer({
					doc: frm.doc, frm: frm.email_doc ? frm : null,
					subject: __(frm.doctype) + ": " + frm.doc.name,
					recipients: frm.doc.email || frm.doc.email_id || frm.doc.contact_email,
					attach_document_print: true,
				});
			} catch (e) {
				frappe.set_route("Form", frm.doctype, frm.doc.name);
			}
		}

		copyLink() {
			frappe.utils.copy_to_clipboard(frappe.urllib.get_full_url(`/printview?${this.params()}`));
		}
	}
})();

/* frappe.Chart -> ECharts, lazily.
 *
 * Frappe's own charting library is the desk-wide default: every dashboard
 * widget, report chart and form graph calls `new frappe.Chart(...)`. This
 * replaces that constructor with a thin stand-in that loads
 * themate-charts.bundle.js (ECharts + charts/adapter.js) the first time a
 * supported chart is drawn and defers the render until it arrives; data
 * pushed through update() in the meantime is kept and applied.
 *
 * Unsupported types (heatmap) and the "Frappe Charts" engine setting go
 * straight to the native constructor, unchanged.
 *
 * Dashboard Chart > Type gains ten ECharts-only types (install.py
 * apply_chart_types adds them to the Select while the engine is ECharts):
 * Area, Stacked Bar, Horizontal Bar, Scatter, Radar, Funnel, Gauge,
 * Treemap, Sunburst, Rose. Frappe's chart widget maps the Type label to a
 * Frappe Charts key it knows (chart_widget.js chart_type_map) and would
 * pass `undefined` for these, so get_chart_args is wrapped to set the
 * theme's key. With the engine on Frappe Charts, or if the bundle fails,
 * each falls back to the nearest native look (NATIVE_FALLBACK). */
(function () {
	const frappe = window.frappe;
	if (!frappe?.Chart || frappe.Chart._tm_lazy) return;

	const Native = frappe.Chart;
	/* Dashboard Chart > Type label -> adapter key */
	const TM_TYPES = {
		Area: "area", "Stacked Bar": "stacked-bar", "Horizontal Bar": "horizontal-bar", Scatter: "scatter",
		Radar: "radar", Funnel: "funnel", Gauge: "gauge", Treemap: "treemap", Sunburst: "sunburst", Rose: "rose",
	};
	const NATIVE_FALLBACK = {
		area: "line", "stacked-bar": "bar", "horizontal-bar": "bar", scatter: "line",
		radar: "bar", funnel: "bar", gauge: "percentage", treemap: "pie", sunburst: "pie", rose: "pie",
	};
	const SUPPORTED = new Set(["bar", "line", "pie", "donut", "percentage", "axis-mixed", ...Object.values(TM_TYPES)]);
	const useECharts = (args) =>
		(frappe.boot?.themate?.chart_engine || "ECharts") === "ECharts" &&
		SUPPORTED.has((args && args.type) || "bar") &&
		window.themate?.enabled?.() !== false;

	/* the theme's types drawn by Frappe Charts: nearest native look */
	function nativeArgs(args) {
		const out = Object.assign({}, args);
		const fb = NATIVE_FALLBACK[out.type];
		if (fb) {
			if (out.type === "area") out.lineOptions = Object.assign({}, out.lineOptions, { regionFill: 1 });
			if (out.type === "stacked-bar") out.barOptions = Object.assign({}, out.barOptions, { stacked: 1 });
			out.type = fb;
		}
		return out;
	}

	const ChartWidget = frappe.widget?.widget_factory?.chart;
	if (ChartWidget && !ChartWidget.prototype._tm_types) {
		const original = ChartWidget.prototype.get_chart_args;
		ChartWidget.prototype.get_chart_args = function () {
			const args = original.apply(this, arguments);
			const key = TM_TYPES[this.chart_doc?.type];
			if (key) args.type = key;
			/* for the adapter's annotations: which chart, on what time grain */
			if (this.chart_doc) {
				args.tm_chart = this.chart_doc.name;
				args.tm_timeseries = !!this.chart_doc.timeseries;
				args.tm_interval = this.selected_time_interval || this.chart_doc.time_interval || "Monthly";
			}
			return args;
		};

		/* "Annotate…" in the chart's menu: a mark on a date, for this chart or
		 * for every time-series chart (Themate Chart Annotation) */
		const setActions = ChartWidget.prototype.set_chart_actions;
		ChartWidget.prototype.set_chart_actions = function (actions) {
			if (this.chart_doc?.timeseries && frappe.model.can_create("Themate Chart Annotation")) {
				actions = (actions || []).concat([{
					label: __("Annotate…"),
					action: "action-annotate",
					handler: () => annotate(this),
				}, {
					label: __("Manage annotations"),
					action: "action-annotations",
					handler: () => { frappe.route_options = { chart: ["in", [this.chart_doc.name, ""]] }; frappe.set_route("List", "Themate Chart Annotation"); },
				}]);
			}
			return setActions.call(this, actions);
		};

		function annotate(widget) {
			const d = new frappe.ui.Dialog({
				title: __("Mark an event on the chart"),
				fields: [
					{ fieldname: "date", fieldtype: "Date", label: __("Date"), reqd: 1, default: frappe.datetime.get_today() },
					{ fieldname: "label", fieldtype: "Data", label: __("What happened"), reqd: 1, description: __("Short: a price change, a campaign, a new branch.") },
					{ fieldname: "scope", fieldtype: "Select", label: __("Show on"), options: [{ label: __("This chart only"), value: "chart" }, { label: __("Every time-series chart"), value: "all" }], default: "chart" },
					{ fieldname: "note", fieldtype: "Small Text", label: __("Note") },
					{ fieldname: "color", fieldtype: "Color", label: __("Colour") },
				],
				primary_action_label: __("Mark"),
				primary_action: async (v) => {
					d.hide();
					await frappe.xcall("frappe.client.insert", { doc: { doctype: "Themate Chart Annotation", date: v.date, label: v.label, note: v.note, color: v.color, chart: v.scope === "chart" ? widget.chart_doc.name : null } });
					frappe.show_alert({ message: __("Marked"), indicator: "green" }, 2);
					widget.chart?.loadAnnotations?.();
				},
			});
			d.show();
		}
		/* a dashboard segment (workspace/tabs.js segment bar) narrows the chart
		 * too: each dimension is added where the chart's document type has the
		 * field, "mine" as the owner; a report chart takes a company only */
		const fetch = ChartWidget.prototype.fetch;
		ChartWidget.prototype.fetch = function (filters, refresh, args) {
			const seg = this.tm_segments;
			const doc = this.chart_doc;
			if (seg && Object.keys(seg).length && doc) {
				if (doc.chart_type === "Report") {
					const f = Object.assign({}, filters || {});
					if (seg.company && "company" in f) f.company = seg.company;
					return fetch.call(this, f, refresh, args);
				}
				const dt = doc.document_type;
				const meta = dt && frappe.get_meta(dt);
				const extra = [];
				Object.entries(seg).forEach(([field, value]) => {
					if (field === "mine") { extra.push([dt, "owner", "=", frappe.session.user]); return; }
					if (meta?.has_field(field)) extra.push([dt, field, "=", value]);
					else if (field === "warehouse" && meta?.has_field("set_warehouse")) extra.push([dt, "set_warehouse", "=", value]);
				});
				if (extra.length) return fetch.call(this, (frappe.utils.parse_array(filters) || []).concat(extra), refresh, args);
			}
			return fetch.call(this, filters, refresh, args);
		};
		/* The chart's requests go through frappe.call with a PermissionError
		 * handler: Frappe's xcall put up a blocking "You don't have access to
		 * Report …" dialog over the whole workspace and, with no catch in the
		 * widget, left the card on "Loading..." for good. Two steps ask the
		 * server — a report chart's filters (prepare_chart_object) and the data
		 * (fetch); both reach xcall synchronously. A failure draws the card's
		 * own state and never resolves, so the rest of the chain does not run
		 * on nothing. */
		function quietly(widget, run) {
			const xcall = frappe.xcall;
			let failed = null;
			frappe.xcall = (method, params) => new Promise((resolve, reject) => {
				frappe.call({
					method, args: params,
					error_handlers: { PermissionError: () => { failed = "denied"; } },
					callback: (r) => resolve(r.message),
					error: (r) => reject(r),
				});
			});
			let out;
			try {
				out = run();
			} finally {
				frappe.xcall = xcall;
			}
			return Promise.resolve(out).catch(() => {
				noData(widget, failed || "failed");
				return new Promise(() => {});
			});
		}
		const fetchSegmented = ChartWidget.prototype.fetch;
		ChartWidget.prototype.fetch = function (filters, refresh, args) {
			return quietly(this, () => fetchSegmented.call(this, filters, refresh, args));
		};
		const prepare = ChartWidget.prototype.prepare_chart_object;
		ChartWidget.prototype.prepare_chart_object = function () {
			return quietly(this, () => prepare.apply(this, arguments));
		};

		/* No data: a short card that says why and what can be done, instead of
		 * Frappe's 240px "No Data" box. Zero here is not an error — the period
		 * simply holds nothing — so it reads neutral, with a wider period, the
		 * list and (if the user may) the first record as the ways forward. */
		const render = ChartWidget.prototype.render;
		ChartWidget.prototype.render = async function () {
			const out = await render.apply(this, arguments);
			if (window.themate?.enabled?.() === false) return out;
			const d = this.data;
			const none = !d || !d.labels || !d.labels.length || !(d.datasets || []).some((ds) => (ds.values || []).some((v) => Number(v)));
			if (none) noData(this, "empty");
			else this.body?.find(".tm-chart-none").remove();
			return out;
		};
		ChartWidget.prototype._tm_types = true;
	}

	const WIDER = { "Last Week": "Last Month", "Last Month": "Last Quarter", "Last Quarter": "Last Year" };
	function noData(widget, kind) {
		if (!widget.body || window.themate?.enabled?.() === false) return;
		const doc = widget.chart_doc || {};
		const dt = doc.chart_type === "Report" ? null : doc.document_type;
		const span = widget.selected_timespan || widget.chart_settings?.timespan || doc.timespan;
		const esc = frappe.utils.escape_html;
		widget.loading?.hide();
		widget.empty?.hide();
		widget.chart_wrapper?.hide();
		widget.body.find(".tm-chart-none").remove();
		let title, reason = "", actions = [];
		if (kind === "denied") {
			title = __("You do not have access to this chart's data");
		} else if (kind === "failed") {
			title = __("Could not load. Try refreshing.");
			actions.push(["refresh", __("Refresh")]);
		} else {
			title = __("Nothing to chart yet");
			if (doc.chart_type === "Report") reason = __("The report has no rows for these filters.");
			else if (doc.timeseries && span && span !== "Select Date Range") reason = __("No {0} records in {1}.", [__(dt), __(span)]);
			else reason = __("No {0} records match this chart.", [__(dt)]);
			if (doc.timeseries && WIDER[span]) actions.push(["wider", __("Show {0}", [__(WIDER[span])])]);
			if (dt && frappe.model.can_read(dt)) actions.push(["open", __("Open {0}", [__(dt)])]);
			if (dt && frappe.model.can_create(dt) && !(frappe.boot?.single_types || []).includes(dt)) actions.push(["new", __("New {0}", [__(dt)])]);
		}
		const el = window.jQuery(`<div class="tm-chart-none" role="status">
			<span class="tm-chart-none-icon" aria-hidden="true"></span>
			<span class="tm-chart-none-text"><b>${esc(title)}</b>${reason ? `<small>${esc(reason)}</small>` : ""}</span>
			${actions.length ? `<span class="tm-chart-none-actions">${actions.map(([k, label]) => `<button type="button" class="btn btn-xs btn-default" data-act="${k}">${esc(label)}</button>`).join("")}</span>` : ""}
		</div>`);
		el.on("click", "[data-act]", (e) => {
			const act = e.currentTarget.dataset.act;
			if (act === "refresh") return widget.fetch_and_update_chart();
			if (act === "open") return frappe.set_route("List", dt);
			if (act === "new") return frappe.new_doc(dt);
			if (act === "wider") {
				widget.selected_timespan = WIDER[span];
				widget.action_area?.find(".timespan-filter .filter-label").text(__(widget.selected_timespan));
				widget.save_chart_config_for_user?.({ timespan: widget.selected_timespan, from_date: null, to_date: null });
				widget.fetch_and_update_chart();
			}
		});
		widget.body.append(el);
	}

	class LazyChart {
		constructor(parent, args) {
			if (!useECharts(args)) return new Native(parent, nativeArgs(args));
			this.parent = parent;
			this.args = args || {};
			this.impl = null;
			this.pending = null;
			if (window.themate?.charts) {
				this.mount();
			} else {
				frappe.require("themate-charts.bundle.js").then(() => this.mount()).catch((e) => {
					console.warn("[themate] charts bundle failed, using Frappe Charts:", e);
					this.impl = new Native(this.parent, nativeArgs(this.args));
				});
			}
		}

		mount() {
			if (this.impl) return;
			try {
				this.impl = new window.themate.charts.Chart(this.parent, this.args);
			} catch (e) {
				console.warn("[themate] ECharts render failed, using Frappe Charts:", e);
				this.impl = new Native(this.parent, nativeArgs(this.args));
			}
			if (this.pending) {
				this.impl.update(this.pending);
				this.pending = null;
			}
		}

		update(data) {
			if (this.impl) this.impl.update(data);
			else this.pending = data;
		}

		destroy() {
			this.impl?.destroy?.();
		}

		export() {
			this.impl?.export?.();
		}
	}

	LazyChart._tm_lazy = true;
	frappe.Chart = LazyChart;
})();

/* Themate charts — Frappe Charts arguments rendered with ECharts.
 *
 * Every chart on the desk is created as `new frappe.Chart(wrapper, args)`
 * (dashboard widgets, query reports, report view, form dashboards) with the
 * Frappe Charts option shape. This adapter takes that shape and renders it
 * with ECharts, so nothing upstream changes: same data, filters, currency
 * formatting (tooltipOptions.formatTooltipY is Frappe's own formatter) and
 * navigation. core/charts.js decides when to use it.
 *
 * Supported: bar (stacked), line (area, smooth, dots), axis-mixed
 * (per-dataset chartType), pie, donut, percentage — Frappe's own types —
 * plus the ones the theme adds to Dashboard Chart > Type (install.py
 * apply_chart_types, core/charts.js maps the label to the key):
 *   area            stacked area lines
 *   stacked-bar     bars stacked per label
 *   horizontal-bar  bars across, labels down the side
 *   scatter         one dot per label and series
 *   radar           labels as spokes, one polygon per series
 *   funnel          labels as narrowing bands, largest first
 *   gauge           the first value against the total of all values
 *   treemap         labels as tiles sized by value
 *   sunburst        labels as a single ring
 *   rose            Nightingale pie — radius follows the value
 * Heatmap stays on Frappe Charts (its calendar layout and year picker are
 * built into the widget); core/charts.js falls back before loading this.
 *
 * Theme Settings > Charts > Chart Detail:
 *   Rich   (default) gradient bars with value labels and background bands,
 *          smooth area lines with average line and peak marker, a
 *          toolbox (bar/line switch, reset, save as image), data
 *          zoom for long series, donut centre total, percent legend.
 *   Simple flat fills, no toolbox, no markers — the previous look.
 *
 * Height: the chart fills its card (min-height = the height Frappe asked
 * for), so every chart on a grid row is the same height instead of leaving
 * the bottom of the taller card blank. An empty result (no labels, or every
 * value 0/null) shows an empty state instead of a blank canvas.
 *
 * Theme: colours, fonts, grid and text come from the theme's tokens at
 * render time, so light and dark are handled and a brand change shows on
 * the next render. Bars are capped (barMaxWidth) — one bar for one period
 * no longer fills half the chart. */
(function () {
	const echarts = window.echarts;
	if (!echarts) return;

	const cssVar = (name, fallback) => {
		const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return v || fallback;
	};
	const isRTL = () => document.documentElement.dir === "rtl";
	const rich = () => (window.frappe?.boot?.themate?.chart_detail || "Rich") !== "Simple";

	/* Frappe Charts colour names -> the theme's series tokens. Hex passes
	 * through. Unnamed series continue down --tm-chart-1..8. */
	const NAMED = {
		"light-blue": "--tm-brand-400", blue: "--tm-brand-500", "dark-blue": "--tm-brand-700",
		green: "--tm-chart-5", "light-green": "--tm-chart-5", red: "--tm-red-500",
		orange: "--tm-chart-7", yellow: "--tm-chart-3", purple: "--tm-chart-4", "light-purple": "--tm-chart-4",
		pink: "--tm-chart-6", "light-pink": "--tm-chart-6", magenta: "--tm-chart-6",
		teal: "--tm-chart-2", cyan: "--tm-chart-2",
		grey: "--tm-gray-400", "light-grey": "--tm-gray-300", "dark-grey": "--tm-gray-600",
	};
	const FALLBACK = ["#1677ff", "#13c2c2", "#faad14", "#722ed1", "#52c41a", "#eb2f96", "#fa8c16", "#2f54eb"];

	function palette(colors) {
		const series = FALLBACK.map((hex, i) => cssVar(`--tm-chart-${i + 1}`, hex));
		const named = (colors || []).filter(Boolean).map((c) => {
			const key = String(c).toLowerCase();
			return NAMED[key] ? cssVar(NAMED[key], "") : key;
		}).filter(Boolean);
		return named.length ? named.concat(series.filter((c) => !named.includes(c))) : series;
	}

	function theme() {
		return {
			text: cssVar("--tm-text-2", "#595959"),
			textStrong: cssVar("--tm-text", "#1f1f1f"),
			muted: cssVar("--tm-text-3", "#8c8c8c"),
			grid: cssVar("--tm-border", "#f0f0f0"),
			surface: cssVar("--tm-surface-raised", "#ffffff"),
			border: cssVar("--tm-border-strong", "#d9d9d9"),
			brand: cssVar("--tm-brand-500", "#1677ff"),
			font: cssVar("--tm-font-stack", "Inter, sans-serif"),
			radius: parseInt(cssVar("--tm-radius-sm", "4px"), 10) || 4,
		};
	}

	/* "#1677ff" / "#17f" / "rgb(a)(…)" -> rgba with the given alpha. */
	function withAlpha(color, a) {
		const c = String(color || "").trim();
		let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
		if (m) {
			let h = m[1];
			if (h.length === 3) h = h.split("").map((x) => x + x).join("");
			const n = parseInt(h, 16);
			return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
		}
		m = c.match(/^rgba?\(([^)]+)\)$/i);
		if (m) {
			const parts = m[1].split(/[\s,\/]+/).filter(Boolean).slice(0, 3);
			return `rgba(${parts.join(", ")}, ${a})`;
		}
		return c;
	}

	const vertical = (from, to) => new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: from }, { offset: 1, color: to }]);

	const shorten = (n) => {
		const f = window.frappe?.utils?.format_chart_axis_number;
		return f ? f(n) : n;
	};

	function collapseSlices(labels, values, max) {
		if (!max || labels.length <= max) return { labels, values };
		const rows = labels.map((l, i) => [l, values[i] || 0]).sort((a, b) => b[1] - a[1]);
		const keep = rows.slice(0, max - 1);
		const rest = rows.slice(max - 1).reduce((s, r) => s + r[1], 0);
		keep.push([__("Others"), rest]);
		return { labels: keep.map((r) => r[0]), values: keep.map((r) => r[1]) };
	}

	/* No labels, or nothing but zeros/nulls: a chart of nothing. */
	function isEmpty(data) {
		const labels = data?.labels || [];
		const datasets = data?.datasets || [];
		if (!labels.length || !datasets.length) return true;
		return datasets.every((ds) => !(ds.values || []).some((v) => Number(v)));
	}

	const pctOf = (v, total) => Math.round(((Number(v) || 0) / (total || 1)) * 100);

	function legendBox(t, extra) {
		const text = { color: t.text, fontSize: 12 };
		return Object.assign({
			icon: "circle", itemWidth: 8, itemHeight: 8, itemGap: 14,
			textStyle: text,
			type: "scroll", pageIconColor: t.text, pageIconInactiveColor: t.grid, pageTextStyle: { color: t.muted, fontSize: 11 },
		}, extra, extra?.textStyle ? { textStyle: Object.assign({}, text, extra.textStyle) } : {});
	}

	function toolbox(t, args, isLine) {
		if (!rich()) return undefined;
		const pos = isRTL() ? { left: 0 } : { right: 0 };
		return Object.assign({
			top: 0, itemSize: 13, itemGap: 10, showTitle: true,
			iconStyle: { borderColor: t.muted, borderWidth: 1.2 },
			emphasis: { iconStyle: { borderColor: t.brand, textFill: t.textStrong, textBackgroundColor: t.surface, textBorderRadius: 3, textPadding: [3, 6] } },
			feature: {
				magicType: { type: isLine ? ["bar", "line"] : ["line", "bar"], title: { line: __("Line"), bar: __("Bar") } },
				restore: { title: __("Reset") },
				saveAsImage: { title: __("Save as image"), name: String(args.title || "chart").replace(/\s+/g, "-"), pixelRatio: 2, backgroundColor: t.surface },
			},
		}, pos);
	}

	/* Where a pie's legend goes depends on the card, not the data: beside the
	 * ring when the card is wide enough for the longest label next to a
	 * readable ring, under it otherwise. Sizes are in px so the ring never
	 * grows into the legend (ECharts' percentages know nothing about it). */
	function pieLayout(args, L, rtl, withPct) {
		const W = args._w || 520, H = args._h || 260;
		const longest = L.reduce((m, n) => Math.max(m, String(n).length), 0) + (withPct ? 6 : 0);
		/* beside the ring, a long label is cut with an ellipsis (the tooltip has
		 * the whole of it) rather than pushed under the ring in pages */
		const legendW = Math.min(Math.round(longest * 6.4 + 34), Math.round(W * 0.5));
		if (W >= 380 && H >= 160 && L.length <= Math.floor((H - 8) / 20)) {
			const areaW = W - legendW - 12;
			const r = Math.round(Math.min(areaW * 0.42, H * 0.42));
			return {
				legend: { orient: "vertical", top: "middle", [rtl ? "left" : "right"]: 6, width: legendW, tooltip: { show: true }, textStyle: { overflow: "truncate", width: legendW - 26 } },
				center: [rtl ? W - areaW / 2 : areaW / 2, "50%"], r,
			};
		}
		/* under the ring: wrapped onto up to three lines, paged past that */
		const itemsW = L.reduce((sum, n) => sum + (String(n).length + (withPct ? 6 : 0)) * 6.4 + 30, 0);
		const rows = Math.ceil(itemsW / Math.max(W - 16, 1));
		const paged = rows > 3;
		const legendH = paged ? 30 : rows * 20 + 8;
		const r = Math.round(Math.min(W * 0.4, (H - legendH - 8) * 0.44));
		return { legend: { type: paged ? "scroll" : "plain", orient: "horizontal", bottom: 0, left: "center", width: W - 16 }, center: ["50%", (H - legendH) / 2], r };
	}

	function buildOption(args) {
		const t = theme();
		const R = rich();
		const rtl = isRTL();
		const data = args.data || {};
		/* a Group By on a blank field comes back with a null label */
		const labels = (data.labels || []).map((l) => (l === null || l === undefined || l === "" ? __("Not set") : l));
		const datasets = data.datasets || [];
		const colors = palette(args.colors);
		const type = args.type || "bar";
		const fmtY = args.tooltipOptions?.formatTooltipY;
		const fmtX = args.tooltipOptions?.formatTooltipX;
		const fmt = (v) => (fmtY ? fmtY(v) : v);
		const at = (i) => colors[i % colors.length];

		const base = {
			color: colors,
			textStyle: { fontFamily: t.font, color: t.text },
			animationDuration: 500,
			animationDurationUpdate: 300,
			animationEasing: "cubicOut",
			tooltip: {
				confine: true,
				backgroundColor: t.surface,
				borderColor: t.border,
				borderWidth: 1,
				padding: [8, 12],
				textStyle: { color: t.textStrong, fontFamily: t.font, fontSize: 12 },
				extraCssText: `border-radius: ${t.radius + 2}px; box-shadow: 0 6px 16px rgb(0 0 0 / .12);`,
			},
		};

		if (type === "pie" || type === "donut" || type === "percentage") {
			const values = (datasets[0] && datasets[0].values) || [];
			const { labels: L, values: V } = collapseSlices(labels, values, args.maxSlices);
			const total = V.reduce((s, v) => s + (Number(v) || 0), 0) || 1;
			const pct = (v) => Math.round(((Number(v) || 0) / total) * 100);
			if (type === "percentage") {
				/* one horizontal stacked bar */
				return Object.assign(base, {
					grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: false },
					legend: legendBox(t, { bottom: 0, left: "center", formatter: (name) => (R ? `${name}  ${pct(V[L.indexOf(name)])}%` : name) }),
					xAxis: { type: "value", show: false, max: total },
					yAxis: { type: "category", data: [""], show: false },
					tooltip: Object.assign({}, base.tooltip, { trigger: "item", formatter: (p) => `${p.seriesName}: <b>${fmt(p.value)}</b> (${pct(p.value)}%)` }),
					series: L.map((name, i) => ({
						name, type: "bar", stack: "p", data: [V[i]], barWidth: 28,
						itemStyle: { borderRadius: i === 0 ? [t.radius, 0, 0, t.radius] : i === L.length - 1 ? [0, t.radius, t.radius, 0] : 0 },
						label: R ? { show: true, color: "#fff", fontSize: 11, formatter: (p) => (pct(p.value) >= 10 ? `${pct(p.value)}%` : "") } : undefined,
						emphasis: { focus: "series" },
					})),
				});
			}
			const donut = type === "donut";
			const lay = pieLayout(args, L, rtl, R);
			const cx = lay.center[0], cy = lay.center[1];
			return Object.assign(base, {
				legend: legendBox(t, Object.assign({ formatter: (name) => (R ? `${name}  ${pct(V[L.indexOf(name)])}%` : name) }, lay.legend)),
				title: donut && R ? {
					text: shorten(total), subtext: __("Total"), left: cx, top: cy, textAlign: "center", textVerticalAlign: "middle",
					itemGap: 2, textStyle: { color: t.textStrong, fontSize: 18, fontWeight: 600, fontFamily: t.font },
					subtextStyle: { color: t.muted, fontSize: 11, fontFamily: t.font },
				} : undefined,
				tooltip: Object.assign({}, base.tooltip, { trigger: "item", formatter: (p) => `${p.name}: <b>${fmt(p.value)}</b> (${p.percent}%)` }),
				series: [{
					type: "pie",
					radius: donut ? [Math.round(lay.r * 0.66), lay.r] : lay.r,
					center: lay.center,
					padAngle: R ? 2 : 0,
					data: L.map((name, i) => ({ name, value: V[i] })),
					label: R ? { show: true, position: "inside", color: "#fff", fontSize: 11, fontWeight: 500, formatter: (p) => (p.percent >= 8 ? `${Math.round(p.percent)}%` : "") } : { show: false },
					labelLayout: { hideOverlap: true },
					itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: R ? 6 : 3 },
					emphasis: { scale: true, scaleSize: 6, itemStyle: { shadowBlur: 12, shadowColor: "rgba(0,0,0,.18)" }, label: { fontSize: 12, fontWeight: 600 } },
				}],
			});
		}

		/* ---- Part-of-whole families the theme adds ---------------------- */
		if (["funnel", "treemap", "sunburst", "rose", "gauge"].includes(type)) {
			const values = (datasets[0] && datasets[0].values) || [];
			const { labels: L, values: V } = collapseSlices(labels, values.map((v) => Number(v) || 0), args.maxSlices || 9);
			const total = V.reduce((s, v) => s + v, 0) || 1;
			const items = L.map((name, i) => ({ name, value: V[i] }));
			const itemTip = Object.assign({}, base.tooltip, { trigger: "item", formatter: (p) => `${p.name}: <b>${fmt(p.value)}</b>${p.percent !== undefined ? ` (${p.percent}%)` : ` (${Math.round((p.value / total) * 100)}%)`}` });
			if (type === "funnel") {
				/* labels beside the bands (inside, the narrow ones were cut) */
				return Object.assign(base, {
					tooltip: itemTip,
					series: [{
						type: "funnel", sort: "descending", gap: 2, top: 8, bottom: 8, left: rtl ? "42%" : "4%", width: "54%",
						minSize: "14%", data: items,
						label: { show: true, position: rtl ? "left" : "right", color: t.text, fontSize: 11, formatter: (p) => `${p.name}  ${Math.round((p.value / total) * 100)}%` },
						labelLine: { length: 12, lineStyle: { color: t.border } },
						itemStyle: { borderColor: t.surface, borderWidth: 2 },
						emphasis: { label: { fontSize: 12, color: t.textStrong } },
					}],
				});
			}
			if (type === "treemap") {
				return Object.assign(base, {
					tooltip: itemTip,
					series: [{
						type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false },
						left: 0, right: 0, top: 0, bottom: 0,
						data: items.map((it, i) => Object.assign(it, { itemStyle: { color: at(i) } })),
						label: { show: true, color: "#fff", fontSize: 12, formatter: (p) => `${p.name}\n${shorten(p.value)}` },
						itemStyle: { borderColor: t.surface, borderWidth: 2, gapWidth: 2, borderRadius: R ? 4 : 0 },
					}],
				});
			}
			if (type === "sunburst") {
				return Object.assign(base, {
					tooltip: itemTip,
					series: [{
						type: "sunburst", radius: ["22%", "88%"], sort: "desc",
						data: items.map((it, i) => Object.assign(it, { itemStyle: { color: at(i) } })),
						label: { rotate: "tangential", color: "#fff", fontSize: 11, minAngle: 12 },
						itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: R ? 4 : 0 },
						emphasis: { focus: "ancestor" },
					}],
				});
			}
			if (type === "rose") {
				return Object.assign(base, {
					tooltip: itemTip,
					legend: legendBox(t, Object.assign({ formatter: (name) => (R ? `${name}  ${pctOf(V[L.indexOf(name)], total)}%` : name) }, pieLayout(args, L, rtl, R).legend)),
					series: [{
						type: "pie", roseType: "radius", radius: [Math.round(pieLayout(args, L, rtl, R).r * 0.18), pieLayout(args, L, rtl, R).r], center: pieLayout(args, L, rtl, R).center,
						data: items, label: { show: false },
						itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: R ? 6 : 3 },
						emphasis: { scale: true, scaleSize: 6 },
					}],
				});
			}
			/* gauge: the first slice against the total (a single value fills it) */
			const value = V[0] || 0;
			const max = L.length > 1 ? total : Math.max(value, 1);
			return Object.assign(base, {
				tooltip: Object.assign({}, base.tooltip, { trigger: "item", formatter: () => `${L[0] || ""}: <b>${fmt(value)}</b>` }),
				series: [{
					type: "gauge", startAngle: 200, endAngle: -20, min: 0, max, radius: "100%", center: ["50%", "62%"],
					progress: { show: true, roundCap: true, width: 14, itemStyle: { color: at(0) } },
					axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, t.grid]] } },
					axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false },
					title: { show: !!L[0], offsetCenter: [0, "30%"], color: t.muted, fontSize: 12, fontFamily: t.font },
					detail: { valueAnimation: true, offsetCenter: [0, "-6%"], color: t.textStrong, fontSize: 22, fontWeight: 600, fontFamily: t.font, formatter: (v) => shorten(v) },
					data: [{ value, name: L[0] || "" }],
				}],
			});
		}

		/* ---- Radar: labels as spokes, one polygon per series --------------- */
		if (type === "radar") {
			const max = Math.max(1, ...datasets.flatMap((ds) => (ds.values || []).map((v) => Number(v) || 0))) * 1.1;
			return Object.assign(base, {
				tooltip: Object.assign({}, base.tooltip, { trigger: "item" }),
				legend: datasets.length > 1 ? legendBox(t, { top: 0, left: "center" }) : undefined,
				radar: {
					indicator: labels.map((name) => ({ name, max })),
					radius: "66%", center: ["50%", "54%"],
					axisName: { color: t.text, fontSize: 11 },
					splitLine: { lineStyle: { color: t.grid } }, splitArea: { areaStyle: { color: ["transparent", withAlpha(t.grid, 0.35)] } },
					axisLine: { lineStyle: { color: t.grid } },
				},
				series: [{
					type: "radar",
					data: datasets.map((ds, i) => ({ name: ds.name || `${__("Series")} ${i + 1}`, value: (ds.values || []).map((v) => Number(v) || 0), areaStyle: { opacity: 0.15 }, lineStyle: { width: 2 }, symbolSize: 5 })),
				}],
			});
		}

		/* Cartesian: bar / line / axis-mixed / area / stacked-bar / horizontal-bar / scatter */
		const horizontal = type === "horizontal-bar";
		const isArea = type === "area";
		const isScatter = type === "scatter";
		const stacked = Boolean(args.barOptions?.stacked) || type === "stacked-bar" || (isArea && datasets.length > 1);
		const regionFill = Boolean(args.lineOptions?.regionFill);
		const hideDots = Boolean(args.lineOptions?.hideDots);
		const smooth = Boolean(args.lineOptions?.spline);
		const isLineChart = type === "line";
		const many = labels.length > 12;
		const single = datasets.length === 1;
		const long = labels.length > 24;

		const series = datasets.map((ds, i) => {
			let kind = type === "axis-mixed" ? (ds.chartType || "line") : type;
			if (isArea) kind = "line";
			if (type === "stacked-bar" || horizontal) kind = "bar";
			const values = (ds.values || []).map((v) => (v === null || v === undefined ? null : Number(v)));
			const color = at(i);
			const common = { name: ds.name || `${__("Series")} ${i + 1}`, data: values };
			if (isScatter) {
				return Object.assign(common, {
					type: "scatter", symbolSize: 11,
					itemStyle: { color: withAlpha(color, 0.85), borderColor: color, borderWidth: 1 },
					emphasis: { focus: datasets.length > 1 ? "series" : "none", scale: 1.3 },
				});
			}
			if (kind === "line") {
				const s = Object.assign(common, {
					type: "line",
					smooth: R ? 0.35 : smooth,
					showSymbol: !hideDots && !many,
					symbol: "circle", symbolSize: args.lineOptions?.dotSize || 6,
					lineStyle: { width: R ? 2.5 : 2 },
					areaStyle: regionFill || isArea || (R && !stacked && single)
						? { color: R ? vertical(withAlpha(color, isArea ? 0.45 : 0.3), withAlpha(color, isArea ? 0.12 : 0.02)) : undefined, opacity: R ? 1 : 0.12 }
						: undefined,
					stack: stacked ? "s" : undefined,
					connectNulls: true,
					emphasis: { focus: datasets.length > 1 ? "series" : "none" },
				});
				/* elements the design asks for: the peak and the average, on a
				 * single line with enough points to mean it (a "min" marker
				 * would sit on the axis for most business series) */
				if (R && single && !stacked && values.filter((v) => v !== null).length >= 6) {
					s.markPoint = {
						symbol: "circle", symbolSize: 12, silent: true,
						itemStyle: { color: t.surface, borderColor: color, borderWidth: 2 },
						label: { color: t.textStrong, fontSize: 10, fontWeight: 600, position: "top", formatter: (p) => shorten(p.value) },
						data: [{ type: "max", name: __("Max") }],
					};
					s.markLine = {
						silent: true, symbol: "none",
						lineStyle: { type: "dashed", color: t.muted, width: 1 },
						label: { color: t.muted, fontSize: 10, position: rtl ? "insideStartTop" : "insideEndTop", formatter: (p) => `${__("Avg")} ${shorten(p.value)}` },
						data: [{ type: "average", name: __("Avg") }],
					};
				}
				return s;
			}
			const last = i === datasets.length - 1;
			return Object.assign(common, {
				type: "bar",
				stack: stacked ? "s" : undefined,
				barMaxWidth: 40, barCategoryGap: "38%",
				itemStyle: {
					borderRadius: !stacked || last ? (horizontal ? (rtl ? [t.radius, 0, 0, t.radius] : [0, t.radius, t.radius, 0]) : [t.radius, t.radius, 0, 0]) : 0,
					color: R ? (horizontal ? new echarts.graphic.LinearGradient(rtl ? 1 : 0, 0, rtl ? 0 : 1, 0, [{ offset: 0, color: withAlpha(color, 0.62) }, { offset: 1, color }]) : vertical(color, withAlpha(color, 0.62))) : undefined,
				},
				showBackground: R && single && !stacked,
				backgroundStyle: { color: t.grid, opacity: 0.45, borderRadius: horizontal ? [0, t.radius, t.radius, 0] : [t.radius, t.radius, 0, 0] },
				label: R && single && !stacked && !many
					? { show: true, position: horizontal ? (rtl ? "left" : "right") : "top", color: t.text, fontSize: 11, formatter: (p) => (p.value ? shorten(p.value) : "") }
					: undefined,
				emphasis: { focus: datasets.length > 1 ? "series" : "none", itemStyle: { shadowBlur: 8, shadowColor: withAlpha(color, 0.35) } },
			});
		});

		/* Frappe's markers/regions become markLine / markArea on the first series */
		if (series.length && data.yMarkers?.length) {
			const ml = series[0].markLine || { silent: true, symbol: "none", data: [] };
			ml.data = (ml.data || []).concat(data.yMarkers.map((m) => ({ yAxis: m.value, name: m.label, lineStyle: { color: t.muted, type: "dashed" }, label: { color: t.muted, fontSize: 11, formatter: (p) => p.name } })));
			series[0].markLine = ml;
		}
		if (series.length && data.yRegions?.length) {
			series[0].markArea = { silent: true, itemStyle: { color: t.grid, opacity: 0.35 }, data: data.yRegions.map((r) => [{ yAxis: r.start, name: r.label }, { yAxis: r.end }]) };
		}
		/* annotations (Themate Chart Annotation): a dashed vertical line on the
		 * period that holds the date, its label along the top */
		if (series.length && !horizontal && args.tm_annotations?.length && args.tm_timeseries) {
			const marks = args.tm_annotations
				.map((a) => ({ a, i: periodIndex(labels, a.date, args.tm_interval) }))
				.filter((x) => x.i >= 0)
				.map(({ a, i }) => ({
					xAxis: labels[i], name: a.label,
					lineStyle: { color: a.color || t.textStrong, type: "dashed", width: 1.5 },
					label: { show: true, position: "insideEndTop", rotate: 0, color: a.color || t.textStrong, fontSize: 11, formatter: () => a.label, backgroundColor: t.surface, padding: [2, 5], borderRadius: 3, borderColor: t.border, borderWidth: 1 },
					tooltip: { formatter: () => `<b>${a.label}</b><br>${frappe.datetime.str_to_user(a.date)}${a.note ? `<br><span style="color:${t.muted}">${a.note}</span>` : ""}` },
					emphasis: { disabled: true },
				}));
			if (marks.length) {
				const ml = series[0].markLine || { silent: false, symbol: "none", data: [] };
				ml.silent = false;
				ml.symbol = "none";
				ml.data = (ml.data || []).concat(marks);
				series[0].markLine = ml;
			}
		}

		const hasLegend = datasets.length > 1;
		const hasToolbox = R;
		const hasPeak = series.some((sr) => sr.markPoint);
		const headRoom = (hasLegend || hasToolbox ? 36 : 12) + (hasPeak ? 16 : 0); /* the peak label sits under the toolbox */
		const zoom = R && long;

		const categoryAxis = {
			type: "category", data: labels, boundaryGap: !(isLineChart || isArea),
			inverse: horizontal, /* first label at the top */
			axisLine: { lineStyle: { color: t.grid } }, axisTick: { show: false },
			axisLabel: { color: t.text, fontSize: 11, hideOverlap: true, interval: many && !horizontal ? "auto" : 0, rotate: labels.length > 16 && !zoom && !horizontal ? 35 : 0 },
		};
		const valueAxis = {
			type: "value",
			position: rtl && !horizontal ? "right" : undefined,
			inverse: horizontal && rtl,
			splitLine: { lineStyle: { color: t.grid, type: R ? "dashed" : "solid" } },
			axisLine: { show: false }, axisTick: { show: false },
			axisLabel: { color: t.text, fontSize: 11, formatter: (v) => (args.axisOptions?.shortenYAxisNumbers ? shorten(v) : v) },
		};
		if (horizontal) {
			return Object.assign(base, {
				grid: { left: rtl ? 12 : 8, right: rtl ? 8 : 24, top: headRoom, bottom: 6, containLabel: true },
				legend: hasLegend ? legendBox(t, Object.assign({ top: 0 }, rtl ? { right: 0, left: 110 } : { left: 0, right: 110 })) : undefined,
				toolbox: toolbox(t, args, false),
				tooltip: Object.assign({}, base.tooltip, { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: t.grid, opacity: 0.5 } } }),
				xAxis: valueAxis,
				yAxis: categoryAxis,
				series,
			});
		}

		return Object.assign(base, {
			grid: { left: 8, right: 12, top: headRoom, bottom: zoom ? 34 : 6, containLabel: true },
			legend: hasLegend ? legendBox(t, Object.assign({ top: 0 }, rtl ? { right: 0, left: 110 } : { left: 0, right: 110 })) : undefined,
			toolbox: isScatter ? undefined : toolbox(t, args, isLineChart || isArea),
			dataZoom: zoom ? [
				{ type: "inside", zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false, moveOnMouseMove: true },
				{
					type: "slider", height: 16, bottom: 6, brushSelect: false, showDetail: false,
					borderColor: t.grid, backgroundColor: "transparent", fillerColor: withAlpha(t.brand, 0.12),
					dataBackground: { lineStyle: { color: t.grid }, areaStyle: { color: t.grid, opacity: 0.5 } },
					selectedDataBackground: { lineStyle: { color: t.brand }, areaStyle: { color: withAlpha(t.brand, 0.2) } },
					handleStyle: { color: t.surface, borderColor: t.border }, moveHandleSize: 0,
				},
			] : undefined,
			tooltip: Object.assign({}, base.tooltip, {
				trigger: "axis",
				axisPointer: { type: isLineChart ? "line" : "shadow", lineStyle: { color: t.border }, shadowStyle: { color: t.grid, opacity: 0.5 } },
				formatter: (params) => {
					const rows = params.map((p) => `<div style="display:flex;align-items:center;gap:8px;margin-top:2px"><span style="width:8px;height:8px;border-radius:50%;background:${typeof p.color === "string" ? p.color : at(p.seriesIndex)}"></span><span>${p.seriesName}</span><b style="margin-inline-start:auto;padding-inline-start:12px">${fmt(p.value)}</b></div>`);
					if (R && stacked && params.length > 1) {
						const sum = params.reduce((s, p) => s + (Number(p.value) || 0), 0);
						rows.push(`<div style="display:flex;gap:8px;margin-top:4px;padding-top:4px;border-top:1px solid ${t.grid}"><span>${__("Total")}</span><b style="margin-inline-start:auto;padding-inline-start:12px">${fmt(sum)}</b></div>`);
					}
					const head = fmtX ? fmtX(params[0].axisValue) : params[0].axisValue;
					return `<div style="color:${t.muted};font-size:11px;margin-bottom:4px">${head}</div>${rows.join("")}`;
				},
			}),
			xAxis: categoryAxis,
			yAxis: Object.assign(valueAxis, { position: rtl ? "right" : "left" }),
			series,
		});
	}

	/* The index of the period a date falls in, from Frappe's category labels
	 * (dateutils.get_period): "Sep 2025", "Quarter 3 2025", "2025", or a
	 * user-formatted day for Daily / Weekly. -1 when the date is outside. */
	const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	function periodStart(label, interval) {
		if (interval === "Monthly") {
			const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec(String(label).trim());
			if (!m) return null;
			const mi = MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
			return mi < 0 ? null : `${m[2]}-${String(mi + 1).padStart(2, "0")}-01`;
		}
		if (interval === "Quarterly") {
			const m = /(\d)\s+(\d{4})$/.exec(String(label).trim());
			return m ? `${m[2]}-${String((Number(m[1]) - 1) * 3 + 1).padStart(2, "0")}-01` : null;
		}
		if (interval === "Yearly") {
			const m = /^(\d{4})$/.exec(String(label).trim());
			return m ? `${m[1]}-01-01` : null;
		}
		try {
			const d = frappe.datetime.user_to_str(String(label).trim());
			return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
		} catch (e) {
			return null;
		}
	}
	function periodIndex(labels, date, interval) {
		const starts = labels.map((l) => periodStart(l, interval));
		let found = -1;
		starts.forEach((st, i) => {
			if (st && st <= date) found = i;
		});
		if (found === -1) return -1;
		/* a date after the last period's end is outside */
		const last = starts[starts.length - 1];
		if (found === starts.length - 1 && last) {
			const end = new Date(last);
			if (interval === "Monthly") end.setMonth(end.getMonth() + 1);
			else if (interval === "Quarterly") end.setMonth(end.getMonth() + 3);
			else if (interval === "Yearly") end.setFullYear(end.getFullYear() + 1);
			else end.setDate(end.getDate() + (interval === "Weekly" ? 7 : 1));
			if (new Date(date) >= end) return -1;
		}
		return found;
	}

	/* every live chart, so a palette change (themate:charts) redraws them */
	const live = new Set();
	document.addEventListener("themate:charts", () => live.forEach((c) => c.render()));

	class ThemateChart {
		constructor(parent, args) {
			this.parent = typeof parent === "string" ? document.querySelector(parent) : parent;
			this.args = args || {};
			this.el = document.createElement("div");
			this.el.className = "tm-chart";
			/* fills the card (components/_charts.scss); never shorter than asked */
			this.el.style.minHeight = `${this.args.height || 240}px`;
			this.el.style.width = "100%";
			this.empty = document.createElement("div");
			this.empty.className = "tm-chart-empty";
			this.empty.hidden = true;
			this.empty.innerHTML = `<span class="tm-chart-empty-icon" aria-hidden="true"></span><span>${__("No data to show")}</span>`;
			this.parent.innerHTML = "";
			this.parent.appendChild(this.el);
			this.parent.appendChild(this.empty);
			this.instance = echarts.init(this.el, null, { renderer: "canvas" });
			live.add(this);
			this.render();
			this.loadAnnotations();
			this.observer = new ResizeObserver(() => {
				if (!this.instance) return;
				this.instance.resize();
				/* the part-of-whole types lay the legend out from the size */
				if (["pie", "donut", "rose"].includes(this.args.type) && (this.el.clientWidth !== this.args._w || this.el.clientHeight !== this.args._h)) this.render();
			});
			this.observer.observe(this.el);
			/* light/dark switch re-reads the tokens */
			this.mo = new MutationObserver(() => this.render());
			this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		}

		render() {
			if (!this.instance) return;
			const empty = isEmpty(this.args.data);
			this.empty.hidden = !empty;
			this.el.classList.toggle("tm-chart-is-empty", empty);
			if (empty) {
				this.instance.clear();
				return;
			}
			try {
				this.args._w = this.el.clientWidth || this.instance.getWidth();
				this.args._h = this.el.clientHeight || this.instance.getHeight();
				this.instance.setOption(buildOption(this.args), { notMerge: true });
			} catch (e) {
				console.warn("[themate] chart render failed:", e);
			}
		}

		update(data) {
			this.args.data = data;
			this.render();
		}

		/* the chart's own marks and the company-wide ones; drawn on the next render */
		loadAnnotations() {
			if (!this.args.tm_chart || !this.args.tm_timeseries || !frappe.xcall) return;
			frappe.xcall("themate.api.get_chart_annotations", { chart: this.args.tm_chart })
				.then((rows) => {
					this.args.tm_annotations = rows || [];
					if (this.args.tm_annotations.length) this.render();
				})
				.catch(() => {});
		}

		destroy() {
			live.delete(this);
			this.observer?.disconnect();
			this.mo?.disconnect();
			this.instance?.dispose();
			this.instance = null;
		}

		export() {
			if (!this.instance) return;
			const a = document.createElement("a");
			a.href = this.instance.getDataURL({ pixelRatio: 2, backgroundColor: theme().surface });
			a.download = `${(this.args.title || "chart").replace(/\s+/g, "-")}.png`;
			a.click();
		}
	}

	window.themate = window.themate || {};
	window.themate.charts = { Chart: ThemateChart, buildOption, palette, isEmpty };
})();

#!/usr/bin/env bash
# Rebuilds themate/public/js/vendor/echarts.custom.js — a tree-shaken ECharts
# (Apache-2.0) with bar, line, pie, scatter, radar, funnel, gauge, treemap
# and sunburst plus the components charts/adapter.js uses: grid, tooltip, legend, mark line/area/point, data zoom (inside +
# slider), toolbox (bar/line switch, zoom, restore, save as image), title
# (donut centre) and the label-layout / universal-transition features.
# Loaded lazily by core/charts.js through themate-charts.bundle.js, so the
# desk bundle stays small. Measured at 6.1.0: see HANDOFF.md for the size.
# Pass a directory as $1 to reuse an existing npm install (offline).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
if [ -n "${1:-}" ]; then
  WORK="$1"; mkdir -p "$WORK"
else
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
fi
cd "$WORK"
cat > package.json <<'JSON'
{ "name": "themate-echarts-build", "private": true, "dependencies": { "echarts": "6.1.0" } }
JSON
[ -d node_modules/echarts ] || npm install --no-audit --no-fund --silent
cat > entry.js <<'JS'
import * as echarts from "echarts/core";
import {
  BarChart, LineChart, PieChart, ScatterChart, RadarChart, FunnelChart,
  GaugeChart, TreemapChart, SunburstChart,
} from "echarts/charts";
import {
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  MarkLineComponent, MarkAreaComponent, MarkPointComponent,
  DataZoomInsideComponent, DataZoomSliderComponent, ToolboxComponent,
  RadarComponent, VisualMapComponent,
} from "echarts/components";
import { LabelLayout, UniversalTransition } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([
  BarChart, LineChart, PieChart, ScatterChart, RadarChart, FunnelChart,
  GaugeChart, TreemapChart, SunburstChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  MarkLineComponent, MarkAreaComponent, MarkPointComponent,
  DataZoomInsideComponent, DataZoomSliderComponent, ToolboxComponent,
  RadarComponent, VisualMapComponent,
  LabelLayout, UniversalTransition, CanvasRenderer,
]);
window.echarts = echarts;
JS
ESBUILD="$APP/../frappe/node_modules/.bin/esbuild"
"$ESBUILD" entry.js --bundle --minify --format=iife --target=es2017 --outfile="$APP/themate/public/js/vendor/echarts.custom.js"
cp node_modules/echarts/LICENSE "$APP/themate/public/js/vendor/echarts.LICENSE"
ls -la "$APP/themate/public/js/vendor/"

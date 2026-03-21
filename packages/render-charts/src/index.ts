import * as echarts from "echarts";

import type { ChartSpec } from "@basquio/types";

type ChartRenderTheme = {
  background?: string;
  surface?: string;
  text?: string;
  mutedText?: string;
  accent?: string;
  accentMuted?: string;
  highlight?: string;
  border?: string;
  headingFont?: string;
  bodyFont?: string;
};

export function selectChartRenderMode(chart: ChartSpec) {
  if (chart.editableInPptx && ["line", "bar", "stacked-bar", "area", "pie", "combo"].includes(chart.family)) {
    return "editable-pptx" as const;
  }

  return "echarts-svg" as const;
}

export function renderChartSvg(
  chart: ChartSpec,
  records: Array<Record<string, unknown>> = [],
  width = 960,
  height = 540,
  theme: ChartRenderTheme = {},
) {
  if (chart.family === "table") {
    return createFallbackSvg("Table rendering will bind through the HTML/PDF path.");
  }

  const palette = resolveTheme(theme);
  const dataset = records.length > 0 ? records : createChartRecords(chart);
  const categories = chart.categories.length > 0
    ? chart.categories
    : chart.xKey
      ? dataset.map((record) => String(record[chart.xKey!] ?? ""))
      : chart.series.map((series) => series.name);

  const instance = echarts.init(null, undefined, {
    renderer: "svg",
    ssr: true,
    width,
    height,
  });

  instance.setOption({
    backgroundColor: palette.background,
    title: {
      text: chart.title || chart.id,
      subtext: chart.summary || chart.annotation || "",
      left: 24,
      top: 16,
      textStyle: {
        color: palette.text,
        fontFamily: palette.headingFont,
        fontSize: 18,
        fontWeight: "bold",
      },
      subtextStyle: {
        color: palette.mutedText,
        fontFamily: palette.bodyFont,
        fontSize: 11,
      },
    },
    legend: {
      top: 18,
      right: 24,
      textStyle: {
        color: palette.mutedText,
        fontFamily: palette.bodyFont,
      },
    },
    grid: {
      top: 92,
      right: 28,
      bottom: 60,
      left: 64,
      containLabel: true,
    },
    xAxis: {
      type: chart.family === "pie" ? undefined : "category",
      data: categories.length > 0 ? categories : dataset.map((record) => String(record.label ?? "")),
      axisLine: chart.family === "pie" ? undefined : { lineStyle: { color: palette.border } },
      axisLabel: chart.family === "pie" ? undefined : {
        color: palette.mutedText,
        fontFamily: palette.bodyFont,
        width: 120,
        overflow: "truncate",
      },
    },
    yAxis: chart.family === "pie" ? undefined : {
      type: "value",
      axisLine: { show: false },
      splitLine: { lineStyle: { color: palette.border, opacity: 0.5 } },
      axisLabel: {
        color: palette.mutedText,
        fontFamily: palette.bodyFont,
      },
    },
    series:
      chart.family === "pie"
        ? [
            {
              name: chart.title || chart.id,
              type: "pie",
              radius: "62%",
              data: dataset.map((record) => ({
                name: String(record.label ?? "Value"),
                value: Number(record.value ?? 0),
              })),
              label: {
                color: palette.text,
                fontFamily: palette.bodyFont,
              },
              labelLine: {
                lineStyle: {
                  color: palette.border,
                },
              },
            },
          ]
        : chart.series.map((series) => ({
            name: series.name,
            type: mapSeriesType(chart.family),
            smooth: chart.family === "line" || chart.family === "area",
            stack: chart.family === "stacked-bar" ? "total" : undefined,
            areaStyle: chart.family === "area" ? { opacity: 0.18 } : undefined,
            data: dataset.map((record, index) => Number(record[series.dataKey] ?? chart.series[0]?.values[index] ?? record.value ?? 0)),
            itemStyle: {
              color: pickSeriesColor(indexOfSeries(chart, series), palette),
              borderRadius: chart.family === "bar" || chart.family === "stacked-bar" ? [6, 6, 0, 0] : 0,
            },
            lineStyle: {
              width: chart.family === "line" || chart.family === "area" ? 3 : undefined,
              color: pickSeriesColor(indexOfSeries(chart, series), palette),
            },
            emphasis: {
              focus: "series",
            },
          })),
  });

  const svg = instance.renderToSVGString();
  instance.dispose();

  return svg;
}

function mapSeriesType(family: ChartSpec["family"]) {
  switch (family) {
    case "line":
      return "line";
    case "area":
      return "line";
    case "scatter":
      return "scatter";
    case "pie":
      return "pie";
    default:
      return "bar";
  }
}

function createChartRecords(chart: ChartSpec) {
  const categories = chart.categories.length > 0 ? chart.categories : chart.series.map((series) => series.name);
  return categories.map((label, index) => {
    const record: Record<string, unknown> = {
      label,
      value: chart.series[0]?.values[index] ?? 0,
    };

    chart.series.forEach((series) => {
      record[series.dataKey] = series.values[index] ?? 0;
    });

    return record;
  });
}

function createFallbackSvg(message: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="100%" height="100%" fill="#F8FAFC"/><text x="48" y="120" font-size="28" font-family="Arial" fill="#0F172A">${message}</text></svg>`;
}

function resolveTheme(theme: ChartRenderTheme) {
  return {
    background: theme.background ?? "#FFFFFF",
    surface: theme.surface ?? "#FFFFFF",
    text: theme.text ?? "#0F172A",
    mutedText: theme.mutedText ?? "#475569",
    accent: theme.accent ?? "#2563EB",
    accentMuted: theme.accentMuted ?? "#DBEAFE",
    highlight: theme.highlight ?? "#F0CC27",
    border: theme.border ?? "#CBD5E1",
    headingFont: theme.headingFont ?? "Arial",
    bodyFont: theme.bodyFont ?? "Arial",
  };
}

function pickSeriesColor(index: number, theme: ReturnType<typeof resolveTheme>) {
  const palette = [theme.accent, theme.highlight, theme.accentMuted, "#0EA5E9", "#14B8A6"];
  return palette[index % palette.length];
}

function indexOfSeries(chart: ChartSpec, series: ChartSpec["series"][number]) {
  return Math.max(0, chart.series.findIndex((candidate) => candidate.name === series.name));
}

// ─── V2 CHART ROW RENDERER (pixel-perfect image charts) ─────────
//
// Converts V2ChartRow (the pipeline's chart format) into an ECharts SVG
// string, styled with brand tokens from the PPTX design system.
// The SVG is then converted to PNG by the PPTX renderer and embedded
// as an image — giving pixel-perfect charts with universal compatibility.

export type V2ChartImageTheme = {
  background: string;     // e.g. "#0A090D" (dark) or "#FFFFFF" (light)
  cardBg: string;         // e.g. "#16151E" — chart card background
  ink: string;            // primary text
  muted: string;          // axis labels, legend
  dim: string;            // grid lines
  border: string;         // axis lines
  chartPalette: string[]; // 8-color palette
  headingFont: string;
  bodyFont: string;
};

export type V2ChartRow = {
  id: string;
  chartType: string;
  title: string;
  data: Record<string, unknown>[];
  xAxis: string;
  yAxis: string;
  series: string[];
  style: {
    colors?: string[];
    showLegend?: boolean;
    showValues?: boolean;
    highlightCategories?: string[];
  };
  intent?: string;
  unit?: string;
  benchmarkLabel?: string;
  benchmarkValue?: number;
  sourceNote?: string;
};

/**
 * Render a V2ChartRow as a pixel-perfect SVG string using ECharts SSR.
 * No canvas required — works in Node.js serverless (Vercel).
 *
 * @param chart - V2ChartRow from the pipeline
 * @param theme - Brand tokens from the PPTX design system
 * @param width - Chart width in pixels (2x for retina)
 * @param height - Chart height in pixels (2x for retina)
 * @param suppressTitle - If true, suppresses the chart title (when it duplicates slide title)
 */
export function renderV2ChartSvg(
  chart: V2ChartRow,
  theme: V2ChartImageTheme,
  width = 960,
  height = 540,
  suppressTitle = false,
): string {
  if (chart.chartType === "table") {
    return createFallbackSvg("Table data — see slide");
  }
  if (!chart.data?.length) {
    return createFallbackSvg("No data available");
  }

  const palette = chart.style.colors?.map(c => c.startsWith("#") ? c : `#${c}`) ?? theme.chartPalette.map(c => c.startsWith("#") ? c : `#${c}`);
  const bg = theme.cardBg.startsWith("#") ? theme.cardBg : `#${theme.cardBg}`;
  const ink = theme.ink.startsWith("#") ? theme.ink : `#${theme.ink}`;
  const muted = theme.muted.startsWith("#") ? theme.muted : `#${theme.muted}`;
  const dim = theme.dim.startsWith("#") ? theme.dim : `#${theme.dim}`;
  const border = theme.border.startsWith("#") ? theme.border : `#${theme.border}`;

  // Extract categories from xAxis field
  const categories = chart.data.map(row => String(row[chart.xAxis] ?? "")).filter(Boolean);

  // Determine chart type mapping
  const echartsType = mapV2ChartType(chart.chartType);
  const isPie = chart.chartType === "pie" || chart.chartType === "doughnut";
  const isHorizontal = chart.chartType === "horizontal_bar";
  const isStacked = chart.chartType === "stacked_bar" || chart.chartType === "stacked_bar_100";

  // Build series data
  const seriesNames = chart.series.length > 0
    ? chart.series
    : chart.yAxis ? [chart.yAxis] : [];

  // Detect percentage data for y-axis formatting
  const isPercentage = (chart.unit ?? "").includes("%") ||
    chart.chartType === "stacked_bar_100" ||
    chart.title.toLowerCase().includes("share") ||
    chart.title.toLowerCase().includes("quota");

  // Format numbers based on unit/intent
  const formatValue = (v: number): string => {
    if (isPercentage) return `${v.toFixed(1)}%`;
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toFixed(v % 1 === 0 ? 0 : 1);
  };

  // Build ECharts series
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const echartsSeries: any[] = isPie
    ? [{
        type: "pie" as const,
        radius: chart.chartType === "doughnut" ? ["52%", "78%"] : ["0%", "70%"],
        center: ["50%", suppressTitle ? "50%" : "54%"],
        padAngle: chart.chartType === "doughnut" ? 2 : 0,
        itemStyle: {
          borderColor: bg,
          borderWidth: chart.chartType === "doughnut" ? 3 : 1,
          borderRadius: chart.chartType === "doughnut" ? 4 : 0,
        },
        data: chart.data.slice(0, 8).map((row, i) => ({ // Max 8 slices
          name: String(row[chart.xAxis] ?? `Item ${i}`),
          value: Number(row[chart.yAxis] ?? row[seriesNames[0]] ?? 0),
          itemStyle: { color: palette[i % palette.length] },
        })),
        label: {
          color: ink,
          fontFamily: theme.bodyFont,
          fontSize: 12,
          fontWeight: "bold" as const,
          formatter: (params: { name: string; percent: number; value: number }) =>
            isPercentage ? `${params.name}\n${params.percent.toFixed(1)}%` : `${params.name}\n${formatValue(params.value)}`,
          lineHeight: 16,
        },
        labelLine: { lineStyle: { color: dim, width: 1 }, length: 12, length2: 16 },
        emphasis: { itemStyle: { shadowBlur: 12, shadowColor: "rgba(0,0,0,0.4)" }, scaleSize: 4 },
      }]
    : seriesNames.map((name, seriesIdx) => {
        const data = chart.data.map(row => {
          const v = row[name];
          return typeof v === "number" ? v : parseFloat(String(v)) || 0;
        });

        // Highlight categories support
        const highlightSet = new Set(chart.style.highlightCategories ?? []);
        const hasHighlights = highlightSet.size > 0;

        return {
          name,
          type: echartsType as "bar" | "line" | "scatter",
          data: hasHighlights
            ? data.map((v, i) => ({
                value: v,
                itemStyle: {
                  color: highlightSet.has(categories[i])
                    ? palette[seriesIdx % palette.length]
                    : `${palette[seriesIdx % palette.length]}66`, // 40% opacity for non-highlighted
                },
              }))
            : data,
          stack: isStacked ? "total" : undefined,
          smooth: chart.chartType === "line" || chart.chartType === "area" ? 0.3 : undefined,
          areaStyle: chart.chartType === "area" ? {
            opacity: 0.2,
            color: {
              type: "linear", x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: `${palette[seriesIdx % palette.length]}40` },
                { offset: 1, color: `${palette[seriesIdx % palette.length]}05` },
              ],
            } as unknown as string,
          } : undefined,
          itemStyle: {
            color: palette[seriesIdx % palette.length],
            borderRadius: echartsType === "bar" ? (isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0,
          },
          lineStyle: echartsType === "line" ? {
            width: seriesIdx === 0 ? 2.5 : 1.8,
            color: palette[seriesIdx % palette.length],
            type: seriesIdx === 0 ? "solid" : seriesIdx === 1 ? "dashed" : [4, 3] as unknown as string,
          } : undefined,
          symbolSize: echartsType === "line" ? (seriesIdx === 0 ? 5 : 0) : undefined,
          symbol: echartsType === "line" ? (seriesIdx === 0 ? "circle" : "none") : undefined,
          barMaxWidth: 44,
          barGap: "20%",
          // Always show value labels on bars for consulting-grade readability
          label: echartsType === "bar" ? {
            show: true,
            position: isHorizontal ? "right" : "top",
            color: muted,
            fontFamily: theme.bodyFont,
            fontSize: 10,
            fontWeight: "bold" as const,
            formatter: (params: { value: number | number[] }) => {
              const val = Array.isArray(params.value) ? params.value[1] : params.value;
              return formatValue(val);
            },
          } : (chart.style.showValues ? {
            show: true,
            position: "top" as const,
            color: muted,
            fontFamily: theme.bodyFont,
            fontSize: 9,
            formatter: (params: { value: number | number[] }) => {
              const val = Array.isArray(params.value) ? params.value[1] : params.value;
              return formatValue(val);
            },
          } : undefined),
          emphasis: { focus: seriesNames.length > 1 ? "series" : "self" as const },
        };
      });

  // Waterfall: true bridge chart with invisible base bars
  if (chart.chartType === "waterfall" && echartsSeries.length > 0) {
    const positive = theme.chartPalette[1]?.startsWith("#") ? theme.chartPalette[1] : `#${theme.chartPalette[1] ?? "4CC9A0"}`;
    const negative = theme.chartPalette[4]?.startsWith("#") ? theme.chartPalette[4] : `#${theme.chartPalette[4] ?? "E8636F"}`;
    const total = palette[0]; // Amber for totals (first/last)
    const rawData = echartsSeries[0].data;
    if (Array.isArray(rawData)) {
      const values = rawData.map((v: number | { value: number }) =>
        typeof v === "number" ? v : (v?.value ?? 0));
      // Build invisible base series + visible delta series
      const baseData: Array<number | { value: number; itemStyle: { color: string } }> = [];
      const deltaData: Array<{ value: number; itemStyle: { color: string; borderRadius: number[] } }> = [];
      let cumulative = 0;
      for (let j = 0; j < values.length; j++) {
        const val = values[j];
        const isTotal = j === 0 || j === values.length - 1;
        if (isTotal) {
          // Total bars start from zero
          baseData.push({ value: 0, itemStyle: { color: "transparent" } });
          deltaData.push({ value: val, itemStyle: { color: total, borderRadius: [4, 4, 0, 0] } });
          cumulative = val;
        } else {
          // Delta bars float above cumulative
          const base = val >= 0 ? cumulative : cumulative + val;
          baseData.push({ value: Math.max(0, base), itemStyle: { color: "transparent" } });
          deltaData.push({
            value: Math.abs(val),
            itemStyle: {
              color: val >= 0 ? positive : negative,
              borderRadius: val >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4],
            },
          });
          cumulative += val;
        }
      }
      // Replace single series with stacked base + delta
      echartsSeries.length = 0;
      echartsSeries.push(
        { type: "bar", stack: "waterfall", data: baseData, barMaxWidth: 44, itemStyle: { color: "transparent" }, emphasis: { itemStyle: { color: "transparent" } } },
        {
          type: "bar", stack: "waterfall", data: deltaData, barMaxWidth: 44,
          label: {
            show: true, position: "top", color: muted, fontFamily: theme.bodyFont, fontSize: 10, fontWeight: "bold",
            formatter: (params: { dataIndex: number }) => {
              const v = values[params.dataIndex];
              const sign = v >= 0 ? "+" : "";
              return `${sign}${formatValue(v)}`;
            },
          },
        },
      );
    }
  }

  // Pareto: sorted bars + cumulative % line overlay
  if (chart.chartType === "pareto" && echartsSeries.length > 0) {
    const rawData = echartsSeries[0].data;
    if (Array.isArray(rawData)) {
      const values = rawData.map((v: number | { value: number }) =>
        typeof v === "number" ? v : (v?.value ?? 0));
      // Compute cumulative %
      const total = values.reduce((s, v) => s + Math.abs(v), 0);
      let cum = 0;
      const cumPct = values.map(v => { cum += Math.abs(v); return total > 0 ? (cum / total) * 100 : 0; });
      // Bar series (already sorted by planner)
      echartsSeries[0].label = {
        show: true, position: "top", color: muted, fontFamily: theme.bodyFont, fontSize: 9,
        formatter: (params: { value: number | number[] }) => {
          const val = Array.isArray(params.value) ? params.value[1] : params.value;
          return formatValue(val);
        },
      };
      // Add cumulative % line on secondary y-axis
      echartsSeries.push({
        type: "line", yAxisIndex: 1, data: cumPct, symbol: "circle", symbolSize: 4,
        lineStyle: { color: muted, width: 1.5, type: "dashed" },
        itemStyle: { color: muted },
        label: {
          show: true, position: "top", color: dim, fontFamily: theme.bodyFont, fontSize: 8,
          formatter: (params: { value: number | number[] }) => {
            const val = Array.isArray(params.value) ? params.value[1] : params.value;
            return `${val.toFixed(0)}%`;
          },
        },
      });
    }
  }

  // Benchmark reference line
  const markLine = chart.benchmarkValue != null ? {
    markLine: {
      silent: true,
      symbol: "none",
      lineStyle: { color: muted, type: "dashed" as const, width: 1.5 },
      data: [{ yAxis: chart.benchmarkValue, name: chart.benchmarkLabel ?? "Benchmark" }],
      label: {
        color: muted,
        fontFamily: theme.bodyFont,
        fontSize: 9,
        formatter: chart.benchmarkLabel ?? `Benchmark: ${chart.benchmarkValue}`,
      },
    },
  } : {};

  // Merge benchmark into first series if bar/line
  if (!isPie && echartsSeries && Array.isArray(echartsSeries) && echartsSeries.length > 0 && chart.benchmarkValue != null) {
    Object.assign(echartsSeries[0], markLine);
  }

  // Chart title — suppress if slide already shows it
  const titleConfig = suppressTitle ? {} : {
    title: {
      text: chart.title,
      left: 20,
      top: 12,
      textStyle: {
        color: ink,
        fontFamily: theme.headingFont,
        fontSize: 13,
        fontWeight: "bold" as const,
      },
    },
  };

  // Source note at bottom
  const sourceConfig = chart.sourceNote ? {
    graphic: [{
      type: "text" as const,
      left: 20,
      bottom: 6,
      style: {
        text: `Source: ${chart.sourceNote}`,
        fill: dim,
        fontFamily: theme.bodyFont,
        fontSize: 8,
      },
    }],
  } : {};

  const topMargin = suppressTitle ? 40 : 56;

  const instance = echarts.init(null, undefined, {
    renderer: "svg",
    ssr: true,
    width,
    height,
  });

  const option: Record<string, unknown> = {
    backgroundColor: bg,
    animation: false,
    ...titleConfig,
    legend: seriesNames.length > 1 && !isPie ? {
      top: suppressTitle ? 8 : 14,
      right: 20,
      textStyle: { color: muted, fontFamily: theme.bodyFont, fontSize: 10 },
      itemWidth: 12,
      itemHeight: 8,
    } : undefined,
    grid: isPie ? undefined : {
      top: topMargin,
      right: chart.chartType === "pareto" ? 48 : 24,
      bottom: chart.sourceNote ? 32 : 20,
      left: 16,
      containLabel: true,
    },
    ...(isPie ? {} : isHorizontal ? {
      xAxis: {
        type: "value",
        axisLine: { lineStyle: { color: border } },
        axisLabel: {
          color: muted,
          fontFamily: theme.bodyFont,
          fontSize: 10,
          formatter: (v: number) => formatValue(v),
        },
        splitLine: { lineStyle: { color: border, opacity: 0.35, type: "dashed" } },
      },
      yAxis: {
        type: "category",
        data: categories,
        axisLine: { lineStyle: { color: border } },
        axisLabel: {
          color: muted,
          fontFamily: theme.bodyFont,
          fontSize: 10,
          width: 120,
          overflow: "truncate",
        },
        inverse: true,
      },
    } : {
      xAxis: {
        type: "category",
        data: categories,
        axisLine: { lineStyle: { color: border } },
        axisLabel: {
          color: muted,
          fontFamily: theme.bodyFont,
          fontSize: 10,
          width: 100,
          overflow: "truncate",
          rotate: categories.length > 8 ? 30 : 0,
        },
        axisTick: { show: false },
      },
      yAxis: chart.chartType === "pareto" ? [
        {
          type: "value",
          axisLine: { show: false },
          axisLabel: { color: muted, fontFamily: theme.bodyFont, fontSize: 9, formatter: (v: number) => formatValue(v) },
          splitLine: { lineStyle: { color: border, opacity: 0.35, type: "dashed" } },
        },
        {
          type: "value", min: 0, max: 100,
          axisLine: { show: false },
          axisLabel: { color: dim, fontFamily: theme.bodyFont, fontSize: 8, formatter: (v: number) => `${v}%` },
          splitLine: { show: false },
        },
      ] : {
        type: "value",
        axisLine: { show: false },
        axisLabel: {
          color: muted,
          fontFamily: theme.bodyFont,
          fontSize: 9,
          formatter: (v: number) => formatValue(v),
        },
        splitLine: { lineStyle: { color: border, opacity: 0.35, type: "dashed" } },
      },
    }),
    series: echartsSeries,
    ...sourceConfig,
  };

  instance.setOption(option);
  const svg = instance.renderToSVGString();
  instance.dispose();

  return svg;
}

function mapV2ChartType(chartType: string): string {
  switch (chartType) {
    case "bar":
    case "grouped_bar":
    case "horizontal_bar":
    case "stacked_bar":
    case "stacked_bar_100":
    case "waterfall":
      return "bar";
    case "line":
    case "area":
      return "line";
    case "scatter":
      return "scatter";
    case "pie":
    case "doughnut":
      return "pie";
    default:
      return "bar";
  }
}

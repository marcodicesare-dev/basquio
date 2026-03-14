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

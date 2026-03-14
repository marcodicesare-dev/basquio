import * as echarts from "echarts";

import type { ChartSpec } from "@basquio/types";

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
) {
  if (chart.family === "table") {
    return createFallbackSvg("Table rendering will bind through the HTML/PDF path.");
  }

  const categories = chart.xKey
    ? records.map((record) => String(record[chart.xKey!] ?? ""))
    : chart.series.map((series) => series.name);
  const dataset = records.length > 0 ? records : createPlaceholderRecords(chart);

  const instance = echarts.init(null, undefined, {
    renderer: "svg",
    ssr: true,
    width,
    height,
  });

  instance.setOption({
    backgroundColor: "#ffffff",
    title: {
      text: chart.id,
      left: 24,
      top: 16,
      textStyle: {
        fontFamily: "Arial",
        fontSize: 18,
        fontWeight: "bold",
      },
    },
    tooltip: {
      trigger: "axis",
    },
    legend: {
      top: 16,
      right: 24,
    },
    grid: {
      top: 72,
      right: 24,
      bottom: 48,
      left: 48,
    },
    xAxis: {
      type: chart.family === "pie" ? undefined : "category",
      data: categories.length > 0 ? categories : dataset.map((record) => String(record.label ?? "")),
    },
    yAxis: chart.family === "pie" ? undefined : { type: "value" },
    series:
      chart.family === "pie"
        ? [
            {
              name: chart.id,
              type: "pie",
              radius: "62%",
              data: dataset.map((record) => ({
                name: String(record.label ?? "Value"),
                value: Number(record.value ?? 0),
              })),
            },
          ]
        : chart.series.map((series) => ({
            name: series.name,
            type: mapSeriesType(chart.family),
            smooth: chart.family === "line" || chart.family === "area",
            stack: chart.family === "stacked-bar" ? "total" : undefined,
            areaStyle: chart.family === "area" ? {} : undefined,
            data: dataset.map((record) => Number(record[series.dataKey] ?? record.value ?? 0)),
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
    case "pie":
      return "pie";
    default:
      return "bar";
  }
}

function createPlaceholderRecords(chart: ChartSpec) {
  return chart.series.map((series, index) => ({
    label: series.name,
    value: 10 + index * 5,
    [series.dataKey]: 10 + index * 5,
  }));
}

function createFallbackSvg(message: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="100%" height="100%" fill="#F8FAFC"/><text x="48" y="120" font-size="28" font-family="Arial" fill="#0F172A">${message}</text></svg>`;
}

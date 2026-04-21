#!/usr/bin/env python3

import json
import math
import sys
import unicodedata
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.chart import (
    AreaChart,
    BarChart,
    DoughnutChart,
    LineChart,
    PieChart,
    Reference,
    ScatterChart,
    Series,
)
from openpyxl.chart.label import DataLabelList
from openpyxl.utils import get_column_letter


def normalize_text(value):
    text = "" if value is None else str(value)
    normalized = unicodedata.normalize("NFD", text)
    stripped = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    lowered = stripped.lower()
    cleaned = "".join(char if char.isalnum() or char.isspace() else " " for char in lowered)
    return " ".join(cleaned.split())


def is_number(value):
    if value is None or isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return math.isfinite(value)
    return False


def build_chart(chart_type, title, x_axis_label, y_axis_label):
    normalized = (chart_type or "").strip().lower()
    if normalized == "horizontal_bar":
        chart = BarChart()
        chart.type = "bar"
        chart.grouping = "clustered"
    elif normalized == "grouped_bar":
        chart = BarChart()
        chart.type = "col"
        chart.grouping = "clustered"
    elif normalized == "stacked_bar":
        chart = BarChart()
        chart.type = "bar"
        chart.grouping = "stacked"
        chart.overlap = 100
    elif normalized == "stacked_bar_100":
        chart = BarChart()
        chart.type = "bar"
        chart.grouping = "percentStacked"
        chart.overlap = 100
    elif normalized == "line":
        chart = LineChart()
    elif normalized == "area":
        chart = AreaChart()
    elif normalized == "pie":
        chart = PieChart()
        chart.varyColors = True
    elif normalized == "doughnut":
        chart = DoughnutChart()
        chart.holeSize = 55
        chart.varyColors = True
    elif normalized == "scatter":
        chart = ScatterChart()
        chart.scatterStyle = "marker"
    else:
        chart = BarChart()
        chart.type = "col"
        chart.grouping = "clustered"

    chart.style = 10
    chart.width = 12
    chart.height = 7
    chart.title = title or "Basquio chart"

    if normalized not in {"pie", "doughnut"}:
        try:
            chart.x_axis.title = x_axis_label or ""
            chart.y_axis.title = y_axis_label or ""
        except Exception:
            pass

    try:
        chart.legend.position = "b"
    except Exception:
        pass

    if normalized in {"pie", "doughnut", "bar", "horizontal_bar", "grouped_bar", "stacked_bar", "stacked_bar_100"}:
        try:
            chart.dLbls = DataLabelList()
            chart.dLbls.showVal = True
            chart.dLbls.showLeaderLines = False
        except Exception:
            pass

    return chart


def main():
    if len(sys.argv) != 4:
        raise SystemExit("Usage: native-workbook-charts.py <input.xlsx> <spec.json> <output.xlsx>")

    input_path = Path(sys.argv[1])
    spec_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3])

    spec = json.loads(spec_path.read_text())
    workbook = load_workbook(input_path)
    per_sheet_counts = {}
    results = []

    for chart_spec in spec.get("charts", []):
        sheet_name = chart_spec.get("sheetName")
        if not sheet_name or sheet_name not in workbook.sheetnames:
            results.append({
                "chartId": chart_spec.get("chartId"),
                "sheetName": sheet_name,
                "created": False,
                "reason": "sheet_not_found",
            })
            continue

        worksheet = workbook[sheet_name]
        headers = [worksheet.cell(1, index).value for index in range(1, worksheet.max_column + 1)]
        header_to_column = {str(header): index + 1 for index, header in enumerate(headers) if header not in (None, "")}
        category_column = 1
        category_header = headers[0] if headers else "Category"
        requested_headers = [header for header in chart_spec.get("selectedHeaders", []) if header in header_to_column]
        categories = chart_spec.get("categories", []) or []
        row_lookup = {}
        for row_index in range(2, worksheet.max_row + 1):
            label = worksheet.cell(row_index, category_column).value
            normalized = normalize_text(label)
            if normalized and normalized not in row_lookup:
                row_lookup[normalized] = row_index

        selected_rows = []
        for category in categories:
            row_index = row_lookup.get(normalize_text(category))
            if row_index:
                selected_rows.append((category, row_index))

        if not selected_rows:
            selected_rows = [
                (worksheet.cell(row_index, category_column).value, row_index)
                for row_index in range(2, worksheet.max_row + 1)
                if str(worksheet.cell(row_index, category_column).value or "").strip()
            ][: min(12, max(0, worksheet.max_row - 1))]

        if not selected_rows:
            results.append({
                "chartId": chart_spec.get("chartId"),
                "sheetName": sheet_name,
                "created": False,
                "reason": "no_rows",
            })
            continue

        if not requested_headers:
            numeric_headers = []
            for column_index, header in enumerate(headers[1:], start=2):
                values = [worksheet.cell(row_index, column_index).value for _, row_index in selected_rows]
                if any(is_number(value) for value in values):
                    numeric_headers.append(str(header))
            requested_headers = numeric_headers[:3]

        chart_type = (chart_spec.get("chartType") or "").strip().lower()
        if chart_type in {"pie", "doughnut"}:
            requested_headers = requested_headers[:1]
        elif chart_type == "scatter":
            requested_headers = requested_headers[:2]
        elif chart_type in {"bar", "horizontal_bar", "line", "area"}:
            requested_headers = requested_headers[:1]
        elif chart_type in {"grouped_bar", "stacked_bar", "stacked_bar_100"}:
            requested_headers = requested_headers[: min(3, len(requested_headers))]

        requested_headers = [header for header in requested_headers if header in header_to_column]
        if len(requested_headers) == 0:
            results.append({
                "chartId": chart_spec.get("chartId"),
                "sheetName": sheet_name,
                "created": False,
                "reason": "no_numeric_headers",
            })
            continue

        sheet_count = per_sheet_counts.get(sheet_name, 0)
        per_sheet_counts[sheet_name] = sheet_count + 1

        helper_start_col = worksheet.max_column + 2
        helper_start_row = 1 + (sheet_count * (len(selected_rows) + 4))
        helper_header_row = helper_start_row
        helper_data_start_row = helper_start_row + 1

        worksheet.cell(helper_header_row, helper_start_col, value=category_header or "Category")
        for offset, header in enumerate(requested_headers, start=1):
            worksheet.cell(helper_header_row, helper_start_col + offset, value=header)

        for row_offset, (category_value, source_row_index) in enumerate(selected_rows):
            target_row = helper_data_start_row + row_offset
            worksheet.cell(target_row, helper_start_col, value=category_value)
            for offset, header in enumerate(requested_headers, start=1):
                source_column = header_to_column[header]
                worksheet.cell(target_row, helper_start_col + offset, value=worksheet.cell(source_row_index, source_column).value)

        for column_offset in range(0, len(requested_headers) + 1):
            worksheet.column_dimensions[get_column_letter(helper_start_col + column_offset)].hidden = True

        chart = build_chart(
            chart_type,
            chart_spec.get("title"),
            chart_spec.get("xAxisLabel"),
            chart_spec.get("yAxisLabel"),
        )

        category_ref = Reference(
            worksheet,
            min_col=helper_start_col,
            min_row=helper_data_start_row,
            max_row=helper_data_start_row + len(selected_rows) - 1,
        )

        if chart_type == "scatter" and len(requested_headers) >= 2:
            x_ref = Reference(
                worksheet,
                min_col=helper_start_col + 1,
                min_row=helper_data_start_row,
                max_row=helper_data_start_row + len(selected_rows) - 1,
            )
            y_ref = Reference(
                worksheet,
                min_col=helper_start_col + 2,
                min_row=helper_data_start_row,
                max_row=helper_data_start_row + len(selected_rows) - 1,
            )
            scatter_series = Series(y_ref, xvalues=x_ref, title_from_data=False)
            chart.series.append(scatter_series)
        else:
            data_ref = Reference(
                worksheet,
                min_col=helper_start_col + 1,
                max_col=helper_start_col + len(requested_headers),
                min_row=helper_header_row,
                max_row=helper_data_start_row + len(selected_rows) - 1,
            )
            chart.add_data(data_ref, titles_from_data=True)
            chart.set_categories(category_ref)

        anchor_column = helper_start_col + len(requested_headers) + 2
        anchor_row = helper_start_row + 1
        anchor = f"{get_column_letter(anchor_column)}{anchor_row}"
        worksheet.add_chart(chart, anchor)

        results.append({
            "chartId": chart_spec.get("chartId"),
            "sheetName": sheet_name,
            "created": True,
            "anchor": anchor,
            "selectedHeaders": requested_headers,
            "matchedRows": len(selected_rows),
        })

    workbook.save(output_path)
    sys.stdout.write(json.dumps({"charts": results}))


if __name__ == "__main__":
    main()

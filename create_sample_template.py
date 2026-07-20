# -*- coding: utf-8 -*-
from pathlib import Path


TEMPLATE_NAME = "免疫产品_跳值问题用服工程师排查反馈表_V1.0_CN.xlsx"
SHEET_NAME = "用服工程师排查反馈表"


def main():
    try:
        from openpyxl import Workbook
    except ImportError:
        raise SystemExit("请先执行：python -m pip install -r requirements.txt")

    resources = Path(__file__).resolve().parent / "resources"
    resources.mkdir(parents=True, exist_ok=True)
    path = resources / TEMPLATE_NAME

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = SHEET_NAME

    headers = [
        "步骤",
        "优先级",
        "分类",
        "排查动作",
        "合格指标",
        "是否执行",
        "实测情况记录",
        "原始状态照片",
        "调试或维护后照片",
    ]
    sheet.append(headers)

    rows = [
        [1, "高", "数据备份", "导出位置参数", "位置参数导出成功并可追溯", "是", "记录导出路径和文件名", "N/A", "导出完成后的文件截图"],
        [2, "高", "设备周边环境检查", "检查设备水平状态", "设备水平，无明显倾斜", "是", "记录水平检查结果", "原始设备水平照片", "N/A"],
        [3, "高", "流量测试", "磁分离吸液流量", "流量测试结果在合格范围内", "是", "填写实测流量值", "测试前管路状态", "测试后结果截图"],
        [4, "中", "清洁维护", "检查清洗液管路", "管路无弯折、漏液、堵塞", "是", "记录检查情况", "管路原始状态", "维护后管路状态"],
        [5, "中", "排查后验证", "复测跳值项目", "复测结果稳定，无明显跳值", "是", "填写复测结果", "N/A", "复测结果截图"],
    ]
    for row in rows:
        sheet.append(row)

    for column in sheet.columns:
        max_length = max(len(str(cell.value or "")) for cell in column)
        sheet.column_dimensions[column[0].column_letter].width = min(max(max_length + 2, 12), 28)

    workbook.save(path)
    print("已生成示例模板：%s" % path)


if __name__ == "__main__":
    main()

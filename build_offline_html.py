"""Build the single-file frontline HTML from the current Excel catalogue."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path

import app
from template_catalog import ULTRASOUND_PROJECTS


ROOT = Path(__file__).resolve().parent
OFFLINE_HTML = ROOT / "templates" / "mobile_offline.html"


def inline_references(items):
    for item in items:
        inlined = []
        for image in item.get("reference_images") or []:
            path = ROOT / "static" / "reference" / image["name"]
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
            inlined.append(
                {
                    "name": image["name"],
                    "label": image.get("label") or "Excel参考图片",
                    "src": "data:image/jpeg;base64," + encoded,
                }
            )
        item["reference_images"] = inlined
    return items


def build_config():
    items = inline_references(app.read_excel_template())
    return {
        "appName": app.APP_NAME,
        "version": app.VERSION,
        "templateName": app.TEMPLATE_NAME,
        "packageFormatVersion": app.PACKAGE_FORMAT_VERSION,
        "zipMaxBytes": app.ZIP_MAX_BYTES,
        "maxImagesPerField": app.MAX_IMAGES_PER_FIELD,
        "maxImageSize": app.MAX_IMAGE_SIZE,
        "basicFields": app.BASIC_FIELDS,
        "ultrasoundProjects": ULTRASOUND_PROJECTS,
        "templateItems": items,
    }


def main():
    content = OFFLINE_HTML.read_text(encoding="utf-8")
    config_text = json.dumps(build_config(), ensure_ascii=True, separators=(",", ":"))
    pattern = r"window\.OFFLINE_CONFIG = \{.*?\};\s*\n\s*\(function \(\) \{\s*\n\s*const config = window\.OFFLINE_CONFIG;"
    replacement = "window.OFFLINE_CONFIG = " + config_text + ";\n\n    (function () {\n      const config = window.OFFLINE_CONFIG;"
    updated, count = re.subn(pattern, lambda _match: replacement, content, count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError("未找到 OFFLINE_CONFIG 区块，无法安全生成离线 HTML。")
    OFFLINE_HTML.write_text(updated, encoding="utf-8")
    print("built", OFFLINE_HTML, "items", len(build_config()["templateItems"]))


if __name__ == "__main__":
    main()

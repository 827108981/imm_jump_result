"""Create reproducible frontline and RTS/GTS ZIPs for release acceptance tests."""

from __future__ import annotations

import io
import json
import shutil
import zipfile
import argparse
from datetime import datetime
from pathlib import Path

import app


ROOT = Path(__file__).resolve().parent
DEFAULT_RELEASE_DIR = ROOT / "release" / "人工验证样例"
UPLOAD_SESSION = "verification_v2_sample"


def assert_ok(response, label):
    data = response.get_json() or {}
    if response.status_code >= 400 or not data.get("ok"):
        raise RuntimeError("%s failed: %s" % (label, json.dumps(data, ensure_ascii=False)))
    return data


def zip_entries(path):
    with zipfile.ZipFile(path) as archive:
        return set(archive.namelist())


def copy_release_file(release_dir, source, name):
    target = release_dir / name
    shutil.copy2(source, target)
    return target


def main(release_dir=None):
    release_dir = Path(release_dir or DEFAULT_RELEASE_DIR)
    release_dir.mkdir(parents=True, exist_ok=True)
    for previous in release_dir.glob("*.zip"):
        previous.unlink()

    app.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    app.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    upload_root = app.UPLOADS_DIR / UPLOAD_SESSION
    shutil.rmtree(upload_root, ignore_errors=True)
    upload_root.mkdir(parents=True, exist_ok=True)
    source_image = ROOT / "static" / "reference" / "image1.jpg"
    sample_image = upload_root / "现场验证照片.jpg"
    shutil.copy2(source_image, sample_image)
    image = {
        "session_id": UPLOAD_SESSION,
        "stored_name": sample_image.name,
        "original_name": "现场验证照片.jpg",
        "size": sample_image.stat().st_size,
        "original_size": sample_image.stat().st_size,
        "compressed": False,
    }

    base_info = {
        "hospital": "武汉市第八医院-模拟验证",
        "model": "CL-8000i",
        "serial": "VERIFY8000I",
        "software": "V2.0.5-验证",
        "jump_project": "TSH",
        "problem": "模拟跳值反馈：用于验证一线导出、RTS/GTS审核返回和再次补充流程。",
        "engineer": "一线模拟工程师",
        "check_date": "2026-07-22",
        "contact": "13800000000",
    }
    active_items = app.template_items_for_base_info(base_info)
    if len(active_items) != 45:
        raise RuntimeError("expected 45 CL-8000i/TSH items, got %s" % len(active_items))

    items = []
    for number, item in enumerate(active_items, 1):
        payload_item = {
            "id": item["id"],
            "measured_value": "模拟实测记录 %02d：已按排查动作完成检查，现场结果符合合格指标。" % number,
            "conclusion": "正常",
            "before_images": [dict(image)] if item.get("before_required") else [],
            "after_images": [dict(image)] if item.get("after_required") else [],
        }
        items.append(payload_item)

    client = app.app.test_client()
    output_before = set(app.OUTPUT_DIR.iterdir())
    rts_before = set(app.RTS_UPLOADS_DIR.iterdir()) if app.RTS_UPLOADS_DIR.exists() else set()
    try:
        source = assert_ok(client.post("/api/report", json={"session_id": UPLOAD_SESSION, "base_info": base_info, "items": items}), "frontline export")
        source_zip = Path(source["zip_file"])
        source_copy = copy_release_file(release_dir, source_zip, "一线模拟导出报告_CL-8000i_TSH.zip")
        source_entries = zip_entries(source_copy)
        required_source = {"manifest.json", "report_data.json", "report.html"}
        if not required_source.issubset(source_entries) or not any(name.startswith("images/") for name in source_entries):
            raise RuntimeError("frontline ZIP structure is incomplete")

        imported_source = assert_ok(
            client.post("/api/rts/import", data={"report_file": (io.BytesIO(source_zip.read_bytes()), source_zip.name)}, content_type="multipart/form-data"),
            "RTS/GTS source import",
        )
        source_data = imported_source["source_data"]
        report_items = [item for group in source_data.get("groups") or [] for item in group.get("items") or []]
        if len(report_items) != 45:
            raise RuntimeError("RTS/GTS did not receive all 45 items")

        item_reviews = {item["id"]: {"decision": "approved", "note": "模拟审核通过。"} for item in report_items}
        first_item = report_items[0]
        item_reviews[first_item["id"]] = {
            "decision": "supplement",
            "supplement": True,
            "need_record": True,
            "note": "请补充本步骤的现场维修记录说明。",
            "requirement": "请补充本步骤的现场维修记录说明。",
        }
        supplements = [{
            "item_id": first_item["id"],
            "display_step": first_item.get("display_step") or first_item.get("step"),
            "action": first_item.get("action"),
            "need_record": True,
            "need_before": False,
            "need_after": False,
            "requirement": "请补充本步骤的现场维修记录说明。",
        }]
        review = {
            "review_conclusion": "资料不完整，需补充",
            "review_date": "2026-07-22T10:30",
            "review_notes": "模拟 RTS/GTS 审核：全部项目已审核，第1步需补充维修记录。",
            "reviewer": "RTS/GTS模拟审核员",
            "initial_judgement": ["已完成一线资料核对"],
            "upgrade_required": "否",
            "upgrade_target": "",
        }
        returned = assert_ok(client.post("/api/rts/report", json={
            "source_data": source_data,
            "source_session_id": imported_source["session_id"],
            "review": review,
            "item_reviews": item_reviews,
            "supplement_requests": supplements,
        }), "RTS/GTS return export")
        return_zip = Path(returned["zip_file"])
        return_copy = copy_release_file(release_dir, return_zip, "RTS_GTS模拟审核返回报告_CL-8000i_TSH.zip")
        return_entries = zip_entries(return_copy)
        if "rts_review_data.json" not in return_entries or not any(name.startswith("source_images/") for name in return_entries):
            raise RuntimeError("RTS/GTS return ZIP structure is incomplete")

        desktop_source = assert_ok(
            client.post("/api/report/import", data={"report_file": (io.BytesIO(source_zip.read_bytes()), source_zip.name)}, content_type="multipart/form-data"),
            "desktop source import",
        )
        desktop_return = assert_ok(
            client.post("/api/report/import-rts-review", data={"rts_file": (io.BytesIO(return_zip.read_bytes()), return_zip.name)}, content_type="multipart/form-data"),
            "desktop RTS/GTS return import",
        )
        if len(desktop_source.get("items") or []) != 45 or len(desktop_return.get("items") or []) != 45:
            raise RuntimeError("desktop import did not restore 45 items")
        if desktop_return.get("base_info", {}).get("jump_project") != "TSH":
            raise RuntimeError("desktop return import did not restore the jump project")
        if len(desktop_return.get("supplement_requests") or []) != 1:
            raise RuntimeError("desktop return import did not restore supplement requests")

        (release_dir / "人工验证说明.md").write_text(
            "# 人工验证样例\n\n"
            "本目录的两份 ZIP 由当前 V2.0.5 程序实际生成，机型为 CL-8000i、跳值项目为 TSH，共 45 项。\n\n"
            "1. 在 RTS/GTS 审核页导入 `一线模拟导出报告_CL-8000i_TSH.zip`，应读取 45 项和现场照片。\n"
            "2. 在电脑端一线填写页直接导入 `RTS_GTS模拟审核返回报告_CL-8000i_TSH.zip`，应恢复基础信息、45 项、照片和第1步补充要求。\n"
            "3. 在手机浏览器打开 `手机离线采集.html`，直接导入同一份 RTS/GTS 返回 ZIP；应恢复同样的 45 项、照片及补充要求。\n"
            "4. 补充第1步实测记录后，在手机或电脑端重新导出正式 ZIP；导出前完整性检查应通过。\n",
            encoding="utf-8",
        )
        print("verification packages built:", source_copy, return_copy)
    finally:
        shutil.rmtree(upload_root, ignore_errors=True)
        for path in set(app.OUTPUT_DIR.iterdir()) - output_before:
            shutil.rmtree(path, ignore_errors=True)
        if app.RTS_UPLOADS_DIR.exists():
            for path in set(app.RTS_UPLOADS_DIR.iterdir()) - rts_before:
                shutil.rmtree(path, ignore_errors=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-dir", default=None)
    args = parser.parse_args()
    main(args.release_dir)

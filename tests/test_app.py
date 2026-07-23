import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from werkzeug.datastructures import FileStorage

import app


class AppTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.original_paths = {
            "UPLOADS_DIR": app.UPLOADS_DIR,
            "OUTPUT_DIR": app.OUTPUT_DIR,
            "DRAFTS_DIR": app.DRAFTS_DIR,
            "RTS_UPLOADS_DIR": app.RTS_UPLOADS_DIR,
            "MOBILE_TASKS_DIR": app.MOBILE_TASKS_DIR,
            "MOBILE_CHUNKS_DIR": app.MOBILE_CHUNKS_DIR,
            "REFERENCE_DIR": app.REFERENCE_DIR,
        }
        app.UPLOADS_DIR = root / "uploads"
        app.OUTPUT_DIR = root / "output"
        app.DRAFTS_DIR = root / "drafts"
        app.RTS_UPLOADS_DIR = app.UPLOADS_DIR / "rts_reviews"
        app.MOBILE_TASKS_DIR = root / "mobile_tasks"
        app.MOBILE_CHUNKS_DIR = root / "mobile_chunks"
        app.REFERENCE_DIR = root / "reference"
        for path in [
            app.UPLOADS_DIR,
            app.OUTPUT_DIR,
            app.DRAFTS_DIR,
            app.RTS_UPLOADS_DIR,
            app.MOBILE_TASKS_DIR,
            app.MOBILE_CHUNKS_DIR,
            app.REFERENCE_DIR,
        ]:
            path.mkdir(parents=True, exist_ok=True)
        app._TEMPLATE_CACHE = None
        self.client = app.app.test_client()

    def tearDown(self):
        for name, value in self.original_paths.items():
            setattr(app, name, value)
        app._TEMPLATE_CACHE = None
        self.temp_dir.cleanup()

    def test_template_context_counts(self):
        items = app.read_excel_template()
        cases = [
            ({"model": "CL-6000i", "jump_project": "CEA"}, 39),
            ({"model": "CL-8000i", "jump_project": "AFP"}, 38),
            ({"model": "CL-8000i", "jump_project": "CEA"}, 45),
        ]
        for base_info, expected in cases:
            with self.subTest(base_info=base_info):
                selected = app.prepare_items_for_context(items, base_info)
                self.assertEqual(expected, len(selected))
                self.assertEqual(expected, len({item["id"] for item in selected}))

    def test_live_mobile_page_and_remote_route_boundary(self):
        response = self.client.get("/mobile", environ_base={"REMOTE_ADDR": "192.0.2.20"})
        self.assertEqual(200, response.status_code)
        self.assertIn(b"static/js/mobile.js", response.data)

        response = self.client.get("/", environ_base={"REMOTE_ADDR": "192.0.2.20"})
        self.assertEqual(403, response.status_code)

    def test_offline_mobile_workflow_contract(self):
        content = (Path(app.SOURCE_DIR) / "templates" / "mobile_offline.html").read_text(encoding="utf-8")
        self.assertIn('id="integrityModal"', content)
        self.assertIn('function ensureIdle(action)', content)
        self.assertIn('bottomNext.textContent = exportReady ? "导出正式 ZIP" : "下一处待补"', content)
        self.assertNotIn('id="nextTodoTopBtn"', content)
        self.assertIn("页面不会自动跳转", content)

    def test_upload_route_rejects_directory_traversal(self):
        secret = app.UPLOADS_DIR.parent / "secret.txt"
        secret.write_text("not public", encoding="utf-8")
        response = self.client.get("/uploads/../secret.txt")
        self.assertEqual(404, response.status_code)
        self.assertNotIn(b"not public", response.data)

    def test_http_not_found_remains_404(self):
        self.assertEqual(404, self.client.get("/does-not-exist").status_code)
        self.assertEqual(404, self.client.get("/output-files/does-not-exist").status_code)

    def test_qrcode_requires_task_token(self):
        base_info = {"model": "CL-6000i", "jump_project": "CEA"}
        items = [{"id": item["id"]} for item in app.template_items_for_base_info(base_info)]
        created = self.client.post("/api/mobile/task/create", json={"base_info": base_info, "items": items})
        self.assertEqual(200, created.status_code)
        data = created.get_json()

        self.assertEqual(403, self.client.get("/api/mobile/task/%s/qrcode" % data["task_id"]).status_code)
        qr = self.client.get(data["qr_url"])
        self.assertEqual(200, qr.status_code)
        self.assertEqual("image/png", qr.mimetype)

    def test_zip_extraction_limits_and_valid_package(self):
        zip_path = Path(self.temp_dir.name) / "report.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("report_data.json", json.dumps({"groups": []}))
            archive.writestr("images/large.bin", b"x" * 256)

        with patch.object(app, "ZIP_MAX_EXTRACTED_BYTES", 128):
            with self.assertRaises(app.UserFacingError):
                app.load_report_data_from_zip(zip_path, "limited")

        with patch.object(app, "ZIP_MAX_FILES", 1):
            with self.assertRaises(app.UserFacingError):
                app.load_report_data_from_zip(zip_path, "too_many")

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("report_data.json", json.dumps({"groups": []}))
        data, extract_root = app.load_report_data_from_zip(zip_path, "valid")
        self.assertEqual({"groups": []}, data)
        self.assertTrue((extract_root / "report_data.json").is_file())

    def test_json_upload_limit(self):
        storage = FileStorage(stream=io.BytesIO(b"{" + b"x" * 64 + b"}"), filename="report_data.json")
        target = Path(self.temp_dir.name) / "report_data.json"
        with patch.object(app, "JSON_MAX_BYTES", 32):
            with self.assertRaises(app.UserFacingError):
                app.save_json_upload(storage, target, "report_data.json")
        self.assertFalse(target.exists())

    def test_mobile_chunk_plan_is_bounded(self):
        app.validate_mobile_chunk_plan(2 * 1024 * 1024, app.MOBILE_CHUNK_SIZE + 1, 2)
        with self.assertRaises(app.UserFacingError):
            app.validate_mobile_chunk_plan(2 * 1024 * 1024, app.MOBILE_CHUNK_SIZE + 1, 1)
        with self.assertRaises(app.UserFacingError):
            app.validate_mobile_chunk_plan(
                20 * 1024 * 1024,
                app.MOBILE_MAX_UPLOAD_SIZE + 1,
                app.MOBILE_MAX_CHUNKS + 1,
            )

    def test_rts_zip_import_exposes_only_existing_source_images(self):
        report = {
            "issue_no": "TEST-001",
            "base_info": {"hospital": "测试医院", "model": "CL-8000i", "serial": "SN-1"},
            "groups": [
                {
                    "name": "测试分组",
                    "items": [
                        {
                            "id": "item_001",
                            "display_step": "1",
                            "action": "测试照片",
                            "before_images": [
                                {"path": "images/existing.jpg", "original_name": "existing.jpg"},
                                {"path": "images/missing.jpg", "original_name": "missing.jpg"},
                            ],
                            "after_images": [],
                        }
                    ],
                }
            ],
        }
        package = io.BytesIO()
        with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("report_data.json", json.dumps(report, ensure_ascii=False))
            archive.writestr("images/existing.jpg", b"test-image-bytes")
        package.seek(0)

        response = self.client.post(
            "/api/rts/import",
            data={"report_file": (package, "source.zip")},
            content_type="multipart/form-data",
        )
        self.assertEqual(200, response.status_code)
        images = response.get_json()["source_data"]["groups"][0]["items"][0]["before_images"]
        self.assertIn("preview_url", images[0])
        self.assertNotIn("preview_url", images[1])
        image_response = self.client.get(images[0]["preview_url"])
        self.assertEqual(200, image_response.status_code)
        self.assertEqual(b"test-image-bytes", image_response.data)
        image_response.close()

        json_response = self.client.post(
            "/api/rts/import",
            data={"report_file": (io.BytesIO(json.dumps(report, ensure_ascii=False).encode("utf-8")), "source.json")},
            content_type="multipart/form-data",
        )
        self.assertEqual(200, json_response.status_code)
        json_images = json_response.get_json()["source_data"]["groups"][0]["items"][0]["before_images"]
        self.assertTrue(all("preview_url" not in image for image in json_images))


if __name__ == "__main__":
    unittest.main()

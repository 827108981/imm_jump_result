"""Build the only supported desktop and mobile delivery artifacts."""

from __future__ import annotations

import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import app


ROOT = Path(__file__).resolve().parent
PROGRAM_NAME = app.APP_NAME
DIST_DIR = ROOT / "dist" / PROGRAM_NAME
RELEASE_ROOT = ROOT / "release"


def run(command):
    subprocess.run(command, cwd=str(ROOT), check=True)


def verify_desktop_assets(package_dir):
    required = [
        package_dir / "_internal" / "templates" / "index.html",
        package_dir / "_internal" / "templates" / "mobile.html",
        package_dir / "_internal" / "templates" / "rts_review.html",
        package_dir / "_internal" / "static" / "css" / "style.css",
        package_dir / "_internal" / "static" / "css" / "mobile.css",
        package_dir / "_internal" / "static" / "js" / "app.js",
        package_dir / "_internal" / "static" / "js" / "mobile.js",
        package_dir / "_internal" / "static" / "js" / "rts_review.js",
        package_dir / "_internal" / "resources" / app.TEMPLATE_NAME,
    ]
    missing = [str(path.relative_to(package_dir)) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("Desktop package is missing UI assets: " + ", ".join(missing))


def main():
    if not app.TEMPLATE_PATH.is_file():
        raise RuntimeError("Missing required workbook: %s" % app.TEMPLATE_PATH)
    run([sys.executable, "-m", "unittest", "discover", "-v"])

    # Refresh the reference-image catalogue and the self-contained phone file.
    run([sys.executable, "build_offline_html.py"])

    shutil.rmtree(ROOT / "build", ignore_errors=True)
    shutil.rmtree(ROOT / "dist", ignore_errors=True)
    run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onedir",
            "--noconsole",
            "--name",
            PROGRAM_NAME,
            "--add-data",
            "templates;templates",
            "--add-data",
            "static;static",
            "--add-data",
            "resources/" + app.TEMPLATE_NAME + ";resources",
            "app.py",
        ]
    )

    if not DIST_DIR.exists():
        raise RuntimeError("PyInstaller did not create the desktop program directory.")

    release_stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    release_dir = RELEASE_ROOT / (PROGRAM_NAME + "_" + app.VERSION.replace(".", "_") + "_" + release_stamp)
    package_dir = release_dir / PROGRAM_NAME
    release_dir.mkdir(parents=True, exist_ok=False)
    shutil.copytree(DIST_DIR, package_dir)
    verify_desktop_assets(package_dir)
    shutil.copy2(ROOT / "templates" / "mobile_offline.html", release_dir / "手机离线采集.html")
    (release_dir / "使用说明.txt").write_text(
        "桌面端：运行“免疫跳值排查反馈报告生成工具.exe”。\n"
        "手机端：将“手机离线采集.html”发送到手机后，用 Safari、Chrome、Edge 或系统浏览器打开。\n"
        "不要在微信内置浏览器中长期填写。手机端数据自动保存在本机浏览器，完成后导出正式 ZIP。\n"
        "RTS/GTS 返回 ZIP 可直接导入电脑端或手机端，补充后重新导出正式 ZIP。\n",
        encoding="utf-8",
    )
    run([sys.executable, "generate_verification_packages.py", "--release-dir", str(release_dir / "人工验证样例")])
    RELEASE_ROOT.mkdir(parents=True, exist_ok=True)
    shutil.make_archive(str(RELEASE_ROOT / release_dir.name), "zip", root_dir=str(RELEASE_ROOT), base_dir=release_dir.name)
    (RELEASE_ROOT / "最新发布包.txt").write_text(
        "请使用以下发布目录或同名 ZIP：\n%s\n" % release_dir.name,
        encoding="utf-8",
    )
    (ROOT / (PROGRAM_NAME + ".spec")).unlink(missing_ok=True)
    shutil.rmtree(ROOT / "build", ignore_errors=True)
    shutil.rmtree(ROOT / "dist", ignore_errors=True)
    print("release built:", release_dir)


if __name__ == "__main__":
    main()

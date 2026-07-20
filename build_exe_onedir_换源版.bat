@echo off
chcp 65001 >nul
title 免疫跳值排查反馈报告生成工具 - onedir换源打包

echo ============================================================
echo  免疫跳值排查反馈报告生成工具 - onedir换源打包脚本
echo ============================================================
echo.

set "PYTHON_EXE=D:\python.exe"
if not exist "%PYTHON_EXE%" (
    echo 未找到 D:\python.exe，尝试使用系统 PATH 中的 python...
    set "PYTHON_EXE=python"
)

REM 阿里云 PyPI 镜像，避免清华源 403
set "PIP_INDEX=https://mirrors.aliyun.com/pypi/simple/"
set "PIP_TRUSTED=mirrors.aliyun.com"

echo 当前 Python：
"%PYTHON_EXE%" --version
if errorlevel 1 (
    echo [错误] Python 不可用，请修改本 bat 中 PYTHON_EXE 路径。
    pause
    exit /b 1
)

echo 当前 pip：
"%PYTHON_EXE%" -m pip --version
if errorlevel 1 (
    echo [错误] pip 不可用。
    pause
    exit /b 1
)

if not exist "app.py" (
    echo [错误] 当前目录未找到 app.py，请把 bat 放在项目根目录运行。
    pause
    exit /b 1
)

if not exist "requirements.txt" (
    echo [错误] 当前目录未找到 requirements.txt。
    pause
    exit /b 1
)

if not exist "resources\免疫产品_跳值问题用服工程师排查反馈表_V1.0_CN.xlsx" (
    echo [错误] 未找到正式 Excel 模板：
    echo resources\免疫产品_跳值问题用服工程师排查反馈表_V1.0_CN.xlsx
    pause
    exit /b 1
)

echo.
echo 清理 pip 缓存，避免继续使用 403 的旧缓存...
"%PYTHON_EXE%" -m pip cache purge

echo.
echo 安装依赖，使用阿里云镜像...
"%PYTHON_EXE%" -m pip install --no-cache-dir -r requirements.txt -i %PIP_INDEX% --trusted-host %PIP_TRUSTED%

if errorlevel 1 (
    echo.
    echo [错误] 阿里云镜像安装失败，尝试使用官方 PyPI...
    "%PYTHON_EXE%" -m pip install --no-cache-dir -r requirements.txt -i https://pypi.org/simple --trusted-host pypi.org --trusted-host files.pythonhosted.org
)

if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败。
    echo 建议：
    echo 1. 确认网络可访问 PyPI；
    echo 2. 优先使用 Python 3.10 或 Python 3.11；
    echo 3. 如公司网络无法访问外网，请使用离线 wheels 安装。
    pause
    exit /b 1
)

echo.
echo 清理旧打包目录...
if exist "build" rmdir /s /q "build"
if exist "dist" rmdir /s /q "dist"

echo.
echo 开始 onedir 打包...
"%PYTHON_EXE%" -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --onedir ^
  --name "免疫跳值排查反馈报告生成工具" ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  --add-data "resources;resources" ^
  app.py

if errorlevel 1 (
    echo.
    echo [错误] PyInstaller 打包失败。
    pause
    exit /b 1
)

set "DIST_DIR=dist\免疫跳值排查反馈报告生成工具"

echo.
echo 复制 resources 到 EXE 同级目录...
if exist "%DIST_DIR%\resources" rmdir /s /q "%DIST_DIR%\resources"
xcopy "resources" "%DIST_DIR%\resources" /E /I /Y >nul

echo 创建运行目录...
if not exist "%DIST_DIR%\uploads" mkdir "%DIST_DIR%\uploads"
if not exist "%DIST_DIR%\output" mkdir "%DIST_DIR%\output"
if not exist "%DIST_DIR%\drafts" mkdir "%DIST_DIR%\drafts"
if not exist "%DIST_DIR%\logs" mkdir "%DIST_DIR%\logs"

(
echo 免疫跳值排查反馈报告生成工具 - 使用说明
echo.
echo 请运行：
echo 免疫跳值排查反馈报告生成工具.exe
echo.
echo 请整体复制本文件夹，不要只复制 exe。
echo resources 文件夹必须与 exe 同级。
echo 一线报告输出在 output 文件夹。
) > "%DIST_DIR%\打包说明.txt"

echo.
echo ============================================================
echo 打包完成！
echo 输出目录：%CD%\%DIST_DIR%
echo 请把整个文件夹发给使用者，不要只发 exe。
echo ============================================================
pause

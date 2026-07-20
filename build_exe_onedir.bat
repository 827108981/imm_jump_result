@echo off
chcp 65001 >nul
title 免疫跳值排查反馈报告生成工具 - onedir打包

echo ============================================================
echo  免疫跳值排查反馈报告生成工具 - Windows onedir 打包脚本
echo ============================================================
echo.

REM ============================================================
REM 1. Python 路径设置
REM    优先使用 D:\python.exe，如果不存在则使用系统 PATH 中的 python
REM ============================================================
set "PYTHON_EXE=D:\python.exe"

if not exist "%PYTHON_EXE%" (
    echo 未找到 D:\python.exe，尝试使用系统 PATH 中的 python...
    set "PYTHON_EXE=python"
)

echo 当前使用的 Python：
"%PYTHON_EXE%" --version
if errorlevel 1 (
    echo.
    echo [错误] 未找到可用 Python，请确认 Python 已安装，或修改本 bat 中的 PYTHON_EXE 路径。
    pause
    exit /b 1
)

echo.
echo 当前 pip：
"%PYTHON_EXE%" -m pip --version
if errorlevel 1 (
    echo.
    echo [错误] pip 不可用，请先修复 pip。
    pause
    exit /b 1
)

REM ============================================================
REM 2. 检查项目关键文件
REM ============================================================
echo.
echo 正在检查项目文件...

if not exist "app.py" (
    echo [错误] 当前目录未找到 app.py。
    echo 请把本 bat 放在 jump_check_tool 项目根目录下再运行。
    pause
    exit /b 1
)

if not exist "templates" (
    echo [错误] 当前目录未找到 templates 文件夹。
    pause
    exit /b 1
)

if not exist "static" (
    echo [错误] 当前目录未找到 static 文件夹。
    pause
    exit /b 1
)

if not exist "resources" (
    echo [错误] 当前目录未找到 resources 文件夹。
    echo 请创建 resources 文件夹，并放入正式 Excel 模板。
    pause
    exit /b 1
)

if not exist "resources\免疫产品_跳值问题用服工程师排查反馈表_V1.0_CN.xlsx" (
    echo [错误] resources 文件夹中未找到正式 Excel 模板：
    echo resources\免疫产品_跳值问题用服工程师排查反馈表_V1.0_CN.xlsx
    echo.
    echo 请确认模板文件名必须完全一致，不能带 ^(1^)。
    pause
    exit /b 1
)

echo 项目文件检查通过。

REM ============================================================
REM 3. 安装依赖
REM    使用清华源，避免默认源连接失败
REM ============================================================
echo.
echo 正在安装依赖...
"%PYTHON_EXE%" -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败。
    echo 可能原因：
    echo 1. 公司网络限制访问外网；
    echo 2. pip 源不可用；
    echo 3. Python 版本过高，部分包不兼容。
    echo.
    echo 建议优先使用 Python 3.10 或 Python 3.11 打包。
    pause
    exit /b 1
)

REM ============================================================
REM 4. 清理旧打包文件
REM ============================================================
echo.
echo 正在清理旧的 build/dist 文件...

if exist "build" rmdir /s /q "build"
if exist "dist" rmdir /s /q "dist"
if exist "__pycache__" rmdir /s /q "__pycache__"

REM ============================================================
REM 5. onedir 模式打包
REM    注意：这里不用 --onefile，改用 --onedir
REM ============================================================
echo.
echo 正在使用 PyInstaller onedir 模式打包...

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
    echo [错误] PyInstaller 打包失败，请查看上方错误信息。
    pause
    exit /b 1
)

REM ============================================================
REM 6. 准备 EXE 同级运行目录
REM    当前 app.py 会优先从 EXE 同级 resources 读取模板，
REM    所以这里额外复制 resources 到 dist\程序名\resources。
REM ============================================================
set "DIST_DIR=dist\免疫跳值排查反馈报告生成工具"

if not exist "%DIST_DIR%" (
    echo.
    echo [错误] 未找到打包输出目录：%DIST_DIR%
    pause
    exit /b 1
)

echo.
echo 正在复制 resources 到 EXE 同级目录...

if exist "%DIST_DIR%\resources" rmdir /s /q "%DIST_DIR%\resources"
xcopy "resources" "%DIST_DIR%\resources" /E /I /Y >nul

echo 正在创建运行数据目录...
if not exist "%DIST_DIR%\uploads" mkdir "%DIST_DIR%\uploads"
if not exist "%DIST_DIR%\output" mkdir "%DIST_DIR%\output"
if not exist "%DIST_DIR%\drafts" mkdir "%DIST_DIR%\drafts"
if not exist "%DIST_DIR%\logs" mkdir "%DIST_DIR%\logs"

REM ============================================================
REM 7. 输出说明文件
REM ============================================================
echo 正在生成打包说明...

(
echo 免疫跳值排查反馈报告生成工具 - 打包说明
echo.
echo 运行文件：
echo 免疫跳值排查反馈报告生成工具.exe
echo.
echo 请不要只复制 exe 单文件使用。
echo 需要整体复制整个文件夹：
echo dist\免疫跳值排查反馈报告生成工具
echo.
echo 文件夹中必须保留：
echo resources\
echo templates/static 已由 PyInstaller 打包到 _internal 中
echo uploads\
echo output\
echo drafts\
echo logs\
echo.
echo 正式模板路径：
echo resources\免疫产品_跳值问题用服工程师排查反馈表_V1.0_CN.xlsx
echo.
echo 一线报告输出目录：
echo output\
echo.
echo 如提示找不到模板，请检查 resources 文件夹是否与 exe 同级。
) > "%DIST_DIR%\打包说明.txt"

REM ============================================================
REM 8. 完成
REM ============================================================
echo.
echo ============================================================
echo 打包完成！
echo.
echo 输出目录：
echo %CD%\%DIST_DIR%
echo.
echo 请把整个文件夹发给使用者，不要只发 exe。
echo ============================================================
echo.

pause

# 免疫跳值排查反馈报告生成工具 V1.2

本项目用于将免疫产品跳值问题排查 Excel 模板转化为带校验的本地 HTML 填写工具，并生成可归档的 HTML 报告。V1.2 在 V1.1 基础上新增 **RTS审核返回报告模块**，支持 RTS 基于一线提交报告包生成独立审核返回报告。

## 一、核心功能

### 1. 一线工程师排查报告

- 读取固定 Excel 模板中的 `用服工程师排查反馈表` sheet。
- 页面填写基础信息、实测情况记录，并上传原始状态照片 / 调试或维护后照片。
- 根据模板中的 `N/A` 判断必填、必上传或选填。
- `是否执行` 固定为 `是`。
- 图片支持 `jpg`、`jpeg`、`png`、`webp`。
- 单张图片超过 5MB 时自动压缩，压缩后仍超过 5MB 才拦截。
- 每个上传框最多 5 张图片。
- 每项增加排查结论：`正常 / 异常 / 已处理 / 待确认`。
- 报告顶部自动汇总异常项、已处理项、待确认项。
- 报告支持筛选：全部、只看异常、只看已处理、只看待确认、重点项。
- 自动生成问题编号。
- 输出 HTML、images、report_data.json 和 ZIP 包。

### 2. RTS审核返回报告

首页右上角点击：

```text
RTS审核返回
```

进入 RTS 审核页面后：

1. 上传一线生成的 ZIP 报告包，或上传其中的 `report_data.json`。
2. 系统自动解析：
   - 问题编号
   - 医院名称
   - 设备型号
   - 设备序列号
   - 跳值项目
   - 问题描述
   - 异常项
   - 已处理项
   - 待确认项
3. RTS 填写：
   - 审核结论
   - 初步判断
   - 是否需要补充资料
   - 需补充资料
   - 是否需要升级
   - 下一步处理建议
   - 审核人
   - 审核日期
   - 审核说明
4. 可对每个重点问题填写单独 RTS 复核意见。
5. 点击“生成RTS审核返回报告”。
6. 输出 RTS 审核返回 HTML、rts_review_data.json 和 ZIP 包。

## 二、目录结构

```text
jump_check_tool/
├─ app.py
├─ requirements.txt
├─ build_exe.bat              # Windows onedir 打包脚本
├─ build_exe_onedir.bat       # 同 build_exe.bat，保留备用
├─ README.md
├─ create_sample_template.py
├─ resources/
│  └─ 免疫产品_跳值问题用服工程师排查反馈表_V1.0_CN.xlsx
├─ templates/
│  ├─ index.html
│  ├─ report.html
│  ├─ rts_review.html
│  └─ rts_report.html
├─ static/
│  ├─ css/style.css
│  └─ js/
│     ├─ app.js
│     └─ rts_review.js
├─ uploads/
├─ output/
├─ drafts/
└─ logs/
```

## 三、本地运行

建议使用 Python 3.10 或 Python 3.11 打包，兼容性最好。

```bat
python -m pip install -r requirements.txt
python app.py
```

启动后会自动打开本地页面。也可以手动访问：

```text
http://127.0.0.1:5000
```

RTS 审核页面：

```text
http://127.0.0.1:5000/rts
```

## 四、打包 EXE

本项目建议使用 **onedir 文件夹模式** 打包，不建议只生成单个 exe。

```bat
build_exe.bat
```

打包结果在：

```text
dist/免疫跳值排查反馈报告生成工具/
```

运行时请打开整个文件夹中的：

```text
dist/免疫跳值排查反馈报告生成工具/免疫跳值排查反馈报告生成工具.exe
```

请把整个 `dist/免疫跳值排查反馈报告生成工具/` 文件夹发给使用者，不要只复制 exe。因为 EXE 同级目录下需要保留 `resources/` 模板目录，以及 `uploads/`、`output/`、`drafts/`、`logs/` 等运行目录。

## 五、输出说明

### 一线报告输出

```text
output/跳值排查反馈报告_医院名称_设备序列号_问题编号/
├─ 跳值排查反馈报告_医院名称_设备序列号_问题编号.html
├─ report_data.json
├─ images/
└─ 跳值排查反馈报告_医院名称_设备序列号_问题编号.zip
```

### RTS审核返回报告输出

```text
output/RTS审核返回报告_医院名称_设备序列号_RTS审核编号/
├─ RTS审核返回报告_医院名称_设备序列号_RTS审核编号.html
├─ rts_review_data.json
├─ source_images/              # 上传 ZIP 时保留重点图片
└─ RTS审核返回报告_医院名称_设备序列号_RTS审核编号.zip
```

## 六、注意事项

1. 如果 RTS 审核页面上传的是 `report_data.json`，只能生成文字审核返回报告，无法保留原报告图片。
2. 如果 RTS 审核页面上传的是一线 ZIP 报告包，系统会提取并保留重点项图片。
3. 正式模板必须放在 EXE 同级的 `resources/` 目录下，源码运行时也必须放在项目根目录的 `resources/` 目录下，文件名必须为：

```text
免疫产品_跳值问题用服工程师排查反馈表_V1.0_CN.xlsx
```

4. 若 Excel 模板中某字段为 `N/A`，表示该字段选填；空白不等于 `N/A`。
5. 生成报告前必须通过完整性校验。

## 七、版本说明

### V1.2

- 新增 RTS 审核返回报告页面 `/rts`。
- 支持上传一线 ZIP 报告包或 `report_data.json`。
- 自动解析异常、已处理、待确认重点项。
- 支持 RTS 总体审核意见和单项复核意见。
- 支持生成独立 RTS 审核返回 HTML / JSON / ZIP。
- RTS 返回报告可保留一线报告重点图片。

### V1.1

- 增加图片自动压缩。
- 增加排查结论。
- 增加异常项汇总。
- 增加过短描述提醒。
- 增加报告筛选。
- 增加问题编号。

### V1.0

- 实现一线排查反馈表填写、校验、图片上传和 HTML 报告生成。

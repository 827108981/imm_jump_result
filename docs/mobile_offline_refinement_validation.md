# mobile_offline.html 手机端精修验证记录

验证日期：2026-07-21

## 本次精修内容

- 修复筛选栏吸顶：`.items-card` 允许可见溢出，筛选栏固定在 60px 顶部栏下方。
- 压缩 39 项折叠卡：仅保留步骤、简短动作、状态、分类和必填摘要，不再显示选填标签。
- 基础信息未完成时显示不可点击的“未完成”标签；完成后才允许收起和编辑。
- 展开项显示“当前第 X 项 / 共 39 项”，并提供“上一项 / 下一项”；“下一待办”保留为独立功能。
- 320px 小屏幕下压缩底部操作栏；软键盘弹出时隐藏底部栏，避免遮挡实测记录输入框。
- 普通浏览器提示改为单行中性提示；微信内置浏览器继续显示不可永久隐藏的明显警告。
- 实测记录输入、结论切换、照片处理改为局部更新，不再重建全部 39 项任务卡。
- 照片块显示处理中、成功、失败和达到 5 张上限的状态；删除按钮保留 40px 点击区域和二次确认。
- 补齐筛选、抽屉、图片预览和结论按钮的 ARIA 状态及焦点返回行为。

## 未修改的兼容契约

- `window.OFFLINE_CONFIG` 模板内容完全未修改。
- IndexedDB 名称、版本、`reports` / `photos` 对象存储未修改。
- 报告中的 `base_info`、`item_data`、`before_images`、`after_images`、`conclusion` 未修改。
- 图片压缩尺寸、单张 5MB 限制、每个位置最多 5 张、500MB ZIP 上限未修改。
- `manifest.json`、`report_data.json`、`report.html`、`images/` 的 ZIP 结构和正式导出完整性校验未修改。
- 电脑端导入、RTS 导入、RTS 审核返回后再编辑的兼容格式未修改。

## 自动化验证结果

- 离线 HTML 内联 JavaScript 语法检查通过。
- 15 项静态契约检查通过：无 Jinja 模板语法、无外部资源、配置与 IndexedDB 契约未变、筛选吸顶、小屏键盘、局部更新、ARIA、ZIP 生成逻辑均已检查。
- Flask 路由 `/mobile-offline.html` 和 `/mobile-offline/download` 返回 200，下载文件为完整静态 HTML。
- 生成一份包含 39 项和 44 张必填图片引用的正式回归 ZIP，检查到 `manifest.json`、`report_data.json`、`report.html` 和 `images/`。
- 该 ZIP 已通过 `/api/rts/import` 导入 RTS，恢复 39 项。
- 该 ZIP 已通过 `/api/report/import` 恢复为电脑端可编辑报告，恢复 39 项。
- 已复测手机离线模拟正式 ZIP 可通过 `/api/rts/import` 导入 RTS，恢复 39 项。

本次电脑端正式回归 ZIP：

`output/MobileRefineValidationHospital_MAGLUMI-REFINE_SN-REFINE-20260721_20260721084553/MobileRefineValidationHospital_MAGLUMI-REFINE_SN-REFINE-20260721_20260721084553.zip`

手机离线模拟正式 ZIP：

`output/frontline_offline_validation_FrontlineDemoHospital_MAGLUMI-X8_SN-OFFLINE-001_20260720171410/FrontlineDemoHospital_MAGLUMI-X8_SN-OFFLINE-001_20260720171410.zip`

## 已知限制

当前自动化浏览器运行在隔离环境，无法连接工作区本地服务，也不允许访问 `file://` 文件，因此无法在该环境中完成 iPhone Safari、Android Chrome、Windows Edge/Chrome 手机模拟视口的真实截图验收。静态契约、路由、ZIP 和 RTS 导入回归均已通过；交付前仍建议在真实手机浏览器完成一次 320px、390x844 和长列表滚动的现场验收。

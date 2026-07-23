(function () {
  const state = {
    sourceData: null,
    sourceSessionId: "",
    lastOutputPath: "",
    rtsFilter: "all",
    activeItemId: "",
    reviewData: {},
    photoIndexes: {},
    confirmAction: null,
    busy: { active: false },
    imageModal: { images: [], index: 0, zoom: 1, rotation: 0, offsetX: 0, offsetY: 0, dragging: false, startX: 0, startY: 0 }
  };

  const PRESETS = {
    "缺少实测记录": "请补充具体实测值、观察现象及处理后的复测结果。",
    "缺少原始照片": "请补充原始状态照片，照片应能清楚反映现场状态。",
    "缺少维护后照片": "请补充调试或维护后照片，照片应能清楚反映处理结果。",
    "缺少复测结果": "请补充处理后的复测结果及对应记录。",
    "记录描述过短": "请补充具体实测值、观察现象、处理过程及复测结果。",
    "照片不清晰": "请重新补充清晰、可辨识的现场照片。"
  };

  document.addEventListener("DOMContentLoaded", function () {
    const dateInput = document.querySelector("input[name='review_date']");
    if (dateInput && !dateInput.value) dateInput.value = localDateTimeString();
    initBusyModal();
    initUsageGuide();
    initMoreTools();
    initUploadArea();
    initWorkbench();
    initConfirmation();
    initRtsImageModal();
    updateReviewFormState();
  });

  function localDateTimeString() {
    const now = new Date();
    const part = function (value) { return String(value).padStart(2, "0"); };
    return now.getFullYear() + "-" + part(now.getMonth() + 1) + "-" + part(now.getDate()) + "T" + part(now.getHours()) + ":" + part(now.getMinutes());
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options || {});
    let data = {};
    try { data = await response.json(); } catch (err) { data = { ok: false, message: "服务响应异常。" }; }
    if (!response.ok || data.ok === false) throw data;
    return data;
  }

  function errorMessage(err, fallback) {
    if (err && err.message) return err.message;
    if (err && err.errors && err.errors.length) return err.errors[0].message || err.errors[0];
    return fallback;
  }

  function initBusyModal() {
    document.getElementById("busyCloseBtn").addEventListener("click", closeBusy);
  }

  function setBusyContent(kind, title, message, linksHtml) {
    const modal = document.getElementById("busyModal");
    modal.className = "busy-modal" + (kind ? " " + kind : "");
    document.getElementById("busyTitle").textContent = title || "正在处理";
    document.getElementById("busyMessage").textContent = message || "请稍候。";
    document.getElementById("busyLinks").innerHTML = linksHtml || "";
    document.getElementById("busyCloseBtn").classList.toggle("hidden", kind === "busy");
  }

  function startBusy(title, message) {
    if (state.busy.active) return false;
    state.busy.active = true;
    setBusyContent("busy", title, message);
    return true;
  }

  function finishBusy(kind, title, message, linksHtml) {
    state.busy.active = false;
    setBusyContent(kind || "success", title || "处理完成", message || "", linksHtml || "");
  }

  function closeBusy() {
    if (!state.busy.active) document.getElementById("busyModal").classList.add("hidden");
  }

  function setStatus(text, kind) {
    const node = document.getElementById("rtsStatus");
    node.textContent = text;
    node.className = "status-pill" + (kind ? " " + kind : "");
  }

  function initUsageGuide() {
    const guide = document.getElementById("usageNotice");
    const button = document.getElementById("usageToggleBtn");
    const expanded = localStorage.getItem("imm_jump_usage_expanded") === "1";
    function update(next) {
      guide.classList.toggle("is-collapsed", !next);
      button.textContent = next ? "收起说明" : "查看说明";
      button.setAttribute("aria-expanded", next ? "true" : "false");
      localStorage.setItem("imm_jump_usage_expanded", next ? "1" : "0");
    }
    update(expanded);
    button.addEventListener("click", function () { update(guide.classList.contains("is-collapsed")); });
  }

  function initMoreTools() {
    const button = document.getElementById("rtsMoreBtn");
    const panel = document.getElementById("rtsMorePanel");
    function close() { panel.classList.add("hidden"); button.setAttribute("aria-expanded", "false"); }
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      const open = panel.classList.contains("hidden");
      panel.classList.toggle("hidden", !open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function (event) { if (!event.target.closest(".more-tools-wrap")) close(); });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") close(); });
    document.getElementById("openOutputBtn").addEventListener("click", openOutputFolder);
  }

  function initUploadArea() {
    const input = document.getElementById("rtsFileInput");
    const section = document.getElementById("rtsUploadSection");
    input.addEventListener("change", importSourceReport);
    document.getElementById("rtsReuploadBtn").addEventListener("click", function () { input.click(); });
    section.addEventListener("dragover", function (event) { event.preventDefault(); section.classList.add("dragover"); });
    section.addEventListener("dragleave", function () { section.classList.remove("dragover"); });
    section.addEventListener("drop", function (event) {
      event.preventDefault();
      section.classList.remove("dragover");
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file) return;
      importSourceFile(file);
    });
  }

  function initWorkbench() {
    document.getElementById("generateRtsBtn").addEventListener("click", generateRtsReport);
    document.getElementById("rtsGenerateProxyBtn").addEventListener("click", generateRtsReport);
    document.getElementById("markAllApprovedBtn").addEventListener("click", confirmMarkAllApproved);
    document.querySelectorAll("[data-rts-filter]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.rtsFilter = button.dataset.rtsFilter || "all";
        applyRtsFilter();
      });
    });
    document.getElementById("rtsStepNavigationList").addEventListener("click", function (event) {
      const node = event.target.closest("[data-rts-nav]");
      if (node) setActiveRtsItem(node.dataset.rtsNav, { scroll: true });
    });
    document.getElementById("rtsPreviousBtn").addEventListener("click", function () { moveActiveRtsItem(-1); });
    document.getElementById("rtsNextBtn").addEventListener("click", function () { moveActiveRtsItem(1); });
    document.getElementById("rtsNextPendingBtn").addEventListener("click", goToNextUnreviewed);
    document.getElementById("rtsCurrentReviewPanel").addEventListener("input", onCurrentReviewChanged);
    document.getElementById("rtsCurrentReviewPanel").addEventListener("change", onCurrentReviewChanged);
    document.getElementById("rtsCurrentReviewPanel").addEventListener("click", function (event) {
      const preset = event.target.closest("[data-supplement-preset]");
      if (preset) appendSupplementPreset(preset.dataset.supplementPreset);
    });
    document.getElementById("rtsStepReviewList").addEventListener("click", function (event) {
      const toggle = event.target.closest("[data-rts-guide-toggle]");
      const photoMove = event.target.closest("[data-rts-photo-move]");
      if (toggle) {
        const body = toggle.closest(".rts-source-record").querySelector(".rts-guide-body");
        const hidden = body.classList.toggle("hidden");
        toggle.textContent = hidden ? "查看排查依据" : "收起排查依据";
        toggle.setAttribute("aria-expanded", hidden ? "false" : "true");
      }
      if (photoMove) {
        const key = photoMove.dataset.rtsPhotoKey;
        const item = getActiveItem();
        const images = item && item[photoMove.dataset.field] || [];
        if (!images.length) return;
        const current = Number(state.photoIndexes[key] || 0);
        state.photoIndexes[key] = (current + Number(photoMove.dataset.rtsPhotoMove) + images.length) % images.length;
        renderRtsStepReviewList();
      }
    });
    document.getElementById("rtsForm").addEventListener("input", updateReviewFormState);
    document.getElementById("rtsForm").addEventListener("change", function (event) {
      if (event.target.name === "review_conclusion") event.target.dataset.userSelected = "1";
      updateReviewFormState();
    });
    document.addEventListener("keydown", function (event) {
      if (event.isComposing) return;
      const tag = (event.target && event.target.tagName || "").toLowerCase();
      const isEditor = tag === "textarea" || tag === "input" || tag === "select";
      if (event.altKey && event.key === "ArrowUp" && !isEditor) { event.preventDefault(); moveActiveRtsItem(-1); }
      else if (event.altKey && event.key === "ArrowDown" && !isEditor) { event.preventDefault(); moveActiveRtsItem(1); }
      else if (event.ctrlKey && event.key === "Enter") { event.preventDefault(); goToNextUnreviewed(); }
    });
  }

  function initConfirmation() {
    document.getElementById("rtsConfirmCancelBtn").addEventListener("click", closeConfirmation);
    document.getElementById("rtsConfirmActionBtn").addEventListener("click", function () {
      const action = state.confirmAction;
      closeConfirmation();
      if (action) action();
    });
  }

  function showConfirmation(title, html, actionLabel, action) {
    state.confirmAction = action;
    document.getElementById("rtsConfirmTitle").textContent = title;
    document.getElementById("rtsConfirmContent").innerHTML = html;
    document.getElementById("rtsConfirmActionBtn").textContent = actionLabel;
    document.getElementById("rtsConfirmModal").classList.remove("hidden");
  }

  function closeConfirmation() {
    state.confirmAction = null;
    document.getElementById("rtsConfirmModal").classList.add("hidden");
  }

  async function importSourceReport(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (file) await importSourceFile(file);
    input.value = "";
  }

  async function importSourceFile(file) {
    hideErrors();
    setStatus("解析中", "");
    const form = new FormData();
    form.append("report_file", file);
    if (!startBusy("正在导入一线报告", "正在解析 ZIP、读取照片和 39 项记录，请稍候。")) return;
    try {
      const data = await fetchJson("/api/rts/import", { method: "POST", body: form });
      state.sourceData = data.source_data || {};
      state.sourceSessionId = data.session_id || "";
      state.rtsFilter = "all";
      state.reviewData = {};
      state.photoIndexes = {};
      allReportItems().forEach(function (item) { ensureReview(itemKey(item)); });
      state.activeItemId = getDefaultRtsItemId();
      const photoStatus = await preloadSourceImages(state.sourceData, function (loaded, total) {
        setBusyContent("busy", "正在导入一线报告", total ? "正在确认照片 " + loaded + "/" + total + "，请稍候。" : "正在整理报告数据，请稍候。");
      });
      renderSourceSummary(file.name || "一线报告");
      renderRtsStepReviewList();
      renderRtsNavigator();
      updateReviewProgress();
      const failedCount = photoStatus.failed.length;
      setStatus(failedCount ? "部分照片待检查" : "已读取一线报告", failedCount ? "warning" : "ok");
      finishBusy("success", "一线报告导入成功", failedCount
        ? "报告已读取，可以开始逐项审核；但有 " + failedCount + " 张照片未能加载，请在对应步骤重新导入 ZIP 或检查原文件。"
        : "已读取一线报告及照片，可以开始逐项审核。");
    } catch (err) {
      const message = errorMessage(err, "一线报告解析失败。");
      setStatus("读取失败", "error");
      showErrors([message]);
      finishBusy("error", "一线报告导入失败", message);
    }
  }

  function renderSourceSummary(fileName) {
    const data = state.sourceData || {};
    const base = data.base_info || {};
    const stats = data.stats || {};
    const issueNo = data.issue_no || base.issue_no || "-";
    const missing = allReportItems().filter(isMissingItem).length;
    document.getElementById("sourceIssueNo").textContent = issueNo;
    document.getElementById("sourceAbnormal").textContent = stats.abnormal_count || 0;
    document.getElementById("sourceHandled").textContent = stats.handled_count || 0;
    document.getElementById("sourcePending").textContent = stats.pending_count || 0;
    document.getElementById("sourceMissing").textContent = missing;
    document.getElementById("sourceStatsGrid").classList.remove("hidden");
    document.getElementById("rtsUploadIntro").classList.add("hidden");
    document.getElementById("rtsUploadSummary").classList.remove("hidden");
    document.getElementById("rtsUploadSummaryText").textContent = (fileName || "一线报告") + "｜" + (base.hospital || "未填写医院") + "｜" + (base.model || "未填写型号") + "｜" + (base.serial || "未填写序列号") + "｜" + issueNo;
    const summary = document.getElementById("sourceSummary");
    summary.classList.remove("hidden");
    summary.innerHTML = '<div class="rts-summary-grid">' + summaryCell("医院名称", base.hospital || "未填写") + summaryCell("设备型号", base.model || "未填写") + summaryCell("设备序列号", base.serial || "未填写") + summaryCell("跳值项目", base.jump_project || "未填写") + summaryCell("一线工程师", base.engineer || "未填写") + summaryCell("排查日期", base.check_date || "未填写") + summaryCell("上传图片", stats.uploaded_image_count || 0) + summaryCell("问题编号", issueNo) + '</div><div class="rts-source-problem"><span>问题描述</span><p>' + escapeHtml(base.problem || "未填写") + '</p></div>';
  }

  function summaryCell(label, value) { return '<div><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>'; }

  function allReportItems() {
    const items = [];
    ((state.sourceData || {}).groups || []).forEach(function (group) { (group.items || []).forEach(function (item) { items.push(item); }); });
    return items.sort(function (a, b) { return Number(a.sort_order || a.index || 0) - Number(b.sort_order || b.index || 0); });
  }

  function collectSourcePreviewUrls(data) {
    const urls = [];
    const seen = {};
    function addItem(item) {
      ["before_images", "after_images"].forEach(function (field) {
        (item && item[field] || []).forEach(function (image) {
          const url = image && image.preview_url;
          if (url && !seen[url]) {
            seen[url] = true;
            urls.push(url);
          }
        });
      });
    }
    (data && data.groups || []).forEach(function (group) { (group.items || []).forEach(addItem); });
    (data && data.attention_items || []).forEach(addItem);
    return urls;
  }

  function waitForSourceImage(url) {
    return new Promise(function (resolve) {
      const image = new Image();
      let settled = false;
      const timer = window.setTimeout(function () {
        if (!settled) { settled = true; resolve(false); }
      }, 15000);
      function finish(ok) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(ok);
      }
      image.onload = async function () {
        if (typeof image.decode === "function") {
          try { await image.decode(); } catch (err) { finish(false); return; }
        }
        finish(Boolean(image.naturalWidth || image.width));
      };
      image.onerror = function () { finish(false); };
      image.decoding = "async";
      image.src = url;
    });
  }

  async function preloadSourceImages(data, onProgress) {
    const urls = collectSourcePreviewUrls(data);
    const failed = [];
    let cursor = 0;
    let completed = 0;
    const worker = async function () {
      while (cursor < urls.length) {
        const url = urls[cursor++];
        if (!(await waitForSourceImage(url))) failed.push(url);
        completed += 1;
        if (onProgress) onProgress(completed, urls.length);
      }
    };
    const workers = [];
    for (let index = 0; index < Math.min(4, urls.length); index += 1) workers.push(worker());
    await Promise.all(workers);
    return { total: urls.length, loaded: urls.length - failed.length, failed: failed };
  }

  function markSourceImageUnavailable(image) {
    const button = image && image.closest("[data-rts-preview-image]");
    if (!button) return;
    button.removeAttribute("data-rts-preview-image");
    button.removeAttribute("data-url");
    button.innerHTML = '<span class="empty-state compact rts-photo-failed">照片加载失败，请重新导入 ZIP 或检查原文件。</span>';
  }

  function bindSourceImageFallbacks() {
    document.querySelectorAll("[data-rts-source-image]").forEach(function (image) {
      image.addEventListener("error", function () { markSourceImageUnavailable(image); }, { once: true });
    });
  }

  function itemKey(item) { return String(item.id || item.display_step || item.step || ""); }
  function getActiveItem() { return allReportItems().find(function (item) { return itemKey(item) === state.activeItemId; }) || null; }

  function ensureReview(key) {
    if (!state.reviewData[key]) state.reviewData[key] = { decision: "", note: "", supplement: false, need_record: false, need_before: false, need_after: false, requirement: "" };
    return state.reviewData[key];
  }

  function normalizeConclusion(item) {
    const value = typeof item === "object" ? item.conclusion : item;
    const itemClass = typeof item === "object" ? item.conclusion_class : "";
    if (["正常", "异常", "已处理", "待确认"].indexOf(value) !== -1) return value;
    return { normal: "正常", abnormal: "异常", handled: "已处理", pending: "待确认" }[itemClass] || "正常";
  }

  function conclusionClass(value) {
    value = normalizeConclusion(value);
    if (value === "异常") return "abnormal";
    if (value === "已处理") return "handled";
    if (value === "待确认") return "pending";
    return "normal";
  }

  function isAttentionItem(item) { return ["异常", "已处理", "待确认"].indexOf(normalizeConclusion(item)) !== -1; }
  function isMissingItem(item) {
    if (item.record_required && String(item.measured_value || "").trim().length < 2) return true;
    if (item.before_required && !(item.before_images || []).length) return true;
    if (item.after_required && !(item.after_images || []).length) return true;
    return false;
  }

  function getRtsItemStatus(item) {
    const review = ensureReview(itemKey(item));
    if (review.decision === "supplement" || review.supplement) return { kind: "supplement", icon: "↩", label: "需补充" };
    if (review.decision === "approved") return { kind: "complete", icon: "✓", label: "已通过" };
    if (isMissingItem(item)) return { kind: "missing", icon: "!", label: "资料缺失" };
    if (isAttentionItem(item)) return { kind: "attention", icon: "●", label: "一线重点" };
    return { kind: "todo", icon: "○", label: "未审核" };
  }

  function getFilteredRtsItems() {
    return allReportItems().filter(function (item) {
      const review = ensureReview(itemKey(item));
      if (state.rtsFilter === "unreviewed") return !review.decision;
      if (state.rtsFilter === "approved") return review.decision === "approved";
      if (state.rtsFilter === "attention") return isAttentionItem(item);
      if (state.rtsFilter === "missing") return isMissingItem(item);
      if (state.rtsFilter === "supplement") return review.decision === "supplement" || review.supplement;
      return true;
    });
  }

  function getDefaultRtsItemId() {
    const items = allReportItems();
    const missing = items.find(isMissingItem);
    const attention = items.find(isAttentionItem);
    const unreviewed = items.find(function (item) { return !ensureReview(itemKey(item)).decision; });
    return itemKey(missing || attention || unreviewed || items[0] || {});
  }

  function renderRtsStepReviewList() {
    const root = document.getElementById("rtsStepReviewList");
    const panel = document.getElementById("rtsCurrentReviewPanel");
    const item = getActiveItem();
    if (!item) {
      root.innerHTML = '<div class="empty-state">请先上传一线报告包。</div>';
      panel.innerHTML = '<div class="empty-state">选择步骤后在此审核。</div>';
      return;
    }
    root.innerHTML = renderRtsStepCard(item);
    panel.innerHTML = renderCurrentReviewPanel(item);
    bindSourceImageFallbacks();
    updateRtsPosition();
  }

  function renderRtsStepCard(item) {
    const key = itemKey(item);
    const conclusion = normalizeConclusion(item);
    return '<article class="rts-step-card is-active" data-item-id="' + escapeHtml(key) + '" data-attention="' + (isAttentionItem(item) ? "1" : "0") + '" data-missing="' + (isMissingItem(item) ? "1" : "0") + '"><div class="rts-step-head"><div class="rts-step-title"><strong>' + escapeHtml(item.display_step || item.step || "") + "｜" + escapeHtml(item.action || "未命名排查项") + '</strong><small>分类：' + escapeHtml(item.category || "未分类") + '</small></div><div class="rts-step-badges">' + renderRequiredTag("实测", item.record_required) + renderRequiredTag("原始照片", item.before_required) + renderRequiredTag("调试后照片", item.after_required) + '<span class="conclusion-pill conclusion-' + conclusionClass(conclusion) + '">一线结论：' + escapeHtml(conclusion) + '</span></div></div><div class="rts-step-body"><div class="rts-source-grid"><div class="rts-source-record source-conclusion"><span>一线排查结论</span><p>' + escapeHtml(conclusion) + '</p></div><div class="rts-source-record"><span>排查依据</span><p>' + escapeHtml(item.action || "未填写") + '</p><button type="button" class="rts-guide-toggle" data-rts-guide-toggle aria-expanded="false">查看排查依据</button><div class="rts-guide-body hidden"><p><b>合格指标：</b>' + escapeHtml(item.standard || "未填写") + '</p></div></div><div class="rts-source-record record-wide"><span>一线实测情况记录</span><p>' + escapeHtml(item.measured_value || "未填写") + '</p></div>' + renderPhotoBlock(item, "before_images", "原始状态照片") + renderPhotoBlock(item, "after_images", "调试或维护后照片") + '</div></div></article>';
  }

  function renderRequiredTag(label, required) { return '<span class="tag ' + (required ? "required" : "optional") + '">' + escapeHtml(label) + " " + (required ? "必填" : "选填") + '</span>'; }

  function renderPhotoBlock(item, field, label) {
    const images = item[field] || [];
    const previewImages = images.filter(function (image) { return image.preview_url; });
    if (!images.length) return '<div class="rts-source-record rts-photo-block"><div class="rts-photo-head"><span>' + escapeHtml(label) + '</span><span>0 张</span></div><p class="empty-state compact">未上传</p></div>';
    if (!previewImages.length) return '<div class="rts-source-record rts-photo-block"><div class="rts-photo-head"><span>' + escapeHtml(label) + '</span><span>' + images.length + ' 张</span></div><p class="empty-state compact">已记录图片，原文件未随 JSON 一起上传。</p></div>';
    const key = itemKey(item) + "_" + field;
    const index = Math.max(0, Math.min(Number(state.photoIndexes[key] || 0), previewImages.length - 1));
    const image = previewImages[index];
    return '<div class="rts-source-record rts-photo-block"><div class="rts-photo-head"><span>' + escapeHtml(label) + '</span><span>' + (index + 1) + " / " + previewImages.length + '</span></div><button type="button" class="rts-preview-thumb" data-rts-preview-image data-url="' + escapeHtml(image.preview_url) + '" data-name="' + escapeHtml(image.original_name || label) + '" data-field="' + field + '" data-index="' + index + '"><img data-rts-source-image src="' + escapeHtml(image.preview_url) + '" alt="' + escapeHtml(image.original_name || label) + '"></button><div class="photo-inline-actions"><button type="button" data-rts-photo-move="-1" data-rts-photo-key="' + escapeHtml(key) + '" data-field="' + field + '">上一张</button><button type="button" data-rts-photo-move="1" data-rts-photo-key="' + escapeHtml(key) + '" data-field="' + field + '">下一张</button></div></div>';
  }

  function renderCurrentReviewPanel(item) {
    const key = itemKey(item);
    const review = ensureReview(key);
    const supplement = review.decision === "supplement" || review.supplement;
    return '<div class="review-panel-inner" data-item-id="' + escapeHtml(key) + '"><h2>RTS/GTS审核</h2>' + renderDecisionControl(key, review) + '<label class="field rts-review-note"><span>单项复核意见</span><textarea class="item-review" data-item-key="' + escapeHtml(key) + '" rows="5" placeholder="填写审核判断、疑点或处理意见">' + escapeHtml(review.note) + '</textarea></label><div class="rts-supplement-inline' + (supplement ? "" : " is-disabled") + '"><label class="rts-supplement-toggle"><input type="checkbox" class="supplement-enable"' + (supplement ? " checked" : "") + '> 要求一线补充此步骤</label><div class="supplement-type-grid"><label><input type="checkbox" class="supplement-type" data-field="need_record"' + (review.need_record ? " checked" : "") + '> 补记录</label><label><input type="checkbox" class="supplement-type" data-field="need_before"' + (review.need_before ? " checked" : "") + '> 补原始照片</label><label><input type="checkbox" class="supplement-type" data-field="need_after"' + (review.need_after ? " checked" : "") + '> 补调试后照片</label></div><label class="field"><span>补充要求</span><textarea class="supplement-requirement" rows="4" placeholder="请写清一线需要补充的具体内容。">' + escapeHtml(review.requirement) + '</textarea></label><div class="supplement-presets">' + Object.keys(PRESETS).map(function (label) { return '<button type="button" class="supplement-preset-btn" data-supplement-preset="' + escapeHtml(label) + '">' + escapeHtml(label) + '</button>'; }).join("") + '</div></div></div>';
  }

  function renderDecisionControl(key, review) {
    const name = "review-decision-" + encodeURIComponent(key);
    return '<div class="rts-decision-control" role="group" aria-label="步骤审核决定"><span>RTS/GTS审核决定</span><label><input type="radio" class="item-review-decision" name="' + escapeHtml(name) + '" value="approved"' + (review.decision === "approved" ? " checked" : "") + '> 通过</label><label><input type="radio" class="item-review-decision" name="' + escapeHtml(name) + '" value="supplement"' + (review.decision === "supplement" ? " checked" : "") + '> 需补充</label></div>';
  }

  function onCurrentReviewChanged(event) {
    const panel = event.currentTarget;
    const key = (panel.querySelector(".review-panel-inner") || {}).dataset && panel.querySelector(".review-panel-inner").dataset.itemId;
    if (!key) return;
    const review = ensureReview(key);
    const target = event.target;
    let needsRender = false;
    if (target.classList.contains("item-review-decision")) {
      review.decision = target.value;
      review.supplement = target.value === "supplement";
      needsRender = true;
    } else if (target.classList.contains("supplement-enable")) {
      review.supplement = target.checked;
      if (target.checked) review.decision = "supplement";
      else if (review.decision === "supplement") review.decision = "";
      needsRender = true;
    } else if (target.classList.contains("item-review")) {
      review.note = target.value;
    } else if (target.classList.contains("supplement-requirement")) {
      review.requirement = target.value;
    } else if (target.classList.contains("supplement-type")) {
      review[target.dataset.field] = target.checked;
    } else {
      return;
    }
    updateReviewProgress();
    renderRtsNavigator();
    if (needsRender) {
      renderRtsStepReviewList();
      if (review.decision === "supplement") {
        const field = document.querySelector(".supplement-requirement");
        if (field) field.focus({ preventScroll: true });
      }
    }
  }

  function appendSupplementPreset(label) {
    const item = getActiveItem();
    if (!item || !PRESETS[label]) return;
    const review = ensureReview(itemKey(item));
    review.supplement = true;
    review.decision = "supplement";
    review.requirement = review.requirement ? review.requirement + "\n" + PRESETS[label] : PRESETS[label];
    updateReviewProgress();
    renderRtsNavigator();
    renderRtsStepReviewList();
    const field = document.querySelector(".supplement-requirement");
    if (field) field.focus({ preventScroll: true });
  }

  function renderRtsNavigator() {
    const root = document.getElementById("rtsStepNavigationList");
    const all = allReportItems();
    const filtered = getFilteredRtsItems();
    const counts = { all: all.length, unreviewed: 0, attention: 0, missing: 0, supplement: 0, approved: 0 };
    all.forEach(function (item) {
      const review = ensureReview(itemKey(item));
      if (!review.decision) counts.unreviewed += 1;
      if (isAttentionItem(item)) counts.attention += 1;
      if (isMissingItem(item)) counts.missing += 1;
      if (review.decision === "supplement" || review.supplement) counts.supplement += 1;
      if (review.decision === "approved") counts.approved += 1;
    });
    document.querySelectorAll("[data-rts-filter]").forEach(function (button) {
      const active = button.dataset.rtsFilter === state.rtsFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    document.querySelectorAll("[data-rts-filter-count]").forEach(function (node) { node.textContent = counts[node.dataset.rtsFilterCount] || 0; });
    if (!filtered.length) {
      root.innerHTML = '<div class="empty-state">当前筛选没有步骤。<button type="button" data-rts-nav-filter-all>查看全部</button></div>';
      const reset = root.querySelector("[data-rts-nav-filter-all]");
      if (reset) reset.addEventListener("click", function () { state.rtsFilter = "all"; applyRtsFilter(); });
      return;
    }
    root.innerHTML = filtered.map(function (item) {
      const key = itemKey(item);
      const status = getRtsItemStatus(item);
      const active = key === state.activeItemId;
      return '<button type="button" class="item-navigation-entry' + (active ? " is-active" : "") + '" data-rts-nav="' + escapeHtml(key) + '" aria-current="' + (active ? "step" : "false") + '"><span class="navigator-step status-' + status.kind + '">' + (active ? "▶" : status.icon) + '</span><span><span class="navigator-title" title="' + escapeHtml(item.action || "未命名排查项") + '">' + escapeHtml(item.display_step || item.step || "") + "｜" + escapeHtml(item.action || "未命名排查项") + '</span><span class="navigator-status">一线：' + escapeHtml(normalizeConclusion(item)) + "｜" + escapeHtml(status.label) + '</span></span></button>';
    }).join("");
  }

  function setActiveRtsItem(itemId, options) {
    if (!allReportItems().some(function (item) { return itemKey(item) === itemId; })) return;
    state.activeItemId = itemId;
    renderRtsStepReviewList();
    renderRtsNavigator();
    if (options && options.scroll) document.getElementById("rtsCurrentContent").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyRtsFilter() {
    const filtered = getFilteredRtsItems();
    if (filtered.length && !filtered.some(function (item) { return itemKey(item) === state.activeItemId; })) state.activeItemId = itemKey(filtered[0]);
    renderRtsNavigator();
    renderRtsStepReviewList();
  }

  function moveActiveRtsItem(delta) {
    const items = getFilteredRtsItems();
    if (!items.length) return;
    let index = items.findIndex(function (item) { return itemKey(item) === state.activeItemId; });
    if (index < 0) index = 0;
    index = (index + delta + items.length) % items.length;
    setActiveRtsItem(itemKey(items[index]), { scroll: true });
  }

  function goToNextUnreviewed() {
    const all = allReportItems();
    const start = Math.max(0, all.findIndex(function (item) { return itemKey(item) === state.activeItemId; }));
    for (let offset = 1; offset <= all.length; offset += 1) {
      const item = all[(start + offset) % all.length];
      if (!ensureReview(itemKey(item)).decision) {
        state.rtsFilter = "unreviewed";
        setActiveRtsItem(itemKey(item), { scroll: true });
        return;
      }
    }
    showFeedback("success", "逐项审核已完成", "当前没有未审核步骤。");
  }

  function updateRtsPosition() {
    const all = allReportItems();
    const index = all.findIndex(function (item) { return itemKey(item) === state.activeItemId; });
    document.getElementById("rtsPositionText").textContent = "第 " + (index >= 0 ? index + 1 : 0) + " / " + all.length + " 项";
  }

  function updateReviewProgress() {
    const all = allReportItems();
    let reviewed = 0;
    let supplements = 0;
    all.forEach(function (item) {
      const review = ensureReview(itemKey(item));
      if (review.decision) reviewed += 1;
      if (review.decision === "supplement" || review.supplement) supplements += 1;
    });
    document.getElementById("stepReviewCount").textContent = reviewed + " / " + all.length + " 已审核";
    document.getElementById("supplementCount").textContent = supplements + " 项需补充";
    updateOverallReviewSuggestion(reviewed, supplements, all.length);
  }

  function updateOverallReviewSuggestion(reviewed, supplements, total) {
    const select = document.querySelector("[name='review_conclusion']");
    if (!select || select.dataset.userSelected === "1") return;
    if (supplements) select.value = "资料不完整，需补充";
    else if (total && reviewed === total) select.value = "审核通过，可进入分析";
    updateReviewFormState();
  }

  function updateReviewFormState() {
    const fields = Array.prototype.slice.call(document.querySelectorAll("#rtsForm [data-required]"));
    const complete = fields.length && fields.every(function (field) { return String(field.value || "").trim(); });
    const status = document.getElementById("reviewFormStatus");
    status.textContent = complete ? "已完成" : "未完成";
    status.className = "tag " + (complete ? "is-complete" : "is-incomplete");
  }

  function confirmMarkAllApproved() {
    if (!state.sourceData) { showErrors(["请先上传一线报告包。"]); return; }
    showConfirmation("确认将所有步骤标记为“通过”吗？", '<p>此操作会：<br>1. 将全部步骤设置为通过；<br>2. 清除已勾选的“需补充”状态；<br>3. 保留已经填写的单项复核意见。</p>', "确认全部通过", function () {
      allReportItems().forEach(function (item) {
        const review = ensureReview(itemKey(item));
        review.decision = "approved";
        review.supplement = false;
        review.need_record = false;
        review.need_before = false;
        review.need_after = false;
      });
      updateReviewProgress();
      renderRtsNavigator();
      renderRtsStepReviewList();
    });
  }

  function validateReviewForm() {
    const missing = Array.prototype.slice.call(document.querySelectorAll("#rtsForm [data-required]")).find(function (field) { return !String(field.value || "").trim(); });
    if (!missing) return true;
    showErrors(["请先完成总体审核意见中的“" + (missing.closest(".field").querySelector("span").textContent || "必填项") + "”。"]);
    missing.focus();
    return false;
  }

  function generateRtsReport() {
    hideErrors();
    if (!state.sourceData) { showErrors(["请先上传一线报告 ZIP 或 report_data.json。"]); return; }
    if (!validateReviewForm()) return;
    const unreviewed = unreviewedStepCount();
    if (unreviewed) {
      state.rtsFilter = "unreviewed";
      const first = getFilteredRtsItems()[0];
      if (first) setActiveRtsItem(itemKey(first), { scroll: true });
      showErrors(["仍有 " + unreviewed + " 个步骤未选择“通过”或“需补充”，已定位到第一项。"]);
      return;
    }
    showGenerateConfirmation();
  }

  function showGenerateConfirmation() {
    const all = allReportItems();
    const supplementRequests = collectSupplementRequests();
    const approved = all.length - supplementRequests.length;
    const count = function (key) { return supplementRequests.filter(function (request) { return request[key]; }).length; };
    const conclusion = (document.querySelector("[name='review_conclusion']") || {}).value || "未填写";
    showConfirmation("确认生成RTS/GTS返回ZIP", '<p>审核完成度：' + all.length + " / " + all.length + '<br><br>通过：' + approved + '项<br>需补充：' + supplementRequests.length + '项<br><br>补记录：' + count("need_record") + '项<br>补原始照片：' + count("need_before") + '项<br>补调试后照片：' + count("need_after") + '项<br><br>总体审核结论：' + escapeHtml(conclusion) + '</p>', "确认生成返回ZIP", submitRtsReport);
  }

  async function submitRtsReport() {
    if (!startBusy("正在生成RTS/GTS审核返回报告", "正在整理审核意见、补充清单和返回 ZIP，请稍候。")) return;
    try {
      const data = await fetchJson("/api/rts/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_data: state.sourceData, source_session_id: state.sourceSessionId, review: collectReview(), item_reviews: collectItemReviews(), supplement_requests: collectSupplementRequests() }) });
      state.lastOutputPath = data.output_dir || "";
      setStatus("RTS/GTS报告已生成", "ok");
      const links = '<a href="' + escapeHtml(data.report_url) + '" target="_blank">打开HTML报告</a><a href="' + escapeHtml(data.zip_url) + '" target="_blank">下载ZIP</a>';
      showFeedback("success", "报告已生成", "RTS/GTS返回 ZIP 已生成，可发送给一线补充或复核。", links);
      finishBusy("success", "RTS/GTS审核返回报告生成成功", "返回 ZIP 已生成，可以发送给一线补充。", links);
    } catch (err) {
      const message = errorMessage(err, "RTS/GTS审核返回报告生成失败。");
      setStatus("生成失败", "error");
      showErrors(err.errors || [message]);
      finishBusy("error", "RTS/GTS审核返回报告生成失败", message);
    }
  }

  function collectReview() {
    const data = {};
    Array.prototype.slice.call(document.querySelectorAll("#rtsForm input[name], #rtsForm textarea[name], #rtsForm select[name]")).forEach(function (node) { data[node.name] = node.value || ""; });
    data.initial_judgement = [];
    return data;
  }

  function collectItemReviews() {
    const result = {};
    allReportItems().forEach(function (item) {
      const review = ensureReview(itemKey(item));
      if (review.decision || String(review.note || "").trim()) result[itemKey(item)] = { decision: review.decision || "", note: String(review.note || "").trim() };
    });
    return result;
  }

  function collectSupplementRequests() {
    return allReportItems().filter(function (item) {
      const review = ensureReview(itemKey(item));
      return review.supplement || review.decision === "supplement";
    }).map(function (item) {
      const review = ensureReview(itemKey(item));
      return { item_id: itemKey(item), need_record: Boolean(review.need_record), need_before: Boolean(review.need_before), need_after: Boolean(review.need_after), requirement: review.requirement || "" };
    });
  }

  function unreviewedStepCount() {
    return allReportItems().filter(function (item) { return !ensureReview(itemKey(item)).decision; }).length;
  }

  async function openOutputFolder() {
    if (!startBusy("正在打开输出文件夹", "正在调用系统文件夹，请稍候。")) return;
    try {
      await fetchJson("/api/open-output", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: state.lastOutputPath || "" }) });
      finishBusy("success", "输出文件夹已打开", "请在系统文件夹中查看生成的报告文件。");
    } catch (err) {
      const message = errorMessage(err, "打开输出文件夹失败。");
      showErrors([message]);
      finishBusy("error", "打开输出文件夹失败", message);
    }
  }

  function showErrors(errors) {
    const panel = document.getElementById("rtsErrorPanel");
    const list = document.getElementById("rtsErrorList");
    panel.classList.remove("hidden");
    list.innerHTML = '<div class="error-summary"><div><h2>需要处理的内容</h2><div class="error-breakdown">' + (errors || []).map(function (message) { return '<span>' + escapeHtml(typeof message === "string" ? message : message.message || "审核信息不完整") + '</span>'; }).join("") + '</div></div></div>';
  }

  function hideErrors() { document.getElementById("rtsErrorPanel").classList.add("hidden"); }

  function showFeedback(kind, title, message, linksHtml) {
    const panel = document.getElementById("rtsFeedbackPanel");
    panel.classList.remove("hidden");
    panel.innerHTML = '<strong>' + escapeHtml(title) + '</strong><p class="help-text">' + escapeHtml(message) + '</p>' + (linksHtml ? '<div class="result-links">' + linksHtml + '</div>' : "");
  }

  function initRtsImageModal() {
    document.addEventListener("click", function (event) {
      const preview = event.target.closest("[data-rts-preview-image]");
      if (preview) { event.preventDefault(); openRtsImageModal(preview); }
    });
    document.getElementById("rtsModalClose").addEventListener("click", closeRtsImageModal);
    document.getElementById("rtsModalPrev").addEventListener("click", function () { moveRtsImage(-1); });
    document.getElementById("rtsModalNext").addEventListener("click", function () { moveRtsImage(1); });
    document.getElementById("rtsModalZoomOut").addEventListener("click", function () { setRtsZoom(state.imageModal.zoom / 1.2); });
    document.getElementById("rtsModalZoomIn").addEventListener("click", function () { setRtsZoom(state.imageModal.zoom * 1.2); });
    document.getElementById("rtsModalRotateLeft").addEventListener("click", function () { rotateRtsImage(-90); });
    document.getElementById("rtsModalRotateRight").addEventListener("click", function () { rotateRtsImage(90); });
    document.getElementById("rtsModalReset").addEventListener("click", resetRtsImageView);
    const stage = document.getElementById("rtsImageStage");
    stage.addEventListener("wheel", function (event) { if (document.getElementById("rtsImageModal").classList.contains("hidden")) return; event.preventDefault(); setRtsZoom(state.imageModal.zoom * (event.deltaY < 0 ? 1.12 : 0.88)); }, { passive: false });
    stage.addEventListener("mousedown", function (event) { state.imageModal.dragging = true; state.imageModal.startX = event.clientX - state.imageModal.offsetX; state.imageModal.startY = event.clientY - state.imageModal.offsetY; });
    document.addEventListener("mousemove", function (event) { if (!state.imageModal.dragging) return; state.imageModal.offsetX = event.clientX - state.imageModal.startX; state.imageModal.offsetY = event.clientY - state.imageModal.startY; renderRtsModalImage(); });
    document.addEventListener("mouseup", function () { state.imageModal.dragging = false; });
    document.addEventListener("keydown", function (event) {
      if (document.getElementById("rtsImageModal").classList.contains("hidden")) return;
      if (event.key === "Escape") closeRtsImageModal();
      if (event.key === "ArrowLeft") moveRtsImage(-1);
      if (event.key === "ArrowRight") moveRtsImage(1);
      if (event.key === "+" || event.key === "=") setRtsZoom(state.imageModal.zoom * 1.2);
      if (event.key === "-") setRtsZoom(state.imageModal.zoom / 1.2);
      if (event.key === "r" || event.key === "R") rotateRtsImage(90);
    });
  }

  function openRtsImageModal(preview) {
    const item = getActiveItem();
    if (!item) return;
    const images = ["before_images", "after_images"].reduce(function (result, field) {
      return result.concat((item[field] || []).filter(function (image) { return image.preview_url; }).map(function (image) { return { url: image.preview_url, original_name: image.original_name || "RTS/GTS审核图片" }; }));
    }, []);
    if (!images.length) return;
    const matchUrl = preview.dataset.url || "";
    state.imageModal.images = images;
    state.imageModal.index = Math.max(0, images.findIndex(function (image) { return image.url === matchUrl; }));
    resetRtsImageView(false);
    document.getElementById("rtsImageModal").classList.remove("hidden");
    renderRtsModalImage();
  }

  function closeRtsImageModal() { document.getElementById("rtsImageModal").classList.add("hidden"); state.imageModal.dragging = false; }
  function moveRtsImage(delta) { const total = state.imageModal.images.length; if (!total) return; state.imageModal.index = (state.imageModal.index + delta + total) % total; resetRtsImageView(false); renderRtsModalImage(); }
  function setRtsZoom(value) { state.imageModal.zoom = Math.max(0.15, Math.min(value, 10)); renderRtsModalImage(); }
  function rotateRtsImage(delta) { state.imageModal.rotation = (state.imageModal.rotation + delta) % 360; renderRtsModalImage(); }
  function resetRtsImageView(render) { state.imageModal.zoom = 1; state.imageModal.rotation = 0; state.imageModal.offsetX = 0; state.imageModal.offsetY = 0; state.imageModal.dragging = false; if (render !== false) renderRtsModalImage(); }
  function renderRtsModalImage() {
    const image = state.imageModal.images[state.imageModal.index];
    if (!image) return;
    const node = document.getElementById("rtsModalImage");
    node.onerror = function () {
      closeRtsImageModal();
      showFeedback("error", "照片预览失败", "这张照片未能加载，请重新导入一线 ZIP 或检查原照片文件。");
    };
    node.src = image.url;
    node.alt = image.original_name || "RTS/GTS审核图片";
    node.style.transform = "translate(-50%, -50%) translate(" + state.imageModal.offsetX + "px, " + state.imageModal.offsetY + "px) rotate(" + state.imageModal.rotation + "deg) scale(" + state.imageModal.zoom + ")";
    document.getElementById("rtsModalCounter").textContent = (state.imageModal.index + 1) + " / " + state.imageModal.images.length;
  }
})();

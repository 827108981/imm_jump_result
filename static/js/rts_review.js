(function () {
  const state = {
    sourceData: null,
    sourceSessionId: "",
    lastOutputPath: "",
    rtsFilter: "all",
    busy: {
      active: false
    },
    imageModal: {
      images: [],
      index: 0,
      zoom: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      dragging: false,
      startX: 0,
      startY: 0
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    const dateInput = document.querySelector("input[name='review_date']");
    if (dateInput && !dateInput.value) dateInput.value = localDateTimeString();
    initBusyModal();
    document.getElementById("rtsFileInput").addEventListener("change", importSourceReport);
    document.getElementById("generateRtsBtn").addEventListener("click", generateRtsReport);
    document.getElementById("openOutputBtn").addEventListener("click", openOutputFolder);
    initRtsImageModal();
    document.querySelectorAll("[data-rts-filter]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.rtsFilter = button.dataset.rtsFilter || "all";
        document.querySelectorAll("[data-rts-filter]").forEach(function (node) {
          node.classList.toggle("active", node === button);
        });
        applyRtsFilter();
      });
    });
  });

  function localDateTimeString() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = String(now.getMinutes()).padStart(2, "0");
    return now.getFullYear() + "-" + month + "-" + day + "T" + hour + ":" + minute;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options || {});
    let data = {};
    try { data = await response.json(); } catch (err) { data = { ok: false, message: "服务响应异常。" }; }
    if (!response.ok || data.ok === false) throw data;
    return data;
  }

  function initBusyModal() {
    const closeBtn = document.getElementById("busyCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeBusy);
  }

  function setBusyContent(kind, title, message, linksHtml) {
    const modal = document.getElementById("busyModal");
    if (!modal) return;
    modal.className = "busy-modal" + (kind ? " " + kind : "");
    document.getElementById("busyTitle").textContent = title || "正在处理";
    document.getElementById("busyMessage").textContent = message || "请稍候。";
    document.getElementById("busyLinks").innerHTML = linksHtml || "";
    document.getElementById("busyCloseBtn").classList.toggle("hidden", kind === "busy");
  }

  function startBusy(title, message) {
    if (state.busy.active) return false;
    state.busy.active = true;
    setBusyContent("busy", title || "正在处理", message || "请稍候，不要重复点击。", "");
    return true;
  }

  function finishBusy(kind, title, message, linksHtml) {
    state.busy.active = false;
    setBusyContent(kind || "success", title || "处理完成", message || "", linksHtml || "");
  }

  function showFeedback(kind, title, message, linksHtml) {
    state.busy.active = false;
    setBusyContent(kind || "success", title || "处理完成", message || "", linksHtml || "");
  }

  function closeBusy() {
    if (state.busy.active) return;
    const modal = document.getElementById("busyModal");
    if (modal) modal.classList.add("hidden");
  }

  function errorMessage(err, fallback) {
    if (err && err.message) return err.message;
    if (err && err.errors && err.errors.length) return err.errors[0].message || err.errors[0];
    return fallback;
  }

  function setStatus(text, kind) {
    const node = document.getElementById("rtsStatus");
    node.textContent = text;
    node.className = "status-pill" + (kind ? " " + kind : "");
  }

  async function importSourceReport(event) {
    const input = event.target;
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    hideErrors();
    setStatus("解析中", "");
    const form = new FormData();
    form.append("report_file", file);
    if (!startBusy("正在导入一线报告", "正在解析 ZIP、读取照片和 39 项记录，请稍候。")) return;
    try {
      const data = await fetchJson("/api/rts/import", { method: "POST", body: form });
      state.sourceData = data.source_data;
      state.sourceSessionId = data.session_id;
      state.rtsFilter = "all";
      renderSourceSummary();
      renderRtsStepReviewList();
      setStatus("已读取一线报告", "ok");
      finishBusy("success", "一线报告导入成功", "已读取一线报告，可以开始逐项审核。");
    } catch (err) {
      const message = errorMessage(err, "一线报告解析失败。");
      setStatus("读取失败", "error");
      showErrors([message]);
      finishBusy("error", "一线报告导入失败", message);
    } finally {
      if (input) input.value = "";
    }
  }

  function renderSourceSummary() {
    const data = state.sourceData || {};
    const base = data.base_info || {};
    const stats = data.stats || {};
    const issueNo = data.issue_no || base.issue_no || "-";
    document.getElementById("sourceIssueNo").textContent = issueNo;
    document.getElementById("sourceAbnormal").textContent = stats.abnormal_count || 0;
    document.getElementById("sourceHandled").textContent = stats.handled_count || 0;
    document.getElementById("sourcePending").textContent = stats.pending_count || 0;

    const summary = document.getElementById("sourceSummary");
    summary.classList.remove("hidden");
    summary.innerHTML = [
      '<h2>已读取一线报告</h2>',
      '<div class="rts-summary-grid">',
      summaryCell("问题编号", issueNo),
      summaryCell("医院名称", base.hospital || "未填写"),
      summaryCell("设备型号", base.model || "未填写"),
      summaryCell("设备序列号", base.serial || "未填写"),
      summaryCell("跳值项目", base.jump_project || "未填写"),
      summaryCell("一线工程师", base.engineer || "未填写"),
      summaryCell("排查日期", base.check_date || "未填写"),
      summaryCell("上传图片", stats.uploaded_image_count || 0),
      '</div>',
      '<div class="rts-source-problem"><span>问题描述</span><p>' + escapeHtml(base.problem || "未填写") + '</p></div>'
    ].join("");
  }

  function summaryCell(label, value) {
    return '<div><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }

  function allReportItems() {
    const data = state.sourceData || {};
    const items = [];
    (data.groups || []).forEach(function (group) {
      (group.items || []).forEach(function (item) {
        items.push(item);
      });
    });
    return items.sort(function (a, b) {
      return Number(a.sort_order || a.index || 0) - Number(b.sort_order || b.index || 0);
    });
  }

  function isAttentionItem(item) {
    return ["异常", "已处理", "待确认"].indexOf(item.conclusion || "正常") !== -1;
  }

  function isMissingItem(item) {
    const measured = String(item.measured_value || "").trim();
    const beforeCount = (item.before_images || []).length;
    const afterCount = (item.after_images || []).length;
    if (item.record_required && measured.length < 2) return true;
    if (item.before_required && !beforeCount) return true;
    if (item.after_required && !afterCount) return true;
    return false;
  }

  function conclusionClass(value) {
    if (value === "异常") return "abnormal";
    if (value === "已处理") return "handled";
    if (value === "待确认") return "pending";
    return "normal";
  }

  function renderRtsStepReviewList() {
    const list = allReportItems();
    const root = document.getElementById("rtsStepReviewList");
    document.getElementById("stepReviewCount").textContent = list.length + " 项";
    document.getElementById("supplementCount").textContent = "0 项已选";
    document.querySelectorAll("[data-rts-filter]").forEach(function (button) {
      button.classList.toggle("active", (button.dataset.rtsFilter || "all") === state.rtsFilter);
    });

    if (!list.length) {
      root.innerHTML = '<div class="empty-state">请先上传一线报告包。</div>';
      return;
    }

    root.innerHTML = list.map(renderRtsStepCard).join("");
    root.querySelectorAll("input, textarea").forEach(function (node) {
      node.addEventListener("input", onStepCardChanged);
      node.addEventListener("change", onStepCardChanged);
    });
    updateSupplementCount();
    applyRtsFilter();
  }

  function renderRtsStepCard(item, index) {
    const key = item.id || item.display_step || item.step || String(index);
    const attention = isAttentionItem(item);
    const missing = isMissingItem(item);
    return [
      '<article class="rts-step-card' + (attention ? " is-attention" : "") + (missing ? " is-missing" : "") + '" data-item-id="' + escapeHtml(key) + '" data-attention="' + (attention ? "1" : "0") + '" data-missing="' + (missing ? "1" : "0") + '">',
      '<div class="rts-step-head">',
      '<div class="rts-step-title">',
      '<strong>' + escapeHtml(item.display_step || item.step || (index + 1)) + '｜' + escapeHtml(item.action || "未命名排查项") + '</strong>',
      '<small>分类：' + escapeHtml(item.category || "未分类") + '</small>',
      '</div>',
      '<div class="rts-step-badges">',
      renderRequiredTag("实测", item.record_required),
      renderRequiredTag("原始照片", item.before_required),
      renderRequiredTag("调试后照片", item.after_required),
      '<span class="conclusion-pill conclusion-' + conclusionClass(item.conclusion) + '">' + escapeHtml(item.conclusion || "正常") + '</span>',
      '</div>',
      '</div>',
      '<div class="rts-step-body">',
      '<div class="rts-step-grid">',
      '<div class="rts-source-record"><span>排查动作</span><p>' + escapeHtml(item.action || "未填写") + '</p></div>',
      '<div class="rts-source-record"><span>合格指标</span><p>' + escapeHtml(item.standard || "未填写") + '</p></div>',
      '<div class="rts-source-record"><span>一线实测情况记录</span><p>' + escapeHtml(item.measured_value || "未填写") + '</p></div>',
      renderPhotoBlock(item, "before_images", "原始状态照片"),
      renderPhotoBlock(item, "after_images", "调试或维护后照片"),
      '<label class="field rts-review-note"><span>RTS对该步骤的复核意见</span><textarea class="item-review" data-item-key="' + escapeHtml(key) + '" rows="4" placeholder="可填写该步骤的审核判断、疑点或处理意见"></textarea></label>',
      '</div>',
      '<div class="rts-supplement-inline">',
      '<label class="rts-supplement-toggle"><input type="checkbox" class="supplement-enable"> 要求一线补充此步骤</label>',
      '<div class="supplement-type-grid">',
      '<label><input type="checkbox" class="supplement-type" data-field="need_record"> 补记录</label>',
      '<label><input type="checkbox" class="supplement-type" data-field="need_before"> 补原始照片</label>',
      '<label><input type="checkbox" class="supplement-type" data-field="need_after"> 补调试后照片</label>',
      '</div>',
      '<textarea class="supplement-requirement" rows="2" placeholder="填写返回给一线的补充要求，例如：请补充连续3次测试记录和现场照片。"></textarea>',
      '</div>',
      '</div>',
      '</article>'
    ].join("");
  }

  function renderRequiredTag(label, required) {
    return '<span class="tag ' + (required ? "required" : "optional") + '">' + escapeHtml(label) + " " + (required ? "必填" : "选填") + '</span>';
  }

  function renderPhotoBlock(item, field, label) {
    const images = item[field] || [];
    const previewImages = images.filter(function (img) { return img.preview_url; });
    if (!images.length) {
      return '<div class="rts-source-record"><span>' + escapeHtml(label) + '</span><p class="empty-state compact">未上传</p></div>';
    }
    if (!previewImages.length) {
      return '<div class="rts-source-record"><span>' + escapeHtml(label) + '</span><p class="empty-state compact">已记录 ' + images.length + ' 张图片。若需预览图片，请让一线上传 ZIP 包。</p></div>';
    }
    return [
      '<div class="rts-source-record">',
      '<span>' + escapeHtml(label) + '</span>',
      '<div class="rts-mini-photo-grid">',
      previewImages.map(function (img, index) {
        return [
          '<button type="button" class="rts-preview-thumb" data-rts-preview-image data-url="' + escapeHtml(img.preview_url) + '" data-name="' + escapeHtml(img.original_name || label || "图片") + '" data-index="' + index + '">',
          '<img src="' + escapeHtml(img.preview_url) + '" alt="' + escapeHtml(img.original_name || "图片") + '">',
          '</button>'
        ].join("");
      }).join(""),
      '</div>',
      '</div>'
    ].join("");
  }

  function onStepCardChanged(event) {
    const card = event.target.closest(".rts-step-card");
    if (card) {
      const enabled = Boolean(card.querySelector(".supplement-enable:checked"));
      card.classList.toggle("has-supplement", enabled);
    }
    updateSupplementCount();
    if (state.rtsFilter === "supplement") applyRtsFilter();
  }

  function updateSupplementCount() {
    const count = document.querySelectorAll(".rts-step-card .supplement-enable:checked").length;
    document.getElementById("supplementCount").textContent = count + " 项已选";
    const supplementRequired = document.querySelector("[name='supplement_required']");
    if (supplementRequired) supplementRequired.value = count ? "是" : "否";
  }

  function applyRtsFilter() {
    const cards = Array.prototype.slice.call(document.querySelectorAll(".rts-step-card"));
    let visible = 0;
    cards.forEach(function (card) {
      const match =
        state.rtsFilter === "all" ||
        (state.rtsFilter === "attention" && card.dataset.attention === "1") ||
        (state.rtsFilter === "missing" && card.dataset.missing === "1") ||
        (state.rtsFilter === "supplement" && card.querySelector(".supplement-enable:checked"));
      card.classList.toggle("hidden", !match);
      if (match) visible += 1;
    });
    document.getElementById("stepReviewCount").textContent = visible + " / " + cards.length + " 项";
  }

  function initRtsImageModal() {
    document.addEventListener("click", function (event) {
      const preview = event.target.closest("[data-rts-preview-image]");
      if (preview) {
        event.preventDefault();
        openRtsImageModal(preview);
      }
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
    stage.addEventListener("wheel", function (event) {
      if (document.getElementById("rtsImageModal").classList.contains("hidden")) return;
      event.preventDefault();
      setRtsZoom(state.imageModal.zoom * (event.deltaY < 0 ? 1.12 : 0.88));
    }, { passive: false });
    stage.addEventListener("mousedown", function (event) {
      state.imageModal.dragging = true;
      state.imageModal.startX = event.clientX - state.imageModal.offsetX;
      state.imageModal.startY = event.clientY - state.imageModal.offsetY;
    });
    document.addEventListener("mousemove", function (event) {
      if (!state.imageModal.dragging) return;
      state.imageModal.offsetX = event.clientX - state.imageModal.startX;
      state.imageModal.offsetY = event.clientY - state.imageModal.startY;
      renderRtsModalImage();
    });
    document.addEventListener("mouseup", function () {
      state.imageModal.dragging = false;
    });
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

  function collectRtsPreviewImages() {
    return Array.prototype.slice.call(document.querySelectorAll("[data-rts-preview-image]")).map(function (node) {
      return {
        url: node.dataset.url || "",
        original_name: node.dataset.name || "RTS审核图片"
      };
    }).filter(function (image) { return image.url; });
  }

  function openRtsImageModal(previewNode) {
    const previews = Array.prototype.slice.call(document.querySelectorAll("[data-rts-preview-image]"));
    state.imageModal.images = collectRtsPreviewImages();
    state.imageModal.index = Math.max(0, previews.indexOf(previewNode));
    resetRtsImageView(false);
    document.getElementById("rtsImageModal").classList.remove("hidden");
    renderRtsModalImage();
  }

  function closeRtsImageModal() {
    document.getElementById("rtsImageModal").classList.add("hidden");
    state.imageModal.dragging = false;
  }

  function moveRtsImage(delta) {
    const total = state.imageModal.images.length;
    if (!total) return;
    state.imageModal.index = (state.imageModal.index + delta + total) % total;
    resetRtsImageView(false);
    renderRtsModalImage();
  }

  function setRtsZoom(value) {
    state.imageModal.zoom = Math.max(0.15, Math.min(value, 10));
    renderRtsModalImage();
  }

  function rotateRtsImage(delta) {
    state.imageModal.rotation = (state.imageModal.rotation + delta) % 360;
    renderRtsModalImage();
  }

  function resetRtsImageView(render) {
    state.imageModal.zoom = 1;
    state.imageModal.rotation = 0;
    state.imageModal.offsetX = 0;
    state.imageModal.offsetY = 0;
    state.imageModal.dragging = false;
    if (render !== false) renderRtsModalImage();
  }

  function renderRtsModalImage() {
    const image = state.imageModal.images[state.imageModal.index];
    if (!image) return;
    const node = document.getElementById("rtsModalImage");
    node.src = image.url;
    node.alt = image.original_name || "RTS审核图片";
    node.style.transform = [
      "translate(-50%, -50%)",
      "translate(" + state.imageModal.offsetX + "px, " + state.imageModal.offsetY + "px)",
      "rotate(" + state.imageModal.rotation + "deg)",
      "scale(" + state.imageModal.zoom + ")"
    ].join(" ");
    document.getElementById("rtsModalCounter").textContent = (state.imageModal.index + 1) + " / " + state.imageModal.images.length;
  }

  function collectReview() {
    const form = document.getElementById("rtsForm");
    const data = {};
    Array.prototype.slice.call(form.querySelectorAll("input[name], textarea[name], select[name]")).forEach(function (node) {
      data[node.name] = node.value || "";
    });
    data.initial_judgement = Array.prototype.slice.call(document.querySelectorAll("#judgementChecks input:checked")).map(function (node) { return node.value; });
    return data;
  }

  function collectItemReviews() {
    const result = {};
    Array.prototype.slice.call(document.querySelectorAll(".item-review")).forEach(function (node) {
      if (node.value.trim()) result[node.dataset.itemKey] = node.value.trim();
    });
    return result;
  }

  function collectSupplementRequests() {
    const result = [];
    Array.prototype.slice.call(document.querySelectorAll(".rts-step-card")).forEach(function (card) {
      const enabled = card.querySelector(".supplement-enable");
      if (!enabled || !enabled.checked) return;
      result.push({
        item_id: card.dataset.itemId || "",
        need_record: Boolean(card.querySelector('[data-field="need_record"]:checked')),
        need_before: Boolean(card.querySelector('[data-field="need_before"]:checked')),
        need_after: Boolean(card.querySelector('[data-field="need_after"]:checked')),
        requirement: (card.querySelector(".supplement-requirement") || {}).value || ""
      });
    });
    return result;
  }

  async function generateRtsReport() {
    hideErrors();
    if (!state.sourceData) {
      showErrors(["请先上传一线报告 ZIP 或 report_data.json。"]);
      showFeedback("error", "无法生成RTS审核返回报告", "请先上传一线报告 ZIP 或 report_data.json。");
      return;
    }
    const review = collectReview();
    if (!startBusy("正在生成RTS审核返回报告", "正在整理审核意见、补充清单和返回 ZIP，请稍候。")) return;
    try {
      const data = await fetchJson("/api/rts/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_data: state.sourceData,
          source_session_id: state.sourceSessionId,
          review: review,
          item_reviews: collectItemReviews(),
          supplement_requests: collectSupplementRequests()
        })
      });
      state.lastOutputPath = data.output_dir;
      setStatus("RTS报告已生成", "ok");
      const links = '<a href="' + escapeHtml(data.report_url) + '" target="_blank">打开HTML报告</a><a href="' + escapeHtml(data.zip_url) + '" target="_blank">下载ZIP</a>';
      showResult('RTS审核返回报告已生成。<br><a href="' + escapeHtml(data.report_url) + '" target="_blank">打开HTML报告</a> ｜ <a href="' + escapeHtml(data.zip_url) + '" target="_blank">下载ZIP</a>', false);
      finishBusy("success", "RTS审核返回报告生成成功", "返回 ZIP 已生成，可以发送给一线补充。", links);
    } catch (err) {
      const message = errorMessage(err, "RTS审核返回报告生成失败。");
      setStatus("生成失败", "error");
      showErrors(err.errors || [message]);
      finishBusy("error", "RTS审核返回报告生成失败", message);
    }
  }

  async function openOutputFolder() {
    if (!startBusy("正在打开输出文件夹", "正在调用系统文件夹，请稍候。")) return;
    try {
      await fetchJson("/api/open-output", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: state.lastOutputPath || "" })
      });
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
    list.innerHTML = (errors || []).map(function (msg) { return '<div class="error-row">' + escapeHtml(msg) + '</div>'; }).join("");
  }

  function hideErrors() {
    document.getElementById("rtsErrorPanel").classList.add("hidden");
  }

  function showResult(html, isError) {
    const panel = document.getElementById("rtsFeedbackPanel") || document.getElementById("sourceSummary");
    panel.classList.remove("hidden");
    panel.innerHTML = '<h2>' + (isError ? "提示" : "生成成功") + '</h2><p class="help-text">' + html + '</p>';
  }
})();

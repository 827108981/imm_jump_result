(function () {
  const state = {
    sessionId: localStorage.getItem("jumpCheckSessionId") || makeId(),
    items: [],
    itemData: {},
    limits: {
      allowed_extensions: ["jpg", "jpeg", "png", "webp"],
      max_image_size: 5 * 1024 * 1024,
      max_images_per_field: 5
    },
    errorItemIds: new Set(),
    errorFields: new Set(),
    errorItemFields: {},
    lastOutputPath: "",
    supplementRequests: [],
    supplementMap: {},
    supplementOnly: false,
    activeItemId: "",
    itemFilter: "all",
    basicCollapsed: false,
    mobile: {
      taskId: "",
      token: "",
      url: "",
      lastSeq: 0,
      pollTimer: null
    },
    busy: {
      active: false
    },
    modal: {
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

  const CUSTOM_PROJECT_VALUE = "__custom__";

  localStorage.setItem("jumpCheckSessionId", state.sessionId);

  const FIELD_LABELS = {
    before_images: "原始状态照片",
    after_images: "调试或维护后照片"
  };

  document.addEventListener("DOMContentLoaded", function () {
    initBusyModal();
    initBasicForm();
    initToolbar();
    initItemEvents();
    initImageModal();
    initUsageGuide();
    initMoreTools();
    initWorkbench();
    loadTemplate();
    refreshDrafts();
  });

  function makeId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatSize(bytes) {
    const size = Number(bytes || 0);
    if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + " MB";
    if (size >= 1024) return Math.round(size / 1024) + " KB";
    return size + " B";
  }

  function localDateString() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return now.getFullYear() + "-" + month + "-" + day;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options || {});
    let data = {};
    try {
      data = await response.json();
    } catch (err) {
      data = { ok: false, message: "服务响应异常。" };
    }
    if (!response.ok || data.ok === false) {
      throw data;
    }
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

  function closeBusy() {
    if (state.busy.active) return;
    const modal = document.getElementById("busyModal");
    if (modal) modal.classList.add("hidden");
  }

  function errorMessage(err, fallback) {
    if (err && err.message) return err.message;
    if (err && err.errors && err.errors.length) {
      return err.errors[0].message || err.errors[0];
    }
    return fallback;
  }

  function setTemplateStatus(text, kind) {
    const node = document.getElementById("templateStatus");
    node.textContent = text;
    node.className = "status-pill" + (kind ? " " + kind : "");
  }

  function initBasicForm() {
    const form = document.getElementById("basicForm");
    const dateInput = form.querySelector("input[name='check_date']");
    if (dateInput && !dateInput.value) {
      dateInput.value = localDateString();
    }
    form.addEventListener("input", function (event) {
      if (event.target && event.target.name) {
        state.errorFields.delete(event.target.name);
        applyBaseFieldErrors();
      }
      if (event.target && (event.target.name === "model" || event.target.name === "jump_project")) {
        state.activeItemId = "";
        renderItems();
      }
      updateStats();
      updateBasicInfoState();
    });
    const projectSelect = document.getElementById("base_jump_project_select");
    if (projectSelect) {
      projectSelect.addEventListener("change", function () {
        const projectInput = document.getElementById("base_jump_project");
        if (!projectInput) return;
        if (projectSelect.value === CUSTOM_PROJECT_VALUE) {
          projectInput.value = "";
          projectInput.classList.remove("hidden");
          window.setTimeout(function () { projectInput.focus(); }, 0);
        } else {
          projectInput.value = projectSelect.value || "";
          projectInput.classList.add("hidden");
        }
        projectInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
      syncJumpProjectControl(document.getElementById("base_jump_project").value);
    }
    updateBasicInfoState();
  }

  function syncJumpProjectControl(value) {
    const projectSelect = document.getElementById("base_jump_project_select");
    const projectInput = document.getElementById("base_jump_project");
    if (!projectSelect || !projectInput) return;
    const project = String(value || "");
    const known = Array.from(projectSelect.options).some(function (option) { return option.value === project; });
    projectInput.value = project;
    projectSelect.value = project ? (known ? project : CUSTOM_PROJECT_VALUE) : "";
    projectInput.classList.toggle("hidden", !project || known);
  }

  function initToolbar() {
    document.getElementById("saveDraftBtn").addEventListener("click", saveDraft);
    document.getElementById("loadDraftBtn").addEventListener("click", loadSelectedDraft);
    document.getElementById("importRtsReviewBtn").addEventListener("click", function () {
      document.getElementById("importRtsReviewInput").click();
    });
    document.getElementById("importRtsReviewInput").addEventListener("change", importRtsReviewZip);
    document.getElementById("showSupplementOnlyBtn").addEventListener("click", function () {
      state.supplementOnly = true;
      state.itemFilter = "supplement";
      renderItems();
    });
    document.getElementById("showAllItemsBtn").addEventListener("click", function () {
      state.supplementOnly = false;
      state.itemFilter = "all";
      renderItems();
    });
    document.getElementById("checkSupplementBtn").addEventListener("click", checkSupplementCompletion);
    document.getElementById("checkBtn").addEventListener("click", checkCompleteness);
    document.getElementById("generateBtn").addEventListener("click", generateReport);
    document.getElementById("openOutputBtn").addEventListener("click", openOutputFolder);
    const mobileTaskBtn = document.getElementById("mobileTaskBtn");
    const mobileCopyBtn = document.getElementById("mobileCopyBtn");
    if (mobileTaskBtn) mobileTaskBtn.addEventListener("click", createMobileTask);
    if (mobileCopyBtn) mobileCopyBtn.addEventListener("click", copyMobileLink);
    document.getElementById("topCheckProxyBtn").addEventListener("click", function () {
      document.getElementById("checkBtn").click();
    });
    document.getElementById("topGenerateProxyBtn").addEventListener("click", function () {
      document.getElementById("generateBtn").click();
    });
    document.getElementById("mobilePanelCollapseBtn").addEventListener("click", toggleMobilePanel);
  }

  function initUsageGuide() {
    const guide = document.getElementById("usageNotice");
    const button = document.getElementById("usageToggleBtn");
    const expanded = localStorage.getItem("imm_jump_usage_expanded") === "1";
    setUsageGuideExpanded(expanded);
    button.addEventListener("click", function () {
      setUsageGuideExpanded(guide.classList.contains("is-collapsed"));
    });
  }

  function setUsageGuideExpanded(expanded) {
    const guide = document.getElementById("usageNotice");
    const button = document.getElementById("usageToggleBtn");
    if (!guide || !button) return;
    guide.classList.toggle("is-collapsed", !expanded);
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.textContent = expanded ? "收起说明" : "查看说明";
    localStorage.setItem("imm_jump_usage_expanded", expanded ? "1" : "0");
  }

  function initMoreTools() {
    const button = document.getElementById("moreToolsBtn");
    const panel = document.getElementById("moreToolsPanel");
    function closeMoreTools() {
      panel.classList.add("hidden");
      button.setAttribute("aria-expanded", "false");
    }
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      const willOpen = panel.classList.contains("hidden");
      panel.classList.toggle("hidden", !willOpen);
      button.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".more-tools-wrap")) closeMoreTools();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeMoreTools();
    });
  }

  function initWorkbench() {
    document.getElementById("basicInfoToggleBtn").addEventListener("click", toggleBasicInfo);
    document.getElementById("itemNavigationList").addEventListener("click", function (event) {
      const button = event.target.closest("[data-item-nav]");
      if (button) setActiveItem(button.dataset.itemNav, { scroll: true });
    });
    document.getElementById("itemFilterBar").addEventListener("click", function (event) {
      const button = event.target.closest("[data-item-filter]");
      if (button) setItemFilter(button.dataset.itemFilter);
    });
    document.getElementById("previousItemBtn").addEventListener("click", function () { moveActiveItem(-1); });
    document.getElementById("nextItemBtn").addEventListener("click", function () { moveActiveItem(1); });
    document.getElementById("nextTodoBtn").addEventListener("click", goToNextTodo);
    document.addEventListener("keydown", function (event) {
      if (event.isComposing || event.altKey && event.ctrlKey) return;
      const tag = (event.target && event.target.tagName || "").toLowerCase();
      const isEditor = tag === "textarea" || tag === "input" || tag === "select";
      if (event.altKey && event.key === "ArrowUp" && !isEditor) {
        event.preventDefault();
        moveActiveItem(-1);
      } else if (event.altKey && event.key === "ArrowDown" && !isEditor) {
        event.preventDefault();
        moveActiveItem(1);
      } else if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        goToNextTodo();
      } else if (event.ctrlKey && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        saveDraft();
      }
    });
  }

  function initItemEvents() {
    const root = document.getElementById("itemGroups");

    root.addEventListener("input", function (event) {
      const target = event.target;
      if (!target.matches(".item-textarea")) return;
      const item = ensureItemData(target.dataset.itemId);
      item.measured_value = target.value;
      clearItemFieldError(target.dataset.itemId, "measured_value");
      target.classList.remove("has-error");
      const fieldNode = target.closest(".item-field");
      if (fieldNode) fieldNode.classList.remove("has-error");
      const card = target.closest(".item-card");
      if (card && !state.errorItemIds.has(target.dataset.itemId)) card.classList.remove("has-error");
      updateStats();
    });

    root.addEventListener("focusout", function (event) {
      if (event.target.matches(".item-textarea")) refreshShortWarning(event.target.dataset.itemId);
    });

    root.addEventListener("change", function (event) {
      const target = event.target;
      if (!target.matches(".conclusion-select")) return;
      const item = ensureItemData(target.dataset.itemId);
      item.conclusion = target.value || "正常";
      updateStats();
      updateCurrentItemUI();
    });

    root.addEventListener("click", function (event) {
      const uploadButton = event.target.closest("[data-upload]");
      const deleteButton = event.target.closest("[data-delete-image]");
      const previewImage = event.target.closest("[data-preview-image]");
      const conclusionButton = event.target.closest("[data-conclusion]");
      const guideButton = event.target.closest("[data-item-guide-toggle]");

      if (conclusionButton) {
        const itemId = conclusionButton.dataset.itemId;
        const item = ensureItemData(itemId);
        item.conclusion = conclusionButton.dataset.conclusion || "正常";
        const select = root.querySelector(".conclusion-select[data-item-id='" + itemId + "']");
        if (select) {
          select.value = item.conclusion;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          updateStats();
          updateCurrentItemUI();
        }
        return;
      }

      if (guideButton) {
        const guide = guideButton.closest(".item-guide");
        const collapsed = guide.classList.toggle("is-collapsed");
        guideButton.textContent = collapsed ? "展开" : "收起";
        guideButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
        return;
      }

      if (uploadButton) {
        const itemId = uploadButton.dataset.itemId;
        const field = uploadButton.dataset.field;
        pickFiles(itemId, field);
      }

      if (deleteButton) {
        const itemId = deleteButton.dataset.itemId;
        const field = deleteButton.dataset.field;
        const index = Number(deleteButton.dataset.index);
        const item = ensureItemData(itemId);
        item[field].splice(index, 1);
        renderItems();
        updateStats();
      }

      if (previewImage) {
        const itemId = previewImage.dataset.itemId;
        const field = previewImage.dataset.field;
        const index = Number(previewImage.dataset.index);
        openImageModal(ensureItemData(itemId)[field], index);
      }
    });

    root.addEventListener("dragover", function (event) {
      const zone = event.target.closest(".upload-zone");
      if (!zone) return;
      event.preventDefault();
      zone.classList.add("dragover");
    });

    root.addEventListener("dragleave", function (event) {
      const zone = event.target.closest(".upload-zone");
      if (!zone) return;
      zone.classList.remove("dragover");
    });

    root.addEventListener("drop", function (event) {
      const zone = event.target.closest(".upload-zone");
      if (!zone) return;
      event.preventDefault();
      zone.classList.remove("dragover");
      handleFiles(zone.dataset.itemId, zone.dataset.field, event.dataTransfer.files);
    });
  }

  async function loadTemplate() {
    try {
      setTemplateStatus("读取模板中", "");
      const data = await fetchJson("/api/template");
      state.items = data.items || [];
      state.limits = data.limits || state.limits;
      state.items.forEach(function (item) {
        ensureItemData(item.id);
      });
      state.activeItemId = getDefaultActiveItemId();
      renderItems();
      updateStats();
      setTemplateStatus("模板已加载", "ok");
    } catch (err) {
      setTemplateStatus("模板异常", "error");
      showResult(err.message || "模板读取失败。", true);
    }
  }

  function ensureItemData(itemId) {
    if (!state.itemData[itemId]) {
      state.itemData[itemId] = {
        id: itemId,
        measured_value: "",
        conclusion: "正常",
        before_images: [],
        after_images: []
      };
    }
    return state.itemData[itemId];
  }

  function ensureItemFieldErrors(itemId) {
    if (!state.errorItemFields[itemId]) {
      state.errorItemFields[itemId] = new Set();
    }
    return state.errorItemFields[itemId];
  }

  function hasItemFieldError(itemId, field) {
    const fields = state.errorItemFields[itemId];
    return Boolean(fields && fields.has(field));
  }

  function clearItemFieldError(itemId, field) {
    const fields = state.errorItemFields[itemId];
    if (fields) {
      fields.delete(field);
      if (!fields.size) {
        delete state.errorItemFields[itemId];
        state.errorItemIds.delete(itemId);
      }
    } else {
      state.errorItemIds.delete(itemId);
    }
  }

  function renderItems() {
    const sortedItems = getSortedItems();
    const root = document.getElementById("itemGroups");
    if (!sortedItems.length) {
      root.innerHTML = '<div class="empty-state">当前没有可填写的排查项。</div>';
      renderItemNavigator();
      return;
    }
    if (!state.activeItemId || !sortedItems.some(function (item) { return item.id === state.activeItemId; })) {
      state.activeItemId = getDefaultActiveItemId(sortedItems);
    }
    root.innerHTML = sortedItems.map(renderItem).join("");
    const filtered = getFilteredItems();
    if (filtered.length && !filtered.some(function (item) { return item.id === state.activeItemId; })) {
      state.activeItemId = filtered[0].id;
    }
    renderItemNavigator();
    updateCurrentItemUI();
  }

  function renderItem(item) {
    const data = ensureItemData(item.id);
    const hasError = state.errorItemIds.has(item.id);
    const recordError = hasItemFieldError(item.id, "measured_value");
    const supplement = state.supplementMap[item.id];
    return [
      '<article class="item-card' + (hasError ? " has-error" : "") + (supplement ? " needs-supplement" : "") + '" id="' + item.id + '" data-item-id="' + escapeHtml(item.id) + '">',
      '<div class="item-card-header">',
      '<div class="item-title">',
      '<strong>' + escapeHtml(item.display_step || item.step) + '｜' + escapeHtml(item.action) + '</strong>',
      '<small>' + escapeHtml(item.category || "未分类") + '</small>',
      '</div>',
      '<div class="require-tags">',
      renderSupplementBadge(supplement),
      renderTag("实测", item.record_required),
      renderTag("原始照片", item.before_required),
      renderTag("调试后照片", item.after_required),
      '</div>',
      '</div>',
      '<div class="item-body">',
      '<div class="item-guide is-collapsed"><div class="item-guide-head"><div><strong>排查依据</strong><div class="item-guide-summary">' + escapeHtml(item.action) + '；' + escapeHtml(item.standard) + '</div></div><button type="button" data-item-guide-toggle aria-expanded="false">展开</button></div><div class="item-guide-body"><div class="meta-box"><span>排查动作</span><p>' + escapeHtml(item.action) + '</p></div><div class="meta-box"><span>合格指标</span><p>' + escapeHtml(item.standard) + '</p></div>' + renderReferenceMaterials(item) + '</div></div>',
      renderSupplementBox(supplement),
      '<div class="conclusion-row">',
      '<label><span class="textarea-label">排查结论</span>',
      '<select class="conclusion-select conclusion-' + conclusionClass(data.conclusion) + '" data-item-id="' + item.id + '" aria-hidden="true" tabindex="-1">',
      renderConclusionOption(data.conclusion, "正常"),
      renderConclusionOption(data.conclusion, "异常"),
      renderConclusionOption(data.conclusion, "已处理"),
      renderConclusionOption(data.conclusion, "待确认"),
      '</select></label>',
      '<div class="conclusion-segments" role="group" aria-label="排查结论">',
      renderConclusionSegment(item.id, data.conclusion, "正常"),
      renderConclusionSegment(item.id, data.conclusion, "异常"),
      renderConclusionSegment(item.id, data.conclusion, "已处理"),
      renderConclusionSegment(item.id, data.conclusion, "待确认"),
      '</div><div class="conclusion-tip">异常、已处理、待确认会自动汇总，便于 RTS/GTS 快速审核。</div>',
      '</div>',
      '<label class="item-field' + (recordError ? " has-error" : "") + '">',
      '<span class="textarea-label">实测情况记录（' + (item.record_required ? "必填" : "选填") + '）</span>',
      '<textarea class="item-textarea' + (recordError ? " has-error" : "") + '" data-item-id="' + item.id + '" rows="3" placeholder="请填写现场实测值、观察现象和处理结果">' + escapeHtml(data.measured_value || "") + '</textarea>',
      renderRecordExample(item),
      '<div class="short-warning ' + (shouldWarnShort(data.measured_value) ? "" : "hidden") + '" id="warn_' + item.id + '">当前描述偏简单，建议补充“实测值/观察现象/处理结果”。</div>',
      '</label>',
      '<div class="upload-grid">',
      renderUploadZone(item, "before_images", item.before_required),
      renderUploadZone(item, "after_images", item.after_required),
      '</div>',
      '</div>',
      '</article>'
    ].join("");
  }

  function renderRecordExample(item) {
    const blocks = item.record_example_blocks || [];
    if (!blocks.length && !item.record_example) return "";
    if (!blocks.length) {
      return '<div class="record-example"><strong>Excel填写示例</strong><p>' + escapeHtml(item.record_example) + '</p></div>';
    }
    return '<div class="record-example"><strong>Excel填写示例</strong><div class="record-example-blocks">' + blocks.map(function (block) {
      if (block.type === "note") return '<p class="record-example-note">' + escapeHtml(block.text || "") + '</p>';
      const fields = block.fields || [];
      return '<section class="record-example-section' + (block.layout === "stacked" ? ' is-stacked' : '') + '">' + (block.title ? '<h4>' + escapeHtml(block.title) + '</h4>' : '') + '<dl>' + fields.map(function (field) {
        return '<div><dt>' + escapeHtml(field.label || "") + '</dt><dd>' + escapeHtml(field.value || "") + '</dd></div>';
      }).join("") + '</dl></section>';
    }).join("") + '</div></div>';
  }

  function renderReferenceMaterials(item) {
    const images = item.reference_images || [];
    if (!images.length) return "";
    return '<div class="reference-images"><span>Excel参考图片</span><div>' + images.map(function (image) {
      return '<a href="' + escapeHtml(image.src || "") + '" target="_blank" rel="noopener"><img src="' + escapeHtml(image.src || "") + '" alt="' + escapeHtml(image.label || "Excel参考图片") + '"><small>' + escapeHtml(image.label || "参考图") + '</small></a>';
    }).join("") + '</div></div>';
  }

  function renderSupplementBadge(supplement) {
    if (!supplement) return "";
    return '<span class="tag rts-required">RTS/GTS需补充</span>';
  }

  function supplementTypeText(request) {
    const types = [];
    if (request.need_record) types.push("补记录");
    if (request.need_before) types.push("补原始照片");
    if (request.need_after) types.push("补调试后照片");
    return types.length ? types.join("、") : "按说明补充";
  }

  function renderSupplementBox(supplement) {
    if (!supplement) return "";
    return [
      '<div class="supplement-box">',
      '<div><strong>RTS/GTS补充要求</strong><span>' + escapeHtml(supplementTypeText(supplement)) + '</span></div>',
      '<p>' + escapeHtml(supplement.requirement || "请按 RTS/GTS 意见补充该项资料。") + '</p>',
      '</div>'
    ].join("");
  }

  function renderTag(label, required) {
    return '<span class="tag ' + (required ? "required" : "optional") + '">' + label + " " + (required ? "必填" : "选填") + '</span>';
  }

  function renderConclusionOption(current, value) {
    return '<option value="' + value + '"' + ((current || "正常") === value ? " selected" : "") + '>' + value + '</option>';
  }

  function conclusionClass(value) {
    if (value === "异常") return "abnormal";
    if (value === "已处理") return "handled";
    if (value === "待确认") return "pending";
    return "normal";
  }

  function shouldWarnShort(value) {
    const text = String(value || "").replace(/\s+/g, "").trim();
    const weak = ["正常", "无", "无异常", "OK", "ok", "已完成", "符合", "没问题", "良好", "通过"];
    if (!text) return false;
    return text.length < 8 || weak.indexOf(text) !== -1;
  }

  function refreshShortWarning(itemId) {
    const data = ensureItemData(itemId);
    const node = document.getElementById("warn_" + itemId);
    if (!node) return;
    node.classList.toggle("hidden", !shouldWarnShort(data.measured_value));
  }

  function renderUploadZone(item, field, required) {
    const data = ensureItemData(item.id);
    const images = data[field] || [];
    const label = FIELD_LABELS[field];
    const hasError = hasItemFieldError(item.id, field);
    const limit = Number(state.limits.max_images_per_field || 5);
    const atLimit = images.length >= limit;
    const thumbs = images.length ? images.map(function (image, index) {
      return [
        '<div class="thumb" title="' + escapeHtml(image.original_name || "") + '">',
        '<img src="' + escapeHtml(image.url) + '" alt="' + escapeHtml(image.original_name || label) + '" data-preview-image data-item-id="' + item.id + '" data-field="' + field + '" data-index="' + index + '">',
        image.compressed ? '<span class="compressed-badge">已压缩</span>' : '',
        '<button type="button" data-delete-image data-item-id="' + item.id + '" data-field="' + field + '" data-index="' + index + '">×</button>',
        '</div>'
      ].join("");
    }).join("") : '<div class="empty-upload">上传照片或将图片拖到此处</div>';

    return [
      '<div class="upload-zone' + (hasError ? " has-error" : "") + '" data-item-id="' + item.id + '" data-field="' + field + '">',
      '<div class="upload-head">',
      '<span class="upload-label">' + label + '（' + (required ? "必传" : "选传") + '）</span>',
      '<span class="upload-count">' + images.length + ' / ' + limit + '</span>',
      '<button type="button" data-upload data-item-id="' + item.id + '" data-field="' + field + '"' + (atLimit ? " disabled" : "") + '>上传照片</button>',
      '</div>',
      '<div class="thumb-grid">',
      thumbs,
      '</div>',
      atLimit ? '<p class="upload-limit-note">已达到最多 ' + limit + ' 张。</p>' : '',
      '</div>'
    ].join("");
  }

  function pickFiles(itemId, field) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
    input.multiple = true;
    input.addEventListener("change", function () {
      handleFiles(itemId, field, input.files);
    });
    input.click();
  }

  async function handleFiles(itemId, field, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const item = ensureItemData(itemId);
    if (item[field].length + files.length > state.limits.max_images_per_field) {
      showResult("每个位置最多上传 " + state.limits.max_images_per_field + " 张照片，请删除多余图片后继续。", true);
      return;
    }

    const validFiles = [];
    for (const file of files) {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (state.limits.allowed_extensions.indexOf(ext) === -1) {
        showResult("图片格式不支持，请上传 jpg、jpeg、png 或 webp 格式图片。", true);
        return;
      }
      validFiles.push(file);
    }

    const formData = new FormData();
    formData.append("session_id", state.sessionId);
    validFiles.forEach(function (file) {
      formData.append("files", file);
    });

    if (!startBusy("正在上传照片", "正在上传并处理照片，请稍候，不要重复点击。")) return;
    try {
      const data = await fetchJson("/api/upload", { method: "POST", body: formData });
      state.sessionId = data.session_id || state.sessionId;
      localStorage.setItem("jumpCheckSessionId", state.sessionId);
      const uploaded = data.files || [];
      item[field] = item[field].concat(uploaded);
      clearItemFieldError(itemId, field);
      renderItems();
      updateStats();
      const compressedCount = uploaded.filter(function (image) { return image.compressed; }).length;
      if (compressedCount) {
        showResult("已上传 " + uploaded.length + " 张图片，其中 " + compressedCount + " 张超过 5MB，系统已自动压缩。", false);
      }
      finishBusy("success", "照片上传成功", compressedCount ? "已上传 " + uploaded.length + " 张照片，其中 " + compressedCount + " 张已自动压缩。" : "已上传 " + uploaded.length + " 张照片。");
    } catch (err) {
      const message = errorMessage(err, "图片上传失败。");
      showResult(message, true);
      finishBusy("error", "照片上传失败", message);
    }
  }

  function getBaseInfo() {
    const values = {};
    document.querySelectorAll("#basicForm [name]").forEach(function (node) {
      values[node.name] = node.value.trim();
    });
    return values;
  }

  function normalizeProject(value) {
    return String(value || "").toUpperCase().replace(/[\s\-_（）()]/g, "");
  }

  function isUltrasoundContext() {
    const base = getBaseInfo();
    const special = (window.APP_CONFIG && window.APP_CONFIG.ultrasoundProjects) || [];
    return base.model === "CL-8000i" && special.map(normalizeProject).indexOf(normalizeProject(base.jump_project)) !== -1;
  }

  function getSortedItems() {
    const base = getBaseInfo();
    const ultrasound = isUltrasoundContext();
    return state.items.filter(function (item) {
      const condition = item.condition || {};
      if (condition.models && condition.models.indexOf(base.model) === -1) return false;
      return !(condition.ultrasound_only && !ultrasound);
    }).map(function (item) {
      const copy = Object.assign({}, item);
      copy.display_step = ultrasound ? (item.display_step_special || item.display_step) : (item.display_step_default || item.display_step);
      return copy;
    }).sort(function (a, b) {
      return Number(a.sort_order || a.index || 0) - Number(b.sort_order || b.index || 0);
    });
  }

  function setBaseInfo(values) {
    document.querySelectorAll("#basicForm [name]").forEach(function (node) {
      node.value = values && values[node.name] ? values[node.name] : "";
      if (node.name === "check_date" && !node.value) {
        node.value = localDateString();
      }
    });
    syncJumpProjectControl(values && values.jump_project);
  }

  function collectPayload() {
    const items = getSortedItems().map(function (item) {
      const data = ensureItemData(item.id);
      return {
        id: item.id,
        measured_value: data.measured_value || "",
        conclusion: data.conclusion || "正常",
        before_images: data.before_images || [],
        after_images: data.after_images || []
      };
    });
    return {
      session_id: state.sessionId,
      base_info: getBaseInfo(),
      items: items
    };
  }

  async function createMobileTask() {
    clearResult();
    if (!startBusy("正在生成手机二维码", "正在创建手机采集任务并生成二维码，请稍候。")) return;
    try {
      setMobileStatus("正在生成二维码...");
      const data = await fetchJson("/api/mobile/task/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectPayload())
      });
      state.mobile.taskId = data.task_id || "";
      state.mobile.token = data.token || "";
      state.mobile.url = data.mobile_url || "";
      state.mobile.lastSeq = 0;
      document.getElementById("mobilePanel").classList.remove("hidden");
      document.getElementById("mobileQrPanel").classList.remove("hidden");
      document.getElementById("mobileCopyBtn").classList.remove("hidden");
      document.getElementById("mobilePanelCollapseBtn").classList.remove("hidden");
      document.getElementById("mobilePanelCollapseBtn").textContent = "收起";
      document.getElementById("mobilePanelCollapseBtn").setAttribute("aria-expanded", "true");
      const qrUrl = data.qr_url || "";
      document.getElementById("mobileQrImage").src = qrUrl + (qrUrl.includes("?") ? "&" : "?") + "_=" + Date.now();
      const link = document.getElementById("mobileLink");
      link.href = state.mobile.url;
      link.textContent = state.mobile.url;
      setMobileStatus("二维码已生成，等待手机扫码");
      startMobilePolling();
      finishBusy("success", "手机二维码已生成", "手机扫码后即可拍照、填写并同步到当前电脑报告。");
    } catch (err) {
      const message = errorMessage(err, "手机采集二维码生成失败。");
      setMobileStatus("二维码生成失败");
      showResult(message, true);
      finishBusy("error", "二维码生成失败", message);
    }
  }

  async function copyMobileLink() {
    if (!state.mobile.url) return;
    try {
      await navigator.clipboard.writeText(state.mobile.url);
      setMobileStatus("链接已复制");
    } catch (err) {
      setMobileStatus("复制失败，请手动复制链接");
    }
  }

  function setMobileStatus(text) {
    const node = document.getElementById("mobileStatusText");
    if (node) node.textContent = text;
    const stateNode = document.getElementById("mobilePanelState");
    if (stateNode) stateNode.textContent = "手机采集：" + text;
  }

  function toggleMobilePanel() {
    const panel = document.getElementById("mobileQrPanel");
    const button = document.getElementById("mobilePanelCollapseBtn");
    const collapsed = !panel.classList.contains("hidden");
    panel.classList.toggle("hidden", collapsed);
    button.textContent = collapsed ? "展开" : "收起";
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function startMobilePolling() {
    if (state.mobile.pollTimer) {
      window.clearInterval(state.mobile.pollTimer);
    }
    syncMobileTask();
    state.mobile.pollTimer = window.setInterval(syncMobileTask, 2000);
  }

  async function syncMobileTask() {
    if (!state.mobile.taskId || !state.mobile.token) return;
    try {
      const data = await fetchJson("/api/mobile/task/status?task_id=" + encodeURIComponent(state.mobile.taskId) + "&token=" + encodeURIComponent(state.mobile.token));
      const seq = Number(data.updated_seq || 0);
      if (data.session_id) {
        state.sessionId = data.session_id;
        localStorage.setItem("jumpCheckSessionId", state.sessionId);
      }
      setMobileStatus(data.connected ? "手机已连接，最近同步：" + (data.last_seen_at || data.updated_at || "刚刚") : "等待手机扫码连接");
      if (seq > state.mobile.lastSeq) {
        state.mobile.lastSeq = seq;
        mergeMobileItems(data.items || []);
        renderItems();
        updateStats();
      }
    } catch (err) {
      setMobileStatus(err.message || "手机同步异常");
    }
  }

  function mergeMobileItems(items) {
    (items || []).forEach(function (incoming) {
      if (!incoming || !incoming.id) return;
      const local = ensureItemData(incoming.id);
      const measured = String(incoming.measured_value || "");
      if (measured.trim()) local.measured_value = measured;
      if (incoming.conclusion) local.conclusion = incoming.conclusion;
      appendUniqueImages(local, "before_images", incoming.before_images || []);
      appendUniqueImages(local, "after_images", incoming.after_images || []);
    });
  }

  function appendUniqueImages(item, field, images) {
    item[field] = item[field] || [];
    const names = new Set(item[field].map(function (image) {
      return image.stored_name || image.url || image.original_name;
    }));
    (images || []).forEach(function (image) {
      const key = image.stored_name || image.url || image.original_name;
      if (key && !names.has(key)) {
        item[field].push(image);
        names.add(key);
      }
    });
  }

  function updateStats() {
    let completed = 0;
    let missingImages = 0;
    let attention = 0;

    getSortedItems().forEach(function (item) {
      const data = ensureItemData(item.id);
      let done = true;
      if (item.record_required && (data.measured_value || "").trim().length < 2) {
        done = false;
      }
      if (item.before_required && !(data.before_images || []).length) {
        done = false;
        missingImages += 1;
      }
      if (item.after_required && !(data.after_images || []).length) {
        done = false;
        missingImages += 1;
      }
      if (["异常", "已处理", "待确认"].indexOf(data.conclusion || "正常") !== -1) {
        attention += 1;
      }
      if (done) completed += 1;
    });

    const total = getSortedItems().length;
    const todo = Math.max(total - completed, 0);
    const percent = total ? Math.round((completed / total) * 100) : 0;

    document.getElementById("statTotal").textContent = total;
    document.getElementById("statDone").textContent = completed;
    document.getElementById("statTodo").textContent = todo;
    document.getElementById("statMissingImages").textContent = missingImages;
    const attentionNode = document.getElementById("statAttention");
    if (attentionNode) attentionNode.textContent = attention;
    document.getElementById("statPercent").textContent = percent + "%";
    document.getElementById("progressBar").style.width = percent + "%";
    const bottom = document.getElementById("itemBottomStats");
    if (bottom) bottom.textContent = "已完成 " + completed + " / " + total + "｜缺照片 " + missingImages + "｜异常关注 " + attention;
    renderItemNavigator();
    updateBasicInfoState();
  }

  function isItemComplete(item) {
    const data = ensureItemData(item.id);
    if (item.record_required && String(data.measured_value || "").trim().length < 2) return false;
    if (item.before_required && !(data.before_images || []).length) return false;
    if (item.after_required && !(data.after_images || []).length) return false;
    return true;
  }

  function getItemStatus(item) {
    const data = ensureItemData(item.id);
    const missingRecord = Boolean(item.record_required && String(data.measured_value || "").trim().length < 2);
    const missingImage = Boolean((item.before_required && !(data.before_images || []).length) || (item.after_required && !(data.after_images || []).length));
    const attention = ["异常", "已处理", "待确认"].indexOf(data.conclusion || "正常") !== -1;
    const supplement = Boolean(state.supplementMap[item.id]);
    const error = state.errorItemIds.has(item.id);
    let kind = "complete";
    let label = "已完成";
    let icon = "✓";
    if (supplement) { kind = "supplement"; label = "RTS/GTS需补充"; icon = "↩"; }
    else if (error || missingRecord || missingImage) { kind = "missing"; label = missingRecord && missingImage ? "缺记录和照片" : (missingRecord ? "缺记录" : "缺照片"); icon = "!"; }
    else if (attention) { kind = "attention"; label = data.conclusion || "异常关注"; icon = "●"; }
    else if (!isItemComplete(item)) { kind = "todo"; label = "未完成"; icon = "○"; }
    return { kind: kind, label: label, icon: icon, missingRecord: missingRecord, missingImage: missingImage, attention: attention, supplement: supplement, error: error };
  }

  function getFilteredItems() {
    return getSortedItems().filter(function (item) {
      const status = getItemStatus(item);
      if (state.itemFilter === "todo") return !isItemComplete(item);
      if (state.itemFilter === "missing_record") return status.missingRecord;
      if (state.itemFilter === "missing_image") return status.missingImage;
      if (state.itemFilter === "attention") return status.attention;
      if (state.itemFilter === "supplement") return status.supplement;
      return true;
    });
    state.basicCollapsed = false;
    updateBasicInfoState();
  }

  function getDefaultActiveItemId(items) {
    const sorted = items || getSortedItems();
    const error = sorted.find(function (item) { return state.errorItemIds.has(item.id); });
    const todo = sorted.find(function (item) { return !isItemComplete(item); });
    return (error || todo || sorted[0] || {}).id || "";
  }

  function renderItemNavigator() {
    const filterRoot = document.getElementById("itemFilterBar");
    const listRoot = document.getElementById("itemNavigationList");
    const countNode = document.getElementById("itemNavigatorCount");
    if (!filterRoot || !listRoot) return;
    const sorted = getSortedItems();
    const counts = { all: sorted.length, todo: 0, missing_record: 0, missing_image: 0, attention: 0, supplement: 0 };
    sorted.forEach(function (item) {
      const status = getItemStatus(item);
      if (!isItemComplete(item)) counts.todo += 1;
      if (status.missingRecord) counts.missing_record += 1;
      if (status.missingImage) counts.missing_image += 1;
      if (status.attention) counts.attention += 1;
      if (status.supplement) counts.supplement += 1;
    });
    const filterLabels = { all: "全部", todo: "未完成", missing_record: "缺记录", missing_image: "缺照片", attention: "异常关注", supplement: "RTS补充" };
    filterRoot.innerHTML = Object.keys(filterLabels).map(function (key) {
      const active = state.itemFilter === key;
      return '<button type="button" class="item-filter-btn' + (active ? " active" : "") + '" data-item-filter="' + key + '" aria-pressed="' + (active ? "true" : "false") + '"><span>' + filterLabels[key] + '</span><b>' + counts[key] + '</b></button>';
    }).join("");
    const visible = getFilteredItems();
    countNode.textContent = visible.length + " / " + sorted.length + " 项";
    if (!visible.length) {
      listRoot.innerHTML = '<div class="empty-state">当前筛选没有项目。<button type="button" data-item-filter="all">查看全部</button></div>';
      return;
    }
    listRoot.innerHTML = visible.map(function (item) {
      const status = getItemStatus(item);
      const active = item.id === state.activeItemId;
      return '<button type="button" class="item-navigation-entry' + (active ? " is-active" : "") + '" data-item-nav="' + escapeHtml(item.id) + '" aria-current="' + (active ? "step" : "false") + '"><span class="navigator-step status-' + status.kind + '">' + (active ? "▶" : status.icon) + '</span><span><span class="navigator-title" title="' + escapeHtml(item.action || "未命名排查项") + '">' + escapeHtml(item.display_step || item.step || "") + "｜" + escapeHtml(item.action || "未命名排查项") + '</span><span class="navigator-status">' + escapeHtml(status.label) + '</span></span></button>';
    }).join("");
  }

  function updateCurrentItemUI() {
    const filtered = getFilteredItems();
    document.querySelectorAll(".item-card").forEach(function (card) {
      const active = card.dataset.itemId === state.activeItemId;
      card.classList.toggle("is-active", active);
      card.classList.toggle("hidden", !active);
      if (active) {
        const item = getSortedItems().find(function (entry) { return entry.id === state.activeItemId; });
        if (item) {
          const status = getItemStatus(item);
          card.dataset.status = status.kind;
          card.classList.toggle("has-error", status.error);
          card.classList.toggle("needs-supplement", status.supplement);
          card.querySelectorAll(".conclusion-segment").forEach(function (button) {
            const selected = button.dataset.conclusion === ensureItemData(item.id).conclusion;
            button.classList.toggle("selected", selected);
            button.setAttribute("aria-pressed", selected ? "true" : "false");
          });
        }
      }
    });
    document.querySelectorAll("[data-item-nav]").forEach(function (button) {
      const active = button.dataset.itemNav === state.activeItemId;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "step" : "false");
    });
    const position = getSortedItems().findIndex(function (item) { return item.id === state.activeItemId; });
    const positionNode = document.getElementById("itemPositionText");
    if (positionNode) positionNode.textContent = "第 " + (position >= 0 ? position + 1 : 0) + " / " + getSortedItems().length + " 项";
    const previous = document.getElementById("previousItemBtn");
    const next = document.getElementById("nextItemBtn");
    if (previous) previous.disabled = filtered.length < 2;
    if (next) next.disabled = filtered.length < 2;
  }

  function setActiveItem(itemId, options) {
    if (!itemId || !getSortedItems().some(function (item) { return item.id === itemId; })) return;
    state.activeItemId = itemId;
    renderItemNavigator();
    updateCurrentItemUI();
    refreshShortWarning(itemId);
    if (options && options.scroll) {
      const panel = document.getElementById("itemDetailPanel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function setItemFilter(filter) {
    state.itemFilter = filter || "all";
    state.supplementOnly = state.itemFilter === "supplement";
    const filtered = getFilteredItems();
    if (!filtered.length) state.activeItemId = "";
    else if (!filtered.some(function (item) { return item.id === state.activeItemId; })) state.activeItemId = filtered[0].id;
    renderItemNavigator();
    updateCurrentItemUI();
  }

  function moveActiveItem(delta) {
    const items = getFilteredItems();
    if (!items.length) return;
    let index = items.findIndex(function (item) { return item.id === state.activeItemId; });
    if (index < 0) index = 0;
    index = (index + delta + items.length) % items.length;
    setActiveItem(items[index].id, { scroll: true });
  }

  function goToNextTodo() {
    const sorted = getSortedItems();
    const buckets = [
      function (item) { return getItemStatus(item).supplement; },
      function (item) { return getItemStatus(item).error; },
      function (item) { return getItemStatus(item).missingRecord; },
      function (item) { return getItemStatus(item).missingImage; },
      function (item) { return !isItemComplete(item); },
      function (item) { return getItemStatus(item).attention; }
    ];
    let target = null;
    buckets.some(function (test) { target = sorted.find(test); return Boolean(target); });
    if (!target) {
      showResult("当前没有待办项。", false);
      return;
    }
    if (getItemStatus(target).supplement) state.itemFilter = "supplement";
    else if (!getFilteredItems().some(function (item) { return item.id === target.id; })) state.itemFilter = "all";
    setActiveItem(target.id, { scroll: true });
  }

  function updateBasicInfoState() {
    const section = document.getElementById("basicInfoSection");
    const status = document.getElementById("basicInfoStatus");
    const toggle = document.getElementById("basicInfoToggleBtn");
    const summary = document.getElementById("basicInfoSummary");
    if (!section || !status || !toggle || !summary) return;
    const values = getBaseInfo();
    const required = (window.APP_CONFIG && window.APP_CONFIG.basicFields || []).filter(function (field) { return field.required; });
    const complete = required.every(function (field) { return String(values[field.key] || "").trim(); });
    status.textContent = complete ? "已完成" : "未完成";
    status.className = "tag " + (complete ? "is-complete" : "is-incomplete");
    toggle.disabled = !complete;
    toggle.textContent = complete ? (state.basicCollapsed ? "编辑" : "收起") : "请先完成必填项";
    if (!complete) state.basicCollapsed = false;
    section.classList.toggle("is-collapsed", state.basicCollapsed && complete);
    toggle.setAttribute("aria-expanded", state.basicCollapsed ? "false" : "true");
    summary.innerHTML = '<strong>' + escapeHtml(values.hospital || "医院名称") + " · " + escapeHtml(values.model || "设备型号") + " · " + escapeHtml(values.serial || "设备序列号") + '</strong><br>' + escapeHtml(values.jump_project || "跳值项目") + " · " + escapeHtml(values.engineer || "排查工程师") + " · " + escapeHtml(values.check_date || "排查日期");
    summary.classList.toggle("hidden", !state.basicCollapsed || !complete);
  }

  function toggleBasicInfo() {
    const values = getBaseInfo();
    const required = (window.APP_CONFIG && window.APP_CONFIG.basicFields || []).filter(function (field) { return field.required; });
    if (!required.every(function (field) { return String(values[field.key] || "").trim(); })) return;
    state.basicCollapsed = !state.basicCollapsed;
    updateBasicInfoState();
  }

  function showResult(message, isError, links, reveal) {
    const panel = document.getElementById("resultPanel");
    panel.classList.remove("hidden");
    panel.setAttribute("role", "alert");
    panel.style.borderColor = isError ? "#f5b8b1" : "#b7dfc8";
    panel.style.background = isError ? "#fff1f0" : "#ecfdf3";
    let html = '<strong>' + escapeHtml(message) + '</strong>';
    if (links) {
      html += '<div class="result-links">' + links + '</div>';
    }
    panel.innerHTML = html;
    if (reveal) {
      window.setTimeout(function () {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 40);
    }
  }

  function clearResult() {
    const panel = document.getElementById("resultPanel");
    panel.classList.add("hidden");
    panel.innerHTML = "";
  }

  function applyBaseFieldErrors() {
    document.querySelectorAll("#basicForm .field").forEach(function (fieldNode) {
      const control = fieldNode.querySelector("[name]");
      const visibleControl = fieldNode.querySelector("[data-project-select]") || control;
      const hasError = Boolean(control && state.errorFields.has(control.name));
      fieldNode.classList.toggle("has-error", hasError);
      if (visibleControl) visibleControl.classList.toggle("has-error", hasError);
    });
  }

  function focusWithPulse(node, focusNode) {
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.remove("focus-pulse");
    void node.offsetWidth;
    node.classList.add("focus-pulse");
    window.setTimeout(function () {
      node.classList.remove("focus-pulse");
    }, 1800);
    if (focusNode && typeof focusNode.focus === "function") {
      window.setTimeout(function () {
        focusNode.focus({ preventScroll: true });
      }, 260);
    }
  }

  function focusErrorTarget(itemId, field) {
    if (itemId) {
      if (!getFilteredItems().some(function (item) { return item.id === itemId; })) state.itemFilter = "all";
      setActiveItem(itemId, { scroll: false });
      const itemNode = document.getElementById(itemId);
      if (field === "measured_value") {
        const textarea = document.querySelector(".item-textarea[data-item-id='" + itemId + "']");
        focusWithPulse(textarea || itemNode, textarea);
        return;
      }
      if (field === "before_images" || field === "after_images") {
        const uploadZone = document.querySelector(".upload-zone[data-item-id='" + itemId + "'][data-field='" + field + "']");
        focusWithPulse(uploadZone || itemNode);
        return;
      }
      focusWithPulse(itemNode);
      return;
    }

    if (field) {
      state.basicCollapsed = false;
      updateBasicInfoState();
      const fieldNode = field === "jump_project" ? document.getElementById("base_jump_project_select") : document.querySelector("#basicForm [name='" + field + "']");
      const wrapper = fieldNode ? fieldNode.closest(".field") : null;
      focusWithPulse(wrapper || fieldNode, fieldNode);
    }
  }

  function renderErrors(errors) {
    const panel = document.getElementById("errorPanel");
    const list = document.getElementById("errorList");
    state.errorItemIds = new Set();
    state.errorFields = new Set();
    state.errorItemFields = {};

    (errors || []).forEach(function (err) {
      if (err.item_id) {
        state.errorItemIds.add(err.item_id);
        if (err.field) ensureItemFieldErrors(err.item_id).add(err.field);
      } else if (err.field) {
        state.errorFields.add(err.field);
      }
    });

    renderItems();
    applyBaseFieldErrors();

    if (!errors || !errors.length) {
      panel.classList.add("hidden");
      list.innerHTML = "";
      return;
    }

    const counts = { base: 0, record: 0, image: 0 };
    (errors || []).forEach(function (err) {
      if (!err.item_id) counts.base += 1;
      else if (err.field === "measured_value") counts.record += 1;
      else if (err.field === "before_images" || err.field === "after_images") counts.image += 1;
    });
    list.innerHTML = '<div class="error-summary"><div><h2>发现 ' + errors.length + ' 处未完成内容</h2><div class="error-breakdown"><span>基础信息 ' + counts.base + ' 项</span><span>缺记录 ' + counts.record + ' 项</span><span>缺照片 ' + counts.image + ' 项</span></div></div><div><button type="button" data-focus-first>定位第一处</button><button type="button" data-toggle-errors>展开错误列表</button></div></div><div class="error-details hidden">' + errors.map(function (err, index) {
      return '<button type="button" class="error-item" data-error-target="' + escapeHtml(err.item_id || "") + '" data-error-field="' + escapeHtml(err.field || "") + '">' + (index + 1) + ". " + escapeHtml(err.message) + '</button>';
    }).join("") + '</div>';
    panel.classList.remove("hidden");

    const details = list.querySelector(".error-details");
    const toggle = list.querySelector("[data-toggle-errors]");
    const firstButton = list.querySelector("[data-focus-first]");
    if (toggle) toggle.addEventListener("click", function () {
      const willShow = details.classList.contains("hidden");
      details.classList.toggle("hidden", !willShow);
      toggle.textContent = willShow ? "收起错误列表" : "展开错误列表";
    });
    if (firstButton) firstButton.addEventListener("click", function () {
      const first = errors[0];
      if (first) focusErrorTarget(first.item_id || "", first.field || "");
    });

    list.querySelectorAll("[data-error-target], [data-error-field]").forEach(function (button) {
      button.addEventListener("click", function () {
        focusErrorTarget(button.dataset.errorTarget, button.dataset.errorField);
      });
    });

    window.setTimeout(function () {
      const first = errors[0];
      if (first) focusErrorTarget(first.item_id || "", first.field || "");
    }, 120);
  }

  async function checkCompleteness() {
    clearResult();
    if (!startBusy("正在检查完整性", "正在检查基础信息、必填记录和照片要求，请稍候。")) return;
    try {
      const data = await fetchJson("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectPayload())
      });
      renderErrors(data.errors || []);
      if (data.passed) {
        const warnCount = (data.warnings || []).length;
        showResult(warnCount ? "完整性检查通过，但有 " + warnCount + " 条描述较简单的提醒。" : "完整性检查通过，可以生成报告。", false, null, true);
        finishBusy("success", "完整性检查通过", warnCount ? "检查通过，但有 " + warnCount + " 条描述较简单的提醒。" : "检查通过，可以生成报告 ZIP。");
      } else {
        showResult("完整性检查未通过，发现 " + (data.errors || []).length + " 项问题，已定位到第一处。", true, null, true);
        finishBusy("error", "完整性检查未通过", "发现 " + (data.errors || []).length + " 项问题，已定位到第一处，请补充后再生成报告。");
      }
    } catch (err) {
      const message = errorMessage(err, "完整性检查失败。");
      showResult(message, true, null, true);
      finishBusy("error", "完整性检查失败", message);
    }
  }

  async function generateReport() {
    clearResult();
    if (!startBusy("正在生成报告ZIP", "正在整理记录、照片和报告文件，请稍候。")) return;
    try {
      const data = await fetchJson("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectPayload())
      });
      renderErrors([]);
      state.lastOutputPath = data.output_dir || "";
      const links = [
        '<a href="' + escapeHtml(data.report_url) + '" target="_blank">打开 HTML 报告</a>',
        '<a href="' + escapeHtml(data.zip_url) + '" target="_blank">下载 ZIP 包</a>'
      ].join("");
      showResult("报告ZIP已生成。问题编号：" + (data.issue_no || "已生成"), false, links, true);
      finishBusy("success", "报告ZIP生成成功", "问题编号：" + (data.issue_no || "已生成"), links);
    } catch (err) {
      if (err.errors) {
        renderErrors(err.errors);
      }
      const message = errorMessage(err, "报告生成失败，请检查输出目录权限或文件是否被占用。");
      showResult(message, true, null, true);
      finishBusy("error", "报告生成失败", message);
    }
  }

  async function saveDraft() {
    clearResult();
    if (!startBusy("正在保存草稿", "正在保存当前填写内容，请稍候。")) return;
    try {
      const data = await fetchJson("/api/draft/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectPayload())
      });
      showResult("草稿已保存：" + data.name, false);
      finishBusy("success", "草稿保存成功", "草稿已保存：" + data.name);
      refreshDrafts();
    } catch (err) {
      const message = errorMessage(err, "草稿保存失败。");
      showResult(message, true);
      finishBusy("error", "草稿保存失败", message);
    }
  }

  async function refreshDrafts() {
    try {
      const data = await fetchJson("/api/drafts");
      const select = document.getElementById("draftSelect");
      select.innerHTML = '<option value="">草稿</option>' + (data.drafts || []).map(function (draft) {
        return '<option value="' + escapeHtml(draft.name) + '">' + escapeHtml(draft.name) + '</option>';
      }).join("");
    } catch (err) {
      // Draft listing should not block the main workflow.
    }
  }

  async function loadSelectedDraft() {
    const select = document.getElementById("draftSelect");
    if (!select.value) {
      showResult("请选择草稿。", true);
      return;
    }
    if (!startBusy("正在导入草稿", "正在恢复草稿内容，请稍候。")) return;
    try {
      const data = await fetchJson("/api/draft/load/" + encodeURIComponent(select.value));
      const draft = data.draft || {};
      state.sessionId = draft.session_id || state.sessionId;
      localStorage.setItem("jumpCheckSessionId", state.sessionId);
      setBaseInfo(draft.base_info || {});
      state.itemData = {};
      (draft.items || []).forEach(function (item) {
        state.itemData[item.id] = {
          id: item.id,
          measured_value: item.measured_value || "",
          conclusion: item.conclusion || "正常",
          before_images: item.before_images || [],
          after_images: item.after_images || []
        };
      });
      state.items.forEach(function (item) {
        ensureItemData(item.id);
      });
      state.itemFilter = "all";
      state.supplementOnly = false;
      state.activeItemId = getDefaultActiveItemId();
      renderItems();
      updateStats();
      showResult("草稿已导入。", false);
      finishBusy("success", "草稿导入成功", "草稿内容已恢复。");
    } catch (err) {
      const message = errorMessage(err, "草稿导入失败。");
      showResult(message, true);
      finishBusy("error", "草稿导入失败", message);
    }
  }

  async function importOriginalReportZip(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    clearResult();
    renderErrors([]);

    const formData = new FormData();
    formData.append("report_file", file);
    if (!startBusy("正在导入原ZIP", "正在恢复一线原始报告和照片，请稍候。")) return;
    try {
      const data = await fetchJson("/api/report/import", { method: "POST", body: formData });
      state.sessionId = data.session_id || makeId();
      localStorage.setItem("jumpCheckSessionId", state.sessionId);
      setBaseInfo(data.base_info || {});
      state.itemData = {};
      (data.items || []).forEach(function (item) {
        if (!item || !item.id) return;
        state.itemData[item.id] = {
          id: item.id,
          measured_value: item.measured_value || "",
          conclusion: item.conclusion || "正常",
          before_images: item.before_images || [],
          after_images: item.after_images || []
        };
      });
      state.items.forEach(function (item) {
        ensureItemData(item.id);
      });
      state.itemFilter = "all";
      state.supplementOnly = false;
      state.activeItemId = getDefaultActiveItemId();
      renderItems();
      updateStats();
      const warningText = (data.warnings || []).length ? "，有 " + data.warnings.length + " 张图片未能恢复，请检查提示或重新上传" : "";
      showResult("原 ZIP 已恢复为可编辑报告，可按 RTS/GTS 意见补充后重新生成 ZIP" + warningText + "。", false);
      finishBusy("success", "原ZIP导入成功", "已恢复为可编辑报告，可按 RTS/GTS 意见补充后重新生成 ZIP" + warningText + "。");
    } catch (err) {
      const message = errorMessage(err, "原 ZIP 导入失败，请确认上传的是本工具生成的一线报告 ZIP。");
      showResult(message, true);
      finishBusy("error", "原ZIP导入失败", message);
    }
  }

  function rebuildSupplementMap() {
    state.supplementMap = {};
    (state.supplementRequests || []).forEach(function (request) {
      if (request && request.item_id) {
        state.supplementMap[request.item_id] = request;
      }
    });
  }

  function findTemplateItem(itemId) {
    return state.items.find(function (item) { return item.id === itemId; });
  }

  function renderSupplementPanel(meta) {
    const panel = document.getElementById("supplementPanel");
    const summary = document.getElementById("supplementSummary");
    const list = document.getElementById("supplementList");
    panel.classList.remove("hidden");

    const count = state.supplementRequests.length;
    summary.textContent = "RTS/GTS审核编号：" + (meta.review_no || "-") + "｜一线问题编号：" + (meta.source_issue_no || "-") + "｜需补充 " + count + " 项";
    if (!count) {
      list.innerHTML = '<div class="empty-state">该 RTS/GTS 返回 ZIP 未包含结构化补充清单，请查看 RTS/GTS HTML 报告中的文字说明。</div>';
      return;
    }

    list.innerHTML = state.supplementRequests.map(function (request, index) {
      return [
        '<button type="button" class="supplement-list-item" data-item-id="' + escapeHtml(request.item_id) + '">',
        '<strong>' + (index + 1) + ". " + escapeHtml(request.display_step || request.item_id) + '｜' + escapeHtml(request.action || "") + '</strong>',
        '<span>' + escapeHtml(supplementTypeText(request)) + '</span>',
        '<small>' + escapeHtml(request.requirement || "请按 RTS/GTS 意见补充该项资料。") + '</small>',
        '</button>'
      ].join("");
    }).join("");

    list.querySelectorAll("[data-item-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.supplementOnly = true;
        state.itemFilter = "supplement";
        setActiveItem(button.dataset.itemId, { scroll: true });
      });
    });
  }

  async function importRtsReviewZip(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    clearResult();
    renderErrors([]);

    const formData = new FormData();
    formData.append("rts_file", file);
    if (!startBusy("正在导入RTS/GTS返回ZIP", "正在读取 RTS/GTS 补充清单，请稍候。")) return;
    try {
      const data = await fetchJson("/api/report/import-rts-review", { method: "POST", body: formData });
      const warningText = restoreEditableReport(data);
      state.supplementRequests = data.supplement_requests || [];
      rebuildSupplementMap();
      state.supplementOnly = Boolean(state.supplementRequests.length);
      state.itemFilter = state.supplementOnly ? "supplement" : "all";
      state.activeItemId = state.supplementOnly ? (state.supplementRequests[0] || {}).item_id || getDefaultActiveItemId() : getDefaultActiveItemId();
      renderSupplementPanel(data);
      renderItems();
      updateStats();
      if (state.supplementRequests.length) {
        showResult("RTS/GTS 返回 ZIP 已恢复原报告和照片，当前已切换为只看补充项。补完后点击“检查补充项”，再重新生成 ZIP 发回 RTS/GTS" + warningText + "。", false);
        finishBusy("success", "RTS/GTS返回ZIP导入成功", "已恢复可编辑报告，读取 " + state.supplementRequests.length + " 个补充要求，当前已切换为只看补充项" + warningText + "。");
      } else {
        showResult("RTS/GTS 返回 ZIP 已恢复原报告和照片，但没有结构化补充清单，请查看 RTS/GTS 报告文字说明" + warningText + "。", true);
        finishBusy("error", "RTS/GTS返回ZIP已导入", "已恢复可编辑报告，但没有结构化补充清单，请查看 RTS/GTS 报告文字说明" + warningText + "。");
      }
    } catch (err) {
      const message = errorMessage(err, "RTS/GTS 返回 ZIP 导入失败，请确认上传的是本工具生成的 RTS/GTS 审核返回 ZIP。");
      showResult(message, true);
      finishBusy("error", "RTS/GTS返回ZIP导入失败", message);
    }
  }

  function renderConclusionSegment(itemId, current, value) {
    const selected = (current || "正常") === value;
    return '<button type="button" class="conclusion-segment' + (selected ? " selected" : "") + '" data-conclusion="' + value + '" data-item-id="' + escapeHtml(itemId) + '" aria-pressed="' + (selected ? "true" : "false") + '">' + value + '</button>';
  }

  function restoreEditableReport(data) {
    state.sessionId = data.session_id || makeId();
    localStorage.setItem("jumpCheckSessionId", state.sessionId);
    setBaseInfo(data.base_info || {});
    state.itemData = {};
    (data.items || []).forEach(function (item) {
      if (!item || !item.id) return;
      state.itemData[item.id] = {
        id: item.id,
        measured_value: item.measured_value || "",
        conclusion: item.conclusion || "正常",
        before_images: item.before_images || [],
        after_images: item.after_images || []
      };
    });
    state.items.forEach(function (item) { ensureItemData(item.id); });
    const warningCount = (data.warnings || []).length;
    return warningCount ? "；有 " + warningCount + " 张图片未能恢复，请检查提示或重新上传" : "";
  }

  function checkSupplementCompletion() {
    clearResult();
    if (!state.supplementRequests.length) {
      showResult("请先导入 RTS/GTS 返回 ZIP。", true);
      return;
    }

    const errors = [];
    state.supplementOnly = true;
    state.itemFilter = "supplement";
    state.supplementRequests.forEach(function (request) {
      const item = findTemplateItem(request.item_id);
      const label = (request.display_step || request.item_id) + "：" + (request.action || "");
      if (!item) {
        errors.push({ item_id: request.item_id, message: label + "，未在当前模板中找到对应步骤。" });
        return;
      }
      const data = ensureItemData(request.item_id);
      if (request.need_record && (data.measured_value || "").trim().length < 2) {
        errors.push({ item_id: request.item_id, field: "measured_value", message: label + "，RTS/GTS要求补充实测情况记录。" });
      }
      if (request.need_before && !(data.before_images || []).length) {
        errors.push({ item_id: request.item_id, field: "before_images", message: label + "，RTS/GTS要求补充原始状态照片。" });
      }
      if (request.need_after && !(data.after_images || []).length) {
        errors.push({ item_id: request.item_id, field: "after_images", message: label + "，RTS/GTS要求补充调试或维护后照片。" });
      }
    });

    renderErrors(errors);
    if (errors.length) {
      showResult("还有 " + errors.length + " 个 RTS/GTS 补充要求未完成，已定位到第一处。", true);
    } else {
      showResult("RTS/GTS 补充项检查通过，可以重新生成 ZIP 发回 RTS/GTS。", false);
    }
  }

  async function openOutputFolder() {
    if (!startBusy("正在打开输出文件夹", "正在调用系统文件夹，请稍候。")) return;
    try {
      await fetchJson("/api/open-output", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: state.lastOutputPath })
      });
      finishBusy("success", "输出文件夹已打开", "请在系统文件夹中查看生成的报告文件。");
    } catch (err) {
      const message = errorMessage(err, "无法打开输出文件夹。");
      showResult(message, true);
      finishBusy("error", "打开输出文件夹失败", message);
    }
  }

  function initImageModal() {
    document.getElementById("modalClose").addEventListener("click", closeImageModal);
    document.getElementById("modalPrev").addEventListener("click", function () {
      moveModal(-1);
    });
    document.getElementById("modalNext").addEventListener("click", function () {
      moveModal(1);
    });
    document.getElementById("modalZoomOut").addEventListener("click", function () {
      setZoom(state.modal.zoom / 1.2);
    });
    document.getElementById("modalZoomIn").addEventListener("click", function () {
      setZoom(state.modal.zoom * 1.2);
    });
    document.getElementById("modalRotateLeft").addEventListener("click", function () {
      rotateModalImage(-90);
    });
    document.getElementById("modalRotateRight").addEventListener("click", function () {
      rotateModalImage(90);
    });
    document.getElementById("modalZoomReset").addEventListener("click", function () {
      state.modal.zoom = 1;
      state.modal.rotation = 0;
      state.modal.offsetX = 0;
      state.modal.offsetY = 0;
      renderModalImage();
    });

    const stage = document.getElementById("imageStage");
    stage.addEventListener("wheel", function (event) {
      event.preventDefault();
      setZoom(state.modal.zoom * (event.deltaY < 0 ? 1.12 : 0.88));
    });
    stage.addEventListener("mousedown", function (event) {
      state.modal.dragging = true;
      state.modal.startX = event.clientX - state.modal.offsetX;
      state.modal.startY = event.clientY - state.modal.offsetY;
    });
    document.addEventListener("mousemove", function (event) {
      if (!state.modal.dragging) return;
      state.modal.offsetX = event.clientX - state.modal.startX;
      state.modal.offsetY = event.clientY - state.modal.startY;
      renderModalImage();
    });
    document.addEventListener("mouseup", function () {
      state.modal.dragging = false;
    });
    document.addEventListener("keydown", function (event) {
      if (document.getElementById("imageModal").classList.contains("hidden")) return;
      if (event.key === "Escape") closeImageModal();
      if (event.key === "ArrowLeft") moveModal(-1);
      if (event.key === "ArrowRight") moveModal(1);
      if (event.key === "r" || event.key === "R") rotateModalImage(90);
    });
  }

  function openImageModal(images, index) {
    if (!images || !images.length) return;
    state.modal.images = images;
    state.modal.index = index || 0;
    state.modal.zoom = 1;
    state.modal.rotation = 0;
    state.modal.offsetX = 0;
    state.modal.offsetY = 0;
    document.getElementById("imageModal").classList.remove("hidden");
    renderModalImage();
  }

  function closeImageModal() {
    document.getElementById("imageModal").classList.add("hidden");
  }

  function moveModal(delta) {
    const total = state.modal.images.length;
    if (!total) return;
    state.modal.index = (state.modal.index + delta + total) % total;
    state.modal.zoom = 1;
    state.modal.rotation = 0;
    state.modal.offsetX = 0;
    state.modal.offsetY = 0;
    renderModalImage();
  }

  function setZoom(value) {
    state.modal.zoom = Math.max(0.2, Math.min(value, 8));
    renderModalImage();
  }

  function rotateModalImage(delta) {
    state.modal.rotation = (state.modal.rotation + delta) % 360;
    renderModalImage();
  }

  function renderModalImage() {
    const image = state.modal.images[state.modal.index];
    if (!image) return;
    const node = document.getElementById("modalImage");
    node.src = image.url;
    node.alt = image.original_name || "预览图片";
    node.style.transform = "translate(-50%, -50%) translate(" + state.modal.offsetX + "px, " + state.modal.offsetY + "px) rotate(" + state.modal.rotation + "deg) scale(" + state.modal.zoom + ")";
    document.getElementById("modalCounter").textContent = (state.modal.index + 1) + " / " + state.modal.images.length;
  }
})();

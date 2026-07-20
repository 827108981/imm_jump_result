(function () {
  const params = new URLSearchParams(window.location.search);
  const state = {
    taskId: params.get("task_id") || "",
    token: params.get("token") || "",
    sessionId: "",
    baseInfo: {},
    items: [],
    itemData: {},
    pendingCounts: {},
    filter: "all",
    saving: {},
    retryingPending: false,
    pendingTimer: null,
    heartbeatTimer: null,
    pcReachable: false,
    lastReachableAt: 0,
    recognition: null,
    recognizingItemId: ""
  };

  const FIELD_LABELS = {
    before_images: "原始状态照片",
    after_images: "调试或维护后照片"
  };

  const DB_NAME = "jumpCheckMobileV2";
  const DB_VERSION = 2;
  const UPLOAD_STORE = "pendingUploads";
  const SNAPSHOT_STORE = "taskSnapshots";
  const DRAFT_PREFIX = "jumpCheckMobileDraft:";
  const SNAPSHOT_PREFIX = "jumpCheckMobileSnapshot:";
  const CHUNK_SIZE = 512 * 1024;
  const MAX_CLIENT_SIDE = 1800;
  const TARGET_IMAGE_SIZE = 1.6 * 1024 * 1024;
  let dbPromise = null;
  let snapshotTimer = null;

  document.addEventListener("DOMContentLoaded", function () {
    initFilters();
    initOfflineHandlers();
    initVoiceRecognition();
    loadTask();
  });

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
    try {
      data = await response.json();
    } catch (err) {
      data = { ok: false, message: "服务响应异常。" };
    }
    data._serverResponse = true;
    data._httpStatus = response.status;
    if (!response.ok || data.ok === false) throw data;
    return data;
  }

  function setStatus(text, kind) {
    const node = document.getElementById("connectionStatus");
    if (!node) return;
    node.textContent = text;
    node.className = "status-pill" + (kind ? " " + kind : "");
  }

  function markPcReachable(text) {
    state.pcReachable = true;
    state.lastReachableAt = Date.now();
    setStatus(text || "已连接", "ok");
  }

  function markPcUnreachable(text) {
    state.pcReachable = false;
    setStatus(text || "电脑不可达", "error");
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(function () {
      controller.abort();
    }, timeoutMs || 3000);
    try {
      return await fetch(url, Object.assign({}, options || {}, {
        signal: controller.signal,
        cache: "no-store"
      }));
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function checkPcConnection(showMessage) {
    if (!state.taskId || !state.token) return false;
    const url = "/api/mobile/task/status?task_id=" + encodeURIComponent(state.taskId) + "&token=" + encodeURIComponent(state.token) + "&_=" + Date.now();
    try {
      const response = await fetchWithTimeout(url, {}, 2800);
      if (!response.ok) throw new Error("status " + response.status);
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || "电脑不可达");
      const pending = await getPendingUploads();
      markPcReachable(pending.length ? "已连接，待补传" : "已连接");
      if (pending.length) retryPendingUploads(false);
      return true;
    } catch (err) {
      markPcUnreachable("电脑不可达");
      if (showMessage) showToast("电脑暂时不可达，内容已保存在本机。");
      return false;
    }
  }

  function showToast(text) {
    const node = document.getElementById("toast");
    if (!node) return;
    node.textContent = text;
    node.classList.remove("hidden");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () {
      node.classList.add("hidden");
    }, 2600);
  }

  function draftKey() {
    return DRAFT_PREFIX + state.taskId;
  }

  function snapshotKey() {
    return SNAPSHOT_PREFIX + state.taskId;
  }

  function isNetworkError(err) {
    return !err || !err._serverResponse || err.name === "TypeError" || navigator.onLine === false;
  }

  function isEditingField() {
    const active = document.activeElement;
    if (!active) return false;
    return ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
  }

  function openDb() {
    if (!window.indexedDB) {
      return Promise.reject(new Error("当前浏览器不支持本地缓存。"));
    }
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(UPLOAD_STORE)) {
          db.createObjectStore(UPLOAD_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
          db.createObjectStore(SNAPSHOT_STORE, { keyPath: "task_id" });
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("本地缓存打开失败。"));
      };
    });
    return dbPromise;
  }

  async function dbGetAll(storeName) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = function () {
        resolve(request.result || []);
      };
      request.onerror = function () {
        reject(request.error || new Error("读取本地缓存失败。"));
      };
    });
  }

  async function dbGet(storeName, key) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = function () {
        resolve(request.result || null);
      };
      request.onerror = function () {
        reject(request.error || new Error("读取本地缓存失败。"));
      };
    });
  }

  async function dbPut(storeName, row) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, "readwrite");
      const request = tx.objectStore(storeName).put(row);
      request.onsuccess = function () {
        resolve(row);
      };
      request.onerror = function () {
        reject(request.error || new Error("写入本地缓存失败。"));
      };
    });
  }

  async function dbDelete(storeName, key) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, "readwrite");
      const request = tx.objectStore(storeName).delete(key);
      request.onsuccess = function () {
        resolve();
      };
      request.onerror = function () {
        reject(request.error || new Error("删除本地缓存失败。"));
      };
    });
  }

  function readDrafts() {
    try {
      return JSON.parse(localStorage.getItem(draftKey()) || "{}") || {};
    } catch (err) {
      return {};
    }
  }

  function persistDrafts() {
    if (!state.taskId) return;
    const drafts = {};
    Object.keys(state.itemData || {}).forEach(function (itemId) {
      const data = state.itemData[itemId] || {};
      const measured = data.measured_value || "";
      const conclusion = data.conclusion || "正常";
      if (measured.trim() || conclusion !== "正常") {
        drafts[itemId] = {
          measured_value: measured,
          conclusion: conclusion,
          updated_at: new Date().toISOString()
        };
      }
    });
    try {
      localStorage.setItem(draftKey(), JSON.stringify(drafts));
    } catch (err) {
      // 存储空间不足时不阻断现场填写。
    }
    scheduleSnapshot();
  }

  function mergeDrafts() {
    const drafts = readDrafts();
    Object.keys(drafts).forEach(function (itemId) {
      const draft = drafts[itemId] || {};
      const data = ensureItemData(itemId);
      if (draft.measured_value) data.measured_value = draft.measured_value;
      if (draft.conclusion) data.conclusion = draft.conclusion;
    });
  }

  function snapshotPayload() {
    return {
      task_id: state.taskId,
      token: state.token,
      session_id: state.sessionId,
      base_info: state.baseInfo,
      items: state.items,
      item_data: Object.keys(state.itemData).map(function (key) { return state.itemData[key]; }),
      saved_at: new Date().toISOString()
    };
  }

  async function saveSnapshotNow() {
    if (!state.taskId) return;
    const payload = snapshotPayload();
    try {
      localStorage.setItem(snapshotKey(), JSON.stringify(payload));
    } catch (err) {
      // IndexedDB 是主缓存，localStorage 只是兜底。
    }
    try {
      await dbPut(SNAPSHOT_STORE, payload);
    } catch (err) {
      // 老系统或隐私模式可能禁用 IndexedDB。
    }
  }

  function scheduleSnapshot() {
    window.clearTimeout(snapshotTimer);
    snapshotTimer = window.setTimeout(saveSnapshotNow, 350);
  }

  async function loadSnapshot() {
    if (!state.taskId) return null;
    try {
      const row = await dbGet(SNAPSHOT_STORE, state.taskId);
      if (row) return row;
    } catch (err) {
      // 继续尝试 localStorage。
    }
    try {
      return JSON.parse(localStorage.getItem(snapshotKey()) || "null");
    } catch (err) {
      return null;
    }
  }

  function applyTaskData(data) {
    state.sessionId = data.session_id || state.sessionId || "";
    state.baseInfo = data.base_info || {};
    let items = (data.items || []).slice().sort(function (a, b) {
      return Number(a.sort_order || a.index || 0) - Number(b.sort_order || b.index || 0);
    });
    state.items = items;
    state.itemData = {};
    (data.item_data || []).forEach(function (item) {
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
    mergeDrafts();
  }

  function renderAll() {
    renderBaseSummary();
    renderItems();
    updateProgress();
  }

  function initOfflineHandlers() {
    window.addEventListener("online", function () {
      setStatus("网络已恢复，正在同步", "");
      checkPcConnection(false);
      retryPendingUploads(true);
      loadTask(true);
    });
    window.addEventListener("offline", function () {
      markPcUnreachable("离线缓存中");
      showToast("网络已断开，内容会保存在本机。");
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        checkPcConnection(false);
        retryPendingUploads(false);
      }
    });
    state.heartbeatTimer = window.setInterval(function () {
      if (document.hidden) return;
      checkPcConnection(false);
    }, 5000);
    state.pendingTimer = window.setInterval(function () {
      if (document.hidden || isEditingField()) return;
      retryPendingUploads(false);
    }, 10000);
  }

  function initFilters() {
    document.querySelectorAll("[data-filter]").forEach(function (button) {
      button.addEventListener("click", function () {
        document.querySelectorAll("[data-filter]").forEach(function (item) {
          item.classList.remove("active");
        });
        button.classList.add("active");
        state.filter = button.dataset.filter;
        applyFilter();
      });
    });
    const retryButton = document.getElementById("retryPendingButton");
    if (retryButton) {
      retryButton.addEventListener("click", function () {
        retryPendingUploads(true);
      });
    }
  }

  async function loadTask(silent) {
    if (!state.taskId || !state.token) {
      setStatus("链接无效", "error");
      showToast("请从电脑端重新扫码进入。");
      return;
    }

    try {
      if (!silent) setStatus("连接中", "");
      const data = await fetchJson("/api/mobile/task?task_id=" + encodeURIComponent(state.taskId) + "&token=" + encodeURIComponent(state.token));
      applyTaskData(data);
      renderAll();
      await refreshPendingInfo(false);
      await saveSnapshotNow();
      retryPendingUploads(false);
      markPcReachable("已连接");
    } catch (err) {
      const snapshot = await loadSnapshot();
      if (snapshot && snapshot.items && snapshot.items.length) {
        applyTaskData(snapshot);
        renderAll();
        await refreshPendingInfo(false);
        markPcUnreachable("离线缓存中");
        if (!silent) showToast("无法连接电脑，已载入本机缓存。");
        return;
      }
      markPcUnreachable("连接失败");
      if (!silent) showToast(err.message || "无法连接电脑，请确认热点和防火墙。");
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

  function renderBaseSummary() {
    const labels = {
      hospital: "医院",
      model: "型号",
      serial: "序列号",
      jump_project: "跳值项目"
    };
    document.getElementById("baseSummary").innerHTML = [
      '<div class="summary-grid">',
      Object.keys(labels).map(function (key) {
        return '<div class="summary-cell"><span>' + labels[key] + '</span><strong>' + escapeHtml(state.baseInfo[key] || "未填写") + '</strong></div>';
      }).join(""),
      '</div>'
    ].join("");
  }

  function itemDone(item) {
    const data = ensureItemData(item.id);
    if (item.record_required && (data.measured_value || "").trim().length < 2) return false;
    if (item.before_required && !(data.before_images || []).length) return false;
    if (item.after_required && !(data.after_images || []).length) return false;
    return true;
  }

  function itemMissingPhoto(item) {
    const data = ensureItemData(item.id);
    return (item.before_required && !(data.before_images || []).length) || (item.after_required && !(data.after_images || []).length);
  }

  function itemMissingRecord(item) {
    const data = ensureItemData(item.id);
    return item.record_required && (data.measured_value || "").trim().length < 2;
  }

  function getPendingCount(itemId, field) {
    return state.pendingCounts[itemId + "::" + field] || 0;
  }

  function itemStatusText(item) {
    const data = ensureItemData(item.id);
    const missing = [];
    const recordText = (data.measured_value || "").trim();
    if (item.record_required && !recordText) missing.push("缺记录");
    if (item.record_required && recordText && recordText.length < 2) missing.push("记录过短");
    if (item.before_required && !(data.before_images || []).length) {
      missing.push(getPendingCount(item.id, "before_images") ? "原始照片待补传" : "缺原始照片");
    }
    if (item.after_required && !(data.after_images || []).length) {
      missing.push(getPendingCount(item.id, "after_images") ? "调试后照片待补传" : "缺调试后照片");
    }
    return missing.length ? missing.join("、") : "已完成";
  }

  function recordHint(item) {
    const data = ensureItemData(item.id);
    const recordText = (data.measured_value || "").trim();
    if (!item.record_required || !recordText || recordText.length >= 2) return "";
    return '<div class="record-hint">当前记录过短，请至少填写 2 个字，或补充实测值/观察现象。</div>';
  }

  function updateProgress() {
    const total = state.items.length;
    const done = state.items.filter(itemDone).length;
    const percent = total ? Math.round(done / total * 100) : 0;
    document.getElementById("progressText").textContent = done + " / " + total;
    document.getElementById("progressBar").style.width = percent + "%";
  }

  function renderItems() {
    document.getElementById("itemList").innerHTML = state.items.map(renderItem).join("");
    bindItemEvents();
    applyFilter();
  }

  function renderItem(item) {
    const data = ensureItemData(item.id);
    const done = itemDone(item);
    const missingPhoto = itemMissingPhoto(item);
    const missingRecord = itemMissingRecord(item);
    const statusText = itemStatusText(item);
    return [
      '<article class="item-card" data-item-card="' + escapeHtml(item.id) + '" data-done="' + (done ? "1" : "0") + '" data-photo="' + (missingPhoto ? "0" : "1") + '" data-record="' + (missingRecord ? "0" : "1") + '">',
      '<div class="item-head">',
      '<h2>' + escapeHtml(item.display_step || item.step) + '｜' + escapeHtml(item.action || "") + '</h2>',
      '<div class="item-meta">',
      '<span class="tag status-tag ' + (done ? "done" : "missing") + '">' + escapeHtml(statusText) + '</span>',
      renderRequirementTag("实测", item.record_required, "必填", "选填"),
      renderRequirementTag("原始照片", item.before_required, "必传", "选传"),
      renderRequirementTag("调试后照片", item.after_required, "必传", "选传"),
      '</div>',
      '</div>',
      '<div class="item-body">',
      '<div class="detail-box"><span class="detail-label">合格指标</span><p>' + escapeHtml(item.standard || "无") + '</p></div>',
      '<label><span class="field-label">排查结论</span>',
      '<select class="conclusion-select" data-item-id="' + escapeHtml(item.id) + '">',
      renderOption(data.conclusion, "正常"),
      renderOption(data.conclusion, "异常"),
      renderOption(data.conclusion, "已处理"),
      renderOption(data.conclusion, "待确认"),
      '</select></label>',
      '<label><span class="field-label field-label-row"><span>实测情况记录</span>' + renderRequirementBadge(item.record_required, "必填", "选填") + '</span>',
      '<textarea class="record-textarea" data-item-id="' + escapeHtml(item.id) + '" placeholder="填写实测值、观察现象或处理结果">' + escapeHtml(data.measured_value || "") + '</textarea>',
      '<div class="record-tools"><button type="button" class="voice-button" data-voice-item="' + escapeHtml(item.id) + '">语音转文字</button></div>',
      recordHint(item) + '</label>',
      renderUploadZone(item, "before_images"),
      renderUploadZone(item, "after_images"),
      '<div class="save-state" id="save_' + escapeHtml(item.id) + '"></div>',
      '<div class="item-actions">',
      '<button type="button" data-save-item="' + escapeHtml(item.id) + '">保存</button>',
      '<button type="button" class="primary" data-next-item="' + escapeHtml(item.id) + '">保存并下一项</button>',
      '</div>',
      '</div>',
      '</article>'
    ].join("");
  }

  function renderOption(current, value) {
    return '<option value="' + value + '"' + ((current || "正常") === value ? " selected" : "") + '>' + value + '</option>';
  }

  function renderRequirementTag(label, required, requiredText, optionalText) {
    return '<span class="tag ' + (required ? "required" : "optional") + '">' + label + ' <b>' + (required ? requiredText : optionalText) + '</b></span>';
  }

  function renderRequirementBadge(required, requiredText, optionalText) {
    return '<b class="require-badge ' + (required ? "required" : "optional") + '">' + (required ? requiredText : optionalText) + '</b>';
  }

  function renderUploadZone(item, field) {
    const data = ensureItemData(item.id);
    const required = Boolean(item[field === "before_images" ? "before_required" : "after_required"]);
    const images = data[field] || [];
    const missing = required && !images.length;
    const pendingCount = getPendingCount(item.id, field);
    const safeId = item.id.replace(/[^A-Za-z0-9_-]/g, "_") + "_" + field;
    let thumbs = images.length ? images.map(function (image) {
      return '<div class="thumb"><img src="' + escapeHtml(image.url) + '" alt="' + escapeHtml(image.original_name || FIELD_LABELS[field]) + '"></div>';
    }).join("") : (pendingCount ? "" : '<div class="empty">未上传</div>');
    if (pendingCount) {
      thumbs += '<div class="empty pending">待补传 ' + pendingCount + ' 张</div>';
    }

    return [
      '<div class="upload-zone ' + (missing ? "missing" : "") + '">',
      '<span class="field-label field-label-row"><span>' + FIELD_LABELS[field] + '</span>' + renderRequirementBadge(required, "必传", "选传") + '</span>',
      '<div class="upload-actions">',
      '<label><button type="button" data-trigger-file="' + safeId + '_camera">拍照</button><input id="' + safeId + '_camera" type="file" accept="image/*" capture="environment" data-upload-field="' + field + '" data-item-id="' + escapeHtml(item.id) + '"></label>',
      '<label><button type="button" data-trigger-file="' + safeId + '_album">选图</button><input id="' + safeId + '_album" type="file" accept="image/*" multiple data-upload-field="' + field + '" data-item-id="' + escapeHtml(item.id) + '"></label>',
      '</div>',
      '<div class="thumb-grid">' + thumbs + '</div>',
      '</div>'
    ].join("");
  }

  function bindItemEvents() {
    document.querySelectorAll("[data-trigger-file]").forEach(function (button) {
      button.addEventListener("click", function () {
        const input = document.getElementById(button.dataset.triggerFile);
        if (input) input.click();
      });
    });

    document.querySelectorAll("[data-upload-field]").forEach(function (input) {
      input.addEventListener("change", function () {
        uploadFiles(input.dataset.itemId, input.dataset.uploadField, input.files);
        input.value = "";
      });
    });

    document.querySelectorAll(".record-textarea").forEach(function (textarea) {
      textarea.addEventListener("input", function () {
        ensureItemData(textarea.dataset.itemId).measured_value = textarea.value;
        persistDrafts();
        updateCardStatus(textarea.dataset.itemId);
        updateProgress();
      });
      textarea.addEventListener("blur", function () {
        saveItem(textarea.dataset.itemId, false);
      });
    });

    document.querySelectorAll(".conclusion-select").forEach(function (select) {
      select.addEventListener("change", function () {
        ensureItemData(select.dataset.itemId).conclusion = select.value || "正常";
        persistDrafts();
        saveItem(select.dataset.itemId, false);
      });
    });

    document.querySelectorAll("[data-save-item]").forEach(function (button) {
      button.addEventListener("click", function () {
        saveItem(button.dataset.saveItem, true);
      });
    });

    document.querySelectorAll("[data-next-item]").forEach(function (button) {
      button.addEventListener("click", async function () {
        const saved = await saveItem(button.dataset.nextItem, true);
        if (saved) focusNextItem(button.dataset.nextItem);
      });
    });

    document.querySelectorAll("[data-voice-item]").forEach(function (button) {
      button.addEventListener("click", function () {
        startVoice(button.dataset.voiceItem);
      });
    });
    updateVoiceButtonState();
  }

  function setSaveState(itemId, text) {
    const node = document.getElementById("save_" + itemId);
    if (node) node.textContent = text;
  }

  function syncItemFromDom(itemId) {
    const data = ensureItemData(itemId);
    const textarea = document.querySelector('.record-textarea[data-item-id="' + itemId + '"]');
    const select = document.querySelector('.conclusion-select[data-item-id="' + itemId + '"]');
    if (textarea) data.measured_value = textarea.value;
    if (select) data.conclusion = select.value || "正常";
    persistDrafts();
    return data;
  }

  async function saveItem(itemId, showMessage) {
    syncItemFromDom(itemId);
    if (state.saving[itemId]) {
      const result = await state.saving[itemId];
      if (showMessage && result) showToast("已保存");
      updateCard(itemId);
      return result;
    }

    const savePromise = doSaveItem(itemId, showMessage);
    state.saving[itemId] = savePromise;
    try {
      return await savePromise;
    } finally {
      delete state.saving[itemId];
    }
  }

  async function doSaveItem(itemId, showMessage) {
    const data = ensureItemData(itemId);
    setSaveState(itemId, "保存中...");
    try {
      const result = await fetchJson("/api/mobile/item/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: state.taskId,
          token: state.token,
          item_id: itemId,
          measured_value: data.measured_value || "",
          conclusion: data.conclusion || "正常"
        })
      });
      if (result.item) {
        state.itemData[itemId] = Object.assign(ensureItemData(itemId), result.item);
      }
      markPcReachable("已连接");
      persistDrafts();
      setSaveState(itemId, "已保存");
      if (showMessage) showToast("已保存");
      updateCard(itemId);
      return true;
    } catch (err) {
      setSaveState(itemId, "已存本机，待同步");
      if (isNetworkError(err)) {
        markPcUnreachable("电脑不可达");
        showToast("电脑暂时不可达，记录已保存在本机草稿。");
      } else {
        showToast(err.message || "保存失败，请重试。");
      }
      return false;
    }
  }

  function localTimeText() {
    const now = new Date();
    const pad = function (value) { return String(value).padStart(2, "0"); };
    return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " + pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  }

  function cleanFileBase(name) {
    return String(name || "photo").replace(/\.[^.]+$/, "").replace(/[^\w\u4e00-\u9fff-]+/g, "_").slice(0, 48) || "photo";
  }

  function loadImageFromFile(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("图片读取失败，请重新选择。"));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        resolve(blob);
      }, "image/jpeg", quality);
    });
  }

  async function preprocessImage(file, item, field) {
    const img = await loadImageFromFile(file);
    const ratio = Math.min(1, MAX_CLIENT_SIDE / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * ratio));
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.84;
    let blob = await canvasToBlob(canvas, quality);
    while (blob && blob.size > TARGET_IMAGE_SIZE && quality > 0.58) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, quality);
    }
    if (!blob) {
      throw new Error("图片处理失败，请重新选择。");
    }
    const processedName = cleanFileBase(file.name) + "_compressed.jpg";
    return {
      blob: blob,
      file_name: processedName,
      original_name: file.name || processedName,
      original_size: file.size || blob.size,
      processed_size: blob.size,
      compressed: blob.size < (file.size || blob.size),
      watermarked: false,
      watermark_text: ""
    };
  }

  async function uploadFiles(itemId, field, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const item = state.items.find(function (entry) { return entry.id === itemId; });
    if (!item) return;
    setSaveState(itemId, "处理照片...");
    let queued = 0;
    for (const file of files) {
      try {
        const processed = await preprocessImage(file, item, field);
        await queueUpload(itemId, field, processed);
        queued += 1;
      } catch (err) {
        showToast(err.message || "图片处理失败，请重新选择。");
      }
    }
    if (queued) {
      setSaveState(itemId, "已进入补传队列");
      showToast("已暂存 " + queued + " 张照片，开始上传。");
      await refreshPendingInfo(true);
      retryPendingUploads(true);
    }
  }

  async function queueUpload(itemId, field, processed) {
    const uploadId = [state.taskId, itemId, field, Date.now(), Math.random().toString(16).slice(2)].join("_");
    const chunkCount = Math.max(1, Math.ceil(processed.blob.size / CHUNK_SIZE));
    await dbPut(UPLOAD_STORE, {
      id: uploadId,
      upload_id: uploadId,
      task_id: state.taskId,
      token: state.token,
      item_id: itemId,
      field: field,
      file_name: processed.file_name,
      original_name: processed.original_name,
      blob: processed.blob,
      original_size: processed.original_size,
      processed_size: processed.processed_size,
      chunk_size: CHUNK_SIZE,
      chunk_count: chunkCount,
      uploaded_chunks: [],
      status: "queued",
      attempts: 0,
      last_error: "",
      created_at: new Date().toISOString(),
      client_meta: {
        original_size: processed.original_size,
        processed_size: processed.processed_size,
        compressed: processed.compressed,
        watermarked: processed.watermarked,
        watermark_text: processed.watermark_text
      }
    });
  }

  async function getPendingUploads() {
    let rows = [];
    try {
      rows = await dbGetAll(UPLOAD_STORE);
    } catch (err) {
      return [];
    }
    return rows.filter(function (row) {
      return row.task_id === state.taskId && row.token === state.token;
    }).sort(function (a, b) {
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });
  }

  async function refreshPendingInfo(shouldRender) {
    const pending = await getPendingUploads();
    const counts = {};
    pending.forEach(function (row) {
      const key = row.item_id + "::" + row.field;
      counts[key] = (counts[key] || 0) + 1;
    });
    state.pendingCounts = counts;
    updatePendingBar(pending.length);
    if (shouldRender) renderItems();
    return pending;
  }

  function updatePendingBar(count) {
    const card = document.getElementById("pendingCard");
    const countNode = document.getElementById("pendingCount");
    if (!card || !countNode) return;
    countNode.textContent = String(count || 0);
    card.classList.toggle("hidden", !(count > 0));
    if (state.pcReachable) {
      setStatus(count > 0 ? "已连接，待补传" : "已连接", "ok");
    }
  }

  async function retryPendingUploads(showMessage) {
    if (!state.taskId || !state.token || state.retryingPending) return;
    const pending = await refreshPendingInfo(false);
    if (!pending.length) return;
    state.retryingPending = true;
    let uploaded = 0;
    try {
      for (const row of pending) {
        try {
          const result = await sendQueuedUpload(row);
          if (result && result.item) {
            state.itemData[row.item_id] = Object.assign(ensureItemData(row.item_id), result.item);
          }
          await dbDelete(UPLOAD_STORE, row.id);
          uploaded += 1;
          updateCard(row.item_id);
        } catch (err) {
          row.attempts = Number(row.attempts || 0) + 1;
          row.last_error = err.message || "补传失败";
          row.status = isNetworkError(err) ? "waiting_network" : "error";
          await dbPut(UPLOAD_STORE, row);
          if (isNetworkError(err)) {
            markPcUnreachable("电脑不可达");
            break;
          }
        }
      }
      await refreshPendingInfo(true);
      updateProgress();
      scheduleSnapshot();
      if (uploaded && showMessage) showToast("已补传 " + uploaded + " 张照片。");
      if (!uploaded && showMessage) showToast("仍无法连接电脑，请恢复热点/WiFi 后重试。");
    } finally {
      state.retryingPending = false;
    }
  }

  async function sendQueuedUpload(row) {
    const blob = row.blob;
    if (!blob) throw new Error("本地照片缓存无效，请重新选择照片。");
    const chunkSize = Number(row.chunk_size || CHUNK_SIZE);
    const chunkCount = Math.max(1, Math.ceil(blob.size / chunkSize));
    row.chunk_count = chunkCount;
    row.processed_size = blob.size;

    let uploadedSet = new Set((row.uploaded_chunks || []).map(Number));
    try {
      const status = await fetchJson("/api/mobile/upload/chunk/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: state.taskId,
          token: state.token,
          upload_id: row.upload_id || row.id
        })
      });
      (status.uploaded_chunks || []).forEach(function (index) {
        uploadedSet.add(Number(index));
      });
      markPcReachable("已连接");
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      markPcUnreachable("电脑不可达");
      throw err;
    }

    for (let index = 0; index < chunkCount; index += 1) {
      if (uploadedSet.has(index)) continue;
      const start = index * chunkSize;
      const chunk = blob.slice(start, Math.min(start + chunkSize, blob.size), "image/jpeg");
      const formData = new FormData();
      formData.append("task_id", state.taskId);
      formData.append("token", state.token);
      formData.append("item_id", row.item_id);
      formData.append("field", row.field);
      formData.append("upload_id", row.upload_id || row.id);
      formData.append("chunk_index", String(index));
      formData.append("chunk_count", String(chunkCount));
      formData.append("file_name", row.file_name || "mobile_photo.jpg");
      formData.append("original_size", String(row.original_size || blob.size));
      formData.append("processed_size", String(blob.size));
      formData.append("client_meta", JSON.stringify(row.client_meta || {}));
      formData.append("chunk", chunk, (row.file_name || "mobile_photo.jpg") + ".part");
      const result = await fetchJson("/api/mobile/upload/chunk", { method: "POST", body: formData });
      markPcReachable("补传中");
      (result.uploaded_chunks || [index]).forEach(function (chunkIndex) {
        uploadedSet.add(Number(chunkIndex));
      });
      row.uploaded_chunks = Array.from(uploadedSet).sort(function (a, b) { return a - b; });
      row.status = "uploading";
      await dbPut(UPLOAD_STORE, row);
      setSaveState(row.item_id, "补传中 " + row.uploaded_chunks.length + "/" + chunkCount);
    }

    const complete = await fetchJson("/api/mobile/upload/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: state.taskId,
        token: state.token,
        upload_id: row.upload_id || row.id
      })
    });
    markPcReachable("已连接");
    setSaveState(row.item_id, "已补传");
    return complete;
  }

  function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = function (event) {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        text += event.results[i][0].transcript;
      }
      const itemId = state.recognizingItemId;
      const textarea = document.querySelector('.record-textarea[data-item-id="' + itemId + '"]');
      if (textarea && text) {
        const current = textarea.value.trim();
        textarea.value = current ? current + "\n" + text : text;
        ensureItemData(itemId).measured_value = textarea.value;
        persistDrafts();
        updateCardStatus(itemId);
        updateProgress();
      }
    };
    recognition.onerror = function () {
      showToast("语音识别失败，可继续手动填写。");
      state.recognizingItemId = "";
      updateVoiceButtonState();
    };
    recognition.onend = function () {
      state.recognizingItemId = "";
      updateVoiceButtonState();
    };
    state.recognition = recognition;
  }

  function startVoice(itemId) {
    if (!state.recognition) {
      showToast("当前浏览器不支持语音转文字。");
      return;
    }
    if (state.recognizingItemId) {
      state.recognition.stop();
      state.recognizingItemId = "";
      updateVoiceButtonState();
      return;
    }
    state.recognizingItemId = itemId;
    updateVoiceButtonState();
    try {
      state.recognition.start();
      setSaveState(itemId, "语音识别中...");
    } catch (err) {
      state.recognizingItemId = "";
      updateVoiceButtonState();
      showToast("语音识别未启动，请检查浏览器权限。");
    }
  }

  function updateVoiceButtonState() {
    document.querySelectorAll("[data-voice-item]").forEach(function (button) {
      if (!state.recognition) {
        button.disabled = true;
        button.textContent = "不支持语音";
        return;
      }
      const active = button.dataset.voiceItem === state.recognizingItemId;
      button.classList.toggle("active", active);
      button.textContent = active ? "停止识别" : "语音转文字";
    });
  }

  function updateCard(itemId) {
    renderItems();
    updateProgress();
  }

  function updateCardStatus(itemId) {
    const item = state.items.find(function (entry) { return entry.id === itemId; });
    const card = document.querySelector('[data-item-card="' + itemId + '"]');
    if (!item || !card) return;
    const done = itemDone(item);
    const missingPhoto = itemMissingPhoto(item);
    const missingRecord = itemMissingRecord(item);
    const status = card.querySelector(".status-tag");
    card.dataset.done = done ? "1" : "0";
    card.dataset.photo = missingPhoto ? "0" : "1";
    card.dataset.record = missingRecord ? "0" : "1";
    if (status) {
      status.textContent = itemStatusText(item);
      status.classList.toggle("done", done);
      status.classList.toggle("missing", !done);
    }
    const oldHint = card.querySelector(".record-hint");
    const textarea = card.querySelector(".record-textarea");
    const hintHtml = recordHint(item);
    if (oldHint) oldHint.remove();
    if (textarea && hintHtml) {
      textarea.parentElement.insertAdjacentHTML("beforeend", hintHtml);
    }
    applyFilter();
  }

  function focusNextItem(itemId) {
    const index = state.items.findIndex(function (item) { return item.id === itemId; });
    if (index === -1 || index >= state.items.length - 1) {
      showToast("已经是最后一项");
      return;
    }
    const next = document.querySelector('[data-item-card="' + state.items[index + 1].id + '"]');
    if (next) next.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyFilter() {
    document.querySelectorAll("[data-item-card]").forEach(function (card) {
      let show = true;
      if (state.filter === "todo") show = card.dataset.done === "0";
      if (state.filter === "photo") show = card.dataset.photo === "0";
      if (state.filter === "record") show = card.dataset.record === "0";
      card.classList.toggle("hidden", !show);
    });
  }
})();

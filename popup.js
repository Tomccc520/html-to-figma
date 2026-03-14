/**
 * @copyright Tomda (https://www.tomda.top)
 * @copyright UIED技术团队 (https://fsuied.com)
 * @author UIED技术团队
 * @createDate 2026-03-10
 */

const STORAGE_KEYS = {
  ENABLE_PROXY: "web2html.enableProxyFetch",
  PROXY_CONCURRENCY: "web2html.proxyConcurrency"
};

const LEGACY_STORAGE_KEYS = {
  ENABLE_PROXY: "enableAssetProxyFetch",
  PROXY_CONCURRENCY: "proxyFetchConcurrency"
};

const MESSAGE_TYPES = {
  START_CAPTURE: "WEB2HTML_START_CAPTURE",
  START_FIGMA_CLIPBOARD_CAPTURE: "WEB2HTML_START_FIGMA_CLIPBOARD_CAPTURE",
  INJECT_TOOLBAR: "WEB2HTML_INJECT_TOOLBAR",
  GET_LAST_CAPTURE_JSON: "WEB2HTML_GET_LAST_CAPTURE_JSON",
  GET_RUNTIME_INFO: "WEB2HTML_GET_RUNTIME_INFO"
};

const BUTTON_TEXT = {
  COPY_TO_FIGMA: "打开黑色悬浮条（推荐）",
  DOWNLOAD_JSON: "下载 JSON 文件（备份）",
  COPY_LAST_JSON: "仅复制最近一次 JSON",
  INJECT_TOOLBAR: "注入网页悬浮工具条（旧版）"
};

const DEFAULT_CONCURRENCY = "8";
const ALLOWED_CONCURRENCY = new Set(["4", "6", "8", "10", "12", "16", "20", "infinite"]);

const proxyToggleEl = document.getElementById("assetProxyToggle");
const concurrencyEl = document.getElementById("proxyConcurrency");
const copyToFigmaBtnEl = document.getElementById("copyToFigmaBtn");
const downloadJsonBtnEl = document.getElementById("downloadJsonBtn");
const copyLastJsonBtnEl = document.getElementById("copyLastJsonBtn");
const injectToolbarBtnEl = document.getElementById("injectToolbarBtn");
const statusEl = document.getElementById("status");
const toastEl = document.getElementById("toast");
const versionInfoEl = document.getElementById("versionInfo");
let toastTimer = null;

/**
 * 更新状态文本，并按错误类型切换样式。
 */
function setStatus(message, isError = false, isSuccess = false) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("is-error", Boolean(isError));
  statusEl.classList.toggle("is-success", Boolean(isSuccess));
}

/**
 * 切换按钮忙碌态，防止重复点击。
 */
function setBusy(isBusy) {
  copyToFigmaBtnEl.disabled = isBusy;
  downloadJsonBtnEl.disabled = isBusy;
  copyLastJsonBtnEl.disabled = isBusy;
  injectToolbarBtnEl.disabled = isBusy;
  copyToFigmaBtnEl.textContent = isBusy ? "处理中..." : BUTTON_TEXT.COPY_TO_FIGMA;
  downloadJsonBtnEl.textContent = isBusy ? "处理中..." : BUTTON_TEXT.DOWNLOAD_JSON;
  copyLastJsonBtnEl.textContent = isBusy ? "处理中..." : BUTTON_TEXT.COPY_LAST_JSON;
  injectToolbarBtnEl.textContent = isBusy ? "处理中..." : BUTTON_TEXT.INJECT_TOOLBAR;
}

/**
 * 显示浮层提醒，用于强调复制成功等关键反馈。
 */
function showToast(message, isError = false) {
  if (!toastEl) {
    return;
  }

  toastEl.textContent = message || "";
  toastEl.style.background = isError ? "#b42318" : "#067647";
  toastEl.classList.remove("hidden");

  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 1800);
}

/**
 * 标准化并发值，只允许固定档位。
 */
function normalizeConcurrency(value) {
  const nextValue = String(value ?? "");
  return ALLOWED_CONCURRENCY.has(nextValue) ? nextValue : DEFAULT_CONCURRENCY;
}

/**
 * 从本地存储读取配置并初始化界面。
 */
async function loadSettings() {
  const result = await chrome.storage.local.get({
    [STORAGE_KEYS.ENABLE_PROXY]: false,
    [STORAGE_KEYS.PROXY_CONCURRENCY]: DEFAULT_CONCURRENCY,
    [LEGACY_STORAGE_KEYS.ENABLE_PROXY]: false,
    [LEGACY_STORAGE_KEYS.PROXY_CONCURRENCY]: DEFAULT_CONCURRENCY
  });

  const enableProxyValue = typeof result[STORAGE_KEYS.ENABLE_PROXY] === "boolean"
    ? result[STORAGE_KEYS.ENABLE_PROXY]
    : result[LEGACY_STORAGE_KEYS.ENABLE_PROXY];
  const concurrencyValue = result[STORAGE_KEYS.PROXY_CONCURRENCY]
    || result[LEGACY_STORAGE_KEYS.PROXY_CONCURRENCY];

  proxyToggleEl.checked = Boolean(enableProxyValue);
  concurrencyEl.value = normalizeConcurrency(concurrencyValue);
}

/**
 * 保存代理开关配置。
 */
async function saveProxyEnabled(isEnabled) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.ENABLE_PROXY]: Boolean(isEnabled),
    [LEGACY_STORAGE_KEYS.ENABLE_PROXY]: Boolean(isEnabled)
  });
  setStatus(isEnabled ? "已开启跨域图片代理模式" : "已关闭跨域图片代理模式");
}

/**
 * 保存图片抓取并发配置。
 */
async function saveConcurrency(concurrency) {
  const normalized = normalizeConcurrency(concurrency);
  concurrencyEl.value = normalized;
  await chrome.storage.local.set({
    [STORAGE_KEYS.PROXY_CONCURRENCY]: normalized,
    [LEGACY_STORAGE_KEYS.PROXY_CONCURRENCY]: normalized
  });
  setStatus(`图片采集并发已设为：${normalized === "infinite" ? "无限" : normalized}`);
}

/**
 * 发送消息给后台并转为 Promise 风格。
 */
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * 采集并写入 Figma 可识别剪贴板，可在 Figma 画布直接粘贴。
 */
async function captureAndCopyToFigma() {
  setBusy(true);
  setStatus("");

  try {
    const response = await sendMessage({
      type: MESSAGE_TYPES.START_FIGMA_CLIPBOARD_CAPTURE,
      selector: "body",
      mode: "toolbar_only"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "未知错误");
    }

    setStatus("黑色悬浮条已打开。请在条内点击功能按钮后再开始采集。", false, true);
    showToast("黑色悬浮条已打开");
  } catch (error) {
    setStatus(`打开黑色悬浮条失败：${String(error.message || error)}`, true);
    showToast("打开失败，请刷新页面重试", true);
  } finally {
    setBusy(false);
  }
}

/**
 * 采集并下载 JSON 文件。
 */
async function captureAndDownloadJson() {
  setBusy(true);
  setStatus("");

  try {
    const response = await sendMessage({
      type: MESSAGE_TYPES.START_CAPTURE,
      download: true
    });
    if (!response?.ok) {
      throw new Error(response?.error || "未知错误");
    }

    setStatus("采集成功，JSON 文件已下载。", false, true);
    showToast("下载已开始");
  } catch (error) {
    setStatus(`下载 JSON 失败：${String(error.message || error)}`, true);
    showToast("下载失败", true);
  } finally {
    setBusy(false);
  }
}

/**
 * 复制文本到剪贴板，并提供降级方案兼容旧环境。
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

/**
 * 复制最近一次采集 JSON，便于粘贴到 Figma 插件输入框。
 */
async function copyLastCapturedJson() {
  setBusy(true);
  setStatus("");

  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.GET_LAST_CAPTURE_JSON });
    if (!response?.ok || !response?.json) {
      throw new Error(response?.error || "暂无可复制数据");
    }

    await copyToClipboard(response.json);
    setStatus("已复制最近一次采集 JSON，可直接去 Figma 粘贴", false, true);
    showToast("复制成功");
  } catch (error) {
    setStatus(`复制失败：${String(error.message || error)}`, true);
    showToast("复制失败", true);
  } finally {
    setBusy(false);
  }
}

/**
 * 向当前网页注入悬浮工具条。
 */
async function injectToolbarToPage() {
  setBusy(true);
  setStatus("");

  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.INJECT_TOOLBAR });
    if (!response?.ok) {
      throw new Error(response?.error || "未知错误");
    }
    setStatus("网页悬浮工具条已注入");
    setTimeout(() => window.close(), 450);
  } catch (error) {
    setStatus(`注入失败：${String(error.message || error)}`, true);
  } finally {
    setBusy(false);
  }
}

/**
 * 绑定交互并初始化弹窗逻辑。
 */
async function initPopup() {
  const localVersion = chrome.runtime.getManifest().version || "--";
  if (versionInfoEl) {
    versionInfoEl.textContent = `v${localVersion}`;
  }

  try {
    const runtimeInfo = await sendMessage({ type: MESSAGE_TYPES.GET_RUNTIME_INFO });
    if (runtimeInfo?.ok) {
      console.log(
        `[Web to Design] popup connected to worker v${runtimeInfo.version}, bootAt=${runtimeInfo.workerBootAt}`
      );
      if (versionInfoEl && runtimeInfo?.version) {
        versionInfoEl.textContent = `v${runtimeInfo.version}`;
      }
    }
  } catch (error) {
    console.warn("[Web to Design] runtime info unavailable:", String(error?.message || error));
  }

  await loadSettings();

  proxyToggleEl.addEventListener("change", () => {
    saveProxyEnabled(proxyToggleEl.checked).catch((error) => {
      setStatus(`保存失败：${String(error.message || error)}`, true);
    });
  });

  concurrencyEl.addEventListener("change", () => {
    saveConcurrency(concurrencyEl.value).catch((error) => {
      setStatus(`保存失败：${String(error.message || error)}`, true);
    });
  });

  copyToFigmaBtnEl.addEventListener("click", () => {
    captureAndCopyToFigma();
  });

  downloadJsonBtnEl.addEventListener("click", () => {
    captureAndDownloadJson();
  });

  copyLastJsonBtnEl.addEventListener("click", () => {
    copyLastCapturedJson();
  });

  injectToolbarBtnEl.addEventListener("click", () => {
    injectToolbarToPage();
  });
}

initPopup().catch((error) => {
  setStatus(`初始化失败：${String(error.message || error)}`, true);
});

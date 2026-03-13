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
  START_COMPONENT_CAPTURE: "WEB2HTML_START_COMPONENT_CAPTURE",
  INJECT_TOOLBAR: "WEB2HTML_INJECT_TOOLBAR",
  GET_LAST_CAPTURE_JSON: "WEB2HTML_GET_LAST_CAPTURE_JSON",
  GET_RUNTIME_INFO: "WEB2HTML_GET_RUNTIME_INFO"
};

const BUTTON_TEXT = {
  COPY_SMART_TO_FIGMA: "智能复制到 Figma",
  COPY_FULL_PAGE_TO_FIGMA: "整页复制到 Figma",
  DOWNLOAD_JSON: "下载 JSON 文件",
  COPY_LAST_JSON: "仅复制最近一次 JSON",
  COPY_COMPONENT_JSON: "复制组件 JSON",
  INJECT_TOOLBAR: "注入网页悬浮工具条"
};

const DEFAULT_CONCURRENCY = "8";
const ALLOWED_CONCURRENCY = new Set(["4", "6", "8", "10", "12", "16", "20", "infinite"]);

const proxyToggleEl = document.getElementById("assetProxyToggle");
const concurrencyEl = document.getElementById("proxyConcurrency");
const copyToFigmaBtnEl = document.getElementById("copyToFigmaBtn");
const copyFullPageToFigmaBtnEl = document.getElementById("copyFullPageToFigmaBtn");
const downloadJsonBtnEl = document.getElementById("downloadJsonBtn");
const copyLastJsonBtnEl = document.getElementById("copyLastJsonBtn");
const copyComponentJsonBtnEl = document.getElementById("copyComponentJsonBtn");
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
  copyFullPageToFigmaBtnEl.disabled = isBusy;
  downloadJsonBtnEl.disabled = isBusy;
  copyLastJsonBtnEl.disabled = isBusy;
  copyComponentJsonBtnEl.disabled = isBusy;
  injectToolbarBtnEl.disabled = isBusy;
  copyToFigmaBtnEl.textContent = isBusy ? "处理中..." : BUTTON_TEXT.COPY_SMART_TO_FIGMA;
  copyFullPageToFigmaBtnEl.textContent = isBusy ? "处理中..." : BUTTON_TEXT.COPY_FULL_PAGE_TO_FIGMA;
  downloadJsonBtnEl.textContent = isBusy ? "处理中..." : BUTTON_TEXT.DOWNLOAD_JSON;
  copyLastJsonBtnEl.textContent = isBusy ? "处理中..." : BUTTON_TEXT.COPY_LAST_JSON;
  copyComponentJsonBtnEl.textContent = isBusy ? "处理中..." : BUTTON_TEXT.COPY_COMPONENT_JSON;
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
      mode: "smart"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "未知错误");
    }

    if (response?.result?.pending) {
      setStatus("已触发复制流程，页面仍在处理，请稍后到 Figma 画布按 Command + V 粘贴。", false, true);
      showToast("复制流程已启动");
    } else {
      setStatus("复制成功。请切换到 Figma 画布后按 Command + V 粘贴。", false, true);
      showToast("已复制到 Figma");
    }
  } catch (error) {
    setStatus(`复制到 Figma 失败：${String(error.message || error)}`, true);
    showToast("复制失败，请刷新页面重试", true);
  } finally {
    setBusy(false);
  }
}

/**
 * 整页采集并写入 Figma 可识别剪贴板，明确触发“整个页面”路径。
 */
async function captureFullPageAndCopyToFigma() {
  setBusy(true);
  setStatus("");

  try {
    const response = await sendMessage({
      type: MESSAGE_TYPES.START_FIGMA_CLIPBOARD_CAPTURE,
      selector: "body",
      mode: "full_page"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "未知错误");
    }

    if (response?.result?.pending) {
      setStatus("已触发整页复制流程，页面仍在处理，请稍后到 Figma 画布按 Command + V 粘贴。", false, true);
      showToast("整页复制流程已启动");
    } else {
      setStatus("整页复制成功。请切换到 Figma 画布后按 Command + V 粘贴。", false, true);
      showToast("整页已复制到 Figma");
    }
  } catch (error) {
    setStatus(`整页复制失败：${String(error.message || error)}`, true);
    showToast("整页复制失败，请刷新页面重试", true);
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
 * 采集并复制组件版 JSON，便于后续在设计转换流程中识别组件结构。
 */
async function captureAndCopyComponentJson() {
  setBusy(true);
  setStatus("");

  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.START_COMPONENT_CAPTURE });
    if (!response?.ok || !response?.json) {
      throw new Error(response?.error || "组件 JSON 生成失败");
    }

    await copyToClipboard(response.json);
    setStatus("组件 JSON 已复制，可直接粘贴到设计转换流程。", false, true);
    showToast("组件 JSON 复制成功");
  } catch (error) {
    setStatus(`复制组件 JSON 失败：${String(error.message || error)}`, true);
    showToast("组件 JSON 复制失败", true);
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

  copyFullPageToFigmaBtnEl.addEventListener("click", () => {
    captureFullPageAndCopyToFigma();
  });

  downloadJsonBtnEl.addEventListener("click", () => {
    captureAndDownloadJson();
  });

  copyLastJsonBtnEl.addEventListener("click", () => {
    copyLastCapturedJson();
  });

  copyComponentJsonBtnEl.addEventListener("click", () => {
    captureAndCopyComponentJson();
  });

  injectToolbarBtnEl.addEventListener("click", () => {
    injectToolbarToPage();
  });
}

initPopup().catch((error) => {
  setStatus(`初始化失败：${String(error.message || error)}`, true);
});

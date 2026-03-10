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

const MESSAGE_TYPES = {
  START_CAPTURE: "WEB2HTML_START_CAPTURE",
  INJECT_TOOLBAR: "WEB2HTML_INJECT_TOOLBAR",
  GET_LAST_CAPTURE_JSON: "WEB2HTML_GET_LAST_CAPTURE_JSON"
};

const DEFAULT_CONCURRENCY = "8";
const ALLOWED_CONCURRENCY = new Set(["4", "6", "8", "10", "12", "16", "20", "infinite"]);

const proxyToggleEl = document.getElementById("assetProxyToggle");
const concurrencyEl = document.getElementById("proxyConcurrency");
const captureBtnEl = document.getElementById("captureBtn");
const copyLastJsonBtnEl = document.getElementById("copyLastJsonBtn");
const injectToolbarBtnEl = document.getElementById("injectToolbarBtn");
const statusEl = document.getElementById("status");

/**
 * 更新状态文本，并按错误类型切换样式。
 */
function setStatus(message, isError = false) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("is-error", Boolean(isError));
}

/**
 * 切换按钮忙碌态，防止重复点击。
 */
function setBusy(isBusy) {
  captureBtnEl.disabled = isBusy;
  copyLastJsonBtnEl.disabled = isBusy;
  injectToolbarBtnEl.disabled = isBusy;
  captureBtnEl.textContent = isBusy ? "采集中..." : "复制到 Figma";
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
    [STORAGE_KEYS.PROXY_CONCURRENCY]: DEFAULT_CONCURRENCY
  });

  proxyToggleEl.checked = Boolean(result[STORAGE_KEYS.ENABLE_PROXY]);
  concurrencyEl.value = normalizeConcurrency(result[STORAGE_KEYS.PROXY_CONCURRENCY]);
}

/**
 * 保存代理开关配置。
 */
async function saveProxyEnabled(isEnabled) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.ENABLE_PROXY]: Boolean(isEnabled)
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
    [STORAGE_KEYS.PROXY_CONCURRENCY]: normalized
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
 * 触发当前标签页采集，并自动复制结果到剪贴板。
 */
async function captureCurrentPage() {
  setBusy(true);
  setStatus("");

  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.START_CAPTURE });
    if (!response?.ok) {
      throw new Error(response?.error || "未知错误");
    }

    const jsonResponse = await sendMessage({ type: MESSAGE_TYPES.GET_LAST_CAPTURE_JSON });
    if (!jsonResponse?.ok || !jsonResponse?.json) {
      throw new Error(jsonResponse?.error || "采集成功但读取 JSON 失败");
    }

    await copyToClipboard(jsonResponse.json);
    setStatus("已复制到剪贴板，可去 Figma 粘贴；JSON 备份也已下载");
    setTimeout(() => window.close(), 600);
  } catch (error) {
    setStatus(`采集失败：${String(error.message || error)}`, true);
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
    setStatus("已复制最近一次采集 JSON，可直接去 Figma 粘贴");
    setTimeout(() => window.close(), 450);
  } catch (error) {
    setStatus(`复制失败：${String(error.message || error)}`, true);
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

  captureBtnEl.addEventListener("click", () => {
    captureCurrentPage();
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

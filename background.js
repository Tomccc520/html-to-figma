/**
 * @copyright Tomda (https://www.tomda.top)
 * @copyright UIED技术团队 (https://fsuied.com)
 * @author UIED技术团队
 * @createDate 2026-03-10
 */

const WORLD = "ISOLATED";
const CAPTURE_ENGINE_FILE = "content.js";
const CAPTURE_RUNNER_FILE = "runner.js";
const TOOLBAR_FILE = "inpage-toolbar.js";

const MESSAGE_TYPES = {
  START_CAPTURE: "WEB2HTML_START_CAPTURE",
  INJECT_TOOLBAR: "WEB2HTML_INJECT_TOOLBAR",
  FETCH_ASSET: "WEB2HTML_FETCH_ASSET",
  GET_DIAGNOSTICS: "WEB2HTML_GET_DIAGNOSTICS",
  GET_LAST_CAPTURE_JSON: "WEB2HTML_GET_LAST_CAPTURE_JSON"
};

const STORAGE_KEYS = {
  ENABLE_PROXY: "web2html.enableProxyFetch",
  PROXY_CONCURRENCY: "web2html.proxyConcurrency",
  SESSION_CACHE: "web2html.proxyAssetCache",
  DIAGNOSTICS: "web2html.proxyDiagnostics"
};

const DEFAULT_CONCURRENCY = 8;
const ALLOWED_CONCURRENCY = new Set([4, 6, 8, 10, 12, 16, 20]);
const MAX_DIAGNOSTICS = 500;
const MAX_SESSION_CACHE_ENTRIES = 40;
const FETCH_TIMEOUT_MS = 8000;

const proxyQueue = [];
const proxyInFlight = new Map();
const proxyMemoryCache = new Map();

let proxyActiveCount = 0;
let proxyMaxConcurrency = DEFAULT_CONCURRENCY;
let proxySessionLoaded = false;
let proxySessionCache = {};
let proxyDiagnostics = [];
let lastCapturedJson = "";

/**
 * 休眠指定时间，用于等待页面渲染稳定。
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 注入扩展脚本到目标标签页。
 */
async function injectScriptFile(tabId, file) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: WORLD,
    files: [file]
  });
}

/**
 * 标准化并发档位，避免非法配置进入队列系统。
 */
function normalizeConcurrency(rawValue) {
  if (rawValue === "infinite" || rawValue === "∞") {
    return Number.POSITIVE_INFINITY;
  }

  const value = Number(rawValue);
  if (ALLOWED_CONCURRENCY.has(value)) {
    return value;
  }
  return DEFAULT_CONCURRENCY;
}

/**
 * 输出当前并发配置文本，用于诊断展示。
 */
function concurrencyLabel() {
  return Number.isFinite(proxyMaxConcurrency) ? String(proxyMaxConcurrency) : "infinite";
}

/**
 * 从 storage 加载并发配置。
 */
async function loadConcurrencyConfig() {
  try {
    const result = await chrome.storage.local.get({
      [STORAGE_KEYS.PROXY_CONCURRENCY]: String(DEFAULT_CONCURRENCY)
    });
    proxyMaxConcurrency = normalizeConcurrency(result[STORAGE_KEYS.PROXY_CONCURRENCY]);
  } catch {
    proxyMaxConcurrency = DEFAULT_CONCURRENCY;
  }
}

/**
 * 存储诊断信息，便于后续排查资源抓取失败问题。
 */
function pushDiagnostic(diagnostic) {
  proxyDiagnostics.push({
    ts: Date.now(),
    ...diagnostic
  });

  if (proxyDiagnostics.length > MAX_DIAGNOSTICS) {
    proxyDiagnostics = proxyDiagnostics.slice(-MAX_DIAGNOSTICS);
  }

  if (chrome.storage?.session) {
    chrome.storage.session
      .set({ [STORAGE_KEYS.DIAGNOSTICS]: proxyDiagnostics })
      .catch(() => {});
  }
}

/**
 * 初始化会话缓存，减少同页面重复抓取资源。
 */
async function loadProxySession() {
  if (proxySessionLoaded) {
    return;
  }
  proxySessionLoaded = true;

  if (!chrome.storage?.session) {
    proxySessionCache = {};
    proxyDiagnostics = [];
    return;
  }

  try {
    const result = await chrome.storage.session.get({
      [STORAGE_KEYS.SESSION_CACHE]: {},
      [STORAGE_KEYS.DIAGNOSTICS]: []
    });
    proxySessionCache = result[STORAGE_KEYS.SESSION_CACHE] || {};
    proxyDiagnostics = Array.isArray(result[STORAGE_KEYS.DIAGNOSTICS])
      ? result[STORAGE_KEYS.DIAGNOSTICS]
      : [];
  } catch {
    proxySessionCache = {};
    proxyDiagnostics = [];
  }
}

/**
 * 将缓存写回 session 存储。
 */
async function persistProxySession() {
  if (!chrome.storage?.session) {
    return;
  }

  try {
    await chrome.storage.session.set({
      [STORAGE_KEYS.SESSION_CACHE]: proxySessionCache,
      [STORAGE_KEYS.DIAGNOSTICS]: proxyDiagnostics
    });
  } catch {
    // 忽略会话写入失败，不影响采集主流程。
  }
}

/**
 * 限制 session 缓存条目数量，避免过多大图占满空间。
 */
function trimSessionCache() {
  const keys = Object.keys(proxySessionCache);
  if (keys.length <= MAX_SESSION_CACHE_ENTRIES) {
    return;
  }

  const removeCount = keys.length - MAX_SESSION_CACHE_ENTRIES;
  for (const key of keys.slice(0, removeCount)) {
    delete proxySessionCache[key];
  }
}

/**
 * 将二进制数据转换为 Base64 字符串。
 */
function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

/**
 * 将任务加入资源抓取队列，并按并发限制调度执行。
 */
function enqueueProxyTask(task) {
  return new Promise((resolve, reject) => {
    proxyQueue.push({ task, resolve, reject });
    pumpProxyQueue();
  });
}

/**
 * 消费抓图队列，保证抓取任务不会无限并发。
 */
function pumpProxyQueue() {
  while (proxyActiveCount < proxyMaxConcurrency && proxyQueue.length > 0) {
    const nextTask = proxyQueue.shift();
    proxyActiveCount += 1;

    Promise.resolve()
      .then(nextTask.task)
      .then(nextTask.resolve, nextTask.reject)
      .finally(() => {
        proxyActiveCount -= 1;
        pumpProxyQueue();
      });
  }
}

/**
 * 在后台代理请求资源，绕过页面上下文的跨域限制。
 */
async function proxyFetchAsset(url) {
  await loadProxySession();

  const memoryHit = proxyMemoryCache.get(url);
  if (memoryHit) {
    pushDiagnostic({ url, phase: "proxy-cache-memory", ok: true, status: 200 });
    return { ok: true, status: 200, cacheHit: "memory", ...memoryHit };
  }

  const sessionHit = proxySessionCache[url];
  if (sessionHit) {
    proxyMemoryCache.set(url, sessionHit);
    pushDiagnostic({ url, phase: "proxy-cache-session", ok: true, status: 200 });
    return { ok: true, status: 200, cacheHit: "session", ...sessionHit };
  }

  if (proxyInFlight.has(url)) {
    return proxyInFlight.get(url);
  }

  const promise = enqueueProxyTask(async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response;

      try {
        response = await fetch(url, {
          credentials: "omit",
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const error = `HTTP_${response.status}`;
        pushDiagnostic({ url, phase: "proxy-fetch", ok: false, status: response.status, error });
        return { ok: false, status: response.status, error };
      }

      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const base64 = toBase64(await response.arrayBuffer());
      const payload = { contentType, base64 };

      proxyMemoryCache.set(url, payload);
      proxySessionCache[url] = payload;
      trimSessionCache();
      persistProxySession();

      pushDiagnostic({
        url,
        phase: "proxy-fetch",
        ok: true,
        status: response.status,
        bytes: base64.length
      });

      return {
        ok: true,
        status: response.status,
        contentType,
        base64,
        cacheHit: "miss"
      };
    } catch (error) {
      const message = String(error);
      pushDiagnostic({ url, phase: "proxy-fetch", ok: false, status: 0, error: message });
      return { ok: false, status: 0, error: message };
    }
  }).finally(() => {
    proxyInFlight.delete(url);
  });

  proxyInFlight.set(url, promise);
  return promise;
}

/**
 * 获取当前窗口激活标签页。
 */
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0] || null;
}

/**
 * 运行采集流程，返回结构化设计数据。
 */
async function runCapture(tabId) {
  await injectScriptFile(tabId, CAPTURE_ENGINE_FILE);
  await sleep(120);

  const [executionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    world: WORLD,
    files: [CAPTURE_RUNNER_FILE]
  });

  return executionResult?.result;
}

/**
 * 下载采集结果为本地 JSON。
 */
function saveResult(result) {
  const json = JSON.stringify(result, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  const filename = `web2html-studio-${Date.now()}.json`;

  chrome.downloads.download(
    {
      url: dataUrl,
      filename,
      saveAs: true
    }
  );
}

/**
 * 注入网页悬浮工具条。
 */
async function injectToolbar(tabId) {
  await injectScriptFile(tabId, TOOLBAR_FILE);
}

/**
 * 处理开始采集指令。
 */
async function handleStartCapture(sendResponse) {
  try {
    const activeTab = await getActiveTab();
    if (!activeTab?.id) {
      throw new Error("当前没有可采集的标签页");
    }

    const captureResult = await runCapture(activeTab.id);
    if (!captureResult) {
      throw new Error("采集结果为空，请刷新页面后重试");
    }

    lastCapturedJson = JSON.stringify(captureResult, null, 2);
    saveResult(captureResult);
    sendResponse({ ok: true });
  } catch (error) {
    console.error("Capture failed:", error);
    sendResponse({ ok: false, error: String(error) });
  }
}

/**
 * 处理注入工具条指令。
 */
async function handleInjectToolbar(message, sender, sendResponse) {
  try {
    const tabId = message?.tabId || sender?.tab?.id || (await getActiveTab())?.id;
    if (!tabId) {
      throw new Error("无法定位当前标签页");
    }
    await injectToolbar(tabId);
    sendResponse({ ok: true });
  } catch (error) {
    console.error("Toolbar inject failed:", error);
    sendResponse({ ok: false, error: String(error) });
  }
}

/**
 * 处理资源代理抓取请求。
 */
async function handleFetchAsset(message, sendResponse) {
  const result = await proxyFetchAsset(message.url);
  sendResponse({
    ...result,
    diagnostics: {
      phase: "proxy",
      cacheHit: result.cacheHit ?? null,
      queueDepth: proxyQueue.length,
      activeRequests: proxyActiveCount,
      maxConcurrency: concurrencyLabel()
    }
  });
}

/**
 * 处理诊断信息查询。
 */
async function handleGetDiagnostics(sendResponse) {
  await loadProxySession();
  sendResponse({
    ok: true,
    diagnostics: {
      generatedAt: new Date().toISOString(),
      queueDepth: proxyQueue.length,
      activeRequests: proxyActiveCount,
      inFlight: proxyInFlight.size,
      maxConcurrency: concurrencyLabel(),
      failures: proxyDiagnostics.filter((item) => item && item.ok === false)
    }
  });
}

/**
 * 返回最近一次采集 JSON，供弹窗复制到剪贴板。
 */
function handleGetLastCaptureJson(sendResponse) {
  if (!lastCapturedJson) {
    sendResponse({
      ok: false,
      error: "暂无采集数据，请先执行一次“开始采集并下载 JSON”"
    });
    return;
  }

  sendResponse({
    ok: true,
    json: lastCapturedJson
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (!changes?.[STORAGE_KEYS.PROXY_CONCURRENCY]) {
    return;
  }

  proxyMaxConcurrency = normalizeConcurrency(changes[STORAGE_KEYS.PROXY_CONCURRENCY].newValue);
  pumpProxyQueue();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return undefined;
  }

  if (message.type === MESSAGE_TYPES.START_CAPTURE) {
    handleStartCapture(sendResponse);
    return true;
  }

  if (message.type === MESSAGE_TYPES.INJECT_TOOLBAR) {
    handleInjectToolbar(message, sender, sendResponse);
    return true;
  }

  if (message.type === MESSAGE_TYPES.FETCH_ASSET && message.url) {
    handleFetchAsset(message, sendResponse);
    return true;
  }

  if (message.type === MESSAGE_TYPES.GET_DIAGNOSTICS) {
    handleGetDiagnostics(sendResponse);
    return true;
  }

  if (message.type === MESSAGE_TYPES.GET_LAST_CAPTURE_JSON) {
    handleGetLastCaptureJson(sendResponse);
    return true;
  }

  return undefined;
});

loadConcurrencyConfig();

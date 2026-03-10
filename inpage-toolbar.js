/**
 * @copyright Tomda (https://www.tomda.top)
 * @copyright UIED技术团队 (https://fsuied.com)
 * @author UIED技术团队
 * @createDate 2026-03-10
 */

(() => {
  const TOOLBAR_ID = "__web2html_toolbar__";
  const TOOLBAR_STYLE_ID = "__web2html_toolbar_style__";
  const DEFAULT_CONCURRENCY = "8";
  const ALLOWED_CONCURRENCY = new Set(["4", "6", "8", "10", "12", "16", "20", "infinite"]);

  const STORAGE_KEYS = {
    ENABLE_PROXY: "web2html.enableProxyFetch",
    PROXY_CONCURRENCY: "web2html.proxyConcurrency"
  };

  const MESSAGE_TYPES = {
    START_CAPTURE: "WEB2HTML_START_CAPTURE"
  };

  /**
   * 为工具条及其子节点加忽略标记，避免被采集引擎抓取。
   */
  function markIgnore(node) {
    if (!node) {
      return;
    }
    node.setAttribute("data-web2html-ignore", "1");
    node.setAttribute("data-figma-capture-ignore", "1");
    for (const child of node.children || []) {
      markIgnore(child);
    }
  }

  /**
   * 标准化并发配置，避免保存非法值。
   */
  function normalizeConcurrency(value) {
    const nextValue = String(value ?? "");
    return ALLOWED_CONCURRENCY.has(nextValue) ? nextValue : DEFAULT_CONCURRENCY;
  }

  /**
   * 移除旧工具条，保证页面只存在一个实例。
   */
  function removeToolbar() {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (toolbar) {
      toolbar.remove();
    }

    const style = document.getElementById(TOOLBAR_STYLE_ID);
    if (style) {
      style.remove();
    }
  }

  /**
   * 发送消息给后台并统一处理 runtime 错误。
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
   * 创建工具条样式。
   */
  function createStyle() {
    const style = document.createElement("style");
    style.id = TOOLBAR_STYLE_ID;
    style.textContent = `
      #${TOOLBAR_ID} {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        width: 328px;
        border-radius: 14px;
        border: 1px solid #d6ddea;
        background: #ffffff;
        box-shadow: 0 14px 36px rgba(15, 23, 42, 0.2);
        overflow: hidden;
        color: #111827;
        font-family: "PingFang SC", "SF Pro Text", "Helvetica Neue", sans-serif;
      }
      #${TOOLBAR_ID} * { box-sizing: border-box; }
      #${TOOLBAR_ID} .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border-bottom: 1px solid #e5e7eb;
        background: linear-gradient(180deg, #eff4ff 0%, #ffffff 100%);
      }
      #${TOOLBAR_ID} .title { font-size: 13px; font-weight: 700; }
      #${TOOLBAR_ID} .close {
        border: 0;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: transparent;
        color: #6b7280;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      }
      #${TOOLBAR_ID} .close:hover { background: #f3f4f6; color: #374151; }
      #${TOOLBAR_ID} .body { padding: 12px; display: grid; gap: 10px; }
      #${TOOLBAR_ID} .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        font-size: 13px;
      }
      #${TOOLBAR_ID} .hint {
        margin: 0;
        color: #5b6473;
        font-size: 12px;
        line-height: 1.45;
      }
      #${TOOLBAR_ID} .hidden { display: none !important; }
      #${TOOLBAR_ID} select {
        min-width: 92px;
        border: 1px solid #d1d8e4;
        border-radius: 8px;
        padding: 4px 6px;
        background: #fff;
      }
      #${TOOLBAR_ID} .capture {
        width: 100%;
        border: 0;
        border-radius: 9px;
        background: #0f172a;
        color: #fff;
        font-size: 13px;
        padding: 9px 10px;
        cursor: pointer;
      }
      #${TOOLBAR_ID} .capture:disabled { opacity: 0.65; cursor: default; }
      #${TOOLBAR_ID} .status {
        margin: 0;
        min-height: 18px;
        color: #1f4d8d;
        font-size: 12px;
      }
      #${TOOLBAR_ID} .status.error { color: #b42318; }
    `;
    return style;
  }

  /**
   * 创建工具条 DOM。
   */
  function createToolbar() {
    const section = document.createElement("section");
    section.id = TOOLBAR_ID;
    section.innerHTML = `
      <div class="head">
        <span class="title">Web to Design</span>
        <button class="close" id="web2htmlCloseBtn" type="button" title="关闭">×</button>
      </div>
      <div class="body">
        <label class="row">
          <span>跨域图片代理模式</span>
          <input id="web2htmlProxyToggle" type="checkbox" />
        </label>
        <label class="row" id="web2htmlConcurrencyRow">
          <span>图片采集并发</span>
          <select id="web2htmlProxyConcurrency">
            <option value="4">4</option>
            <option value="6">6</option>
            <option value="8">8</option>
            <option value="10">10</option>
            <option value="12">12</option>
            <option value="16">16</option>
            <option value="20">20</option>
            <option value="infinite">无限</option>
          </select>
        </label>
        <p class="hint">用于减少跨域丢图。页面图片较多时建议并发设置为 6~10。</p>
        <button class="capture" id="web2htmlCaptureBtn" type="button">开始采集并下载 JSON</button>
        <p class="status" id="web2htmlStatus"></p>
      </div>
    `;
    markIgnore(section);
    return section;
  }

  /**
   * 设置底部状态文案。
   */
  function setStatus(statusEl, message, isError = false) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", Boolean(isError));
  }

  /**
   * 更新采集按钮忙碌态。
   */
  function setBusy(buttonEl, isBusy) {
    buttonEl.disabled = isBusy;
    buttonEl.textContent = isBusy ? "采集中..." : "开始采集并下载 JSON";
  }

  /**
   * 根据代理开关显示并发配置区域。
   */
  function toggleConcurrencyRow(proxyToggleEl, rowEl) {
    rowEl.classList.toggle("hidden", !proxyToggleEl.checked);
  }

  /**
   * 读取本地配置并回填工具条状态。
   */
  async function hydrateSettings(proxyToggleEl, concurrencyEl, rowEl) {
    const result = await chrome.storage.local.get({
      [STORAGE_KEYS.ENABLE_PROXY]: false,
      [STORAGE_KEYS.PROXY_CONCURRENCY]: DEFAULT_CONCURRENCY
    });

    proxyToggleEl.checked = Boolean(result[STORAGE_KEYS.ENABLE_PROXY]);
    concurrencyEl.value = normalizeConcurrency(result[STORAGE_KEYS.PROXY_CONCURRENCY]);
    toggleConcurrencyRow(proxyToggleEl, rowEl);
  }

  /**
   * 绑定工具条交互事件。
   */
  function bindEvents(toolbar) {
    const closeBtnEl = toolbar.querySelector("#web2htmlCloseBtn");
    const proxyToggleEl = toolbar.querySelector("#web2htmlProxyToggle");
    const concurrencyEl = toolbar.querySelector("#web2htmlProxyConcurrency");
    const concurrencyRowEl = toolbar.querySelector("#web2htmlConcurrencyRow");
    const captureBtnEl = toolbar.querySelector("#web2htmlCaptureBtn");
    const statusEl = toolbar.querySelector("#web2htmlStatus");

    closeBtnEl.addEventListener("click", () => {
      removeToolbar();
    });

    proxyToggleEl.addEventListener("change", async () => {
      try {
        await chrome.storage.local.set({
          [STORAGE_KEYS.ENABLE_PROXY]: proxyToggleEl.checked
        });
        toggleConcurrencyRow(proxyToggleEl, concurrencyRowEl);
        setStatus(statusEl, proxyToggleEl.checked ? "已开启跨域图片代理模式" : "已关闭跨域图片代理模式");
      } catch (error) {
        setStatus(statusEl, `保存失败：${String(error.message || error)}`, true);
      }
    });

    concurrencyEl.addEventListener("change", async () => {
      try {
        const normalized = normalizeConcurrency(concurrencyEl.value);
        concurrencyEl.value = normalized;
        await chrome.storage.local.set({
          [STORAGE_KEYS.PROXY_CONCURRENCY]: normalized
        });
        setStatus(statusEl, `图片采集并发已设为：${normalized === "infinite" ? "无限" : normalized}`);
      } catch (error) {
        setStatus(statusEl, `保存失败：${String(error.message || error)}`, true);
      }
    });

    captureBtnEl.addEventListener("click", async () => {
      setBusy(captureBtnEl, true);
      setStatus(statusEl, "");

      try {
        const response = await sendMessage({ type: MESSAGE_TYPES.START_CAPTURE });
        if (!response?.ok) {
          throw new Error(response?.error || "未知错误");
        }
        setStatus(statusEl, "采集成功，JSON 文件已开始下载");
      } catch (error) {
        setStatus(statusEl, `采集失败：${String(error.message || error)}`, true);
      } finally {
        setBusy(captureBtnEl, false);
      }
    });

    hydrateSettings(proxyToggleEl, concurrencyEl, concurrencyRowEl).catch((error) => {
      setStatus(statusEl, `初始化失败：${String(error.message || error)}`, true);
    });
  }

  /**
   * 初始化网页悬浮工具条。
   */
  function initToolbar() {
    removeToolbar();
    const style = createStyle();
    const toolbar = createToolbar();

    document.documentElement.appendChild(style);
    document.body.appendChild(toolbar);
    bindEvents(toolbar);
  }

  initToolbar();
})();

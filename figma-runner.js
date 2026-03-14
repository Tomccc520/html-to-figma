/**
 * @copyright Tomda (https://www.tomda.top)
 * @copyright UIED技术团队 (https://fsuied.com)
 * @author UIED技术团队
 * @createDate 2026-03-10
 */

(async () => {
  const MESSAGE_TYPES = {
    START_COMPONENT_CAPTURE: "WEB2HTML_START_COMPONENT_CAPTURE",
    SET_VIEWPORT_PRESET: "WEB2HTML_SET_VIEWPORT_PRESET"
  };

  const COMPONENT_BUTTON_ATTR = "data-web2html-component-copy";
  const VIEWPORT_BUTTON_ATTR = "data-web2html-viewport-size-copy";
  const COMPONENT_BUTTON_READY_FLAG = "__WEB2HTML_COMPONENT_COPY_WATCHING__";

  const LAUNCHER_ID = "__web2html_manual_launcher__";
  const PICKER_BOX_ID = "__web2html_picker_box__";
  const PICKER_TIP_ID = "__web2html_picker_tip__";
  const MODE_LOCK_SEQUENCE = [null, "整页", "元素", "组件"];

  const VIEWPORT_PRESETS = [
    { key: "desktop", label: "Desktop", width: 1440, height: 900 },
    { key: "tablet", label: "Tablet", width: 834, height: 1194 },
    { key: "mobile", label: "Mobile", width: 390, height: 844 }
  ];

  let activeSelector = "body";
  let activeMode = "待选择";
  let activePresetIndex = 0;
  let activeModeLock = null;

  let launcherModeEl = null;
  let launcherPresetButtonEl = null;
  let launcherLockButtonEl = null;

  /**
   * 读取后台注入的运行参数，并在读取后立即清理全局变量。
   */
  function readRuntimeOptions() {
    const options = window.__WEB2HTML_FIGMA_CAPTURE_OPTIONS__ || {};
    try {
      delete window.__WEB2HTML_FIGMA_CAPTURE_OPTIONS__;
    } catch {
      window.__WEB2HTML_FIGMA_CAPTURE_OPTIONS__ = undefined;
    }
    return options;
  }

  /**
   * 向后台发送消息并转为 Promise，供页面内按钮调用扩展能力。
   */
  function sendRuntimeMessage(message) {
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
   * 复制文本到剪贴板，失败时回退到 execCommand 方案。
   */
  async function copyTextToClipboard(text) {
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
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (!copied) {
        throw new Error("写入剪贴板失败");
      }
    }
  }

  /**
   * 获取当前激活的视口预设。
   */
  function getActiveViewportPreset() {
    return VIEWPORT_PRESETS[activePresetIndex] || VIEWPORT_PRESETS[0];
  }

  /**
   * 轮换到下一个视口预设，支持 Desktop/Tablet/Mobile 一键切换。
   */
  function switchToNextViewportPreset() {
    activePresetIndex = (activePresetIndex + 1) % VIEWPORT_PRESETS.length;
    const preset = getActiveViewportPreset();
    if (launcherPresetButtonEl) {
      launcherPresetButtonEl.textContent = `预设 ${preset.label}`;
    }
    refreshModeHint();
    return preset;
  }

  /**
   * 生成当前模式提示文本，降低误操作。
   */
  function buildModeHintText() {
    const preset = getActiveViewportPreset();
    const modeLockText = activeModeLock ? `锁定：${activeModeLock}` : "锁定：关闭";
    return `当前模式：${activeMode} | ${modeLockText} | 预设：${preset.label} ${preset.width}x${preset.height}`;
  }

  /**
   * 刷新手动黑色悬浮条与内置黑色条中的模式提示文案。
   */
  function refreshModeHint() {
    const message = buildModeHintText();
    if (launcherModeEl) {
      launcherModeEl.textContent = message;
    }

    const builtInContext = findCaptureToolbarContext();
    if (builtInContext?.messageEl) {
      builtInContext.messageEl.textContent = `复制到剪贴板 · ${message}`;
    }
  }

  /**
   * 更新当前模式，并同步刷新 UI 提示。
   */
  function setActiveMode(mode) {
    activeMode = mode;
    refreshModeHint();
  }

  /**
   * 轮换模式锁定开关，依次为：关闭 -> 整页 -> 元素 -> 组件。
   */
  function cycleModeLock() {
    const currentIndex = MODE_LOCK_SEQUENCE.indexOf(activeModeLock);
    const nextIndex = (currentIndex + 1) % MODE_LOCK_SEQUENCE.length;
    activeModeLock = MODE_LOCK_SEQUENCE[nextIndex];
    if (launcherLockButtonEl) {
      launcherLockButtonEl.textContent = activeModeLock ? `锁定 ${activeModeLock}` : "锁定 关闭";
    }
    refreshModeHint();
    return activeModeLock;
  }

  /**
   * 判断目标模式是否允许执行，避免误触发错误模式采集。
   */
  function isModeAllowed(targetMode) {
    return !activeModeLock || activeModeLock === targetMode;
  }

  /**
   * 当固定模式锁定与目标操作不一致时，给出短提示并回退模式文案。
   */
  function notifyModeBlocked(targetMode) {
    if (!activeModeLock) {
      return;
    }

    const blockedMessage = `已锁定 ${activeModeLock}，不可切换到 ${targetMode}`;
    if (launcherModeEl) {
      launcherModeEl.textContent = blockedMessage;
    }

    const builtInContext = findCaptureToolbarContext();
    if (builtInContext?.messageEl) {
      builtInContext.messageEl.textContent = `复制到剪贴板 · ${blockedMessage}`;
    }

    setTimeout(() => {
      refreshModeHint();
    }, 1200);
  }

  /**
   * 标记节点及其子节点，避免被采集引擎重复抓取。
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
   * 从元素生成唯一性较高的 CSS 选择器，用于元素级采集。
   */
  function buildUniqueSelector(element) {
    if (element === document.body) {
      return "body";
    }
    if (element === document.documentElement) {
      return "html";
    }

    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    if (element.classList.length > 0) {
      for (const className of element.classList) {
        const candidate = `.${CSS.escape(className)}`;
        if (document.querySelectorAll(candidate).length === 1) {
          return candidate;
        }
      }
    }

    const path = [];
    let cursor = element;

    while (cursor && cursor !== document.body && cursor !== document.documentElement) {
      let segment = cursor.tagName.toLowerCase();

      if (cursor.id) {
        segment = `#${CSS.escape(cursor.id)}`;
        path.unshift(segment);
        break;
      }

      const parent = cursor.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((node) => node.tagName === cursor.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(cursor) + 1;
          segment += `:nth-of-type(${index})`;
        }
      }

      path.unshift(segment);
      cursor = cursor.parentElement;
    }

    return path.join(" > ") || "body";
  }

  /**
   * 判断节点是否位于手动悬浮条内部，避免选择器模式误选工具自身。
   */
  function isInManualLauncher(node) {
    const launcher = document.getElementById(LAUNCHER_ID);
    return Boolean(launcher && node && launcher.contains(node));
  }

  /**
   * 销毁手动黑色悬浮条。
   */
  function removeManualLauncher() {
    const launcher = document.getElementById(LAUNCHER_ID);
    if (launcher) {
      launcher.remove();
    }
    launcherModeEl = null;
    launcherPresetButtonEl = null;
    launcherLockButtonEl = null;
  }

  /**
   * 进入元素选择模式，点击页面任意元素后回调选择器。
   */
  function startElementPicker(onPick, onCancel) {
    const box = document.createElement("div");
    box.id = PICKER_BOX_ID;
    box.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "z-index:2147483646",
      "border:2px dashed #3b82f6",
      "background:rgba(59,130,246,0.14)",
      "border-radius:8px",
      "display:none",
      "box-sizing:border-box"
    ].join(";");

    const tip = document.createElement("div");
    tip.id = PICKER_TIP_ID;
    tip.textContent = "选择元素模式：点击页面元素完成，Esc 取消";
    tip.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:18px",
      "transform:translateX(-50%)",
      "z-index:2147483647",
      "padding:8px 12px",
      "border-radius:10px",
      "font-size:12px",
      "font-family:\"PingFang SC\",\"SF Pro Text\",sans-serif",
      "background:rgba(17,24,39,0.95)",
      "color:#fff",
      "pointer-events:none"
    ].join(";");

    document.documentElement.appendChild(box);
    document.documentElement.appendChild(tip);

    let currentTarget = null;

    const cleanup = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeydown, true);
      box.remove();
      tip.remove();
    };

    const onMove = (event) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || isInManualLauncher(target)) {
        box.style.display = "none";
        currentTarget = null;
        return;
      }

      const rect = target.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) {
        box.style.display = "none";
        currentTarget = null;
        return;
      }

      currentTarget = target;
      box.style.display = "block";
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
    };

    const onClick = (event) => {
      if (!currentTarget) {
        return;
      }
      if (isInManualLauncher(currentTarget)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const selector = buildUniqueSelector(currentTarget);
      cleanup();
      onPick(selector);
    };

    const onKeydown = (event) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      cleanup();
      onCancel();
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeydown, true);
  }

  /**
   * 在页面中查找 capture.js 的黑色悬浮条上下文。
   */
  function findCaptureToolbarContext() {
    for (const element of document.querySelectorAll("div")) {
      const shadowRoot = element.shadowRoot;
      if (!shadowRoot) {
        continue;
      }

      const messageEl = shadowRoot.querySelector('[data-toolbar-role="message"]');
      const buttonGroupEl = shadowRoot.querySelector('div[data-toolbar-role="button"]');
      if (!messageEl || !buttonGroupEl) {
        continue;
      }

      const text = String(messageEl.textContent || "");
      if (!/复制到剪贴板|copy to clipboard|发送到figma|send to figma/i.test(text)) {
        continue;
      }

      return {
        shadowRoot,
        host: shadowRoot.host,
        messageEl,
        buttonGroupEl
      };
    }
    return null;
  }

  /**
   * 关闭 capture.js 内置黑色条，避免与手动黑色条重复显示。
   */
  function dismissBuiltInCaptureToolbar() {
    const context = findCaptureToolbarContext();
    const host = context?.host;
    if (!host) {
      return false;
    }
    host.remove();
    return true;
  }

  /**
   * 在一段时间内轮询关闭内置黑色条，规避复制完成后再次弹出的条。
   */
  function autoDismissBuiltInToolbar(durationMs = 9000) {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      dismissBuiltInCaptureToolbar();
      if (Date.now() - startedAt >= durationMs) {
        clearInterval(timer);
      }
    }, 260);
  }

  /**
   * 克隆内置工具条按钮样式，创建一个新的扩展操作按钮。
   */
  function createToolbarActionButton(templateButtonEl, label, attrName, onClick) {
    const actionButtonEl = templateButtonEl.cloneNode(true);
    actionButtonEl.setAttribute(attrName, "1");
    actionButtonEl.disabled = false;

    const labelEl = actionButtonEl.querySelector("[data-toolbar-label]");
    if (labelEl) {
      labelEl.textContent = label;
    }

    actionButtonEl.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await onClick({
        buttonEl: actionButtonEl,
        labelEl,
        defaultLabel: label
      });
    });

    return actionButtonEl;
  }

  /**
   * 调用后台生成组件 JSON，支持整页与元素两种输入模式。
   */
  async function runComponentCapture(selector, mode) {
    const preset = getActiveViewportPreset();
    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.START_COMPONENT_CAPTURE,
      selector: selector || "body",
      mode: mode || "component",
      viewportPreset: {
        key: preset.key,
        label: preset.label,
        width: preset.width,
        height: preset.height
      }
    });

    if (!response?.ok || !response?.json) {
      throw new Error(response?.error || "组件采集失败");
    }

    await copyTextToClipboard(response.json);
    return response;
  }

  /**
   * 将当前视口预设尺寸复制到剪贴板，便于设计沟通与标注。
   */
  async function copyActivePresetSize() {
    const preset = getActiveViewportPreset();
    const dpr = Number(window.devicePixelRatio || 1).toFixed(2).replace(/\.00$/, "");
    const text = `${preset.label} ${preset.width} x ${preset.height} @${dpr}x`;
    await copyTextToClipboard(text);
  }

  /**
   * 应用当前预设到浏览器窗口，实现真实宽高切换。
   */
  async function applyActiveViewportPreset() {
    const preset = getActiveViewportPreset();
    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.SET_VIEWPORT_PRESET,
      width: preset.width,
      height: preset.height
    });
    if (!response?.ok) {
      throw new Error(response?.error || "应用视口预设失败");
    }
    return response;
  }

  /**
   * 给 capture.js 内置黑色条动态补充“复制组件”和“预设尺寸”按钮。
   */
  function mountCaptureToolbarButtons() {
    const toolbarContext = findCaptureToolbarContext();
    if (!toolbarContext) {
      return false;
    }

    const { messageEl, buttonGroupEl } = toolbarContext;
    if (messageEl) {
      messageEl.textContent = `复制到剪贴板 · ${buildModeHintText()}`;
    }

    const templateButtonEl = buttonGroupEl.querySelector("button[data-icon-button]");
    if (!templateButtonEl) {
      return false;
    }

    if (!buttonGroupEl.querySelector(`[${COMPONENT_BUTTON_ATTR}]`)) {
      const componentButtonEl = createToolbarActionButton(
        templateButtonEl,
        "复制组件",
        COMPONENT_BUTTON_ATTR,
        async ({ buttonEl, labelEl, defaultLabel }) => {
          if (!isModeAllowed("组件")) {
            notifyModeBlocked("组件");
            return;
          }

          buttonEl.disabled = true;
          setActiveMode("组件");
          if (labelEl) {
            labelEl.textContent = "生成中...";
          }

          try {
            await runComponentCapture(activeSelector || "body", activeSelector === "body" ? "component_page" : "component_element");
            if (labelEl) {
              labelEl.textContent = "已复制组件";
            }
          } catch (error) {
            console.error("[Web to Design] component copy failed:", error);
            if (labelEl) {
              labelEl.textContent = "复制失败";
            }
          } finally {
            setTimeout(() => {
              buttonEl.disabled = false;
              if (labelEl) {
                labelEl.textContent = defaultLabel;
              }
            }, 1200);
          }
        }
      );
      buttonGroupEl.appendChild(componentButtonEl);
    }

    if (!buttonGroupEl.querySelector(`[${VIEWPORT_BUTTON_ATTR}]`)) {
      const viewportButtonEl = createToolbarActionButton(
        templateButtonEl,
        `预设 ${getActiveViewportPreset().label}`,
        VIEWPORT_BUTTON_ATTR,
        async ({ buttonEl, labelEl }) => {
          buttonEl.disabled = true;
          try {
            const preset = switchToNextViewportPreset();
            setActiveMode("视口预设");
            await applyActiveViewportPreset();
            await copyActivePresetSize();
            if (labelEl) {
              labelEl.textContent = `已应用 ${preset.label}`;
            }
          } catch (error) {
            console.error("[Web to Design] viewport preset copy failed:", error);
            if (labelEl) {
              labelEl.textContent = "应用失败";
            }
          } finally {
            setTimeout(() => {
              buttonEl.disabled = false;
              if (labelEl) {
                labelEl.textContent = `预设 ${getActiveViewportPreset().label}`;
              }
              refreshModeHint();
            }, 1200);
          }
        }
      );
      buttonGroupEl.appendChild(viewportButtonEl);
    }

    return true;
  }

  /**
   * 安装内置黑色条观察器，在工具条出现或重建时自动补按钮。
   */
  function installCaptureToolbarWatcher() {
    if (window[COMPONENT_BUTTON_READY_FLAG]) {
      return;
    }
    window[COMPONENT_BUTTON_READY_FLAG] = true;

    mountCaptureToolbarButtons();

    const observer = new MutationObserver(() => {
      mountCaptureToolbarButtons();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      window[COMPONENT_BUTTON_READY_FLAG] = false;
    }, 120000);
  }

  /**
   * 创建手动黑色悬浮条按钮，保持统一视觉。
   */
  function createLauncherButton(text, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "height:24px",
      "padding:0 8px",
      "border:none",
      "border-radius:5px",
      "background:transparent",
      "color:rgba(255,255,255,.9)",
      "font-size:12px",
      "font-family:inherit",
      "cursor:pointer",
      "white-space:nowrap",
      "transition:background .12s"
    ].join(";");

    button.addEventListener("mouseenter", () => {
      button.style.background = "rgba(255,255,255,.14)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "transparent";
    });
    button.addEventListener("click", onClick);

    return button;
  }

  /**
   * 打开手动黑色悬浮条：先选功能，再开始采集。
   */
  function showManualLauncher(captureForDesign, runtimeOptions) {
    removeManualLauncher();
    dismissBuiltInCaptureToolbar();

    const root = document.createElement("div");
    root.id = LAUNCHER_ID;
    root.style.cssText = [
      "position:fixed",
      "left:50%",
      "top:16px",
      "transform:translateX(-50%)",
      "z-index:2147483647",
      "user-select:none"
    ].join(";");

    const bar = document.createElement("div");
    bar.style.cssText = [
      "display:flex",
      "align-items:center",
      "width:max-content",
      "min-width:520px",
      "height:40px",
      "padding:0 8px",
      "border-radius:13px",
      "background:rgb(44,44,44)",
      "box-shadow:rgba(0,0,0,.15) 0 1px 3px 0, rgba(0,0,0,.3) 0 0 .5px 0",
      "box-sizing:border-box",
      "overflow:hidden",
      "font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, \"Noto Sans\", sans-serif",
      "font-size:12px",
      "font-weight:500",
      "line-height:16px",
      "letter-spacing:.005em",
      "color:rgba(255,255,255,.9)"
    ].join(";");

    launcherModeEl = document.createElement("span");
    launcherModeEl.style.cssText = "text-align:left;padding:0 12px 0 4px;color:rgba(255,255,255,.9);white-space:nowrap;";
    launcherModeEl.textContent = buildModeHintText();

    const divider1 = document.createElement("div");
    divider1.style.cssText = "width:1px;align-self:stretch;background:rgba(255,255,255,.1);flex-shrink:0;";

    const group = document.createElement("div");
    group.style.cssText = "display:flex;align-items:center;gap:4px;margin-left:8px;margin-right:8px;";

    const divider2 = document.createElement("div");
    divider2.style.cssText = "width:1px;align-self:stretch;background:rgba(255,255,255,.1);flex-shrink:0;";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "关闭");
    closeButton.textContent = "×";
    closeButton.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "width:24px",
      "height:24px",
      "padding:0",
      "border:none",
      "border-radius:5px",
      "background:transparent",
      "color:rgba(255,255,255,.9)",
      "cursor:pointer",
      "font-size:18px",
      "margin-left:8px"
    ].join(";");

    closeButton.addEventListener("click", () => {
      removeManualLauncher();
    });

    const runClipboardCapture = async (selector, modeLabel) => {
      setActiveMode(modeLabel);
      activeSelector = selector || "body";
      removeManualLauncher();

      const delayMs = Number.isFinite(runtimeOptions.delayMs)
        ? Math.max(0, runtimeOptions.delayMs)
        : 0;
      const verbose = Boolean(runtimeOptions.verbose);

      try {
        autoDismissBuiltInToolbar();
        await captureForDesign({ selector: activeSelector, delayMs, verbose });
        autoDismissBuiltInToolbar(3000);
      } catch (error) {
        console.error("[Web to Design] toolbar capture failed:", error);
      }
    };

    const fullPageButton = createLauncherButton("整个屏幕", () => {
      if (!isModeAllowed("整页")) {
        notifyModeBlocked("整页");
        return;
      }
      runClipboardCapture("body", "整页");
    });

    const backButton = createLauncherButton("返回", () => {
      activeSelector = "body";
      setActiveMode("待选择");
    });

    const selectElementButton = createLauncherButton("选择元素", () => {
      if (!isModeAllowed("元素")) {
        notifyModeBlocked("元素");
        return;
      }
      setActiveMode("元素选择中");
      startElementPicker(
        (selector) => {
          activeSelector = selector;
          runClipboardCapture(selector, "元素");
        },
        () => {
          setActiveMode("待选择");
        }
      );
    });

    const componentButton = createLauncherButton("复制组件", async () => {
      if (!isModeAllowed("组件")) {
        notifyModeBlocked("组件");
        return;
      }

      const button = componentButton;
      button.disabled = true;
      setActiveMode("组件");
      button.textContent = "生成中...";
      try {
        const selector = activeSelector || "body";
        await runComponentCapture(selector, selector === "body" ? "component_page" : "component_element");
        button.textContent = "已复制组件";
      } catch (error) {
        console.error("[Web to Design] component copy failed:", error);
        button.textContent = "复制失败";
      } finally {
        setTimeout(() => {
          button.disabled = false;
          button.textContent = "复制组件";
          refreshModeHint();
        }, 1200);
      }
    });

    launcherPresetButtonEl = createLauncherButton(`预设 ${getActiveViewportPreset().label}`, async () => {
      const preset = switchToNextViewportPreset();
      setActiveMode("视口预设");
      try {
        await applyActiveViewportPreset();
        await copyActivePresetSize();
        launcherPresetButtonEl.textContent = `已应用 ${preset.label}`;
      } catch (error) {
        console.error("[Web to Design] viewport preset copy failed:", error);
        launcherPresetButtonEl.textContent = "应用失败";
      } finally {
        setTimeout(() => {
          if (launcherPresetButtonEl) {
            launcherPresetButtonEl.textContent = `预设 ${getActiveViewportPreset().label}`;
          }
          refreshModeHint();
        }, 1000);
      }
    });

    launcherLockButtonEl = createLauncherButton(activeModeLock ? `锁定 ${activeModeLock}` : "锁定 关闭", () => {
      cycleModeLock();
    });

    group.appendChild(fullPageButton);
    group.appendChild(selectElementButton);
    group.appendChild(componentButton);
    group.appendChild(launcherLockButtonEl);
    group.appendChild(launcherPresetButtonEl);
    group.appendChild(backButton);

    bar.appendChild(launcherModeEl);
    bar.appendChild(divider1);
    bar.appendChild(group);
    bar.appendChild(divider2);
    bar.appendChild(closeButton);

    root.appendChild(bar);
    markIgnore(root);
    document.documentElement.appendChild(root);

    refreshModeHint();
  }

  /**
   * 等待指定毫秒，给页面渲染和资源加载预留时间。
   */
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 逐段滚动页面，尽量触发懒加载资源，提升复制到 Figma 的完整度。
   */
  async function warmupPageByScroll() {
    const totalHeight = document.body?.scrollHeight ?? 0;
    if (totalHeight <= 0) {
      return;
    }

    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    const originalY = window.scrollY;

    for (let y = 0; y < totalHeight; y += step) {
      window.scrollTo(0, y);
      await wait(300);
    }

    await wait(500);
    window.scrollTo(0, originalY);
  }

  /**
   * 等待页面图片加载完成，减少复制后 Figma 中丢图概率。
   */
  async function waitForImages() {
    const images = Array.from(document.images || []);
    if (images.length === 0) {
      return;
    }

    await Promise.allSettled(
      images.map((img) => {
        if (img.complete) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
          setTimeout(resolve, 10000);
        });
      })
    );
  }

  /**
   * 等待字体加载完成，避免捕获时出现字体回退导致样式偏差。
   */
  async function waitForFonts() {
    if (!document.fonts?.ready) {
      return;
    }
    await Promise.race([document.fonts.ready, wait(3000)]);
  }

  /**
   * 执行 Figma 剪贴板采集流程。
   */
  async function runFigmaClipboardCapture() {
    const captureForDesign = window.figma?.captureForDesign;
    if (typeof captureForDesign !== "function") {
      throw new Error("window.figma.captureForDesign 不存在，请确认 capture.js 已注入");
    }

    const runtimeOptions = readRuntimeOptions();
    const selector = typeof runtimeOptions.selector === "string" ? runtimeOptions.selector : "body";
    const delayMs = Number.isFinite(runtimeOptions.delayMs) ? Math.max(0, runtimeOptions.delayMs) : 0;
    const captureMode = typeof runtimeOptions.mode === "string" ? runtimeOptions.mode : "smart";
    const verbose = Boolean(runtimeOptions.verbose);

    if (verbose) {
      console.log("[Web to Design] figma capture options:", { selector, delayMs, captureMode });
    }

    if (captureMode === "toolbar_only") {
      setActiveMode("待选择");
      dismissBuiltInCaptureToolbar();
      showManualLauncher(captureForDesign, runtimeOptions);
      return { started: true, pending: true, toolbarOnly: true };
    }

    installCaptureToolbarWatcher();

    await warmupPageByScroll();
    await waitForImages();
    await waitForFonts();
    await wait(800);
    if (delayMs > 0) {
      await wait(delayMs);
    }

    const capturePromise = Promise.resolve(captureForDesign({ selector, delayMs, verbose }));
    capturePromise.catch((error) => {
      console.error("[Web to Design] Figma clipboard capture failed:", error);
    });

    const quickResult = await Promise.race([
      capturePromise.then((result) => ({ timedOut: false, result })),
      wait(5000).then(() => ({ timedOut: true }))
    ]);

    if (quickResult.timedOut) {
      return { started: true, pending: true };
    }

    return quickResult.result || { success: true };
  }

  return runFigmaClipboardCapture();
})();

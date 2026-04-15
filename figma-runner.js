/**
 * @copyright Tomda (https://www.tomda.top)
 * @copyright UIED技术团队 (https://fsuied.com)
 * @author UIED技术团队
 * @createDate 2026-03-10
 */

(async () => {
  const TOOLBAR_ID = "__web2html_minimal_toolbar__";
  const PICKER_BOX_ID = "__web2html_picker_box__";
  const PICKER_TIP_ID = "__web2html_picker_tip__";
  const FLASH_BOX_ID = "__web2html_target_flash__";
  const TOAST_ID = "__web2html_capture_toast__";
  const BUILTIN_CAPTURE_TOOLBAR_ID = "__figma_capture_toolbar_host__";
  const OPEN_URL_MESSAGE_TYPE = "WEB2HTML_OPEN_URL";
  const VIEWPORT_PRESETS = [
    { id: "current", label: "当前窗口", width: null, height: null },
    { id: "desktop1080", label: "Desktop 1920×1080", width: 1920, height: 1080 },
    { id: "desktop", label: "Desktop 1440×900", width: 1440, height: 900 },
    { id: "tablet", label: "Tablet 834×1194", width: 834, height: 1194 },
    { id: "mobile", label: "Mobile 390×844", width: 390, height: 844 }
  ];

  let activeMode = "page";
  let activeSelector = "body";
  let selectedViewportPresetId = "current";
  let toolbarMessageEl = null;
  let pageModeButtonEl = null;
  let elementModeButtonEl = null;
  let viewportModeButtonEl = null;
  let viewportPresetSelectEl = null;
  let executeButtonEl = null;
  let stopElementPicker = null;
  let toastTimer = null;

  /**
   * 等待指定时间。
   */
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 返回当前页面视口尺寸文案（含设备像素比）。
   */
  function getViewportSizeLabel(width = window.innerWidth, height = window.innerHeight) {
    const safeWidth = Math.max(0, Math.round(width || 0));
    const safeHeight = Math.max(0, Math.round(height || 0));
    const dpr = Number(window.devicePixelRatio || 1).toFixed(2).replace(/\.00$/, "");
    return `${safeWidth} x ${safeHeight} @${dpr}x`;
  }

  /**
   * 根据预设 id 返回视口预设配置。
   */
  function getViewportPresetById(presetId) {
    return VIEWPORT_PRESETS.find((item) => item.id === presetId) || VIEWPORT_PRESETS[0];
  }

  /**
   * 获取当前视口模式目标尺寸。
   */
  function getViewportTargetSize() {
    const preset = getViewportPresetById(selectedViewportPresetId);
    const width = preset.width || Math.max(1, Math.round(window.innerWidth || 0));
    const height = preset.height || Math.max(1, Math.round(window.innerHeight || 0));
    return { preset, width, height };
  }

  /**
   * 发送 runtime 消息到后台，统一处理跨上下文能力。
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
   * 整页复制前执行滚动预热，触发懒加载资源，尽量接近完整整页。
   */
  async function warmupPageByScroll() {
    const totalHeight = document.body?.scrollHeight ?? 0;
    if (totalHeight <= 0) {
      return;
    }

    const originalY = window.scrollY;
    const step = Math.max(420, Math.floor(window.innerHeight * 0.85));
    for (let y = 0; y < totalHeight; y += step) {
      window.scrollTo(0, y);
      await wait(220);
    }
    await wait(320);
    window.scrollTo(0, originalY);
  }

  /**
   * 视口模式复制前锁定根节点尺寸，尽量只保留当前可视区域。
   */
  function lockViewportForCapture(targetWidth, targetHeight) {
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    if (!htmlEl || !bodyEl) {
      return () => {};
    }

    const prev = {
      htmlOverflow: htmlEl.style.overflow,
      htmlHeight: htmlEl.style.height,
      htmlMaxHeight: htmlEl.style.maxHeight,
      bodyOverflow: bodyEl.style.overflow,
      bodyHeight: bodyEl.style.height,
      bodyMaxHeight: bodyEl.style.maxHeight,
      bodyMinHeight: bodyEl.style.minHeight,
      bodyWidth: bodyEl.style.width,
      bodyMaxWidth: bodyEl.style.maxWidth
    };

    const viewportWidth = `${Math.max(1, Math.round(targetWidth || window.innerWidth || 0))}px`;
    const viewportHeight = `${Math.max(1, Math.round(targetHeight || window.innerHeight || 0))}px`;

    htmlEl.style.overflow = "hidden";
    htmlEl.style.height = viewportHeight;
    htmlEl.style.maxHeight = viewportHeight;

    bodyEl.style.overflow = "hidden";
    bodyEl.style.height = viewportHeight;
    bodyEl.style.maxHeight = viewportHeight;
    bodyEl.style.minHeight = viewportHeight;
    bodyEl.style.width = viewportWidth;
    bodyEl.style.maxWidth = viewportWidth;

    return () => {
      htmlEl.style.overflow = prev.htmlOverflow;
      htmlEl.style.height = prev.htmlHeight;
      htmlEl.style.maxHeight = prev.htmlMaxHeight;

      bodyEl.style.overflow = prev.bodyOverflow;
      bodyEl.style.height = prev.bodyHeight;
      bodyEl.style.maxHeight = prev.bodyMaxHeight;
      bodyEl.style.minHeight = prev.bodyMinHeight;
      bodyEl.style.width = prev.bodyWidth;
      bodyEl.style.maxWidth = prev.bodyMaxWidth;
    };
  }

  /**
   * 将节点标记为采集忽略，避免工具条进入复制结果。
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
   * 主动移除 capture.js 内置黑条，避免和极简黑条重叠。
   */
  function removeBuiltInCaptureToolbar() {
    const host = document.getElementById(BUILTIN_CAPTURE_TOOLBAR_ID);
    if (host) {
      host.remove();
      return true;
    }
    return false;
  }

  /**
   * 在一段时间内持续清理内置黑条，防止复制成功后再次弹出。
   */
  function suppressBuiltInCaptureToolbar(durationMs = 9000) {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      removeBuiltInCaptureToolbar();
      if (Date.now() - startedAt >= durationMs) {
        clearInterval(timer);
      }
    }, 180);

    return () => {
      clearInterval(timer);
    };
  }

  /**
   * 复制瞬间临时隐藏悬浮层，避免黑条/提示层进入复制结果。
   */
  function hideCaptureOverlaysForSnapshot() {
    const ids = [
      TOOLBAR_ID,
      TOAST_ID,
      PICKER_BOX_ID,
      PICKER_TIP_ID,
      FLASH_BOX_ID,
      BUILTIN_CAPTURE_TOOLBAR_ID
    ];

    const states = [];
    for (const id of ids) {
      const node = document.getElementById(id);
      if (!node) {
        continue;
      }
      states.push({
        node,
        visibility: node.style.visibility,
        opacity: node.style.opacity,
        pointerEvents: node.style.pointerEvents
      });
      node.style.visibility = "hidden";
      node.style.opacity = "0";
      node.style.pointerEvents = "none";
    }

    return () => {
      for (const item of states) {
        item.node.style.visibility = item.visibility;
        item.node.style.opacity = item.opacity;
        item.node.style.pointerEvents = item.pointerEvents;
      }
    };
  }

  /**
   * 等待页面图片资源尽量加载完成，提升复制质量。
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
   * 等待字体资源完成，减少复制后的字体回退。
   */
  async function waitForFonts() {
    if (!document.fonts?.ready) {
      return;
    }
    await Promise.race([document.fonts.ready, wait(3000)]);
  }

  /**
   * 生成尽量稳定的元素选择器。
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

    const segments = [];
    let cursor = element;
    while (cursor && cursor !== document.body && cursor !== document.documentElement) {
      let segment = cursor.tagName.toLowerCase();
      if (cursor.id) {
        segment = `#${CSS.escape(cursor.id)}`;
        segments.unshift(segment);
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

      segments.unshift(segment);
      cursor = cursor.parentElement;
    }

    return segments.join(" > ") || "body";
  }

  /**
   * 判断节点是否属于极简黑条或其临时 UI。
   */
  function isInToolbarOrPicker(node) {
    if (!node || !(node instanceof Element)) {
      return false;
    }
    const toolbar = document.getElementById(TOOLBAR_ID);
    const pickerTip = document.getElementById(PICKER_TIP_ID);
    const pickerBox = document.getElementById(PICKER_BOX_ID);
    const flashBox = document.getElementById(FLASH_BOX_ID);
    return Boolean(
      (toolbar && toolbar.contains(node))
      || node === pickerTip
      || node === pickerBox
      || node === flashBox
    );
  }

  /**
   * 更新顶部状态文案。
   */
  function updateToolbarMessage(extraText = "") {
    if (!toolbarMessageEl) {
      return;
    }

    const modeText = activeMode === "page"
      ? "整页模式"
      : activeMode === "element"
        ? "元素模式"
        : "视口模式";
    const selectorText = activeMode === "element" && activeSelector !== "body"
      ? `，目标：${activeSelector.slice(0, 56)}`
      : "";
    const suffix = extraText ? ` · ${extraText}` : "";
    toolbarMessageEl.textContent = `${modeText}${selectorText}${suffix}`;
  }

  /**
   * 同步按钮高亮状态和执行按钮文案。
   */
  function updateModeButtonsUI() {
    if (pageModeButtonEl) {
      pageModeButtonEl.style.background = activeMode === "page" ? "rgba(255,255,255,.22)" : "transparent";
    }
    if (elementModeButtonEl) {
      elementModeButtonEl.style.background = activeMode === "element" ? "rgba(255,255,255,.22)" : "transparent";
    }
    if (viewportModeButtonEl) {
      viewportModeButtonEl.style.background = activeMode === "viewport" ? "rgba(255,255,255,.22)" : "transparent";
    }
    if (executeButtonEl) {
      executeButtonEl.querySelector("[data-toolbar-label]").textContent = activeMode === "page"
        ? "执行 复制整页"
        : activeMode === "element"
          ? "执行 复制元素"
          : "执行 复制视口";
    }
    if (viewportPresetSelectEl) {
      viewportPresetSelectEl.style.opacity = activeMode === "viewport" ? "1" : ".85";
    }
    updateToolbarMessage();
  }

  /**
   * 创建极简黑条图标按钮。
   */
  function createIconButton({ label, iconPath, ariaLabel, onClick }) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-icon-button", "1");
    button.setAttribute("aria-label", ariaLabel || label);
    button.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "height:24px",
      "padding:0 8px 0 4px",
      "border:none",
      "border-radius:5px",
      "background:transparent",
      "color:rgba(255,255,255,.9)",
      "font-family:inherit",
      "font-size:inherit",
      "font-weight:inherit",
      "line-height:inherit",
      "letter-spacing:inherit",
      "cursor:pointer",
      "white-space:nowrap",
      "transition:background .1s"
    ].join(";");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.style.cssText = "width:24px;height:24px;flex-shrink:0;";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", iconPath);
    path.setAttribute("fill", "rgba(255,255,255,.9)");
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("clip-rule", "evenodd");
    svg.appendChild(path);
    button.appendChild(svg);

    if (label) {
      const text = document.createElement("span");
      text.setAttribute("data-toolbar-label", "1");
      text.style.cssText = "margin-left:4px;";
      text.textContent = label;
      button.appendChild(text);
    }

    button.addEventListener("mouseenter", () => {
      if (button.style.background !== "rgba(255,255,255,.22)") {
        button.style.background = "rgba(255,255,255,.14)";
      }
    });
    button.addEventListener("mouseleave", () => {
      if (button.style.background !== "rgba(255,255,255,.22)") {
        button.style.background = "transparent";
      }
    });
    button.addEventListener("click", onClick);
    return button;
  }

  /**
   * 创建视口尺寸预设下拉框。
   */
  function createViewportPresetSelect() {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "height:24px",
      "padding:0 6px",
      "border-radius:6px",
      "background:rgba(255,255,255,.08)"
    ].join(";");

    const select = document.createElement("select");
    select.setAttribute("aria-label", "视口尺寸预设");
    select.style.cssText = [
      "height:20px",
      "border:none",
      "outline:none",
      "background:transparent",
      "color:rgba(255,255,255,.92)",
      "font-size:12px",
      "font-family:inherit",
      "cursor:pointer",
      "max-width:124px"
    ].join(";");

    for (const preset of VIEWPORT_PRESETS) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      option.style.color = "#0f172a";
      select.appendChild(option);
    }

    select.value = selectedViewportPresetId;
    select.addEventListener("change", () => {
      selectedViewportPresetId = select.value;
      const target = getViewportTargetSize();
      const isWidthMismatch = Boolean(target.preset.width)
        && Math.abs(Math.round(window.innerWidth || 0) - target.width) >= 4;
      const hintText = isWidthMismatch ? "建议先切设备模式再执行" : "";
      updateToolbarMessage(`预设：${target.preset.label} (${getViewportSizeLabel(target.width, target.height)})${hintText ? `，${hintText}` : ""}`);
      setTimeout(() => updateToolbarMessage(), 1600);
    });

    wrapper.appendChild(select);
    markIgnore(wrapper);
    viewportPresetSelectEl = select;
    return wrapper;
  }

  /**
   * 设置图标按钮文案，不影响图标结构。
   */
  function setIconButtonLabel(button, label) {
    if (!button) {
      return;
    }
    const labelEl = button.querySelector("[data-toolbar-label]");
    if (labelEl) {
      labelEl.textContent = label;
    }
  }

  /**
   * 销毁目标选择器高亮相关 UI。
   */
  function removePickerUI() {
    const box = document.getElementById(PICKER_BOX_ID);
    const tip = document.getElementById(PICKER_TIP_ID);
    if (box) {
      box.remove();
    }
    if (tip) {
      tip.remove();
    }
  }

  /**
   * 结束元素选择流程并清理监听。
   */
  function cancelElementPicker() {
    if (typeof stopElementPicker === "function") {
      stopElementPicker();
      stopElementPicker = null;
    }
    removePickerUI();
  }

  /**
   * 返回到整页模式，便于快速撤销当前元素/视口操作。
   */
  function backToPageMode() {
    cancelElementPicker();
    const flash = document.getElementById(FLASH_BOX_ID);
    if (flash) {
      flash.remove();
    }
    activeMode = "page";
    activeSelector = "body";
    updateModeButtonsUI();
    updateToolbarMessage("已返回整页模式");
    setTimeout(() => updateToolbarMessage(), 1000);
  }

  /**
   * 显示全局轻提示，不受黑条位置影响。
   */
  function showCaptureToast(message, isError = false, durationMs = 2400, action = null, placement = "top") {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.style.cssText = [
        "position:fixed",
        "left:50%",
        "top:68px",
        "transform:translate(-50%,-8px)",
        "z-index:2147483647",
        "max-width:min(560px,calc(100vw - 24px))",
        "padding:11px 14px",
        "border-radius:12px",
        "font-size:13px",
        "font-weight:600",
        "font-family:\"PingFang SC\",\"SF Pro Text\",sans-serif",
        "line-height:1.4",
        "color:#fff",
        "box-shadow:rgba(0,0,0,.28) 0 8px 24px",
        "border:1px solid rgba(255,255,255,.18)",
        "opacity:0",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "gap:10px",
        "text-align:left",
        "transition:opacity .18s ease, transform .18s ease",
        "pointer-events:none"
      ].join(";");
      markIgnore(toast);
      document.documentElement.appendChild(toast);
    }

    toast.replaceChildren();
    const messageEl = document.createElement("span");
    messageEl.textContent = message;
    messageEl.style.cssText = "display:inline-block;max-width:100%;";
    toast.appendChild(messageEl);

    const hasAction = action?.label && typeof action.onClick === "function";
    if (hasAction) {
      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.textContent = action.label;
      actionButton.style.cssText = [
        "border:none",
        "border-radius:8px",
        "padding:5px 9px",
        "font-size:12px",
        "font-weight:600",
        "cursor:pointer",
        "background:rgba(255,255,255,.94)",
        "color:#0f172a",
        "white-space:nowrap"
      ].join(";");
      actionButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        action.onClick();
      });
      markIgnore(actionButton);
      toast.appendChild(actionButton);
    }

    toast.style.pointerEvents = hasAction ? "auto" : "none";
    toast.style.background = isError ? "rgba(180,35,24,.95)" : "rgba(6,118,71,.95)";
    if (placement === "center") {
      toast.style.top = "50%";
      toast.style.transform = "translate(-50%,-50%)";
    } else {
      toast.style.top = "68px";
      toast.style.transform = "translate(-50%,0)";
    }
    toast.style.opacity = "1";

    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = placement === "center"
        ? "translate(-50%,-54%)"
        : "translate(-50%,-8px)";
    }, durationMs);
  }

  /**
   * 执行完成后短暂高亮“执行”按钮，强化成功/失败反馈。
   */
  function pulseExecuteButton(isSuccess) {
    if (!executeButtonEl) {
      return;
    }
    executeButtonEl.style.background = isSuccess ? "rgba(6,118,71,.95)" : "rgba(180,35,24,.95)";
    executeButtonEl.style.color = "#ffffff";
    setIconButtonLabel(executeButtonEl, isSuccess ? "已复制" : "执行失败");
    setTimeout(() => {
      executeButtonEl.style.background = "transparent";
      executeButtonEl.style.color = "rgba(255,255,255,.9)";
      updateModeButtonsUI();
    }, 1350);
  }

  /**
   * 启动元素选择流程，点击页面元素后回调选择器。
   */
  function startElementPicker(onPick, onCancel) {
    removePickerUI();

    const box = document.createElement("div");
    box.id = PICKER_BOX_ID;
    box.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "z-index:2147483646",
      "border:2px dashed #3b82f6",
      "background:rgba(59,130,246,.14)",
      "border-radius:8px",
      "box-sizing:border-box",
      "display:none"
    ].join(";");

    const tip = document.createElement("div");
    tip.id = PICKER_TIP_ID;
    tip.textContent = "选择元素：点击确认，Esc 取消";
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
      "background:rgba(17,24,39,.95)",
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
      removePickerUI();
    };

    const onMove = (event) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || isInToolbarOrPicker(target)) {
        currentTarget = null;
        box.style.display = "none";
        return;
      }
      const rect = target.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) {
        currentTarget = null;
        box.style.display = "none";
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
      if (!currentTarget || isInToolbarOrPicker(currentTarget)) {
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
    return cleanup;
  }

  /**
   * 高亮预览目标元素，帮助用户确认复制目标是否正确。
   */
  async function flashTarget(selector, durationMs = 900) {
    const target = document.querySelector(selector);
    if (!target) {
      return false;
    }

    const rect = target.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) {
      return false;
    }

    const old = document.getElementById(FLASH_BOX_ID);
    if (old) {
      old.remove();
    }

    const flash = document.createElement("div");
    flash.id = FLASH_BOX_ID;
    flash.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "z-index:2147483646",
      "left:0",
      "top:0",
      "width:0",
      "height:0",
      "border:2px solid #22c55e",
      "background:rgba(34,197,94,.12)",
      "border-radius:10px",
      "box-sizing:border-box",
      "opacity:0",
      "transition:opacity .16s ease"
    ].join(";");

    flash.style.left = `${rect.left}px`;
    flash.style.top = `${rect.top}px`;
    flash.style.width = `${rect.width}px`;
    flash.style.height = `${rect.height}px`;

    document.documentElement.appendChild(flash);
    requestAnimationFrame(() => {
      flash.style.opacity = "1";
    });

    await wait(durationMs);
    flash.style.opacity = "0";
    setTimeout(() => {
      flash.remove();
    }, 180);
    return true;
  }

  /**
   * 获取或创建极简黑条容器。
   */
  function ensureToolbarRoot() {
    const existing = document.getElementById(TOOLBAR_ID);
    if (existing) {
      return existing;
    }

    const root = document.createElement("div");
    root.id = TOOLBAR_ID;
    root.style.cssText = [
      "position:fixed",
      "left:50%",
      "transform:translateX(-50%)",
      "top:16px",
      "z-index:2147483647",
      "user-select:none"
    ].join(";");
    markIgnore(root);
    document.documentElement.appendChild(root);
    return root;
  }

  /**
   * 渲染极简黑条 UI。
   */
  function renderMinimalToolbar(captureForDesign) {
    const root = ensureToolbarRoot();

    const bar = document.createElement("div");
    bar.style.cssText = [
      "display:flex",
      "align-items:center",
      "width:max-content",
      "min-width:560px",
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

    toolbarMessageEl = document.createElement("span");
    toolbarMessageEl.style.cssText = "text-align:left;padding:0 12px 0 4px;color:rgba(255,255,255,.9);white-space:nowrap;";

    const divider1 = document.createElement("div");
    divider1.style.cssText = "width:1px;align-self:stretch;background:rgba(255,255,255,.1);flex-shrink:0;";

    const group = document.createElement("div");
    group.style.cssText = "display:flex;align-items:center;gap:4px;margin-left:8px;margin-right:8px;";

    const divider2 = document.createElement("div");
    divider2.style.cssText = "width:1px;align-self:stretch;background:rgba(255,255,255,.1);flex-shrink:0;";

    pageModeButtonEl = createIconButton({
      label: "整个屏幕",
      iconPath: "M17 6a2 2 0 0 1 2 2v8l-.01.204a2 2 0 0 1-1.786 1.785L17 18H7l-.204-.01a2 2 0 0 1-1.785-1.786L5 16V8a2 2 0 0 1 2-2zM6 16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5H6zm1-9a1 1 0 0 0-.995.897L6 8v2h12V8a1 1 0 0 0-1-1zm.5 1a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1m2 0a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1",
      onClick: () => {
        cancelElementPicker();
        activeMode = "page";
        activeSelector = "body";
        updateModeButtonsUI();
      }
    });

    elementModeButtonEl = createIconButton({
      label: "选择元素",
      iconPath: "M9.321 5.532a.5.5 0 0 1 .653.27l.777 1.876c.102.245-.039.524-.285.626s-.537.002-.639-.244L9.05 6.186a.5.5 0 0 1 .271-.654m-1.26 4.295L6.186 9.05a.5.5 0 0 0-.383.924l1.875.777c.246.101.524-.04.626-.285.102-.246.003-.537-.243-.64m-.383 3.422-1.875.776a.5.5 0 1 0 .383.924l1.875-.777c.246-.102.345-.393.243-.639s-.38-.386-.626-.284m2.149 2.69-.777 1.874a.5.5 0 0 0 .924.383l.777-1.875c.102-.245-.04-.524-.285-.626s-.537-.002-.639.244m6.495-5.188 1.874-.777a.5.5 0 1 0-.382-.924l-1.875.777c-.246.101-.346.393-.244.639s.381.386.627.285m-2.15-2.69.777-1.875a.5.5 0 1 0-.924-.383l-.776 1.875c-.102.245.039.524.284.626.246.102.538.002.64-.244m-1.82 3.002a1 1 0 0 0-1.288 1.288l2.25 6a1 1 0 0 0 1.906-.109l.605-2.418 2.418-.604a1 1 0 0 0 .108-1.907zm3.94 3.614L15 15l-.323 1.29L14.25 18l-.618-1.65-1.166-3.108L12 12l1.243.466 3.108 1.165L18 14.25z",
      onClick: () => {
        cancelElementPicker();
        activeMode = "element";
        activeSelector = "body";
        updateModeButtonsUI();
        updateToolbarMessage("选择元素中");
        stopElementPicker = startElementPicker(
          (selector) => {
            stopElementPicker = null;
            activeMode = "element";
            activeSelector = selector || "body";
            updateModeButtonsUI();
            updateToolbarMessage("已选中，可执行");
            flashTarget(activeSelector, 700);
          },
          () => {
            stopElementPicker = null;
            updateToolbarMessage("已取消选择");
            setTimeout(() => updateToolbarMessage(), 1000);
          }
        );
      }
    });

    viewportModeButtonEl = createIconButton({
      label: "视口尺寸",
      iconPath: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5v1h2a.5.5 0 0 1 0 1H9a.5.5 0 0 1 0-1h2v-1H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8h14V5a1 1 0 0 0-1-1zm13 10H5v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1z",
      onClick: () => {
        cancelElementPicker();
        activeMode = "viewport";
        activeSelector = "body";
        const target = getViewportTargetSize();
        updateModeButtonsUI();
        updateToolbarMessage(`预设：${target.preset.label} (${getViewportSizeLabel(target.width, target.height)})`);
      }
    });

    const viewportPresetSelectWrap = createViewportPresetSelect();

    executeButtonEl = createIconButton({
      label: "执行 复制整页",
      iconPath: "M8.5 6.5a1 1 0 0 1 1.555-.832l6 4a1 1 0 0 1 0 1.664l-6 4A1 1 0 0 1 8.5 14.5z",
      onClick: async () => {
        const selector = activeMode === "element" ? activeSelector : "body";
        if (activeMode === "element" && (!selector || selector === "body")) {
          updateToolbarMessage("请先选择元素");
          setTimeout(() => updateToolbarMessage(), 1200);
          return;
        }

        cancelElementPicker();
        executeButtonEl.disabled = true;
        updateToolbarMessage("准备执行");
        const clearSuppressor = suppressBuiltInCaptureToolbar(12000);
        let releaseViewportLock = null;
        let restoreOverlays = null;

        try {
          if (activeMode === "element") {
            await flashTarget(selector, 850);
          } else if (activeMode === "page") {
            updateToolbarMessage("整页预热中（自动滚动）");
            await warmupPageByScroll();
          } else {
            const target = getViewportTargetSize();
            updateToolbarMessage(`视口模式：${target.preset.label} (${getViewportSizeLabel(target.width, target.height)})`);
            releaseViewportLock = lockViewportForCapture(target.width, target.height);
            await wait(120);
          }

          updateToolbarMessage("资源检查中");
          await waitForImages();
          await waitForFonts();
          await wait(260);

          updateToolbarMessage("复制到剪贴板中");
          restoreOverlays = hideCaptureOverlaysForSnapshot();
          const capturePromise = Promise.resolve(captureForDesign({ selector }));
          capturePromise.catch((error) => {
            console.error("[Web to Design] capture failed:", error);
          });
          await Promise.race([capturePromise, wait(5000)]);

          updateToolbarMessage("复制成功，可到 Figma 按 Command + V 粘贴");
          showCaptureToast("复制成功，可到 Figma 按 Command + V 粘贴", false, 3200, {
            label: "打开 Figma",
            onClick: async () => {
              try {
                const response = await sendRuntimeMessage({
                  type: OPEN_URL_MESSAGE_TYPE,
                  url: "https://www.figma.com/files/recent"
                });
                if (!response?.ok) {
                  throw new Error(response?.error || "后台打开失败");
                }
              } catch {
                window.open("https://www.figma.com/files/recent", "_blank", "noopener,noreferrer");
              }
            }
          }, "center");
          pulseExecuteButton(true);
        } catch (error) {
          console.error("[Web to Design] execute failed:", error);
          updateToolbarMessage(`复制失败：${String(error?.message || error)}`);
          showCaptureToast("复制失败，请刷新页面后重试", true, 3200);
          pulseExecuteButton(false);
        } finally {
          if (typeof restoreOverlays === "function") {
            restoreOverlays();
          }
          if (typeof releaseViewportLock === "function") {
            releaseViewportLock();
          }
          executeButtonEl.disabled = false;
          clearSuppressor();
          removeBuiltInCaptureToolbar();
          setTimeout(() => updateToolbarMessage(), 2800);
        }
      }
    });

    const closeButton = createIconButton({
      label: "",
      ariaLabel: "关闭",
      iconPath: "M17.354 6.646a.5.5 0 0 1 0 .708L12.707 12l4.647 4.646a.5.5 0 0 1-.708.708L12 12.707l-4.646 4.647a.5.5 0 0 1-.708-.708L11.293 12 6.646 7.354a.5.5 0 0 1 .708-.707L12 11.293l4.646-4.647a.5.5 0 0 1 .708 0",
      onClick: () => {
        cancelElementPicker();
        const toolbar = document.getElementById(TOOLBAR_ID);
        if (toolbar) {
          toolbar.remove();
        }
      }
    });

    const backButton = createIconButton({
      label: "",
      ariaLabel: "返回",
      iconPath: "M15.354 5.646a.5.5 0 0 1 0 .708L9.707 12l5.647 5.646a.5.5 0 1 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0",
      onClick: () => {
        backToPageMode();
      }
    });
    backButton.style.padding = "0";
    backButton.style.width = "24px";
    backButton.style.marginLeft = "8px";

    closeButton.style.padding = "0";
    closeButton.style.width = "24px";
    closeButton.style.marginLeft = "4px";

    group.appendChild(pageModeButtonEl);
    group.appendChild(elementModeButtonEl);
    group.appendChild(viewportModeButtonEl);
    group.appendChild(viewportPresetSelectWrap);
    group.appendChild(executeButtonEl);

    bar.appendChild(toolbarMessageEl);
    bar.appendChild(divider1);
    bar.appendChild(group);
    bar.appendChild(divider2);
    bar.appendChild(backButton);
    bar.appendChild(closeButton);

    markIgnore(bar);
    root.replaceChildren(bar);
    updateModeButtonsUI();
  }

  /**
   * 主流程：注入 capture.js 并展示极简黑条，等待用户手动执行。
   */
  async function runFigmaClipboardCapture() {
    const captureForDesign = window.figma?.captureForDesign;
    if (typeof captureForDesign !== "function") {
      throw new Error("window.figma.captureForDesign 不存在，请确认 capture.js 已注入");
    }

    removeBuiltInCaptureToolbar();
    renderMinimalToolbar(captureForDesign);
    return { started: true, pending: true, toolbarOnly: true };
  }

  return runFigmaClipboardCapture();
})();

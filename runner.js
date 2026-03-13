/**
 * @copyright Tomda (https://www.tomda.top)
 * @copyright UIED技术团队 (https://fsuied.com)
 * @author UIED技术团队
 * @createDate 2026-03-10
 */

(async () => {
  /**
   * 读取后台注入的 JSON 采集参数，并在读取后清理全局变量。
   */
  function readRuntimeOptions() {
    const options = window.__WEB2HTML_JSON_CAPTURE_OPTIONS__ || {};
    try {
      delete window.__WEB2HTML_JSON_CAPTURE_OPTIONS__;
    } catch {
      window.__WEB2HTML_JSON_CAPTURE_OPTIONS__ = undefined;
    }
    return options;
  }

  /**
   * 等待指定毫秒，给页面渲染和资源加载预留时间。
   */
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 逐段滚动页面，触发懒加载内容，提高采集完整度。
   */
  async function warmupPageByScroll() {
    const totalHeight = document.body?.scrollHeight ?? 0;
    if (totalHeight <= 0) {
      return;
    }

    const step = Math.max(420, Math.floor(window.innerHeight * 0.75));
    const originalY = window.scrollY;

    for (let y = 0; y <= totalHeight; y += step) {
      window.scrollTo(0, y);
      await wait(220);
    }

    await wait(240);
    window.scrollTo(0, originalY);
  }

  /**
   * 等待图片加载完成，降低导出后资源丢失概率。
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
   * 等待 Web 字体加载完成，避免采集时出现字体回退。
   */
  async function waitForFonts() {
    if (!document.fonts?.ready) {
      return;
    }
    await Promise.race([document.fonts.ready, wait(3000)]);
  }

  /**
   * 调用采集引擎并返回结构化结果。
   */
  async function runCapture() {
    const captureForDesign = window.web2html?.captureForDesign;
    if (typeof captureForDesign !== "function") {
      throw new Error("window.web2html.captureForDesign 不存在，请确认 content.js 已注入");
    }

    const runtimeOptions = readRuntimeOptions();
    const selector = typeof runtimeOptions.selector === "string" ? runtimeOptions.selector : "body";
    const maxDepth = Number.isFinite(runtimeOptions.maxDepth) ? runtimeOptions.maxDepth : 20;
    const maxNodes = Number.isFinite(runtimeOptions.maxNodes) ? runtimeOptions.maxNodes : 5000;
    const embedAssets = runtimeOptions.embedAssets !== false;
    const assetConcurrency = Number.isFinite(runtimeOptions.assetConcurrency)
      ? runtimeOptions.assetConcurrency
      : 8;

    await warmupPageByScroll();
    await waitForImages();
    await waitForFonts();
    await wait(500);

    return captureForDesign({
      selector,
      maxDepth,
      maxNodes,
      embedAssets,
      assetConcurrency
    });
  }

  return runCapture();
})();

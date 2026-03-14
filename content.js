/**
 * @copyright Tomda (https://www.tomda.top)
 * @copyright UIED技术团队 (https://fsuied.com)
 * @author UIED技术团队
 * @createDate 2026-03-10
 */

(function bootstrapCaptureEngine() {
  if (window.web2html?.captureForDesign) {
    return;
  }

  const MESSAGE_TYPES = {
    FETCH_ASSET: "WEB2HTML_FETCH_ASSET"
  };

  /**
   * 休眠指定毫秒，用于异步节流控制。
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 从元素提取直接文本节点，避免重复收集子节点文本。
   */
  function getDirectText(element) {
    let text = "";
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || "";
      }
    }
    return text.trim().slice(0, 300);
  }

  /**
   * 提取常用属性，便于后续在设计工具中恢复语义。
   */
  function extractAttributes(element) {
    const attributes = {};
    const keys = [
      "href",
      "src",
      "alt",
      "title",
      "placeholder",
      "type",
      "value",
      "role",
      "aria-label"
    ];

    for (const key of keys) {
      if (element.hasAttribute(key)) {
        attributes[key] = element.getAttribute(key);
      }
    }
    return attributes;
  }

  /**
   * 提取核心样式字段，控制输出体积并保证高价值信息完整。
   */
  function extractStyles(style) {
    return {
      display: style.display,
      position: style.position,
      zIndex: style.zIndex,
      opacity: style.opacity,
      backgroundColor: style.backgroundColor,
      color: style.color,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      textAlign: style.textAlign,
      border: style.border,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      padding: style.padding,
      margin: style.margin
    };
  }

  /**
   * 判断元素是否应被采集，过滤隐藏节点与插件自身节点。
   */
  function shouldSkipElement(element, style, options) {
    const tag = element.tagName.toLowerCase();
    if (["script", "style", "noscript", "meta", "link"].includes(tag)) {
      return true;
    }

    if (
      element.hasAttribute("data-web2html-ignore") ||
      element.hasAttribute("data-figma-capture-ignore")
    ) {
      return true;
    }

    if (!options.includeHidden) {
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * 从元素中提取可引用资源地址。
   */
  function collectElementAssets(element, style) {
    const assets = [];

    if (element instanceof HTMLImageElement && element.currentSrc) {
      assets.push({ type: "image", url: element.currentSrc });
    }

    if (element instanceof HTMLVideoElement && element.poster) {
      assets.push({ type: "poster", url: element.poster });
    }

    const backgroundImage = style.backgroundImage || "";
    if (backgroundImage.includes("url(")) {
      const matches = backgroundImage.matchAll(/url\(\s*["']?(.*?)["']?\s*\)/gi);
      for (const match of matches) {
        if (match[1]) {
          assets.push({ type: "background", url: match[1] });
        }
      }
    }

    return assets;
  }

  /**
   * 把页面内 URL 转为绝对地址，避免相对路径在离线文件中失效。
   */
  function toAbsoluteUrl(rawUrl) {
    try {
      return new URL(rawUrl, window.location.href).toString();
    } catch {
      return rawUrl;
    }
  }

  /**
   * 向后台请求跨域资源，得到 Base64 数据用于嵌入输出。
   */
  function requestAssetByProxy(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.FETCH_ASSET, url }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: "NO_RESPONSE" });
      });
    });
  }

  /**
   * 并发处理资源请求，避免一次性并发过高导致超时。
   */
  async function mapWithConcurrency(items, worker, concurrency) {
    const results = new Array(items.length);
    let index = 0;

    const runner = async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        try {
          results[current] = await worker(items[current], current);
        } catch (error) {
          results[current] = { ok: false, error: String(error) };
        }
        await sleep(0);
      }
    };

    const poolSize = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: poolSize }, () => runner()));
    return results;
  }

  /**
   * 递归采集页面节点并生成树结构。
   */
  function buildNodeTree(element, context, depth = 0) {
    if (!element || depth > context.options.maxDepth || context.stats.nodeCount >= context.options.maxNodes) {
      return null;
    }

    const style = window.getComputedStyle(element);
    if (shouldSkipElement(element, style, context.options)) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) {
      return null;
    }

    const node = {
      tagName: element.tagName.toLowerCase(),
      id: element.id || "",
      className: typeof element.className === "string" ? element.className : "",
      text: getDirectText(element),
      position: {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      styles: extractStyles(style),
      attributes: extractAttributes(element),
      children: []
    };

    const assets = collectElementAssets(element, style);
    if (assets.length > 0) {
      node.assets = assets.map((item) => ({
        ...item,
        url: toAbsoluteUrl(item.url)
      }));
      for (const item of node.assets) {
        context.assetUrls.add(item.url);
      }
    }

    context.stats.nodeCount += 1;
    context.stats.maxDepth = Math.max(context.stats.maxDepth, depth);

    for (const child of Array.from(element.children)) {
      const childNode = buildNodeTree(child, context, depth + 1);
      if (childNode) {
        node.children.push(childNode);
      }
      if (context.stats.nodeCount >= context.options.maxNodes) {
        break;
      }
    }

    return node;
  }

  /**
   * 将节点树扁平化，方便外部快速遍历定位元素。
   */
  function flattenTree(root, output = []) {
    if (!root) {
      return output;
    }

    output.push({
      tagName: root.tagName,
      id: root.id,
      className: root.className,
      text: root.text,
      position: root.position,
      styles: root.styles,
      attributes: root.attributes
    });

    for (const child of root.children || []) {
      flattenTree(child, output);
    }

    return output;
  }

  /**
   * 可选地代理抓取图片资源，嵌入到输出对象中。
   */
async function buildEmbeddedAssets(assetUrls, options) {
  if (!options.embedAssets || assetUrls.length === 0) {
    return {};
  }

  const urlsToFetch = assetUrls.filter((url) => /^https?:\/\//i.test(url));
  if (urlsToFetch.length === 0) {
    return {};
  }

  const maxConcurrency = Number.isFinite(options.assetConcurrency)
    ? Math.max(1, options.assetConcurrency)
    : 8;

  const results = await mapWithConcurrency(
      urlsToFetch,
      async (url) => {
        const response = await requestAssetByProxy(url);
        if (!response?.ok || !response.base64) {
          return {
            url,
            ok: false,
            error: response?.error || "FETCH_FAILED",
            status: response?.status ?? 0
          };
        }
        return {
          url,
          ok: true,
          contentType: response.contentType,
          base64: response.base64
        };
      },
      maxConcurrency
    );

    const embedded = {};
    for (const item of results) {
      if (item?.ok) {
        embedded[item.url] = {
          contentType: item.contentType,
          base64: item.base64
        };
      }
    }
    return embedded;
  }

  /**
   * 采集入口：输出树结构、扁平列表、资源索引和统计信息。
   */
  async function captureForDesign(options = {}) {
    const normalizedOptions = {
      selector: options.selector || "body",
      includeHidden: Boolean(options.includeHidden),
      maxDepth: Number.isFinite(options.maxDepth) ? Math.max(1, options.maxDepth) : 20,
      maxNodes: Number.isFinite(options.maxNodes) ? Math.max(100, options.maxNodes) : 5000,
      embedAssets: Boolean(options.embedAssets),
      assetConcurrency: Number.isFinite(options.assetConcurrency)
        ? options.assetConcurrency
        : 8
    };

    const rootElement = normalizedOptions.selector === "body"
      ? document.body
      : document.querySelector(normalizedOptions.selector);

    if (!rootElement) {
      throw new Error(`选择器未命中元素：${normalizedOptions.selector}`);
    }

    const context = {
      options: normalizedOptions,
      stats: {
        nodeCount: 0,
        maxDepth: 0
      },
      assetUrls: new Set()
    };

    const tree = buildNodeTree(rootElement, context, 0);
    const flatElements = flattenTree(tree, []);
    const assetUrls = Array.from(context.assetUrls);
    const embeddedAssets = await buildEmbeddedAssets(assetUrls, normalizedOptions);

    return {
      app: "Web to Design",
      version: "1.0.5",
      capturedAt: new Date().toISOString(),
      meta: {
        title: document.title,
        url: window.location.href,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        scroll: {
          x: window.scrollX,
          y: window.scrollY
        },
        userAgent: navigator.userAgent
      },
      options: normalizedOptions,
      stats: {
        ...context.stats,
        assetCount: assetUrls.length
      },
      tree,
      elements: flatElements,
      assets: {
        urls: assetUrls,
        embedded: embeddedAssets
      }
    };
  }

  window.web2html = window.web2html || {};
  window.web2html.captureForDesign = captureForDesign;
})();

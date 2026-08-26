// 제품 데이터 로딩과 안전 처리를 담당합니다.
// 학생은 제품 UI를 style.css에서 디자인하고, 이 파일의 보안 함수는 유지하세요.
(function () {
  "use strict";

  const ALLOWED_RICH_TAGS = new Set([
    "P", "BR", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "B", "EM", "I", "S", "DEL",
    "UL", "OL", "LI", "INPUT", "BLOCKQUOTE", "A", "IMG", "FIGURE", "FIGCAPTION", "HR",
    "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "PRE", "CODE", "IFRAME", "VIDEO",
    "SECTION", "SPAN", "BIG"
  ]);

  const escapeHtml = (value) => String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function safeImageUrl(value) {
    const source = String(value || "").trim();
    if (!source) return "";
    if (/^(?:\.\/)?images\/[a-z0-9_./%+~-]+$/i.test(source)) return source;
    if (/^\/images\/[a-z0-9_./%+~-]+$/i.test(source)) return source;
    return safeExternalUrl(source);
  }

  function safeVideoEmbedUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:") return "";
      const host = url.hostname.toLowerCase();
      const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
      if (youtubeHosts.has(host)) {
        const match = url.pathname.match(/^\/(?:embed|shorts)\/([A-Za-z0-9_-]{6,20})/);
        if (match) return `https://www.youtube-nocookie.com/embed/${match[1]}`;
      }
      if (host === "player.vimeo.com") {
        const match = url.pathname.match(/^\/video\/(\d+)/);
        if (match) return `https://player.vimeo.com/video/${match[1]}`;
      }
    } catch (_) {}
    return "";
  }

  function safeVideoFileUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:") return "";
      return /\.(?:mp4|webm|ogg)$/i.test(url.pathname) ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function sanitizeRichText(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value || "");

    function clean(parent) {
      [...parent.childNodes].forEach((node) => {
        if (node.nodeType === Node.COMMENT_NODE) {
          node.remove();
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (!ALLOWED_RICH_TAGS.has(node.tagName)) {
          node.replaceWith(...node.childNodes);
          clean(parent);
          return;
        }

        const hrefValue = node.getAttribute("href");
        const sourceValue = node.getAttribute("src");
        const altValue = node.getAttribute("alt") || "";
        const alignValue = node.getAttribute("data-align") || "";
        const galleryValue = node.getAttribute("data-brand-gallery") || "";
        const fontValue = node.getAttribute("data-brand-font") || "";
        const sizeValue = node.getAttribute("data-brand-size") || "";
        const colspanValue = node.getAttribute("colspan") || "";
        const rowspanValue = node.getAttribute("rowspan") || "";
        const cellAlignValue = node.getAttribute("align") || "";
        const listStartValue = node.getAttribute("start") || "";
        const taskValue = node.hasAttribute("data-task");
        const taskCheckedValue = node.hasAttribute("data-task-checked");
        const checkedValue = node.hasAttribute("checked");
        [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));

        if (["P", "H1", "H2", "H3", "H4", "H5", "H6"].includes(node.tagName) && ["left", "center", "right"].includes(alignValue)) {
          node.setAttribute("data-align", alignValue);
        }

        if (node.tagName === "A") {
          const href = safeExternalUrl(hrefValue);
          if (href) {
            node.setAttribute("href", href);
            node.setAttribute("target", "_blank");
            node.setAttribute("rel", "noopener noreferrer");
          } else {
            node.removeAttribute("href");
          }
        }

        if (node.tagName === "IMG") {
          const source = safeImageUrl(sourceValue);
          if (!source) {
            node.remove();
            return;
          }
          node.setAttribute("src", source);
          node.setAttribute("alt", altValue);
          node.setAttribute("loading", "lazy");
        }

        if (node.tagName === "IFRAME") {
          const source = safeVideoEmbedUrl(sourceValue);
          if (!source) {
            node.remove();
            return;
          }
          node.setAttribute("src", source);
          node.setAttribute("title", "브랜드 영상");
          node.setAttribute("loading", "lazy");
          node.setAttribute("allow", source.includes("vimeo.com") ? "autoplay; fullscreen; picture-in-picture" : "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
          node.setAttribute("allowfullscreen", "");
        }

        if (node.tagName === "VIDEO") {
          const source = safeVideoFileUrl(sourceValue);
          if (!source) {
            node.remove();
            return;
          }
          node.setAttribute("src", source);
          node.setAttribute("controls", "");
          node.setAttribute("preload", "metadata");
        }

        if (node.tagName === "SECTION") {
          if (!["2", "3"].includes(galleryValue)) {
            node.replaceWith(...node.childNodes);
            clean(parent);
            return;
          }
          node.setAttribute("data-brand-gallery", galleryValue);
        }

        if (node.tagName === "SPAN") {
          if (!["sans", "serif", "mono"].includes(fontValue)) {
            node.replaceWith(...node.childNodes);
            clean(parent);
            return;
          }
          node.setAttribute("data-brand-font", fontValue);
        }

        if (node.tagName === "BIG") {
          if (!["14", "16", "18", "24", "32", "42"].includes(sizeValue)) {
            node.replaceWith(...node.childNodes);
            clean(parent);
            return;
          }
          node.setAttribute("data-brand-size", sizeValue);
        }

        if (["TH", "TD"].includes(node.tagName)) {
          if (/^[1-9]\d?$/.test(colspanValue)) node.setAttribute("colspan", colspanValue);
          if (/^[1-9]\d?$/.test(rowspanValue)) node.setAttribute("rowspan", rowspanValue);
          if (["left", "center", "right"].includes(cellAlignValue)) node.setAttribute("align", cellAlignValue);
        }

        if (node.tagName === "OL" && /^\d{1,4}$/.test(listStartValue)) node.setAttribute("start", listStartValue);
        if (node.tagName === "LI" && taskValue) {
          node.setAttribute("data-task", "");
          if (taskCheckedValue) node.setAttribute("data-task-checked", "");
        }
        if (node.tagName === "INPUT") {
          node.setAttribute("type", "checkbox");
          node.setAttribute("disabled", "");
          if (checkedValue) node.setAttribute("checked", "");
        }

        clean(node);
      });
    }

    clean(template.content);
    return template.innerHTML;
  }

  async function loadProducts() {
    const response = await fetch("products.json", { cache: "no-store" });
    if (!response.ok) throw new Error("제품 데이터를 불러오지 못했습니다.");
    const data = await response.json();
    return Array.isArray(data.products) ? data.products : [];
  }

  async function loadVisibleProducts() {
    const products = await loadProducts();
    return products.filter((product) => product && product.published !== false);
  }

  window.ProductCatalog = {
    escapeHtml,
    loadProducts,
    loadVisibleProducts,
    safeExternalUrl,
    safeImageUrl,
    safeVideoEmbedUrl,
    safeVideoFileUrl,
    sanitizeRichText,
  };
})();

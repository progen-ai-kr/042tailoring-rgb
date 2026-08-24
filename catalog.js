// 제품 데이터 로딩과 안전 처리를 담당합니다.
// 학생은 제품 UI를 style.css에서 디자인하고, 이 파일의 보안 함수는 유지하세요.
(function () {
  "use strict";

  const ALLOWED_RICH_TAGS = new Set([
    "P", "BR", "H2", "H3", "H4", "STRONG", "EM", "S", "UL", "OL", "LI",
    "BLOCKQUOTE", "A", "IMG", "FIGURE", "FIGCAPTION", "HR", "IFRAME", "VIDEO"
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
        [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));

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
          node.setAttribute("title", "제품 영상");
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

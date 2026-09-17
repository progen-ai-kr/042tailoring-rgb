// 042 TAILORING 공개 사이트 인터랙션
(function () {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isHome = document.body.classList.contains("home-page");
  const editorialNames = [
    "BLACK DENIM TRACKER",
    "SIGNATURE LINE-STITCH SUIT",
    "BELTED TAILORED SET",
    "COLLAR STITCH SHIRT / WIDE PANT",
  ];
  const editorialMeta = [
    { category: "DENIM / SET-UP", color: "BLACK", number: "#001 / 100" },
    { category: "TAILORED SUIT", color: "CHARCOAL", number: "#014 / 100" },
    { category: "DOUBLE SET-UP", color: "CHALK BEIGE", number: "#042 / 100" },
    { category: "SHIRT / PANT", color: "SLATE", number: "#087 / 100" },
  ];
  let cachedProducts = [];

  function upgradeSubpageChrome() {
    if (isHome) return;
    const legacyHeader = document.querySelector(".nav");
    if (legacyHeader) {
      const header = document.createElement("header");
      header.className = "site-header";
      header.setAttribute("data-header", "");
      header.innerHTML = `
        <a class="brand-logo" href="index.html#home" aria-label="042 TAILORING 홈"><span class="brand-logo-reveal">
          <img class="brand-logo-default" src="images/brand/logo-header-transparent.png" alt="042 TAILORING" width="1502" height="421" />
          <img class="brand-logo-hover" src="images/brand/logo-header-hover-transparent.png" alt="" width="1501" height="420" aria-hidden="true" />
        </span></a>
        <div class="header-actions">
          <button class="header-action find-trigger" type="button" aria-controls="searchPanel" aria-expanded="false"><span class="find-icon" aria-hidden="true"></span><span>FIND</span></button>
          <button class="header-action menu-trigger" type="button" aria-controls="menuPanel" aria-expanded="false"><span>MENU</span><span class="menu-glyph" aria-hidden="true">☰</span></button>
        </div>`;
      legacyHeader.replaceWith(header);
      document.body.insertAdjacentHTML("beforeend", `
        <aside class="screen-panel menu-panel" id="menuPanel" aria-hidden="true" aria-label="전체 메뉴" inert>
          <div class="panel-top"><span>INDEX / 042</span><button class="panel-close" type="button" data-close-panel>닫기 <span aria-hidden="true">×</span></button></div>
          <nav class="big-menu" aria-label="주요 메뉴">
            <a href="index.html#home" data-section-link><span>01</span>HOME</a>
            <a href="index.html#collection" data-section-link><span>02</span>COLLECTION</a>
            <a href="index.html#story" data-section-link><span>03</span>STORY</a>
          </nav><p class="panel-note">DAEJEON / SEOUL<br />UNNECESSARY PERFECTION</p>
        </aside>
        <aside class="screen-panel search-panel" id="searchPanel" aria-hidden="true" aria-label="제품 검색" inert>
          <div class="panel-top"><span>FIND / COLLECTION</span><button class="panel-close" type="button" data-close-panel>닫기 <span aria-hidden="true">×</span></button></div>
          <div class="search-wrap"><label for="productSearch">WHAT ARE YOU LOOKING FOR?</label><input id="productSearch" type="search" placeholder="TYPE TO FIND" autocomplete="off" /><p class="search-hint">제품명, 소재, 색상으로 검색하세요.</p><div class="search-results" id="searchResults" aria-live="polite"></div></div>
        </aside>`);
    }
    const footer = document.querySelector(".footer");
    if (footer) footer.innerHTML = '<p class="logo">042 TAILORING</p><p class="biz">UNNECESSARY PERFECTION · DAEJEON, KOREA</p><p>© 042 TAILORING. ALL RIGHTS RESERVED.</p>';
  }

  function revealMain() {
    document.body.classList.remove("is-intro-pending");
    document.body.classList.add("main-ready");
    const logo = document.querySelector(".brand-logo");
    if (logo) {
      logo.classList.remove("is-typing");
      void logo.offsetWidth;
      logo.classList.add("is-typing");
    }
    window.setTimeout(() => document.querySelector(".lookbook-video.is-active")?.play().catch(() => {}), 180);
  }

  function hideIntro(intro) {
    if (!intro || intro.hidden) return;
    intro.hidden = true;
    intro.setAttribute("aria-hidden", "true");
    revealMain();
  }

  function initIntro() {
    const intro = document.getElementById("intro");
    if (!intro) {
      revealMain();
      return;
    }
    let played = false;
    try { played = sessionStorage.getItem("intro-042-played") === "true"; } catch (_) {}
    if (played) {
      hideIntro(intro);
      return;
    }
    try { sessionStorage.setItem("intro-042-played", "true"); } catch (_) {}

    const safetyTimer = window.setTimeout(() => hideIntro(intro), 5000);
    const complete = () => {
      window.clearTimeout(safetyTimer);
      hideIntro(intro);
    };
    intro.querySelector(".intro-skip")?.addEventListener("click", complete);

    const image = intro.querySelector(".intro-image");
    if (!window.gsap || !image) {
      window.setTimeout(complete, reducedMotion ? 650 : 1200);
      return;
    }
    if (reducedMotion) {
      gsap.timeline({ onComplete: complete })
        .fromTo(image, { opacity: 0 }, { opacity: 1, duration: .45, delay: .12, ease: "power1.out" })
        .to(image, { opacity: 0, duration: .45, delay: .3, ease: "power1.in" });
      return;
    }
    gsap.timeline({ defaults: { ease: "power1.out" }, onComplete: complete })
      .fromTo(image, { opacity: 0, scale: .97 }, { opacity: 1, scale: 1, duration: 1.15, delay: .3, ease: "power1.out" })
      .to(image, { opacity: 0, scale: .985, duration: 1.1, delay: 1.3, ease: "power1.in" })
      .to(".intro-curtain-top", { yPercent: -100, duration: .82, ease: "power2.inOut" }, 3.7)
      .to(".intro-curtain-bottom", { yPercent: 100, duration: .82, ease: "power2.inOut" }, 3.7);
  }

  function setupPanels() {
    const triggers = document.querySelectorAll("[aria-controls]");
    let activePanel = null;
    let returnFocus = null;

    function closePanel() {
      if (!activePanel) return;
      activePanel.classList.remove("is-open");
      activePanel.setAttribute("aria-hidden", "true");
      activePanel.setAttribute("inert", "");
      triggers.forEach((button) => button.setAttribute("aria-expanded", "false"));
      document.body.classList.remove("panel-open");
      const focusTarget = returnFocus;
      activePanel = null;
      window.setTimeout(() => focusTarget?.focus(), 100);
    }

    function openPanel(panel, trigger) {
      if (!panel) return;
      if (activePanel && activePanel !== panel) closePanel();
      activePanel = panel;
      returnFocus = trigger;
      panel.classList.add("is-open");
      panel.setAttribute("aria-hidden", "false");
      panel.removeAttribute("inert");
      trigger.setAttribute("aria-expanded", "true");
      document.body.classList.add("panel-open");
      window.setTimeout(() => panel.querySelector("input, a, button")?.focus(), 80);
    }

    triggers.forEach((trigger) => {
      const panel = document.getElementById(trigger.getAttribute("aria-controls"));
      trigger.addEventListener("click", () => openPanel(panel, trigger));
    });
    document.querySelectorAll("[data-close-panel]").forEach((button) => button.addEventListener("click", closePanel));
    document.querySelectorAll("[data-section-link]").forEach((link) => link.addEventListener("click", closePanel));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePanel();
      if (event.key !== "Tab" || !activePanel) return;
      const focusable = [...activePanel.querySelectorAll("a, button, input")].filter((item) => !item.disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
      if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
    });
    return closePanel;
  }

  function setupHeader() {
    const header = document.querySelector("[data-header]");
    if (!header) return;
    const update = () => header.classList.toggle("is-scrolled", window.scrollY > 20);
    update();
    window.addEventListener("scroll", update, { passive: true });
    if (!isHome || !("IntersectionObserver" in window)) return;
    const sectionLinks = [...document.querySelectorAll("[data-section-link]")];
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        sectionLinks.forEach((link) => link.classList.toggle("is-current", link.hash === `#${entry.target.id}`));
      });
    }, { rootMargin: "-35% 0px -55%", threshold: 0 });
    document.querySelectorAll("main > section[id]").forEach((section) => observer.observe(section));
  }

  function setupSlider() {
    const videos = [...document.querySelectorAll(".lookbook-video")];
    const dots = [...document.querySelectorAll(".slide-dot")];
    const media = document.getElementById("lookbookMedia");
    if (!videos.length) return;
    let current = 0;
    let timer = null;
    let startX = 0;
    let startY = 0;

    function show(index) {
      current = (index + videos.length) % videos.length;
      window.clearTimeout(timer);
      videos.forEach((video, i) => {
        const active = i === current;
        video.classList.toggle("is-active", active);
        if (!active) { video.pause(); video.currentTime = 0; }
      });
      dots.forEach((dot, i) => {
        dot.classList.toggle("is-active", i === current);
        dot.setAttribute("aria-selected", String(i === current));
        if (i === current) { const bar = dot.querySelector("i"); if (bar) { bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = ""; } }
      });
      if (reducedMotion) return;
      const activeVideo = videos[current];
      activeVideo.play().catch(() => {});
      timer = window.setTimeout(() => show(current + 1), 7200);
    }

    dots.forEach((dot) => dot.addEventListener("click", () => show(Number(dot.dataset.slideTo))));
    document.querySelector(".slide-prev")?.addEventListener("click", () => show(current - 1));
    document.querySelector(".slide-next")?.addEventListener("click", () => show(current + 1));
    media?.addEventListener("touchstart", (event) => { startX = event.changedTouches[0].clientX; startY = event.changedTouches[0].clientY; }, { passive: true });
    media?.addEventListener("touchend", (event) => {
      const dx = event.changedTouches[0].clientX - startX;
      const dy = event.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(current + (dx < 0 ? 1 : -1));
    }, { passive: true });
    document.querySelector(".lookbook")?.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") show(current - 1);
      if (event.key === "ArrowRight") show(current + 1);
    });
    show(0);
  }

  function createProductCard(product, index) {
    const meta = editorialMeta[index] || { category: product.category || product.label || "COLLECTION", color: "BLACK", number: `#${String(index + 1).padStart(3, "0")} / 100` };
    const article = document.createElement("a");
    article.className = "editorial-card";
    article.id = `collection-${product.id}`;
    article.href = `product.html?id=${encodeURIComponent(product.id)}`;
    article.dataset.search = [editorialNames[index], product.name, product.summary, ...(product.keywords || [])].join(" ").toLowerCase();
    const image = window.ProductCatalog?.safeImageUrl(product.images?.[0]) || "";
    const imageBox = document.createElement("div");
    imageBox.className = "editorial-image";
    if (image) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = `${editorialNames[index] || product.name} 착용 이미지`;
      img.loading = "lazy";
      img.width = 800;
      img.height = 1067;
      imageBox.appendChild(img);
    }
    const stitch = document.createElement("span");
    stitch.className = "card-stitch";
    imageBox.appendChild(stitch);
    article.appendChild(imageBox);
    const top = document.createElement("div");
    top.className = "card-topline";
    top.innerHTML = `<span>${meta.category}</span><span>${meta.color}</span>`;
    article.appendChild(top);
    const title = document.createElement("h3");
    title.textContent = editorialNames[index] || product.name;
    article.appendChild(title);
    const bottom = document.createElement("div");
    bottom.className = "card-bottom";
    const number = document.createElement("span");
    number.className = "piece-no";
    number.textContent = meta.number;
    const price = document.createElement("span");
    price.textContent = product.price || "PRICE ON REQUEST";
    bottom.append(number, price);
    article.appendChild(bottom);
    return article;
  }

  async function loadProducts() {
    try {
      if (window.ProductCatalog) cachedProducts = await ProductCatalog.loadVisibleProducts();
      else {
        const response = await fetch("products.json", { cache: "no-store" });
        const data = await response.json();
        cachedProducts = (data.products || []).filter((product) => product.published !== false);
      }
      const grid = document.getElementById("home-looks");
      if (grid) {
        grid.replaceChildren(...cachedProducts.slice(0, 4).map(createProductCard));
        const requestedId = new URLSearchParams(location.search).get("find");
        if (requestedId) window.setTimeout(() => focusProduct(requestedId), 120);
      }
      renderSearch("");
    } catch (_) {
      const grid = document.getElementById("home-looks");
      if (grid) grid.innerHTML = '<p class="loading-copy">컬렉션을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>';
    }
  }

  function focusProduct(id) {
    const card = document.getElementById(`collection-${id}`);
    if (!card) return;
    card.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    card.classList.add("is-highlighted");
    window.setTimeout(() => card.classList.remove("is-highlighted"), 1800);
  }

  function renderSearch(query) {
    const box = document.getElementById("searchResults");
    if (!box) return;
    const term = query.trim().toLowerCase();
    const results = cachedProducts.map((product, index) => ({ product, index })).filter(({ product, index }) => {
      const haystack = [editorialNames[index], product.name, product.summary, product.category, ...(product.keywords || [])].join(" ").toLowerCase();
      return !term || haystack.includes(term);
    });
    box.replaceChildren();
    if (!results.length) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = "일치하는 제품이 없습니다.";
      box.appendChild(empty);
      return;
    }
    results.forEach(({ product, index }) => {
      const link = document.createElement("a");
      link.className = "search-result";
      link.href = isHome ? `#collection-${product.id}` : `index.html?find=${encodeURIComponent(product.id)}#collection`;
      link.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><b></b><small>VIEW →</small>`;
      link.querySelector("b").textContent = editorialNames[index] || product.name;
      if (isHome) link.addEventListener("click", (event) => { event.preventDefault(); document.querySelector("[data-close-panel]")?.click(); window.setTimeout(() => focusProduct(product.id), 350); });
      box.appendChild(link);
    });
  }

  upgradeSubpageChrome();
  document.getElementById("productSearch")?.addEventListener("input", (event) => renderSearch(event.target.value));
  setupPanels();
  setupHeader();
  if (isHome) {
    initIntro();
    setupSlider();
  } else {
    revealMain();
  }
  loadProducts();
})();

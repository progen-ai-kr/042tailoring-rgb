// 브랜드 담당자가 사용하는 제품 편집기입니다. GitHub 권한이나 비밀번호는 브라우저에 저장하지 않습니다.
(function () {
  "use strict";

  const brandName = String(window.BRAND_SITE && window.BRAND_SITE.name || "브랜드").trim() || "브랜드";
  document.title = `${brandName} 제품 관리`;
  document.querySelectorAll("[data-brand-name]").forEach((element) => {
    element.textContent = brandName;
  });

  const state = {
    catalog: null,
    sha: "",
    currentId: "",
    dirty: false,
    uploading: 0,
  };
  let toastTimer;
  let detailPreviewMedia;
  let detailPreviewMediaHandler;
  const toastEditors = new Map();

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const elements = {
    loading: $("#loadingView"),
    login: $("#loginView"),
    loginForm: $("#loginForm"),
    loginError: $("#loginError"),
    password: $("#password"),
    passwordToggle: $("#passwordToggle"),
    app: $("#adminApp"),
    changePassword: $("#changePasswordButton"),
    logout: $("#logoutButton"),
    saveState: $("#saveState"),
    sidebar: $("#productSidebar"),
    productCount: $("#productCount"),
    productSearch: $("#productSearch"),
    productList: $("#productList"),
    newProduct: $("#newProductButton"),
    emptyEditor: $("#emptyEditor"),
    productForm: $("#productForm"),
    editorProductName: $("#editorProductName"),
    mobileList: $("#mobileListButton"),
    sidebarToggle: $("#sidebarToggleButton"),
    sidebarToggleLabel: $("#sidebarToggleLabel"),
    preview: $("#previewLink"),
    save: $("#saveButton"),
    mainImageInput: $("#mainImageInput"),
    mainImageDrop: $("#mainImageDrop"),
    mainImageGrid: $("#mainImageGrid"),
    mainImageEmpty: $("#mainImageEmpty"),
    detailEditorMount: $("#detailEditorMount"),
    deleteProduct: $("#deleteProductButton"),
    passwordDialog: $("#passwordDialog"),
    passwordForm: $("#passwordForm"),
    passwordDialogTitle: $("#passwordDialogTitle"),
    passwordDialogLead: $("#passwordDialogLead"),
    currentPassword: $("#currentPassword"),
    newPassword: $("#newPassword"),
    confirmPassword: $("#confirmPassword"),
    passwordError: $("#passwordError"),
    passwordCancel: $("#passwordCancelButton"),
    passwordSubmit: $("#passwordSubmitButton"),
    toast: $("#toast"),
  };

  boot();

  async function boot() {
    bindEvents();
    try {
      const session = await api("/api/admin/session");
      if (session.authenticated) await openAdmin();
      else showLogin();
    } catch (error) {
      showLogin(error.message);
    }
  }

  function bindEvents() {
    elements.loginForm.addEventListener("submit", handleLogin);
    elements.passwordToggle.addEventListener("click", () => {
      const visible = elements.password.type === "text";
      elements.password.type = visible ? "password" : "text";
      elements.passwordToggle.textContent = visible ? "보기" : "숨김";
    });
    elements.changePassword.addEventListener("click", openPasswordDialog);
    elements.passwordForm.addEventListener("submit", handlePasswordChange);
    elements.passwordCancel.addEventListener("click", closePasswordDialog);
    elements.logout.addEventListener("click", handleLogout);
    elements.newProduct.addEventListener("click", addProduct);
    elements.productSearch.addEventListener("input", renderProductList);
    elements.mobileList.addEventListener("click", () => document.body.classList.remove("editor-open"));
    elements.sidebarToggle.addEventListener("click", toggleProductSidebar);
    elements.productForm.addEventListener("submit", saveCatalog);
    elements.productForm.addEventListener("input", handleProductField);
    elements.productForm.addEventListener("change", handleProductField);
    elements.deleteProduct.addEventListener("click", deleteCurrentProduct);
    elements.mainImageInput.addEventListener("change", async (event) => {
      await addMainImages(event.target.files);
      event.target.value = "";
    });
    elements.mainImageEmpty.addEventListener("click", () => elements.mainImageInput.click());
    elements.mainImageGrid.addEventListener("click", handleMainImageAction);
    elements.mainImageDrop.addEventListener("dragover", (event) => {
      event.preventDefault();
      elements.mainImageDrop.classList.add("dragging");
    });
    elements.mainImageDrop.addEventListener("dragleave", () => elements.mainImageDrop.classList.remove("dragging"));
    elements.mainImageDrop.addEventListener("drop", async (event) => {
      event.preventDefault();
      elements.mainImageDrop.classList.remove("dragging");
      await addMainImages(event.dataTransfer.files);
    });
    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
    restoreProductSidebar();
  }

  function restoreProductSidebar() {
    let collapsed = false;
    try { collapsed = localStorage.getItem("restitchProductSidebarCollapsed") === "true"; } catch (_) {}
    setProductSidebarCollapsed(collapsed, false);
  }

  function toggleProductSidebar() {
    setProductSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
  }

  function setProductSidebarCollapsed(collapsed, remember = true) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    elements.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    elements.sidebarToggleLabel.textContent = collapsed ? "목록 열기" : "목록 숨기기";
    elements.sidebarToggle.querySelector(".sidebar-toggle-icon").textContent = collapsed ? "☰" : "‹";
    if (remember) {
      try { localStorage.setItem("restitchProductSidebarCollapsed", String(collapsed)); } catch (_) {}
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    elements.loginError.hidden = true;
    const button = $("button[type='submit']", elements.loginForm);
    button.disabled = true;
    button.textContent = "확인 중…";
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: elements.password.value }),
      });
      elements.password.value = "";
      await openAdmin();
    } catch (error) {
      elements.loginError.textContent = error.message;
      elements.loginError.hidden = false;
      elements.password.focus();
    } finally {
      button.disabled = false;
      button.textContent = "관리 화면 열기";
    }
  }

  function openPasswordDialog() {
    elements.passwordForm.reset();
    elements.passwordError.hidden = true;
    elements.passwordCancel.hidden = false;
    elements.passwordDialogTitle.textContent = "관리자 비밀번호 변경";
    elements.passwordDialogLead.textContent = "원할 때 새 비밀번호로 변경할 수 있습니다. 변경하면 다른 기기의 기존 로그인은 모두 해제됩니다.";
    if (!elements.passwordDialog.open) elements.passwordDialog.showModal();
    window.setTimeout(() => elements.currentPassword.focus(), 50);
  }

  function closePasswordDialog() {
    elements.passwordDialog.close();
    elements.passwordForm.reset();
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    elements.passwordError.hidden = true;
    if (elements.newPassword.value !== elements.confirmPassword.value) {
      elements.passwordError.textContent = "새 비밀번호가 서로 일치하지 않습니다.";
      elements.passwordError.hidden = false;
      elements.confirmPassword.focus();
      return;
    }
    if (elements.newPassword.value.length < 8) {
      elements.passwordError.textContent = "새 비밀번호를 8자 이상 입력해 주세요.";
      elements.passwordError.hidden = false;
      elements.newPassword.focus();
      return;
    }

    elements.passwordSubmit.disabled = true;
    elements.passwordSubmit.textContent = "변경 중…";
    try {
      await api("/api/admin/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: elements.currentPassword.value,
          newPassword: elements.newPassword.value,
        }),
      });
      elements.passwordDialog.close();
      elements.passwordForm.reset();
      showToast("관리자 비밀번호를 변경했습니다. 다른 기기의 기존 로그인은 해제됩니다.");
    } catch (error) {
      elements.passwordError.textContent = error.message;
      elements.passwordError.hidden = false;
    } finally {
      elements.passwordSubmit.disabled = false;
      elements.passwordSubmit.textContent = "비밀번호 변경";
    }
  }

  async function handleLogout() {
    if (state.dirty && !window.confirm("저장하지 않은 변경사항이 있습니다. 그래도 로그아웃할까요?")) return;
    try { await api("/api/admin/logout", { method: "POST", body: "{}" }); } catch (_) {}
    state.catalog = null;
    state.sha = "";
    state.currentId = "";
    if (elements.passwordDialog.open) elements.passwordDialog.close();
    setDirty(false);
    showLogin();
  }

  function showLogin(message = "") {
    elements.loading.hidden = true;
    elements.app.hidden = true;
    elements.login.hidden = false;
    document.body.classList.remove("editor-open");
    if (message) {
      elements.loginError.textContent = message;
      elements.loginError.hidden = false;
    }
    window.setTimeout(() => elements.password.focus(), 50);
  }

  async function openAdmin() {
    elements.loading.hidden = false;
    elements.login.hidden = true;
    elements.app.hidden = true;
    try {
      const data = await api("/api/admin/catalog");
      state.catalog = data.catalog;
      state.sha = data.sha;
      state.currentId = state.catalog.products[0]?.id || "";
      setDirty(false);
      renderProductList();
      renderEditor();
      elements.loading.hidden = true;
      elements.app.hidden = false;
    } catch (error) {
      elements.loading.hidden = true;
      if (error.status === 401) showLogin();
      else showLogin(error.message);
    }
  }

  function currentProduct() {
    return state.catalog?.products.find((product) => product.id === state.currentId) || null;
  }

  function renderProductList() {
    if (!state.catalog) return;
    const query = elements.productSearch.value.trim().toLowerCase();
    const products = state.catalog.products.filter((product) => {
      const source = `${product.name || ""} ${product.category || ""} ${product.label || ""}`.toLowerCase();
      return !query || source.includes(query);
    });
    elements.productCount.textContent = String(state.catalog.products.length);
    elements.productList.replaceChildren();

    if (!products.length) {
      const empty = create("p", "list-empty", query ? "검색 결과가 없습니다." : "아직 등록된 제품이 없습니다.\n＋ 버튼으로 첫 제품을 추가하세요.");
      elements.productList.append(empty);
      return;
    }

    products.forEach((product) => {
      const button = create("button", `product-item${product.id === state.currentId ? " active" : ""}`);
      button.type = "button";
      button.dataset.productId = product.id;
      button.addEventListener("click", () => selectProduct(product.id));

      const thumb = create("span", "product-thumb");
      if (product.images?.[0]) {
        const image = document.createElement("img");
        image.src = imageUrl(product.images[0]);
        image.alt = "";
        image.loading = "lazy";
        thumb.append(image);
      } else {
        thumb.append(create("span", "", "＋"));
      }

      const copy = create("span", "product-item-copy");
      copy.append(create("strong", "", product.name || "이름 없는 제품"));
      copy.append(create("span", "", [product.label, product.category].filter(Boolean).join(" · ") || "기본 정보 입력 전"));
      button.append(thumb, copy, create("span", `status-dot${product.published !== false ? " on" : ""}`));
      elements.productList.append(button);
    });
  }

  function selectProduct(id) {
    if (state.currentId === id) {
      document.body.classList.add("editor-open");
      return;
    }
    state.currentId = id;
    renderProductList();
    renderEditor();
    document.body.classList.add("editor-open");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addProduct() {
    const product = {
      id: crypto.randomUUID(),
      published: false,
      featured: false,
      label: "NEW",
      name: "새 제품",
      summary: "",
      category: "",
      price: "",
      keywords: [],
      images: [],
      buyLabel: "구매하기",
      buyLink: "",
      sections: [],
    };
    state.catalog.products.unshift(product);
    state.currentId = product.id;
    setDirty(true);
    renderProductList();
    renderEditor();
    document.body.classList.add("editor-open");
    $("[data-field='name']", elements.productForm).select();
  }

  function renderEditor() {
    const product = currentProduct();
    const hasProduct = Boolean(product);
    elements.emptyEditor.hidden = hasProduct;
    elements.productForm.hidden = !hasProduct;
    if (!product) return;

    elements.editorProductName.textContent = product.name || "제품 편집";
    elements.preview.href = `product.html?id=${encodeURIComponent(product.id)}`;
    elements.productForm.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.dataset.field;
      if (input.type === "checkbox") input.checked = Boolean(product[field]);
      else if (field === "keywords") input.value = Array.isArray(product.keywords) ? product.keywords.join(", ") : "";
      else input.value = product[field] || "";
    });
    renderMainImages();
    renderDetailEditor();
  }

  function handleProductField(event) {
    const input = event.target.closest("[data-field]");
    const product = currentProduct();
    if (!input || !product) return;
    const field = input.dataset.field;
    if (input.type === "checkbox") product[field] = input.checked;
    else if (field === "keywords") product.keywords = input.value.split(",").map((item) => item.trim()).filter(Boolean);
    else product[field] = input.value;
    elements.editorProductName.textContent = product.name || "제품 편집";
    setDirty(true);
    renderProductList();
  }

  function renderMainImages() {
    const product = currentProduct();
    elements.mainImageGrid.replaceChildren();
    (product?.images || []).forEach((path, index) => {
      const card = imageCard(path, index, product.images.length, "main");
      if (index === 0) card.append(create("span", "image-badge", "대표"));
      elements.mainImageGrid.append(card);
    });
    elements.mainImageEmpty.hidden = Boolean(product?.images?.length);
  }

  function imageCard(path, index, length, scope) {
    const card = create("div", "image-card");
    const image = document.createElement("img");
    image.src = imageUrl(path);
    image.alt = "제품 이미지";
    image.loading = "lazy";
    card.append(image);
    const actions = create("div", "image-actions");
    if (index > 0) actions.append(actionButton("←", `${scope}-left`, index, "앞으로 이동"));
    if (index < length - 1) actions.append(actionButton("→", `${scope}-right`, index, "뒤로 이동"));
    actions.append(actionButton("×", `${scope}-remove`, index, "이미지 제거"));
    card.append(actions);
    return card;
  }

  function actionButton(label, action, index, title) {
    const button = create("button", "", label);
    button.type = "button";
    button.dataset.imageAction = action;
    button.dataset.imageIndex = String(index);
    button.title = title;
    return button;
  }

  async function addMainImages(files) {
    const product = currentProduct();
    if (!product || !files?.length) return;
    const paths = await uploadFiles(files, product.id);
    product.images.push(...paths);
    if (paths.length) setDirty(true);
    renderMainImages();
  }

  function handleMainImageAction(event) {
    const button = event.target.closest("[data-image-action]");
    const product = currentProduct();
    if (!button || !product) return;
    const index = Number(button.dataset.imageIndex);
    const action = button.dataset.imageAction;
    if (action.endsWith("remove")) product.images.splice(index, 1);
    if (action.endsWith("left") && index > 0) [product.images[index - 1], product.images[index]] = [product.images[index], product.images[index - 1]];
    if (action.endsWith("right") && index < product.images.length - 1) [product.images[index + 1], product.images[index]] = [product.images[index], product.images[index + 1]];
    setDirty(true);
    renderMainImages();
    renderProductList();
  }

  function renderDetailEditor() {
    const product = currentProduct();
    destroyToastEditors();
    elements.detailEditorMount.replaceChildren();
    if (!product) return;

    const initialHtml = sanitizeEditorHtml(sectionsToSingleHtml(product.sections));
    if (!window.toastui?.Editor) {
      const fallback = document.createElement("textarea");
      fallback.className = "toast-editor-fallback";
      fallback.value = initialHtml;
      fallback.placeholder = "제품 설명을 작성하고 이미지와 영상을 원하는 순서로 넣어 주세요.";
      fallback.addEventListener("input", () => {
        product.sections = singleDetailSection(fallback.value);
        setDirty(true);
      });
      elements.detailEditorMount.append(fallback);
      return;
    }

    let ready = false;
    let editor;
    const previewMedia = window.matchMedia("(min-width: 1100px)");
    window.toastui.Editor.setLanguage(["ko", "ko-KR"], {
      Markdown: "분할 편집",
      WYSIWYG: "블로그 편집",
    });
    editor = new window.toastui.Editor({
      el: elements.detailEditorMount,
      height: "760px",
      minHeight: "520px",
      initialEditType: "markdown",
      previewStyle: previewMedia.matches ? "vertical" : "tab",
      hideModeSwitch: false,
      language: "ko-KR",
      autofocus: false,
      usageStatistics: false,
      placeholder: "제품 설명을 작성하고 이미지와 영상을 원하는 순서로 넣어 주세요.",
      toolbarItems: [
        ["heading", "bold", "italic", "strike"],
        ["hr", "quote"],
        ["ul", "ol"],
        ["link", "image"],
        [createVideoToolbarItem(() => editor, product)],
      ],
      customHTMLRenderer: videoHtmlRenderer(),
      hooks: {
        addImageBlobHook: async (blob, callback) => {
          const paths = await uploadFiles([blob], product.id);
          if (paths[0]) callback(imageUrl(paths[0]), blob.name || "본문 이미지");
        },
      },
      events: {
        change: () => {
          if (!ready) return;
          product.sections = singleDetailSection(editor.getHTML());
          setDirty(true);
        },
      },
    });
    editor.setHTML(initialHtml, false);
    ready = true;
    toastEditors.set("detail", editor);
    detailPreviewMedia = previewMedia;
    detailPreviewMediaHandler = () => editor.changePreviewStyle(previewMedia.matches ? "vertical" : "tab");
    if (previewMedia.addEventListener) previewMedia.addEventListener("change", detailPreviewMediaHandler);
    else previewMedia.addListener(detailPreviewMediaHandler);
  }

  function sectionsToSingleHtml(sections) {
    return (Array.isArray(sections) ? sections : []).map((section) => {
      if (!section || !section.type) return "";
      if (section.type === "rich_text") return section.body || "";
      if (section.type === "full_image") {
        const source = safeEditorImageUrl(section.image);
        if (!source) return "";
        const caption = section.caption ? `<figcaption>${escapeEditorText(section.caption)}</figcaption>` : "";
        return `<figure><img src="${escapeEditorAttribute(source)}" alt="${escapeEditorAttribute(section.alt || "상세 이미지")}">${caption}</figure>`;
      }
      if (section.type === "image_text") {
        const source = safeEditorImageUrl(section.image);
        const image = source ? `<img src="${escapeEditorAttribute(source)}" alt="${escapeEditorAttribute(section.heading || "상세 이미지")}">` : "";
        const heading = section.heading ? `<h2>${escapeEditorText(section.heading)}</h2>` : "";
        return `${image}${heading}${section.body || ""}`;
      }
      if (section.type === "gallery") {
        return (Array.isArray(section.images) ? section.images : []).map((value) => {
          const source = safeEditorImageUrl(value);
          return source ? `<img src="${escapeEditorAttribute(source)}" alt="상세 이미지">` : "";
        }).join("");
      }
      if (section.type === "highlight") {
        const heading = section.heading ? `<h2>${escapeEditorText(section.heading)}</h2>` : "";
        return `<blockquote>${heading}${section.body || ""}</blockquote>`;
      }
      return "";
    }).join("");
  }

  function singleDetailSection(html) {
    const body = sanitizeEditorHtml(html);
    return body.trim() ? [{ type: "rich_text", body }] : [];
  }

  function destroyToastEditors() {
    if (detailPreviewMedia && detailPreviewMediaHandler) {
      if (detailPreviewMedia.removeEventListener) detailPreviewMedia.removeEventListener("change", detailPreviewMediaHandler);
      else detailPreviewMedia.removeListener(detailPreviewMediaHandler);
    }
    detailPreviewMedia = null;
    detailPreviewMediaHandler = null;
    toastEditors.forEach((editor) => {
      try { editor.destroy(); } catch (_) {}
    });
    toastEditors.clear();
  }

  function syncToastEditors() {
    const product = currentProduct();
    if (!product) return;
    const editor = toastEditors.get("detail");
    if (editor) product.sections = singleDetailSection(editor.getHTML());
  }

  function createVideoToolbarItem(getEditor, product) {
    const body = create("div", "detail-video-popup-body");
    body.append(create("strong", "", "영상 주소로 추가"));
    body.append(create("p", "", "유튜브·비메오 또는 MP4·WebM·Ogg 영상 파일 주소를 붙여 넣으세요."));

    const form = create("form", "detail-video-popup-form");
    const input = document.createElement("input");
    input.type = "url";
    input.inputMode = "url";
    input.required = true;
    input.placeholder = "https://youtu.be/... 또는 https://.../video.mp4";
    input.setAttribute("aria-label", "영상 주소");
    const error = create("p", "detail-video-popup-error");
    error.hidden = true;

    const actions = create("div", "detail-video-popup-actions");
    const cancel = create("button", "toastui-editor-close-button", "취소");
    cancel.type = "button";
    const submit = create("button", "toastui-editor-ok-button", "영상 넣기");
    submit.type = "submit";
    actions.append(cancel, submit);
    form.append(input, error, actions);
    body.append(form);

    const closePopup = () => {
      getEditor()?.eventEmitter.emit("closePopup");
      form.reset();
      error.hidden = true;
    };
    cancel.addEventListener("click", closePopup);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const editor = getEditor();
      const markup = videoMarkupFromUrl(input.value);
      if (!editor || !markup) {
        error.textContent = "지원하는 주소가 아닙니다. 주소를 다시 확인해 주세요.";
        error.hidden = false;
        input.focus();
        return;
      }

      if (editor.isMarkdownMode()) editor.insertText(`\n\n${markup}\n\n`);
      else editor.setHTML(`${editor.getHTML()}${markup}`, true);
      product.sections = singleDetailSection(editor.getHTML());
      setDirty(true);
      closePopup();
      showToast("영상을 상세페이지에 추가했습니다. 저장하면 사이트에 반영됩니다.");
    });

    return {
      name: "video",
      tooltip: "영상 삽입",
      text: "영상",
      className: "toastui-editor-toolbar-icons detail-video-toolbar-button",
      style: { backgroundImage: "none" },
      popup: {
        body,
        className: "detail-video-toolbar-popup",
      },
    };
  }

  async function uploadFiles(fileList, productId) {
    const files = [...fileList].slice(0, 30);
    const paths = [];
    if (!files.length) return paths;
    state.uploading += files.length;
    updateSaveState();
    elements.save.disabled = true;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        showToast(`이미지 업로드 중 (${index + 1}/${files.length})`);
        const prepared = await prepareImage(file);
        const data = await api("/api/admin/image", {
          method: "POST",
          headers: {
            "Content-Type": prepared.type,
            "X-Product-Id": productId,
          },
          body: prepared,
        });
        paths.push(data.path);
      } catch (error) {
        showToast(`${file.name}: ${error.message}`, true);
      } finally {
        state.uploading -= 1;
        updateSaveState();
      }
    }
    elements.save.disabled = false;
    if (paths.length) showToast(`${paths.length}장의 이미지를 추가했습니다. 마지막으로 변경사항을 저장해 주세요.`);
    return paths;
  }

  async function prepareImage(file) {
    if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 올릴 수 있습니다.");
    if (file.size <= 2.5 * 1024 * 1024 || file.type === "image/gif") {
      if (file.size > 6 * 1024 * 1024) throw new Error("이미지는 한 장당 6MB 이하여야 합니다.");
      return file;
    }

    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch (_) { throw new Error("이 이미지 형식은 브라우저에서 처리할 수 없습니다."); }
    const scale = Math.min(1, 2000 / bitmap.width, 6000 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", .86));
    if (!blob) throw new Error("이미지 용량을 줄이지 못했습니다.");
    if (blob.size > 6 * 1024 * 1024) throw new Error("압축 후에도 6MB를 넘습니다. 더 작은 이미지를 사용해 주세요.");
    return blob;
  }

  async function saveCatalog(event) {
    event.preventDefault();
    syncToastEditors();
    if (!state.dirty) {
      showToast("이미 저장된 상태입니다.");
      return;
    }
    if (state.uploading) {
      showToast("이미지 업로드가 끝날 때까지 기다려 주세요.", true);
      return;
    }
    const product = currentProduct();
    if (!product?.name.trim()) {
      showToast("제품 이름을 입력해 주세요.", true);
      $("[data-field='name']", elements.productForm).focus();
      return;
    }
    if (product.buyLink && !/^https?:\/\//i.test(product.buyLink)) {
      showToast("구매 링크는 https:// 또는 http://로 시작해야 합니다.", true);
      $("[data-field='buyLink']", elements.productForm).focus();
      return;
    }

    elements.save.disabled = true;
    elements.save.textContent = "저장 중…";
    try {
      const result = await api("/api/admin/catalog", {
        method: "PUT",
        body: JSON.stringify({ catalog: state.catalog, expectedSha: state.sha }),
      });
      state.sha = result.sha;
      setDirty(false);
      showToast("저장했습니다. 보통 1~2분 뒤 사이트에 반영됩니다.");
    } catch (error) {
      showToast(error.message, true);
      if (error.status === 409 && window.confirm("최신 내용을 다시 불러올까요? 현재 저장하지 않은 변경사항은 사라집니다.")) await openAdmin();
    } finally {
      elements.save.disabled = false;
      elements.save.textContent = "변경사항 저장";
    }
  }

  function deleteCurrentProduct() {
    const product = currentProduct();
    if (!product) return;
    if (!window.confirm(`‘${product.name || "이 제품"}’을 삭제할까요?\n저장하기 전까지는 사이트에 반영되지 않습니다.`)) return;
    const index = state.catalog.products.findIndex((item) => item.id === product.id);
    state.catalog.products.splice(index, 1);
    state.currentId = state.catalog.products[index]?.id || state.catalog.products[index - 1]?.id || "";
    setDirty(true);
    renderProductList();
    renderEditor();
    if (!state.currentId) document.body.classList.remove("editor-open");
  }

  function setDirty(value) {
    state.dirty = value;
    updateSaveState();
  }

  function updateSaveState() {
    if (state.uploading) {
      elements.saveState.textContent = `이미지 업로드 중 ${state.uploading}`;
      elements.saveState.classList.add("dirty");
    } else if (state.dirty) {
      elements.saveState.textContent = "저장하지 않은 변경사항";
      elements.saveState.classList.add("dirty");
    } else {
      elements.saveState.textContent = "저장됨";
      elements.saveState.classList.remove("dirty");
    }
  }

  function imageUrl(path) {
    const source = String(path || "");
    if (/^https?:\/\//i.test(source)) return source;
    return `/${source.replace(/^\.?\//, "")}`;
  }

  function escapeEditorText(value) {
    return String(value == null ? "" : value).replace(
      /[&<>]/g,
      (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]
    );
  }

  function escapeEditorAttribute(value) {
    return escapeEditorText(value).replace(/"/g, "&quot;");
  }

  function safeEditorImageUrl(value) {
    const source = String(value || "").trim();
    if (/^(?:https?:\/\/|(?:\.\/|\/)?images\/)/i.test(source)) return source;
    return "";
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

  function videoMarkupFromUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      const host = url.hostname.toLowerCase();
      let youtubeId = "";
      if (host === "youtu.be") youtubeId = url.pathname.split("/").filter(Boolean)[0] || "";
      if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
        youtubeId = url.searchParams.get("v") || (url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1] || "");
      }
      if (/^[A-Za-z0-9_-]{6,20}$/.test(youtubeId)) {
        const source = `https://www.youtube-nocookie.com/embed/${youtubeId}`;
        return `<iframe src="${source}" title="제품 영상" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
      }

      if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
        const vimeoId = url.pathname.match(/(?:video\/)?(\d+)/)?.[1] || "";
        if (vimeoId) {
          const source = `https://player.vimeo.com/video/${vimeoId}`;
          return `<iframe src="${source}" title="제품 영상" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
        }
      }
    } catch (_) {}

    const fileSource = safeVideoFileUrl(value);
    return fileSource ? `<video src="${escapeEditorAttribute(fileSource)}" controls preload="metadata"></video>` : "";
  }

  function videoHtmlRenderer() {
    return {
      htmlBlock: {
        iframe(node) {
          const source = safeVideoEmbedUrl(node.attrs?.src);
          if (!source) return { type: "text", content: "" };
          return [
            {
              type: "openTag",
              tagName: "iframe",
              outerNewLine: true,
              attributes: {
                src: source,
                title: "제품 영상",
                loading: "lazy",
                allow: source.includes("vimeo.com") ? "autoplay; fullscreen; picture-in-picture" : "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
                allowfullscreen: "true",
              },
            },
            { type: "closeTag", tagName: "iframe", outerNewLine: true },
          ];
        },
        video(node) {
          const source = safeVideoFileUrl(node.attrs?.src);
          if (!source) return { type: "text", content: "" };
          return [
            {
              type: "openTag",
              tagName: "video",
              outerNewLine: true,
              attributes: { src: source, controls: "true", preload: "metadata" },
            },
            { type: "closeTag", tagName: "video", outerNewLine: true },
          ];
        },
      },
    };
  }

  function sanitizeEditorHtml(value) {
    const allowed = new Set(["P", "BR", "H2", "H3", "H4", "STRONG", "B", "EM", "I", "S", "UL", "OL", "LI", "BLOCKQUOTE", "A", "IMG", "FIGURE", "FIGCAPTION", "HR", "IFRAME", "VIDEO"]);
    const template = document.createElement("template");
    template.innerHTML = String(value || "");
    function clean(parent) {
      [...parent.childNodes].forEach((node) => {
        if (node.nodeType === Node.COMMENT_NODE) return node.remove();
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (!allowed.has(node.tagName)) {
          node.replaceWith(...node.childNodes);
          clean(parent);
          return;
        }
        const href = node.getAttribute("href") || "";
        const source = node.getAttribute("src") || "";
        const alt = node.getAttribute("alt") || "";
        [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));
        if (node.tagName === "A" && /^https?:\/\//i.test(href)) node.setAttribute("href", href);
        if (node.tagName === "IMG") {
          const safeSource = safeEditorImageUrl(source);
          if (!safeSource) {
            node.remove();
            return;
          }
          node.setAttribute("src", safeSource);
          node.setAttribute("alt", alt);
        }
        if (node.tagName === "IFRAME") {
          const safeSource = safeVideoEmbedUrl(source);
          if (!safeSource) {
            node.remove();
            return;
          }
          node.setAttribute("src", safeSource);
          node.setAttribute("title", "제품 영상");
          node.setAttribute("loading", "lazy");
          node.setAttribute("allow", safeSource.includes("vimeo.com") ? "autoplay; fullscreen; picture-in-picture" : "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
          node.setAttribute("allowfullscreen", "");
        }
        if (node.tagName === "VIDEO") {
          const safeSource = safeVideoFileUrl(source);
          if (!safeSource) {
            node.remove();
            return;
          }
          node.setAttribute("src", safeSource);
          node.setAttribute("controls", "");
          node.setAttribute("preload", "metadata");
        }
        clean(node);
      });
    }
    clean(template.content);
    return template.innerHTML;
  }

  function create(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function showToast(message, isError = false) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("error", isError);
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, isError ? 6000 : 3500);
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (typeof options.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error(data.error || "요청을 처리하지 못했습니다.");
      error.status = response.status;
      throw error;
    }
    return data;
  }
})();

// 제품 정보는 관리자 데이터를 사용하며, 문의 내용은 브라우저 저장소에 남기지 않습니다.
(function () {
  "use strict";

  const form = document.getElementById("inquiry-form");
  if (!form) return;
  const productSelect = document.getElementById("inquiry-product");
  const productHelp = document.getElementById("product-help");
  const message = document.getElementById("inquiry-message");
  const count = document.getElementById("message-length");
  const status = document.getElementById("inquiry-status");
  const submit = document.getElementById("inquiry-submit");
  const selectedProduct = new URLSearchParams(location.search).get("product");
  let available = false;
  let busy = false;
  let lastPayload = "";
  let requestId = "";

  function showStatus(text, state, focus = false) {
    status.textContent = text;
    status.dataset.state = state;
    if (focus) status.focus();
  }

  function unavailable() {
    showStatus("현재 온라인 접수를 이용할 수 없습니다. mt5556@naver.com으로 문의해 주세요.", "error");
  }

  async function prepareForm() {
    const [catalogResult, serviceResult] = await Promise.allSettled([
      ProductCatalog.loadVisibleProducts(),
      fetch("/api/inquiries", { cache: "no-store", signal: AbortSignal.timeout(10000) })
        .then((response) => {
          if (!response.ok) throw new Error("문의 서비스 연결 실패");
          return response.json();
        }),
    ]);

    if (catalogResult.status !== "fulfilled") {
      productSelect.replaceChildren(new Option("제품 목록을 불러오지 못했습니다", ""));
      showStatus("제품 정보를 불러오지 못했습니다. 페이지를 새로고침하거나 mt5556@naver.com으로 문의해 주세요.", "error");
      return;
    }

    productSelect.replaceChildren(new Option("제품 선택 없이 일반·협업 문의", ""));
    catalogResult.value.forEach((product) => productSelect.add(new Option(product.name, product.id)));
    productSelect.disabled = false;
    if (selectedProduct) {
      const product = catalogResult.value.find((item) => item.id === selectedProduct);
      if (product) {
        productSelect.value = product.id;
      } else {
        productHelp.textContent = "이전에 선택한 제품을 찾을 수 없습니다. 다른 제품을 선택하거나 일반 문의를 남겨 주세요.";
      }
    }

    available = serviceResult.status === "fulfilled" && serviceResult.value.available === true;
    submit.disabled = !available;
    if (available) showStatus("", "ready");
    else unavailable();
  }

  message.addEventListener("input", () => { count.textContent = message.value.length.toLocaleString("ko-KR"); });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !available || !form.reportValidity()) return;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      email: String(data.get("email") || "").trim(),
      productId: productSelect.value,
      message: message.value.trim(),
      consent: data.get("consent") === "on",
      website: String(data.get("website") || ""),
    };
    if (!payload.name || !payload.message || !/^[+\d\s().-]+$/.test(payload.phone) || !/^\d{7,15}$/.test(payload.phone.replace(/\D/g, ""))) {
      showStatus("이름과 문의 내용을 입력하고 연락처를 확인해 주세요. 연락처는 국가번호를 포함하여 숫자 7~15자리로 입력할 수 있습니다.", "error", true);
      return;
    }

    // 응답이 끊겨 재시도하더라도 같은 문의가 중복 발송되지 않도록 키를 유지합니다.
    const serialized = JSON.stringify(payload);
    if (serialized !== lastPayload) {
      requestId = crypto.randomUUID();
      lastPayload = serialized;
    }
    busy = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    const fields = [...form.querySelectorAll("input, select, textarea")];
    fields.forEach((field) => { field.disabled = true; });
    submit.textContent = "보내는 중…";
    showStatus("문의 내용을 전송하고 있습니다.", "pending");

    try {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        throw new Error(result.error || "문의 전송을 확인하지 못했습니다. 입력 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.");
      }
      form.reset();
      productSelect.value = payload.productId;
      count.textContent = "0";
      lastPayload = "";
      requestId = "";
      showStatus("문의가 전송되었습니다. 남겨 주신 이메일 또는 연락처로 답변드리겠습니다.", "success", true);
    } catch (error) {
      showStatus(error.name === "TimeoutError" || error.name === "TypeError"
        ? "전송 결과를 확인하지 못했습니다. 입력 내용은 유지됩니다. 잠시 후 같은 내용으로 다시 시도해 주세요."
        : error.message, "error", true);
    } finally {
      busy = false;
      fields.forEach((field) => { field.disabled = false; });
      submit.disabled = false;
      submit.innerHTML = '문의 보내기 <span aria-hidden="true">↗</span>';
      form.removeAttribute("aria-busy");
    }
  });

  prepareForm();
})();

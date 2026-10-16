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
  const deliveryNote = document.getElementById("inquiry-delivery-note");
  const copyButton = document.getElementById("inquiry-copy");
  const copyHelp = document.getElementById("inquiry-copy-help");
  const copyText = document.getElementById("inquiry-copy-text");
  const selectedProduct = new URLSearchParams(location.search).get("product");
  let available = false;
  let ready = false;
  let busy = false;
  let lastPayload = "";
  let requestId = "";

  function showStatus(text, state, focus = false) {
    status.textContent = text;
    status.dataset.state = state;
    if (focus) status.focus();
  }

  function emailDraft(payload) {
    const productName = productSelect.value ? productSelect.selectedOptions[0].textContent : "일반·협업 문의";
    const text = [
      "042 TAILORING 문의하기", "이름: " + payload.name, "연락처: " + payload.phone,
      "이메일: " + payload.email, "문의 제품: " + productName,
      "문의 내용:\n" + payload.message, "개인정보 수집 및 이용 동의: 동의함",
    ].join("\n\n");
    return {
      text,
      url: "mailto:mt5556@naver.com?subject=" + encodeURIComponent("[042 TAILORING] " + productName) +
        "&body=" + encodeURIComponent(text.replace(/\n/g, "\r\n")),
    };
  }

  function readPayload() {
    if (!form.reportValidity()) return null;
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
      return null;
    }
    return payload;
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
      productHelp.textContent = "제품 목록을 불러오지 못했습니다. 문의 내용에 제품명을 함께 적어 주세요.";
    } else {
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
    }

    available = serviceResult.status === "fulfilled" && serviceResult.value?.available === true;
    ready = true;
    submit.disabled = false;
    if (!available) {
      submit.innerHTML = '이메일 앱에서 문의 보내기 <span aria-hidden="true">↗</span>';
      deliveryNote.textContent = "버튼을 누르면 작성한 내용이 이메일 앱에 채워집니다. 이메일 앱에서 ‘보내기’를 눌러 주세요.";
      copyButton.hidden = false;
    }
    showStatus("", "ready");
  }

  message.addEventListener("input", () => { count.textContent = message.value.length.toLocaleString("ko-KR"); });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !ready) return;
    const payload = readPayload();
    if (!payload) return;
    if (!available) {
      // 메일 앱으로 전달한 것은 접수 완료가 아닙니다. 작성 내용을 그대로 유지합니다.
      showStatus("이메일 앱에서 내용을 확인하고 ‘보내기’를 눌러 주세요. 아직 문의가 발송된 것은 아닙니다. 앱이 열리지 않으면 아래 ‘문의 내용 복사’를 이용해 주세요.", "ready", true);
      window.location.href = emailDraft(payload).url;
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

  copyButton.addEventListener("click", async () => {
    const payload = readPayload();
    if (!payload) return;
    const draft = emailDraft(payload);
    try {
      await navigator.clipboard.writeText(draft.text);
      copyHelp.hidden = true;
      showStatus("문의 내용을 복사했습니다. 사용하시는 메일에서 mt5556@naver.com으로 붙여 넣어 보내 주세요. 아직 문의가 발송된 것은 아닙니다.", "ready", true);
    } catch {
      copyHelp.hidden = false;
      copyText.value = draft.text;
      copyText.focus();
      copyText.select();
      showStatus("자동 복사를 사용할 수 없습니다. 아래 내용을 직접 복사해 mt5556@naver.com으로 보내 주세요.", "ready");
    }
  });

  prepareForm();
})();

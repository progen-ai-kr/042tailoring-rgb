// 공개 문의 API. 수신 주소는 서버에서 고정하며, 개인정보는 로그나 저장소에 기록하지 않습니다.
const RECIPIENT = "mt5556@naver.com";
const MAX_BODY_BYTES = 20 * 1024;
const UNAVAILABLE = "현재 온라인 접수를 이용할 수 없습니다. mt5556@naver.com으로 문의해 주세요.";

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });
}

function configured(env) {
  return Boolean(env.RESEND_API_KEY && env.INQUIRY_FROM && env.INQUIRY_RATE_LIMITER);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function readBody(request) {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const limits = { name: 80, phone: 30, email: 254, productId: 200, message: 3000, requestId: 36 };
  const data = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof body[key] !== "string" || body[key].length > limit) return null;
    data[key] = body[key].trim();
    if (key !== "productId" && !data[key]) return null;
    if (key !== "message" && /[\x00-\x1f\x7f]/.test(body[key])) return null;
  }
  if (body.consent !== true || (body.website != null && body.website !== "")) return null;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(data.email)) return null;
  if (!/^[+\d\s().-]+$/.test(data.phone) || !/^\d{7,15}$/.test(data.phone.replace(/\D/g, ""))) return null;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.requestId)) return null;
  return data;
}

function emailContent(data, productName) {
  const fields = [
    ["이름", data.name], ["연락처", data.phone], ["이메일", data.email],
    ["문의 제품", productName], ["문의 내용", data.message], ["개인정보 수집 및 이용 동의", "동의함"],
  ];
  return {
    subject: `[042 TAILORING] ${productName} 문의`,
    text: "042 TAILORING 문의하기\n\n" + fields.map(([label, value]) => `${label}\n${value}`).join("\n\n"),
    html: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head>' +
      '<body style="margin:0;padding:24px;background:#f4f4f1;color:#151515;font-family:Arial,sans-serif">' +
      '<div style="max-width:640px;margin:auto"><h1 style="font-size:24px">042 TAILORING · 문의하기</h1>' +
      '<table style="width:100%;border-collapse:collapse;background:#fff">' +
      fields.map(([label, value]) => '<tr><th scope="row" style="width:110px;text-align:left;vertical-align:top;padding:16px;border-bottom:1px solid #ddd;font-size:14px">' +
        escapeHtml(label) + '</th><td style="padding:16px;border-bottom:1px solid #ddd;font-size:14px;line-height:1.7;overflow-wrap:anywhere">' +
        escapeHtml(value).replace(/\r?\n/g, "<br>") + "</td></tr>").join("") +
      '</table><p style="font-size:12px;color:#555">이 메일에 답장하면 문의자가 입력한 이메일로 연결됩니다.</p></div></body></html>',
  };
}

export async function handleInquiry(request, env) {
  if (request.method === "GET") return json({ available: configured(env) });
  if (request.method !== "POST") return json({ error: "허용되지 않은 요청입니다." }, 405, { Allow: "GET, POST" });
  const url = new URL(request.url);
  if (request.headers.get("Origin") !== url.origin) return json({ error: "허용되지 않은 요청입니다." }, 403);
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
    return json({ error: "JSON 형식으로 요청해 주세요." }, 415);
  }

  try {
    const raw = await readBody(request);
    if (raw === null) return json({ error: "문의 내용이 너무 깁니다." }, 413);
    let body;
    try { body = JSON.parse(raw); }
    catch { return json({ error: "문의 형식이 올바르지 않습니다." }, 400); }
    const data = validate(body);
    if (!data) return json({ error: "이름·연락처·이메일·문의 내용과 개인정보 수집 동의를 확인해 주세요." }, 400);
    if (!configured(env)) return json({ error: UNAVAILABLE }, 503);

    // 동일 접속에서 짧은 시간에 반복 발송하는 것을 제한합니다.
    const limit = await env.INQUIRY_RATE_LIMITER.limit({ key: `inquiry:${request.headers.get("CF-Connecting-IP") || "local"}` });
    if (!limit.success) return json({ error: "문의 요청이 많습니다. 1분 후 다시 시도해 주세요." }, 429, { "Retry-After": "60" });

    let productName = "일반·협업 문의";
    if (data.productId) {
      // 방문자가 보낸 제품명 대신 현재 공개 제품의 이름을 사용합니다.
      const response = await env.ASSETS.fetch(new Request(new URL("/products.json", url)));
      if (!response.ok) return json({ error: "제품 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 503);
      const catalog = await response.json();
      const product = Array.isArray(catalog.products) && catalog.products.find((item) => item && item.id === data.productId && item.published !== false);
      if (!product || typeof product.name !== "string" || /[\r\n]/.test(product.name)) {
        return json({ error: "선택한 제품을 찾을 수 없습니다. 페이지를 새로고침한 뒤 다시 선택해 주세요." }, 400);
      }
      productName = product.name;
    }

    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `042-inquiry/${data.requestId}`,
      },
      body: JSON.stringify({
        from: env.INQUIRY_FROM,
        to: [RECIPIENT],
        reply_to: data.email,
        ...emailContent(data, productName),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const receipt = await result.json().catch(() => ({}));
    if (!result.ok || !receipt.id) {
      return json({ error: "문의 메일을 전송하지 못했습니다. 입력 내용은 유지됩니다. 잠시 후 다시 시도해 주세요." }, 502);
    }
    return json({ ok: true });
  } catch {
    // 메일 제공자의 오류 응답이나 개인정보를 공개 응답/로그에 포함하지 않습니다.
    return json({ error: "전송 결과를 확인하지 못했습니다. 입력 내용은 유지됩니다. 잠시 후 같은 내용으로 다시 시도해 주세요." }, 502);
  }
}

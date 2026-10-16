import assert from "node:assert/strict";
import { test, afterEach, mock } from "node:test";
import { readFileSync } from "node:fs";
import worker from "../worker.js";

const origin = "https://042tailoring-rgb.progen-web.workers.dev";
const catalog = JSON.parse(readFileSync(new URL("../products.json", import.meta.url)));
const valid = {
  name: "문의 테스트", phone: "010-1234-5678", email: "customer@example.com",
  productId: catalog.products[0].id, message: "사이즈 문의입니다.\n상세 치수를 알려주세요.",
  consent: true, website: "", requestId: "419f086b-698f-47da-b958-82425d63fec3",
};
const env = () => ({
  ADMIN_ENABLED: "false",
  RESEND_API_KEY: "test-key-not-real", INQUIRY_FROM: "042 TAILORING <test@example.com>",
  INQUIRY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  ASSETS: { fetch: async (request) => new URL(request.url).pathname === "/products.json"
    ? Response.json(catalog) : new Response("static page") },
});
function request(body = valid, options = {}) {
  return new Request(origin + "/api/inquiries", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
    body: JSON.stringify(body), ...options,
  });
}
afterEach(() => mock.restoreAll());

test("availability is false without mail credentials and true when configured", async () => {
  for (const [bindings, available] of [[{}, false], [env(), true]]) {
    const response = await worker.fetch(new Request(origin + "/api/inquiries"), bindings);
    assert.deepEqual(await response.json(), { available });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("sends every field to the fixed recipient with safe HTML and a reply address", async () => {
  let sent;
  mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    sent = JSON.parse(options.body);
    assert.equal(options.headers["Idempotency-Key"], "042-inquiry/" + valid.requestId);
    return Response.json({ id: "mail-test-id" });
  });
  const body = { ...valid, name: '<img src=x onerror="alert(1)">', message: "첫째 줄\n<script>alert(1)</script> & 문의", to: ["attacker@example.com"] };
  const response = await worker.fetch(request(body), env());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(sent.to, ["mt5556@naver.com"]);
  assert.equal(sent.reply_to, body.email);
  for (const value of [body.name, body.phone, body.email, body.message, catalog.products[0].name, "동의함"]) assert.ok(sent.text.includes(value));
  assert.ok(sent.html.includes("&lt;script&gt;"));
  assert.ok(sent.html.includes("첫째 줄<br>"));
  assert.ok(!sent.html.includes("<script>"));
  assert.ok(!sent.html.includes("<img"));
});

test("general inquiries can omit a selected product", async () => {
  mock.method(globalThis, "fetch", async (_, options) => {
    assert.ok(JSON.parse(options.body).text.includes("일반·협업 문의"));
    return Response.json({ id: "general-mail" });
  });
  assert.equal((await worker.fetch(request({ ...valid, productId: "" }), env())).status, 200);
});

test("invalid required fields, lengths, headers and bot submissions never send mail", async () => {
  const sender = mock.method(globalThis, "fetch", () => { throw new Error("must not send"); });
  const invalid = [
    { name: " " }, { name: "a".repeat(81) }, { phone: "abc123" }, { phone: "1".repeat(16) },
    { email: "invalid" }, { email: "x@example.com\r\nBcc: other@example.com" },
    { message: " " }, { message: "가".repeat(3001) }, { consent: false }, { consent: "true" },
    { website: "spam.example.com" }, { productId: {} }, { requestId: "invalid" },
  ];
  for (const change of invalid) assert.equal((await worker.fetch(request({ ...valid, ...change }), env())).status, 400, JSON.stringify(change).slice(0, 100));
  assert.equal((await worker.fetch(request(null), env())).status, 400);
  assert.equal((await worker.fetch(request([], {}), env())).status, 400);
  assert.equal(sender.mock.callCount(), 0);
});

test("rejects invalid JSON, large bodies, cross-origin, missing origin and wrong method/type", async () => {
  assert.equal((await worker.fetch(request(valid, { body: "{" }), env())).status, 400);
  assert.equal((await worker.fetch(request(valid, { body: "x".repeat(21000) }), env())).status, 413);
  for (const headers of [
    { Origin: "https://other.example", "Content-Type": "application/json" },
    { "Content-Type": "application/json" },
  ]) assert.equal((await worker.fetch(request(valid, { headers }), env())).status, 403);
  assert.equal((await worker.fetch(request(valid, { headers: { Origin: origin, "Content-Type": "text/plain" } }), env())).status, 415);
  const response = await worker.fetch(new Request(origin + "/api/inquiries", { method: "DELETE" }), env());
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, POST");
});

test("unknown and unpublished products are rejected before sending", async () => {
  const sender = mock.method(globalThis, "fetch", () => { throw new Error("must not send"); });
  assert.equal((await worker.fetch(request({ ...valid, productId: "deleted" }), env())).status, 400);
  const bindings = env();
  bindings.ASSETS.fetch = async () => Response.json({ products: [{ ...catalog.products[0], published: false }] });
  assert.equal((await worker.fetch(request(), bindings)).status, 400);
  bindings.ASSETS.fetch = async () => new Response("unavailable", { status: 503 });
  assert.equal((await worker.fetch(request(), bindings)).status, 503);
  assert.equal(sender.mock.callCount(), 0);
});

test("unconfigured service and throttled requests do not send", async () => {
  const sender = mock.method(globalThis, "fetch", () => { throw new Error("must not send"); });
  assert.equal((await worker.fetch(request(), {})).status, 503);
  const bindings = env();
  bindings.INQUIRY_RATE_LIMITER.limit = async () => ({ success: false });
  const response = await worker.fetch(request(), bindings);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(sender.mock.callCount(), 0);
});

test("provider errors, missing receipts and network errors cannot produce success", async () => {
  const sender = mock.method(globalThis, "fetch");
  for (const result of [Response.json({ error: "private provider detail" }, { status: 403 }), Response.json({}), new Response("bad gateway", { status: 502 })]) {
    sender.mock.mockImplementation(async () => result);
    const response = await worker.fetch(request(), env());
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes("private provider detail"));
  }
  sender.mock.mockImplementation(async () => { throw new Error("network failure"); });
  assert.equal((await worker.fetch(request(), env())).status, 502);
});

test("retries reuse the provider idempotency key", async () => {
  const keys = [];
  mock.method(globalThis, "fetch", async (_, options) => {
    keys.push(options.headers["Idempotency-Key"]);
    return Response.json({ id: "same-mail-id" });
  });
  await worker.fetch(request(), env());
  await worker.fetch(request(), env());
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("static pages and disabled admin API keep their existing routes", async () => {
  assert.equal(await (await worker.fetch(new Request(origin + "/contact.html"), env())).text(), "static page");
  assert.equal((await worker.fetch(new Request(origin + "/api/admin/session"), env())).status, 403);
  assert.equal((await worker.fetch(new Request(origin + "/api/inquiries"), { ...env(), ADMIN_STANDALONE: "true" })).status, 404);
});

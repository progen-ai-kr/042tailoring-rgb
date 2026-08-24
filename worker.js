// 브랜드 관리자 API입니다. 비밀번호 원문은 저장하지 않고, 비공개 Git 설정에는 해시만 보관합니다.
const SESSION_COOKIE = "brand_admin_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_CATALOG_BYTES = 900 * 1024;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map();
let adminConfigCache = null;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/admin/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      return await handleAdminApi(request, env, url);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error("Admin API error", error);
      return json({ error: "관리 기능을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 500);
    }
  },
};

async function handleAdminApi(request, env, url) {
  if (env.ADMIN_ENABLED === "false") {
    return json({
      error: "이 사이트의 제품 관리는 대표 관리자 페이지에서 진행해 주세요.",
      adminUrl: env.ADMIN_URL || "",
    }, 403);
  }

  if (request.method !== "GET" && !isSameOrigin(request, url)) {
    return json({ error: "허용되지 않은 요청입니다." }, 403);
  }

  const path = url.pathname;

  if (path === "/api/admin/session" && request.method === "GET") {
    const session = await getValidSession(request, env);
    return json({ authenticated: Boolean(session) });
  }

  if (path === "/api/admin/login" && request.method === "POST") {
    return login(request, env);
  }

  if (path === "/api/admin/logout" && request.method === "POST") {
    return json({ ok: true }, 200, {
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    });
  }

  const session = await getValidSession(request, env);
  if (!session) {
    return json({ error: "로그인이 필요합니다." }, 401);
  }

  if (path === "/api/admin/password" && request.method === "POST") {
    return changePassword(request, env, session.configFile);
  }

  if (path === "/api/admin/catalog" && request.method === "GET") {
    const file = await readGitHubFile(env, "products.json", primaryRepository(env));
    let catalog;
    try {
      catalog = JSON.parse(file.text);
    } catch (_) {
      return json({ error: "제품 데이터 형식이 올바르지 않습니다." }, 502);
    }
    return json({ catalog, sha: file.sha });
  }

  if (path === "/api/admin/catalog" && request.method === "PUT") {
    const body = await readJson(request);
    const normalized = normalizeCatalog(body.catalog);
    const repositories = githubRepositories(env);
    const currentFiles = await Promise.all(
      repositories.map(async (repository) => ({
        repository,
        file: await readGitHubFile(env, "products.json", repository),
      }))
    );
    const current = currentFiles[0].file;

    if (!body.expectedSha || body.expectedSha !== current.sha) {
      return json({ error: "다른 곳에서 먼저 수정되었습니다. 새로고침한 뒤 다시 저장해 주세요." }, 409);
    }

    const content = `${JSON.stringify(normalized, null, 2)}\n`;
    if (new TextEncoder().encode(content).byteLength > MAX_CATALOG_BYTES) {
      return json({ error: "제품 데이터가 너무 큽니다. 상세 글이나 제품 수를 줄여 주세요." }, 413);
    }

    // 복제 사이트를 먼저 갱신하고 대표 사이트를 마지막에 저장해 대표 관리 화면의 SHA를 기준으로 유지합니다.
    const replicaResults = [];
    for (const target of currentFiles.slice(1)) {
      replicaResults.push(await writeGitHubFile(
        env,
        "products.json",
        content,
        target.file.sha,
        "브랜드 제품 정보 동기화",
        target.repository
      ));
    }
    const result = await writeGitHubFile(
      env,
      "products.json",
      content,
      current.sha,
      "브랜드 제품 정보 수정",
      currentFiles[0].repository
    );
    return json({
      ok: true,
      sha: result.content.sha,
      commitUrl: result.commit.html_url,
      repositories,
      replicaCommits: replicaResults.map((item) => item.commit.html_url),
    });
  }

  if (path === "/api/admin/image" && request.method === "POST") {
    return uploadImage(request, env);
  }

  return json({ error: "찾을 수 없는 관리 기능입니다." }, 404);
}

async function login(request, env) {
  if (!env.SESSION_SECRET) {
    return json({ error: "관리자 비밀번호 설정이 아직 완료되지 않았습니다." }, 503);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const record = loginAttempts.get(ip);
  const activeRecord = record && now - record.startedAt < LOGIN_WINDOW_MS
    ? record
    : { count: 0, startedAt: now };

  if (activeRecord.count >= LOGIN_MAX_ATTEMPTS) {
    return json({ error: "로그인 시도가 너무 많습니다. 10분 뒤 다시 시도해 주세요." }, 429);
  }

  const body = await readJson(request);
  const password = typeof body.password === "string" ? body.password : "";
  const configFile = await getAdminConfig(env);
  if (!(await verifyPassword(password, configFile.config))) {
    activeRecord.count += 1;
    loginAttempts.set(ip, activeRecord);
    return json({ error: "비밀번호가 올바르지 않습니다." }, 401);
  }

  loginAttempts.delete(ip);
  const token = await createSessionToken(env.SESSION_SECRET, configFile.config.sessionVersion);
  return json({ ok: true }, 200, {
    "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
  });
}

async function changePassword(request, env, configFile) {
  const body = await readJson(request);
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  // 변경 직전에 최신 설정을 다시 읽어 동시 변경과 오래된 비밀번호 사용을 막습니다.
  const latest = await getAdminConfig(env, true);
  if (latest.sha !== configFile.sha || !(await verifyPassword(currentPassword, latest.config))) {
    return json({ error: "현재 비밀번호가 올바르지 않습니다." }, 401);
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    return json({ error: "새 비밀번호는 8자 이상 128자 이하로 입력해 주세요." }, 400);
  }
  if (currentPassword === newPassword) {
    return json({ error: "현재 비밀번호와 다른 비밀번호를 입력해 주세요." }, 400);
  }

  const credential = await createPasswordCredential(newPassword);
  const nextConfig = {
    version: 1,
    algorithm: "PBKDF2-SHA256",
    iterations: credential.iterations,
    salt: credential.salt,
    hash: credential.hash,
    sessionVersion: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
  };
  const content = `${JSON.stringify(nextConfig, null, 2)}\n`;
  const result = await writeGitHubFile(env, "admin-config.json", content, latest.sha, "브랜드 관리자 비밀번호 변경");
  adminConfigCache = { config: nextConfig, sha: result.content.sha, expiresAt: Date.now() + 30_000 };
  const token = await createSessionToken(env.SESSION_SECRET, nextConfig.sessionVersion);
  return json({ ok: true }, 200, {
    "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
  });
}

async function uploadImage(request, env) {
  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].toLowerCase();
  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
  };

  if (!extensions[contentType]) {
    return json({ error: "JPG, PNG, WebP, GIF, AVIF 이미지만 올릴 수 있습니다." }, 415);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
    return json({ error: "이미지는 한 장당 6MB 이하여야 합니다." }, 413);
  }

  const productId = (request.headers.get("X-Product-Id") || "common")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 64) || "common";
  const unique = crypto.randomUUID().slice(0, 8);
  const path = `images/products/${productId}/${Date.now()}-${unique}.${extensions[contentType]}`;
  const repositories = githubRepositories(env);
  for (const repository of repositories.slice(1)) {
    await writeGitHubBytes(env, path, bytes, `제품 이미지 동기화: ${productId}`, repository);
  }
  await writeGitHubBytes(env, path, bytes, `제품 이미지 추가: ${productId}`, repositories[0]);
  return json({ ok: true, path });
}

function normalizeCatalog(value) {
  if (!value || !Array.isArray(value.products) || value.products.length > 500) {
    throw new HttpError(400, "제품 데이터가 올바르지 않습니다.");
  }

  return {
    _설명: "브랜드 담당자가 사이트 관리자에서 제품과 상세페이지를 관리합니다. 학생은 이 파일을 직접 수정하지 않습니다.",
    products: value.products.map(normalizeProduct),
  };
}

function normalizeProduct(product) {
  if (!product || typeof product !== "object") throw new HttpError(400, "제품 정보가 올바르지 않습니다.");
  const id = cleanText(product.id, 80);
  const name = cleanText(product.name, 160);
  if (!/^[a-zA-Z0-9-]+$/.test(id) || !name) throw new HttpError(400, "모든 제품에는 제품 이름과 올바른 ID가 필요합니다.");

  const buyLink = cleanText(product.buyLink, 2000);
  if (buyLink && !/^https?:\/\//i.test(buyLink)) {
    throw new HttpError(400, `‘${name}’의 구매 링크는 http:// 또는 https://로 시작해야 합니다.`);
  }

  return {
    id,
    published: product.published !== false,
    featured: product.featured === true,
    label: cleanText(product.label, 100),
    name,
    summary: cleanText(product.summary, 1000),
    category: cleanText(product.category, 160),
    price: cleanText(product.price, 160),
    keywords: cleanStringList(product.keywords, 30, 100),
    images: cleanImageList(product.images, 30),
    buyLabel: cleanText(product.buyLabel, 100),
    buyLink,
    sections: Array.isArray(product.sections) ? product.sections.slice(0, 100).map(normalizeSection) : [],
  };
}

function normalizeSection(section) {
  const type = cleanText(section && section.type, 30);
  if (type === "rich_text") {
    return { type, body: cleanText(section.body, 250000) };
  }
  if (type === "full_image") {
    return {
      type,
      image: cleanImage(section.image),
      alt: cleanText(section.alt, 300),
      caption: cleanText(section.caption, 1000),
    };
  }
  if (type === "image_text") {
    return {
      type,
      image: cleanImage(section.image),
      imagePosition: section.imagePosition === "right" ? "right" : "left",
      heading: cleanText(section.heading, 300),
      body: cleanText(section.body, 250000),
    };
  }
  if (type === "gallery") {
    return {
      type,
      images: cleanImageList(section.images, 30),
      columns: ["1", "2", "3"].includes(String(section.columns)) ? String(section.columns) : "2",
    };
  }
  if (type === "highlight") {
    return {
      type,
      heading: cleanText(section.heading, 300),
      body: cleanText(section.body, 250000),
    };
  }
  throw new HttpError(400, "지원하지 않는 상세페이지 블록이 포함되어 있습니다.");
}

function cleanText(value, maxLength) {
  return String(value == null ? "" : value).slice(0, maxLength);
}

function cleanStringList(value, maxItems, maxLength) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => cleanText(item, maxLength)).filter(Boolean) : [];
}

function cleanImage(value) {
  const source = cleanText(value, 2000).trim();
  if (!source) return "";
  if (/^(?:\.\/|\/)?images\/[a-z0-9_./%+~-]+$/i.test(source)) return source.replace(/^\.\//, "");
  if (/^https?:\/\//i.test(source)) return source;
  throw new HttpError(400, "올바르지 않은 이미지 주소가 포함되어 있습니다.");
}

function cleanImageList(value, maxItems) {
  return Array.isArray(value) ? value.slice(0, maxItems).map(cleanImage).filter(Boolean) : [];
}

async function readGitHubFile(env, path, repository = primaryRepository(env)) {
  ensureGitHubConfig(env);
  const response = await fetch(gitHubContentsUrl(env, path, true, repository), { headers: gitHubHeaders(env) });
  if (!response.ok) throw await gitHubError(response);
  const data = await response.json();
  return { sha: data.sha, text: decodeBase64(data.content.replace(/\n/g, "")) };
}

async function writeGitHubFile(env, path, content, sha, message, repository = primaryRepository(env)) {
  ensureGitHubConfig(env);
  const response = await fetch(gitHubContentsUrl(env, path, false, repository), {
    method: "PUT",
    headers: gitHubHeaders(env),
    body: JSON.stringify({ message, content: encodeBase64(new TextEncoder().encode(content)), sha, branch: env.GITHUB_BRANCH || "main" }),
  });
  if (!response.ok) throw await gitHubError(response);
  return response.json();
}

async function writeGitHubBytes(env, path, bytes, message, repository = primaryRepository(env)) {
  ensureGitHubConfig(env);
  const response = await fetch(gitHubContentsUrl(env, path, false, repository), {
    method: "PUT",
    headers: gitHubHeaders(env),
    body: JSON.stringify({ message, content: encodeBase64(bytes), branch: env.GITHUB_BRANCH || "main" }),
  });
  if (!response.ok) throw await gitHubError(response);
  return response.json();
}

function githubRepositories(env) {
  const configured = String(env.GITHUB_REPOS || env.GITHUB_REPO || "")
    .split(",")
    .map((repository) => repository.trim())
    .filter((repository) => /^[a-zA-Z0-9._-]+$/.test(repository));
  return [...new Set(configured)].slice(0, 3);
}

function primaryRepository(env) {
  return githubRepositories(env)[0] || "";
}

function gitHubContentsUrl(env, path, includeRef = true, repository = primaryRepository(env)) {
  const safePath = path.split("/").map(encodeURIComponent).join("/");
  const base = `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(repository)}/contents/${safePath}`;
  return includeRef ? `${base}?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}` : base;
}

function gitHubHeaders(env) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "brand-catalog-admin",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function ensureGitHubConfig(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !githubRepositories(env).length) {
    throw new HttpError(503, "GitHub 저장 설정이 아직 완료되지 않았습니다.");
  }
}

async function gitHubError(response) {
  let detail = "";
  try {
    const body = await response.json();
    detail = body.message || "";
  } catch (_) {}
  console.error("GitHub API", response.status, detail);
  if (response.status === 401 || response.status === 403) return new HttpError(503, "저장 권한을 확인해 주세요.");
  if (response.status === 409 || response.status === 422) return new HttpError(409, "저장 중 충돌이 발생했습니다. 새로고침 후 다시 시도해 주세요.");
  return new HttpError(502, "GitHub에 내용을 저장하지 못했습니다.");
}

async function getAdminConfig(env, force = false) {
  if (!force && adminConfigCache && adminConfigCache.expiresAt > Date.now()) return adminConfigCache;
  const file = await readGitHubFile(env, "admin-config.json");
  let config;
  try {
    config = JSON.parse(file.text);
  } catch (_) {
    throw new HttpError(503, "관리자 비밀번호 설정 파일이 올바르지 않습니다.");
  }
  if (
    config.algorithm !== "PBKDF2-SHA256" ||
    !Number.isInteger(config.iterations) ||
    config.iterations < 100000 ||
    !config.salt ||
    !config.hash ||
    !config.sessionVersion
  ) {
    throw new HttpError(503, "관리자 비밀번호 설정을 확인해 주세요.");
  }
  adminConfigCache = { config, sha: file.sha, expiresAt: Date.now() + 30_000 };
  return adminConfigCache;
}

async function verifyPassword(password, config) {
  if (!password || password.length > 128) return false;
  const derived = await derivePasswordHash(password, config.salt, config.iterations);
  return constantTimeEqual(derived, config.hash);
}

async function createPasswordCredential(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(24));
  const salt = encodeBase64(saltBytes);
  // Cloudflare Workers Web Crypto가 지원하는 PBKDF2 반복 횟수 상한입니다.
  const iterations = 100000;
  const hash = await derivePasswordHash(password, salt, iterations);
  return { salt, iterations, hash };
}

async function derivePasswordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: decodeBase64Bytes(salt), iterations },
    key,
    256
  );
  return encodeBase64(new Uint8Array(bits));
}

async function createSessionToken(secret, sessionVersion) {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    nonce: crypto.randomUUID(),
    ver: sessionVersion,
  })));
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

async function getValidSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const token = readCookie(request.headers.get("Cookie") || "", SESSION_COOKIE);
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = await sign(payload, env.SESSION_SECRET);
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const data = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    if (!Number.isFinite(data.exp) || data.exp <= Math.floor(Date.now() / 1000) || !data.ver) return null;
    const configFile = await getAdminConfig(env);
    if (!constantTimeEqual(data.ver, configFile.config.sessionVersion)) return null;
    return { data, config: configFile.config, configFile };
  } catch (_) {
    return null;
  }
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return encodeBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let different = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) different |= (a[index] || 0) ^ (b[index] || 0);
  return different === 0;
}

function readCookie(header, name) {
  const prefix = `${name}=`;
  for (const part of header.split(";")) {
    const item = part.trim();
    if (item.startsWith(prefix)) return item.slice(prefix.length);
  }
  return "";
}

function isSameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  return origin === url.origin;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (_) {
    throw new HttpError(400, "요청 형식이 올바르지 않습니다.");
  }
}

function encodeBase64(bytes) {
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  return new TextDecoder().decode(decodeBase64Bytes(value));
}

function decodeBase64Bytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(bytes) {
  return encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

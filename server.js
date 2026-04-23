const http = require("http");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const APP_BASE_URL = requiredEnv("APP_BASE_URL");
const SESSION_SECRET = requiredEnv("SESSION_SECRET");

const AUTH_MODE = process.env.AUTH_MODE || "trusted_headers";
const AUTH_LOGIN_URL = process.env.AUTH_LOGIN_URL || "";
const AUTH_EXCHANGE_URL = process.env.AUTH_EXCHANGE_URL || "";
const AUTH_EXCHANGE_TOKEN = process.env.AUTH_EXCHANGE_TOKEN || "";
const AUTH_EXCHANGE_TIMEOUT_MS = Number(
  process.env.AUTH_EXCHANGE_TIMEOUT_MS || 5000,
);

const XRXS_COOKIE_NAME = process.env.XRXS_COOKIE_NAME || "xrxs_sso_session";
const COOKIE_SECURE = boolEnv("COOKIE_SECURE", true);
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || "";
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 3600);

const XRXS_APP_KEY = requiredEnv("XRXS_APP_KEY");
const XRXS_APP_SECRET = requiredEnv("XRXS_APP_SECRET");
const XRXS_TOKEN_URL =
  process.env.XRXS_TOKEN_URL ||
  "https://api.xinrenxinshi.com/authorize/oauth/token";
const XRXS_EMPLOYEE_ID_URL =
  process.env.XRXS_EMPLOYEE_ID_URL ||
  "https://api.xinrenxinshi.com/v5/employee/getId";
const XRXS_FREE_LOGIN_URL =
  process.env.XRXS_FREE_LOGIN_URL ||
  "https://api.xinrenxinshi.com/v5/login/geturl";
const XRXS_API_TIMEOUT_MS = Number(process.env.XRXS_API_TIMEOUT_MS || 8000);

const XRXS_EMPLOYEE_LOOKUP_TYPE =
  process.env.XRXS_EMPLOYEE_LOOKUP_TYPE || "auto";
const XRXS_EMPLOYEE_STATUS = Number(process.env.XRXS_EMPLOYEE_STATUS || 0);
const XRXS_REDIRECT_TYPE = Number(process.env.XRXS_REDIRECT_TYPE || 0);
const XRXS_USER_TYPE = Number(process.env.XRXS_USER_TYPE || 0);
const XRXS_REDIRECT_URL_TYPE = readOptionalInt(process.env.XRXS_REDIRECT_URL_TYPE);
const XRXS_REDIRECT_PARAM_JSON = process.env.XRXS_REDIRECT_PARAM_JSON || "";

const REMOTE_USER_HEADER = (
  process.env.REMOTE_USER_HEADER || "remote-user"
).toLowerCase();
const REMOTE_EMAIL_HEADER = (
  process.env.REMOTE_EMAIL_HEADER || "remote-email"
).toLowerCase();
const REMOTE_NAME_HEADER = (
  process.env.REMOTE_NAME_HEADER || "remote-name"
).toLowerCase();
const REMOTE_EMPLOYEE_ID_HEADER = (
  process.env.REMOTE_EMPLOYEE_ID_HEADER || "remote-employee-id"
).toLowerCase();
const REMOTE_MOBILE_HEADER = (
  process.env.REMOTE_MOBILE_HEADER || "remote-mobile"
).toLowerCase();
const REMOTE_JOB_NUMBER_HEADER = (
  process.env.REMOTE_JOB_NUMBER_HEADER || "remote-job-number"
).toLowerCase();

const REDIRECT_TYPE_NAMES = {
  0: "pc",
  1: "h5",
};

const USER_TYPE_NAMES = {
  0: "employee",
  1: "admin",
  2: "admin_first",
};

let tokenCache = {
  accessToken: "",
  expiresAt: 0,
};

validateConfig();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function boolEnv(name, defaultValue) {
  const value = process.env[name];
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readOptionalInt(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected integer value, got: ${value}`);
  }
  return parsed;
}

function validateConfig() {
  const authModes = new Set(["trusted_headers", "exchange_code"]);
  if (!authModes.has(AUTH_MODE)) {
    throw new Error(
      `Invalid AUTH_MODE: ${AUTH_MODE}. Expected trusted_headers or exchange_code`,
    );
  }

  if (AUTH_MODE === "exchange_code") {
    if (!AUTH_LOGIN_URL) {
      throw new Error("AUTH_LOGIN_URL is required when AUTH_MODE=exchange_code");
    }
    if (!AUTH_EXCHANGE_URL) {
      throw new Error("AUTH_EXCHANGE_URL is required when AUTH_MODE=exchange_code");
    }
  }

  const lookupTypes = new Set(["auto", "employee_id", "email", "mobile", "job_number"]);
  if (!lookupTypes.has(XRXS_EMPLOYEE_LOOKUP_TYPE)) {
    throw new Error(
      `Invalid XRXS_EMPLOYEE_LOOKUP_TYPE: ${XRXS_EMPLOYEE_LOOKUP_TYPE}`,
    );
  }

  if (!Object.hasOwn(REDIRECT_TYPE_NAMES, XRXS_REDIRECT_TYPE)) {
    throw new Error(`Invalid XRXS_REDIRECT_TYPE: ${XRXS_REDIRECT_TYPE}`);
  }

  if (!Object.hasOwn(USER_TYPE_NAMES, XRXS_USER_TYPE)) {
    throw new Error(`Invalid XRXS_USER_TYPE: ${XRXS_USER_TYPE}`);
  }

  if (
    XRXS_REDIRECT_PARAM_JSON &&
    (XRXS_REDIRECT_URL_TYPE == null || Number.isNaN(XRXS_REDIRECT_URL_TYPE))
  ) {
    throw new Error(
      "XRXS_REDIRECT_URL_TYPE must be set when XRXS_REDIRECT_PARAM_JSON is provided",
    );
  }

  if (XRXS_REDIRECT_PARAM_JSON) {
    const parsed = JSON.parse(XRXS_REDIRECT_PARAM_JSON);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("XRXS_REDIRECT_PARAM_JSON must be a JSON object");
    }
  }
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
}

function badRequest(res, message) {
  json(res, 400, { error: message });
}

function serverError(res, message, details) {
  const payload = { error: message };
  if (details) payload.details = details;
  json(res, 500, payload);
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = {};

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

function signValue(value) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("base64url");
}

function createSessionCookie(user) {
  const payload = {
    email: user.email || "",
    userId: user.userId || "",
    name: user.name || "",
    employeeId: user.employeeId || "",
    mobile: user.mobile || "",
    jobNumber: user.jobNumber || "",
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signValue(encodedPayload);
  const cookieValue = `${encodedPayload}.${signature}`;
  return serializeCookie(XRXS_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    domain: COOKIE_DOMAIN || undefined,
  });
}

function clearSessionCookie() {
  return serializeCookie(XRXS_COOKIE_NAME, "", {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "Lax",
    path: "/",
    expires: new Date(0),
    domain: COOKIE_DOMAIN || undefined,
  });
}

function readSession(req) {
  const cookies = parseCookies(req);
  const raw = cookies[XRXS_COOKIE_NAME];
  if (!raw) return null;

  const [encodedPayload, providedSignature] = raw.split(".");
  if (!encodedPayload || !providedSignature) return null;

  const expectedSignature = signValue(encodedPayload);
  const signatureBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8"),
    );
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function getSingleHeader(req, headerName) {
  const value = req.headers[headerName];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "").trim();
}

function decodePossiblyMojibakeHeader(value) {
  if (!value) return "";

  // Node exposes header values as latin1 strings; when upstream sends UTF-8 bytes
  // directly in headers, Chinese text can appear as mojibake (e.g. "å¼ ä¸‰").
  const recovered = Buffer.from(value, "latin1").toString("utf8");
  if (recovered.includes("\uFFFD")) return value;

  const looksLikeMojibake = /[ÃÂÅÆÐÑØÞà-ÿ]/.test(value);
  return looksLikeMojibake ? recovered : value;
}

function getTrustedHeaderUser(req) {
  const user = {
    userId: decodePossiblyMojibakeHeader(getSingleHeader(req, REMOTE_USER_HEADER)),
    email: decodePossiblyMojibakeHeader(getSingleHeader(req, REMOTE_EMAIL_HEADER)),
    name: decodePossiblyMojibakeHeader(getSingleHeader(req, REMOTE_NAME_HEADER)),
    employeeId: decodePossiblyMojibakeHeader(
      getSingleHeader(req, REMOTE_EMPLOYEE_ID_HEADER),
    ),
    mobile: decodePossiblyMojibakeHeader(getSingleHeader(req, REMOTE_MOBILE_HEADER)),
    jobNumber: decodePossiblyMojibakeHeader(
      getSingleHeader(req, REMOTE_JOB_NUMBER_HEADER),
    ),
  };

  if (
    !user.userId &&
    !user.email &&
    !user.employeeId &&
    !user.mobile &&
    !user.jobNumber
  ) {
    return null;
  }

  if (!user.userId) {
    user.userId = user.email || user.mobile || user.jobNumber || user.employeeId;
  }

  return user;
}

function getClientIp(req) {
  const forwardedFor = getSingleHeader(req, "x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return (
    getSingleHeader(req, "x-real-ip") ||
    req.socket?.remoteAddress ||
    ""
  );
}

function getRequestContext(req, url) {
  return {
    method: req.method,
    path: url.pathname,
    clientIp: getClientIp(req),
    xForwardedFor: getSingleHeader(req, "x-forwarded-for"),
    xRealIp: getSingleHeader(req, "x-real-ip"),
    userAgent: getSingleHeader(req, "user-agent"),
  };
}

function getLogUser(user) {
  if (!user) return null;
  return {
    userId: user.userId || "",
    email: user.email || "",
    name: user.name || "",
    employeeId: user.employeeId || "",
    mobile: user.mobile || "",
    jobNumber: user.jobNumber || "",
  };
}

function logEvent(event, req, url, fields = {}) {
  const entry = {
    time: new Date().toISOString(),
    event,
    ...getRequestContext(req, url),
    ...fields,
  };
  console.log(JSON.stringify(entry));
}

function buildState(req) {
  const next = extractNext(req.url);
  const payload = Buffer.from(
    JSON.stringify({ next, ts: Date.now() }),
    "utf-8",
  ).toString("base64url");
  const signature = signValue(payload);
  return `${payload}.${signature}`;
}

function parseState(state) {
  if (!state) return "/";
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return "/";
  const expectedSignature = signValue(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return "/";
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8"),
    );
    return sanitizeNext(parsed.next);
  } catch {
    return "/";
  }
}

function sanitizeNext(next) {
  if (!next || typeof next !== "string") return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  return next;
}

function extractNext(rawUrl) {
  const url = new URL(rawUrl, APP_BASE_URL);
  return sanitizeNext(url.searchParams.get("next") || "/sso/xrxs");
}

function buildAuthLoginUrl(req) {
  if (!AUTH_LOGIN_URL) {
    throw new Error("AUTH_LOGIN_URL is not configured");
  }
  const authUrl = new URL(AUTH_LOGIN_URL);
  authUrl.searchParams.set("redirect_uri", `${APP_BASE_URL}/auth/callback`);
  authUrl.searchParams.set("state", buildState(req));
  return authUrl.toString();
}

async function exchangeCodeForUser(code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_EXCHANGE_TIMEOUT_MS);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (AUTH_EXCHANGE_TOKEN) {
    headers.Authorization = `Bearer ${AUTH_EXCHANGE_TOKEN}`;
  }

  try {
    const response = await fetch(AUTH_EXCHANGE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ code }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `Auth exchange failed with ${response.status}: ${JSON.stringify(payload)}`,
      );
    }

    return {
      email: readNested(payload, [
        "email",
        "user.email",
        "data.email",
        "data.user.email",
      ]),
      userId:
        readNested(payload, [
          "userId",
          "userid",
          "user.userId",
          "user.id",
          "data.userId",
          "data.userid",
          "data.user.userId",
          "data.user.id",
        ]) || "",
      name:
        readNested(payload, [
          "name",
          "user.name",
          "data.name",
          "data.user.name",
        ]) || "",
      employeeId:
        readNested(payload, [
          "employeeId",
          "employee_id",
          "user.employeeId",
          "data.employeeId",
          "data.user.employeeId",
        ]) || "",
      mobile:
        readNested(payload, [
          "mobile",
          "phone",
          "user.mobile",
          "data.mobile",
          "data.user.mobile",
        ]) || "",
      jobNumber:
        readNested(payload, [
          "jobNumber",
          "job_number",
          "workCode",
          "user.jobNumber",
          "data.jobNumber",
          "data.user.jobNumber",
        ]) || "",
    };
  } finally {
    clearTimeout(timer);
  }
}

function readNested(object, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => {
      if (current && Object.hasOwn(current, key)) return current[key];
      return undefined;
    }, object);
    if (value != null && value !== "") {
      return String(value).trim();
    }
  }
  return "";
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), XRXS_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} from ${url}: ${JSON.stringify(payload)}`,
      );
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt - now > 60 * 1000) {
    return tokenCache.accessToken;
  }

  const url = new URL(XRXS_TOKEN_URL);
  url.searchParams.set("grant_type", "client_credentials");
  url.searchParams.set("client_id", XRXS_APP_KEY);
  url.searchParams.set("client_secret", XRXS_APP_SECRET);

  const payload = await requestJson(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  });

  if (!payload?.access_token) {
    throw new Error(`XRXS token response missing access_token: ${JSON.stringify(payload)}`);
  }

  const expiresInSeconds = Number(payload.expires_in || 7200);
  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: now + expiresInSeconds * 1000,
  };

  return tokenCache.accessToken;
}

function buildXrxsSign(bodyText) {
  return encodeURIComponent(
    crypto
      .createHmac("sha1", Buffer.from(XRXS_APP_SECRET, "utf8"))
      .update(Buffer.from(bodyText, "utf8"))
      .digest("base64"),
  );
}

async function postXrxsJson(url, body, options = {}) {
  const bodyText = JSON.stringify(body);
  const sign = buildXrxsSign(bodyText);
  const accessToken = await getAccessToken();
  const requestUrl = new URL(url);
  requestUrl.searchParams.set("sign", sign);
  if (options.includeAccessTokenInQuery) {
    requestUrl.searchParams.set("access_token", accessToken);
  }

  const payload = await requestJson(requestUrl.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      access_token: accessToken,
    },
    body: bodyText,
  });

  if (payload?.errcode !== 0) {
    throw new Error(`XRXS API error: ${JSON.stringify(payload)}`);
  }

  return payload;
}

function resolveAuthenticatedUser(req) {
  if (AUTH_MODE === "trusted_headers") {
    return getTrustedHeaderUser(req);
  }
  return readSession(req);
}

function getLookupCandidate(user) {
  const lookupType = XRXS_EMPLOYEE_LOOKUP_TYPE;

  if (lookupType === "employee_id") {
    return {
      strategy: "employee_id",
      value: user.employeeId || "",
    };
  }
  if (lookupType === "email") {
    return {
      strategy: "email",
      value: user.email || "",
    };
  }
  if (lookupType === "mobile") {
    return {
      strategy: "mobile",
      value: user.mobile || "",
    };
  }
  if (lookupType === "job_number") {
    return {
      strategy: "job_number",
      value: user.jobNumber || "",
    };
  }

  if (user.employeeId) {
    return { strategy: "employee_id", value: user.employeeId };
  }
  if (user.email) {
    return { strategy: "email", value: user.email };
  }
  if (user.mobile) {
    return { strategy: "mobile", value: user.mobile };
  }
  if (user.jobNumber) {
    return { strategy: "job_number", value: user.jobNumber };
  }

  return { strategy: "unknown", value: "" };
}

async function resolveEmployeeId(user) {
  const candidate = getLookupCandidate(user);

  if (!candidate.value) {
    throw new Error(
      `Unable to determine employee lookup value. Check trusted headers and XRXS_EMPLOYEE_LOOKUP_TYPE=${XRXS_EMPLOYEE_LOOKUP_TYPE}`,
    );
  }

  if (candidate.strategy === "employee_id") {
    return {
      employeeId: candidate.value,
      strategy: "employee_id",
      sourceValue: candidate.value,
    };
  }

  const timestamp = Date.now();
  const body = {
    type: candidate.strategy === "email" ? "1" : candidate.strategy === "mobile" ? "0" : "2",
    timestamp,
    status: XRXS_EMPLOYEE_STATUS,
  };

  if (candidate.strategy === "email") {
    body.emails = [candidate.value];
  } else if (candidate.strategy === "mobile") {
    body.mobiles = [candidate.value];
  } else if (candidate.strategy === "job_number") {
    body.jobNumbers = [candidate.value];
  }

  const payload = await postXrxsJson(XRXS_EMPLOYEE_ID_URL, body);
  const data = payload.data || {};
  const employeeId = data[candidate.value] || Object.values(data)[0];
  if (!employeeId) {
    throw new Error(
      `XRXS employee ID lookup returned empty result for ${candidate.strategy}=${candidate.value}`,
    );
  }

  return {
    employeeId: String(employeeId),
    strategy: candidate.strategy,
    sourceValue: candidate.value,
  };
}

function buildFreeLoginBody(employeeId) {
  const body = {
    employeeId,
    redirectType: XRXS_REDIRECT_TYPE,
    userType: XRXS_USER_TYPE,
    timestamp: Date.now(),
  };

  if (XRXS_REDIRECT_URL_TYPE != null) {
    body.redirectUrlType = XRXS_REDIRECT_URL_TYPE;
  }
  if (XRXS_REDIRECT_PARAM_JSON) {
    body.redirectParam = JSON.parse(XRXS_REDIRECT_PARAM_JSON);
  }

  return body;
}

async function getFreeLoginUrl(employeeId) {
  const payload = await postXrxsJson(
    XRXS_FREE_LOGIN_URL,
    buildFreeLoginBody(employeeId),
    { includeAccessTokenInQuery: true },
  );
  if (!payload?.data) {
    throw new Error(`XRXS free login response missing data: ${JSON.stringify(payload)}`);
  }
  return String(payload.data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, APP_BASE_URL);

  try {
    if (req.method === "GET" && url.pathname === "/healthz") {
      return json(res, 200, {
        ok: true,
        authMode: AUTH_MODE,
        redirectType: REDIRECT_TYPE_NAMES[XRXS_REDIRECT_TYPE],
        userType: USER_TYPE_NAMES[XRXS_USER_TYPE],
      });
    }

    if (req.method === "GET" && url.pathname === "/logout") {
      logEvent("logout", req, url, { result: "redirect" });
      return redirect(res, "/", { "Set-Cookie": clearSessionCookie() });
    }

    if (req.method === "GET" && url.pathname === "/") {
      const user = resolveAuthenticatedUser(req);
      if (!user) {
        logEvent("auth_missing", req, url, {
          authMode: AUTH_MODE,
          result: AUTH_MODE === "trusted_headers" ? "unauthorized" : "redirect",
        });
        if (AUTH_MODE === "trusted_headers") {
          return json(res, 401, {
            error:
              "Missing trusted auth headers. Ensure your reverse proxy forwards Authelia Remote-* identity headers to this service.",
          });
        }
        return redirect(res, buildAuthLoginUrl(req));
      }
      logEvent("auth_success", req, url, {
        authMode: AUTH_MODE,
        user: getLogUser(user),
        result: "redirect",
        target: "/sso/xrxs",
      });
      return redirect(res, "/sso/xrxs");
    }

    if (req.method === "GET" && url.pathname === "/auth/callback") {
      if (AUTH_MODE !== "exchange_code") {
        return json(res, 404, { error: "Not found" });
      }

      const code = url.searchParams.get("code");
      if (!code) return badRequest(res, "Missing code");

      const user = await exchangeCodeForUser(code);
      const sessionCookie = createSessionCookie(user);
      const next = parseState(url.searchParams.get("state"));
      logEvent("auth_callback_success", req, url, {
        authMode: AUTH_MODE,
        user: getLogUser(user),
        result: "redirect",
        target: next,
      });
      return redirect(res, next, { "Set-Cookie": sessionCookie });
    }

    if (req.method === "GET" && url.pathname === "/sso/xrxs") {
      const user = resolveAuthenticatedUser(req);
      if (!user) {
        logEvent("xrxs_sso_missing_auth", req, url, {
          authMode: AUTH_MODE,
          result: AUTH_MODE === "trusted_headers" ? "unauthorized" : "redirect",
        });
        if (AUTH_MODE === "trusted_headers") {
          return json(res, 401, {
            error:
              "Missing trusted auth headers. Ensure Nginx and Authelia are correctly configured.",
          });
        }
        return redirect(res, buildAuthLoginUrl(req));
      }

      const resolved = await resolveEmployeeId(user);
      const freeLoginUrl = await getFreeLoginUrl(resolved.employeeId);
      logEvent("xrxs_sso_redirect", req, url, {
        authMode: AUTH_MODE,
        user: getLogUser(user),
        resolved,
        result: "success",
        targetHost: new URL(freeLoginUrl).host,
      });
      return redirect(res, freeLoginUrl);
    }

    if (req.method === "GET" && url.pathname === "/debug/session") {
      const user = resolveAuthenticatedUser(req);
      logEvent("debug_session", req, url, {
        authMode: AUTH_MODE,
        user: getLogUser(user),
        authenticated: Boolean(user),
        result: "success",
      });
      return json(res, 200, {
        authenticated: Boolean(user),
        session: user || null,
        authMode: AUTH_MODE,
        lookupType: XRXS_EMPLOYEE_LOOKUP_TYPE,
      });
    }

    if (req.method === "GET" && url.pathname === "/debug/resolve") {
      const user = resolveAuthenticatedUser(req);
      if (!user) {
        logEvent("debug_resolve_missing_auth", req, url, {
          authMode: AUTH_MODE,
          authenticated: false,
          result: "success",
        });
        return json(res, 200, {
          authenticated: false,
          session: null,
        });
      }

      const resolved = await resolveEmployeeId(user);
      logEvent("debug_resolve", req, url, {
        authMode: AUTH_MODE,
        user: getLogUser(user),
        resolved,
        authenticated: true,
        result: "success",
      });
      return json(res, 200, {
        authenticated: true,
        session: user,
        resolved,
        target: {
          redirectType: XRXS_REDIRECT_TYPE,
          userType: XRXS_USER_TYPE,
          redirectUrlType: XRXS_REDIRECT_URL_TYPE,
        },
      });
    }

    return json(res, 404, { error: "Not found" });
  } catch (error) {
    logEvent("request_error", req, url, {
      authMode: AUTH_MODE,
      result: "error",
      error: error.message,
    });
    return serverError(res, "Unexpected server error", error.message);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`sso-xrxs listening on port ${PORT}`);
});

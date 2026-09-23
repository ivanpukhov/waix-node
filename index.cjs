"use strict";
const { createHmac, timingSafeEqual } = require("node:crypto");
const VERSION = "0.2.0";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const part = (value) => {
  if (typeof value !== "string" || !value.length)
    throw new TypeError("A non-empty identifier is required");
  return encodeURIComponent(value);
};
const key = (value, uuid = false) => {
  if (
    typeof value !== "string" ||
    !(uuid ? UUID : /^[\w.:-]{8,128}$/).test(value)
  )
    throw new TypeError(
      uuid
        ? "A stable UUID Idempotency-Key is required"
        : "Idempotency-Key must contain 8–128 letters, digits, dots, colons, underscores or hyphens",
    );
  return value;
};
class WaixError extends Error {
  constructor(
    message,
    {
      status = 0,
      code = "TRANSPORT_ERROR",
      requestId = null,
      retryAfter = null,
      body = null,
      cause,
    } = {},
  ) {
    super(message, { cause });
    this.name = "WaixError";
    Object.assign(this, { status, code, requestId, retryAfter });
    Object.defineProperty(this, "body", { value: body });
  }
  toJSON() {
    // Do not serialize response bodies, credentials, phone numbers or OTP codes.
    return {
      name: this.name,
      status: this.status,
      code: this.code,
      requestId: this.requestId,
      retryAfter: this.retryAfter,
    };
  }
  retryDelayMs(now = Date.now()) {
    if (!this.retryAfter) return null;
    if (/^[0-9]+$/.test(this.retryAfter)) return Number(this.retryAfter) * 1000;
    const date = Date.parse(this.retryAfter);
    return Number.isFinite(date) ? Math.max(0, date - now) : null;
  }
}
class Waix {
  #apiKey;
  #baseUrl;
  #fetch;
  #timeout;
  #maxResponseBytes;
  constructor(
    apiKey,
    {
      baseUrl = "https://waix.kz/api/v1",
      timeout = 30000,
      maxResponseBytes = 2 * 1024 * 1024,
      fetch: fetchImpl = globalThis.fetch,
    } = {},
  ) {
    if (typeof apiKey !== "string" || !apiKey.trim() || /[\r\n]/.test(apiKey))
      throw new TypeError("A server-side WAIX API key is required");
    const u = new URL(baseUrl);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname.replace(/\/$/, "") !== "/api/v1" ||
      (u.protocol !== "https:" &&
        !(
          u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
        ))
    )
      throw new TypeError(
        "baseUrl must be an HTTPS /api/v1 URL (HTTP allowed only on localhost)",
      );
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300000)
      throw new TypeError("timeout must be 1–300000 milliseconds");
    if (typeof fetchImpl !== "function")
      throw new TypeError("fetch must be a function");
    if (
      !Number.isInteger(maxResponseBytes) ||
      maxResponseBytes < 1024 ||
      maxResponseBytes > 16 * 1024 * 1024
    )
      throw new TypeError("maxResponseBytes must be 1024–16777216 bytes");
    this.#maxResponseBytes = maxResponseBytes;
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#fetch = fetchImpl;
    this.#timeout = timeout;
    this.messages = {
      send: (body, idempotencyKey) =>
        this.request("POST", "/messages", {
          body,
          idempotencyKey: key(idempotencyKey, true),
        }),
      list: (query) => this.request("GET", "/messages", { query }),
      iterate: (query, options) => this.#iterateMessages(query, options),
      get: (id) => this.request("GET", `/messages/${part(id)}`),
      retry: (id, body = {}) =>
        this.request("POST", `/messages/${part(id)}/retry`, { body }),
    };
    this.connections = {
      list: () => this.request("GET", "/connections"),
      profile: (id) => this.request("GET", `/connections/${part(id)}/profile`),
      updateProfile: (id, body) =>
        this.request("PUT", `/connections/${part(id)}/profile`, { body }),
    };
    this.templates = {
      get: (id, name) =>
        this.request("GET", `/connections/${part(id)}/templates/${part(name)}`),
      update: (id, name, body) =>
        this.request(
          "PATCH",
          `/connections/${part(id)}/templates/${part(name)}`,
          { body },
        ),
      list: (id, query) =>
        this.request("GET", `/connections/${part(id)}/templates`, { query }),
      create: (id, body) =>
        this.request("POST", `/connections/${part(id)}/templates`, { body }),
      delete: (id, name) =>
        this.request(
          "DELETE",
          `/connections/${part(id)}/templates/${part(name)}`,
        ),
      preview: (id, body) =>
        this.request("POST", `/connections/${part(id)}/templates/preview`, {
          body,
        }),
    };
    this.otp = {
      send: (body, idempotencyKey) =>
        this.request("POST", "/otp/send", {
          body,
          idempotencyKey: key(idempotencyKey),
        }),
      verify: (id, code) => {
        if (
          typeof id !== "string" ||
          !UUID.test(id) ||
          typeof code !== "string" ||
          !/^[0-9]{6}$/.test(code)
        )
          throw new TypeError(
            "OTP requires a challenge UUID and a six-digit string code",
          );
        return this.request("POST", "/otp/verify", { body: { id, code } });
      },
      status: (id) => this.request("GET", `/otp/${part(id)}`),
    };
    this.webhook = {
      delete: () => this.request("DELETE", "/webhook"),
      get: () => this.request("GET", "/webhook"),
      update: (body) => this.request("PUT", "/webhook", { body }),
      test: () => this.request("POST", "/webhook/test", { body: {} }),
      rotateSecret: () =>
        this.request("POST", "/webhook/rotate-secret", { body: {} }),
    };
    this.media = {
      list: (query) => this.request("GET", "/media", { query }),
      upload: (connectionId, file, filename = "upload", options = {}) => {
        if (!(file instanceof Blob))
          throw new TypeError("file must be a Blob or File");
        if (file.size > 100 * 1024 * 1024)
          throw new TypeError("File exceeds 100 MB");
        if (typeof connectionId !== "string" || !UUID.test(connectionId))
          throw new TypeError("connectionId must be a UUID");
        if (
          typeof filename !== "string" ||
          !filename ||
          /[\r\n]/.test(filename)
        )
          throw new TypeError("Invalid filename");
        if (options.voice !== undefined && typeof options.voice !== "boolean")
          throw new TypeError("voice must be boolean");
        const body = new FormData();
        body.append("connection_id", connectionId);
        body.append("file", file, filename);
        for (const name of ["type", "voice"])
          if (options[name] !== undefined)
            body.append(name, String(options[name]));
        return this.request("POST", "/media", { body });
      },
      getUrl: (id) => this.request("GET", `/media/${part(id)}/url`),
      delete: (id) => this.request("DELETE", `/media/${part(id)}`),
    };
  }
  async *#iterateMessages(query = {}, { maxPages = 1000, signal } = {}) {
    if (!Number.isInteger(maxPages) || maxPages < 1)
      throw new TypeError("maxPages must be a positive integer");
    let current = { ...query };
    const seen = new Set();
    for (let page = 0; page < maxPages; page++) {
      const result = await this.request("GET", "/messages", {
        query: current,
        signal,
      });
      if (!Array.isArray(result?.data))
        throw new WaixError("Expected a message list", {
          code: "INVALID_RESPONSE",
        });
      for (const item of result.data) yield item;
      const { next_before: before, next_before_id: before_id } =
        result.pagination || {};
      if (before == null && before_id == null) return;
      const cursor = JSON.stringify([before, before_id]);
      if (
        typeof before !== "string" ||
        typeof before_id !== "string" ||
        seen.has(cursor)
      )
        throw new WaixError("Invalid or repeated pagination cursor", {
          code: "INVALID_PAGINATION",
        });
      seen.add(cursor);
      current = { ...query, before, before_id };
    }
    throw new WaixError("Message iteration reached maxPages", {
      code: "PAGINATION_LIMIT",
    });
  }
  async request(method, path, { body, query, idempotencyKey, signal } = {}) {
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))
      throw new TypeError("Unsupported HTTP method");
    if (
      typeof path !== "string" ||
      !/^\/(?!\/)[a-zA-Z0-9_/%.-]+$/.test(path) ||
      path.includes("..") ||
      /%2f|%5c|%2e/i.test(path)
    )
      throw new TypeError("Use a relative API endpoint path");
    if (method === "GET" && body !== undefined)
      throw new TypeError("GET cannot have a body");
    const url = new URL(this.#baseUrl + path);
    if (
      query !== undefined &&
      (query === null || typeof query !== "object" || Array.isArray(query))
    )
      throw new TypeError("query must be an object");
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null) continue;
      if (
        !["string", "number", "boolean"].includes(typeof v) ||
        (typeof v === "number" && !Number.isFinite(v))
      )
        throw new TypeError(
          "Query values must be strings, finite numbers or booleans",
        );
      url.searchParams.set(k, String(v));
    }
    const headers = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
      "User-Agent": `waix-node/${VERSION}`,
    };
    if (idempotencyKey !== undefined)
      headers["Idempotency-Key"] = key(idempotencyKey);
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart)
      headers["Content-Type"] = "application/json";
    const payload =
      body === undefined
        ? undefined
        : multipart
          ? body
          : JSON.stringify(body, (_k, value) => {
              if (typeof value === "number" && !Number.isFinite(value))
                throw new TypeError("JSON numbers must be finite");
              return value;
            });
    const timeoutSignal = AbortSignal.timeout(this.#timeout);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    let response,
      raw,
      requestId = null,
      retryAfter = null;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        body: payload,
        redirect: "manual",
        signal: requestSignal,
      });
      requestId = response.headers.get("x-request-id");
      retryAfter = response.headers.get("retry-after");
      const reader = response.body?.getReader();
      const chunks = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > this.#maxResponseBytes) {
              await reader.cancel();
              throw new WaixError("WAIX response exceeds maxResponseBytes", {
                status: response.status,
                code: "RESPONSE_TOO_LARGE",
                requestId,
                retryAfter,
              });
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      raw = Buffer.concat(chunks, size).toString("utf8");
    } catch (cause) {
      if (cause instanceof WaixError) throw cause;
      throw new WaixError(
        "WAIX response was not received completely. Delivery outcome may be unknown; reuse the same idempotency key.",
        {
          code: signal?.aborted
            ? "ABORTED"
            : timeoutSignal.aborted
              ? "TIMEOUT"
              : "TRANSPORT_ERROR",
          requestId,
          retryAfter,
          cause,
        },
      );
    }
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      /* Classify HTTP errors even when a proxy sends HTML. */
    }
    if (!response.ok) {
      const value =
        data && typeof data === "object" && !Array.isArray(data) ? data : {};
      throw new WaixError(
        typeof value.error === "string"
          ? value.error
          : `WAIX HTTP ${response.status}`,
        {
          status: response.status,
          code:
            response.status >= 300 && response.status < 400
              ? "REDIRECT_DISALLOWED"
              : typeof value.code === "string"
                ? value.code
                : "API_ERROR",
          requestId:
            typeof value.request_id === "string" ? value.request_id : requestId,
          retryAfter,
          body: data,
        },
      );
    }
    if (response.status === 204 && !raw) return null;
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new WaixError("WAIX returned an invalid JSON object", {
        status: response.status,
        code: "INVALID_RESPONSE",
        requestId,
        retryAfter,
      });
    return data;
  }
}
function verifyWebhook(
  rawBody,
  timestamp,
  signature,
  secret,
  { tolerance = 300, now = Math.floor(Date.now() / 1000) } = {},
) {
  if (
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    !Number.isFinite(now) ||
    typeof timestamp !== "string" ||
    !/^\d{10,12}$/.test(timestamp) ||
    typeof signature !== "string" ||
    !/^v1=[a-f0-9]{64}$/i.test(signature) ||
    typeof secret !== "string" ||
    !secret ||
    Math.abs(now - Number(timestamp)) > tolerance
  )
    return false;
  if (typeof rawBody !== "string" && !(rawBody instanceof Uint8Array))
    return false;
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  return timingSafeEqual(digest, Buffer.from(signature.slice(3), "hex"));
}
module.exports = { Waix, WaixError, verifyWebhook };

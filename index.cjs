"use strict";
const { createHmac, timingSafeEqual } = require("node:crypto");
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
    Object.assign(this, { status, code, requestId, retryAfter, body });
  }
}
class Waix {
  #apiKey;
  #baseUrl;
  #fetch;
  #timeout;
  constructor(
    apiKey,
    {
      baseUrl = "https://waix.kz/api/v1",
      timeout = 30000,
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
      verify: (id, code) =>
        this.request("POST", "/otp/verify", { body: { id, code } }),
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
  async request(method, path, { body, query, idempotencyKey } = {}) {
    if (
      !/^\/(?!\/)[a-zA-Z0-9_/%.-]+$/.test(path) ||
      path.includes("..") ||
      /%2f|%5c|%2e/i.test(path)
    )
      throw new TypeError("Use a relative API endpoint path");
    const url = new URL(this.#baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const headers = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
      "User-Agent": "waix-node/0.1.0",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = key(idempotencyKey);
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart)
      headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : multipart
              ? body
              : JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(this.#timeout),
      });
    } catch (cause) {
      throw new WaixError(
        "WAIX request failed or timed out. Delivery outcome may be unknown; reuse the same idempotency key.",
        { cause },
      );
    }
    const requestId = response.headers.get("x-request-id"),
      retryAfter = response.headers.get("retry-after");
    let data;
    try {
      const raw = await response.text();
      data = raw ? JSON.parse(raw) : null;
    } catch {
      throw new WaixError("WAIX returned an invalid JSON response", {
        status: response.status,
        code: "INVALID_RESPONSE",
        requestId,
        retryAfter,
      });
    }
    if (!response.ok)
      throw new WaixError(
        typeof data?.error === "string"
          ? data.error
          : `WAIX HTTP ${response.status}`,
        {
          status: response.status,
          code: data?.code || "API_ERROR",
          requestId: data?.request_id || requestId,
          retryAfter,
          body: data,
        },
      );
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

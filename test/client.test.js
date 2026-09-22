import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { Waix, WaixError, verifyWebhook } from "../index.js";
const key = "f5bf0474-d4b6-4ca5-bd1b-92e44f3ad0fb";
test("messages and OTP use v1, authorization, stable keys and full response envelopes", async () => {
  const calls = [];
  const api = new Waix("fixture", {
    fetch: async (url, options) => {
      calls.push({ url: String(url), ...options });
      return new Response(
        JSON.stringify({
          data: { id: "result" },
          pagination: { next_before: "next" },
        }),
        { status: 202 },
      );
    },
  });
  const result = await api.messages.send(
    {
      connection_id: key,
      to: "+77000000000",
      type: "text",
      text: { body: "Test" },
    },
    key,
  );
  assert.equal(result.data.id, "result");
  assert.equal(calls[0].url, "https://waix.kz/api/v1/messages");
  assert.equal(calls[0].headers.Authorization, "Bearer fixture");
  assert.equal(calls[0].headers["Idempotency-Key"], key);
  await api.otp.send({ to: "+77000000000", ttl: 300 }, key);
  await api.otp.verify(key, "123456");
  await api.otp.status(key);
  await api.connections.updateProfile(key, { about: "WAIX" });
  assert.equal(calls[4].method, "PUT");
  await api.messages.list({
    limit: 10,
    before: "2026-01-01T00:00:00Z",
    status: undefined,
  });
  assert.match(calls[5].url, /limit=10/);
  assert.doesNotMatch(calls[5].url, /undefined/);
  assert.throws(() => api.messages.send({}, "bad"), /UUID/);
  assert.throws(
    () => new Waix("fixture", { baseUrl: "http://example.com/api/v1" }),
    /HTTPS/,
  );
  await assert.rejects(() => api.request("GET", "//attacker.test"), /relative/);
});
test("non-2xx errors preserve request ID and Retry-After without retrying", async () => {
  let count = 0;
  const api = new Waix("fixture", {
    fetch: async () => {
      count++;
      return new Response(
        JSON.stringify({
          error: "Wait",
          code: "RATE_LIMITED",
          request_id: "req-fixture",
        }),
        { status: 429, headers: { "Retry-After": "60" } },
      );
    },
  });
  await assert.rejects(
    () => api.connections.list(),
    (e) =>
      e instanceof WaixError &&
      e.status === 429 &&
      e.requestId === "req-fixture" &&
      e.retryAfter === "60",
  );
  assert.equal(count, 1);
});
test("raw-body signature verification checks body, timestamp, secret and tolerance", () => {
  const raw = Buffer.from('{"message":"Сәлем"}'),
    timestamp = "1770000000",
    sig =
      "v1=" +
      createHmac("sha256", "secret")
        .update(timestamp + ".")
        .update(raw)
        .digest("hex");
  assert.equal(
    verifyWebhook(raw, timestamp, sig, "secret", { now: Number(timestamp) }),
    true,
  );
  assert.equal(
    verifyWebhook(Buffer.from("{}"), timestamp, sig, "secret", {
      now: Number(timestamp),
    }),
    false,
  );
  assert.equal(
    verifyWebhook(raw, timestamp, sig, "secret", {
      now: Number(timestamp) + 301,
    }),
    false,
  );
  assert.equal(
    verifyWebhook(raw, timestamp, sig, "wrong", { now: Number(timestamp) }),
    false,
  );
});
test("multipart contains connection and file; template updates use PATCH", async () => {
  const calls = [];
  const api = new Waix("fixture", {
    fetch: async (url, o) => {
      calls.push(o);
      return new Response('{"data":{}}');
    },
  });
  await api.media.upload(
    key,
    new Blob(["abc"], { type: "text/plain" }),
    "test.txt",
    { type: "document" },
  );
  assert.equal(calls[0].body.get("connection_id"), key);
  assert.equal(calls[0].body.get("file").name, "test.txt");
  assert.equal(calls[0].headers["Content-Type"], undefined);
  await api.templates.update(key, "order_ready", { components: [] });
  assert.equal(calls[1].method, "PATCH");
});
test("real HTTP transport never forwards authorization to redirects", async (t) => {
  let redirects = 0;
  const server = createServer((req, res) => {
    if (req.url.endsWith("/connections"))
      res
        .writeHead(302, {
          Location: "/stolen",
          "Content-Type": "application/json",
        })
        .end("{}");
    else {
      redirects++;
      res.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const api = new Waix("fixture", {
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
  });
  await assert.rejects(
    () => api.connections.list(),
    (e) => e.status === 302,
  );
  assert.equal(redirects, 0);
});

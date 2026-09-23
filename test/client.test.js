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

test("proxy HTML, malformed success, size limits and safe error serialization", async () => {
  for (const [status, raw, code] of [
    [429, "<html>wait</html>", "API_ERROR"],
    [503, "unavailable", "API_ERROR"],
    [302, "", "REDIRECT_DISALLOWED"],
    [200, "null", "INVALID_RESPONSE"],
    [200, "[]", "INVALID_RESPONSE"],
    [200, "bad", "INVALID_RESPONSE"],
    [200, "x".repeat(1025), "RESPONSE_TOO_LARGE"],
  ]) {
    let calls = 0;
    const api = new Waix("fixture", {
      maxResponseBytes: 1024,
      fetch: async () => {
        calls++;
        return new Response(raw, {
          status,
          headers: { "Retry-After": "7", "X-Request-Id": "req-1" },
        });
      },
    });
    await assert.rejects(
      () => api.connections.list(),
      (e) =>
        e.code === code &&
        e.status === status &&
        e.retryAfter === "7" &&
        e.requestId === "req-1",
    );
    assert.equal(calls, 1);
  }
  const error = new WaixError("sensitive", {
    body: { test_code: "123456" },
    retryAfter: "60",
  });
  assert.doesNotMatch(JSON.stringify(error), /sensitive|123456|test_code/);
  assert.equal(error.retryDelayMs(), 60000);
  assert.equal(
    new WaixError("wait", {
      retryAfter: "Wed, 23 Sep 2026 00:00:00 GMT",
    }).retryDelayMs(Date.parse("2026-09-22T23:59:00Z")),
    60000,
  );
});
test("pagination is lazy, retains filters and stops repeated cursors", async () => {
  const calls = [];
  const api = new Waix("fixture", {
    fetch: async (url) => {
      calls.push(url);
      return Response.json({
        data: [{ id: String(calls.length) }],
        pagination:
          calls.length === 1
            ? { next_before: "2026-01-01T00:00:00Z", next_before_id: key }
            : { next_before: null, next_before_id: null },
      });
    },
  });
  const iterable = api.messages.iterate({ connection_id: key, limit: 1 });
  assert.equal(calls.length, 0);
  const values = [];
  for await (const item of iterable) values.push(item.id);
  assert.deepEqual(values, ["1", "2"]);
  assert.equal(calls[1].searchParams.get("before_id"), key);
  assert.equal(calls[1].searchParams.get("connection_id"), key);
  let repeated = 0;
  const bad = new Waix("fixture", {
    fetch: async () => {
      repeated++;
      return Response.json({
        data: [],
        pagination: { next_before: "same", next_before_id: key },
      });
    },
  });
  await assert.rejects(
    async () => {
      for await (const _ of bad.messages.iterate()) {
      }
    },
    (e) => e.code === "INVALID_PAGINATION",
  );
  assert.equal(repeated, 2);
});
test("invalid inputs never call transport; OTP preserves leading zero", async () => {
  let calls = 0;
  const api = new Waix("fixture", {
    fetch: async () => {
      calls++;
      return Response.json({ data: {} });
    },
  });
  for (const args of [
    ["TRACE", "/messages"],
    ["GET", "/messages", { query: { bad: [] } }],
    ["GET", "/messages", { query: { bad: NaN } }],
    ["POST", "/messages", { body: { bad: Infinity } }],
    ["GET", "/messages", { idempotencyKey: "" }],
    ["GET", "/messages", { body: {} }],
  ])
    await assert.rejects(() => api.request(...args), TypeError);
  assert.throws(() => api.otp.verify(key, 123456), TypeError);
  assert.throws(() => api.otp.verify(key, "12345"), TypeError);
  assert.equal(calls, 0);
  await api.otp.verify(key, "012345");
  assert.equal(calls, 1);
});
test("real transport timeout and abort, including a stalled response body", async (t) => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    res.writeHead(200, {
      "content-type": "application/json",
      "x-request-id": "req-stall",
    });
    res.write('{"data":');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const api = new Waix("fixture", {
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    timeout: 100,
  });
  await assert.rejects(
    () => api.connections.list(),
    (e) => e.code === "TIMEOUT" && e.requestId === "req-stall",
  );
  assert.equal(requests, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => api.request("GET", "/connections", { signal: controller.signal }),
    (e) => e.code === "ABORTED",
  );
});

test('User-Agent version matches package metadata', async () => {
  const {readFile}=await import('node:fs/promises');
  const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  let agent;
  const api=new Waix('fixture',{fetch:async(_url,options)=>{agent=options.headers['User-Agent'];return Response.json({data:{}});}});
  await api.connections.list();assert.equal(agent,`waix-node/${metadata.version}`);
});

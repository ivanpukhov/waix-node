[Русский](https://github.com/ivanpukhov/waix-node/blob/main/README.md)

# waix-node

Node.js SDK for WAIX WhatsApp Business API. Node.js 20+, no runtime dependencies. ESM, CommonJS and TypeScript declarations are included.

## Install

Install from npm:

```sh
npm install github:ivanpukhov/waix-node#v0.2.0
```

## Send an approved template

```js
import { Waix, WaixError } from 'waix-node';
import { randomUUID } from 'node:crypto';
const waix = new Waix(process.env.WAIX_API_KEY);
// Save this UUID with the order/outbox record before making the request.
const eventId = randomUUID();
const { data } = await waix.messages.send({
  connection_id: process.env.WAIX_CONNECTION_ID,
  to: '+77071234567',
  type: 'template',
  template: {
    name: 'order_ready', // Your approved template with one body variable.
    language: { code: 'ru' },
    components: [{ type: 'body', parameters: [{ type: 'text', text: '42' }] }],
  },
}, eventId);
console.log(data.id, data.status);
```

CommonJS: `const { Waix } = require('waix-node')`.

## OTP and errors

```js
const otp = new Waix(process.env.WAIX_OTP_PROJECT_KEY);
const sent = await otp.otp.send({ to: '+77071234567', ttl: 300 }, eventId);
// Save sent.data.id in the user's server session.
const status = await otp.otp.status(sent.data.id);
// suppliedCode must come from that same user's verification request.
const verified = await otp.otp.verify(sent.data.id, suppliedCode);
```

Catch `WaixError`: `status` (0 for network/timeout), `code`, `requestId`, `retryAfter` and `body`. There are no automatic retries.

```js
import { verifyWebhook } from 'waix-node';
const valid = verifyWebhook(rawBody, timestampHeader, signatureHeader, secret);
```

`new Waix(key, { timeout: 30000, baseUrl: 'https://waix.kz/api/v1' })`.
`media.upload(connectionId, new Blob([bytes], {type: 'application/pdf'}), 'invoice.pdf', {type: 'document'})` uploads a file. Template methods take the connection ID first. `messages.list({limit: 50, before, before_id})` returns the page and next cursor.

## Development

`npm test` runs protocol, error, webhook and real-HTTP redirect tests. `npm pack --dry-run` shows exactly what will be published.

## API behavior

- All calls use `https://waix.kz/api/v1` and return the complete JSON envelope (`data`, plus `pagination` when present).
- Keep API keys on your server. Never include them in a browser bundle, mobile app or workflow export. Grant only the scopes the integration needs.
- Create and persist one UUID per logical message before sending. Reuse that UUID and identical payload after network errors. A different key creates a different message. A `202` response means accepted into the queue, not delivered.
- Requests time out after 30 seconds and do not retry automatically or follow redirects. For HTTP 429 respect `Retry-After`; preserve the original idempotency key. Never blindly retry an `outcome_unknown` message.
- Start conversations with an approved template. Free-form messages depend on Meta's customer-service window. Collect recipient consent and honor opt-outs.
- OTP uses a separate project API key. Sandbox returns `test_code` and sends no WhatsApp message. Never expose `test_code` to the user being authenticated. Live OTP requires an available market/package and approved system sender. Check your WAIX dashboard before enabling production traffic.
- Bind the OTP challenge ID to the requesting user's server session. Only that session may verify it. The SDK does not implement your application's account policy, login session or public-endpoint rate limit.

## Endpoint coverage

Messages: send, list with cursor pagination, get and explicit retry. Connections: list and business profile read/update. Templates: list, get, create, update, delete and preview. Media: list, upload, URL and delete. Workspace webhook: read, update, delete, test and secret rotation. OTP: send, verify and status.

Some operations require management scopes or a workspace-level key; a project OTP key cannot manage a workspace webhook. API permissions and schemas: [WAIX API reference](https://waix.kz/openapi-api-v1.json).

The generic `request` method is available for additional API v1 operations. It accepts only relative API paths; never use it with a destination supplied by an untrusted caller.

## Webhook receiver

Verify the signature against the **original raw request bytes before JSON parsing**, using `X-Waix-Timestamp`, `X-Waix-Signature` and your webhook secret. The signing string is `timestamp + "." + rawBody`, HMAC-SHA256, prefixed with `v1=`. Verification uses constant-time comparison and a default 300-second tolerance. Reject invalid requests and deduplicate accepted events by `X-Waix-Delivery`; a valid signature alone does not prevent replay within the time window. Store/process the event durably, then return a 2xx response promptly.

## Support and versioning

[Documentation](https://waix.kz/docs) · [Support](https://waix.kz/contacts) · [Pricing](https://waix.kz/pricing).

This is the WAIX API v1 client, not the Meta Graph API SDK. SDK versions use SemVer. The client never logs keys, message bodies or OTP codes. If you add application logging, redact those values and retain request IDs for troubleshooting.

License: MIT.

## 0.2.0 resilience update

The client now bounds JSON responses (2 MiB by default), preserves HTTP status and retry headers even for non-JSON proxy errors, rejects invalid query values and provides lazy `messages.iterate` pagination with loop detection. OTP verification requires a six-digit string, including leading zeros. No automatic send retries. See the Russian README for language-specific options and safe error logging examples.

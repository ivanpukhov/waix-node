export interface MessageQuery {
  limit?: number;
  before?: string;
  before_id?: string;
  connection_id?: string;
  status?: string;
}
export interface ApiResponse<T = Record<string, unknown>> {
  data: T;
  pagination?: { next_before: string | null; next_before_id: string | null };
}
export interface Message {
  id: string;
  status: string;
  connection_id?: string;
  [key: string]: unknown;
}
export interface Otp {
  id: string;
  status: string;
  expires_at?: string;
  test_code?: string;
  [key: string]: unknown;
}
export interface MessageBase {
  connection_id: string;
  to: string;
  client_message_id?: string;
  reply_to_message_id?: string;
  media_object_id?: string;
}
export type MessageInput = MessageBase &
  (
    | { type: "text"; text: { body: string; preview_url?: boolean } }
    | { body: string; type?: never }
    | {
        type: "template";
        template: {
          name: string;
          language: { code: string };
          components?: Record<string, unknown>[];
        };
      }
    | {
        type: "image" | "video" | "audio" | "document" | "sticker";
        media: ({ id: string; link?: never } | { link: string; id?: never }) & {
          caption?: string;
          filename?: string;
          voice?: boolean;
        };
      }
    | {
        type: "interactive";
        interactive: {
          type: "button" | "list";
          body: { text: string };
          action: Record<string, unknown>;
          [key: string]: unknown;
        };
      }
    | {
        type: "reaction";
        reaction: { emoji: string };
        reply_to_message_id: string;
      }
  );
export interface Connection {
  id: string;
  display_phone_number?: string;
  status?: string;
  [key: string]: unknown;
}
export interface Options {
  baseUrl?: string;
  timeout?: number;
  fetch?: typeof globalThis.fetch;
  maxResponseBytes?: number;
}
export class WaixError extends Error {
  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      requestId?: string | null;
      retryAfter?: string | null;
      body?: unknown;
      cause?: unknown;
    },
  );
  toJSON(): {
    name: string;
    status: number;
    code: string;
    requestId: string | null;
    retryAfter: string | null;
  };
  retryDelayMs(now?: number): number | null;
  status: number;
  code: string;
  requestId: string | null;
  retryAfter: string | null;
  body: unknown;
}
export class Waix {
  constructor(apiKey: string, options?: Options);
  request<T = Record<string, unknown>>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, unknown>;
      idempotencyKey?: string;
      signal?: AbortSignal;
    },
  ): Promise<ApiResponse<T>>;
  messages: {
    send(
      body: MessageInput,
      idempotencyKey: string,
    ): Promise<ApiResponse<Message>>;
    list(query?: MessageQuery): Promise<ApiResponse<Message[]>>;
    iterate(
      query?: MessageQuery,
      options?: { maxPages?: number; signal?: AbortSignal },
    ): AsyncIterableIterator<Message>;
    get(id: string): Promise<ApiResponse<Message>>;
    retry(
      id: string,
      body?: { confirm_outcome_unknown?: boolean },
    ): Promise<ApiResponse<Message>>;
  };
  connections: {
    list(): Promise<ApiResponse<Connection[]>>;
    profile(id: string): Promise<ApiResponse>;
    updateProfile(
      id: string,
      body: Record<string, unknown>,
    ): Promise<ApiResponse>;
  };
  templates: {
    get(connectionId: string, name: string): Promise<ApiResponse>;
    update(
      connectionId: string,
      name: string,
      body: Record<string, unknown>,
    ): Promise<ApiResponse>;
    list(
      connectionId: string,
      query?: Record<string, unknown>,
    ): Promise<ApiResponse<Record<string, unknown>[]>>;
    create(
      connectionId: string,
      body: Record<string, unknown>,
    ): Promise<ApiResponse>;
    delete(connectionId: string, name: string): Promise<ApiResponse>;
    preview(
      connectionId: string,
      body: Record<string, unknown>,
    ): Promise<ApiResponse>;
  };
  otp: {
    send(
      body: { to: string; channel?: "whatsapp"; ttl?: number },
      idempotencyKey: string,
    ): Promise<ApiResponse<Otp>>;
    verify(id: string, code: string): Promise<ApiResponse>;
    status(id: string): Promise<ApiResponse<Otp>>;
  };
  webhook: {
    delete(): Promise<ApiResponse>;
    get(): Promise<ApiResponse>;
    update(body: Record<string, unknown>): Promise<ApiResponse>;
    test(): Promise<ApiResponse>;
    rotateSecret(): Promise<ApiResponse>;
  };
  media: {
    list(
      query?: Record<string, unknown>,
    ): Promise<ApiResponse<Record<string, unknown>[]>>;
    upload(
      connectionId: string,
      file: Blob,
      filename?: string,
      options?: { type?: string; voice?: boolean },
    ): Promise<ApiResponse>;
    getUrl(id: string): Promise<ApiResponse>;
    delete(id: string): Promise<ApiResponse>;
  };
}
export function verifyWebhook(
  rawBody: string | Uint8Array,
  timestamp: string,
  signature: string,
  secret: string,
  options?: { tolerance?: number; now?: number },
): boolean;
export default Waix;

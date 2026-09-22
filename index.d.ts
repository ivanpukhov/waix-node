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
export type MessageInput = {
  connection_id: string;
  to: string;
  type: string;
  [key: string]: unknown;
};
export interface Options {
  baseUrl?: string;
  timeout?: number;
  fetch?: typeof globalThis.fetch;
}
export class WaixError extends Error {
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
    },
  ): Promise<ApiResponse<T>>;
  messages: {
    send(
      body: MessageInput,
      idempotencyKey: string,
    ): Promise<ApiResponse<Message>>;
    list(query?: Record<string, unknown>): Promise<ApiResponse<Message[]>>;
    get(id: string): Promise<ApiResponse<Message>>;
    retry(
      id: string,
      body?: { confirm_outcome_unknown?: boolean },
    ): Promise<ApiResponse<Message>>;
  };
  connections: {
    list(): Promise<ApiResponse<Record<string, unknown>[]>>;
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

export declare const VERSION: string;
export type Json = Record<string, unknown>;
export interface Page<T> { items: T[]; total?: number; limit: number; offset?: number; hasMore: boolean; nextCursor: string | null }
export interface RequestOptions { idempotencyKey?: string }
export interface Payment { id: string; shortId: string; status: "new" | "paid" | "expired" | "canceled"; amount: string; currency: string;
  description: string; orderId: string | null; email: string | null; methods: string[]; method: string | null;
  metadata: Record<string, string>; livemode: boolean; feePayer: "merchant" | "buyer"; amountCharged: string | null;
  fee: string | null; net: string | null; refundedAmount: string; linkId: string | null; expiresAt: string;
  paidAt: string | null; createdAt: string; paymentUrl: string }
export interface Refund { id: string; paymentId: string; amount: string; status: "pending" | "succeeded" | "failed";
  reason: string | null; failureReason: string | null; livemode: boolean; createdAt: string; succeededAt: string | null }
export interface Payout { id: string; shopId: string; amount: string; fee: string; method: string; destination: string; status: string;
  rejectReason: string | null; failureReason: string | null; providerRef: string | null; externalId: string | null;
  batchId: string | null; createdAt: string; decidedAt: string | null; processingAt: string | null; paidAt: string | null }
export interface Event { id: string; type: string; livemode: boolean; createdAt: string; data: Json }
export declare class GroupPayError extends Error {
  status: number | null; code: string | null; requestId: string | null; param: string | null; docUrl: string | null; body: Json | null;
}
export declare class WebhookError extends Error {}
export declare function retryDelay(attempt: number, res?: Response): number;
export declare function verifyWebhook(body: string | Buffer, headers: Record<string, string | string[] | undefined> | Headers, secret: string,
  opts?: { tolerance?: number; now?: number }): Json;
export declare function signWebhook(body: string, secret: string, t?: number): Record<string, string>;
export declare class GroupPay {
  constructor(apiKey: string, opts?: { baseUrl?: string; fetch?: typeof fetch; maxAttempts?: number; timeout?: number;
    sleep?: (ms: number) => Promise<unknown> });
  request<T = unknown>(method: "GET" | "POST", path: string, opts?: { body?: unknown; query?: Json } & RequestOptions): Promise<T>;
  paginate<T = unknown>(path: string, query?: Json): AsyncGenerator<T>;
  payments: { create(body: Json, o?: RequestOptions): Promise<Payment>; get(id: string): Promise<Payment>;
    list(query?: Json): Promise<Page<Payment>>; cancel(id: string, o?: RequestOptions): Promise<Payment>;
    refund(id: string, body?: { amount?: string; reason?: string }, o?: RequestOptions): Promise<Refund> };
  refunds: { get(id: string): Promise<Refund>; list(query?: Json): Promise<Page<Refund>> };
  paymentLinks: { create(body: Json, o?: RequestOptions): Promise<Json>; get(id: string): Promise<Json>;
    list(query?: Json): Promise<Page<Json>>; deactivate(id: string, o?: RequestOptions): Promise<Json> };
  payouts: { create(body: Json, o?: RequestOptions): Promise<Payout>; createBatch(items: Json[], o?: RequestOptions): Promise<Json>;
    get(id: string): Promise<Payout>; getBatch(id: string): Promise<Json>; list(query?: Json): Promise<Page<Payout>>;
    fees(): Promise<Record<"card" | "sbp" | "usdt_trc20", { fee: string; min: string; max: string }>>;
    rates(): Promise<{ USDT_RUB: string; updatedAt: string | null }> };
  balance: { get(): Promise<Json>; transactions(query?: Json): Promise<Page<Json>> };
  events: { get(id: string): Promise<Event & { deliveries: Json[] }>; list(query?: Json): Promise<Page<Event>>;
    resend(id: string, endpointId?: string): Promise<{ deliveries: Json[] }> };
  test: { trigger(event: string): Promise<{ objects: Json[]; events: Event[] }> };
}

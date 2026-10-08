import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GroupPay, GroupPayError, WebhookError, signWebhook, verifyWebhook } from "../src/index.js";

const KEY = `gp_test_abcdefgh_${"x".repeat(32)}`;
const res = (status, body, headers = {}) => new Response(body === undefined ? "" : JSON.stringify(body), { status, headers });

function make(responses) {
  const calls = [];
  const sleeps = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), ...init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  const gp = new GroupPay(KEY, { baseUrl: "https://api.test/v1", fetch, sleep: async (ms) => sleeps.push(ms) });
  return { gp, calls, sleeps };
}

describe("GroupPay", () => {
  it("reuses one Idempotency-Key across retries", async () => {
    const { gp, calls, sleeps } = make([res(500, {}), res(201, { id: "p1" })]);
    expect(await gp.payments.create({ amount: "10.00", description: "d" })).toEqual({ id: "p1" });
    expect(calls).toHaveLength(2);
    expect(calls[0].headers["Idempotency-Key"]).toBe(calls[1].headers["Idempotency-Key"]);
    expect(sleeps).toEqual([500]);
    expect(JSON.parse(calls[0].body)).toEqual({ amount: "10.00", description: "d" });
  });
  it("honours Retry-After and stops after 3 attempts with a typed error", async () => {
    const e429 = () => res(429, { error: { code: "rate_limited", message: "Too many", requestId: "req_1" } }, { "Retry-After": "2" });
    const { gp, sleeps } = make([e429(), e429(), e429()]);
    const err = await gp.balance.get().catch((e) => e);
    expect(err).toBeInstanceOf(GroupPayError);
    expect([err.status, err.code, err.requestId]).toEqual([429, "rate_limited", "req_1"]);
    expect(sleeps).toEqual([2000, 2000]);
  });
  it("retries network errors and does not send Idempotency-Key on GET", async () => {
    const { gp, calls } = make([new TypeError("fetch failed"), res(200, { items: [] })]);
    await gp.payments.list({ limit: 1, orderId: "o" });
    expect(calls[1].url).toBe("https://api.test/v1/payments?limit=1&orderId=o");
    expect(calls[1].headers["Idempotency-Key"]).toBeUndefined();
  });
  it("paginates over nextCursor", async () => {
    const { gp } = make([res(200, { items: [1, 2], nextCursor: "c" }), res(200, { items: [3], nextCursor: null })]);
    const out = [];
    for await (const x of gp.paginate("/events", { limit: 2 })) out.push(x);
    expect(out).toEqual([1, 2, 3]);
  });
  it("sets a per-attempt timeout and clamps a negative Retry-After", async () => {
    const { gp, calls, sleeps } = make([res(503, {}, { "Retry-After": "-5" }), res(200, {})]);
    await gp.balance.get();
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(sleeps).toEqual([0]);
  });
  it("rejects malformed keys", () => {
    expect(() => new GroupPay("sk_123")).toThrow();
  });
});

describe("verifyWebhook", () => {
  const body = '{"event":"payment.succeeded"}';
  const v2 = (secrets, t) =>
    `t=${t},${secrets.map((s) => `v1=${createHmac("sha256", s).update(`${t}.${body}`).digest("hex")}`).join(",")}`;
  it("accepts any listed secret within tolerance", () => {
    expect(verifyWebhook(body, { "gp-signature-v2": v2(["new", "old"], 1000) }, "old", { now: 1100 }).event).toBe("payment.succeeded");
  });
  it("rejects stale or tampered payloads", () => {
    expect(() => verifyWebhook(body, { "GP-Signature-V2": v2(["s"], 1000) }, "s", { now: 1301 })).toThrow(WebhookError);
    expect(() => verifyWebhook(`${body} `, { "GP-Signature-V2": v2(["s"], 1000) }, "s", { now: 1000 })).toThrow(WebhookError);
  });
  it("falls back to the v1 header and round-trips signWebhook", () => {
    const v1 = createHmac("sha256", "s").update(body).digest("hex");
    expect(verifyWebhook(body, { "GP-Signature": v1 }, "s").event).toBe("payment.succeeded");
    expect(verifyWebhook(body, signWebhook(body, "s", 5), "s", { now: 5 }).event).toBe("payment.succeeded");
  });
  it("verifies the backend vector (Buffer body, array and Headers values) and rejects non-ASCII signatures", () => {
    const v = JSON.parse(readFileSync(new URL("./webhook-vector.json", import.meta.url), "utf8"));
    const raw = Buffer.from(v.body, "utf8");
    for (const s of v.secrets) {
      expect(verifyWebhook(raw, { "gp-signature-v2": [v.headers["GP-Signature-V2"]], x: undefined }, s, { now: v.t }).payment.description).toBe("Заказ №1042");
    }
    expect(verifyWebhook(v.body, new Headers(v.headers), v.secrets[0], { now: v.t }).event).toBe("payment.succeeded");
    const signed = signWebhook(v.body, v.secrets[0], v.t);
    expect(signed["GP-Signature"]).toBe(v.headers["GP-Signature"]);
    expect(v.headers["GP-Signature-V2"].startsWith(`${signed["GP-Signature-V2"]},`)).toBe(true);
    expect(() => verifyWebhook(v.body, { "GP-Signature-V2": `t=${v.t},v1=подпись` }, v.secrets[0], { now: v.t })).toThrow(WebhookError);
  });
});

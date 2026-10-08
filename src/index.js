import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const VERSION = "0.1.2";
const RETRY = new Set([429, 500, 502, 503, 504]);

export class GroupPayError extends Error {
  constructor(message, { status = null, code = null, requestId = null, param = null, docUrl = null, body = null } = {}) {
    super(message);
    this.name = "GroupPayError";
    Object.assign(this, { status, code, requestId, param, docUrl, body });
  }
}

export class WebhookError extends Error {}

export function retryDelay(attempt, res) {
  const ra = Number(res?.headers?.get("retry-after"));
  if (res?.headers?.get("retry-after") && Number.isFinite(ra)) return Math.max(0, Math.min(ra, 30)) * 1000;
  return Math.min(500 * 2 ** (attempt - 1), 8000);
}

const enc = (x) => encodeURIComponent(String(x));

export class GroupPay {
  constructor(apiKey, { baseUrl, fetch: f = globalThis.fetch, maxAttempts = 3, timeout = 30000, sleep } = {}) {
    if (!/^gp_(test|live)_/.test(apiKey ?? "")) throw new Error("apiKey must start with gp_test_ or gp_live_");
    this.apiKey = apiKey;
    const url = baseUrl ?? globalThis.process?.env?.GP_BASE_URL;
    if (!url) throw new Error("baseUrl is required (or set GP_BASE_URL)");
    this.baseUrl = url.replace(/\/$/, "");
    this.fetch = f;
    this.maxAttempts = maxAttempts;
    this.timeout = timeout;
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const r = (method, path, o) => this.request(method, path, o);
    this.payments = {
      create: (body, o = {}) => r("POST", "/payments", { body, ...o }),
      get: (id) => r("GET", `/payments/${enc(id)}`),
      list: (query) => r("GET", "/payments", { query }),
      cancel: (id, o = {}) => r("POST", `/payments/${enc(id)}/cancel`, o),
      refund: (id, body = {}, o = {}) => r("POST", `/payments/${enc(id)}/refunds`, { body, ...o }),
    };
    this.refunds = { get: (id) => r("GET", `/refunds/${enc(id)}`), list: (query) => r("GET", "/refunds", { query }) };
    this.paymentLinks = {
      create: (body, o = {}) => r("POST", "/payment-links", { body, ...o }),
      get: (id) => r("GET", `/payment-links/${enc(id)}`),
      list: (query) => r("GET", "/payment-links", { query }),
      deactivate: (id, o = {}) => r("POST", `/payment-links/${enc(id)}/deactivate`, o),
    };
    this.payouts = {
      create: (body, o = {}) => r("POST", "/payouts", { body, ...o }),
      createBatch: (items, o = {}) => r("POST", "/payouts/batch", { body: { items }, ...o }),
      get: (id) => r("GET", `/payouts/${enc(id)}`),
      getBatch: (id) => r("GET", `/payouts/batch/${enc(id)}`),
      list: (query) => r("GET", "/payouts", { query }),
      fees: () => r("GET", "/payouts/fees"),
      rates: () => r("GET", "/payouts/rates"),
    };
    this.balance = { get: () => r("GET", "/balance"), transactions: (query) => r("GET", "/balance/transactions", { query }) };
    this.events = {
      get: (id) => r("GET", `/events/${enc(id)}`),
      list: (query) => r("GET", "/events", { query }),
      resend: (id, endpointId) => r("POST", `/events/${enc(id)}/resend`, { body: endpointId ? { endpointId } : {} }),
    };
    this.test = { trigger: (event) => r("POST", "/test/trigger", { body: { event } }) };
  }

  async request(method, path, { body, query, idempotencyKey } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json", "User-Agent": `group-payments-node/${VERSION}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method === "POST") headers["Idempotency-Key"] = idempotencyKey ?? randomUUID();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await this.fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(this.timeout) });
      } catch (e) {
        if (attempt >= this.maxAttempts) throw new GroupPayError(`Network error: ${e.message}`, { code: "network_error" });
        await this.sleep(retryDelay(attempt));
        continue;
      }
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (res.ok) return data;
      if (!RETRY.has(res.status) || attempt >= this.maxAttempts) {
        const err = data?.error ?? {};
        throw new GroupPayError(err.message ?? `HTTP ${res.status}`, {
          status: res.status, code: err.code ?? null, requestId: err.requestId ?? res.headers.get("gp-request-id"),
          param: err.param ?? null, docUrl: err.docUrl ?? null, body: err,
        });
      }
      await this.sleep(retryDelay(attempt, res));
    }
  }

  async *paginate(path, query = {}) {
    let q = { ...query };
    for (;;) {
      const page = await this.request("GET", path, { query: q });
      yield* page.items;
      if (!page.nextCursor) return;
      q = { ...q, cursor: page.nextCursor };
    }
  }
}

const hex = (secret, data) => createHmac("sha256", secret).update(data).digest("hex");
const same = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function verifyWebhook(body, headers, secret, { tolerance = 300, now = Date.now() / 1000 } = {}) {
  const raw = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
  const entries = typeof headers?.entries === "function" ? [...headers.entries()] : Object.entries(headers ?? {});
  const h = Object.fromEntries(entries.filter(([, v]) => v != null).map(([k, v]) => [k.toLowerCase(), String(v)]));
  if (h["gp-signature-v2"]) {
    const parts = h["gp-signature-v2"].split(",").map((p) => p.split("="));
    const t = parts.find(([k]) => k === "t")?.[1] ?? "";
    const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
    if (!/^\d+$/.test(t) || !sigs.length) throw new WebhookError("Malformed GP-Signature-V2 header");
    if (Math.abs(now - Number(t)) > tolerance) throw new WebhookError("Timestamp is outside the tolerance window");
    const expected = hex(secret, `${t}.${raw}`);
    if (!sigs.some((s) => same(expected, s))) throw new WebhookError("Signature mismatch");
  } else if (h["gp-signature"]) {
    if (!same(hex(secret, raw), h["gp-signature"])) throw new WebhookError("Signature mismatch");
  } else {
    throw new WebhookError("No signature headers");
  }
  return JSON.parse(raw);
}

export function signWebhook(body, secret, t = Math.floor(Date.now() / 1000)) {
  return { "GP-Signature": hex(secret, body), "GP-Signature-V2": `t=${t},v1=${hex(secret, `${t}.${body}`)}` };
}

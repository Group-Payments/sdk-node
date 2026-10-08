# group-payments для Node.js

Клиент Group Pay API. Node.js 18+, ESM, типы TypeScript в комплекте, без зависимостей.

## Установка

```sh
npm i github:Group-Payments/sdk-node
```

## Быстрый старт

```js
import { GroupPay } from "group-payments";

const gp = new GroupPay(process.env.GP_API_KEY, { baseUrl: process.env.GP_BASE_URL });

const payment = await gp.payments.create({ amount: "100.00", description: "Заказ 42", orderId: "42" });
console.log(payment.paymentUrl);

for await (const p of gp.paginate("/payments", { limit: 50 })) console.log(p.id, p.status);
```

- Каждый POST получает `Idempotency-Key`, общий для всех повторов. Свой ключ: `{ idempotencyKey }`.
- Повторы при 429, 500, 502, 503, 504 и сетевых ошибках, с экспоненциальной паузой и учётом `Retry-After`.
- `maxAttempts` по умолчанию 3, `timeout` на попытку 30000 мс.
- Ошибки: `GroupPayError` с полями `status`, `code`, `requestId`, `param`, `docUrl`.
- Адрес API обязателен: опция `baseUrl` или переменная `GP_BASE_URL`.

## Вебхуки

```js
import { verifyWebhook, WebhookError } from "group-payments";

try {
  const event = verifyWebhook(rawBody, req.headers, process.env.GP_WEBHOOK_SECRET);
} catch (e) {
  if (e instanceof WebhookError) return res.status(400).end();
  throw e;
}
```

Передавайте исходное тело запроса, а не пересобранный JSON. Подпись `GP-Signature-V2` проверяется с допуском 300 с (`{ tolerance }`).

## Лицензия

MIT

"use strict";

const token = process.env.TELEGRAM_BOT_TOKEN;
const origin = String(process.env.APP_ORIGIN || "").replace(/\/$/, "");
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !origin || !secret) {
  throw new Error("Set TELEGRAM_BOT_TOKEN, APP_ORIGIN and TELEGRAM_WEBHOOK_SECRET first.");
}

fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: `${origin}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false
  })
}).then(async response => {
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || "Telegram rejected webhook.");
  console.log(`Telegram webhook enabled: ${origin}/api/telegram/webhook`);
});

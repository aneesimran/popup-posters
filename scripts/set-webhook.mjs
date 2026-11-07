// Points your Telegram bot at the deployed app.
// Usage: npm run set-webhook -- https://your-app.vercel.app
const base = process.argv[2];
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!base || !token || !secret) {
  console.error("Usage: npm run set-webhook -- https://your-app.vercel.app\nNeeds TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env.local");
  process.exit(1);
}

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

const url = new URL("/api/telegram", base).toString();
await call("setWebhook", { url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true });
await call("setMyCommands", {
  commands: [
    { command: "list", description: "Events in the next 7 days" },
    { command: "delete", description: "Reply to an event message to delete it" },
    { command: "start", description: "How to use this bot" },
  ],
});
console.log("Webhook set to", url);
console.log(await call("getWebhookInfo", {}));

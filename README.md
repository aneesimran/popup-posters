# Popup Posters

Share event posters from WhatsApp to a Telegram bot. Gemini reads each poster, and a private web page lists the events by date with an area filter.

Everything runs on free tiers: Telegram bot, Vercel Hobby, Neon Postgres, and the Gemini API free tier.

## Using it

- In WhatsApp, open a poster, tap **Share → Telegram → your bot**. You can select several at once.
- The bot replies with what it read, e.g. *Added: Winter Night Market, Sat 14 Nov, 6pm, Ilford*.
- No date on the poster? The bot asks. **Reply to its message** with something like `Sat 14 Nov 6pm` or `next Saturday`.
- Reply `/delete` to a bot message to remove that event. `/list` shows the next 7 days.
- Memes and non-event images are skipped. The same poster sent twice is only stored once.
- Each event shows how far it is from home (straight-line miles), found from the poster's postcode, venue or area.
- The web page groups events by day and filters by date (today, this weekend, next 7 days, this month), distance (within 1/3/5/10 miles, or nearest first) and area. Past events are hidden. You can edit, delete or add an event to your calendar.

## Setup (one-off, about 15 minutes)

1. **Telegram bot.** In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token.
2. **Gemini API key.** Create a free key at <https://aistudio.google.com/apikey>. (A Gemini app subscription doesn't include API access, but the free API tier is plenty.)
3. **Vercel.** Push this repo to GitHub and import it in Vercel. In the project, go to **Storage → Create → Neon** (free). This sets `DATABASE_URL` for you.
4. **Environment variables.** In Vercel → Settings → Environment Variables, add:
   - `TELEGRAM_BOT_TOKEN`: from step 1
   - `TELEGRAM_WEBHOOK_SECRET`: any long random string (`openssl rand -hex 32`)
   - `GEMINI_API_KEY`: from step 2
   - `GEMINI_MODEL`: optional; leave unset. The app uses `gemini-3.5-flash-lite` and falls back to `gemini-3.5-flash`
   - `APP_PASSCODE`: the passcode for the web page
   - `HOME_POSTCODE`: your postcode, for "miles from home" and the distance filter
   - leave `ALLOWED_CHAT_ID` for step 7

   Then redeploy.
5. **Local env.** `cp .env.example .env.local` and fill in the same values (pull `DATABASE_URL` from Vercel with `npx vercel env pull .env.local`, or copy it from the Neon dashboard).
6. **Create the table and connect the bot.**
   ```bash
   npm install
   npm run db:init        # safe to re-run; also applies new columns
   npm run set-webhook -- https://YOUR-APP.vercel.app
   ```
7. **Lock the bot to you.** Send `/start` to your bot. It replies with your chat ID. Add it as `ALLOWED_CHAT_ID` in Vercel and redeploy. Until this is set, the bot ignores everything except `/start`.

## Development

```bash
npm run dev      # http://localhost:3000
npm test         # unit tests
```

Free-tier note: Google may use content sent on the Gemini API free tier to improve its models. Public event posters are fine, but don't send anything private to the bot.

After changing `HOME_POSTCODE` nothing needs re-running: distances are worked out when the page loads. `npm run geo:backfill` fills in locations for any events that are missing one.

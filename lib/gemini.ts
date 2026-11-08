import { GoogleGenAI } from "@google/genai";
import { todayLondon } from "./dates";
import { normalizeDateReply, normalizeExtraction } from "./extract";
import type { DateReply, Extraction } from "./types";

// Free-tier latency varies a lot by model: some newer Flash models queue for minutes.
// Try each model in turn with a time limit so the bot always answers.
// Flash-Lite first: fast, and the most generous free daily allowance (~500/day vs ~20 for Flash).
const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash"];
const ATTEMPT_TIMEOUT_MS = 15_000;

function models(): string[] {
  const fromEnv = (process.env.GEMINI_MODEL ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  return [...new Set([...fromEnv, ...DEFAULT_MODELS])];
}

let client: GoogleGenAI | null = null;
const ai = () =>
  (client ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    // Fail fast and fall back to the next model instead of retrying slowly.
    httpOptions: { retryOptions: { attempts: 1 } },
  }));

type Contents = Parameters<GoogleGenAI["models"]["generateContent"]>[0]["contents"];

async function generateJson(contents: Contents, schema: object): Promise<unknown> {
  let lastError: unknown;
  for (const model of models()) {
    const started = Date.now();
    try {
      const res = await ai().models.generateContent({
        model,
        contents,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          temperature: 0,
          abortSignal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        },
      });
      console.log(`gemini ${model} ok in ${Date.now() - started}ms`);
      return JSON.parse(res.text ?? "{}");
    } catch (err) {
      console.warn(`gemini ${model} failed after ${Date.now() - started}ms: ${String(err).slice(0, 200)}`);
      lastError = err;
    }
  }
  throw lastError;
}

const nullableString = { type: ["string", "null"] };

const posterSchema = {
  type: "object",
  properties: {
    is_event: { type: "boolean", description: "true only if this image advertises an event, popup, market, class or similar" },
    title: { ...nullableString, description: "Short event name" },
    start_date: { ...nullableString, description: "YYYY-MM-DD, or null if no date is shown" },
    end_date: { ...nullableString, description: "YYYY-MM-DD last day for multi-day events, else null" },
    start_time: { ...nullableString, description: "HH:MM 24-hour, else null" },
    end_time: { ...nullableString, description: "HH:MM 24-hour, else null" },
    venue: { ...nullableString, description: "Venue name and/or street address" },
    area: {
      ...nullableString,
      description: "Town or neighbourhood only, e.g. 'Ilford', 'Stratford', 'New Cross', 'Leicester'. If not printed, infer it from the venue, street or postcode when you are confident.",
    },
    postcode: { ...nullableString, description: "UK postcode exactly as printed on the poster, else null. Never invent one." },
    price: { ...nullableString, description: "e.g. 'Free', '£5', '£10–£15'" },
    description: { ...nullableString, description: "One short sentence on what the event is" },
  },
  required: ["is_event", "title", "start_date", "end_date", "start_time", "end_time", "venue", "area", "postcode", "price", "description"],
};

const dateSchema = {
  type: "object",
  properties: {
    start_date: nullableString,
    end_date: nullableString,
    start_time: nullableString,
    end_time: nullableString,
  },
  required: ["start_date", "end_date", "start_time", "end_time"],
};

function dayContext(): string {
  const today = todayLondon();
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `Today is ${weekday} ${today} (UK).`;
}

export async function extractPoster(image: Uint8Array, mimeType: string, caption?: string): Promise<Extraction> {
  const prompt = [
    "Read this image. If it is a poster or flyer for an event (popup, market, bazaar, class, party, exhibition, etc.), extract the details.",
    dayContext(),
    "If the poster gives a day and month but no year, choose the next upcoming occurrence.",
    "If the date range spans several days, put the first day in start_date and the last in end_date.",
    "Use null for anything not shown. Do not guess venues or prices. The area may be inferred from a well-known venue, street or postcode.",
    caption ? `The sender added this caption, which may contain extra details: """${caption}"""` : "",
  ].filter(Boolean).join("\n");

  const json = await generateJson(
    [{ role: "user", parts: [{ inlineData: { mimeType, data: Buffer.from(image).toString("base64") } }, { text: prompt }] }],
    posterSchema,
  );
  return normalizeExtraction(json);
}

export async function parseDateReply(text: string, eventTitle: string): Promise<DateReply> {
  const prompt = [
    `The user is telling you when the event "${eventTitle}" takes place.`,
    dayContext(),
    "Convert their message into dates (YYYY-MM-DD) and times (HH:MM 24-hour). Relative phrases like 'next Saturday' are relative to today. Use null for anything not given.",
    `Message: """${text}"""`,
  ].join("\n");

  return normalizeDateReply(await generateJson(prompt, dateSchema));
}

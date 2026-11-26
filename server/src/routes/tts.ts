import crypto from "node:crypto";
import { Router } from "express";
import { db } from "../db.js";
import { HttpError, str } from "../http.js";
import { localDay } from "../progress.js";

/* ============================================================
   Natural interviewer voice via OpenAI text-to-speech.
   Enabled when OPENAI_API_KEY is set; the client falls back to the
   phone's built-in voice otherwise. Audio is cached so a question
   is only ever paid for once.
   ============================================================ */

db.exec(`
CREATE TABLE IF NOT EXISTS tts_cache (hash TEXT PRIMARY KEY, audio BLOB NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tts_usage (user_id INTEGER NOT NULL, day TEXT NOT NULL, chars INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
`);

const MODEL = process.env.TTS_MODEL ?? "gpt-4o-mini-tts";
const VOICE = process.env.TTS_VOICE ?? "sage";
const DAILY_CHARS = Number(process.env.TTS_DAILY_CHARS ?? 40000); // ~45 min of speech per user per day
const INSTRUCTIONS = "You are a friendly, calm senior engineer interviewing a candidate. Speak clearly at a natural conversational pace.";
const enabled = () => !!process.env.OPENAI_API_KEY;

export const tts = Router();
tts.get("/tts/status", (_req, res) => res.json({ enabled: enabled(), voice: VOICE }));

tts.post("/tts", async (req, res) => {
  if (!enabled()) throw new HttpError(503, "Natural voice isn't configured (OPENAI_API_KEY)");
  const text = str(req.body?.text, "text", 1, 2000).replace(/\s+/g, " ").trim();
  const hash = crypto.createHash("sha256").update(`${MODEL}|${VOICE}|${text}`).digest("hex");
  const hit = db.prepare("SELECT audio FROM tts_cache WHERE hash = ?").get(hash) as { audio: Uint8Array } | undefined;
  if (hit) { res.type("audio/mpeg").set("Cache-Control", "private, max-age=604800").send(Buffer.from(hit.audio)); return; }

  const u = req.userId!, day = localDay();
  const used = (db.prepare("SELECT chars FROM tts_usage WHERE user_id = ? AND day = ?").get(u, day) as { chars: number } | undefined)?.chars ?? 0;
  if (used + text.length > DAILY_CHARS) throw new HttpError(429, "Daily voice limit reached; using the phone's voice instead.");

  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, instructions: INSTRUCTIONS, response_format: "mp3" }),
  });
  if (!r.ok) {
    const body = await r.text();
    console.error("[tts] openai", r.status, body.slice(0, 300));
    throw new HttpError(r.status === 401 ? 503 : 502, r.status === 401 ? "The OPENAI_API_KEY was rejected" : r.status === 429 ? "OpenAI quota or rate limit hit" : "Voice generation failed");
  }
  const audio = Buffer.from(await r.arrayBuffer());
  db.prepare("INSERT OR REPLACE INTO tts_cache (hash, audio, created_at) VALUES (?, ?, ?)").run(hash, audio, Date.now());
  db.prepare("INSERT INTO tts_usage (user_id, day, chars) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET chars = chars + excluded.chars").run(u, day, text.length);
  res.type("audio/mpeg").set("Cache-Control", "private, max-age=604800").send(audio);
});

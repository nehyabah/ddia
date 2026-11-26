import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Router } from "express";
import { createRequire } from "node:module";
const webpush = createRequire(import.meta.url)("web-push") as typeof import("web-push");
import { DB_PATH, db } from "../db.js";
import { HttpError } from "../http.js";
import { dueCount, localDay } from "../progress.js";
import { buildPlan } from "./plan.js";

/* ============================================================
   Push reminders (Web Push / VAPID) and nightly database backups.
   ============================================================ */

db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keys TEXT NOT NULL, created_at INTEGER NOT NULL
);
`);
const cols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
if (!cols.includes("tz")) db.exec("ALTER TABLE users ADD COLUMN tz TEXT");
if (!cols.includes("last_push_day")) db.exec("ALTER TABLE users ADD COLUMN last_push_day TEXT");

/** VAPID keys are generated once and kept in the database, so nothing needs configuring. */
function vapid() {
  const get = (k: string) => (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(k) as { value: string } | undefined)?.value;
  let pub = process.env.VAPID_PUBLIC_KEY ?? get("vapid_public"), priv = process.env.VAPID_PRIVATE_KEY ?? get("vapid_private");
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey; priv = k.privateKey;
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid_public', ?), ('vapid_private', ?)").run(pub, priv);
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", pub, priv);
  return pub;
}
const PUBLIC_KEY = vapid();

export const notify = Router();
notify.get("/push/key", (_req, res) => res.json({ key: PUBLIC_KEY }));
notify.get("/push/status", (req, res) => {
  const n = (db.prepare("SELECT COUNT(*) n FROM push_subs WHERE user_id = ?").get(req.userId) as { n: number }).n;
  res.json({ subscribed: n > 0, devices: n });
});
notify.post("/push/subscribe", (req, res) => {
  const s = req.body?.subscription;
  if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) throw new HttpError(400, "Invalid subscription");
  if (typeof req.body?.tz === "string") db.prepare("UPDATE users SET tz = ? WHERE id = ?").run(req.body.tz.slice(0, 64), req.userId);
  db.prepare("INSERT OR REPLACE INTO push_subs (endpoint, user_id, keys, created_at) VALUES (?, ?, ?, ?)").run(String(s.endpoint), req.userId, JSON.stringify(s.keys), Date.now());
  res.json({ ok: true });
});
notify.post("/push/unsubscribe", (req, res) => {
  if (req.body?.endpoint) db.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").run(String(req.body.endpoint), req.userId);
  else db.prepare("DELETE FROM push_subs WHERE user_id = ?").run(req.userId);
  res.json({ ok: true });
});
notify.post("/push/test", async (req, res) => {
  const sent = await pushTo(req.userId!, { title: "DDIA", body: "Reminders are working. See you at study time.", url: "/" });
  if (!sent) throw new HttpError(400, "No device is subscribed. Turn on reminders first.");
  res.json({ ok: true, sent });
});

async function pushTo(u: number, payload: { title: string; body: string; url: string }) {
  const subs = db.prepare("SELECT endpoint, keys FROM push_subs WHERE user_id = ?").all(u) as { endpoint: string; keys: string }[];
  let sent = 0;
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, JSON.stringify(payload), { TTL: 6 * 3600 }); sent++; }
    catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) db.prepare("DELETE FROM push_subs WHERE endpoint = ?").run(s.endpoint);
      else console.error("[push]", code, (e as Error).message);
    }
  }
  return sent;
}

function hourIn(tz: string | null) {
  try { return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz ?? "UTC" }).format(new Date())); }
  catch { return new Date().getUTCHours(); }
}

/** Once a day at the user's reminder hour (their own time zone): the most useful nudge. */
async function reminderTick() {
  const users = db.prepare(`SELECT DISTINCT u.id, u.tz, u.reminder_hour, u.last_push_day, u.last_day, u.streak FROM users u JOIN push_subs p ON p.user_id = u.id`).all() as
    { id: number; tz: string | null; reminder_hour: number; last_push_day: string | null; last_day: string | null; streak: number }[];
  const today = localDay();
  for (const u of users) {
    if (u.last_push_day === today || hourIn(u.tz) !== u.reminder_hour) continue;
    const due = dueCount(u.id);
    const plan = buildPlan(u.id);
    let msg: { title: string; body: string; url: string } | null = null;
    if (u.last_day !== today && u.streak > 0) msg = { title: `Keep your ${u.streak}-day streak`, body: due ? `${due} reviews are due. Ten minutes keeps it alive.` : "A short session keeps it alive.", url: due ? "/review" : "/" };
    else if (due > 0) msg = { title: `${due} reviews due`, body: "Reviewing on time is what makes it stick.", url: "/review" };
    else if (plan.total && plan.done < plan.total) msg = { title: `Today's plan: ${plan.done}/${plan.total} done`, body: plan.tasks.find((t) => !t.done)?.label ?? "Keep going.", url: "/" };
    if (plan.daysLeft != null && plan.daysLeft > 0 && plan.daysLeft <= 14 && msg) msg.title = `${plan.daysLeft} days to go · ${msg.title}`;
    db.prepare("UPDATE users SET last_push_day = ? WHERE id = ?").run(today, u.id);
    if (msg) await pushTo(u.id, msg);
  }
}

/* ---------- backups ---------- */
const BACKUP_DIR = path.join(path.dirname(DB_PATH), "backups");
export function backupNow() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `ddia-${new Date().toISOString().slice(0, 10)}.sqlite`);
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^ddia-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 7))) fs.rmSync(path.join(BACKUP_DIR, f));
  return file;
}
async function emailBackup(file: string) {
  const key = process.env.RESEND_API_KEY, to = process.env.BACKUP_EMAIL;
  if (!key || !to) return false;
  const gz = zlib.gzipSync(fs.readFileSync(file));
  if (gz.length > 30 * 1024 * 1024) { console.error("[backup] too large to email"); return false; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.REPORT_FROM ?? "DDIA <onboarding@resend.dev>", to: [to],
      subject: `DDIA backup ${path.basename(file)}`,
      text: "Nightly database backup attached (gzip-compressed SQLite). To restore, gunzip it and set it as the database file.",
      attachments: [{ filename: path.basename(file) + ".gz", content: gz.toString("base64") }],
    }),
  });
  if (!r.ok) console.error("[backup] email failed", r.status, await r.text());
  return r.ok;
}
let lastBackupDay = "";
async function backupTick() {
  const d = new Date();
  const day = d.toISOString().slice(0, 10);
  if (d.getUTCHours() !== 3 || lastBackupDay === day) return;
  lastBackupDay = day;
  try { const f = backupNow(); const mailed = await emailBackup(f); console.log(`[backup] ${path.basename(f)}${mailed ? " (emailed)" : ""}`); }
  catch (e) { console.error("[backup] failed", e); }
}

export function startSchedulers() {
  const tick = () => { reminderTick().catch((e) => console.error("[push] tick", e)); backupTick().catch(() => {}); };
  setTimeout(tick, 30000);
  setInterval(tick, 10 * 60000).unref();
}

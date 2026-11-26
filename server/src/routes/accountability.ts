import { Router } from "express";
import { db } from "../db.js";
import { HttpError } from "../http.js";
import { localDay } from "../progress.js";

/* ============================================================
   Accountability: a weekly commitment (study days + minutes),
   daily kept/missed tracking, reflections on missed days, and an
   optional accountability partner who gets the weekly report and
   a heads-up after two missed planned days in a row.
   ============================================================ */

const cols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
const add = (c: string, def: string) => { if (!cols.includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${def}`); };
add("study_days", "TEXT");                 // JSON array of weekdays, 0 = Sunday
add("weekly_minutes", "INTEGER NOT NULL DEFAULT 300");
add("partner_name", "TEXT");
add("partner_email", "TEXT");
add("partner_alert_day", "TEXT");          // last day a missed-days alert was sent
add("commit_set_at", "INTEGER");           // when the commitment was made (days before don't count as missed)
db.exec(`
CREATE TABLE IF NOT EXISTS activity (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
CREATE TABLE IF NOT EXISTS reflections (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL, reason TEXT NOT NULL, plan TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
`);

const DAY = 86400000;
type Settings = { studyDays: number[]; weeklyMinutes: number; partnerName: string | null; partnerEmail: string | null; since: number | null };

export function settings(u: number): Settings {
  const r = db.prepare("SELECT study_days, weekly_minutes, partner_name, partner_email, commit_set_at FROM users WHERE id = ?").get(u) as
    { study_days: string | null; weekly_minutes: number; partner_name: string | null; partner_email: string | null; commit_set_at: number | null };
  return { studyDays: r.study_days ? JSON.parse(r.study_days) : [], weeklyMinutes: r.weekly_minutes, partnerName: r.partner_name, partnerEmail: r.partner_email, since: r.commit_set_at };
}

const dayTs = (d: string) => new Date(d + "T12:00:00").getTime();
const minutesOn = (u: number, d: string) => Math.round(((db.prepare("SELECT seconds FROM activity WHERE user_id = ? AND day = ?").get(u, d) as { seconds: number } | undefined)?.seconds ?? 0) / 60);

/** Status of the last `n` days (oldest first). A planned day is kept when you hit the daily share of your weekly target. */
export function history(u: number, n = 28) {
  const s = settings(u);
  const perDay = s.studyDays.length ? Math.max(10, Math.round(s.weeklyMinutes / s.studyDays.length)) : 0;
  const today = localDay();
  const sinceDay = s.since ? localDay(s.since) : null;
  const out: { day: string; weekday: number; planned: boolean; minutes: number; target: number; status: "kept" | "missed" | "today" | "rest" | "bonus" | "before" }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = localDay(Date.now() - i * DAY);
    const wd = new Date(dayTs(d)).getDay();
    const planned = s.studyDays.includes(wd);
    const minutes = minutesOn(u, d);
    let status: (typeof out)[number]["status"];
    if (!sinceDay || d < sinceDay) status = "before";
    else if (d === today) status = "today";
    else if (planned) status = minutes >= perDay ? "kept" : "missed";
    else status = minutes >= 10 ? "bonus" : "rest";
    out.push({ day: d, weekday: wd, planned, minutes, target: planned ? perDay : 0, status });
  }
  return { perDay, days: out };
}

export function summary(u: number) {
  const s = settings(u);
  const { perDay, days } = history(u, 56);
  const today = days[days.length - 1];
  // streak of kept planned days (skip rest days; today doesn't break it)
  let keptStreak = 0;
  for (let i = days.length - 2; i >= 0; i--) {
    const d = days[i];
    if (d.status === "kept") keptStreak++;
    else if (d.status === "missed" || d.status === "before") break;
  }
  if (today.status === "today" && today.planned && today.minutes >= perDay) keptStreak++;
  // this week (Mon-Sun)
  const now = new Date(); const dow = (now.getDay() + 6) % 7;
  const weekStart = localDay(Date.now() - dow * DAY);
  const week = days.filter((d) => d.day >= weekStart);
  const weekMinutes = week.reduce((a, d) => a + d.minutes, 0);
  const plannedSoFar = week.filter((d) => d.planned && d.status !== "before" && d.status !== "today").length;
  const keptSoFar = week.filter((d) => d.status === "kept").length;
  // the most recent missed planned day without a reflection
  const reflected = new Set((db.prepare("SELECT day FROM reflections WHERE user_id = ?").all(u) as { day: string }[]).map((r) => r.day));
  const unreflected = [...days].reverse().find((d) => d.status === "missed" && !reflected.has(d.day) && dayTs(d.day) > Date.now() - 7 * DAY);
  const recentMissed = (() => { let n = 0; for (let i = days.length - 2; i >= 0; i--) { const d = days[i]; if (d.status === "missed") n++; else if (d.status === "kept" || d.status === "bonus" || d.status === "before") break; } return n; })();
  const last28 = days.slice(-29, -1).filter((d) => d.planned && d.status !== "before");
  const keepRate = last28.length ? Math.round((last28.filter((d) => d.status === "kept").length / last28.length) * 100) : null;
  return {
    configured: s.studyDays.length > 0, settings: s, perDay,
    today: { planned: today.planned, minutes: today.minutes, target: today.planned ? perDay : 0, done: today.planned ? today.minutes >= perDay : true },
    week: { minutes: weekMinutes, target: s.weeklyMinutes, kept: keptSoFar, planned: plannedSoFar },
    keptStreak, keepRate, recentMissed, needsReflection: unreflected?.day ?? null,
    days: days.slice(-28),
  };
}

export const accountability = Router();
accountability.get("/accountability", (req, res) => res.json(summary(req.userId!)));
accountability.put("/accountability", (req, res) => {
  const b = req.body ?? {};
  const days = Array.isArray(b.studyDays) ? [...new Set((b.studyDays as unknown[]).map(Number).filter((d) => d >= 0 && d <= 6))].sort() : null;
  const mins = b.weeklyMinutes == null ? null : Number(b.weeklyMinutes);
  if (mins != null && !(mins >= 30 && mins <= 4000)) throw new HttpError(400, "Weekly minutes must be between 30 and 4000");
  const email = b.partnerEmail == null ? undefined : String(b.partnerEmail).trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "That partner email doesn't look right");
  const cur = settings(req.userId!);
  db.prepare("UPDATE users SET study_days = ?, weekly_minutes = ?, partner_name = ?, partner_email = ?, commit_set_at = COALESCE(commit_set_at, ?) WHERE id = ?").run(
    JSON.stringify(days ?? cur.studyDays), mins ?? cur.weeklyMinutes,
    b.partnerName === undefined ? cur.partnerName : (String(b.partnerName).trim().slice(0, 60) || null),
    email === undefined ? cur.partnerEmail : (email || null), Date.now(), req.userId);
  res.json(summary(req.userId!));
});
accountability.post("/accountability/reflect", (req, res) => {
  const day = String(req.body?.day ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, "Bad day");
  const reason = String(req.body?.reason ?? "").trim().slice(0, 200);
  if (!reason) throw new HttpError(400, "Pick or write a reason");
  db.prepare("INSERT OR REPLACE INTO reflections (user_id, day, reason, plan, created_at) VALUES (?, ?, ?, ?, ?)").run(req.userId, day, reason, String(req.body?.plan ?? "").slice(0, 300), Date.now());
  res.json(summary(req.userId!));
});
accountability.get("/accountability/reflections", (req, res) => {
  res.json(db.prepare("SELECT day, reason, plan FROM reflections WHERE user_id = ? ORDER BY day DESC LIMIT 30").all(req.userId));
});

/** Daily: if a partner is set and you missed 2+ planned days in a row, let them know (once per streak of misses). */
export async function partnerTick() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const users = db.prepare("SELECT id, username, partner_name, partner_email, partner_alert_day FROM users WHERE partner_email IS NOT NULL AND study_days IS NOT NULL").all() as
    { id: number; username: string; partner_name: string | null; partner_email: string; partner_alert_day: string | null }[];
  for (const u of users) {
    const s = summary(u.id);
    if (s.recentMissed < 2) continue;
    const lastMissStart = localDay(Date.now() - s.recentMissed * DAY);
    if (u.partner_alert_day && u.partner_alert_day >= lastMissStart) continue;
    db.prepare("UPDATE users SET partner_alert_day = ? WHERE id = ?").run(localDay(), u.id);
    const hi = u.partner_name ? `Hi ${u.partner_name},` : "Hi,";
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.REPORT_FROM ?? "DDIA <onboarding@resend.dev>", to: [u.partner_email],
        subject: `${u.username} has missed ${s.recentMissed} planned study days`,
        text: `${hi}\n\nYou're ${u.username}'s accountability partner for interview prep. They've missed ${s.recentMissed} planned study days in a row (this week: ${s.week.minutes} of ${s.week.target} minutes).\n\nA quick nudge from you goes a long way.\n\n- DDIA`,
      }),
    }).catch((e) => console.error("[partner]", e));
  }
}

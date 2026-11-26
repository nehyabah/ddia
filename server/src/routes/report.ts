import { Router } from "express";
import { db } from "../db.js";
import { levelInfo, localDay } from "../progress.js";
import { HttpError, chapterLabel, str } from "../http.js";
import { chapterLocks } from "./study.js";
import { computeReadiness } from "./readiness.js";
import { summary as commitSummary } from "./accountability.js";
import { javaDueCount } from "./java.js";

export const report = Router();
const DAY_MS = 86_400_000;

db.exec(`
CREATE TABLE IF NOT EXISTS activity (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
`);
for (const col of ["email TEXT", "weekly_email INTEGER NOT NULL DEFAULT 1", "last_report_week TEXT"]) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* already exists */ }
}

/* ---------- active time ---------- */

const lastPing = new Map<number, number>();

/**
 * The client pings every 30 s while the tab is visible and the user has interacted in the last minute.
 * The server only credits real elapsed time (max 40 s per ping), so a fast or duplicated client can't inflate it.
 */
report.post("/activity/ping", (req, res) => {
  const u = req.userId, t = Date.now();
  const prev = lastPing.get(u);
  lastPing.set(u, t);
  const elapsed = prev ? Math.round((t - prev) / 1000) : 15;
  const credit = Math.max(0, Math.min(40, elapsed));
  if (credit > 0) {
    db.prepare(`INSERT INTO activity (user_id, day, seconds) VALUES (?, ?, ?)
      ON CONFLICT (user_id, day) DO UPDATE SET seconds = seconds + excluded.seconds`).run(u, localDay(t), credit);
  }
  res.json({ ok: true });
});

/* ---------- weekly report ---------- */

/** Monday 00:00 local of the week containing ts. */
function weekStart(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  return d.getTime() - dow * DAY_MS;
}
const isoWeekKey = (ts: number) => localDay(weekStart(ts));

export function buildReport(u: number, weeksAgo = 0) {
  const start = weekStart(Date.now()) - weeksAgo * 7 * DAY_MS;
  const end = start + 7 * DAY_MS;
  const from = localDay(start), to = localDay(end - 1);
  const prevFrom = localDay(start - 7 * DAY_MS), prevTo = localDay(start - 1);
  const user = db.prepare("SELECT username, email, xp, streak, best_streak, daily_goal FROM users WHERE id = ?").get(u) as
    { username: string; email: string | null; xp: number; streak: number; best_streak: number; daily_goal: number };

  const days = Array.from({ length: 7 }, (_, i) => localDay(start + i * DAY_MS));
  const sum = (sql: string, ...args: (string | number)[]) => ((db.prepare(sql).get(...args) as { v: number | null }).v ?? 0);
  const perDay = (sql: string) => new Map((db.prepare(sql).all(u, from, to) as { day: string; v: number }[]).map((r) => [r.day, r.v]));

  const activeSec = sum("SELECT SUM(seconds) AS v FROM activity WHERE user_id = ? AND day BETWEEN ? AND ?", u, from, to);
  const prevActiveSec = sum("SELECT SUM(seconds) AS v FROM activity WHERE user_id = ? AND day BETWEEN ? AND ?", u, prevFrom, prevTo);
  const xp = sum("SELECT SUM(amount) AS v FROM xp_events WHERE user_id = ? AND day BETWEEN ? AND ? AND reason != 'import'", u, from, to);
  const prevXp = sum("SELECT SUM(amount) AS v FROM xp_events WHERE user_id = ? AND day BETWEEN ? AND ? AND reason != 'import'", u, prevFrom, prevTo);
  const secByDay = perDay("SELECT day, seconds AS v FROM activity WHERE user_id = ? AND day BETWEEN ? AND ?");
  const xpByDay = perDay("SELECT day, SUM(amount) AS v FROM xp_events WHERE user_id = ? AND day BETWEEN ? AND ? AND reason != 'import' GROUP BY day");

  const q = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS c FROM attempts WHERE user_id = ? AND day BETWEEN ? AND ?").get(u, from, to) as { n: number; c: number };
  const jv = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS c FROM java_attempts WHERE user_id = ? AND day BETWEEN ? AND ?").get(u, from, to) as { n: number; c: number };
  const cardsRead = sum("SELECT COUNT(*) AS v FROM card_progress WHERE user_id = ? AND seen_at BETWEEN ? AND ?", u, from, to);
  const ai = db.prepare("SELECT COUNT(*) AS n, AVG(score) AS avg, SUM(score >= 7) AS passed FROM ai_grades WHERE user_id = ? AND day BETWEEN ? AND ?").get(u, from, to) as { n: number; avg: number | null; passed: number | null };
  const puzzlesSolved = sum("SELECT COUNT(*) AS v FROM puzzle_progress WHERE user_id = ? AND solved = 1 AND solved_day BETWEEN ? AND ?", u, from, to);
  const javaSolvedNew = sum(`SELECT COUNT(DISTINCT challenge_id) AS v FROM java_attempts a WHERE user_id = ? AND correct = 1 AND day BETWEEN ? AND ?
    AND NOT EXISTS (SELECT 1 FROM java_attempts b WHERE b.user_id = a.user_id AND b.challenge_id = a.challenge_id AND b.correct = 1 AND b.day < ?)`, u, from, to, from);

  // Chapter progress: current mastery for chapters touched this week.
  const mastery = new Map((db.prepare(`
    SELECT q.chapter_id AS ch, COUNT(*) AS n, COALESCE(SUM(MIN(COALESCE(s.box, 0), 3)), 0) AS pts
    FROM questions q LEFT JOIN question_srs s ON s.question_id = q.id AND s.user_id = ? GROUP BY q.chapter_id
  `).all(u) as { ch: number; n: number; pts: number }[]).map((r) => [r.ch, Math.round((r.pts / (r.n * 3)) * 100)]));
  const touched = db.prepare(`
    SELECT c.id, c.tag, c.title, COUNT(a.id) AS answered, COALESCE(SUM(a.correct), 0) AS correct
    FROM attempts a JOIN questions q ON q.id = a.question_id JOIN chapters c ON c.id = q.chapter_id
    WHERE a.user_id = ? AND a.day BETWEEN ? AND ? GROUP BY c.id ORDER BY c.position
  `).all(u, from, to) as { id: number; tag: string | null; title: string; answered: number; correct: number }[];
  const chapters = touched.map((c) => ({ label: chapterLabel(c), title: c.title, answered: c.answered, accuracy: Math.round((c.correct / c.answered) * 100), mastery: mastery.get(c.id) ?? 0 }));

  // What needs work.
  const weakChapters = chapters.filter((c) => c.accuracy < 70).map((c) => `${c.label} ${c.title}: ${c.accuracy}% correct this week`);
  const weakJava = (db.prepare(`
    SELECT j.topic, j.level, COUNT(*) AS n, SUM(a.correct) AS c FROM java_attempts a JOIN java_challenges j ON j.id = a.challenge_id
    WHERE a.user_id = ? AND a.day BETWEEN ? AND ? GROUP BY j.level, j.topic HAVING n >= 2 AND c * 1.0 / n < 0.7 ORDER BY c * 1.0 / n LIMIT 4
  `).all(u, from, to) as { topic: string; level: string; n: number; c: number }[]).map((r) => `Java ${r.level} · ${r.topic}: ${r.c}/${r.n} correct`);
  const missedQs = (db.prepare(`
    SELECT q.prompt FROM question_srs s JOIN questions q ON q.id = s.question_id
    WHERE s.user_id = ? AND s.lapses >= 2 ORDER BY s.lapses DESC, s.updated_at DESC LIMIT 3
  `).all(u) as { prompt: string }[]).map((r) => r.prompt);
  const lowAi = (db.prepare(`SELECT kind, ref_id, MAX(score) AS best FROM ai_grades WHERE user_id = ? GROUP BY kind, ref_id HAVING best < 7 LIMIT 5`).all(u) as { kind: string; best: number }[]).length;

  const dueDdia = sum("SELECT COUNT(*) AS v FROM question_srs WHERE user_id = ? AND due_at <= ?", u, Date.now());
  const locks = chapterLocks(u);
  const allCh = db.prepare("SELECT id, tag, title FROM chapters ORDER BY position").all() as { id: number; tag: string | null; title: string }[];
  const current = allCh.find((c) => !c.tag && !locks.get(c.id)?.locked && (mastery.get(c.id) ?? 0) < 80);
  const nextSteps: string[] = [];
  if (dueDdia) nextSteps.push(`Clear ${dueDdia} DDIA review${dueDdia === 1 ? "" : "s"} that are due.`);
  const jd = javaDueCount(u);
  if (jd) nextSteps.push(`Re-solve ${jd} Java bug${jd === 1 ? "" : "s"} you missed.`);
  if (current) nextSteps.push(`Get ${chapterLabel(current)} (${current.title}) from ${mastery.get(current.id) ?? 0}% to 80% to unlock the next chapter.`);
  if (lowAi) nextSteps.push(`Rewrite ${lowAi} written answer${lowAi === 1 ? "" : "s"} that scored under 7/10.`);
  const goalDays = days.filter((d) => (xpByDay.get(d) ?? 0) >= user.daily_goal).length;

  // Interview prep this week (tables live in other modules; tolerate their absence).
  const safe = <T,>(f: () => T, d: T): T => { try { return f(); } catch { return d; } };
  const grades = (kind: string) => safe(() => db.prepare("SELECT COUNT(*) AS n, AVG(score) AS avg FROM ai_grades WHERE user_id = ? AND kind = ? AND day BETWEEN ? AND ?").get(u, kind, from, to) as { n: number; avg: number | null }, { n: 0, avg: null });
  const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
  const dg = grades("design"), sg = grades("story"), fg = grades("followup"), cg = grades("coding");
  const startMs = new Date(from + "T00:00:00").getTime(), endMs = new Date(to + "T23:59:59").getTime();
  const mocks = safe(() => db.prepare("SELECT COUNT(*) AS n, AVG(total) AS avg FROM mock_sessions WHERE user_id = ? AND finished_at BETWEEN ? AND ?").get(u, startMs, endMs) as { n: number; avg: number | null }, { n: 0, avg: null });
  const prep = {
    designSections: dg.n, designAvg: r1(dg.avg),
    codingSolved: safe(() => sum("SELECT COUNT(*) AS v FROM coding_progress WHERE user_id = ? AND solved_day BETWEEN ? AND ?", u, from, to), 0), codeReviews: cg.n,
    practicalSolved: safe(() => sum("SELECT COUNT(*) AS v FROM practical_progress WHERE user_id = ? AND solved_day BETWEEN ? AND ?", u, from, to), 0),
    mongoSolved: safe(() => sum("SELECT COUNT(*) AS v FROM mongo_progress WHERE user_id = ? AND solved_day BETWEEN ? AND ?", u, from, to), 0),
    storiesReviewed: sg.n, storyAvg: r1(sg.avg), followUps: fg.n, followUpAvg: r1(fg.avg),
    mocks: mocks.n, mockAvg: mocks.avg == null ? null : Math.round(mocks.avg),
  };
  const ready = safe(() => {
    const now = computeReadiness(u);
    const prev = db.prepare("SELECT overall FROM readiness_snapshots WHERE user_id = ? AND day < ? ORDER BY day DESC LIMIT 1").get(u, from) as { overall: number } | undefined;
    return { overall: now.overall, band: now.band, prev: prev?.overall ?? null, focus: now.focus.slice(0, 2).map((f) => f.label) };
  }, null);
  const commit = safe(() => {
    const c = commitSummary(u);
    if (!c.configured) return null;
    const inWeek = c.days.filter((d) => d.day >= from && d.day <= to && d.planned && d.status !== "before");
    return { kept: inWeek.filter((d) => d.status === "kept").length, planned: inWeek.length, targetMinutes: c.settings.weeklyMinutes, keptStreak: c.keptStreak };
  }, null);
  if (commit && commit.planned && commit.kept < commit.planned) nextSteps.push(`Keep all your planned study days (this week: ${commit.kept}/${commit.planned}).`);
  if (ready?.focus.length) nextSteps.push(`Focus on ${ready.focus.join(" and ")}: your weakest interview areas.`);
  if (!mocks.n) nextSteps.push("Do one timed mock interview.");
  if (goalDays < 5) nextSteps.push(`Hit your ${user.daily_goal} XP daily goal on at least 5 days (this week: ${goalDays}).`);

  return {
    user: { username: user.username, email: user.email },
    range: { from, to, label: `${new Date(start).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${new Date(end - 1).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` },
    totals: {
      activeMinutes: Math.round(activeSec / 60), prevActiveMinutes: Math.round(prevActiveSec / 60),
      xp, prevXp, daysActive: days.filter((d) => (secByDay.get(d) ?? 0) > 0 || (xpByDay.get(d) ?? 0) > 0).length, goalDays,
      questions: q.n, questionAccuracy: q.n ? Math.round((q.c / q.n) * 100) : null,
      javaAnswered: jv.n, javaAccuracy: jv.n ? Math.round((jv.c / jv.n) * 100) : null, javaSolvedNew,
      cardsRead, puzzlesSolved, aiGraded: ai.n, aiAvg: ai.avg != null ? Math.round(ai.avg * 10) / 10 : null, aiPassed: ai.passed ?? 0,
      streak: user.streak, bestStreak: user.best_streak, level: levelInfo(user.xp).level, totalXp: user.xp,
    },
    days: days.map((d) => ({ day: d, minutes: Math.round((secByDay.get(d) ?? 0) / 60), xp: xpByDay.get(d) ?? 0 })),
    chapters, prep, readiness: ready, commitment: commit,
    needsWork: [...weakChapters, ...weakJava, ...missedQs.map((p) => `Keep missing: “${p}”`)].slice(0, 8),
    nextSteps,
  };
}
export type Report = ReturnType<typeof buildReport>;

report.get("/report", (req, res) => {
  const weeksAgo = Math.max(0, Math.min(52, Number(req.query.weeksAgo ?? 0) || 0));
  res.json(buildReport(req.userId, weeksAgo));
});

/* ---------- email ---------- */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const delta = (now: number, prev: number) => (prev === 0 ? "" : ` (${now >= prev ? "+" : ""}${Math.round(((now - prev) / prev) * 100)}% vs last week)`);

export function renderReportHtml(r: Report, appUrl: string) {
  const t = r.totals;
  const stat = (v: string, l: string) => `<td style="padding:10px 12px;border:1px solid #E6E4E0;border-radius:10px;background:#fff"><div style="font:700 20px system-ui,sans-serif;color:#1D1C1A">${v}</div><div style="font:12px system-ui,sans-serif;color:#6E6B66">${l}</div></td>`;
  const maxM = Math.max(1, ...r.days.map((d) => d.minutes));
  const bars = r.days.map((d) => `<td style="vertical-align:bottom;text-align:center;font:11px system-ui,sans-serif;color:#6E6B66;padding:0 3px">
      <div style="height:${Math.round((d.minutes / maxM) * 60)}px;min-height:2px;background:#2457D6;border-radius:4px 4px 0 0"></div>
      ${new Date(d.day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })}<br>${d.minutes}m</td>`).join("");
  const list = (items: string[]) => items.length ? `<ul style="margin:6px 0 0;padding-left:20px">${items.map((i) => `<li style="margin:4px 0">${esc(i)}</li>`).join("")}</ul>` : `<p style="margin:6px 0 0;color:#6E6B66">Nothing flagged. 👏</p>`;
  return `<!doctype html><html><body style="margin:0;background:#F6F5F3;padding:24px 12px;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1D1C1A">
<div style="max-width:560px;margin:0 auto">
  <div style="font:700 12px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6E6B66">DDIA · weekly report · ${esc(r.range.label)}</div>
  <h1 style="font:800 26px system-ui,sans-serif;margin:6px 0 4px">${t.activeMinutes ? `${fmtMin(t.activeMinutes)} of focused study` : "A quiet week"}, ${esc(r.user.username)}</h1>
  <p style="margin:0 0 16px;color:#6E6B66">${t.daysActive}/7 days active · ${t.xp} XP${delta(t.xp, t.prevXp)} · streak ${t.streak} (best ${t.bestStreak}) · level ${t.level}</p>
  <table role="presentation" cellspacing="6" style="width:100%;border-collapse:separate"><tr>
    ${stat(fmtMin(t.activeMinutes), `active time${delta(t.activeMinutes, t.prevActiveMinutes)}`)}${stat(String(t.questions), `DDIA answers${t.questionAccuracy != null ? ` · ${t.questionAccuracy}%` : ""}`)}
  </tr><tr>
    ${stat(String(t.javaSolvedNew), `new Java bugs solved${t.javaAccuracy != null ? ` · ${t.javaAccuracy}%` : ""}`)}${stat(String(t.puzzlesSolved), "puzzles solved")}
  </tr><tr>
    ${stat(String(t.cardsRead), "cards read")}${stat(t.aiAvg != null ? `${t.aiAvg}/10` : "–", `avg AI grade · ${t.aiPassed}/${t.aiGraded} passed`)}
  </tr></table>
  ${renderPrepHtml(r)}
  <h2 style="font:700 16px system-ui,sans-serif;margin:22px 0 6px">Time on the platform</h2>
  <table role="presentation" style="width:100%;height:100px"><tr>${bars}</tr></table>
  ${r.chapters.length ? `<h2 style="font:700 16px system-ui,sans-serif;margin:22px 0 6px">Chapters you worked on</h2>
  <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${r.chapters.map((c) => `<tr><td style="padding:6px 0;border-bottom:1px solid #E6E4E0"><b>${esc(c.label)}</b> ${esc(c.title)}</td><td style="padding:6px 0;border-bottom:1px solid #E6E4E0;text-align:right;color:#6E6B66;white-space:nowrap">${c.accuracy}% correct · ${c.mastery}% mastered</td></tr>`).join("")}</table>` : ""}
  <h2 style="font:700 16px system-ui,sans-serif;margin:22px 0 6px">Needs work</h2>${list(r.needsWork)}
  <h2 style="font:700 16px system-ui,sans-serif;margin:22px 0 6px">Next week</h2>${list(r.nextSteps)}
  <p style="margin:24px 0 0"><a href="${appUrl}" style="display:inline-block;background:#2457D6;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:10px">Open DDIA</a></p>
  <p style="margin:18px 0 0;font-size:12px;color:#6E6B66">You get this every Sunday evening. Turn it off under You → Weekly email.</p>
</div></body></html>`;
}

function renderPrepHtml(r: Report) {
  const p = r.prep, rd = r.readiness, c = r.commitment;
  const row = (l: string, v: string) => `<tr><td style="padding:6px 0;border-bottom:1px solid #E6E4E0">${l}</td><td style="padding:6px 0;border-bottom:1px solid #E6E4E0;text-align:right;white-space:nowrap"><b>${v}</b></td></tr>`;
  const rows = [
    rd ? row("Interview readiness", `${rd.overall}/100 · ${esc(rd.band)}${rd.prev != null ? ` (${rd.overall - rd.prev >= 0 ? "+" : ""}${rd.overall - rd.prev})` : ""}`) : "",
    c ? row("Commitment", `${c.kept}/${c.planned} planned days kept`) : "",
    p.designSections ? row("Design sections reviewed", `${p.designSections}${p.designAvg != null ? ` · avg ${p.designAvg}/10` : ""}`) : "",
    p.codingSolved || p.codeReviews ? row("Coding", `${p.codingSolved} solved${p.codeReviews ? ` · ${p.codeReviews} code reviews` : ""}`) : "",
    p.practicalSolved ? row("Practical rounds solved", String(p.practicalSolved)) : "",
    p.mongoSolved ? row("MongoDB lab solved", String(p.mongoSolved)) : "",
    p.storiesReviewed ? row("Behavioural stories reviewed", `${p.storiesReviewed}${p.storyAvg != null ? ` · avg ${p.storyAvg}/10` : ""}`) : "",
    p.followUps ? row("Interviewer follow-ups", `${p.followUps}${p.followUpAvg != null ? ` · avg ${p.followUpAvg}/10` : ""}`) : "",
    p.mocks ? row("Mock interviews", `${p.mocks}${p.mockAvg != null ? ` · avg ${p.mockAvg}/100` : ""}`) : "",
  ].join("");
  return rows ? `<h2 style="font:700 16px system-ui,sans-serif;margin:22px 0 6px">Interview prep</h2><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>` : "";
}

const appUrl = () => process.env.APP_URL ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:5173");

export async function sendReport(u: number, weeksAgo = 0) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new HttpError(503, "Email isn't configured: add RESEND_API_KEY on the server");
  const r = buildReport(u, weeksAgo);
  if (!r.user.email) throw new HttpError(400, "Add your email address first");
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.REPORT_FROM ?? "DDIA <onboarding@resend.dev>",
      to: [r.user.email],
      ...(() => { const p = db.prepare("SELECT partner_email FROM users WHERE id = ?").get(u) as { partner_email?: string | null } | undefined; return p?.partner_email && process.env.REPORT_FROM ? { cc: [p.partner_email] } : {}; })(),
      subject: `Your DDIA week: ${r.totals.activeMinutes} min, ${r.totals.xp} XP (${r.range.label})`,
      html: renderReportHtml(r, appUrl()),
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error("[report] resend failed", resp.status, body);
    throw new HttpError(502, resp.status === 403 && /testing emails|verify a domain/i.test(body)
      ? "Resend's test sender can only email the address you signed up with. Verify a domain in Resend to email others."
      : `Email failed (${resp.status})`);
  }
  return r;
}

report.put("/me/email", (req, res) => {
  const email = str(req.body?.email ?? "", "email", 0, 200).trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "That doesn't look like an email address");
  const weekly = req.body?.weeklyEmail === false ? 0 : 1;
  db.prepare("UPDATE users SET email = ?, weekly_email = ? WHERE id = ?").run(email || null, weekly, req.userId);
  res.json({ email: email || null, weeklyEmail: !!weekly, configured: !!process.env.RESEND_API_KEY });
});

report.get("/me/email", (req, res) => {
  const r = db.prepare("SELECT email, weekly_email FROM users WHERE id = ?").get(req.userId) as { email: string | null; weekly_email: number };
  res.json({ email: r.email, weeklyEmail: !!r.weekly_email, configured: !!process.env.RESEND_API_KEY });
});

report.post("/report/send", async (req, res) => {
  const r = await sendReport(req.userId, Math.max(0, Number(req.body?.weeksAgo ?? 0) || 0));
  res.json({ sentTo: r.user.email });
});

/** Every hour: on Sunday from 18:00 (server time), send each opted-in user this week's report once. */
export function startWeeklyEmails() {
  const tick = async () => {
    if (!process.env.RESEND_API_KEY) return;
    const now = new Date();
    if (now.getDay() !== 0 || now.getHours() < 18) return;
    const week = isoWeekKey(now.getTime());
    const users = db.prepare("SELECT id FROM users WHERE email IS NOT NULL AND weekly_email = 1 AND (last_report_week IS NULL OR last_report_week != ?)").all(week) as { id: number }[];
    for (const { id } of users) {
      try {
        await sendReport(id, 0);
        db.prepare("UPDATE users SET last_report_week = ? WHERE id = ?").run(week, id);
        console.log(`[report] weekly email sent to user ${id}`);
      } catch (e) {
        console.error(`[report] weekly email for user ${id} failed:`, (e as Error).message);
      }
    }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 60 * 60_000);
}

import { db, content } from "./db.js";

export const BADGES: Record<string, string> = {
  ...content.badges,
  streak7: "7‑day streak",
  goal: "Hit the daily goal",
  reviewer: "Cleared the review queue",
  explainer: "Interview‑ready drill answer",
  bughunter: "Squashed a Java bug",
  eagle: "Pinpointed 10 bug lines exactly",
  javaexpert: "Solved an expert Java bug",
  puzzler: "Solved a systems puzzle",
  track_concurrency: "Concurrency track complete",
  track_resilience: "Rate limits & retries complete",
  track_distributed: "Distributed systems complete",
};

/** Days until the next review after a correct answer lands a question in box N. */
const INTERVAL_DAYS = [0, 1, 3, 7, 16, 35];
export const MAX_BOX = 5;
const DAY_MS = 86_400_000;
const RELEARN_MS = 10 * 60_000;

export const now = () => Date.now();

/** Calendar day in the server's local time zone, YYYY-MM-DD. */
export function localDay(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function levelInfo(xp: number) {
  let lvl = 1, need = 100, base = 0;
  while (xp >= base + need) { base += need; lvl++; need = Math.round(need * 1.35); }
  return { level: lvl, into: xp - base, need };
}

export function award(userId: number, badge: string): string | null {
  const r = db.prepare("INSERT OR IGNORE INTO badges (user_id, badge, earned_at) VALUES (?, ?, ?)")
    .run(userId, badge, localDay());
  return r.changes ? badge : null;
}

function touchStreak(userId: number) {
  const u = db.prepare("SELECT streak, best_streak, last_day FROM users WHERE id = ?").get(userId) as
    { streak: number; best_streak: number; last_day: string | null };
  const today = localDay();
  if (u.last_day === today) return;
  const yesterday = localDay(Date.now() - DAY_MS);
  const streak = u.last_day === yesterday ? u.streak + 1 : 1;
  db.prepare("UPDATE users SET streak = ?, best_streak = MAX(best_streak, ?), last_day = ? WHERE id = ?")
    .run(streak, streak, today, userId);
  if (streak >= 7) award(userId, "streak7");
}

export function xpToday(userId: number) {
  const r = db.prepare("SELECT COALESCE(SUM(amount), 0) AS xp FROM xp_events WHERE user_id = ? AND day = ?")
    .get(userId, localDay()) as { xp: number };
  return r.xp;
}

/** Adds XP, keeps the streak alive, returns any badges newly earned as a side effect. */
export function addXP(userId: number, amount: number, reason: string): string[] {
  if (amount <= 0) return [];
  db.prepare("INSERT INTO xp_events (user_id, amount, reason, day, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, amount, reason, localDay(), now());
  db.prepare("UPDATE users SET xp = xp + ? WHERE id = ?").run(amount, userId);
  const before = new Set(earnedBadges(userId));
  touchStreak(userId);
  const goal = (db.prepare("SELECT daily_goal FROM users WHERE id = ?").get(userId) as { daily_goal: number }).daily_goal;
  if (xpToday(userId) >= goal) award(userId, "goal");
  return earnedBadges(userId).filter((b) => !before.has(b));
}

export function earnedBadges(userId: number): string[] {
  return (db.prepare("SELECT badge FROM badges WHERE user_id = ?").all(userId) as { badge: string }[]).map((b) => b.badge);
}

/** Leitner-style scheduling: correct moves up a box and pushes the due date out; wrong resets to box 0. */
export function schedule(userId: number, questionId: number, correct: boolean, mode: string) {
  const t = now();
  const cur = db.prepare("SELECT box FROM question_srs WHERE user_id = ? AND question_id = ?")
    .get(userId, questionId) as { box: number } | undefined;
  const box = correct ? Math.min((cur?.box ?? 0) + 1, MAX_BOX) : 0;
  const due = correct ? t + INTERVAL_DAYS[box] * DAY_MS : t + RELEARN_MS;
  db.prepare(`
    INSERT INTO question_srs (user_id, question_id, box, due_at, reps, lapses, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT (user_id, question_id) DO UPDATE SET
      box = excluded.box, due_at = excluded.due_at, reps = reps + 1,
      lapses = lapses + excluded.lapses, updated_at = excluded.updated_at
  `).run(userId, questionId, box, due, correct ? 0 : 1, t);
  db.prepare("INSERT INTO attempts (user_id, question_id, correct, mode, day, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, questionId, correct ? 1 : 0, mode, localDay(t), t);
  return { box, dueAt: due };
}

/** Same definition as the original app: average of min(box, 3) / 3 across every question in the chapter. */
export function masteryByChapter(userId: number): Map<number, number> {
  const rows = db.prepare(`
    SELECT q.chapter_id AS ch, COUNT(*) AS n, COALESCE(SUM(MIN(COALESCE(s.box, 0), 3)), 0) AS pts
    FROM questions q
    LEFT JOIN question_srs s ON s.question_id = q.id AND s.user_id = ?
    GROUP BY q.chapter_id
  `).all(userId) as { ch: number; n: number; pts: number }[];
  return new Map(rows.map((r) => [r.ch, r.n ? Math.round((r.pts / (r.n * 3)) * 100) : 0]));
}

export function mastery(userId: number, chapterId: number) {
  return masteryByChapter(userId).get(chapterId) ?? 0;
}

export function dueCount(userId: number) {
  return (db.prepare("SELECT COUNT(*) AS n FROM question_srs WHERE user_id = ? AND due_at <= ?")
    .get(userId, now()) as { n: number }).n;
}

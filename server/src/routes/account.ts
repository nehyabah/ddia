import { Router } from "express";
import { db, contentId, tx } from "../db.js";
import { endSession, hashPassword, startSession, verifyPassword } from "../auth.js";
import { BADGES, MAX_BOX, dueCount, earnedBadges, levelInfo, localDay, xpToday } from "../progress.js";
import { HttpError, int, str } from "../http.js";

export const auth = Router();
export const account = Router();

auth.post("/auth/register", (req, res) => {
  const username = str(req.body?.username, "username", 3, 40).trim();
  const password = str(req.body?.password, "password", 8, 200);
  if (!/^[\w.@-]+$/.test(username)) throw new HttpError(400, "Username may only contain letters, numbers and . _ @ -");
  const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
  if (exists) throw new HttpError(409, "That username is taken");
  const r = db.prepare("INSERT INTO users (username, pw_hash) VALUES (?, ?)").run(username, hashPassword(password));
  startSession(res, Number(r.lastInsertRowid));
  res.status(201).json({ ok: true });
});

auth.post("/auth/login", (req, res) => {
  const username = str(req.body?.username, "username", 1, 40).trim();
  const password = str(req.body?.password, "password", 1, 200);
  const u = db.prepare("SELECT id, pw_hash FROM users WHERE username = ?").get(username) as
    { id: number; pw_hash: string } | undefined;
  if (!u || !verifyPassword(password, u.pw_hash)) throw new HttpError(401, "Wrong username or password");
  startSession(res, u.id);
  res.json({ ok: true });
});

auth.post("/auth/logout", (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

export function profile(userId: number) {
  const u = db.prepare("SELECT id, username, xp, streak, best_streak, last_day, daily_goal FROM users WHERE id = ?")
    .get(userId) as { id: number; username: string; xp: number; streak: number; best_streak: number; last_day: string | null; daily_goal: number };
  // A streak is only "live" if you studied today or yesterday.
  const yesterday = localDay(Date.now() - 86_400_000);
  const streak = u.last_day === localDay() || u.last_day === yesterday ? u.streak : 0;
  const earned = new Set(earnedBadges(userId));
  return {
    user: { id: u.id, username: u.username },
    xp: u.xp,
    ...levelInfo(u.xp),
    streak,
    bestStreak: u.best_streak,
    studiedToday: u.last_day === localDay(),
    xpToday: xpToday(userId),
    dailyGoal: u.daily_goal,
    dueCount: dueCount(userId),
    badges: Object.entries(BADGES).map(([id, label]) => ({ id, label, earned: earned.has(id) })),
  };
}

account.get("/me", (req, res) => {
  res.json(profile(req.userId));
});

account.put("/me/settings", (req, res) => {
  const goal = int(req.body?.dailyGoal, "dailyGoal", 10, 5000);
  db.prepare("UPDATE users SET daily_goal = ? WHERE id = ?").run(goal, req.userId);
  res.json(profile(req.userId));
});

account.post("/me/password", (req, res) => {
  const current = str(req.body?.current, "current", 1, 200);
  const next = str(req.body?.next, "next", 8, 200);
  const u = db.prepare("SELECT pw_hash FROM users WHERE id = ?").get(req.userId) as { pw_hash: string };
  if (!verifyPassword(current, u.pw_hash)) throw new HttpError(400, "Current password is wrong");
  db.prepare("UPDATE users SET pw_hash = ? WHERE id = ?").run(hashPassword(next), req.userId);
  res.json({ ok: true });
});

const PROGRESS_TABLES = ["card_progress", "question_srs", "attempts", "drill_progress", "badges", "boss_wins", "xp_events", "runs"];

account.post("/me/reset", (req, res) => {
  tx(() => {
    for (const t of PROGRESS_TABLES) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(req.userId);
    db.prepare("UPDATE users SET xp = 0, streak = 0, best_streak = 0, last_day = NULL WHERE id = ?").run(req.userId);
  });
  res.json(profile(req.userId));
});

/** Full JSON export of everything you've done, for backup. */
account.get("/me/export", (req, res) => {
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), profile: profile(req.userId) };
  for (const t of PROGRESS_TABLES) out[t] = db.prepare(`SELECT * FROM ${t} WHERE user_id = ?`).all(req.userId);
  res.setHeader("Content-Disposition", `attachment; filename="ddia-quest-export-${localDay()}.json"`);
  res.json(out);
});

/**
 * Import progress from the original single-file app (localStorage key "ddia-quest-v1").
 * Merges: keeps whichever box/XP/streak is higher.
 */
account.post("/me/import-legacy", (req, res) => {
  let data = req.body?.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { throw new HttpError(400, "That isn't valid JSON"); }
  }
  if (!data || typeof data !== "object" || typeof data.xp !== "number") {
    throw new HttpError(400, "Expected the JSON saved by the original DDIA Quest page");
  }
  const legacy = data as {
    xp: number; streak?: number; lastDay?: string | null;
    boxes?: Record<string, number>; seen?: Record<string, number>; badges?: Record<string, string>;
    bossWins?: Record<string, number>; drills?: Record<string, number>;
  };
  const parseKey = (k: string) => {
    const m = /^(\d+)-(\d+)$/.exec(k);
    return m ? contentId(Number(m[1]), Number(m[2])) : null;
  };
  const counts = { questions: 0, cards: 0, badges: 0, bossWins: 0, drills: 0 };
  const t = Date.now();
  const intervals = [0, 1, 3, 7, 16, 35];
  tx(() => {
    const qExists = db.prepare("SELECT 1 FROM questions WHERE id = ?");
    const cExists = db.prepare("SELECT 1 FROM cards WHERE id = ?");
    const dExists = db.prepare("SELECT 1 FROM drills WHERE id = ?");
    for (const [k, rawBox] of Object.entries(legacy.boxes ?? {})) {
      const id = parseKey(k);
      if (id == null || !qExists.get(id)) continue;
      const box = Math.max(0, Math.min(MAX_BOX, Math.round(Number(rawBox) || 0)));
      // Spread imported reviews over their interval so they don't all land on day one.
      const due = t + Math.round(Math.random() * intervals[box] * 86_400_000);
      db.prepare(`
        INSERT INTO question_srs (user_id, question_id, box, due_at, reps, lapses, updated_at)
        VALUES (?, ?, ?, ?, 1, 0, ?)
        ON CONFLICT (user_id, question_id) DO UPDATE SET box = MAX(box, excluded.box)
      `).run(req.userId, id, box, due, t);
      counts.questions++;
    }
    for (const k of Object.keys(legacy.seen ?? {})) {
      const id = parseKey(k);
      if (id == null || !cExists.get(id)) continue;
      db.prepare(`
        INSERT INTO card_progress (user_id, card_id, seen_at) VALUES (?, ?, ?)
        ON CONFLICT (user_id, card_id) DO UPDATE SET seen_at = COALESCE(seen_at, excluded.seen_at)
      `).run(req.userId, id, localDay());
      counts.cards++;
    }
    for (const [b, day] of Object.entries(legacy.badges ?? {})) {
      if (!(b in BADGES)) continue;
      counts.badges += db.prepare("INSERT OR IGNORE INTO badges (user_id, badge, earned_at) VALUES (?, ?, ?)")
        .run(req.userId, b, String(day || localDay())).changes as number;
    }
    for (const ch of Object.keys(legacy.bossWins ?? {})) {
      counts.bossWins += db.prepare("INSERT OR IGNORE INTO boss_wins (user_id, chapter_id, won_at) VALUES (?, ?, ?)")
        .run(req.userId, Number(ch), localDay()).changes as number;
    }
    for (const [k, level] of Object.entries(legacy.drills ?? {})) {
      const id = parseKey(k);
      if (id == null || !dExists.get(id)) continue;
      db.prepare(`
        INSERT INTO drill_progress (user_id, drill_id, level, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (user_id, drill_id) DO UPDATE SET level = MAX(level, excluded.level)
      `).run(req.userId, id, Number(level) || 0, localDay());
      counts.drills++;
    }
    const u = db.prepare("SELECT xp FROM users WHERE id = ?").get(req.userId) as { xp: number };
    if (legacy.xp > u.xp) {
      db.prepare("INSERT INTO xp_events (user_id, amount, reason, day, created_at) VALUES (?, ?, 'import', ?, ?)")
        .run(req.userId, legacy.xp - u.xp, legacy.lastDay ?? localDay(), t);
      db.prepare("UPDATE users SET xp = ? WHERE id = ?").run(legacy.xp, req.userId);
    }
    if (legacy.lastDay && (legacy.streak ?? 0) > 0) {
      db.prepare(`
        UPDATE users SET
          streak = CASE WHEN last_day IS NULL OR last_day < ? THEN ? ELSE streak END,
          last_day = CASE WHEN last_day IS NULL OR last_day < ? THEN ? ELSE last_day END,
          best_streak = MAX(best_streak, ?)
        WHERE id = ?
      `).run(legacy.lastDay, legacy.streak ?? 0, legacy.lastDay, legacy.lastDay, legacy.streak ?? 0, req.userId);
    }
  });
  res.json({ imported: counts, profile: profile(req.userId) });
});

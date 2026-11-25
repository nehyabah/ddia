import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
// On Railway, RAILWAY_VOLUME_MOUNT_PATH is set when a volume is attached, so the DB survives redeploys.
const DB_PATH = process.env.DB_PATH
  ?? (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "ddia.sqlite")
    : path.join(ROOT, "data", "ddia.sqlite"));
if (process.env.RAILWAY_ENVIRONMENT && !process.env.DB_PATH && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  console.warn("WARNING: no Railway volume attached; the database will be wiped on every deploy.");
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_day TEXT,
  daily_goal INTEGER NOT NULL DEFAULT 150,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Content (re-seeded from server/content/chapters.json on every start)
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY,
  tag TEXT,
  title TEXT NOT NULL,
  blurb TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  bullets TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  idx INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,
  answer INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  boss INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  idx INTEGER NOT NULL,
  term TEXT NOT NULL,
  meaning TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drills (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  idx INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  points TEXT NOT NULL
);

-- Per-user progress
CREATE TABLE IF NOT EXISTS card_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL,
  seen_at TEXT,
  starred INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  note_updated_at TEXT,
  PRIMARY KEY (user_id, card_id)
);
CREATE TABLE IF NOT EXISTS question_srs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL,
  box INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, question_id)
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  mode TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_user_day ON attempts(user_id, day);
CREATE TABLE IF NOT EXISTS drill_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drill_id INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  last_ratio REAL,
  last_answer TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  PRIMARY KEY (user_id, drill_id)
);
CREATE TABLE IF NOT EXISTS badges (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge TEXT NOT NULL,
  earned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, badge)
);
CREATE TABLE IF NOT EXISTS boss_wins (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL,
  won_at TEXT NOT NULL,
  PRIMARY KEY (user_id, chapter_id)
);
CREATE TABLE IF NOT EXISTS xp_events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS xp_user_day ON xp_events(user_id, day);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id INTEGER,
  mode TEXT NOT NULL,
  question_ids TEXT NOT NULL,
  pos INTEGER NOT NULL DEFAULT 0,
  combo INTEGER NOT NULL DEFAULT 0,
  best_combo INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  lives INTEGER,
  xp INTEGER NOT NULL DEFAULT 0,
  finished INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Java debugging track (content re-seeded from server/content/java/*.json on start)
CREATE TABLE IF NOT EXISTS java_challenges (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  topic TEXT NOT NULL,
  position INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS java_lessons (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  position INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS java_srs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL,
  box INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, challenge_id)
);
CREATE TABLE IF NOT EXISTS java_attempts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL,
  correct INTEGER NOT NULL,
  lines_exact INTEGER NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS java_lesson_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);
`);

/** Stable content ids: chapter * 1000 + index within chapter. */
export const contentId = (chapter: number, idx: number) => chapter * 1000 + idx;

type RawChapter = {
  id: number; tag?: string; title: string; blurb: string;
  cards?: { t: string; b: string[] }[];
  qs?: { q: string; o: string[]; a: number; e: string; boss?: boolean }[];
  terms?: [string, string][];
  drills?: { p: string; a: string[] }[];
};
export type ContentFile = { chapters: RawChapter[]; badges: Record<string, string> };

export const content: ContentFile = JSON.parse(
  fs.readFileSync(path.join(ROOT, "server", "content", "chapters.json"), "utf8"),
);

export function seedContent() {
  db.exec("BEGIN");
  try {
    for (const t of ["cards", "questions", "terms", "drills", "chapters"]) db.exec(`DELETE FROM ${t}`);
    const insCh = db.prepare("INSERT INTO chapters (id, tag, title, blurb, position) VALUES (?, ?, ?, ?, ?)");
    const insCard = db.prepare("INSERT INTO cards (id, chapter_id, idx, title, bullets) VALUES (?, ?, ?, ?, ?)");
    const insQ = db.prepare("INSERT INTO questions (id, chapter_id, idx, prompt, options, answer, explanation, boss) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const insT = db.prepare("INSERT INTO terms (id, chapter_id, idx, term, meaning) VALUES (?, ?, ?, ?, ?)");
    const insD = db.prepare("INSERT INTO drills (id, chapter_id, idx, prompt, points) VALUES (?, ?, ?, ?, ?)");
    content.chapters.forEach((c, pos) => {
      insCh.run(c.id, c.tag ?? null, c.title, c.blurb, pos);
      c.cards?.forEach((x, i) => insCard.run(contentId(c.id, i), c.id, i, x.t, JSON.stringify(x.b)));
      c.qs?.forEach((x, i) => insQ.run(contentId(c.id, i), c.id, i, x.q, JSON.stringify(x.o), x.a, x.e, x.boss ? 1 : 0));
      c.terms?.forEach((x, i) => insT.run(contentId(c.id, i), c.id, i, x[0], x[1]));
      c.drills?.forEach((x, i) => insD.run(contentId(c.id, i), c.id, i, x.p, JSON.stringify(x.a)));
    });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

// Isolated database for every run.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ddia-test-")), "t.sqlite");

const { db, seedContent } = await import("../src/db.js");
const { levelInfo, schedule, masteryByChapter } = await import("../src/progress.js");
const { seedJava } = await import("../src/routes/java.js");
const { seedPuzzles } = await import("../src/routes/puzzles.js");
const { content, loadPrep, sameResult } = await import("../src/routes/prep.js");
const { chapterLocks } = await import("../src/routes/study.js");
const { computeReadiness } = await import("../src/routes/readiness.js");
const { buildPlan } = await import("../src/routes/plan.js");
const { Aggregator, Query } = await import("mingo");

seedContent(); seedJava(); seedPuzzles(); loadPrep();
const newUser = (name: string) => Number(db.prepare("INSERT INTO users (username, pw_hash) VALUES (?, 'x')").run(name).lastInsertRowid);

test("levels grow by 35% per level", () => {
  assert.deepEqual(levelInfo(0), { level: 1, into: 0, need: 100 });
  assert.equal(levelInfo(100).level, 2);
  assert.equal(levelInfo(100).need, 135);
});

test("spaced repetition: correct answers climb boxes, a miss resets", () => {
  const u = newUser("srs");
  const q = (db.prepare("SELECT id FROM questions LIMIT 1").get() as { id: number }).id;
  schedule(u, q, true, "quiz"); schedule(u, q, true, "quiz");
  assert.equal((db.prepare("SELECT box FROM question_srs WHERE user_id = ? AND question_id = ?").get(u, q) as { box: number }).box, 2);
  schedule(u, q, false, "quiz");
  assert.equal((db.prepare("SELECT box FROM question_srs WHERE user_id = ? AND question_id = ?").get(u, q) as { box: number }).box, 0);
});

test("chapter locks: only the first chapter of each track is open for a new user", () => {
  const u = newUser("locks");
  const locks = chapterLocks(u);
  assert.equal(locks.get(1)?.locked, false);
  assert.equal(locks.get(2)?.locked, true);
  assert.equal(locks.get(13)?.locked, false, "MongoDB track starts unlocked");
});

test("chapter locks: 80% mastery on a chapter unlocks the next", () => {
  const u = newUser("unlock");
  const now = Date.now();
  for (const { id } of db.prepare("SELECT id FROM questions WHERE chapter_id = 1").all() as { id: number }[])
    db.prepare("INSERT INTO question_srs (user_id, question_id, box, due_at, reps, lapses, updated_at) VALUES (?, ?, 3, ?, 3, 0, ?)").run(u, id, now, now);
  assert.equal(masteryByChapter(u).get(1), 100);
  assert.equal(chapterLocks(u).get(2)?.locked, false);
});

test("readiness: a new user is 0 and 'Not started'", () => {
  const r = computeReadiness(newUser("fresh"));
  assert.equal(r.overall, 0);
  assert.equal(r.band, "Not started");
  for (const id of ["design", "coding", "behavioral"]) assert.ok(r.areas.some((a) => a.id === id), `area ${id}`);
});

test("readiness: evidence raises the right area and respects the weakest-area cap", () => {
  const u = newUser("evidence");
  const now = Date.now(), day = new Date().toISOString().slice(0, 10);
  for (const { id } of db.prepare("SELECT id FROM questions WHERE chapter_id IN (5, 14)").all() as { id: number }[]) {
    db.prepare("INSERT INTO question_srs (user_id, question_id, box, due_at, reps, lapses, updated_at) VALUES (?, ?, 3, ?, 3, 0, ?)").run(u, id, now, now);
    db.prepare("INSERT INTO attempts (user_id, question_id, correct, mode, day, created_at) VALUES (?, ?, 1, 'quiz', ?, ?)").run(u, id, day, now);
  }
  const r = computeReadiness(u);
  const rep = r.areas.find((a) => a.id === "replication")!;
  assert.ok(rep.score >= 50, `replication ${rep.score}`);
  assert.equal(r.areas.find((a) => a.id === "sharding")!.score, 0);
  assert.ok(r.overall <= 20, "capped near the weakest core area");
  assert.ok(r.uncapped >= r.overall);
});

test("readiness: company weights change the overall", () => {
  const u = newUser("company");
  const now = Date.now();
  for (const { id } of db.prepare("SELECT id FROM questions WHERE chapter_id IN (5, 6, 7, 9)").all() as { id: number }[])
    db.prepare("INSERT INTO question_srs (user_id, question_id, box, due_at, reps, lapses, updated_at) VALUES (?, ?, 3, ?, 3, 0, ?)").run(u, id, now, now);
  const ids = content.companies.map((c) => c.id);
  assert.ok(ids.includes("mongodb") && ids.includes("microsoft") && ids.includes("stripe"), ids.join());
  const m = computeReadiness(u, "mongodb"), s = computeReadiness(u, "stripe");
  const w = (r: typeof m, id: string) => r.areas.find((a) => a.id === id)!.weight;
  assert.equal(w(m, "mongodb"), content.companies.find((c) => c.id === "mongodb")!.weights.mongodb);
  assert.equal(w(s, "mongodb"), content.companies.find((c) => c.id === "stripe")!.weights.mongodb);
  assert.notEqual(w(m, "mongodb"), w(s, "mongodb"));
});

test("plan: produces tasks and a countdown when an interview date is set", () => {
  const u = newUser("plan");
  const d = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  db.prepare("UPDATE users SET interview_date = ? WHERE id = ?").run(d, u);
  const p = buildPlan(u);
  assert.ok(p.total >= 1);
  assert.ok(p.daysLeft! >= 9 && p.daysLeft! <= 11);
  assert.equal(p.intensity, "push");
});

test("content: every coding reference solution passes its tests", () => {
  assert.ok(content.coding.length >= 30, `coding ${content.coding.length}`);
  const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
  for (const p of content.coding) for (const t of p.tests) {
    const got = new Function(`${p.solution.js}\nreturn (${t.call});`)();
    assert.equal(canon(got), canon(t.expected), `${p.id} / ${t.name}`);
  }
});

test("content: every MongoDB lab solution produces its expected result", () => {
  const data = content.datasets as Record<string, Record<string, unknown>[]>;
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  const opts = { collectionResolver: (n: string) => clone(data[n] ?? []) };
  for (const e of content.mongo) {
    if (e.kind === "choice") { assert.ok(e.options![e.answer!], e.id); continue; }
    const docs = clone(data[e.collection!]);
    let out: unknown[];
    if (e.kind === "aggregate") out = new Aggregator(e.solution as never[], opts).run(docs) as unknown[];
    else {
      const s = e.solution as { filter?: object; projection?: object | null; sort?: object | null; limit?: number | null };
      let c = new Query((s.filter ?? {}) as never, opts).find(docs as never[], (s.projection ?? undefined) as never);
      if (s.sort) c = c.sort(s.sort as never);
      if (s.limit) c = c.limit(s.limit);
      out = c.all() as unknown[];
    }
    assert.ok(sameResult(out, e.expected!, !!e.orderMatters), e.id);
  }
});

test("content: design prompts all have 7 sections with key points", () => {
  assert.ok(content.design.length >= 24);
  for (const p of content.design) {
    assert.deepEqual(p.sections.map((s) => s.key), ["requirements", "api", "data", "architecture", "scale", "failures", "tradeoffs"], p.id);
    for (const s of p.sections) assert.ok(s.keyPoints.length >= 3, `${p.id}:${s.key}`);
  }
});

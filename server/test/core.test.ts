import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

// Deliberately buggy practical code can leave rejected promises behind; they are not test failures.
process.on("unhandledRejection", () => {});

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
const { summary: commit } = await import("../src/routes/accountability.js");
const { practical, loadPractical } = await import("../src/routes/prep.js");
const { Aggregator, Query } = await import("mingo");

seedContent(); seedJava(); seedPuzzles(); loadPrep(); loadPractical();
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
  const KEYS: Record<string, string[]> = {
    system: ["requirements", "api", "data", "architecture", "scale", "failures", "tradeoffs"],
    ood: ["requirements", "entities", "relationships", "methods", "patterns", "concurrency"],
    api: ["resources", "endpoints", "requests", "pagination", "versioning", "security"],
  };
  for (const p of content.design) {
    assert.deepEqual(p.sections.map((s) => s.key), KEYS[p.type ?? "system"], p.id);
    for (const s of p.sections) assert.ok(s.keyPoints.length >= 3, `${p.id}:${s.key}`);
  }
});

test("accountability: kept vs missed planned days and the kept streak", () => {
  const u = newUser("commit");
  const DAY = 86400000;
  const day = (n: number) => { const d = new Date(Date.now() - n * DAY); const p = (x: number) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  db.prepare("UPDATE users SET study_days = ?, weekly_minutes = 700, commit_set_at = ? WHERE id = ?").run(JSON.stringify([0, 1, 2, 3, 4, 5, 6]), Date.now() - 10 * DAY, u);
  // 100 min/day target; kept yesterday and the day before, missed 3 days ago
  for (const [n, min] of [[1, 120], [2, 100], [3, 5]] as const) db.prepare("INSERT INTO activity (user_id, day, seconds) VALUES (?, ?, ?)").run(u, day(n), min * 60);
  const c = commit(u);
  assert.equal(c.perDay, 100);
  assert.equal(c.keptStreak, 2);
  assert.equal(c.days.find((d) => d.day === day(3))!.status, "missed");
  assert.ok(c.needsReflection, "a recent missed day asks for a reflection");
});

test("content: practical rounds - fixed files and solutions pass", async () => {
  const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
  const runAll = async (code: string, tests: { call: string; expected: unknown }[]) => {
    let ok = 0;
    for (const t of tests) { try { let g = new Function(`${code}
return (${t.call});`)(); if (g && typeof g.then === "function") g = await g; if (canon(g) === canon(t.expected)) ok++; } catch { /* fails */ } }
    return ok;
  };
  for (const p of practical) {
    if (p.kind === "bugsquash") {
      const join = (fs: { code: string }[]) => fs.map((f) => f.code).join("\n");
      assert.equal(await runAll(join(p.fixedFiles!), p.tests), p.tests.length, `${p.id} fixed`);
    } else {
      assert.equal(await runAll(`${p.fakeApi}\n${p.solution}`, p.tests), p.tests.length, `${p.id} solution`);
    }
  }
});

test("voice: delivery stats count pace and filler words", async () => {
  const { delivery, readSpoken } = await import("../src/delivery.js");
  assert.equal(readSpoken({ seconds: 1, words: 2 }), null);
  const text = "Um so basically you know the leader like replicates the oplog um to secondaries";
  const d = delivery(text, { seconds: 6, words: 14 });
  assert.equal(d.wpm, 140);
  assert.equal(d.fillers, 5);
  assert.equal(d.topFillers[0].word, "um");
  assert.ok(d.notes.some((n) => /filler/i.test(n)));
});

test("plan and readiness never send you to a locked chapter", () => {
  const u = newUser("locked-plan");
  const locks = chapterLocks(u);
  const locked = (to: string) => { const m = /^\/chapter\/(\d+)/.exec(to); return !!m && !!locks.get(Number(m[1]))?.locked; };
  const p = buildPlan(u);
  assert.ok(p.tasks.length > 0);
  for (const t of p.tasks) assert.ok(!locked(t.to), `plan task ${t.id} -> ${t.to}`);
  assert.ok(p.tasks.some((t) => t.id === "unlock-1"), "the chapter you are unlocking is on the plan");
  for (const a of computeReadiness(u).areas) assert.ok(!locked(a.action.to), `readiness ${a.id} -> ${a.action.to}`);
});

test("coding reviews: solving schedules a re-solve; passing pushes it out, failing brings it back", async () => {
  const { scheduleCoding, codingDue } = await import("../src/routes/prep.js");
  const u = newUser("code-srs");
  const s1 = scheduleCoding(u, "code-01", true);
  assert.equal(s1.box, 1);
  assert.equal(codingDue(u), 0, "not due until tomorrow");
  db.prepare("UPDATE coding_srs SET due_at = ? WHERE user_id = ?").run(Date.now() - 1000, u);
  assert.equal(codingDue(u), 1);
  const s2 = scheduleCoding(u, "code-01", true);
  assert.equal(s2.box, 2);
  assert.ok(s2.due - Date.now() > 2.5 * 86400000, "next review ~3 days out");
  const s3 = scheduleCoding(u, "code-01", false);
  assert.equal(s3.box, 1, "a failed re-solve resets");
});

test("roadmap: six months with targets, milestones and an honest status", async () => {
  const { roadmap } = await import("../src/routes/career.js");
  const u = newUser("roadmap");
  const r = roadmap(u);
  assert.equal(r.months.length, 6);
  assert.equal(r.totalWeeks, 26);
  assert.ok(r.months.every((m, i) => i === 0 || m.target > r.months[i - 1].target), "targets rise");
  assert.equal(r.current, 0);
  assert.ok(["ahead", "on track", "slightly behind", "behind"].includes(r.status));
  for (const m of r.months) for (const c of m.checks) assert.ok(c.have <= c.need && c.need > 0, `${m.title}: ${c.label}`);
});

test("applications: the next interview round drives the plan countdown and a prep task", async () => {
  const { nextInterview } = await import("../src/routes/career.js");
  const u = newUser("apps");
  const now = Date.now();
  const app = Number(db.prepare("INSERT INTO applications (user_id, company, role, stage, created_at, updated_at) VALUES (?, 'Stripe', 'SWE', 'screen', ?, ?)").run(u, now, now).lastInsertRowid);
  const day = (n: number) => { const d = new Date(now + n * 86400000); const p = (x: number) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  db.prepare("INSERT INTO app_rounds (user_id, app_id, kind, at) VALUES (?, ?, 'Phone screen', ?)").run(u, app, day(5));
  assert.equal(nextInterview(u)?.company, "Stripe");
  const p = buildPlan(u);
  assert.ok(p.daysLeft! >= 4 && p.daysLeft! <= 6, `daysLeft ${p.daysLeft}`);
  assert.ok(p.tasks.some((t) => t.id === "interview-prep" && t.to === "/companies/stripe"));
});

test("content: estimation answers, deep dive and networking/OS chapters load", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const est = JSON.parse(fs.readFileSync(path.join(process.cwd(), "server/content/estimation.json"), "utf8"));
  assert.ok(est.drills.length >= 30);
  for (const d of est.drills) assert.ok(d.answer > 0 && d.tolerance >= 1.5 && d.steps.length >= 2, d.id);
  const dd = JSON.parse(fs.readFileSync(path.join(process.cwd(), "server/content/deepdive.json"), "utf8"));
  assert.equal(dd.sections.length, 8);
  for (const c of ["mongodb", "microsoft", "stripe"]) assert.ok(dd.companies[c].askThem.length >= 8, c);
  if (fs.existsSync(path.join(process.cwd(), "server/content/fundamentals.json"))) {
    const u = newUser("net-track");
    const locks = chapterLocks(u);
    assert.equal(locks.get(19)?.locked, false, "Networking I opens its own track");
    assert.equal(locks.get(21)?.locked, false, "OS I opens its own track");
    assert.equal(locks.get(20)?.locked, true, "Networking II waits for Networking I");
  }
});

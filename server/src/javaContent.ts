import fs from "node:fs";
import path from "node:path";

export const LEVELS = ["beginner", "intermediate", "advanced", "expert"] as const;
export type Level = (typeof LEVELS)[number];

export type Challenge = {
  id: string; level: Level; topic: string; title: string;
  kind: "bug" | "output" | "trace";
  scenario: string; symptom?: string; code: string; bugLines: number[];
  question: string; options: string[]; answer: number;
  explanation: string; fix: string; fixNote: string; debugTip: string;
  buggyOutput?: string; throws?: string; fixedOutput?: string; deterministic?: boolean;
};

export type Lesson = { id: string; level: Level; title: string; body: string[]; example?: string };

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Returns a list of problems; empty means the challenge is usable. */
export function validateChallenge(c: Partial<Challenge>): string[] {
  const p: string[] = [];
  if (!isStr(c.id)) p.push("missing id");
  if (!LEVELS.includes(c.level as Level)) p.push(`bad level ${c.level}`);
  for (const k of ["topic", "title", "scenario", "code", "question", "explanation", "fix", "fixNote", "debugTip"] as const) {
    if (!isStr(c[k])) p.push(`missing ${k}`);
  }
  if (!["bug", "output", "trace"].includes(c.kind as string)) p.push(`bad kind ${c.kind}`);
  if (!Array.isArray(c.options) || c.options.length !== 4 || !c.options.every(isStr)) p.push("options must be 4 strings");
  if (!Number.isInteger(c.answer) || (c.answer as number) < 0 || (c.answer as number) > 3) p.push("answer must be 0-3");
  const lines = isStr(c.code) ? c.code.split("\n").length : 0;
  if (!Array.isArray(c.bugLines) || c.bugLines.length === 0 || !c.bugLines.every((n) => Number.isInteger(n) && n >= 1 && n <= lines)) {
    p.push(`bugLines out of range (code has ${lines} lines): ${JSON.stringify(c.bugLines)}`);
  }
  if (isStr(c.code) && !/public\s+class\s+Main\b/.test(c.code)) p.push("code lacks public class Main");
  if (isStr(c.fix) && !/public\s+class\s+Main\b/.test(c.fix)) p.push("fix lacks public class Main");
  if (isStr(c.code) && c.code === c.fix) p.push("fix identical to code");
  return p;
}

export function loadJavaContent(dir: string, log = console.warn) {
  const challenges: Challenge[] = [];
  const lessons: Lesson[] = [];
  if (!fs.existsSync(dir)) return { challenges, lessons };
  const seen = new Set<string>();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) {
    let arr: unknown;
    try {
      arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch (e) {
      log(`[java] ${f}: invalid JSON, skipped (${(e as Error).message})`);
      continue;
    }
    if (!Array.isArray(arr)) { log(`[java] ${f}: not an array, skipped`); continue; }
    if (f.startsWith("lessons")) {
      for (const l of arr as Lesson[]) {
        if (!isStr(l?.id) || !LEVELS.includes(l.level) || !isStr(l.title) || !Array.isArray(l.body)) {
          log(`[java] ${f}: bad lesson ${l?.id}, skipped`); continue;
        }
        if (seen.has(l.id)) { log(`[java] duplicate id ${l.id}, skipped`); continue; }
        seen.add(l.id); lessons.push(l);
      }
    } else {
      for (const c of arr as Challenge[]) {
        const problems = validateChallenge(c);
        if (problems.length) { log(`[java] ${f}: ${c?.id ?? "?"} skipped: ${problems.join("; ")}`); continue; }
        if (seen.has(c.id)) { log(`[java] duplicate id ${c.id}, skipped`); continue; }
        seen.add(c.id); challenges.push(c);
      }
    }
  }
  const lvl = (l: Level) => LEVELS.indexOf(l);
  challenges.sort((a, b) => lvl(a.level) - lvl(b.level));
  lessons.sort((a, b) => lvl(a.level) - lvl(b.level));
  return { challenges, lessons };
}

// Validates every Java challenge/lesson file. Usage: npm run check:java
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJavaContent } from "../server/src/javaContent.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "content", "java");
const problems = [];
const { challenges, lessons } = loadJavaContent(dir, (m) => problems.push(m));
const wide = [];
for (const c of challenges) {
  const tooLong = c.code.split("\n").length > 35;
  const maxW = Math.max(...c.code.split("\n").map((l) => l.length));
  if (tooLong || maxW > 70) wide.push(`${c.id}: ${c.code.split("\n").length} lines, widest ${maxW} chars`);
}
const byLevel = {};
for (const c of challenges) byLevel[c.level] = (byLevel[c.level] ?? 0) + 1;
console.log(`challenges: ${challenges.length}`, byLevel, `lessons: ${lessons.length}`);
const answers = [0, 1, 2, 3].map((k) => challenges.filter((c) => c.answer === k).length);
console.log("answer position spread:", answers.join(" / "));
if (wide.length) console.log("too big for phones:\n  " + wide.join("\n  "));
if (problems.length) { console.log("PROBLEMS:\n  " + problems.join("\n  ")); process.exitCode = 1; }
else console.log("all valid");

// Compiles and runs every challenge's buggy and fixed program, comparing stdout
// with buggyOutput / fixedOutput. Needs a JDK (javac + java) on PATH.
// Usage: npm run verify:java [-- <id-prefix>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadJavaContent } from "../server/src/javaContent.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "content", "java");
const { challenges } = loadJavaContent(dir);
const only = process.argv[2];
const norm = (s) => (s ?? "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
if (spawnSync("javac", ["-version"]).status !== 0) { console.error("javac not found on PATH"); process.exit(2); }

let ok = 0; const bad = [];
for (const c of challenges.filter((c) => !only || c.id.startsWith(only))) {
  for (const [variant, src, expected] of [["code", c.code, c.buggyOutput], ["fix", c.fix, c.fixedOutput]]) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "jv-"));
    fs.writeFileSync(path.join(work, "Main.java"), src);
    const comp = spawnSync("javac", ["-g", "Main.java"], { cwd: work, encoding: "utf8" });
    if (comp.status !== 0) { bad.push(`${c.id} ${variant}: COMPILE ERROR\n${comp.stderr}`); continue; }
    const run = spawnSync("java", ["-cp", ".", "Main"], { cwd: work, encoding: "utf8", timeout: 10_000 });
    const threw = /Exception in thread|Error/.test(run.stderr ?? "");
    if (variant === "code" && c.throws && !(run.stderr ?? "").includes(c.throws)) bad.push(`${c.id} code: expected to throw ${c.throws}, stderr: ${norm(run.stderr).slice(0, 200)}`);
    if (variant === "fix" && threw) bad.push(`${c.id} fix: threw\n${norm(run.stderr).slice(0, 300)}`);
    if (c.deterministic !== false && expected != null && norm(run.stdout) !== norm(expected)) {
      bad.push(`${c.id} ${variant}: output mismatch\n  expected: ${JSON.stringify(norm(expected))}\n  actual:   ${JSON.stringify(norm(run.stdout))}`);
    }
    fs.rmSync(work, { recursive: true, force: true });
  }
  ok++;
}
console.log(`checked ${ok} challenges, ${bad.length} problems`);
for (const b of bad) console.log("- " + b);
process.exitCode = bad.length ? 1 : 0;

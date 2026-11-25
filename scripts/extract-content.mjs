// One-off: pull the CHAPTERS/BADGES data out of the original ddia-quest.html into JSON.
import fs from "node:fs";
import vm from "node:vm";
const src = process.argv[2] ?? "ddia-quest.html";
const out = process.argv[3] ?? "server/content/chapters.json";
const html = fs.readFileSync(src, "utf8");
const start = html.indexOf("const CHAPTERS = [");
const end = html.indexOf("/* ===================== STATE");
if (start < 0 || end < 0) throw new Error("Could not locate content block");
const code = html.slice(start, end).replace("const CHAPTERS", "globalThis.CHAPTERS").replace("const BADGES", "globalThis.BADGES");
const ctx = {}; vm.createContext(ctx); vm.runInContext(code, ctx);
fs.writeFileSync(out, JSON.stringify({ chapters: ctx.CHAPTERS, badges: ctx.BADGES }, null, 2));
const c = ctx.CHAPTERS;
console.log(`chapters=${c.length} cards=${c.reduce((s,x)=>s+(x.cards?.length||0),0)} qs=${c.reduce((s,x)=>s+(x.qs?.length||0),0)} boss=${c.reduce((s,x)=>s+(x.qs?.filter(q=>q.boss).length||0),0)} terms=${c.reduce((s,x)=>s+(x.terms?.length||0),0)} drills=${c.reduce((s,x)=>s+(x.drills?.length||0),0)}`);
console.log(c.map(x=>`${x.id}${x.tag?"/"+x.tag:""} keys=${Object.keys(x).join(",")}`).join("\n"));

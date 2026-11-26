import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { ROOT, seedContent } from "./db.js";
import { requireUser } from "./auth.js";
import { HttpError } from "./http.js";
import { account, auth } from "./routes/account.js";
import { study } from "./routes/study.js";
import { insights } from "./routes/insights.js";
import { java, seedJava } from "./routes/java.js";
import { ai } from "./routes/ai.js";
import { puzzles, seedPuzzles } from "./routes/puzzles.js";
import { report, startWeeklyEmails } from "./routes/report.js";
import { readiness } from "./routes/readiness.js";
import { loadPractical, loadPrep, prep } from "./routes/prep.js";
import { plan } from "./routes/plan.js";
import { notify, startSchedulers } from "./routes/notify.js";
import { accountability } from "./routes/accountability.js";
import { history } from "./routes/history.js";
import { tts } from "./routes/tts.js";

seedContent();
seedJava();
seedPuzzles();
startWeeklyEmails();
loadPrep();
loadPractical();
startSchedulers();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});
app.use("/api", auth);
app.use("/api", requireUser, account, study, insights, java, ai, puzzles, report, readiness, prep, plan, notify, accountability, history, tts);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// In production, serve the built client and let React Router handle deep links.
const dist = path.join(ROOT, "client", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err && typeof err === "object" && "type" in err && err.type === "entity.parse.failed") {
    res.status(400).json({ error: "Malformed JSON body" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? (process.env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1");
app.listen(port, host, () => {
  console.log(`DDIA API listening on http://${host}:${port}`);
});

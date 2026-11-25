# DDIA Quest

A full-stack study app for *Designing Data-Intensive Applications*. It started as the single file `ddia-quest.html` and is now a Node/Express + SQLite API with a React frontend.

## Run it

Requires Node 22.13 or newer (it uses the built-in `node:sqlite`, so there's nothing native to compile).

```bash
npm install
npm run dev        # API on :3001 + Vite on http://localhost:5173 (hot reload)
```

Production-style (one process, one port):

```bash
npm run build
npm start          # http://127.0.0.1:3001
```

Your data lives in `data/ddia.sqlite`. Back up that file, or use **Settings → Download backup**.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | API/server port |
| `HOST` | `127.0.0.1` | Set to `0.0.0.0` to reach it from your phone on the same network |
| `DB_PATH` | `data/ddia.sqlite` | SQLite file location |
| `COOKIE_SECURE` | unset (`true` on Railway) | Set to `true` when served over HTTPS |

## Deploy to Railway

`railway.json` already holds the build, start and healthcheck settings.

1. In Railway, create a new project with **Deploy from GitHub repo** and pick this repo. Every push to `main` redeploys.
2. **Add a volume** to the service, mounted at `/data`. This is required: without it, the SQLite database (all accounts and progress) is wiped on every deploy. The app finds the volume automatically through `RAILWAY_VOLUME_MOUNT_PATH`.
3. Under **Settings → Networking**, click **Generate Domain**.

On Railway the server binds to `0.0.0.0` and sets Secure cookies by default. Run a single replica, because SQLite can't be shared between instances.

## What's in it

- **Learn**: flip concept cards with keyboard shortcuts (Space, ←/→, S). Star cards and attach your own notes.
- **Quiz runs**: 10 questions, ordered due first, then new, then weakest. Combos multiply XP. Press 1–4 to answer.
- **Spaced-repetition review**: every answer is scheduled server-side (Leitner boxes: a miss comes back in about 10 minutes, a hit after 1, 3, 7, 16, then 35 days). The **Review** tab pulls due questions from every chapter.
- **Boss fights** unlock at 50% chapter health and give you 3 lives. There's also **Term match** against the clock and **Explain it** interview drills, which save your previous answer.
- **Stats**: activity heatmap, review forecast, box distribution, per-chapter health and accuracy, and the questions you miss most.
- **Notes**: everything you've starred or annotated, in book order and printable.
- **Search** across all cards, glossary terms and questions.
- Accounts (scrypt-hashed passwords, httpOnly session cookie), XP, levels, streaks, a daily goal, badges, and light/dark themes.

## Bringing over progress from the old HTML file

Open `ddia-quest.html` in the browser you used before. In the DevTools console, run
`copy(localStorage.getItem("ddia-quest-v1"))`, then paste the result into **Settings → Import progress**.

## Layout

```
server/content/chapters.json   all study content (extracted from ddia-quest.html)
server/src/db.ts               schema + content seeding (re-seeded on every start)
server/src/progress.ts         XP, streaks, badges, spaced-repetition scheduling, mastery
server/src/routes/             auth/account, study (chapters, cards, runs, match, drills), insights (stats, notes, search)
client/src/pages/              React screens
scripts/extract-content.mjs    re-run with `npm run extract` if you edit ddia-quest.html
```

To edit or add content, change `server/content/chapters.json` and restart. Content IDs are `chapter * 1000 + index`, so **append** new cards and questions instead of reordering them, or existing progress will attach to the wrong items.

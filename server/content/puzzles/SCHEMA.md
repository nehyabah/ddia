# Puzzle content format

Every `*.json` file in this folder is a JSON **array** of puzzle objects, loaded at server start. Run `npm run check:puzzles` to validate the structure. With a JDK on PATH, `npm run verify:puzzles` compiles and runs every `solution`.

Puzzles are MongoDB-interview-flavoured systems and concurrency problems. The player never writes code from scratch: they arrange lines, fill blanks, or explain a concept in writing (graded by Claude, and they must score 7/10 to pass).

## Common fields

| field | type | rules |
|---|---|---|
| `id` | string | Unique and stable, e.g. `conc-07`. Never renumber. |
| `track` | `"concurrency" \| "resilience" \| "distributed"` | |
| `level` | `"beginner" \| "intermediate" \| "advanced" \| "expert"` | |
| `topic` | string | Short topic, e.g. `"Locks"`, `"Rate limiting"`, `"Replication"`. |
| `title` | string | Under 60 characters. |
| `kind` | `"parsons" \| "blanks" \| "theory"` | |
| `prompt` | string | 1–3 sentences: what the code must do, or the question being asked. Plain text; backticks allowed for inline code. |
| `explanation` | string | 3–6 sentences, shown after solving: why the solution works and the concept it teaches. Mention the MongoDB connection where there is one. |

## `parsons`: arrange the lines

| field | type | rules |
|---|---|---|
| `lines` | string[] | The lines of the correct solution, **in order**, **with their indentation** (4 spaces per level). 5–14 lines. Only the interesting fragment, e.g. a method body or one class, not a whole program. The UI shuffles them. |
| `distractors` | string[], optional | 0–3 plausible but wrong lines, e.g. a missing `volatile` or an unlocked read. Using any of them fails the attempt. |
| `solution` | string | A complete, compilable Java 17 file with `public class Main` and `main`, in which the `lines` appear **verbatim and contiguously** in order. `main` must demonstrate the code and print a deterministic result. ≤ 60 lines. |
| `expectedOutput` | string | The exact stdout of `solution`. |

Lines must be distinguishable: no two identical lines, unless they are interchangeable in that position. Avoid lone `}` lines where order would be ambiguous; prefer fragments where each line's position is logically forced.

## `blanks`: fill the gaps

| field | type | rules |
|---|---|---|
| `code` | string | The code shown to the player, with gaps written as `[[1]]`, `[[2]]` and so on (1–4 gaps). ≤ 30 lines, ≤ 60 chars per line. |
| `blanks` | `{ "options": string[], "answer": number }[]` | One entry per gap, in order. 3–4 options each; `answer` is the index of the correct one. |
| `solution` | string | A complete, compilable Java 17 file, `public class Main`, in which `code` appears with each gap replaced by its correct option. Deterministic stdout. ≤ 60 lines. |
| `expectedOutput` | string | The exact stdout of `solution`. |

## `theory`: explain it (graded by Claude, 7/10 to pass)

| field | type | rules |
|---|---|---|
| `question` | string | An interview-style open question, e.g. "Explain how a token bucket differs from a fixed window counter and when you'd choose each." |
| `keyPoints` | string[] | 4–7 points a strong answer covers. These are the grading rubric. |
| `modelAnswer` | string | A strong 4–8 sentence answer. |
| `hint` | string | A one-line nudge shown on request. |

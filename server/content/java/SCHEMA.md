# Java debugging content format

Every `*.json` file in this folder is loaded at server start. There are two kinds of file:

- `challenges-*.json`: a JSON **array** of challenge objects.
- `lessons.json`: a JSON **array** of lesson objects.

Run `npm run check:java` to validate the structure. If a JDK is on your PATH, `npm run verify:java` compiles and runs every `code` and `fix` and compares their output with `buggyOutput` and `fixedOutput`.

## Challenge object

| field | type | rules |
|---|---|---|
| `id` | string | Unique and stable, e.g. `beg-a-07`. Never renumber: progress is keyed on it. |
| `level` | `"beginner" \| "intermediate" \| "advanced" \| "expert"` | |
| `topic` | string | Short topic name, e.g. `"Strings"`, `"Collections"`, `"Concurrency"`. |
| `title` | string | Under 60 characters. Don't give the answer away. |
| `kind` | `"bug" \| "output" \| "trace"` | `bug`: code misbehaves, find and fix it. `output`: predict the surprising output. `trace`: a stack trace is shown, explain it. |
| `scenario` | string | 1–3 sentences: what the code is meant to do, and what the user or test saw. |
| `symptom` | string, optional | What you see when it runs: console output, a failing assertion or a stack trace. Must match the code exactly (same line numbers in stack traces). Omit it for `output` kind, where predicting the output is the question. |
| `code` | string | A complete, compilable Java 17 file containing `public class Main` with a `main` method. Use `\n` for newlines and 4-space indentation. **At most 35 lines and about 60 characters per line** (it has to read on a phone). Standard library only, no stdin, no files, no network. |
| `bugLines` | number[] | 1-based line numbers in `code` where the defect is, or where the surprise originates. 1–3 lines. The player taps these. |
| `question` | string | e.g. "What's the root cause?", "What does this print?", "Which fix is correct?" |
| `options` | string[4] | Exactly 4 options, all plausible and similar in length. For `output` kind, list the candidate outputs. |
| `answer` | number | Index (0–3) of the correct option. Vary the position across challenges. |
| `explanation` | string | 2–5 sentences explaining *why*, in plain English. Name the language rule or API behaviour involved. |
| `fix` | string | Corrected full file: same class, minimal change, still compiles. |
| `fixNote` | string | One line: what changed. |
| `debugTip` | string | The concrete debugging technique that would have found this: e.g. "Set a breakpoint on line 6 and add a watch on `i`; step through the last iteration." Use IDE-neutral wording (breakpoint, step over, step into, watch, conditional breakpoint, exception breakpoint, evaluate expression) or JDK tools (jstack, jcmd, jmap, JFR). |
| `buggyOutput` | string | Exact stdout of `code` (trailing newline optional). If it throws, include only what was printed *before* the exception (the exception goes to stderr), set `throws`, and put the stack trace in `symptom`. |
| `throws` | string, optional | Fully qualified exception class that `code` throws, if any. |
| `fixedOutput` | string | Exact stdout of `fix`. |
| `deterministic` | boolean, optional | `false` for races or timing-dependent output; verification then skips the output comparison. |

## Lesson object

| field | type | rules |
|---|---|---|
| `id` | string | Unique, e.g. `les-beg-03`. |
| `level` | same levels as challenges | |
| `title` | string | |
| `body` | string[] | 3–7 bullet points, each 1–3 sentences. Practical and specific. |
| `example` | string, optional | Short code, stack trace or command (≤ 20 lines, ≤ 60 chars wide). |

/// <reference lib="webworker" />
// Runs the learner's own JavaScript against the problem's test expressions, isolated in a worker.
type Test = { name: string; call: string; expected: unknown };
type Out = { name: string; ok: boolean; got?: string; expected: string; error?: string; ms: number };

const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
const eq = (a: unknown, b: unknown) => canon(a) === canon(b);

self.onmessage = (e: MessageEvent<{ code: string; tests: Test[] }>) => {
  const { code, tests } = e.data;
  const logs: string[] = [];
  const console = { log: (...a: unknown[]) => { if (logs.length < 50) logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); } };
  const results: Out[] = [];
  for (const t of tests) {
    const t0 = performance.now();
    try {
      // eslint-disable-next-line no-new-func
      const got = new Function("console", `${code}\nreturn (${t.call});`)(console);
      results.push({ name: t.name, ok: eq(got, t.expected), got: JSON.stringify(got) ?? "undefined", expected: JSON.stringify(t.expected), ms: Math.round(performance.now() - t0) });
    } catch (err) {
      results.push({ name: t.name, ok: false, error: String((err as Error)?.message ?? err), expected: JSON.stringify(t.expected), ms: Math.round(performance.now() - t0) });
    }
  }
  (self as unknown as Worker).postMessage({ results, logs });
};

/// <reference lib="webworker" />
// Runs a learner's MongoDB find/aggregate against the sample datasets using mingo.
import { Aggregator, Query } from "mingo";

type Msg = { kind: "find" | "aggregate"; collection: string; text: string; datasets: Record<string, unknown[]> };

/** Accepts shell-style input: unquoted keys, single quotes, trailing commas ({ status: 'paid' }). */
function parse(text: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(`"use strict"; return (${text});`)();
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

self.onmessage = (e: MessageEvent<Msg>) => {
  const { kind, collection, text, datasets } = e.data;
  const opts = { collectionResolver: (name: string) => clone(datasets[name] ?? []) as Record<string, unknown>[] };
  try {
    const docs = clone(datasets[collection] ?? []);
    let out: unknown[];
    if (kind === "aggregate") {
      const pipeline = parse(text);
      if (!Array.isArray(pipeline)) throw new Error("A pipeline must be an array of stages: [ { $match: … }, … ]");
      out = new Aggregator(pipeline as never[], opts).run(docs) as unknown[];
    } else {
      const q = parse(text) as { filter?: object; projection?: object; sort?: object; limit?: number } | object;
      const spec = q && typeof q === "object" && ("filter" in q || "projection" in q || "sort" in q || "limit" in q) ? (q as { filter?: object; projection?: object; sort?: object; limit?: number }) : { filter: q as object };
      let cur = new Query((spec.filter ?? {}) as never, opts).find(docs as never[], (spec.projection ?? undefined) as never);
      if (spec.sort) cur = cur.sort(spec.sort as never);
      if (spec.limit) cur = cur.limit(spec.limit);
      out = cur.all() as unknown[];
    }
    (self as unknown as Worker).postMessage({ ok: true, output: out });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String((err as Error)?.message ?? err) });
  }
};

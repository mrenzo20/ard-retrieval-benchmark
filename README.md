# ARD Registry Retrieval Benchmark

A reproducible benchmark of what public [ARD](https://github.com/ards-project/ard-spec) registries return for the same set of queries — method in the open, re-runnable by anyone.

```bash
node run.mjs        # zero dependencies · ~4 min · writes results/retrieval-<date>.json
```

**Published by [Desvela](https://desvela.dev), which competes in this table.** Its row is marked `self: true` in every output. A benchmark whose author participates is only worth anything if the method survives being read by a rival — so here it is, all of it.

Latest edition: [`results/`](results/) · one file per run date. A human-readable summary is published at [desvela.dev/benchmark](https://desvela.dev/benchmark).

## What it measures, and why each metric

| Metric | Why it is here |
|---|---|
| **Cold and warm latency** | Cold = fresh connection per request: what a one-off agent call pays. Warm = keep-alive: what a sustained client sees. **Both** are published — our first version measured only warm and reported 307ms for an endpoint that `curl` timed at 1.16s. Neither number lies; publishing only one means picking the convenient one |
| **Results for gibberish** | The negative control, and the metric that matters most. A registry returning ten results scored 55 for `xkqjvwz mplfrbn` has an undocumented noise floor — and then its score cannot be used to decide anything |
| **Duplicates** | The same URL more than once in one result set: slots that inform nothing. Keyed by normalized `url`, which is what an agent actually calls |
| **Self-retrieval** | Where Desvela's entries rank for the queries Desvela publishes as its own. **Only interpretable in someone else's index**; in our own it is self-promotion, and the output marks it non-interpretable |

## What it does NOT measure — said here, not in a footnote

- **Semantic ranking quality.** It would require human relevance judgment, and that judgment would come from an interested party.
- **Coverage.** Comparing index sizes without probing for catch-all servers is exactly the error this benchmark's publisher [calls out](https://desvela.ai/census/methodology): on `/.well-known/ard.json` — a path the spec introduced on 26 Aug 2026 that **nobody served yet** — a naive counter finds 745 "publishers" in the Tranco top-100K. Twelve sampled live: none published anything. Coverage claims need canary probing; our monthly census does that, this benchmark does not.

## Where the queries come from

The query set is the most contestable part of a benchmark published by a participant, so none were chosen to make us look good:

- **Tasks (8)** — from the ARD spec's own examples and from the tasks a competitor advertises as its federation's strength. Playing on their turf.
- **Self-retrieval (5)** — Desvela's `representativeQueries`, exactly as published at [`desvela.dev/.well-known/ard.json`](https://desvela.dev/.well-known/ard.json).
- **Gibberish (3)** — strings with no meaning in any language.

## Our own limits, declared

- **We rank 1st in 4/5 self-retrieval queries in the rival index, not 5/5.** The fifth — `find an MCP server for this task` — ranks lower on purpose: our catalog entry was written not to self-preference. The original publication bar demanded 5/5 and was rewritten, because it would have blocked this forever.
- **The duplicates we measure are ours.** We publish the same catalog on `desvela.ai` and `desvela.dev`, so the same entry reaches indexers twice with identical `url` and different urn. Letting it through is the indexing registry's missing endpoint-dedupe — but the duplicate originates with us, and saying "they have duplicates" without saying where they come from would sell our own artifact as a rival's defect.
- **A registry that does not answer on measurement day stays in the table with its reason** — see `excluded` in the output. It is never silently omitted.

## Files

| | |
|---|---|
| [`queries.json`](queries.json) | The query set, with each block's rationale and source |
| [`registries.json`](registries.json) | The registries, including excluded ones and why |
| [`run.mjs`](run.mjs) | The harness. Zero dependencies, Node ≥ 20 |
| [`results/`](results/) | One edition per date |

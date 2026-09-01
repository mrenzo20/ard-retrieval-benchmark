#!/usr/bin/env node
/**
 * Reproducible retrieval benchmark across public ARD registries.
 * Zero dependencies: `node run.mjs`.
 *
 * What it measures, and why each metric is here:
 *
 *  - LATENCY. Median of N samples, not one. A single network measurement is an
 *    anecdote, not a datum; and a median is not moved by one outlier.
 *  - RESULTS FOR GIBBERISH. The negative control, and the metric that matters
 *    most: a registry that returns ten results scored 55 for "xkqjvwz mplfrbn"
 *    has an undocumented noise floor — and then its score cannot be used to
 *    decide anything.
 *  - DUPLICATES. The same URL or identifier more than once in one result set.
 *    It occupies slots that inform nothing.
 *  - SELF-RETRIEVAL. Where OUR entries rank for OUR published queries. Only
 *    interpretable in someone else's index; in our own it is self-promotion
 *    and is marked non-interpretable.
 *
 * What this benchmark does NOT measure, said here and not in a footnote:
 *  - Semantic ranking quality. It would require human relevance judgment, and
 *    that judgment would come from the benchmark's author — an interested party.
 *  - Coverage. Our monthly census measures that, with canary probing; comparing
 *    index sizes without probing for catch-alls is precisely the error this
 *    project calls out.
 *
 * Conflict of interest: published by Desvela, which competes in this table.
 * Its row is marked `self: true` in every output.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MUESTRAS_LATENCIA = Number(process.env.BENCH_SAMPLES ?? 5);
const TIMEOUT_MS = 30_000;
const PAUSA_MS = Number(process.env.BENCH_DELAY_MS ?? 800);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** One query. Returns results + ms, or the failure reason. */
async function consultar(endpoint, texto, frio = false) {
  const t0 = performance.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(endpoint, {
      method: 'POST',
      // `connection: close` forces a fresh handshake on the next request: the
      // only way to measure a one-off call's true cost without leaving fetch.
      headers: { 'content-type': 'application/json', ...(frio ? { connection: 'close' } : {}) },
      body: JSON.stringify({ query: { text: texto } }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ms = performance.now() - t0;
    if (!res.ok) return { ok: false, motivo: `HTTP ${res.status}`, ms };
    const doc = await res.json().catch(() => null);
    if (!doc) return { ok: false, motivo: 'respuesta no es JSON', ms };
    const results = Array.isArray(doc.results) ? doc.results : [];
    return { ok: true, ms, results };
  } catch (e) {
    return { ok: false, motivo: e.name === 'AbortError' ? 'timeout' : String(e.message ?? e), ms: performance.now() - t0 };
  }
}

const mediana = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Deduplication key. `url` first because that is what an agent actually calls:
 * two different identifiers pointing at the same endpoint are a duplicate from
 * the caller's point of view.
 */
const claveDedupe = (e) => (e?.url ?? e?.identifier ?? JSON.stringify(e))?.toString().replace(/\/+$/, '');

function contarDuplicados(results) {
  const vistos = new Map();
  let dup = 0;
  for (const r of results) {
    const k = claveDedupe(r);
    if (vistos.has(k)) dup++;
    else vistos.set(k, true);
  }
  return dup;
}

const esNuestro = (e) => JSON.stringify(e ?? {}).toLowerCase().includes('desvela');

async function medirRegistro(reg, queries) {
  const out = { id: reg.id, displayName: reg.displayName, endpoint: reg.endpoint, self: !!reg.self };

  // --- latency: COLD and WARM, both ---------------------------------------
  // The first version measured only with keep-alive and reported 307ms for an
  // endpoint that curl timed at 1.161s. Neither number lies: `fetch` reuses the
  // connection between samples while curl opens a new TLS handshake each time.
  // They measure different things — the cost of a one-off agent call versus a
  // sustained client — and publishing only one means picking the convenient
  // one. Both are published, labeled.
  const medir = async (frio) => {
    const xs = []; let fallos = 0;
    for (let i = 0; i < MUESTRAS_LATENCIA; i++) {
      const r = await consultar(reg.endpoint, queries.blocks.tasks.queries[0], frio);
      if (r.ok) xs.push(r.ms); else fallos++;
      await dormir(PAUSA_MS);
    }
    return { samples: MUESTRAS_LATENCIA, ok: xs.length, failed: fallos, median: xs.length ? Math.round(mediana(xs)) : null };
  };
  out.latencyMs = {
    cold: await medir(true),
    warm: await medir(false),
    note: 'cold = fresh connection per request (what a one-off agent call pays). warm = keep-alive (sustained client).',
  };

  // --- tareas: resultados y duplicados ------------------------------------
  const tareas = [];
  for (const q of queries.blocks.tasks.queries) {
    const r = await consultar(reg.endpoint, q);
    tareas.push(r.ok
      ? { query: q, results: r.results.length, duplicates: contarDuplicados(r.results) }
      : { query: q, error: r.motivo });
    await dormir(PAUSA_MS);
  }
  out.tasks = tareas;
  const tOk = tareas.filter((t) => t.results !== undefined);
  out.tasksSummary = {
    answered: tOk.length,
    of: tareas.length,
    medianResults: tOk.length ? mediana(tOk.map((t) => t.results)) : null,
    totalDuplicates: tOk.reduce((a, t) => a + t.duplicates, 0),
  };

  // --- suelo de ruido: el control negativo --------------------------------
  const ruido = [];
  for (const q of queries.blocks.noiseFloor.queries) {
    const r = await consultar(reg.endpoint, q);
    ruido.push(r.ok
      ? { query: q, results: r.results.length, scores: r.results.map((x) => x.score).filter((x) => x != null) }
      : { query: q, error: r.motivo });
    await dormir(PAUSA_MS);
  }
  out.noiseFloor = ruido;
  const rOk = ruido.filter((x) => x.results !== undefined);
  const todosScores = rOk.flatMap((x) => x.scores);
  out.noiseFloorSummary = {
    medianResults: rOk.length ? mediana(rOk.map((x) => x.results)) : null,
    scoreRange: todosScores.length ? [Math.min(...todosScores), Math.max(...todosScores)] : null,
    verdict: rOk.length && rOk.every((x) => x.results === 0)
      ? 'clean: zero results for meaningless input'
      : 'noise floor: returns results for meaningless input',
  };

  // --- self-retrieval: solo interpretable fuera de casa -------------------
  const self = [];
  for (const q of queries.blocks.selfRetrieval.queries) {
    const r = await consultar(reg.endpoint, q);
    if (!r.ok) { self.push({ query: q, error: r.motivo }); await dormir(PAUSA_MS); continue; }
    const pos = r.results.map((e, i) => (esNuestro(e) ? i + 1 : null)).filter(Boolean);
    self.push({ query: q, positions: pos, first: pos[0] ?? null, of: r.results.length });
    await dormir(PAUSA_MS);
  }
  out.selfRetrieval = reg.self
    ? { interpretable: false, why: 'This is our own index: measuring our own rank here is self-promotion, not a datum.', raw: self }
    : { interpretable: true, atRank1: self.filter((s) => s.first === 1).length, of: self.length, detail: self };

  // --- duplicates, across ALL queries --------------------------------------
  // The first version counted them only in the `tasks` block, which is exactly
  // where they do not appear: the observed duplicates show up on the
  // self-retrieval queries, because they are OUR entries. Measuring a defect
  // only where it does not occur yields zero and reads like a pass.
  //
  // And an honesty the table must carry: the duplicates exist because we
  // publish the SAME catalog on desvela.ai and desvela.dev, so the entry
  // reaches indexers twice with the same url and a different urn. Letting it
  // through is the indexing registry's missing endpoint-dedupe, not a trick by
  // the publisher — but saying "they have duplicates" without saying where they
  // come from would sell as a rival's defect something we originate.
  const todas = [...queries.blocks.tasks.queries, ...queries.blocks.selfRetrieval.queries];
  let dupTotal = 0, dupQueries = 0, ejemplos = [];
  for (const q of todas) {
    const r = await consultar(reg.endpoint, q);
    if (!r.ok) { await dormir(PAUSA_MS); continue; }
    const porClave = new Map();
    for (const [i, e] of r.results.entries()) {
      const k = claveDedupe(e);
      if (!porClave.has(k)) porClave.set(k, []);
      porClave.get(k).push(i + 1);
    }
    const repes = [...porClave.entries()].filter(([, ps]) => ps.length > 1);
    if (repes.length) {
      dupQueries++;
      dupTotal += repes.reduce((a, [, ps]) => a + ps.length - 1, 0);
      if (ejemplos.length < 3) ejemplos.push({ query: q, key: repes[0][0], positions: repes[0][1] });
    }
    await dormir(PAUSA_MS);
  }
  out.duplicates = {
    queriesWithDuplicates: dupQueries,
    of: todas.length,
    extraEntries: dupTotal,
    examples: ejemplos,
    note: 'Key = normalized url (what an agent actually calls). The observed duplicates are Desvela entries published on its two domains: same endpoint, different urn. Declared because we originate them.',
  };

  return out;
}

async function main() {
  const queries = JSON.parse(readFileSync(join(AQUI, 'queries.json'), 'utf8'));
  const { registries } = JSON.parse(readFileSync(join(AQUI, 'registries.json'), 'utf8'));
  const activos = registries.filter((r) => !r.excluded);
  const excluidos = registries.filter((r) => r.excluded);

  console.error(`benchmark: ${activos.length} registries · ${MUESTRAS_LATENCIA} latency samples`);
  const resultados = [];
  for (const reg of activos) {
    console.error(`  measuring ${reg.id}...`);
    resultados.push(await medirRegistro(reg, queries));
  }

  const salida = {
    schemaVersion: '1',
    ranAt: new Date().toISOString(),
    method: {
      samples: MUESTRAS_LATENCIA,
      timeoutMs: TIMEOUT_MS,
      delayBetweenRequestsMs: PAUSA_MS,
      querySet: Object.fromEntries(Object.entries(queries.blocks).map(([k, v]) => [k, { count: v.queries.length, why: v.why, source: v.source }])),
      disclosure: 'Published by Desvela, which competes in this table. Its row is marked self:true.',
      notMeasured: [
        'Semantic ranking quality: would require human relevance judgment from an interested party.',
        'Coverage: measured by the monthly census with canary probing; comparing index sizes without it is the error this project calls out.',
      ],
    },
    excluded: excluidos.map((r) => ({ id: r.id, endpoint: r.endpoint, why: r.excluded })),
    registries: resultados,
  };

  mkdirSync(join(AQUI, 'results'), { recursive: true });
  const f = join(AQUI, 'results', `retrieval-${salida.ranAt.slice(0, 10)}.json`);
  writeFileSync(f, JSON.stringify(salida, null, 2));
  console.error(`benchmark: wrote ${f}`);

  // Human-readable table on stderr, so nobody has to open the JSON.
  console.error('\n  registry         cold  warm   tasks  dups  gibberish             self-retrieval');
  for (const r of resultados) {
    const nf = r.noiseFloorSummary;
    const sr = r.selfRetrieval.interpretable ? `${r.selfRetrieval.atRank1}/${r.selfRetrieval.of} at rank 1` : '(own index, n/a)';
    console.error(
      `  ${(r.id + (r.self ? ' *' : '')).padEnd(15)} ${String(r.latencyMs.cold.median ?? '?').padStart(5)} ${String(r.latencyMs.warm.median ?? '?').padStart(5)}  ` +
      `${String(r.tasksSummary.answered + '/' + r.tasksSummary.of).padStart(5)}  ${String(r.duplicates.extraEntries).padStart(4)}  ` +
      `${String(nf.medianResults ?? '?').padStart(2)} res ${nf.scoreRange ? `(${nf.scoreRange[0]}-${nf.scoreRange[1]})` : '        '}  ${sr}`,
    );
  }
  console.error('  * = ours\n');
}

main().catch((e) => { console.error(e); process.exit(1); });

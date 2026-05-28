/**
 * Simulation runner — drives every scenario through a real Aggregator wired to
 * in-process fixture backends, prints a human-readable summary, and writes a JSON
 * artifact to sim/results.latest.json for inspection.
 *
 * Run: npm run sim
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCENARIOS,
  buildSimAggregator,
  outOfFocusReachable,
  runFocusBiasProbe,
  runScenario,
  type FocusBiasProbe,
  type ScenarioResult,
} from './scenarios.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const { aggregator } = buildSimAggregator();

  // 1) Resolution scenarios
  const results: ScenarioResult[] = [];
  for (const sc of SCENARIOS) {
    results.push(await runScenario(aggregator, sc));
  }

  // 2) Focus-bias probes (only scenarios that declare a focus)
  const probes: FocusBiasProbe[] = [];
  for (const sc of SCENARIOS) {
    if (sc.focus) probes.push(await runFocusBiasProbe(aggregator, sc));
  }

  // 3) Out-of-focus reachability (lens, not gate): a code tool must remain
  //    discoverable while a non-code focus is active.
  const reachable = {
    githubUnderFinance: await outOfFocusReachable(aggregator, 'pull request', 'finance', 'github/create_pull_request'),
    neonUnderDesign: await outOfFocusReachable(aggregator, 'sql query', 'design', 'neon/run_sql'),
  };

  // ── Report ──────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  console.log('\n=== ch1tty scenario simulation ===\n');
  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${r.id} (focus=${r.focus ?? 'none'}, ${r.ms}ms)`);
    console.log(`       intent : ${r.intent}`);
    console.log(`       expect : ${r.expected}`);
    console.log(`       actual : ${r.actual ?? '(none)'} @ ${r.actualScore ?? '-'}`);
    if (!r.pass) {
      console.log(`       alts   : ${r.alternatives.map((a) => `${a.tool}@${a.score}`).join(', ') || '(none)'}`);
      if (r.note) console.log(`       note   : ${r.note}`);
    }
  }

  console.log('\n--- focus bias probes ---');
  for (const p of probes) {
    console.log(
      `[${p.boosted ? 'BOOST' : 'flat '}|${p.reordered ? 'REORDER' : 'same   '}] ${p.id}: ` +
      `expected ${p.expected} ${p.noFocusExpectedScore ?? '-'} -> ${p.withFocusExpectedScore ?? '-'} ` +
      `(top ${p.noFocusTop ?? '-'} -> ${p.withFocusTop ?? '-'})`,
    );
  }

  console.log('\n--- out-of-focus reachability ---');
  console.log(`  github under finance : ${reachable.githubUnderFinance ? 'reachable' : 'UNREACHABLE'}`);
  console.log(`  neon under design    : ${reachable.neonUnderDesign ? 'reachable' : 'UNREACHABLE'}`);

  console.log(`\nResolution: ${passed}/${results.length} passed  |  total cast time ${Math.round(totalMs * 100) / 100}ms\n`);

  // ── Artifact ────────────────────────────────────────────────
  const artifact = {
    generatedAt: new Date().toISOString(),
    summary: { resolution: { passed, total: results.length }, totalCastMs: Math.round(totalMs * 100) / 100 },
    scenarios: results,
    focusBiasProbes: probes,
    reachability: reachable,
  };
  const outDir = resolve(__dirname, 'results');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(__dirname, 'results.latest.json');
  writeFileSync(outPath, JSON.stringify(artifact, null, 2));
  writeFileSync(resolve(outDir, `${Date.now()}.json`), JSON.stringify(artifact, null, 2));
  console.log(`Artifact: ${outPath}\n`);

  await aggregator.shutdown?.();
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});

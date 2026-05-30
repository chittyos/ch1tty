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

  // 3) Out-of-focus reachability (lens, not gate): every focus must still surface
  //    tools from other focus profiles when searched directly.
  const reachable: Record<string, boolean> = {
    // finance focus — code/communication/design tools still reachable
    githubUnderFinance: await outOfFocusReachable(aggregator, 'pull request', 'finance', 'github/create_pull_request'),
    imessageUnderFinance: await outOfFocusReachable(aggregator, 'message', 'finance', 'imessage/send_message'),
    // design focus — code/finance tools still reachable
    neonUnderDesign: await outOfFocusReachable(aggregator, 'sql', 'design', 'neon/run_sql'),
    stripeUnderDesign: await outOfFocusReachable(aggregator, 'invoice', 'design', 'stripe/create_invoice'),
    // code focus — finance/communication tools still reachable
    stripeUnderCode: await outOfFocusReachable(aggregator, 'invoice', 'code', 'stripe/create_invoice'),
    imessageUnderCode: await outOfFocusReachable(aggregator, 'message', 'code', 'imessage/send_message'),
    // communication focus — code/finance tools still reachable
    neonUnderCommunication: await outOfFocusReachable(aggregator, 'sql', 'communication', 'neon/run_sql'),
    stripeUnderCommunication: await outOfFocusReachable(aggregator, 'invoice', 'communication', 'stripe/create_invoice'),
    // governance focus — code/desktop/communication tools still reachable
    githubUnderGovernance: await outOfFocusReachable(aggregator, 'pull request', 'governance', 'github/create_pull_request'),
    browserRenderingUnderGovernance: await outOfFocusReachable(aggregator, 'headless', 'governance', 'browser-rendering/render_page'),
    imessageUnderGovernance: await outOfFocusReachable(aggregator, 'message', 'governance', 'imessage/send_message'),
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

  console.log('\n--- out-of-focus reachability (lens, not gate) ---');
  const oofEntries = Object.entries(reachable);
  for (const [key, ok] of oofEntries) {
    console.log(`  ${key.padEnd(36)}: ${ok ? 'reachable' : 'UNREACHABLE'}`);
  }
  const oofPassed = oofEntries.filter(([, ok]) => ok).length;
  console.log(`  (${oofPassed}/${oofEntries.length} probes reachable)`);

  console.log(`\nResolution: ${passed}/${results.length} passed  |  total cast time ${Math.round(totalMs * 100) / 100}ms\n`);

  const allReachable = oofEntries.every(([, ok]) => ok);
  if (passed < results.length || !allReachable) {
    process.exitCode = 1;
  }

  // ── Artifact ────────────────────────────────────────────────
  const artifact = {
    generatedAt: new Date().toISOString(),
    summary: {
      resolution: { passed, total: results.length },
      reachability: { passed: oofPassed, total: oofEntries.length },
      totalCastMs: Math.round(totalMs * 100) / 100,
    },
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

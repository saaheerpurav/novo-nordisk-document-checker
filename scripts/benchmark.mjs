// Measures the reviewer against a labelled gold set and prints the numbers the
// team is willing to say out loud. Splits are reported separately: an "authored"
// score is what you get grading your own exam, and it is labelled as such.
//
//   npm run bench              all splits, 3 repeats
//   npm run bench -- --runs 1  faster single pass
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { getState, resetState, reviewDocument, reviewWorkspace } from '../server/state.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 3
const gold = JSON.parse(fs.readFileSync(path.join(root, 'bench', 'gold.json'), 'utf8'))

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required. The benchmark measures the real reviewer, not a stub.')
  process.exit(1)
}

const pct = (numerator, denominator) => (denominator ? `${Math.round((numerator / denominator) * 100)}%` : 'n/a')

async function scoreDocument(entry) {
  const state = await reviewDocument(entry.documentId, 'benchmark')
  const document = state.documents.find((item) => item.id === entry.documentId)
  const byLabel = new Map(document.checks.map((check) => [check.label, check]))
  const rows = []
  for (const [label, expected] of Object.entries(entry.expected)) {
    const actual = byLabel.get(label)
    if (!actual) continue
    rows.push({ label, expected, actual: actual.result, source: actual.source || 'ai' })
  }
  return { rows, checks: document.checks, durationMs: document.lastReview?.durationMs || 0 }
}

const splits = {}
const stability = new Map()

for (let run = 1; run <= runs; run += 1) {
  process.stdout.write(`run ${run}/${runs} `)
  resetState()
  for (const entry of gold.entries) {
    const { rows, checks, durationMs } = await scoreDocument(entry)
    const split = (splits[entry.split] ||= {
      documents: new Set(), foundFails: 0, actualFails: 0, falseFlags: 0, actualPasses: 0,
      abstained: 0, graded: 0, totalChecks: 0, durationMs: 0,
    })
    split.documents.add(entry.documentId)
    split.durationMs += durationMs
    split.totalChecks += checks.length
    split.abstained += checks.filter((check) => check.result === 'unknown').length
    for (const row of rows) {
      split.graded += 1
      if (row.expected === 'fail') { split.actualFails += 1; if (row.actual === 'fail') split.foundFails += 1 }
      if (row.expected === 'pass') { split.actualPasses += 1; if (row.actual === 'fail') split.falseFlags += 1 }
      const key = `${entry.documentId}::${row.label}`
      const seen = stability.get(key) || { source: row.source, results: [] }
      seen.results.push(row.actual)
      stability.set(key, seen)
    }
    process.stdout.write('.')
  }
  process.stdout.write('\n')
}

const repeatability = (which) => {
  const rows = [...stability.values()].filter((item) => item.source === which)
  const stable = rows.filter((item) => new Set(item.results).size === 1).length
  return { stable, total: rows.length }
}

console.log('\n=== Reviewer accuracy ===')
for (const [name, split] of Object.entries(splits)) {
  const perRun = split.graded / runs
  console.log(`\n[${name.toUpperCase()} SPLIT] ${split.documents.size} documents, ${Math.round(perRun)} labelled checks, ${runs} run(s)`)
  console.log(`  Recall on genuine gaps   ${pct(split.foundFails, split.actualFails)}  (${split.foundFails}/${split.actualFails} FAIL checks found)`)
  console.log(`  False-flag rate          ${pct(split.falseFlags, split.actualPasses)}  (${split.falseFlags}/${split.actualPasses} compliant items wrongly failed)`)
  console.log(`  Abstention rate          ${pct(split.abstained, split.totalChecks)}  (items returned "not assessed")`)
  console.log(`  Median review latency    ${Math.round(split.durationMs / (split.documents.size * runs))} ms per document`)
}

const rule = repeatability('rule')
const ai = repeatability('ai')
console.log('\n=== Verdict repeatability across runs ===')
console.log(`  Deterministic (RULE)     ${rule.stable}/${rule.total} identical  ${pct(rule.stable, rule.total)}`)
console.log(`  Model (AI)               ${ai.stable}/${ai.total} identical  ${pct(ai.stable, ai.total)}`)
console.log('  This is why the rule layer carries the compliance decision.')

console.log('\n=== Independent verification (retraction ledger) ===')
resetState()
await reviewWorkspace()
const review = getState().workspaceReview
console.log(`  Proposed ${review.proposed} · retained ${review.retained} · rejected ${review.rejected.length}`)
review.rejected.forEach((item) => console.log(`    rejected: ${item.title} — ${item.note}`))

console.log('\nEvery number above is reproduced by: npm run bench')
if (!gold.entries.some((entry) => entry.split === 'held-out')) {
  console.log('NOTE: only the authored split is present. Add held-out documents to bench/gold.json before quoting these figures as accuracy.')
}

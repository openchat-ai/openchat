#!/usr/bin/env node
// === invariants ===
// - 校验 manifest.json description 字段, 规则来自 docs/experiment-description-spec.md
// - 输入: src/experiments/manifest.json (read-only)
// - 输出: stdout 报告 + exit code (0 = 全 PASS, 1 = 有 FAIL)
// - 不修改任何文件, 不联网
// - 规则集合固定 (R1-R5 + W1-W2), 改规则需先改 spec 再改这里
// === end invariants ===

/**
 * check-experiment-descriptions.mjs
 *
 * Validates `description` field of every entry in
 * `src/experiments/manifest.json` against the rules in
 * `docs/experiment-description-spec.md`.
 *
 * Hard rules (FAIL):
 *   R1: length <= 1024 chars
 *   R2: third person — no first-person pronouns (I, my, 我, 我们, 帮你)
 *   R3: first sentence <= 80 chars
 *   R4: contains "Use when" trigger clause
 *   R5: no emoji
 *
 * Soft warnings (do not fail):
 *   W1: trigger list has < 3 keywords
 *   W2: description still contains `ID=<number>` style internal field
 *
 * Exit code:
 *   0 = all PASS
 *   1 = at least one FAIL  (suitable for CI / pre-commit hook)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MANIFEST = resolve(ROOT, 'src/experiments/manifest.json');

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const FIRST_PERSON_RE = /\b(I|my|me)\b|\u6211|\u6211\u4eec|\u5e2e\u4f60|\u6211\u80fd/i;
const USE_WHEN_RE = /use when/i;

function firstSentence(s) {
  // Split on . ! ? — take the first non-empty chunk. Allow Chinese 。！？ too.
  const m = s.split(/[.!?\u3002\uff01\uff1f]/)[0];
  return (m || '').trim();
}

function checkEntry(entry) {
  const issues = [];
  const warnings = [];
  const desc = entry.description;

  if (!desc || typeof desc !== 'string') {
    issues.push('R-missing: description field empty or non-string');
    return { id: entry.id || '<no-id>', name: entry.name || '<no-name>', issues, warnings };
  }

  // R1
  if (desc.length > 1024) {
    issues.push(`R1: description too long: ${desc.length} chars (max 1024)`);
  }

  // R2 — third person
  const fp = desc.match(FIRST_PERSON_RE);
  if (fp) {
    issues.push(`R2: first-person pronoun detected: "${fp[0]}"`);
  }

  // R3 — first sentence
  const fs = firstSentence(desc);
  if (fs.length > 80) {
    issues.push(`R3: first sentence too long (${fs.length} chars): "${fs.slice(0, 60)}..."`);
  }

  // R4 — must contain "Use when"
  if (!USE_WHEN_RE.test(desc)) {
    issues.push('R4: missing "Use when" trigger clause');
  }

  // R5 — emoji
  const emojiMatch = desc.match(EMOJI_RE);
  if (emojiMatch) {
    issues.push(`R5: emoji detected: "${emojiMatch[0]}"`);
  }

  // W1 — short trigger list
  const useWhenIdx = desc.search(USE_WHEN_RE);
  if (useWhenIdx >= 0) {
    const tail = desc.slice(useWhenIdx);
    const keywords = tail
      .replace(/^[^:]*:/i, '') // strip "Use when..."
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(Boolean);
    // crude: count distinct word groups (English words + Chinese phrases)
    const distinct = keywords.length;
    if (distinct < 3) {
      warnings.push(`W1: trigger list has ${distinct} keywords (recommend >= 3)`);
    }
  }

  // W2 — internal ID leakage
  if (/\bID\s*=\s*\d+/i.test(desc)) {
    warnings.push('W2: internal "ID=<number>" field still in description (strip before ship)');
  }

  return { id: entry.id || '<no-id>', name: entry.name || '<no-name>', issues, warnings };
}

function main() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch (err) {
    console.error(`FAIL: cannot read/parse ${MANIFEST}: ${err.message}`);
    process.exit(1);
  }

  const entries = manifest.experiments || [];
  if (entries.length === 0) {
    console.error('FAIL: manifest has no experiments');
    process.exit(1);
  }

  const results = entries.map(checkEntry);
  const passed = results.filter(r => r.issues.length === 0);
  const failed = results.filter(r => r.issues.length > 0);
  const todoFlagged = entries.filter(e => e._todo === 'description-spec');

  console.log(`\n[check-experiment-descriptions] ${entries.length} entries total`);
  console.log(`  PASS: ${passed.length}`);
  console.log(`  FAIL: ${failed.length}`);
  console.log(`  TODO (description-spec): ${todoFlagged.length}`);
  console.log(`  Warnings (non-fatal): ${results.reduce((n, r) => n + r.warnings.length, 0)}\n`);

  if (failed.length > 0) {
    console.log('=== FAIL ===');
    for (const r of failed) {
      console.log(`  ${r.id} (${r.name})`);
      for (const i of r.issues) console.log(`    - ${i}`);
    }
    console.log('');
  }

  if (results.some(r => r.warnings.length > 0)) {
    console.log('=== WARNINGS ===');
    for (const r of results) {
      if (r.warnings.length === 0) continue;
      console.log(`  ${r.id} (${r.name})`);
      for (const w of r.warnings) console.log(`    - ${w}`);
    }
    console.log('');
  }

  if (todoFlagged.length > 0) {
    console.log('=== TODO (description-spec) ===');
    for (const e of todoFlagged) {
      console.log(`  ${e.id} (${e.name}) — needs follow-up`);
    }
    console.log('');
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main();
import { addGoal, addFinding } from '../lab-core.mjs';

export async function scanIsolation() {
  try {
    const { answerFromDNA } = await import('../../experiments/42.mjs');
    const ans = await answerFromDNA('isolate');
    if (!ans || !ans.answer) return 0;
    const text = ans.answer;

    // "All zones isolated" → clean
    if (text.includes('All zones isolated')) return 0;

    // Parse report: first line is "N boundary violations:"
    const lines = text.split('\n');
    const header = lines[0].match(/^(\d+) boundary violations/);
    if (!header) return 0;
    const total = parseInt(header[1], 10);
    if (total === 0) return 0;

    // Group violations by zone-pair (e.g., "  lab → experiments (3):")
    let currentZone = '';
    let zoneCount = 0;
    for (const line of lines) {
      const zoneMatch = line.match(/^\s+(\S+ → \S+) \((\d+)\):/);
      if (zoneMatch) {
        currentZone = zoneMatch[1];
        zoneCount = parseInt(zoneMatch[2], 10);
        addFinding('bridge', 'boundary', `${currentZone}: ${zoneCount} violations`);
        addGoal(`[boundary] ${currentZone}: ${zoneCount} violation(s) — run "dna_query(question: 'isolate')" for details`, { priority: 2 });
      }
    }

    return total;
  } catch {
    return 0;
  }
}

import { createHash } from 'crypto';

const FILE_RE = /^===FILE===\s+(\S+)/;
const HASHLINE_RE = /^===HASHLINE===\s+(\w+)/;

export function extractFiles(output) {
  const files = [];
  let currentPath = null;
  const lines = output.split('\n');
  for (const line of lines) {
    const fm = line.match(FILE_RE);
    if (fm) { currentPath = fm[1]; continue; }
    if (currentPath && !line.startsWith('===')) {
      files.push({ path: currentPath, content: line });
      currentPath = null;
    }
  }
  return files;
}

export function extractHashlines(output) {
  const results = [];
  let currentPath = null;
  let pendingHash = null;
  const lines = output.split('\n');
  for (const line of lines) {
    const fm = line.match(FILE_RE);
    if (fm) { currentPath = fm[1]; continue; }
    const hm = line.match(HASHLINE_RE);
    if (hm) { pendingHash = { path: currentPath, hash: hm[1] }; continue; }
    if (pendingHash) {
      results.push({ path: pendingHash.path, hash: pendingHash.hash, newContent: line.trim() });
      pendingHash = null;
    }
  }
  return results;
}

export function applyHashlineEdit(content, hash, newContent) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineHash = createHash('md5').update(lines[i]).digest('hex').substring(0, 8);
    if (lineHash === hash) {
      lines[i] = newContent;
      return { updated: true, newContent: lines.join('\n'), line: i };
    }
  }
  return { updated: false, newContent: content };
}

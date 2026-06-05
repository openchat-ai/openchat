/**
 * 文件格式解析：===FILE:path=== 块 + HASHLINE 单行替换
 */
import crypto from 'crypto';

export const FILE_DELIMITER_START = '===FILE:';
export const FILE_DELIMITER_END = '===';

const FILE_REGEX = /===FILE:([^\n]+)===\n([\s\S]*?)(?====FILE:|$)/g;
const HASHLINE_REGEX = /HASHLINE:([^\n|]+)\|([a-f0-9]{8})\|(.+)/gi;

export function extractFiles(output) {
  if (!output) return [];
  const files = [];
  for (const m of output.matchAll(FILE_REGEX)) {
    files.push({ path: m[1].trim(), content: m[2].trim() });
  }
  return files;
}

/** 从完整文件中找 hash 匹配的行，返回替换后的完整文件内容 */
export function applyHashlineEdit(fullContent, hash, newLine) {
  const lines = fullContent.split('\n');
  const target = hash.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const lineHash = crypto.createHash('md5').update(lines[i]).digest('hex').substring(0, 8);
    if (lineHash === target) {
      lines[i] = newLine;
      return { newContent: lines.join('\n'), line: i };
    }
  }
  return null;
}

export function extractHashlines(output) {
  if (!output) return [];
  const lines = [];
  for (const m of output.matchAll(HASHLINE_REGEX)) {
    lines.push({ path: m[1].trim(), hash: m[2].toLowerCase(), newContent: m[3] });
  }
  return lines;
}

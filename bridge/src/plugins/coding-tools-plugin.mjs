import { readFile, writeFile, editFile, hashEdit, TOOLS, executeTool } from '../tools/coding-tools.mjs';

function wrapResult(result) {
  if (result && typeof result === 'object' && 'success' in result) return result;
  return { success: true, ...result };
}

export const CodingToolsPlugin = {
  id: 'plugin-coding-tools',
  name: 'Coding Tools',
  description: 'File read/write/edit with quality gate, path traversal protection, hashline support.',
  tools: [
    {
      name: 'read_file',
      description: 'Read a file from the project. Path is relative to project root.',
      params: { path: { type: 'string', description: 'Relative file path' } },
      execute: async ({ path }) => {
        const content = await readFile(path);
        return wrapResult({ content });
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file. Creates directories if needed. Path is relative to project root.',
      params: {
        path: { type: 'string', description: 'Relative file path' },
        content: { type: 'string', description: 'File content' },
      },
      execute: async ({ path, content }) => {
        const r = await writeFile(path, content);
        return wrapResult(r);
      },
    },
    {
      name: 'edit_file',
      description: 'Search and replace in a file. Runs lint after edit, rolls back on failure. Search string must be unique.',
      params: {
        path: { type: 'string' },
        search: { type: 'string', description: 'Exact text to find (must be unique)' },
        newStr: { type: 'string', description: 'Replacement text' },
        force: { type: 'boolean', description: 'Skip quality gate. Default false.' },
        test: { type: 'boolean', description: 'Also run tests after edit (default false). Only valid when force=false.' },
      },
      execute: async ({ path, search, newStr, force, test }) => {
        const r = await editFile(path, search, newStr, { force: force === true, test: !!test });
        return wrapResult(r);
      },
    },
    {
      name: 'hash_edit',
      description: 'Edit a single line by 8-char md5 hash anchor. Saves tokens vs search/replace on large files. Hash = md5(line) first 8 hex chars.',
      params: {
        path: { type: 'string' },
        hash: { type: 'string', description: '8-char hex md5 of the target line' },
        newContent: { type: 'string', description: 'Replacement line content' },
      },
      execute: async ({ path, hash, newContent }) => {
        const r = await hashEdit(path, hash, newContent);
        return wrapResult(r);
      },
    },
  ],
};

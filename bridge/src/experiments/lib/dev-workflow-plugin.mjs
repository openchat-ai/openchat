// Dev Workflow Plugin — wraps system-exec, coding-tools, auto-commit, project-context
// Registers with PluginManager to replace legacy tools with our improved implementations.
// === invariants ===
// - Each execute() dynamically imports the relevant tool module
// - run_command uses isSafeCommand + output-compressor
// - read_file/write_file/edit_file include path traversal protection + quality gate
// - git_commit uses auto-commit with diff-based message generation
// - analyze_project uses project-context's findDependencies + getProjectStructure

export const DevWorkflowPlugin = {
  id: 'plugin-dev-workflow',
  name: 'Dev Workflow',
  description: 'Enhanced dev tools: safe command execution, quality-gated edits, auto-commit, project analysis.',
  tools: [
    {
      name: 'run_command',
      description: 'Execute a shell command with safety checks. Whitelisted: npm, node, git, flutter, dart, ls, cat, pwd, echo, mkdir, rm (safe), cp, mv, grep, find, head, tail, sort, wc, curl, dir, type, cd. Blocked: rm -rf /, sudo, shutdown, del /f, format, >nul.',
      params: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in ms (default 10000)', required: false },
      },
      execute: async ({ command, timeout = 10000 }) => {
        const { execCommand } = await import('./system-exec.mjs');
        const result = execCommand(command, timeout, true);
        return { success: result.exitCode === 0, output: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
      },
    },
    {
      name: 'read_file',
      description: 'Read a file. Path is relative to project root. Path traversal is blocked.',
      params: {
        path: { type: 'string', description: 'Relative file path' },
      },
      execute: async ({ path }) => {
        const { readFile } = await import('./coding-tools.mjs');
        const content = await readFile(path);
        return { success: true, content };
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
        const { writeFile } = await import('./coding-tools.mjs');
        const result = await writeFile(path, content);
        return { success: true, path: result.path, bytes: result.bytes };
      },
    },
    {
      name: 'edit_file',
      description: 'Search and replace in a file with quality gate. Runs lint after edit, rolls back on failure. The search string must be unique. No regex.',
      params: {
        path: { type: 'string', description: 'Relative file path' },
        search: { type: 'string', description: 'Exact text to find (must be unique)' },
        newStr: { type: 'string', description: 'Replacement text' },
        force: { type: 'boolean', description: 'Skip quality gate (lint check). Default false.', required: false },
        test: { type: 'boolean', description: 'Also run tests after edit (default false). Only when force=false.', required: false },
      },
      execute: async ({ path, search, newStr, force, test }) => {
        const { editFile } = await import('./coding-tools.mjs');
        const result = await editFile(path, search, newStr, { force: force === true, test: !!test });
        return { success: true, ...result };
      },
    },
    {
      name: 'git_commit',
      description: 'Stage one or more files and commit with an auto-generated message based on diff analysis. Only works inside a git repo.',
      params: {
        files: { type: 'string', description: 'Comma-separated file paths to stage and commit' },
      },
      execute: async ({ files }) => {
        const { autoCommit } = await import('./auto-commit.mjs');
        const fileList = files.split(',').map(f => f.trim()).filter(Boolean);
        const result = await autoCommit(fileList);
        if (result.committed) {
          return { success: true, message: result.message, files: result.files };
        }
        return { success: false, error: result.error };
      },
    },
    {
      name: 'analyze_project',
      description: 'Analyze project structure and dependencies. Returns directory tree and import dependencies for a file.',
      params: {
        filePath: { type: 'string', description: 'File path to analyze dependencies for', required: false },
        maxDepth: { type: 'number', description: 'Directory tree depth (default 3)', required: false },
      },
      execute: async ({ filePath, maxDepth = 3 }) => {
        const pc = await import('./project-context.mjs');
        const structure = await pc.getProjectStructure(undefined, maxDepth);
        let deps = [];
        if (filePath) {
          deps = await pc.findDependencies(filePath);
        }
        return { success: true, structure: structure.slice(0, 200), dependencies: deps };
      },
    },
    {
      name: 'multi_edit',
      description: 'Apply the same search/replace across all files matching a glob pattern. Reports each file result.',
      params: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "src/**/*.js")' },
        search: { type: 'string', description: 'Exact text to find' },
        newStr: { type: 'string', description: 'Replacement text' },
        force: { type: 'boolean', description: 'Skip quality gate', required: false },
      },
      execute: async ({ pattern, search, newStr, force }) => {
        const { multiEdit } = await import('./multi-edit.mjs');
        return await multiEdit(pattern, search, newStr, { force: force === true });
      },
    },
    {
      name: 'ast_edit',
      description: 'Syntax-aware edit for .js/.jsx/.mjs files. Uses AST to find target node precisely. Actions: rename (rename a function/class/variable), replace_body (replace function body).',
      params: {
        path: { type: 'string', description: 'File path (relative)' },
        selector: { type: 'string', description: 'Node selector, e.g. "function:myFunc" or "class:MyClass" or "const:myVar"' },
        action: { type: 'string', description: 'Action: "rename" or "replace_body"' },
        newValue: { type: 'string', description: 'New name (for rename) or new body content (for replace_body)' },
      },
      execute: async ({ path: filePath, selector, action, newValue }) => {
        const { astEdit } = await import('./ast-edit.mjs');
        return await astEdit(filePath, selector, action, newValue);
      },
    },
    {
      name: 'diff_review',
      description: 'Show the current git diff (staged + unstaged changes) and ask the user to approve or reject. Returns the diff text.',
      params: {},
      execute: async () => {
        const { getGitDiff } = await import('./diff-review.mjs');
        const diff = getGitDiff();
        return { success: true, diff };
      },
    },
  ],
};

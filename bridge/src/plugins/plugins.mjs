import { pluginManager } from '../core/core-config.mjs';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execPromise = promisify(exec);

// === system-plugins.js ===
export const ShellPlugin = {
  id: 'plugin-shell',
  name: 'System Shell',
  description: 'Allows execution of shell commands on the local machine.',
  tools: [
    {
      name: 'run_command',
      description: 'Executes a shell command and returns the output.',
      params: {
        command: { type: 'string', description: 'The command to run' }
      },
      execute: async ({ command }, context) => {
        console.debug(`[Shell] Executing: ${command}`);
        try {
          const { stdout, stderr } = await execPromise(command);
          return {
            success: true,
            output: stdout || stderr,
            exitCode: 0
          };
        } catch (error) {
          return {
            success: false,
            output: error.stderr || error.message,
            exitCode: error.code || 1
          };
        }
      }
    }
  ]
};

export const FilePlugin = {
  id: 'plugin-file',
  name: 'File System',
  description: 'Read, write and manage files on the local disk.',
  tools: [
    {
      name: 'read_file',
      description: 'Reads the contents of a file.',
      params: {
        path: { type: 'string', description: 'Absolute path to the file' }
      },
      execute: async ({ path }) => {
        const mod = await import('fs/promises');
        const content = await mod.readFile(path, 'utf8');
        return { success: true, content };
      }
    },
    {
      name: 'write_file',
      description: 'Writes content to a file.',
      params: {
        path: { type: 'string', description: 'Absolute path' },
        content: { type: 'string', description: 'Content to write' }
      },
      execute: async ({ path, content }) => {
        const mod = await import('fs/promises');
        await mod.writeFile(path, content, 'utf8');
        return { success: true };
      }
    }
  ]
};

// === eng-plugins.js ===
export const GitPlugin = {
  id: 'plugin-git',
  name: 'Git Version Control',
  description: 'Manage source control: commits, branching, and diffing.',
  tools: [
    {
      name: 'git_status',
      description: 'Check the current state of the git repository.',
      params: {},
      execute: async () => {
        try {
          const { stdout } = await execPromise('git status');
          return { success: true, output: stdout };
        } catch (e) {
          return { success: false, output: e.stderr || e.message };
        }
      }
    },
    {
      name: 'git_commit',
      description: 'Stage all changes and create a commit.',
      params: {
        message: { type: 'string', description: 'The commit message' }
      },
      execute: async ({ message }) => {
        try {
          await execPromise('git add .');
          const { stdout } = await execPromise(`git commit -m "${message}"`);
          return { success: true, output: stdout };
        } catch (e) {
          return { success: false, output: e.stderr || e.message };
        }
      }
    },
    {
      name: 'git_diff',
      description: 'View changes in the working directory.',
      params: {},
      execute: async () => {
        try {
          const { stdout } = await execPromise('git diff');
          return { success: true, output: stdout };
        } catch (e) {
          return { success: false, output: e.stderr || e.message };
        }
      }
    }
  ]
};

export const DevToolsPlugin = {
  id: 'plugin-devtools',
  name: 'Development Tools',
  description: 'Run linting, type checking, and tests to verify code quality.',
  tools: [
    {
      name: 'run_lint',
      description: 'Run the project lint command.',
      params: {
        command: { type: 'string', description: 'Lint command', default: 'npm run lint' }
      },
      execute: async ({ command = 'npm run lint' }) => {
        try {
          const { stdout, stderr } = await execPromise(command);
          return { success: true, output: stdout + stderr };
        } catch (e) {
          return { success: false, output: e.stdout + e.stderr };
        }
      }
    },
    {
      name: 'run_tests',
      description: 'Run the project test suite.',
      params: {
        command: { type: 'string', description: 'Test command', default: 'npm test' }
      },
      execute: async ({ command = 'npm test' }) => {
        try {
          const { stdout, stderr } = await execPromise(command);
          return { success: true, output: stdout + stderr };
        } catch (e) {
          return { success: false, output: e.stdout + e.stderr };
        }
      }
    }
  ]
};

// === self-test-plugin.js ===
class SelfTestPlugin {
  constructor() {
    this.id = 'self-test';
    this.name = 'Self-Test Framework';
    this.description = 'Run automated quality tests and performance evaluations on the current project to ensure reliability.';
    this.tools = [
      {
        name: 'run_llm_judge',
        description: 'Executes the LLM-as-a-Judge suite to get a professional score on the task execution quality.',
        execute: async ({ testCaseId }) => {
          console.debug(`[SelfTest] Evaluating quality for case: ${testCaseId || 'Full Suite'}`);
          try {
            const { stdout } = await execPromise('npm run test:llm-judge');
            const reportMatch = stdout.match(/📊 评测总结: (\{.*})/s);
            if (reportMatch) {
              return JSON.parse(reportMatch[1]);
            }
            return { success: true, output: stdout };
          } catch (error) {
            return { success: false, error: error.message, output: error.stdout };
          }
        }
      },
      {
        name: 'run_chaos_test',
        description: 'Injects faults into the system to test resilience and error recovery capabilities.',
        execute: async () => {
          console.debug('[SelfTest] Injecting chaos to verify robustness...');
          try {
            const { stdout } = await execPromise('npm run test:chaos');
            const reportMatch = stdout.match(/📊 混沌工程测试报告:([\s\S]*)/);
            if (reportMatch) {
              return JSON.parse(reportMatch[1].trim());
            }
            return { success: true, output: stdout };
          } catch (error) {
            return { success: false, error: error.message, output: error.stdout };
          }
        }
      },
      {
        name: 'run_property_test',
        description: 'Generates random action sequences to find edge-case crashes (Fuzzing).',
        execute: async () => {
          console.debug('[SelfTest] Running property-based fuzzing...');
          try {
            const { stdout } = await execPromise('npm run test:property');
            const reportMatch = stdout.match(/📊 基于属性测试结果: (\{.*})/s);
            if (reportMatch) {
              return JSON.parse(reportMatch[1]);
            }
            return { success: true, output: stdout };
          } catch (error) {
            return { success: false, error: error.message, output: error.stdout };
          }
        }
      }
    ];
  }
}

export default new SelfTestPlugin();

// === agent-tools.js helper functions ===
async function scanDirectory(dir, pattern, maxResults = 100) {
  const results = [];
  const regex = pattern ? new RegExp(pattern.replace(/\*/g, '.*')) : null;

  async function scan(currentDir) {
    if (results.length >= maxResults) return;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.name === 'node_modules' || entry.name === '.git') continue;

        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          if (!regex || regex.test(entry.name)) {
            results.push(fullPath);
          }
        }
      }
    } catch (e) {
    }
  }

  await scan(dir);
  return results;
}

async function searchInFiles(dir, pattern, filePattern, maxResults = 50) {
  const results = [];
  const fileRegex = filePattern ? new RegExp(filePattern.replace(/\*/g, '.*')) : /\.(js|ts|jsx|tsx|py|java|go|rs)$/;

  async function searchFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        if (lines[i].includes(pattern)) {
          results.push(`${filePath}:${i + 1}: ${lines[i].trim().substring(0, 100)}`);
        }
      }
    } catch (e) {
    }
  }

  async function scan(currentDir) {
    if (results.length >= maxResults) return;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.name === 'node_modules' || entry.name === '.git') continue;

        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile() && fileRegex.test(entry.name)) {
          await searchFile(fullPath);
        }
      }
    } catch (e) {
    }
  }

  await scan(dir);
  return results;
}

// === agent-tools.js plugins ===
export const CodeAnalysisPlugin = {
  id: 'plugin-code-analysis',
  name: 'Code Analysis',
  description: 'Analyze code structure, search patterns, and understand codebase.',
  tools: [
    {
      name: 'search_code',
      description: 'Search for a pattern in files (like grep). Returns matching lines.',
      params: {
        pattern: { type: 'string', description: 'The pattern to search for' },
        path: { type: 'string', description: 'Directory or file to search in', required: false },
        filePattern: { type: 'string', description: 'Glob pattern for files', required: false }
      },
      execute: async ({ pattern, path: searchPath = '.', filePattern = '' }) => {
        try {
          const matches = await searchInFiles(searchPath, pattern, filePattern, 50);
          return { success: true, matches, count: matches.length };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    },
    {
      name: 'list_files',
      description: 'List files in a directory with optional pattern matching.',
      params: {
        path: { type: 'string', description: 'Directory path', required: false },
        pattern: { type: 'string', description: 'Glob pattern', required: false }
      },
      execute: async ({ path: dirPath = '.', pattern = '' }) => {
        try {
          const files = await scanDirectory(dirPath, pattern, 100);
          return { success: true, files, count: files.length };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    },
    {
      name: 'analyze_file',
      description: 'Analyze a source file: count lines, functions, imports.',
      params: {
        path: { type: 'string', description: 'File path to analyze' }
      },
      execute: async ({ path: filePath }) => {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.split('\n').length;

          const analysis = {
            path: filePath,
            lines,
            characters: content.length,
            imports: (content.match(/^import .+$/gm) || []).length,
            exports: (content.match(/^export .+$/gm) || []).length,
            functions: (content.match(/(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(|class\s+\w+)/g) || []).length,
            classes: (content.match(/class\s+\w+/g) || []).length,
            comments: (content.match(/\/\/.*$|\/\*[\s\S]*?\*\//gm) || []).length
          };

          return { success: true, analysis };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    },
    {
      name: 'find_definition',
      description: 'Find where a function/class is defined.',
      params: {
        name: { type: 'string', description: 'Function or class name' },
        type: { type: 'string', description: 'Type: function, class, const, or all', required: false }
      },
      execute: async ({ name, type = 'all' }) => {
        try {
          const matches = await searchInFiles('.', name, '*.js,*.ts', 20);

          const definitions = matches.filter(m => {
            const line = m.toLowerCase();
            return line.includes('function ' + name.toLowerCase()) ||
                   line.includes('class ' + name.toLowerCase()) ||
                   line.includes('const ' + name.toLowerCase()) ||
                   line.match(new RegExp(`${name}\\s*\\(`, 'i'));
          });

          return { success: true, matches: definitions };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    }
  ]
};

export const ProjectManagementPlugin = {
  id: 'plugin-project',
  name: 'Project Management',
  description: 'Manage project dependencies, scripts, and configuration.',
  tools: [
    {
      name: 'read_package_json',
      description: 'Read and analyze package.json for scripts and dependencies.',
      params: {
        path: { type: 'string', description: 'Path to package.json', required: false }
      },
      execute: async ({ path: filePath = './package.json' }) => {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const pkg = JSON.parse(content);

          return {
            success: true,
            name: pkg.name,
            version: pkg.version,
            scripts: pkg.scripts || {},
            dependencies: Object.keys(pkg.dependencies || {}),
            devDependencies: Object.keys(pkg.devDependencies || {}),
            main: pkg.main,
            type: pkg.type
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    },
    {
      name: 'run_script',
      description: 'Run an npm/yarn script from package.json.',
      params: {
        script: { type: 'string', description: 'Script name to run' },
        packageManager: { type: 'string', description: 'npm, yarn, or pnpm', required: false }
      },
      execute: async ({ script, packageManager = 'npm' }) => {
        try {
          const cmd = packageManager === 'npm' ? `npm run ${script}` :
                      packageManager === 'yarn' ? `yarn ${script}` :
                      `pnpm ${script}`;

          const { stdout, stderr } = await execPromise(cmd, {
            timeout: 60000,
            maxBuffer: 1024 * 1024 * 10
          });

          return { success: true, output: stdout + stderr };
        } catch (e) {
          return { success: false, output: e.stdout + e.stderr, exitCode: e.code };
        }
      }
    },
    {
      name: 'install_dependency',
      description: 'Install a new npm package.',
      params: {
        package: { type: 'string', description: 'Package name to install' },
        dev: { type: 'boolean', description: 'Install as devDependency', required: false },
        packageManager: { type: 'string', description: 'npm, yarn, or pnpm', required: false }
      },
      execute: async ({ package: pkg, dev = false, packageManager = 'npm' }) => {
        try {
          let cmd;
          if (packageManager === 'npm') {
            cmd = `npm install ${dev ? '--save-dev' : '--save'} ${pkg}`;
          } else if (packageManager === 'yarn') {
            cmd = `yarn add ${pkg} ${dev ? '--dev' : ''}`;
          } else {
            cmd = `pnpm add ${pkg} ${dev ? '--save-dev' : ''}`;
          }

          const { stdout, stderr } = await execPromise(cmd, {
            timeout: 120000,
            maxBuffer: 1024 * 1024 * 10
          });

          return { success: true, output: stdout + stderr };
        } catch (e) {
          return { success: false, output: e.stdout + e.stderr };
        }
      }
    },
    {
      name: 'get_project_info',
      description: 'Get comprehensive project information.',
      params: {},
      execute: async () => {
        try {
          const cwd = process.cwd();
          const pkgPath = path.join(cwd, 'package.json');

          let pkgInfo = {};
          try {
            const content = await fs.readFile(pkgPath, 'utf8');
            pkgInfo = JSON.parse(content);
          } catch {
          }

          const jsFiles = await scanDirectory('.', '\\.(js|ts)$', 10000);
          const totalFiles = await scanDirectory('.', '', 10000);

          return {
            success: true,
            cwd,
            package: pkgInfo.name || 'unknown',
            version: pkgInfo.version || 'unknown',
            type: pkgInfo.type || 'commonjs',
            jsFiles: jsFiles.length,
            totalFiles: totalFiles.length,
            scripts: pkgInfo.scripts || {}
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    }
  ]
};

export const WebToolsPlugin = {
  id: 'plugin-web',
  name: 'Web Tools',
  description: 'Make HTTP requests and interact with web resources.',
  tools: [
    {
      name: 'http_get',
      description: 'Make an HTTP GET request.',
      params: {
        url: { type: 'string', description: 'URL to fetch' },
        headers: { type: 'object', description: 'Request headers', required: false }
      },
      execute: async ({ url, headers = {} }) => {
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: { 'User-Agent': 'OpenChat-Bridge/1.0', ...headers }
          });

          const contentType = response.headers.get('content-type') || '';
          let body;

          if (contentType.includes('application/json')) {
            body = await response.json();
          } else {
            body = await response.text();
          }

          return {
            success: response.ok,
            status: response.status,
            contentType,
            body: typeof body === 'string' ? body.substring(0, 5000) : body
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    },
    {
      name: 'http_post',
      description: 'Make an HTTP POST request with JSON body.',
      params: {
        url: { type: 'string', description: 'URL to post to' },
        body: { type: 'object', description: 'JSON body' },
        headers: { type: 'object', description: 'Request headers', required: false }
      },
      execute: async ({ url, body, headers = {} }) => {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'OpenChat-Bridge/1.0',
              ...headers
            },
            body: JSON.stringify(body)
          });

          const contentType = response.headers.get('content-type') || '';
          let responseBody;

          if (contentType.includes('application/json')) {
            responseBody = await response.json();
          } else {
            responseBody = await response.text();
          }

          return {
            success: response.ok,
            status: response.status,
            body: responseBody
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    }
  ]
};

export const MemoryToolsPlugin = {
  id: 'plugin-memory',
  name: 'Memory Tools',
  description: 'Store and retrieve information across sessions.',
  tools: [
    {
      name: 'remember',
      description: 'Store a fact or information for future reference.',
      params: {
        fact: { type: 'string', description: 'The fact to remember' },
        category: { type: 'string', description: 'Category for organization', required: false }
      },
      execute: async ({ fact, category = 'general' }, context) => {
        try {
          const { memoryManager } = await import('../memory/memory-manager.js');
          const userId = context?.userId || 'default';

          const id = await memoryManager.saveFact(userId, fact, { category });

          return { success: true, id, fact, category };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    },
    {
      name: 'recall',
      description: 'Search for previously stored information.',
      params: {
        query: { type: 'string', description: 'Search query' },
        topK: { type: 'number', description: 'Max results to return', required: false }
      },
      execute: async ({ query, topK = 5 }, context) => {
        try {
          const { memoryManager } = await import('../memory/memory-manager.js');
          const userId = context?.userId || 'default';

          const results = await memoryManager.queryFacts(userId, query, { topK });

          return { success: true, results };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    }
  ]
};

// === init.mjs — register all plugins ===
pluginManager.registerPlugin(ShellPlugin);
pluginManager.registerPlugin(FilePlugin);
pluginManager.registerPlugin(GitPlugin);
pluginManager.registerPlugin(DevToolsPlugin);
pluginManager.registerPlugin(CodeAnalysisPlugin);
pluginManager.registerPlugin(ProjectManagementPlugin);
pluginManager.registerPlugin(WebToolsPlugin);
pluginManager.registerPlugin(MemoryToolsPlugin);
pluginManager.registerPlugin(SelfTestPlugin);

export { pluginManager };

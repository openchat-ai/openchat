import logger from './core/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execPromise = promisify(exec);

// 跨平台文件搜索
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

        // 跳过 node_modules 和 .git
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
      // 忽略无权限目录
    }
  }

  await scan(dir);
  return results;
}

// 跨平台代码搜索
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
      // 忽略读取错误
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
      // 忽略错误
    }
  }

  await scan(dir);
  return results;
}

/**
 * CodeAnalysisPlugin - 代码分析工具
 * 提供代码搜索、符号查找、文件分析等能力
 */
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
        filePattern: { type: 'string', description: 'Glob pattern for files (e.g., "*.js")', required: false }
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
        pattern: { type: 'string', description: 'Glob pattern (e.g., "*.js")', required: false }
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
          // 使用文本搜索找定义
          const matches = await searchInFiles('.', name, '*.js,*.ts', 20);

          // 过滤出定义行
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

/**
 * ProjectManagementPlugin - 项目管理工具
 * 提供项目信息、依赖管理、配置读取等能力
 */
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
          } catch (e) { logger.warn('[IGNORE] // No package.json: ' + (e?.message || '')); }

          // Count files using native method
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

/**
 * WebToolsPlugin - 网络工具
 * 提供 HTTP 请求、URL 访问等能力
 */
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

/**
 * MemoryToolsPlugin - 记忆工具
 * 让 Agent 可以主动存储和检索信息
 */
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

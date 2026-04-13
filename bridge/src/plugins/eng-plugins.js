import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execPromise = promisify(exec);

/**
 * GitPlugin provides high-level version control operations.
 * This allows the Agent to manage branches, commits, and diffs.
 */
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

/**
 * DevToolsPlugin provides quality assurance tools (Lint/Test).
 * This enables the "Verify" part of the Think-Act-Verify loop.
 */
export const DevToolsPlugin = {
  id: 'plugin-devtools',
  name: 'Development Tools',
  description: 'Run linting, type checking, and tests to verify code quality.',
  tools: [
    {
      name: 'run_lint',
      description: 'Run the project lint command.',
      params: {
        command: { type: 'string', description: 'Lint command (e.g., "npm run lint")', default: 'npm run lint' }
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
        command: { type: 'string', description: 'Test command (e.g., "npm test")', default: 'npm test' }
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

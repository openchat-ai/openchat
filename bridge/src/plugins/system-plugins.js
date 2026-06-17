import { pluginManager } from './plugin-manager.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * ShellPlugin provides the AI with the ability to run commands on the host system.
 * This is the foundation for "programming capabilities".
 */
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

/**
 * FilePlugin provides file system operations.
 */
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
        const fs = await import('fs/promises');
        const content = await fs.readFile(path, 'utf8');
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
        const fs = await import('fs/promises');
        await fs.writeFile(path, content, 'utf8');
        return { success: true };
      }
    }
  ]
};

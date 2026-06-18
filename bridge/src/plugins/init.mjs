import { pluginManager } from '../core/plugin-manager.js';
import { ShellPlugin, FilePlugin } from './system-plugins.js';
import { GitPlugin, DevToolsPlugin } from './eng-plugins.js';
import SelfTestPlugin from './self-test-plugin.js';
import { DevWorkflowPlugin } from './dev-workflow-plugin.mjs';
import {
  CodeAnalysisPlugin,
  ProjectManagementPlugin,
  WebToolsPlugin,
  MemoryToolsPlugin
} from './agent-tools.js';

pluginManager.registerPlugin(ShellPlugin);
pluginManager.registerPlugin(FilePlugin);
pluginManager.registerPlugin(GitPlugin);
pluginManager.registerPlugin(DevToolsPlugin);
pluginManager.registerPlugin(CodeAnalysisPlugin);
pluginManager.registerPlugin(ProjectManagementPlugin);
pluginManager.registerPlugin(WebToolsPlugin);
pluginManager.registerPlugin(MemoryToolsPlugin);
pluginManager.registerPlugin(SelfTestPlugin);
pluginManager.registerPlugin(DevWorkflowPlugin);

export { pluginManager };

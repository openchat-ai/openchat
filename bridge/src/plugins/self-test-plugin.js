import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import logger from '../core/logger.js';

const execPromise = promisify(exec);

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
          logger.info(`[SelfTest] Evaluating quality for case: ${testCaseId || 'Full Suite'}`);
          try {
            // Execute the judge script
            const { stdout } = await execPromise('npm run test:llm-judge');
            
            // Parse the last summary report from the output
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
          logger.info('[SelfTest] Injecting chaos to verify robustness...');
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
          logger.info('[SelfTest] Running property-based fuzzing...');
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
// Research by 小明: 热加载协作策略：新代码先让一个实例测试，成功后才让其他实例热加载更新
// Generated: 2026-05-12T09:36:49.700Z

// 热加载协作策略模拟器
// 新代码先让一个实例测试，成功后才让其他实例热加载更新

const EventEmitter = require('events');
const crypto = require('crypto');

// 模拟模块热替换状态
class HotModuleState {
  constructor(moduleName) {
    this.moduleName = moduleName;
    this.currentVersion = '1.0.0';
    this.currentCode = `module.exports = () => '${moduleName} v1.0.0'`;
    this.testInstance = null;
    this.productionInstances = [];
    this.testResults = [];
    this.rollbackCount = 0;
  }

  // 模拟加载代码为可执行模块
  loadCode(code) {
    try {
      // 使用 eval 模拟模块加载（实际项目应使用 vm 模块或 require）
      const module = { exports: {} };
      const wrappedCode = `(function(module) { ${code} })(module)`;
      eval(wrappedCode);
      return module.exports;
    } catch (err) {
      throw new Error(`代码加载失败: ${err.message}`);
    }
  }

  // 模拟测试执行
  async runTest(instance, testCases) {
    const results = [];
    for (const testCase of testCases) {
      try {
        const startTime = Date.now();
        const output = instance(testCase.input);
        const duration = Date.now() - startTime;
        const passed = output === testCase.expected;
        results.push({
          input: testCase.input,
          expected: testCase.expected,
          actual: output,
          passed,
          duration
        });
      } catch (err) {
        results.push({
          input: testCase.input,
          expected: testCase.expected,
          error: err.message,
          passed: false
        });
      }
    }
    return results;
  }

  // 模拟热加载更新
  async hotReload(newCode, testCases) {
    console.log(`\n[${this.moduleName}] 尝试热加载新版本...`);
    
    // 1. 创建测试实例
    try {
      const testInstance = this.loadCode(newCode);
      console.log(`[${this.moduleName}] 测试实例创建成功`);
      
      // 2. 运行测试
      console.log(`[${this.moduleName}] 运行 ${testCases.length} 个测试用例...`);
      const results = await this.runTest(testInstance, testCases);
      
      // 3. 分析测试结果
      const passed = results.filter(r => r.passed).length;
      const failed = results.filter(r => !r.passed).length;
      const allPassed = failed === 0;
      
      console.log(`[${this.moduleName}] 测试结果: ${passed} 通过, ${failed} 失败`);
      
      if (allPassed) {
        console.log(`[${this.moduleName}] ✓ 所有测试通过，开始热加载到所有实例`);
        
        // 4. 更新生产实例
        this.currentCode = newCode;
        this.currentVersion = this.bumpVersion();
        this.productionInstances = this.productionInstances.map(() => this.loadCode(newCode));
        console.log(`[${this.moduleName}] 已更新到版本 ${this.currentVersion}`);
        return { success: true, results };
      } else {
        console.log(`[${this.moduleName}] ✗ 测试未通过，回滚更改`);
        this.rollbackCount++;
        return { success: false, results };
      }
      
    } catch (err) {
      console.log(`[${this.moduleName}] ✗ 代码加载失败: ${err.message}`);
      this.rollbackCount++;
      return { success: false, error: err.message };
    }
  }

  bumpVersion() {
    const parts = this.currentVersion.split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    return parts.join('.');
  }
}

// 模拟系统管理器
class HotReloadManager extends EventEmitter {
  constructor() {
    super();
    this.modules = new Map();
    this.systemLoad = 0;
  }

  registerModule(name, initialCode) {
    const state = new HotModuleState(name);
    state.productionInstances = [state.loadCode(initialCode)];
    state.testInstance = state.productionInstances[0];
    this.modules.set(name, state);
    console.log(`[系统] 注册模块: ${name}`);
  }

  async attemptUpdate(moduleName, newCode, testCases) {
    const state = this.modules.get(moduleName);
    if (!state) {
      console.log(`[系统] 模块 ${moduleName} 未注册`);
      return;
    }

    this.emit('updateStart', moduleName);
    this.systemLoad++;
    
    const result = await state.hotReload(newCode, testCases);
    
    this.systemLoad--;
    this.emit('updateComplete', moduleName, result);
    
    return result;
  }

  getStatus() {
    const status = {};
    for (const [name, state] of this.modules) {
      status[name] = {
        version: state.currentVersion,
        instances: state.productionInstances.length,
        rollbacks: state.rollbackCount
      };
    }
    return status;
  }
}

// 主模拟程序
async function main() {
  console.log('========================================');
  console.log('  热加载协作策略模拟器');
  console.log('  新代码先测试，成功后再热加载');
  console.log('========================================\n');

  const manager = new HotReloadManager();

  // 监听事件
  manager.on('updateStart', (module) => {
    console.log(`[事件] ${module} 开始更新`);
  });
  manager.on('updateComplete', (module, result) => {
    console.log(`[事件] ${module} 更新完成: ${result.success ? '成功' : '失败'}`);
  });

  // 注册一个计算模块
  const initialCode = `
    module.exports = function(input) {
      return input * 2;
    }
  `;
  manager.registerModule('calculator', initialCode);

  // 定义测试用例
  const testCases = [
    { input: 2, expected: 4 },
    { input: 5, expected: 10 },
    { input: 0, expected: 0 },
    { input: -3, expected: -6 }
  ];

  console.log('\n--- 第一次更新：正确的新代码 ---');
  const goodCode = `
    module.exports = function(input) {
      // 新功能：支持数字字符串
      if (typeof input === 'string') {
        return parseFloat(input) * 2;
      }
      return input * 2;
    }
  `;
  await manager.attemptUpdate('calculator', goodCode, testCases);

  console.log('\n--- 第二次更新：有bug的代码 ---');
  const buggyCode = `
    module.exports = function(input) {
      // bug: 忘记处理负数
      if (input < 0) return 0;
      return input * 2;
    }
  `;
  await manager.attemptUpdate('calculator', buggyCode, testCases);

  console.log('\n--- 第三次更新：更复杂的版本 ---');
  const complexCode = `
    module.exports = function(input) {
      if (typeof input === 'string') {
        const num = parseFloat(input);
        if (isNaN(num)) return 0;
        return num * 2;
      }
      if (typeof input === 'object' && input !== null) {
        return Object.keys(input).length * 2;
      }
      return input * 2;
    }
  `;
  const complexTests = [
    { input: 10, expected: 20 },
    { input: '5', expected: 10 },
    { input: { a: 1, b: 2 }, expected: 4 },
    { input: 'abc', expected: 0 }
  ];
  await manager.attemptUpdate('calculator', complexCode, complexTests);

  // 输出最终状态
  console.log('\n========================================');
  console.log('  最终系统状态');
  console.log('========================================');
  console.log(JSON.stringify(manager.getStatus(), null, 2));
  
  // 验证当前实例是否正常工作
  const state = manager.modules.get('calculator');
  console.log(`\n当前版本: ${state.currentVersion}`);
  console.log(`测试当前实例: 5 * 2 = ${state.productionInstances[0](5)}`);
  console.log(`测试当前实例: '3' * 2 = ${state.productionInstances[0]('3')}`);
}

// 运行模拟
main().catch(console.error);
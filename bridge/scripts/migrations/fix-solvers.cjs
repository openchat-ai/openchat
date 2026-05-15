const fs = require('fs');
const content = fs.readFileSync('F:/openchat/bridge/src/core/learning-core.js', 'utf8');

const oldCode = `  // ==================== 求解执行 ====================

  async _solve(problem, solver) {
    // 1. 先尝试内置求解器（数学题等）
    const autoAnswer = this._autoSolve(problem);
    if (autoAnswer !== null) {
      console.log(\`[学习核心] 自动求解: \${problem.id} = \${autoAnswer}\`);
      return autoAnswer;
    }

    // 2. 研究题：调用 agents/LLM 思考
    if (this.scheduler?._大脑思考 || this.scheduler?._callAI) {
      console.log(\`[学习核心] 居民思考: \${problem.id}\`);
      const answer = await this._askAgent(problem, solver);
      if (answer !== null) return answer;
    }

    return null;
  }

  async _askAgent(problem, solver) {
    const prompt = \`请回答以下\${problem.domain}问题：

问题：\${problem.question}

\${problem.context ? '背景：' + JSON.stringify(problem.context) : ''}

请给出简洁的答案。如果是研究性问题，请给出你的分析和建议。\`;

    try {
      const aiFunc = this.scheduler._大脑思考 || this.scheduler._callAI;
      const result = await aiFunc.call(this.scheduler, { prompt, subQuestions: [] });
      
      if (result) {
        const answer = typeof result === 'string' ? result.trim() : JSON.stringify(result);
        console.log(\`[学习核心] 居民回答: \${answer.substring(0, 50)}...\`);
        return answer;
      }
    } catch (e) {
      console.log(\`[学习核心] 居民思考失败: \${e.message}\`);
    }
    
    return null;
  }`;

const newCode = `  // ==================== 求解执行 ====================

  async _solve(problem, solver) {
    // 自动发现所有可用求解器，逐一尝试
    const solvers = this._discoverSolvers();
    
    for (const { name, solve } of solvers) {
      try {
        const answer = await solve(problem, solver);
        if (answer !== null && answer !== undefined) {
          console.log(\`[学习核心] \${name}求解成功: \${problem.id}\`);
          return answer;
        }
      } catch (e) {
        console.log(\`[学习核心] \${name}求解失败: \${e.message}\`);
      }
    }
    
    return null;
  }

  // 自动发现可用求解器
  _discoverSolvers() {
    const solvers = [];
    
    // 1. 内置规则求解器
    solvers.push({
      name: '内置规则',
      solve: (p) => this._autoSolve(p)
    });
    
    // 2. 知识库查询
    if (this.kb?.answer) {
      solvers.push({
        name: '知识库',
        solve: (p) => {
          const result = this.kb.answer(p.domain, p.question);
          return result?.answer || null;
        }
      });
    }
    
    // 3. 居民思考（agents/LLM）
    if (this.scheduler?._大脑思考 || this.scheduler?._callAI) {
      solvers.push({
        name: '居民思考',
        solve: (p, s) => this._askAgent(p, s)
      });
    }
    
    // 4. P2P 协作（请求其他实例）
    if (this.p2p) {
      solvers.push({
        name: 'P2P协作',
        solve: (p) => this._askPeers(p)
      });
    }
    
    return solvers;
  }

  async _askAgent(problem, solver) {
    const prompt = \`请回答以下问题：

问题：\${problem.question}

\${problem.context ? '背景：' + JSON.stringify(problem.context) : ''}

请给出简洁的答案。\`;

    try {
      const aiFunc = this.scheduler._大脑思考 || this.scheduler._callAI;
      const result = await aiFunc.call(this.scheduler, { prompt, subQuestions: [] });
      
      if (result) {
        return typeof result === 'string' ? result.trim() : JSON.stringify(result);
      }
    } catch (e) {
      console.log(\`[学习核心] 居民思考失败: \${e.message}\`);
    }
    
    return null;
  }

  async _askPeers(problem) {
    // TODO: 通过 P2P 请求其他实例帮助求解
    return null;
  }`;

const newContent = content.replace(oldCode, newCode);
fs.writeFileSync('F:/openchat/bridge/src/core/learning-core.js', newContent);
console.log('Updated to auto-discover solvers');

const fs = require('fs');
let content = fs.readFileSync('F:/openchat/bridge/src/core/learning-core.js', 'utf8');

const oldCode = `  async _letResidentThink(resident, context) {
    // 居民用 LLM 思考：观察到什么？有什么疑问？
    // 这需要调用 AI provider
    // 如果没 LLM，返回 null
    return null; // TODO: 接入 LLM 让居民自己思考
  }`;

const newCode = `  async _letResidentThink(resident, context) {
    // 居民用 LLM 自己思考：观察到什么？有什么疑问？
    if (!this.scheduler?._大脑思考 && !this.scheduler?._callAI) {
      return null;
    }

    const prompt = \`我是居民 \${resident.name}，我观察到以下情况：

我的状态：智商\${context.myIq}，年龄\${context.myAge}，已解决\${context.mySolved}题，待解\${context.pendingProblems}题
姐妹状态：\${JSON.stringify(context.sisters)}

请思考：
1. 有什么异常或奇怪的地方吗？
2. 有什么值得研究的问题吗？
3. 我应该主动做什么？

输出格式（JSON）：
{ "thoughts": "我的想法...", "questions": ["问题1", "问题2"], "action": "建议行动" }\`;

    try {
      const aiFunc = this.scheduler._大脑思考 || this.scheduler._callAI;
      const result = await aiFunc.call(this.scheduler, { prompt, subQuestions: [] });
      
      if (result) {
        let parsed = result;
        if (typeof result === 'string') {
          try {
            parsed = JSON.parse(result.replace(/\\\`\\\`\\\`json|\\\`\\\`\\\`/g, '').trim());
          } catch {
            const m = result.match(/\\{[\\s\\S]*\\}/);
            if (m) parsed = JSON.parse(m[0]);
          }
        }
        
        // 如果居民产生了问题，加入问题池
        if (parsed?.questions?.length > 0) {
          const question = parsed.questions[0];
          console.log(\\\`[好奇心] \${resident.name} 在想: \${question}\\\`);
          return {
            id: \\\`curious_\${Date.now()}\\\`,
            question,
            domain: 'research',
            difficulty: 2,
            answer: null,
            source: 'curiosity',
            thoughts: parsed.thoughts
          };
        }
      }
    } catch (e) {
      console.log(\\\`[好奇心] \${resident.name} 思考失败: \${e.message}\\\`);
    }
    
    return null;
  }`;

content = content.replace(oldCode, newCode);
fs.writeFileSync('F:/openchat/bridge/src/core/learning-core.js', content);
console.log('Updated _letResidentThink');

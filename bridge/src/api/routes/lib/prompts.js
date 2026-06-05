/**
 * Prompt 构造器：所有 prompt 接收 JSON 输入，返回完整 prompt 字符串
 * 这样 prompt 修改不影响路由逻辑，也方便测试和复用
 */

const SPEC_FORMAT_BLOCK = `
SPEC.md 格式（每个章节必须填满，不准写"TBD"或省略）：

# spec: [模块名]
> 简短描述 (1-2 行)

## 数据流
逐步骤描述（不是概述）：
1. 用户操作 X → 调用 Y → 更新 Z → 渲染 W
2. ...
列出每个用户操作触发的完整数据流路径

## 接口签名
完整类型化签名（不是空函数名）：
\`\`\`
class ClassName:
  constructor(param: Type)
  methodName(arg1: Type1, arg2: Type2): ReturnType
function helperName(input: Type): ReturnType
\`\`\`
包含所有类、函数、参数类型、返回类型

## 边界条件
- 输入为空时：[处理方式]
- 输入非法时：[处理方式]
- 并发场景：[处理方式]
- 错误状态：[处理方式]
至少 5 条

## 文件清单
| 文件 | 职责 | 行数上限 |
| --- | --- | --- |
| index.html | 入口+DOM+初始化 | 80 |
| script.js | 核心逻辑 | 150 |

## 调试检查点
| C | grep 关键词 | 预期 |
| --- | --- | --- |
| C1 | "[init]" | 初始化时打印 |
| C2 | "[input]" | 每次输入时打印 |
| C3 | "[result]" | 计算完成时打印 |

## 不变量
// === invariants ===
// - currentValue 始终是字符串
// - ...

请严格按照格式输出，所有章节必须填满详细具体内容。SPEC 是代码生成器的输入，不是给人看的概述。`;

export const PROMPTS = {
  /** 生成 SPEC.md */
  generateSpec({ description }) {
    return {
      system: '你是一个专业的需求分析师，擅长将用户需求转化为详细的 SPEC.md 文档。',
      user: `你是一个顶级需求分析师。请分析以下需求，生成详细的 SPEC.md 文档（施工蓝图，不是高层概述）：\n\n需求：${description}\n\n${SPEC_FORMAT_BLOCK}`,
    };
  },

  /** SPEC 简短版（用于 /api/code 内部） */
  generateSpecShort({ description }) {
    return {
      system: '你是一个专业的代码架构师，擅长生成 SPEC.md。',
      user: `你是一个顶级需求分析师。请分析以下需求，生成详细的 SPEC.md 文档：\n\n需求：${description}\n\nSPEC.md 必须包含：文件清单、接口签名、数据流、边界条件、调试检查点、不变量。\n严格按照格式输出，只输出 SPEC.md 内容。`,
    };
  },

  /** 从 SPEC 生成完整代码（首次） */
  generateCodeFromSpec({ spec }) {
    return {
      system: '你是一个顶级代码生成器，根据详细 SPEC 直接生成完整可运行代码。',
      user: `你是一个顶级代码生成器。根据以下详细 SPEC 直接生成完整可运行的代码：\n\n${spec}\n\n要求：\n- SPEC 包含完整的接口签名、数据流、边界条件、不变量\n- 直接根据接口签名生成完整实现\n- 数据流所有步骤在代码中可追溯\n- 边界条件处理方式在代码中实现\n- 不变量必须严格遵守\n- 调试检查点必须实际打印\n- 文件之间完整 wiring（不引用不存在的文件）\n\n输出格式（每个文件用 ===FILE:path=== 分隔）：\n===FILE:文件路径===\n// 完整代码\n===FILE:文件路径===\n...\n\n只输出代码，不要加其他说明。`,
    };
  },

  /** 修改已有代码（多轮） */
  editCodeFromSpec({ spec, description, files }) {
    const filesBlock = files.map(f => '===FILE:' + f.path + '===\n' + f.content).join('\n');
    return {
      system: '你是一个顶级代码修改器。',
      user: '你是一个顶级代码修改器。根据以下新的需求/SPEC 修改已有代码：\n\n当前需求：' + (description || '') + '\nSPEC:\n' + spec + '\n\n现有代码文件：\n' + filesBlock + '\n\n要求：\n- 基于现有代码修改\n- 只改需要的部分\n- 小改动用 HASHLINE:path|hash|newContent 格式\n- 大改动用 ===FILE:path=== 格式\n\n只输出代码，不要加其他说明。',
    };
  },
};

/**
 * 从 prompt 对象构造 messages 数组
 * @param {{system: string, user: string}} prompt
 * @param {Array} history - 可选历史消息
 */
export function buildMessages(prompt, history = []) {
  return [
    { role: 'system', content: prompt.system },
    ...history,
    { role: 'user', content: prompt.user },
  ];
}

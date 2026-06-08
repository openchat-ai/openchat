// extractor.mjs — 从 LLM 输出抽取 JS 函数源码 + 解析 tool 调用 (用 acorn AST)
//
// 策略:
//   1. 抽源码 (```js``` / ```...``` / 'async function mqttSubscribe' 起始段)
//   2. 用 acorn 解析整个 source 为 AST
//   3. 遍历 CallExpression, 找 `renderConnect({json: ...})` 和 `renderSubscribe({json: ...})`
//   4. 把 ObjectExpression 转成 plain JS 对象, 变量引用变 {_var: 'name'} 标记
//   5. 给 scorer 用 jsonMatches 跟 expected 比
//
// acorn 比 Function-parser 优势: 不求值, 变量引用 (clientId: clientId) 不爆

import { Parser } from 'acorn';

// === 1. 抽源码 ===

export function extractSource(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. ```js / ```javascript 代码块
  const jsBlock = text.match(/```(?:js|javascript|node)?\s*([\s\S]*?)```/);
  if (jsBlock) return jsBlock[1].trim();

  // 2. 任何 ```...``` 块
  const anyBlock = text.match(/```([\s\S]*?)```/);
  if (anyBlock) return anyBlock[1].trim();

  // 3. 找 'async function mqttSubscribe' 到末尾
  const fnStart = text.indexOf('async function mqttSubscribe');
  if (fnStart >= 0) return text.slice(fnStart);

  return null;
}

// === 2. AST 转 plain object ===
// ObjectExpression → { key: value, ... }
// value 各种类型 → JS 基本类型
// 变量 (Identifier) → { _var: 'name' }

function astToValue(node) {
  if (!node) return undefined;
  switch (node.type) {
    case 'ObjectExpression': {
      const obj = {};
      for (const prop of node.properties) {
        if (prop.type !== 'Property') continue;
        const key = prop.key.type === 'Identifier' ? prop.key.name
          : prop.key.type === 'Literal' ? String(prop.key.value)
          : null;
        if (key == null) continue;
        obj[key] = astToValue(prop.value);
      }
      return obj;
    }
    case 'ArrayExpression':
      return node.elements.map((el) => astToValue(el));
    case 'Literal':
      return node.value;
    case 'Identifier':
      return { _var: node.name };
    case 'TemplateLiteral': {
      // 简单拼接: 没有表达式时取第一个 quasi
      if (node.expressions.length === 0) return node.quasis[0]?.value?.cooked || '';
      // 有表达式: 用 { _tpl: '...${expr}...' } 标记
      return { _tpl: '<template>' };
    }
    case 'MemberExpression': {
      // obj.prop → { _member: 'obj.prop' } 简化
      return { _member: '<member>' };
    }
    default:
      return { _unknown: node.type };
  }
}

// === 3. 找 tool call ===

function findToolCall(source, toolName) {
  if (!source) return null;
  let ast;
  try {
    ast = Parser.parse(source, { ecmaVersion: 2022, sourceType: 'module' });
  } catch (e) {
    // 也试 script 模式 (LLM 可能写 CommonJS 风格)
    try {
      ast = Parser.parse(source, { ecmaVersion: 2022, sourceType: 'script' });
    } catch (e2) {
      return { _parseError: true, err: e2.message };
    }
  }
  // 遍历整个 tree
  const found = walkForToolCall(ast, toolName);
  return found;  // null 或 parsed object
}

function walkForToolCall(node, toolName) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'CallExpression') {
    // 检查 callee: 可能是 `renderConnect` (Identifier) 或 `obj.renderConnect` (MemberExpression)
    let isMatch = false;
    if (node.callee?.type === 'Identifier' && node.callee.name === toolName) {
      isMatch = true;
    } else if (node.callee?.type === 'MemberExpression' && node.callee.property?.type === 'Identifier' && node.callee.property.name === toolName) {
      isMatch = true;
    }
    if (isMatch && node.arguments?.length > 0) {
      // 取第一个 arg, 期望是 ObjectExpression: { json: { ... } }
      const arg0 = node.arguments[0];
      if (arg0.type === 'ObjectExpression') {
        return astToValue(arg0);
      }
    }
  }
  // 递归
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === 'object' && c.type) {
          const r = walkForToolCall(c, toolName);
          if (r) return r;
        }
      }
    } else if (child && typeof child === 'object' && child.type) {
      const r = walkForToolCall(child, toolName);
      if (r) return r;
    }
  }
  return null;
}

export function findToolCalls(source) {
  if (!source) return { renderConnect: null, renderSubscribe: null };
  return {
    renderConnect: findToolCall(source, 'renderConnect'),
    renderSubscribe: findToolCall(source, 'renderSubscribe'),
  };
}

// === 4. 静态检查函数签名 ===

export function checkFunctionShape(source) {
  if (!source) return { declared: false, async: false, namedMqttSubscribe: false };
  const declared = /function\s+mqttSubscribe\s*\(/.test(source) || /const\s+mqttSubscribe\s*=/.test(source);
  const async = /\basync\s+function\s+mqttSubscribe|\basync\s*\(\s*\{/.test(source);
  const namedMqttSubscribe = /mqttSubscribe/.test(source);
  return { declared, async, namedMqttSubscribe };
}

// === 5. 简单 deep-equal (跟 expected 比) ===
// 支持 {_var: 'name'} 占位符 + 数组 + 嵌套

export function jsonMatches(actual, expectedTemplate) {
  if (actual == null) return { match: false, reason: 'no actual' };

  // 变量占位符: actual 是 {_var: 'x'}
  if (typeof actual === 'object' && !Array.isArray(actual) && actual._var) {
    if (expectedTemplate === '<from arg>') return { match: true };
    return { match: false, reason: `actual is variable ${actual._var}, but expected value` };
  }

  // 期望变量
  if (expectedTemplate === '<from arg>') {
    if (typeof actual === 'string' && actual.length > 0) return { match: true };
    if (actual && typeof actual === 'object' && actual._var) return { match: true };
    return { match: false, reason: `expected <from arg>, got ${JSON.stringify(actual)}` };
  }

  // 期望数组
  if (Array.isArray(expectedTemplate)) {
    if (!Array.isArray(actual)) {
      return { match: false, reason: `expected array, got ${typeof actual}` };
    }
    if (actual.length !== expectedTemplate.length) {
      return { match: false, reason: `array length: expected ${expectedTemplate.length}, got ${actual.length}` };
    }
    for (let i = 0; i < expectedTemplate.length; i++) {
      const sub = jsonMatches(actual[i], expectedTemplate[i]);
      if (!sub.match) return { match: false, reason: `[${i}]: ${sub.reason}` };
    }
    return { match: true };
  }

  // 期望对象
  if (typeof expectedTemplate === 'object' && expectedTemplate !== null) {
    if (typeof actual !== 'object' || Array.isArray(actual) || actual === null) {
      return { match: false, reason: `expected object, got ${Array.isArray(actual) ? 'array' : typeof actual}` };
    }
    for (const k of Object.keys(expectedTemplate)) {
      if (!(k in actual)) return { match: false, reason: `missing key ${k}` };
      const sub = jsonMatches(actual[k], expectedTemplate[k]);
      if (!sub.match) return { match: false, reason: `${k}: ${sub.reason}` };
    }
    return { match: true };
  }

  // 期望字面值
  if (JSON.stringify(actual) === JSON.stringify(expectedTemplate)) {
    return { match: true };
  }
  return { match: false, reason: `expected ${JSON.stringify(expectedTemplate)}, got ${JSON.stringify(actual)}` };
}


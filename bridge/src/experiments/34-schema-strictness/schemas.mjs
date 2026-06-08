// schemas.mjs — baseline vs strict 两种 schema 变体
// baseline: 直接 import 自 coding-tools.mjs，不动 schema
// strict:   给 schema 加 example + additionalProperties:false + 显式 forbidden alternatives
//           (来自 0/10 MQTT_AUTONOMY_REPORT: 模型幻觉 `file_path` 而非 `path`)

import { TOOLS as COMBINED_TOOLS } from '../../tools/coding-tools.mjs';

export const SCHEMAS_BASELINE = COMBINED_TOOLS;

// 已知幻觉: 0/10 报告里模型用 file_path 而不是 path
// 在 strict 模式里加显式禁止说明
const FORBIDDEN_ALIASES = {
  path: 'DO NOT use `file_path`, `filepath`, `filename` — use `path` exactly.',
  connId: 'DO NOT use `connection_id`, `conn_id`, `id` — use `connId` exactly (number, from mqtt_connect return).',
  topic: 'DO NOT use `topic_name`, `channel` — use `topic` exactly.',
  pattern: 'DO NOT use `regex`, `search`, `query` — use `pattern` exactly.',
  symbol: 'DO NOT use `name`, `identifier` — use `symbol` exactly.',
};

function buildExample(tool) {
  const fn = tool.function;
  const params = fn.parameters || {};
  const props = params.properties || {};
  const required = params.required || [];
  // 用第一组 required 字段作为 example
  const example = {};
  for (const key of required.slice(0, 2)) {
    const prop = props[key] || {};
    if (prop.type === 'number') example[key] = prop.default ?? 1;
    else if (prop.type === 'boolean') example[key] = false;
    else if (prop.enum) example[key] = prop.enum[0];
    else example[key] = `<${key}>`;
  }
  return `Example: ${fn.name}(${JSON.stringify(example)})`;
}

function enrichToolSchema(tool) {
  const fn = tool.function;
  const params = fn.parameters || {};
  const props = params.properties || {};
  const required = params.required || [];

  // 1. 在 description 末尾加 example + forbidden aliases
  const exampleStr = buildExample(tool);
  const forbidden = Object.keys(props)
    .filter((k) => FORBIDDEN_ALIASES[k])
    .map((k) => FORBIDDEN_ALIASES[k])
    .join(' ');
  const requiredStr = required.length ? `Required: ${required.join(', ')}.` : '';
  const strictDesc = [
    fn.description,
    '',
    `STRICT SCHEMA. ${requiredStr}`,
    forbidden,
    exampleStr,
  ].filter(Boolean).join(' ');

  // 2. 给 properties 加 pattern 约束 (string 类型)
  const newProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (v && v.type === 'string' && !v.pattern) {
      newProps[k] = {
        ...v,
        // 限制字符串不含特殊字符
        pattern: '^[^\\s"\\\\<>{}|\\^`]{1,256}$',
      };
    } else {
      newProps[k] = v;
    }
  }

  return {
    ...tool,
    function: {
      ...fn,
      description: strictDesc,
      parameters: {
        ...params,
        type: 'object',
        properties: newProps,
        required,
        additionalProperties: false,
      },
    },
  };
}

export const SCHEMAS_STRICT = COMBINED_TOOLS.map(enrichToolSchema);

// === padded: 把 description 拉到跟 strict 一样长, 但不加 strict 标记 ===
// 目的: 隔离"description 长度"对模型的影响

function padToolSchema(tool) {
  const fn = tool.function;
  const props = fn.parameters?.properties || {};
  const required = fn.parameters?.required || [];
  // 用 3 个 example invocation 填充 (跟 strict 的 Example 块大小类似)
  const examples = [];
  for (let i = 0; i < 3; i++) {
    const ex = {};
    for (const k of required) ex[k] = `<${k}>`;
    examples.push(`${fn.name}(${JSON.stringify(ex)})`);
  }
  const padText = `Common invocations: ${examples.join(', ')}.`;
  return {
    ...tool,
    function: {
      ...fn,
      description: `${fn.description} ${padText}`,
    },
  };
}

export const SCHEMAS_PADDED = COMBINED_TOOLS.map(padToolSchema);

export const TOOL_COUNT = {
  baseline: SCHEMAS_BASELINE.length,
  padded: SCHEMAS_PADDED.length,
  strict: SCHEMAS_STRICT.length,
};

export function findSchema(tools, name) {
  return tools.find((t) => t.function.name === name);
}

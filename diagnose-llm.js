#!/usr/bin/env node

/**
 * LLM 响应诊断工具
 * 帮你找出"No response..."的真实原因
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  const env = {};
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) env[key.trim()] = value.trim();
    });
  } catch (e) {
    // 没有.env文件
  }
  return env;
}

function httpRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: JSON.parse(body),
            rawBody: body
          });
        } catch {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: null,
            rawBody: body
          });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function main() {
  const ENV = loadEnv();

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                  🔍 LLM 响应诊断工具                                        ║
║              找出"No response..."错误的真实原因                             ║
╚══════════════════════════════════════════════════════════════════════════════╝

【第一步：检查配置】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  // 检查必要的配置
  const checks = {
    'ANTHROPIC_AUTH_TOKEN': ENV.ANTHROPIC_AUTH_TOKEN,
    'ANTHROPIC_BASE_URL': ENV.ANTHROPIC_BASE_URL,
    'ANTHROPIC_DEFAULT_SONNET_MODEL': ENV.ANTHROPIC_DEFAULT_SONNET_MODEL
  };

  let configOk = true;
  for (const [key, value] of Object.entries(checks)) {
    const status = value ? '✅' : '❌';
    console.log(`${status} ${key}: ${value ? '已配置' : '未配置'}`);
    if (!value) configOk = false;
  }

  if (!configOk) {
    console.log(`\n❌ 配置不完整！\n`);
    console.log(`请先运行：\n  node setup-local-llm.js\n`);
    process.exit(1);
  }

  console.log(`\n✅ 配置完整！\n`);

  console.log(`【第二步：测试 API 连接】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  try {
    const baseUrl = ENV.ANTHROPIC_BASE_URL;
    const url = new URL(baseUrl + '/chat/completions');

    console.log(`📍 目标 API: ${url.toString()}`);
    console.log(`🔑 认证方式: Bearer Token`);
    console.log(`📦 模型: ${ENV.ANTHROPIC_DEFAULT_SONNET_MODEL}\n`);

    console.log(`发送测试请求...\n`);

    const response = await httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ENV.ANTHROPIC_AUTH_TOKEN}`,
          'x-api-key': ENV.ANTHROPIC_AUTH_TOKEN,
          'Content-Type': 'application/json'
        },
        protocol: url.protocol,
        timeout: 30000
      },
      {
        model: ENV.ANTHROPIC_DEFAULT_SONNET_MODEL,
        messages: [
          { role: 'system', content: '你是一个测试助手。' },
          { role: 'user', content: '简短回复："测试成功"' }
        ],
        temperature: 0.7,
        max_tokens: 100
      }
    );

    console.log(`【HTTP 状态码】`);
    console.log(`状态: ${response.status}`);
    console.log(`${response.status === 200 ? '✅' : '❌'} ${response.status === 200 ? '成功' : '失败'}\n`);

    if (response.status !== 200) {
      console.log(`❌ API 返回错误状态！\n`);
      console.log(`【错误详情】`);
      console.log(`原始响应: ${response.rawBody}\n`);

      if (response.body && response.body.error) {
        console.log(`错误信息: ${response.body.error.message || JSON.stringify(response.body.error)}\n`);
      }

      if (response.status === 401) {
        console.log(`💡 可能的原因：\n`);
        console.log(`  1. API Key 过期或无效`);
        console.log(`  2. API Key 格式错误`);
        console.log(`  3. 认证头设置不对\n`);
        console.log(`解决方案：\n`);
        console.log(`  • 检查 .env 文件中的 ANTHROPIC_AUTH_TOKEN`);
        console.log(`  • 确保 API Key 完整且正确`);
      } else if (response.status === 429) {
        console.log(`💡 可能的原因：\n`);
        console.log(`  • 请求过于频繁（限流）\n`);
        console.log(`解决方案：\n`);
        console.log(`  • 等待几秒钟后重试`);
      } else if (response.status === 500) {
        console.log(`💡 可能的原因：\n`);
        console.log(`  • 服务器错误\n`);
        console.log(`解决方案：\n`);
        console.log(`  • 稍后重试\n`);
      }

      process.exit(1);
    }

    console.log(`【响应格式检查】`);

    if (!response.body) {
      console.log(`❌ 响应体为空\n`);
      console.log(`这是"No response..."的原因！\n`);
      console.log(`原始响应: ${response.rawBody}\n`);
      process.exit(1);
    }

    console.log(`响应有效: ${response.body ? '✅' : '❌'}`);

    if (response.body.choices && response.body.choices.length > 0) {
      console.log(`✅ choices 数组存在`);
      console.log(`✅ 第一个 choice 存在`);

      const choice = response.body.choices[0];
      if (choice.message && choice.message.content) {
        console.log(`✅ message.content 存在\n`);
        console.log(`【LLM 响应内容】`);
        console.log(`"${choice.message.content}"\n`);

        console.log(`【诊断结果】`);
        console.log(`✅ ✅ ✅ API 工作正常！✅ ✅ ✅\n`);
        console.log(`你的系统已准备好！\n`);
        console.log(`运行命令：\n`);
        console.log(`  node real-agent-runner.js --sonnet\n`);

      } else {
        console.log(`❌ message.content 不存在\n`);
        console.log(`完整响应:`);
        console.log(JSON.stringify(response.body, null, 2));
      }
    } else {
      console.log(`❌ choices 数组不存在或为空\n`);
      console.log(`完整响应:`);
      console.log(JSON.stringify(response.body, null, 2));
    }

  } catch (error) {
    console.log(`❌ 网络错误：${error.message}\n`);
    console.log(`【可能的原因】`);
    console.log(`  • 网络连接问题`);
    console.log(`  • API 地址错误`);
    console.log(`  • 防火墙/代理阻止`);
    console.log(`  • 请求超时\n`);

    if (error.code === 'ENOTFOUND') {
      console.log(`💡 无法解析 API 地址，请检查：\n`);
      console.log(`  • 互联网连接`);
      console.log(`  • ANTHROPIC_BASE_URL 配置`);
    } else if (error.code === 'ECONNREFUSED') {
      console.log(`💡 连接被拒绝，请检查：\n`);
      console.log(`  • API 服务器是否在线`);
      console.log(`  • 防火墙设置`);
    }

    process.exit(1);
  }
}

main().catch(err => {
  console.error(`\n❌ 未预期的错误：`, err.message);
  process.exit(1);
});

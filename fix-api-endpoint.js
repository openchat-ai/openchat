#!/usr/bin/env node

/**
 * API 端点修复工具
 * 自动尝试常见的 API 端点配置
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
            body: JSON.parse(body)
          });
        } catch {
          resolve({
            status: res.statusCode,
            body: null,
            rawBody: body
          });
        }
      });
    });
    req.on('error', (err) => {
      resolve({ status: -1, error: err.message });
    });
    if (data) req.write(JSON.stringify(data));
    req.setTimeout(10000);
    req.end();
  });
}

async function testEndpoint(baseUrl, apiKey, model) {
  try {
    const url = new URL(baseUrl + '/chat/completions');

    const response = await httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        protocol: url.protocol,
        timeout: 10000
      },
      {
        model: model,
        messages: [
          { role: 'system', content: '简短回复。' },
          { role: 'user', content: '你好' }
        ],
        temperature: 0.7,
        max_tokens: 50
      }
    );

    if (response.status === 200 && response.body && response.body.choices) {
      return { success: true, response };
    } else if (response.status === -1) {
      return { success: false, error: response.error };
    } else {
      return { success: false, status: response.status, body: response.body };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function main() {
  const ENV = loadEnv();

  if (!ENV.ANTHROPIC_AUTH_TOKEN || !ENV.ANTHROPIC_BASE_URL) {
    console.log(`❌ 配置不完整！\n`);
    process.exit(1);
  }

  const baseUrl = ENV.ANTHROPIC_BASE_URL;
  const apiKey = ENV.ANTHROPIC_AUTH_TOKEN;
  const model = ENV.ANTHROPIC_DEFAULT_SONNET_MODEL || '[按次]claude-sonnet-4-5';

  // 要尝试的端点列表
  const endpoints = [
    { name: '当前配置', url: baseUrl },
    { name: '加 /v1 后缀', url: baseUrl.replace(/\/$/, '') + '/v1' },
    { name: '加 /api/v1', url: baseUrl.replace(/\/$/, '') + '/api/v1' },
    { name: '加 /openai/v1', url: baseUrl.replace(/\/$/, '') + '/openai/v1' },
    { name: 'Anthropic 官方', url: 'https://api.anthropic.com/v1' }
  ];

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                  🔧 API 端点自动修复工具                                     ║
║                 尝试常见的 API 端点配置...                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝

【配置信息】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

API Key: ${apiKey.substring(0, 20)}...
模型: ${model}

【尝试不同的端点】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  let foundWorking = false;

  for (const endpoint of endpoints) {
    console.log(`\n测试: ${endpoint.name}`);
    console.log(`地址: ${endpoint.url}`);
    console.log(`...\n`);

    const result = await testEndpoint(endpoint.url, apiKey, model);

    if (result.success) {
      console.log(`✅ 成功！\n`);
      console.log(`这个端点有效！\n`);
      console.log(`【推荐的配置】`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      console.log(`将 .env 中的这一行：\n`);
      console.log(`  ANTHROPIC_BASE_URL=${baseUrl}\n`);
      console.log(`改为：\n`);
      console.log(`  ANTHROPIC_BASE_URL=${endpoint.url}\n`);
      console.log(`然后运行：\n`);
      console.log(`  node real-agent-runner.js --sonnet\n`);

      // 自动更新 .env
      if (endpoint.url !== baseUrl) {
        const envPath = path.join(__dirname, '.env');
        let envContent = fs.readFileSync(envPath, 'utf-8');
        envContent = envContent.replace(
          /ANTHROPIC_BASE_URL=.*/,
          `ANTHROPIC_BASE_URL=${endpoint.url}`
        );
        fs.writeFileSync(envPath, envContent);
        console.log(`✅ .env 已自动更新！\n`);
      }

      foundWorking = true;
      break;
    } else {
      if (result.error) {
        console.log(`❌ 失败: ${result.error}`);
      } else if (result.status) {
        console.log(`❌ HTTP ${result.status}: API 返回错误`);
      }
    }
  }

  if (!foundWorking) {
    console.log(`\n【所有端点都失败了】`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    console.log(`可能的原因：\n`);
    console.log(`1. API Key 已过期或无效\n`);
    console.log(`2. API 服务不可用\n`);
    console.log(`3. 网络连接有问题\n`);
    console.log(`建议：\n`);
    console.log(`1. 检查 API Key 是否正确`);
    console.log(`2. 确认互联网连接`);
    console.log(`3. 使用演示模式测试系统\n`);
    console.log(`  node real-agent-runner.js --simulate\n`);
  }
}

main().catch(err => {
  console.error(`错误: ${err.message}`);
  process.exit(1);
});

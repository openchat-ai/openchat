import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROVIDER_DOCS = {
  siliconflow: {
    name: '硅基流动',
    docsUrl: 'https://docs.siliconflow.cn/api-reference/endpoint/models',
    apiUrl: 'https://api.siliconflow.cn/v1/models'
  },
  deepseek: {
    name: 'DeepSeek',
    docsUrl: 'https://api.deepseek.com/api-docs',
    apiUrl: 'https://api.deepseek.com/v1/models'
  },
  groq: {
    name: 'Groq',
    docsUrl: 'https://console.groq.com/docs/models',
    apiUrl: 'https://api.groq.com/openai/v1/models'
  },
  openai: {
    name: 'OpenAI',
    docsUrl: 'https://platform.openai.com/docs/models',
    apiUrl: 'https://api.openai.com/v1/models'
  }
};

async function fetchModelsFromApi(name, apiUrl, apiKey) {
  try {
    const headers = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await axios.get(apiUrl, {
      headers,
      timeout: 10000
    });

    if (response.data && response.data.data) {
      const models = response.data.data
        .filter(m => m.id && !m.id.includes('deprecated'))
        .map(m => m.id)
        .slice(0, 20);

      return {
        success: true,
        provider: name,
        models,
        count: models.length
      };
    }

    return { success: false, provider: name, error: 'Invalid response format' };
  } catch (error) {
    return {
      success: false,
      provider: name,
      error: error.response?.status === 401 ? '需要API密钥' : error.message
    };
  }
}

async function fetchFromWeb(url) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return { success: true, data: response.data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function parseModelsFromHtml(html, providerName) {
  const models = [];
  const patterns = {
    siliconflow: /models\/([a-zA-Z0-9\-_/]+)/gi,
    deepseek: /"id"\s*:\s*"([^"]+)"/gi,
    groq: /model\s*=\s*["']([^"']+)["']/gi,
    openai: /\/models\/([a-zA-Z0-9\-_.]+)/gi
  };

  const pattern = patterns[providerName];
  if (pattern) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const modelId = match[1];
      if (!models.includes(modelId) && !modelId.includes('deprecated')) {
        models.push(modelId);
      }
    }
  }

  return [...new Set(models)].slice(0, 30);
}

async function upgradeProviders() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║            升级 Provider 配置                             ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  const results = [];
  const apiKey = process.env.SILICONFLOW_API_KEY ||
                 process.env.OPENAI_API_KEY ||
                 process.env.DEEPSEEK_API_KEY;

  for (const [key, info] of Object.entries(PROVIDER_DOCS)) {
    console.log(`[${info.name}] 正在获取模型列表...`);

    const apiResult = await fetchModelsFromApi(key, info.apiUrl, apiKey);
    if (apiResult.success && apiResult.models.length > 0) {
      console.log(`  ✓ API获取成功: ${apiResult.count} 个模型`);
      results.push(apiResult);
    } else {
      console.log(`  ○ 尝试从网页获取...`);
      const webResult = await fetchFromWeb(info.docsUrl);
      if (webResult.success) {
        const models = parseModelsFromHtml(webResult.data, key);
        if (models.length > 0) {
          console.log(`  ✓ 网页解析成功: ${models.length} 个模型`);
          results.push({ provider: key, models, source: 'web' });
        } else {
          console.log(`  ✗ 无法解析模型列表`);
          results.push({ provider: key, error: '无法解析', models: [] });
        }
      } else {
        console.log(`  ✗ 获取失败: ${apiResult.error || webResult.error}`);
        results.push({ provider: key, error: '获取失败', models: [] });
      }
    }
  }

  const newConfig = {};
  const defaultConfigs = {
    siliconflow: {
      name: '硅基流动',
      nameCn: '硅基流动',
      baseUrl: 'https://api.siliconflow.cn/v1',
      chatEndpoint: '/chat/completions',
      defaultModel: 'Qwen/Qwen2.5-72B-Instruct'
    },
    deepseek: {
      name: 'DeepSeek',
      nameCn: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      chatEndpoint: '/chat/completions',
      defaultModel: 'deepseek-chat'
    },
    groq: {
      name: 'Groq',
      nameCn: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      chatEndpoint: '/chat/completions',
      defaultModel: 'llama-3.1-70b-versatile'
    },
    openai: {
      name: 'OpenAI',
      nameCn: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      chatEndpoint: '/chat/completions',
      defaultModel: 'gpt-4o-mini'
    }
  };

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  更新 Provider 配置');
  console.log('═══════════════════════════════════════════════════════════');

  for (const result of results) {
    if (result.models && result.models.length > 0) {
      const defaultConfig = defaultConfigs[result.provider];
      newConfig[result.provider] = {
        ...defaultConfig,
        models: result.models,
        updatedAt: new Date().toISOString()
      };
      console.log(`✓ ${defaultConfig.nameCn}: ${result.models.length} 个模型`);
    }
  }

  const configPath = path.join(__dirname, '..', 'src', 'memory', 'provider-manager.js');
  let content = fs.readFileSync(configPath, 'utf8');

  const exportMatch = content.match(/export const PRESET_PROVIDERS = \{[\s\S]*?\};/);
  if (exportMatch) {
    const newExport = `export const PRESET_PROVIDERS = ${JSON.stringify(newConfig, null, 2)
      .replace(/"([^"]+)":/g, '$1:')
      .replace(/'/g, "'")
      .replace(/\n/g, '\n  ')};`;

    content = content.replace(/export const PRESET_PROVIDERS = \{[\s\S]*?\};/, newExport);
    fs.writeFileSync(configPath, content);
    console.log('');
    console.log('✓ provider-manager.js 已更新');
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  获取到的模型列表');
  console.log('═══════════════════════════════════════════════════════════');

  for (const result of results) {
    if (result.models && result.models.length > 0) {
      const providerInfo = PROVIDER_DOCS[result.provider];
      console.log(`\n【${providerInfo.name}】`);
      result.models.slice(0, 10).forEach(m => console.log(`  - ${m}`));
      if (result.models.length > 10) {
        console.log(`  ... 还有 ${result.models.length - 10} 个`);
      }
    }
  }

  console.log('');
  console.log('升级完成！使用 "列出模型" 查看所有可用模型。');
  console.log('');
}

upgradeProviders().catch(console.error);
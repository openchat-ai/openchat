import { getProviderConfig, getRuntimeApiKey, getRuntimeBaseUrl } from '../experiments/lib/llm-lib.mjs';

export class AiProvider {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.apiKey = null;
    this.endpoint = null;
    this.connected = false;
  }

  async connect(apiKey, endpoint = null) {
    this.apiKey = apiKey;
    this.endpoint = endpoint || this.guessEndpoint() || this.getDefaultEndpoint();
    // 不等待 verifyConnection（OpenRouter /models 可能很慢），后台执行
    this.verifyConnection().then(v => { this.connected = v; }).catch(() => { this.connected = true; });
    this.connected = true;
    return true;
  }

  guessEndpoint() {
    if (this.apiKey?.startsWith('sk-or-v1-')) return 'https://openrouter.ai/api/v1';
    return null;
  }

  async disconnect() {
    this.apiKey = null;
    this.connected = false;
  }

  /**
   * @param {string} model
   * @param {Array} messages
   * @param {Array} [tools]
   * @param {object} [opts]
   * @returns {Promise<{id:string, model:string, content:string, reasoningContent?:string, toolCalls?:Array, usage?:object, created?:number}>}
   */
  async chat(model, messages, tools, opts = {}) {
    throw new Error('chat() must be implemented by subclass');
  }

  async embed(text, model) {
    throw new Error('embed() not supported by this provider');
  }

  async verifyConnection() {
    throw new Error('verifyConnection() must be implemented by subclass');
  }

  getDefaultEndpoint() {
    throw new Error('getDefaultEndpoint() must be implemented by subclass');
  }

  getModels() {
    throw new Error('getModels() must be implemented by subclass');
  }
}

// 辅助函数：判断是否为 OpenAI 兼容的提供商
function isOpenAICompatibleProvider(type) {
  const lowerType = type.toLowerCase();

  // 包含 '-compatible' 后缀的类型
  if (lowerType.includes('-compatible')) {
    return true;
  }

  // 包含 'openai' 的类型（例如 'custom-openai-api', 'my-openai-service'）
  if (lowerType.includes('openai')) {
    return true;
  }

  // OpenRouter 直接兼容 OpenAI API
  if (lowerType === 'openrouter') return true;

  // 动态检查：从 provider-manager 获取 transport 配置
  // 如果 transport 是 'openai_chat'，则使用 OpenAI 兼容接口
  const config = getProviderConfig(type);
  if (config && config.transport === 'openai_chat') {
    return true;
  }

  return false;
}

export function createProvider(type) {
  switch (type) {
    case 'openai':
      return new OpenAiProvider('openai');
    case 'claude':
      return new ClaudeProvider();
    case 'gemini':
      return new GeminiProvider();
    case 'deepseek':
      return new DeepSeekProvider();
    case 'minimax':
    case 'minimax-coding-plan':
      return new MiniMaxCodingPlanProvider();
    case 'baidu-qianfan-coding-plan':
      return new BaiduQianfanCodingPlanProvider();
    default:
      if (isOpenAICompatibleProvider(type)) {
        return new OpenAiProvider(type);
      }
      throw new Error(`Unknown provider type: ${type}`);
  }
}

// 为 MiniMax Coding Plan 创建专门的 Provider 类
class MiniMaxCodingPlanProvider extends AiProvider {
  constructor() {
    super('minimax-coding-plan', 'MiniMax Coding Plan');
    // MiniMax Coding Plan 特定的模型列表
    this.models = ['abab6.5s-chat', 'abab6.5g-chat', 'abab6.5t-chat', 'MiniMax-M2.7'];
  }

  getDefaultEndpoint() {
    // MiniMax Coding Plan 的 API 端点 (OpenAI 兼容格式)
    return 'https://api.minimaxi.com/v1';
  }

  getModels() {
    return this.models;
  }

  async verifyConnection() {
    // MiniMax 使用 OpenAI 兼容 API，跳过验证直接返回成功
    // 实际连接会在 chat() 时验证
    return true;
  }

  async chat(model, messages) {
    // 优先使用运行时配置的 apiKey，否则使用传入的 apiKey
    const apiKey = this.apiKey || getRuntimeApiKey('minimax-coding-plan') || getRuntimeApiKey('minimax');

    // MiniMax Coding Plan 使用 OpenAI 兼容格式
    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || this.models[0],
        messages: messages,
        stream: false
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `MiniMax API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      id: data.id || crypto.randomUUID(),
      model: data.model || model,
      content: data.choices?.[0]?.message?.content || '',
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0
      },
      created: data.created || Date.now()
    };
  }
}

// 百度千帆 Coding Plan Provider
class BaiduQianfanCodingPlanProvider extends AiProvider {
  constructor() {
    super('baidu-qianfan-coding-plan', '百度千帆 Coding Plan');
    this.models = ['qianfan-code-latest', 'ernie-4.0-8k-latest', 'ernie-3.5-8k', 'deepseek-v3', 'glm-4'];
  }

  getDefaultEndpoint() {
    // 优先从运行时配置读取 baseURL
    const runtimeBaseUrl = getRuntimeBaseUrl('baiduqianfancodingplan') || getRuntimeBaseUrl('baidu-qianfan-coding-plan');
    return runtimeBaseUrl || 'https://qianfan.baidubce.com/v2/coding';
  }

  getModels() {
    return this.models;
  }

  async verifyConnection() {
    // 跳过验证，实际连接在 chat() 时验证
    return true;
  }

  async chat(model, messages) {
    // 优先使用运行时配置的 apiKey，否则使用传入的 apiKey
    const apiKey = this.apiKey || getRuntimeApiKey('baiduqianfancodingplan') || getRuntimeApiKey('baidu-qianfan-coding-plan');

    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'qianfan-code-latest',
        messages: messages,
        stream: false
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `百度千帆 API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      id: data.id || crypto.randomUUID(),
      model: data.model || model,
      content: data.choices?.[0]?.message?.content || '',
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0
      },
      created: data.created || Date.now()
    };
  }
}

class OpenAiProvider extends AiProvider {
  constructor(providerType = 'openai') {
    super(providerType, providerType);
    this.providerType = providerType;
    this.models = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
  }

  getDefaultEndpoint() {
    const config = getProviderConfig(this.providerType);
    if (config && config.baseUrl) {
      return config.baseUrl;
    }
    return 'https://api.openai.com/v1';
  }

  getModels() {
    return this.models;
  }

  async verifyConnection() {
    const apiKey = this.apiKey || getRuntimeApiKey('openai');
    try {
      const response = await fetch(`${this.endpoint}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) {
        // 连接失败但 API key 存在，跳过验证（可能是 endpoint 不支持 /models）
        console.debug(`[Provider] ${this.name} verifyConnection 返回 ${response.status}，跳过验证`);
        return true;
      }
      return true;
    } catch (e) {
      // 网络错误也跳过验证
      console.debug(`[Provider] ${this.name} verifyConnection 异常: ${e.message}，跳过验证`);
      return true;
    }
  }

  supportsTools() {
    return true;
  }

  async chat(model, messages, tools, opts = {}) {
    const apiKey = this.apiKey || getRuntimeApiKey('openai');
    const body = { model, messages, stream: false };
    if (tools && this.supportsTools()) body.tools = tools;
    const timeout = opts.timeout || 60000;
    const makeReq = fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
    }).catch(() => {}); // 忽略后台超时的 fetch
    const response = await Promise.race([
      (async () => {
        const res = await makeReq;
        if (!res) throw new Error('LLM fetch failed');
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `OpenAI API error: ${res.status}`);
        }
        return res;
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`LLM_TIMEOUT: ${timeout / 1000}s`)), timeout)),
    ]);

    const data = await response.json();
    const msg = data.choices[0]?.message || {};
    return {
      id: data.id,
      model: data.model,
      content: msg.content || '',
      reasoningContent: msg.reasoning_content || '',
      toolCalls: msg.tool_calls || [],
      usage: data.usage,
      created: data.created,
    };
  }

  async embed(input, model) {
    const apiKey = this.apiKey || getRuntimeApiKey('openai');
    const embedModel = model || 'text-embedding-3-small';
    const isBatch = Array.isArray(input);
    const response = await fetch(`${this.endpoint}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: embedModel,
        input: isBatch ? input : input
      })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Embedding API error: ${response.status}`);
    }
    const data = await response.json();
    if (isBatch) {
      return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
    }
    return data.data[0].embedding;
  }
}

class ClaudeProvider extends AiProvider {
  constructor() {
    super('claude', 'Claude');
    // 模型列表完全从配置文件读取
    this.models = [];
  }

  setModels(models) {
    this.models = models;
  }

  getDefaultEndpoint() {
    return 'https://api.anthropic.com/v1';
  }

  getModels() {
    return this.models;
  }

  async verifyConnection() {
    const apiKey = this.apiKey || getRuntimeApiKey('anthropic') || getRuntimeApiKey('claude');
    const response = await fetch(`${this.endpoint}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.models[0],
        max_tokens: 1
      })
    });
    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }
    return true;
  }

  async chat(model, messages) {
    const apiKey = this.apiKey || getRuntimeApiKey('anthropic') || getRuntimeApiKey('claude');
    const systemPrompt = messages.find(m => m.role === 'system');
    const filteredMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch(`${this.endpoint}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        system: systemPrompt?.content,
        messages: filteredMessages,
        max_tokens: 4096
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Claude API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      id: data.id,
      model: data.model,
      content: data.content[0]?.text || '',
      usage: {
        input_tokens: data.usage?.input_tokens,
        output_tokens: data.usage?.output_tokens
      },
      created: Date.now()
    };
  }
}

class GeminiProvider extends AiProvider {
  constructor() {
    super('gemini', 'Gemini');
    this.models = ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'];
  }

  getDefaultEndpoint() {
    return 'https://generativelanguage.googleapis.com/v1beta';
  }

  getModels() {
    return this.models;
  }

  async verifyConnection() {
    const apiKey = this.apiKey || getRuntimeApiKey('gemini');
    const model = this.models[0];
    const response = await fetch(`${this.endpoint}/models/${model}?key=${apiKey}`);
    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }
    return true;
  }

  async chat(model, messages) {
    const apiKey = this.apiKey || getRuntimeApiKey('gemini');
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    const systemInstruction = messages.find(m => m.role === 'system');

    const response = await fetch(`${this.endpoint}/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents,
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction.content }] } : undefined,
        generationConfig: {
          temperature: 0.9,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      id: crypto.randomUUID(),
      model: data.modelVersion || model,
      content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      usage: data.usageMetadata,
      created: Date.now()
    };
  }
}

class DeepSeekProvider extends AiProvider {
  constructor() {
    super('deepseek', 'DeepSeek');
    this.models = ['deepseek-chat', 'deepseek-coder'];
  }

  getDefaultEndpoint() {
    return 'https://api.deepseek.com/v1';
  }

  getModels() {
    return this.models;
  }

  async verifyConnection() {
    const apiKey = this.apiKey || getRuntimeApiKey('deepseek');
    const response = await fetch(`${this.endpoint}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }
    return true;
  }

  async chat(model, messages) {
    const apiKey = this.apiKey || getRuntimeApiKey('deepseek');
    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        stream: false
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    const msg = data.choices[0]?.message || {};
    let content = msg.content || '';
    const reasoningContent = msg.reasoning_content || '';
    // reasoningContent 已从 API 提取，从 content 中移除内嵌的标签
    if (reasoningContent && content.includes('<think>')) {
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }
    return {
      id: data.id,
      model: data.model,
      content,
      reasoningContent,
      usage: data.usage,
      created: data.created
    };
  }
}

// 导出辅助函数和类
export { isOpenAICompatibleProvider, OpenAiProvider };
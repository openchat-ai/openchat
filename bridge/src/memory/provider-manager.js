export const PRESET_PROVIDERS = {
    siliconflow: {
      name: "硅基流动",
      nameCn: "硅基流动",
      baseUrl: "https://api.siliconflow.cn/v1",
      chatEndpoint: "/chat/completions",
      defaultModel: "Qwen/Qwen2.5-72B-Instruct",
      models: [
        "Pro/zai-org/GLM-5.1",
        "Pro/MiniMaxAI/MiniMax-M2.5",
        "Pro/zai-org/GLM-5",
        "Pro/moonshotai/Kimi-K2.5",
        "Pro/zai-org/GLM-4.7",
        "deepseek-ai/DeepSeek-V3.2",
        "Pro/deepseek-ai/DeepSeek-V3.2",
        "deepseek-ai/DeepSeek-V3.1-Terminus",
        "Pro/deepseek-ai/DeepSeek-V3.1-Terminus",
        "Qwen/Qwen3.5-397B-A17B",
        "Qwen/Qwen3.5-122B-A10B",
        "Qwen/Qwen3.5-35B-A3B",
        "Qwen/Qwen3.5-27B",
        "Qwen/Qwen3.5-9B",
        "Qwen/Qwen3.5-4B",
        "PaddlePaddle/PaddleOCR-VL-1.5",
        "deepseek-ai/DeepSeek-R1",
        "Pro/deepseek-ai/DeepSeek-R1",
        "deepseek-ai/DeepSeek-V3",
        "Pro/deepseek-ai/DeepSeek-V3"
      ],
      updatedAt: "2026-04-13T02:01:44.484Z"
    }
  };

export const DEFAULT_PROVIDER = 'siliconflow';

export class ProviderManager {
  constructor() {
    this.customProviders = new Map();
  }

  getProviderConfig(name) {
    if (PRESET_PROVIDERS[name]) {
      return PRESET_PROVIDERS[name];
    }
    if (this.customProviders.has(name)) {
      return this.customProviders.get(name);
    }
    return null;
  }

  listProviders() {
    const result = [];

    for (const [name, config] of Object.entries(PRESET_PROVIDERS)) {
      result.push({
        name,
        nameCn: config.nameCn,
        baseUrl: config.baseUrl,
        defaultModel: config.defaultModel,
        models: config.models,
        isCustom: false
      });
    }

    for (const [name, config] of this.customProviders) {
      result.push({
        name,
        nameCn: config.nameCn || name,
        baseUrl: config.baseUrl,
        defaultModel: config.defaultModel || config.models?.[0] || 'default',
        models: config.models || ['default'],
        isCustom: true
      });
    }

    return result;
  }

  listModels(providerName) {
    const config = this.getProviderConfig(providerName);
    if (!config) {
      return [];
    }
    return config.models || [config.defaultModel];
  }

  addCustomProvider(name, baseUrl, apiKey, model = null) {
    this.customProviders.set(name, {
      nameCn: name,
      baseUrl,
      chatEndpoint: '/chat/completions',
      defaultModel: model,
      models: model ? [model] : [],
      apiKey
    });
  }

  getDefaultModel(providerName) {
    const config = this.getProviderConfig(providerName);
    if (!config) return 'default';
    return config.defaultModel;
  }

  getBaseUrl(providerName) {
    const config = this.getProviderConfig(providerName);
    if (!config) return null;
    return config.baseUrl;
  }
}

export const providerManager = new ProviderManager();
export default providerManager;
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
    this.endpoint = endpoint || this.getDefaultEndpoint();
    await this.verifyConnection();
    this.connected = true;
    return true;
  }

  async disconnect() {
    this.apiKey = null;
    this.connected = false;
  }

  async chat(model, messages) {
    throw new Error('chat() must be implemented by subclass');
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

export function createProvider(type) {
  switch (type) {
    case 'openai':
      return new OpenAiProvider();
    case 'claude':
      return new ClaudeProvider();
    case 'gemini':
      return new GeminiProvider();
    case 'deepseek':
      return new DeepSeekProvider();
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

class OpenAiProvider extends AiProvider {
  constructor() {
    super('openai', 'OpenAI');
    this.models = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
  }

  getDefaultEndpoint() {
    return 'https://api.openai.com/v1';
  }

  getModels() {
    return this.models;
  }

  async verifyConnection() {
    const response = await fetch(`${this.endpoint}/models`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    return true;
  }

  async chat(model, messages) {
    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
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
      throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      id: data.id,
      model: data.model,
      content: data.choices[0]?.message?.content || '',
      usage: data.usage,
      created: data.created
    };
  }
}

class ClaudeProvider extends AiProvider {
  constructor() {
    super('claude', 'Claude');
    this.models = ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'];
  }

  getDefaultEndpoint() {
    return 'https://api.anthropic.com/v1';
  }

  getModels() {
    return this.models;
  }

  async verifyConnection() {
    const response = await fetch(`${this.endpoint}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
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
    const systemPrompt = messages.find(m => m.role === 'system');
    const filteredMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch(`${this.endpoint}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
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
    const model = this.models[0];
    const response = await fetch(`${this.endpoint}/models/${model}?key=${this.apiKey}`);
    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }
    return true;
  }

  async chat(model, messages) {
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    const systemInstruction = messages.find(m => m.role === 'system');

    const response = await fetch(`${this.endpoint}/models/${model}:generateContent?key=${this.apiKey}`, {
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
    const response = await fetch(`${this.endpoint}/models`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }
    return true;
  }

  async chat(model, messages) {
    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
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
    return {
      id: data.id,
      model: data.model,
      content: data.choices[0]?.message?.content || '',
      usage: data.usage,
      created: data.created
    };
  }
}
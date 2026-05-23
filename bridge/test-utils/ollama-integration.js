import axios from 'axios';
import { config } from 'dotenv';

// 显式加载环境变量
config({ path: './.env' });

class OllamaIntegration {
  constructor() {
    this.apiBase = process.env.OLLAMA_API_BASE || 'https://api.ollama.cloud';
    this.apiKey = process.env.OLLAMA_API_KEY;
    this.model = process.env.OLLAMA_MODEL || 'deepseek-v3.1:671b';
  }

  async callLLM(prompt, systemPrompt = null) {
    if (!this.apiKey) {
      console.warn('⚠️  Ollama Cloud API密钥未设置，使用模拟响应');
      return this.generateMockResponse(prompt);
    }

    try {
      const response = await axios.post(
        `${this.apiBase}/chat/completions`,
        {
          model: this.model,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: 2000,
          response_format: { type: 'json_object' }
        },
        {
          timeout: 60000, 
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return JSON.parse(response.data.choices[0].message.content);
      
    } catch (error) {
      console.error('❌ Ollama Cloud调用失败:', error.message);
      return this.generateMockResponse(prompt);
    }
  }

  extractJSONFromText(text) {
    // 尝试从文本中提取JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // 如果提取失败，返回默认响应
      }
    }
    
    return this.generateMockResponse(text);
  }

  generateMockResponse(prompt) {
    // 智能模拟响应
    return {
      score: 4,
      feedback: 'Ollama连接失败，使用模拟评估',
      breakdown: {
        tool_selection_accuracy: 4,
        parameter_correctness: 4,
        logical_reasoning: 4,
        error_handling: 3,
        efficiency: 4
      },
      suggestions: ['检查Ollama服务状态', '确认模型已下载']
    };
  }

  async checkOllamaStatus() {
    if (!this.apiKey) {
      return {
        running: false,
        modelAvailable: false,
        error: 'API密钥未设置'
      };
    }

    try {
      const response = await axios.get(`${this.apiBase}/v1/models`, {
        timeout: 5000,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      const models = response.data.data || [];
      const hasModel = models.some(m => m.id === this.model);
      
      return {
        running: true,
        modelAvailable: hasModel,
        models: models.map(m => m.id)
      };
      
    } catch (error) {
      return {
        running: false,
        modelAvailable: false,
        error: error.message
      };
    }
  }
}

// 导出单例
const ollamaIntegration = new OllamaIntegration();
export default ollamaIntegration;
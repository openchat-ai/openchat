import axios from 'axios';
import { config } from 'dotenv';

config({ path: './.env' });

class DeepSeekIntegration {
  constructor() {
    this.apiBase = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
    this.apiKey = process.env.DEEPSEEK_API_KEY;
    this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  }

  async checkDeepSeekStatus() {
    if (!this.apiKey) {
      return {
        running: false,
        modelAvailable: false,
        error: 'API密钥未设置'
      };
    }

    try {
      const response = await axios.get(
        `${this.apiBase}/v1/models`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout: 5000
        }
      );
      
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

  async callLLM(prompt, systemPrompt = null) {
    if (!this.apiKey) {
      console.warn('⚠️  DeepSeek API密钥未设置');
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
          timeout: 30000,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0].message.content;
      
      try {
        return JSON.parse(content);
      } catch {
        return this.generateMockResponse(prompt);
      }
      
    } catch (error) {
      console.error('❌ DeepSeek API调用失败:', error.message);
      if (error.response?.status === 401) {
        console.log('💡 请检查 DeepSeek API密钥是否正确');
      }
      return this.generateMockResponse(prompt);
    }
  }

  generateMockResponse(prompt) {
    return {
      score: 4,
      feedback: 'DeepSeek API调用失败，使用模拟评估',
      breakdown: {
        tool_selection_accuracy: 4,
        parameter_correctness: 4,
        logical_reasoning: 4,
        error_handling: 3,
        efficiency: 4
      },
      suggestions: ['检查DeepSeek API连接']
    };
  }
}

const deepseekIntegration = new DeepSeekIntegration();
export default deepseekIntegration;
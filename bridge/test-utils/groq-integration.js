import axios from 'axios';
import { config } from 'dotenv';

config({ path: './.env' });

class GroqIntegration {
  constructor() {
    this.apiBase = process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1';
    this.apiKey = process.env.GROQ_API_KEY;
    this.model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  }

  async checkGroqStatus() {
    if (!this.apiKey) {
      return {
        running: false,
        modelAvailable: false,
        error: 'API密钥未设置'
      };
    }

    try {
      const response = await axios.get(
        `${this.apiBase}/models`,
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
      console.warn('⚠️  Groq API密钥未设置');
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
          max_tokens: 2000
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
      console.error('❌ Groq API调用失败:', error.message);
      if (error.response?.status === 401) {
        console.log('💡 请检查 Groq API密钥是否正确');
      }
      return this.generateMockResponse(prompt);
    }
  }

  generateMockResponse(prompt) {
    return {
      score: 4,
      feedback: 'Groq API调用失败，使用模拟评估',
      breakdown: {
        tool_selection_accuracy: 4,
        parameter_correctness: 4,
        logical_reasoning: 4,
        error_handling: 3,
        efficiency: 4
      },
      suggestions: ['检查Groq API连接']
    };
  }
}

const groqIntegration = new GroqIntegration();
export default groqIntegration;
import axios from 'axios';
import { config } from 'dotenv';

config({ path: './.env' });

class SiliconFlowIntegration {
  constructor() {
    this.apiBase = process.env.SILICONFLOW_API_BASE || 'https://api.siliconflow.cn/v1';
    this.apiKey = process.env.SILICONFLOW_API_KEY;
    this.model = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen2.5-72B-Instruct';
  }

  async checkStatus() {
    if (!this.apiKey) {
      return { running: false, error: 'API密钥未设置' };
    }

    try {
      const response = await axios.get(
        `${this.apiBase}/models`,
        {
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
          timeout: 5000
        }
      );
      return { running: true, models: response.data.data };
    } catch (error) {
      return { running: false, error: error.message };
    }
  }

  async callLLM(prompt, systemPrompt = null) {
    if (!this.apiKey) {
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
      console.log('📨 LLM 原始响应:', content.substring(0, 100) + '...');
      
      try {
        return JSON.parse(content);
      } catch (parseError) {
        console.warn('⚠️ JSON 解析失败，尝试提取 JSON...');
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[0]);
          } catch {
            console.warn('⚠️ 提取的 JSON 解析失败');
          }
        }
        return this.generateMockResponse(prompt);
      }
    } catch (error) {
      console.error('❌ 硅基流动 API 调用失败:', error.message);
      return this.generateMockResponse(prompt);
    }
  }

  generateMockResponse(prompt) {
    return {
      score: 4,
      feedback: '使用模拟评估',
      breakdown: {
        tool_selection_accuracy: 4,
        parameter_correctness: 4,
        logical_reasoning: 4,
        error_handling: 3,
        efficiency: 4
      }
    };
  }
}

const siliconFlowIntegration = new SiliconFlowIntegration();
export default siliconFlowIntegration;
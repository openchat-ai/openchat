import axios from 'axios';
import 'dotenv/config';

const apiKey = process.env.SILICONFLOW_API_KEY;
const model = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

async function test() {
  console.log('测试硅基流动 API...');
  console.log('模型:', model);
  
  try {
    const response = await axios.post(
      'https://api.siliconflow.cn/v1/chat/completions',
      {
        model: model,
        messages: [
          { role: 'system', content: '你是一个JSON生成器，只输出JSON' },
          { role: 'user', content: '返回 {"score": 5, "feedback": "测试成功"}' }
        ],
        temperature: 0.1,
        max_tokens: 2000
      },
      {
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    console.log('✅ 状态码:', response.status);
    console.log('响应结构:', Object.keys(response.data));
    console.log('Content:', response.data.choices[0].message.content);
    
  } catch (error) {
    console.log('❌ 错误:', error.message);
    if (error.response) {
      console.log('状态:', error.response.status);
      console.log('数据:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

test();
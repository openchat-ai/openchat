// Research by 小刚: 研究流式处理在 LLM 长文本生成中的应用
// Generated: 2026-05-13T04:20:14.254Z

// 引入必要的库
const axios = require('axios');
const readline = require('readline');

// 创建一个流式处理的接口
const stream = async (url, options = {}) => {
  const { responseType = 'stream', headers = {} } = options;
  const response = await axios({
    url,
    responseType,
    headers,
  });

  if (responseType === 'stream') {
    return response.data;
  } else {
    return response.data;
  }
};

// 流式处理 LLM 长文本生成
const processLLMStream = async (streamData) => {
  let result = '';
  for await (const chunk of streamData) {
    result += chunk;
    console.log(`处理中: ${result.slice(-50)}`); // 输出最近50个字符，防止输出过多
  }
  console.log(`处理完成: ${result}`);
  return result;
};

// 生成文本的 URL（这里用的是一个示例，实际使用时需要替换为真实的生成文本的接口）
const generateTextUrl = 'https://example.com/generate-text';

// 流式处理并输出结果
stream(generateTextUrl, { responseType: 'stream' })
  .then((streamData) => {
    processLLMStream(streamData)
      .then((result) => {
        console.log('最终结果:', result);
      })
      .catch((error) => {
        console.error('处理错误:', error);
      });
  })
  .catch((error) => {
    console.error('请求错误:', error);
  });
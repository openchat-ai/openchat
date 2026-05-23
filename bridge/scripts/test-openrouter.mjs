/**
 * Quick test of openrouter API
 */
const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer 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',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'openrouter/free',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 10
  })
});

const data = await resp.json();
console.log('Status:', resp.status);
console.log('Response:', JSON.stringify(data, null, 2).slice(0, 500));
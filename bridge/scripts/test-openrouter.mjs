/**
 * Quick test of openrouter API
 * Usage: OPENROUTER_API_KEY=sk-or-v1-xxx node test-openrouter.mjs
 */
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('Set OPENROUTER_API_KEY env var'); process.exit(1); }
const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
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
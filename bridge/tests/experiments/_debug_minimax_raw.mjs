// Direct MiniMax API call to see raw error
import { readFileSync } from 'fs';
import { homedir } from 'os';
const apiKey = JSON.parse(readFileSync(homedir() + '/.config/openchat/config.json', 'utf8')).providers?.minimax?.apiKey;

console.log('API Key:', apiKey ? apiKey.slice(0, 8) + '...' : 'NOT FOUND');

if (!apiKey) {
  console.log('No MiniMax API key found');
  process.exit(1);
}

// MiniMax API endpoint
const url = 'https://api.minimax.chat/v1/text/chatcompletion_pro?GroupId=default';

const body = {
  model: 'MiniMax-M3',
  messages: [
    { role: 'system', content: 'Say hello briefly' },
    { role: 'user', content: 'hi' },
  ],
  tools: [
    { type: 'function', function: { name: 'get_cwd', description: 'Get current directory', parameters: { type: 'object', properties: {} } } }
  ],
  tokens_to_generate: 100,
  temperature: 0.1,
};

console.log('POST', url);
const resp = await fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

console.log('Status:', resp.status, resp.statusText);
console.log('Headers:', JSON.stringify(Object.fromEntries(resp.headers), null, 2));

const text = await resp.text();
console.log('Body:', text.slice(0, 2000));

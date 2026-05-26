import { Router } from 'express';
import https from 'https';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { qiniuSignaling } from '../../core/qiniu-signaling.js';

const router = Router();

router.post('/upload', async (req, res, next) => {
  try {
    const { path, content } = req.body;
    if (!path || content === undefined || content === null) {
      return res.status(400).json({ error: 'path and content required' });
    }
    const bucket = process.env.QINIU_BUCKET || 'dapin-xp';
    const payload = typeof content === 'string' ? content : JSON.stringify(content);
    await qiniuSignaling.writeTo(bucket, path, payload);
    res.json({ ok: true, path });
  } catch (e) {
    next(e);
  }
});

router.post('/generate', async (req, res, next) => {
  try {
    const { prompt, path } = req.body;
    if (!prompt || !path) {
      return res.status(400).json({ error: 'prompt and path required' });
    }

    // Load API key from config
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const configPath = join(__dirname, '..', '..', '..', '..', 'config.json');
    let apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey && existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      apiKey = cfg.providers?.openrouter?.apiKey;
    }
    if (!apiKey) return res.status(500).json({ error: 'No API key configured' });

    // Fetch current config as context
    let currentConfig = '';
    try {
      const bucket = process.env.QINIU_BUCKET || 'dapin-xp';
      const raw = await qiniuSignaling.readFrom({ name: bucket, domain: process.env.QINIU_DOMAIN || 'https://dapin-xp.s3.cn-east-1.qiniucs.com' }, path);
      currentConfig = raw.toString();
    } catch (_) {}

    const schema = JSON.stringify({
      types: {
        column: { children: 'array', center: 'bool', flex: 'num' },
        row: { children: 'array', center: 'bool', flex: 'num' },
        list: { children: 'array' },
        text: { content: 'string', style: { color: 'hex', size: 'num', bold: 'bool' }, pad: 'num', center: 'bool' },
        button: { content: 'string', action: 'string', pad: 'num' },
        icon: { icon: 'name', color: 'hex', size: 'num' },
        spacer: {},
        list_tile: { leadingIcon: 'name', title: 'string', subtitle: 'string', trailingIcon: 'name', trailingAction: 'string', action: 'string' },
        padding: { padding: 'num|{l,t,r,b}', child: 'node' },
        divider: {},
        image: { url: 'string', width: 'num', height: 'num', fit: 'cover|contain|fill' },
        card: { child: 'node', elevation: 'num', padding: 'num', margin: 'num' },
        sdui_fragment: { path: 'string' },
        auto: { delay: 'num', action: 'string' },
        checkbox: { label: 'string', checked: 'bool', action: 'string' },
        switch: { label: 'string', active: 'bool', action: 'string' },
        textfield: { hint: 'string', value: 'string', action: 'string', pad: 'num' },
      },
      iconNames: ['person','person_outline','call','phone','refresh','settings','home','search','add','close','delete','edit','check','arrow_back','arrow_forward','more_vert','info','warning','error','smart_toy','cloud_off','mic','stop','play_arrow','pause','send','favorite','share','menu'],
      actions: ['refresh','demo','navigate:/route','snackbar:text','dialog:title|body','tel:number','mailto:addr','call:peerId','http(s)://url'],
      conditionSyntax: 'use "if":"varName>0" on any node',
      templateSyntax: 'use {{varName}} in content fields',
    });

    const systemPrompt = `You are an SDUI config generator. Output ONLY valid JSON (no markdown, no explanations).
Current schema: ${schema}
${currentConfig ? `Current config:\n${currentConfig}\n` : ''}
The output must be a valid JSON object that passes validation (max 8 depth, 50 children, 500 char per field).`;

    const body = JSON.stringify({
      model: 'openrouter/auto',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
    });

    const result = await _callOpenRouter(apiKey, body);
    const raw = result.choices?.[0]?.message?.content;
    if (!raw) return res.status(500).json({ error: 'AI returned empty response' });

    // Parse and validate
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) {
      // Try extracting JSON from markdown
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) try { parsed = JSON.parse(m[1]); } catch (_) {}
    }
    if (!parsed || typeof parsed !== 'object') {
      return res.status(400).json({ error: 'AI output is not valid JSON', raw });
    }

    // Write to Qiniu
    const bucket = process.env.QINIU_BUCKET || 'dapin-xp';
    const payload = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
    await qiniuSignaling.writeTo(bucket, path, payload);

    res.json({ ok: true, path, preview: parsed });
  } catch (e) {
    next(e);
  }
});

function _callOpenRouter(apiKey, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body);
    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'HTTP-Referer': 'https://github.com/openchat-ai/openchat',
        'X-Title': 'OpenChat SDUI',
      },
    };
    const req = https.request(options, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(new Error('Failed to parse API response')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

export default router;

router.get('/storage-config', (req, res) => {
  res.json({
    accessKey: process.env.QINIU_ACCESS_KEY || '',
    secretKey: process.env.QINIU_SECRET_KEY || '',
    bucket: process.env.QINIU_BUCKET || 'dapin-xp',
    endpoint: process.env.QINIU_DOMAIN
      ? process.env.QINIU_DOMAIN.replace('https://', '')
      : 'dapin-xp.s3.cn-east-1.qiniucs.com',
    region: process.env.QINIU_REGION || 'cn-east-1',
  });
});

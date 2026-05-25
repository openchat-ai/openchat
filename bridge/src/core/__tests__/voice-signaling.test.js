import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('voice signaling', () => {
  test('Bridge voice routes exist', async () => {
    const { default: router } = await import('../../api/routes/voice.js');
    assert.ok(router);

    const serverFile = readFileSync(join(__dirname, '..', '..', 'api', 'server.js'), 'utf8');
    assert.ok(serverFile.includes("voiceRouter"), 'server.js should import voiceRouter');
    assert.ok(serverFile.includes("/api/v1/voice"), 'server.js should mount /api/v1/voice');
  });
});

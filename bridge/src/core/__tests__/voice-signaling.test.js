import { test, describe } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('voice signaling', () => {
  test('voice router module loads', async () => {
    const mod = await import('../../api/routes/voice.js');
    assert.ok(mod.default);
  });

  test('Bridge voice routes exist', async () => {
    // Verify the voice router has expected routes by importing and checking
    const { default: router } = await import('../../api/routes/voice.js');
    assert.ok(router);

    // Verify the voice API is mounted in server.js
    const serverFile = readFileSync(join(__dirname, '..', '..', 'api', 'server.js'), 'utf8');
    assert.ok(serverFile.includes("voiceRouter"), 'server.js should import voiceRouter');
    assert.ok(serverFile.includes("/api/v1/voice"), 'server.js should mount /api/v1/voice');
  });

  test('Flutter voice client exists and uses WebRTC', () => {
    const clientPath = join(__dirname, '..', '..', '..', '..', 'openchat-flutter', 'lib', 'core', 'api', 'voice_client.dart');
    assert.ok(existsSync(clientPath), 'voice_client.dart should exist');
    const content = readFileSync(clientPath, 'utf8');
    assert.ok(content.includes('RTCPeerConnection'), 'should use RTCPeerConnection');
    assert.ok(content.includes('createOffer'), 'should create offers');
    assert.ok(content.includes('getUserMedia'), 'should capture media');
    assert.ok(content.includes('onIceCandidate'), 'should handle ICE');
  });
});

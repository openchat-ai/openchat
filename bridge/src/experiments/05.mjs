// Experiment 4: lmdn-codec (48kHz, EPC headers)
//
// Current state: lmdn-codec.mjs 与 Flutter 端 lmdn_codec.dart 对齐：
// - SR=48000, N=96, 20 阶 LPC, 16 带固定位分配
// - .enc 头: BB 01 CC
// - .msg 头: BB 00 DD
//
// I/O (compose 契约): { pcm?, encoded?, op: 'encode'|'decode' } → { outputs: { pcm|encoded } }

import { create } from './lib/report.mjs';

export const META = { id: 'codec' };

const NAME = 'LMdn Codec — 48kHz 音频编解码';

let _codecPromise = null;
async function _getCodec() {
  if (_codecPromise) return _codecPromise;
  _codecPromise = (async () => {
    const mod = await import('../../src/core/audio/lmdn-codec.mjs');
    const LmdnCodec = mod.default || mod.LmdnCodec;
    const c = new LmdnCodec();
    await c.initialize();
    return c;
  })();
  return _codecPromise;
}

export async function run({ inputs = {} } = {}) {
  const { pcm, encoded, op = 'encode' } = inputs;
  const codec = await _getCodec();
  if (op === 'encode') {
    if (!Buffer.isBuffer(pcm)) throw new Error('pcm (Buffer) required for encode');
    const r = await codec.encode(pcm);
    return { outputs: { encoded: r?.data || r } };
  }
  if (op === 'decode') {
    if (!Buffer.isBuffer(encoded)) throw new Error('encoded (Buffer) required for decode');
    const r = await codec.decode(encoded);
    // r.pcm 可能是 int16 数组，归一为 Buffer (little-endian)
    const raw = r?.pcm || r?.data || r;
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    return { outputs: { pcm: buf } };
  }
  throw new Error(`unknown op: ${op} (expected encode|decode)`);
}

async function test() {
  const { ok, ng, skip, report } = create();
  let LmdnCodec;
  try {
    const mod = await import('../../src/core/audio/lmdn-codec.mjs');
    LmdnCodec = mod.default || mod.LmdnCodec;
    ok('LmdnCodec 类可加载');
  } catch (e) {
    ng('LmdnCodec 加载失败', e);
    return report(NAME);
  }

  // API surface
  for (const m of ['initialize', 'encode', 'decode']) {
    if (typeof LmdnCodec.prototype?.[m] === 'function') ok(`${m}() 存在`);
    else ng(`${m}() 缺失`);
  }

  let codec;
  try {
    codec = new LmdnCodec();
    await codec.initialize();
    ok('LmdnCodec 实例化 + initialize() 成功');
  } catch (e) {
    ng('LmdnCodec 初始化失败', e);
    return report(NAME);
  }

  // 48kHz 校验: 至少 1 帧 (192 samples int16 = 384 bytes)
  const FRAME = 192;
  const pcm = Buffer.alloc(FRAME * 2);
  let encoded;
  try {
    const r = await codec.encode(pcm);
    encoded = r?.data || r;
    if (encoded && encoded.length > 0) ok(`encode(${FRAME} samples) -> ${encoded.length} bytes`);
    else ng('encode 返回空结果');
  } catch (e) {
    ng('encode 失败', e);
  }

  // EPC 头校验: BB 01 CC for .enc
  if (encoded && encoded.length >= 3) {
    const [b1, b2, b3] = encoded;
    if (b1 === 0xBB && b2 === 0x01 && b3 === 0xCC) ok('EPC 头 BB 01 CC 正确');
    else ng(`EPC 头错误: ${b1.toString(16)} ${b2.toString(16)} ${b3.toString(16)}`);
  }

  // decode roundtrip
  if (encoded && encoded.length > 0) {
    try {
      const r = await codec.decode(encoded);
      const pcmOut = r?.pcm || r?.data || r;
      if (pcmOut && pcmOut.length > 0) ok(`decode roundtrip -> ${pcmOut.length} bytes`);
      else ng('decode 返回空结果');
    } catch (e) {
      ng('decode 失败', e);
    }
  }

  // run() 契约: encode + decode
  try {
    const enc = await run({ inputs: { pcm, op: 'encode' } });
    if (Buffer.isBuffer(enc.outputs.encoded) && enc.outputs.encoded.length > 0) {
      ok(`run(encode) → ${enc.outputs.encoded.length} bytes`);
      const dec = await run({ inputs: { encoded: enc.outputs.encoded, op: 'decode' } });
      if (Buffer.isBuffer(dec.outputs.pcm) && dec.outputs.pcm.length > 0) {
        ok(`run(decode) roundtrip → ${dec.outputs.pcm.length} bytes`);
      } else ng(`run(decode) 输出异常: ${dec.outputs.pcm?.length}`);
    } else ng('run(encode) 输出非 Buffer');
  } catch (e) {
    ng('run() 调用失败', e);
  }

  // 源码常量: SR=48000, N=96
  try {
    const fs = await import('fs/promises');
    const src = await fs.readFile('src/core/audio/lmdn-codec.mjs', 'utf8');
    if (/SR\s*=\s*48000|48000/.test(src)) ok('源码含 48000 (SR)');
    else ng('源码未见 48000');
    if (/N\s*=\s*96/.test(src)) ok('源码含 N=96');
    else ng('源码未见 N=96');
  } catch (e) {
    skip('源码常量检查跳过');
  }

  report(NAME);
}

export { test };

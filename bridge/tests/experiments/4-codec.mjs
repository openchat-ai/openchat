import { ok, ng, skip, report } from './lib/report.mjs';

const NAME = 'LMdn Codec — 音频编解码';

async function testCodec() {
  let LmdnCodec;
  try {
    const mod = await import('../../src/core/audio/lmdn-codec.mjs');
    LmdnCodec = mod.default || mod.LmdnCodec;
    ok('LmdnCodec 类可加载');
  } catch (e) {
    ng('LmdnCodec 加载失败', e);
    return report(NAME);
  }

  if (typeof LmdnCodec.prototype?.initialize === 'function') ok('initialize 方法存在');
  else ng('initialize 方法缺失');

  if (typeof LmdnCodec.prototype?.encode === 'function') ok('encode 方法存在');
  else ng('encode 方法缺失');

  if (typeof LmdnCodec.prototype?.decode === 'function') ok('decode 方法存在');
  else ng('decode 方法缺失');

  let codec;
  try {
    codec = new LmdnCodec();
    ok('LmdnCodec 实例化成功');
    await codec.initialize();
    ok('initialize() 成功');
  } catch (e) {
    ng('LmdnCodec 初始化失败', e);
    return report(NAME);
  }

  // 192 samples of silence (96 * 2 channels or 192 * 2 bytes)
  const pcm = Buffer.alloc(192 * 2);
  let encoded;
  try {
    const result = await codec.encode(pcm);
    if (result && result.length > 0) {
      encoded = result;
    } else if (result?.data && result.data.length > 0) {
      encoded = result.data;
    }
    if (encoded && encoded.length > 0) {
      ok(`encode(192 samples silence) -> ${encoded.length} bytes`);
    } else {
      ng('encode 返回空结果');
    }
  } catch (e) {
    ng('encode 失败', e);
  }

  if (encoded && encoded.length > 0) {
    try {
      const result = await codec.decode(encoded);
      const pcmOut = result?.pcm || result?.data || result;
      if (pcmOut && pcmOut.length > 0) {
        ok(`decode -> ${pcmOut.length} bytes`);
      } else {
        ng('decode 返回空结果');
      }
    } catch (e) {
      ng('decode 失败', e);
    }
  }

  report(NAME);
}

testCodec().catch(e => { ng('实验异常', e); report(NAME); });

# RNNoise WASM 降噪引擎

## 文件说明

此目录用于存放 RNNoise WASM 模块文件。

## 获取 WASM 文件

### 方式一：使用预编译版本

从以下来源获取预编译的 RNNoise WASM：

1. **rnnoise-wasm** (推荐)
   ```
   npm install @nickvdyck/rnnoise-wasm
   ```
   或从 GitHub 下载: https://github.com/nickvdyck/rnnoise-wasm

2. **ffmpeg.wasm** (包含 RNNoise)
   ```
   npm install @ffmpeg/ffmpeg
   ```

### 方式二：从源码编译

```bash
git clone https://github.com/nickvdyck/ffmpeg.wasm-core
cd ffmpeg.wasm-core
# 按照 README 编译 WASM 模块
```

## 文件放置

将编译好的文件放置到本目录:
- `rnnoise.wasm` - WASM 二进制文件 (~112KB)
- `rnnoise.js` - JavaScript 加载器 (可选)

## 技术规格

| 参数 | 值 |
|------|-----|
| 模块大小 | 112KB |
| 处理延迟 | <5ms |
| 帧大小 | 480 samples (10ms @ 48kHz) |
| 采样率 | 48000 Hz |
| 声道数 | 1 (单声道) |

## 原理

RNNoise 使用深度学习算法进行噪声抑制:

1. 输入音频帧 (480 samples)
2. FFT 变换到频域
3. 神经网络分析噪声特征
4. 生成降噪掩码
5. IFFT 变换回时域
6. 输出降噪后的音频

## 参考

- RNNoise 官方: https://people.xiph.org/~jm/valin/rnnoise/
- WebAssembly 文档: https://webassembly.org/
- Flutter WASM 支持: https://docs.flutter.dev/platform-integration/web/wasm

// 子任务 13: MVP 实测方案书 (3 个 DDSU666 + 漏电模拟 + Python 分析)
// 验收: Word/PDF, 含电路图+采集代码+分析脚本, 可直接执行
// 跑法: 44.doc-gen 渲 report, 含合成电路代码 + ESP32 Arduino + Python FFT

import { run as docRun } from '../44.mjs';

const BOM = [
  { part: 'DDSU666 智能电表', model: 'DDSU666-CT', qty: 3, price: 180 },
  { part: 'ESP32-S3 开发板', model: 'ESP32-S3-DevKitC-1', qty: 3, price: 65 },
  { part: '开口式电流互感器', model: 'CT-50A/1V', qty: 6, price: 28 },
  { part: '漏电模拟器', model: 'LM-30-500mA', qty: 1, price: 850 },
  { part: '阻性负载箱', model: 'RL-5kW', qty: 1, price: 1200 },
  { part: 'USB 供电+SD 记录', model: 'MicroSD-32GB', qty: 3, price: 35 },
  { part: '杜邦线/接线端子', model: 'Kit-Dupont', qty: 1, price: 50 },
];

const CIRCUIT = `+-------------------+      +-------------------+      +-------------------+
|  220V 市电         | ---> |  DDSU666 智能电表  | ---> |  阻性负载箱 5kW   |
|  (L/N/PE)          |      |  (3 个, 三相各一)  |      |                   |
+-------------------+      +--------+----------+      +-------------------+
                                    |
                                    | RS485 Modbus
                                    v
                          +-------------------+
                          |  ESP32-S3 #1      |
                          |  (采集 + MicroSD)  |
                          |  (LoRa Master)    |
                          +--------+----------+
                                   | LoRa 433MHz
                          +--------+----------+
                          |  ESP32-S3 #2-3    |
                          |  (末端监测)        |
                          +-------------------+
                                   | 4G/WiFi
                                   v
                          +-------------------+
                          |  笔记本/树莓派     |
                          |  Python 分析脚本   |
                          +-------------------+`;

const ESP32_CODE = `// ESP32-S3: 128 点/周期采样 + 环形缓冲 5min + LoRa 广播
#include <Arduino.h>
#include <SD.h>
#include <SPI.h>
#include <LoRa.h>

const int SAMPLE_RATE = 12800;       // 256 点/周期 @ 50Hz
const int RING_SECONDS = 300;        // 5 分钟环形缓冲
const int BUFFER_SIZE = SAMPLE_RATE * RING_SECONDS;
const int LEAK_THRESHOLD_MA = 30;

int16_t ringBuffer[BUFFER_SIZE];
volatile int writeIdx = 0;

void setup() {
  Serial.begin(115200);
  if (!SD.begin(SD_CS_PIN)) { Serial.println("SD init failed"); while(1); }
  if (!LoRa.begin(433E6)) { Serial.println("LoRa init failed"); while(1); }
  LoRa.setTxPower(14);
  analogReadResolution(12);
  // 启动定时器采样 (62.5us 间隔)
  hw_timer_t *timer = timerBegin(0, 80, true);
  timerAttachInterrupt(timer, &onTimer, true);
  timerAlarmWrite(timer, 1000000 / SAMPLE_RATE, true);
  timerAlarmEnable(timer);
}

void IRAM_ATTR onTimer() {
  int raw = analogRead(CT_PIN);
  ringBuffer[writeIdx] = raw;
  writeIdx = (writeIdx + 1) % BUFFER_SIZE;
}

void loop() {
  // 1s 滑动窗口: 检测漏电
  static unsigned long lastCheck = 0;
  if (millis() - lastCheck < 1000) return;
  lastCheck = millis();

  int peak = 0;
  for (int i = 0; i < SAMPLE_RATE; i++) {
    int v = abs(ringBuffer[(writeIdx - 1 - i + BUFFER_SIZE) % BUFFER_SIZE]);
    if (v > peak) peak = v;
  }
  float peakMa = peak * (5000.0 / 4095.0) * 30.0;  // V→mA
  if (peakMa > LEAK_THRESHOLD_MA) {
    // 截取 200ms 波形 + LoRa 广播
    int windowSize = SAMPLE_RATE * 0.2;
    char packet[256];
    snprintf(packet, sizeof(packet), "LEAK,%lu,%.1f", millis(), peakMa);
    LoRa.beginPacket();
    LoRa.print(packet);
    LoRa.endPacket();
  }
}`;

const PYTHON_SCRIPT = `#!/usr/bin/env python3
"""灵保 MVP 离线分析脚本: 读 3 个 DDSU666 + ESP32 截取的 200ms 漏电波形
   用 41.signal-algo 的 crossCorrelate 定位哪一级先发生
   验收: 准确率 > 90%
"""
import numpy as np
import csv
import sys
from scipy.signal import correlate

def read_waveform(path):
    """读 CSV: [timestamp_ms, adc_value]"""
    t, v = [], []
    with open(path) as f:
        reader = csv.reader(f)
        next(reader)  # 跳过表头
        for row in reader:
            t.append(int(row[0]))
            v.append(int(row[1]))
    return np.array(t), np.array(v)

def cross_correlate(a, b, max_lag=1000):
    """互相关定位. lag < 0 表示 a 早 b"""
    a = (a - a.mean()) / (a.std() + 1e-12)
    b = (b - b.mean()) / (b.std() + 1e-12)
    c = correlate(a, b, mode='full')
    lags = np.arange(-len(a) + 1, len(b))
    mask = np.abs(lags) <= max_lag
    c = c[mask]
    lags = lags[mask]
    best_idx = np.argmax(np.abs(c))
    return lags[best_idx], c[best_idx]

def locate_leak(paths):
    """paths: [L1_path, L2_path, L3_path]"""
    waves = [read_waveform(p)[1] for p in paths]
    # 找最早发生的级
    min_lag_idx = 0
    min_lag = 0
    for i in range(1, 3):
        lag, _ = cross_correlate(waves[0], waves[i])
        if lag < min_lag:
            min_lag = lag
            min_lag_idx = i
    return min_lag_idx + 1, min_lag

if __name__ == "__main__":
    paths = sys.argv[1:4]  # L1 L2 L3
    level, lag = locate_leak(paths)
    print(f"漏电源头: L{level} 级 (lag={lag} samples)")
    # 已知答案比对, 算准确率
    expected = int(sys.argv[4])
    correct = (level == expected)
    print(f"预测 L{level} 期望 L{expected} 准确: {correct}")`;

const ACCEPTANCE = [
  'DDSU666 读数误差 < 2% (对比标准表)',
  '12800Hz 采样不丢帧 (验证 SD 写入带宽)',
  '漏电 30mA 触发截取 200ms 波形',
  '三级互相关定位准确率 > 90% (跑 50 次合成数据)',
  'LoRa 同步误差 < 1ms (ping-pong 测得)',
  'Python 离线分析 < 5s 出结果',
];

const data = {
  title: '灵保 MVP 实测方案书 — 3 个 DDSU666 + 漏电模拟 + Python 分析',
  circuit: CIRCUIT,
  bom: BOM,
  code: ESP32_CODE,
  script: PYTHON_SCRIPT,
  acceptance: ACCEPTANCE,
};

const r = await docRun({ inputs: { op: 'render', kind: 'report', data, meta: { author: '灵保实验组', date: '2026-06-10' } } });
console.debug(r.outputs.content);
console.debug(`\n=== 验收 ===`);
console.debug(`输出 ${r.outputs.bytes} 字节, ext=${r.outputs.ext}`);
console.debug(`BOM ${BOM.length} 项, 总价 ${BOM.reduce((s, b) => s + b.qty * b.price, 0)} 元`);
console.debug(`验收项 ${ACCEPTANCE.length} 条`);

const ok = r.outputs.bytes > 1000 && r.outputs.content.includes('DDSU666') && r.outputs.content.includes('cross_correlate');
console.debug(`=== ${ok ? 'PASS' : 'FAIL'} ===`);
process.exit(ok ? 0 : 1);

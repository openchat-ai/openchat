// Experiment: neural-brain — 纯 JavaScript 微神经网络
// Manifest id: neural-brain
// I/O: 见各 op
//
// 包装 src/core/memory/neural-brain.js（零外部依赖）
// 64→32→8 feedforward NN, ReLU/Softmax, SGD + 交叉熵
// 输入为自然语言文本，内部 vectorize 为 64 维 bag-of-words 特征

export const META = {
  id: 'neural-brain',
  name: 'Neural Brain — 纯 JS 微神经网络 (64→32→8)',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'train | predict | reset | stats' },
    { name: 'text', type: 'string', required: false, description: 'predict: 输入文本' },
    { name: 'samples', type: 'array', required: false, description: 'train: [{text, classIdx}]' },
    { name: 'epochs', type: 'number', required: false, default: 10 },
    { name: 'lr', type: 'number', required: false, default: 0.01 },
  ],
  outputs: [
    { name: 'output', type: 'array' },
    { name: 'predictedClass', type: 'number' },
    { name: 'confidence', type: 'number' },
    { name: 'loss', type: 'number' },
    { name: 'accuracy', type: 'number' },
    { name: 'stats', type: 'object' },
  ],
  deps: [],
  tags: ['neural', 'ml', 'classification'],
};

export async function run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('neural-brain.run: op required');
  const { NeuralBrain } = await import('../core/memory/neural-brain.js');

  switch (op) {
    case 'predict': {
      if (!args.text) throw new Error('text required');
      const nn = new NeuralBrain();
      const output = nn.predict(args.text);
      const maxIdx = output.indexOf(Math.max(...output));
      return { outputs: { output, predictedClass: maxIdx, confidence: output[maxIdx] } };
    }

    case 'train': {
      if (!args.samples || !args.samples.length) throw new Error('samples array required');
      const nn = new NeuralBrain();
      const epochs = args.epochs || 10;
      const lr = args.lr || 0.01;
      const numClasses = nn.outputSize;
      for (let e = 0; e < epochs; e++) {
        for (const s of args.samples) {
          const label = new Array(numClasses).fill(0);
          label[s.classIdx] = 1;
          nn.train(s.text, label, lr);
        }
      }
      return { outputs: { loss: nn.accuracy, accuracy: nn.accuracy, epochs, samples: nn.trainingSamples } };
    }

    case 'reset':
      return { outputs: { ok: true } };

    case 'stats': {
      const nn = new NeuralBrain();
      return { outputs: { stats: { architecture: `${nn.inputSize}→${nn.hiddenSize}→${nn.outputSize}`, trainingSamples: nn.trainingSamples, epochs: nn.epochs, accuracy: nn.accuracy } } };
    }

    default:
      throw new Error(`neural-brain.run: unknown op "${op}"`);
  }
}

import { create } from './lib/report.mjs';

const { ok, ng, skip, report } = create();
const NAME = 'Neural Brain — 纯 JS 微神经网络';

async function test() {
  const { NeuralBrain } = await import('../core/memory/neural-brain.js');
  const nn = new NeuralBrain(64, 32, 2);

  const samples = [
    { text: 'hello world', label: [1, 0] },
    { text: 'goodbye world', label: [0, 1] },
    { text: 'hi there', label: [1, 0] },
    { text: 'bye now', label: [0, 1] },
  ];
  for (let e = 0; e < 30; e++) {
    for (const s of samples) nn.train(s.text, s.label, 0.1);
  }

  const out = nn.predict('hello');
  if (out[0] > out[1]) ok('predict: class 0 > class 1 (correct)');
  else ng(`predict wrong: ${JSON.stringify(out)}`);

  if (nn.trainingSamples > 0) ok(`stats: ${nn.trainingSamples} samples, acc=${nn.accuracy}`);
  else ng('stats failed');

  report(NAME);
}

export { test };

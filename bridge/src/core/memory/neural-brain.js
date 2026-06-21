export class NeuralBrain {
  constructor(inputSize = 64, hiddenSize = 32, outputSize = 8) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.outputSize = outputSize;
    this.trainingSamples = 0;
    this.epochs = 0;
    this.accuracy = 0;
    this._w1 = Array.from({ length: inputSize }, () =>
      Array.from({ length: hiddenSize }, () => Math.random() * 0.1 - 0.05));
    this._w2 = Array.from({ length: hiddenSize }, () =>
      Array.from({ length: outputSize }, () => Math.random() * 0.1 - 0.05));
    this._b1 = new Array(hiddenSize).fill(0);
    this._b2 = new Array(outputSize).fill(0);
  }

  _vectorize(text) {
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
    const vec = new Array(this.inputSize).fill(0);
    for (let i = 0; i < tokens.length && i < this.inputSize; i++) {
      vec[i] = 1;
    }
    return vec;
  }

  _sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, x)))); }

  _softmax(x) {
    const max = Math.max(...x);
    const ex = x.map(v => Math.exp(v - max));
    const sum = ex.reduce((a, b) => a + b, 0);
    return ex.map(v => v / (sum || 1));
  }

  predict(text) {
    const input = this._vectorize(text);
    const hidden = this._b1.map((b, j) =>
      this._sigmoid(input.reduce((s, v, i) => s + v * this._w1[i][j], 0) + b));
    return this._softmax(this._b2.map((b, j) =>
      hidden.reduce((s, v, i) => s + v * this._w2[i][j], 0) + b));
  }

  train(text, label, lr = 0.01) {
    const input = this._vectorize(text);
    const hidden = this._b1.map((b, j) =>
      this._sigmoid(input.reduce((s, v, i) => s + v * this._w1[i][j], 0) + b));
    const output = this._b2.map((b, j) =>
      hidden.reduce((s, v, i) => s + v * this._w2[i][j], 0) + b);
    const probs = this._softmax(output);

    const dOut = probs.map((p, j) => p - (label[j] || 0));
    const dHidden = this._b1.map((_, j) =>
      dOut.reduce((s, k) => s + dOut[k] * this._w2[j][k], 0) * hidden[j] * (1 - hidden[j]));

    for (let j = 0; j < this.outputSize; j++) {
      for (let i = 0; i < this.hiddenSize; i++) {
        this._w2[i][j] -= lr * dOut[j] * hidden[i];
      }
      this._b2[j] -= lr * dOut[j];
    }
    for (let j = 0; j < this.hiddenSize; j++) {
      for (let i = 0; i < this.inputSize; i++) {
        this._w1[i][j] -= lr * dHidden[j] * input[i];
      }
      this._b1[j] -= lr * dHidden[j];
    }

    this.trainingSamples++;
    const correct = probs.indexOf(Math.max(...probs)) === label.indexOf(1);
    this.accuracy = (this.accuracy * (this.trainingSamples - 1) + (correct ? 1 : 0)) / this.trainingSamples;
  }
}

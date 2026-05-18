export class SelfLearner {
  constructor() { this.active = false; }
  start() { this.active = true; }
  stop() { this.active = false; }
  async runLearningRound() { return { ok: true }; }
}
export const selfLearner = new SelfLearner();
export default selfLearner;

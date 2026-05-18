export const DEITY_TYPE = { GUARDIAN: 'guardian', MIRROR: 'mirror', ENERGY: 'energy' };

export class Deity {
  constructor(id) { this.id = id; }
}

export class DeitySystemManager {
  async initialize() {}
}

export const deitySystemManager = new DeitySystemManager();
export default deitySystemManager;

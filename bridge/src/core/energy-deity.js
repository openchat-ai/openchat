export const ENERGY_TYPE = { DEFAULT: 'default' };
export const POWER_MODE = { NORMAL: 'normal', ECO: 'eco' };

export class EnergyDeity {
  constructor() { this.mode = POWER_MODE.NORMAL; }
}

export const energyDeity = new EnergyDeity();

export async function initializeEnergySystem() {}

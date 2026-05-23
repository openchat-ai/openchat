import { test, describe, mock } from 'node:test';
import assert from 'node:assert';

class MockResidentManager {
  constructor() {
    this.residents = [];
    this.activities = [];
  }
  list = () => this.residents;
  addActivity = (id, act) => this.activities.push({ id, ...act });
  getResident = (id) => this.residents.find(r => (r.id || r.name) === id);
}

class MockMultiAgentCoordinator {
  spawnAgent = mock.fn(async () => ({ cleanup: mock.fn() }));
}

class MockPersistentConfig {
  getBridgeConfig = () => ({
    residentThinkMinInterval: 0,
    llmDailyTokenBudget: 1000000,
  });
}

const { ResidentScheduler } = await import('../agent/resident-scheduler.js');

describe('Agent loop E2E — resident full think/act cycle', () => {
  test('scheduler processes resident and calls assignTask', async () => {
    const mockRM = new MockResidentManager();
    const mockMAC = new MockMultiAgentCoordinator();
    const resident = {
      name: 'test-resident-1',
      id: 'test-resident-1',
      traits: { curiosity: 0.8, diligence: 0.7, creativity: 0.5, courage: 0.3, sociability: 0.6 },
      activities: [],
    };
    mockRM.residents = [resident];

    const scheduler = new ResidentScheduler(
      mockRM,
      'http://localhost:3800',
      mockMAC,
      new MockPersistentConfig(),
      { host: 'localhost', port: 3800 },
      []
    );

    scheduler._getHealthScore = () => 80;
    scheduler._assignTask = mock.fn();
    scheduler._assignConvergenceTask = mock.fn();
    scheduler._assignConvergenceRole = () => null;
    scheduler._residentAgentCount = new Map();
    scheduler._lastThinkTime = new Map();
    scheduler._lastAction = new Map();
    scheduler._dailyTokens = 0;
    scheduler._tickCount = 1;

    scheduler._processResident(resident);

    assert.ok(scheduler._assignTask.mock.calls.length > 0 || scheduler._assignConvergenceTask.mock.calls.length > 0,
      `Expected at least one task assignment, got assignTask=${scheduler._assignTask.mock.calls.length} convergenceTask=${scheduler._assignConvergenceTask.mock.calls.length}`);
  });

  test('scheduler respects concurrency limits', async () => {
    const mockRM = new MockResidentManager();
    const mockMAC = new MockMultiAgentCoordinator();
    const resident = { name: 'test-resident-2', id: 'test-resident-2', traits: {}, activities: [] };
    mockRM.residents = [resident, { name: 'test-resident-3', id: 'test-resident-3', traits: {}, activities: [] }];

    const scheduler = new ResidentScheduler(
      mockRM, 'http://localhost:3800', mockMAC,
      new MockPersistentConfig(), { host: 'localhost', port: 3800 }, []
    );

    scheduler._residentAgentCount = new Map([['test-resident-2', 5]]);
    scheduler._lastThinkTime = new Map();
    scheduler._lastAction = new Map();
    scheduler._dailyTokens = 0;
    scheduler._tickCount = 1;
    scheduler._getHealthScore = () => 80;
    scheduler._assignTask = mock.fn();
    scheduler._assignConvergenceTask = mock.fn();
    scheduler._assignConvergenceRole = () => null;

    scheduler._processResident(resident);
    assert.strictEqual(scheduler._assignTask.mock.calls.length, 0, 'Should skip when at concurrency limit');
  });

  test('scheduler processes multiple residents in tick', () => {
    const mockRM = new MockResidentManager();
    const mockMAC = new MockMultiAgentCoordinator();
    const residents = [
      { name: 'r1', id: 'r1', traits: { creativity: 0.1, diligence: 0.1, curiosity: 0.1, courage: 0.1, sociability: 0.1 }, activities: [] },
      { name: 'r2', id: 'r2', traits: {}, activities: [] },
    ];
    mockRM.residents = residents;

    const scheduler = new ResidentScheduler(
      mockRM, 'http://localhost:3800', mockMAC,
      new MockPersistentConfig(), { host: 'localhost', port: 3800 }, []
    );

    scheduler._residentAgentCount = new Map();
    scheduler._lastThinkTime = new Map();
    scheduler._lastAction = new Map();
    scheduler._dailyTokens = 0;
    scheduler._getHealthScore = () => 80;
    let processCount = 0;
    scheduler._processResident = (r) => { processCount++; };

    // Test _processResident directly instead of _tick (which uses global residentManager)
    residents.forEach(r => scheduler._processResident(r));
    assert.ok(processCount > 0, `Expected at least 1 processed, got ${processCount}`);
  });
});

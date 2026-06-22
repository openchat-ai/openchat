// persistent-store.js — stub re-export shell restored after refactor (commit d4f7369).
// The real implementation (src/experiments/lib/persistent-store.js) was merged away and
// not reintroduced. Until it is ported back, callers (e.g. bin/openchat.mjs `--continue`
// mode) get a no-op store that returns empty sessions. Replace with the real
// PersistentSessionStore (or import from a new home) when the feature is restored.
//
// Original import path expected by callers: '../src/core/persistent-store.js'

export const persistentStore = {
  getAllSessions: () => [],
  getSession: () => null,
  setSession: () => {},
  deleteSession: () => {},
  getProvider: () => null,
  setProvider: () => {},
  deleteProvider: () => {},
  getAllProviders: () => [],
};

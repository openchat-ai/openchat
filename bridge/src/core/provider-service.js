export function listAll() {
  return [{ id: 'default', name: 'Default Provider', type: 'openrouter' }];
}

export async function configure(providerId, { apiKey, baseUrl }) {
  return { ok: true };
}

export function getModels(providerId) {
  return ['gpt-4o', 'claude-3-opus'];
}

export async function fetchLocalModelsFromBridge(providerName, port) {
  try {
    const resp = await fetch(`http://localhost:${port}/api/provider/models?providerId=${providerName}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (resp.ok) {
      const json = await resp.json();
      return json.models || [];
    }
  } catch (e) {
  }
  return [];
}

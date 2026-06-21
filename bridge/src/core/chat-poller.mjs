export async function startChatPoll() {
  // chat-poller: polls oc/chat/ for messages
}

export function tsFromKey(key) {
  const parts = (key || '').split('_');
  return parseInt(parts[parts.length - 1], 10) || 0;
}

export function parseMsgPayload(raw) {
  try { return JSON.parse(raw); } catch { return { text: raw }; }
}

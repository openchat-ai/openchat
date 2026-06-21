export const PROMPTS = {};

export function buildMessages(prompt) {
  return [{ role: 'user', content: prompt }];
}

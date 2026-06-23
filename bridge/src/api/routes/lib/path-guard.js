import { resolve } from 'path';

export function guardPath(base, userPath) {
  const resolved = resolve(base, userPath);
  if (!resolved.startsWith(base)) {
    throw new Error('PATH_TRAVERSAL_DENIED');
  }
  return resolved;
}

export async function ensureProject(name) {
  return `/tmp/projects/${name}`;
}

export async function writeWithGit(workspace, filePath, content) {
  return { success: true };
}

export async function describeProject(name) {
  return { name, files: 0, language: 'unknown' };
}

export async function scanProjectFiles(name) {
  return [];
}

export function getProjectPath(name) {
  return `/tmp/projects/${name}`;
}

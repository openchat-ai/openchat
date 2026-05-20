import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(__dirname, '../src/core');
const srcDir = path.resolve(__dirname, '../src');

// Map of file → subdirectory for all files in core/
const fileToDir = {};

function scanDir(dir, subdir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (!entry.name.endsWith('.js') && !entry.name.endsWith('.mjs')) continue;
    fileToDir[entry.name] = subdir;
  }
}

// Scan core root + all subdirs
const rootFiles = fs.readdirSync(coreDir, { withFileTypes: true });
for (const entry of rootFiles) {
  if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'tmp') {
    scanDir(path.join(coreDir, entry.name), entry.name);
  } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
    fileToDir[entry.name] = ''; // core root
  }
}

const subdirs = fs.readdirSync(coreDir, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name !== '__tests__' && e.name !== 'tmp')
  .map(e => e.name);

// List of src/ sibling directories (non-core dirs under src/)
const siblingDirs = fs.readdirSync(srcDir, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name !== 'core')
  .map(e => e.name);

let changed = 0;

for (const subdir of subdirs) {
  const dirPath = path.join(coreDir, subdir);
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.js') || f.endsWith('.mjs'));

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    let content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;

    // Fix 1: './xxx.js' → correct relative path
    content = content.replace(/from '\.\/([^/'"]+\.(?:js|mjs))'/g, (match, targetFile) => {
      const targetSubdir = fileToDir[targetFile];
      if (targetSubdir === undefined) return match;
      if (targetSubdir === subdir) return match;
      modified = true;
      const prefix = targetSubdir === '' ? '../' : `../${targetSubdir}/`;
      return `from '${prefix}${targetFile}'`;
    });

    // Fix 2: '../constants.js' -> '../../constants.js'
    content = content.replace(/from '\.\.\/([^/'"]+\.(?:js|mjs))'/g, (match, targetFile) => {
      // Check if this file exists at src/ level
      if (fs.existsSync(path.join(srcDir, targetFile))) {
        modified = true;
        return `from '../../${targetFile}'`;
      }
      // Check if it exists at core/ level
      if (fs.existsSync(path.join(coreDir, targetFile))) {
        modified = true;
        return `from '../${targetFile}'`;
      }
      return match; // don't change if we can't determine
    });

    // Fix 3: '../xxx/yyy.js' where xxx is a sibling of core/
    content = content.replace(/from '\.\.\/([^/'"]+)\/([^']+\.(?:js|mjs))'/g, (match, siblingDir, targetFile) => {
      if (siblingDirs.includes(siblingDir)) {
        // From subdir, need to go up twice to reach src/
        modified = true;
        return `from '../../${siblingDir}/${targetFile}'`;
      }
      // Check if it's a core subdir referencing via '../' (already correct)
      if (subdirs.includes(siblingDir)) {
        return match; // already correct
      }
      // '../core/xxx.js' from subdir -> '../xxx.js'
      if (siblingDir === 'core') {
        modified = true;
        return `from '../${targetFile}'`;
      }
      return match;
    });

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf-8');
      changed++;
      console.log(`FIXED: ${subdir}/${file}`);
    }
  }
}

console.log(`\nFixed ${changed} files.`);

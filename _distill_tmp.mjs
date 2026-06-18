import Database from 'better-sqlite3';

const db = new Database('C:/Users/Administrator/.local/share/mimocode/mimocode.db', { readonly: true });

// List tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('=== Tables ===');
for (const t of tables) console.log(t.name);

// Count rows
for (const t of tables) {
  const cnt = db.prepare(`SELECT count(*) as c FROM "${t.name}"`).get();
  console.log(`  ${t.name}: ${cnt.c} rows`);
}

db.close();

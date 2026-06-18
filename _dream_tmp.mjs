import Database from 'better-sqlite3';
const db = new Database('C:/Users/Administrator/.local/share/mimocode/mimocode.db', {readonly: true});

// List tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(r => r.name).join(', '));

// List sessions
const sessions = db.prepare("SELECT id, project_id, directory, title, time_created FROM session ORDER BY time_created DESC LIMIT 20").all();
console.log('\nSessions:');
for (const s of sessions) {
  console.log(`  ${s.id} | project=${s.project_id} | dir=${s.directory} | title=${s.title} | created=${s.time_created}`);
}

db.close();

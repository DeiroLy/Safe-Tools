// inspect_db.js
const sqlite3 = require('sqlite3').verbose();
const dbPath = './ferramentas.db';

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Erro abrindo DB:', err.message);
    process.exit(1);
  }
});

function q(sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

(async () => {
  try {
    console.log('DB path:', dbPath);
    console.log('--- Tables ---');
    const tables = await q("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;");
    console.log(JSON.stringify(tables, null, 2));

    console.log('\n--- Last 20 tools ---');
    const tools = await q("SELECT id, uid, name, category, status, code FROM tools ORDER BY id DESC LIMIT 20;");
    console.log(JSON.stringify(tools, null, 2));

    console.log('\n--- Last 20 modes ---');
    const modes = await q("SELECT id, mode, tool_id, user_id, created_at FROM modes ORDER BY id DESC LIMIT 20;");
    console.log(JSON.stringify(modes, null, 2));

    console.log('\n--- Last 20 logs ---');
    const logs = await q("SELECT id, tool_id, user_id, action, borrower_name, borrower_class, timestamp FROM logs ORDER BY timestamp DESC LIMIT 20;");
    console.log(JSON.stringify(logs, null, 2));

    console.log('\n--- Users ---');
    const users = await q("SELECT id, username FROM users;");
    console.log(JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('Erro nas queries:', err);
  } finally {
    db.close();
  }
})();

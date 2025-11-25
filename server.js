// server.js (CORRIGIDO para Render / local)
// Place this file at the project root alongside your front.html
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'ferramentas.db');
const API_KEY = process.env.API_KEY || 'dev_local_key';

// Emergency guards so process doesn't silently exit in production
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION', reason && reason.stack ? reason.stack : reason);
});

app.use(cors()); // in production, restrict origin
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// open DB (create file if missing)
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Failed to open DB', DB_FILE, err);
    process.exit(1);
  } else {
    console.log('SQLite DB opened:', DB_FILE);
    initSchema();
  }
});

// initialize schema if missing (safe to run multiple times)
function initSchema(){
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT UNIQUE,
      name TEXT,
      category TEXT,
      status TEXT,
      code TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS modes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT,
      tool_id INTEGER,
      user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_id INTEGER,
      user_id INTEGER,
      action TEXT,
      borrower_name TEXT,
      borrower_class TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    );`
  ];

  db.serialize(() => {
    stmts.forEach(s => db.run(s, err => { if(err) console.error('initSchema err:', err.message); }));
    // ensure admin user exists
    db.get("SELECT id FROM users WHERE username = 'admin' LIMIT 1", (err, row) => {
      if(err) return console.error('initSchema check admin err', err);
      if(!row){
        const pw = bcrypt.hashSync('1234', 8);
        db.run("INSERT INTO users (username, password) VALUES (?, ?)", ['admin', pw], function(e){
          if(e) console.error('create admin err', e);
          else console.log('Admin user created');
        });
      } else {
        console.log('Admin user exists');
      }
    });
  });
}

// small helper to respond only once in async flows
function respondOnce(res){
  let done = false;
  return (status, payload) => {
    if(done) return;
    done = true;
    try {
      if (typeof payload === 'string') {
        res.status(status).send(payload);
      } else {
        res.status(status).json(payload);
      }
    } catch (e) {
      console.error('respondOnce error', e);
    }
  };
}

// simple API key middleware for ESP-like routes
function requireApiKey(req, res, next){
  const key = req.headers['x-api-key'] || req.query['api_key'] || req.headers['authorization'];
  if(key === API_KEY) return next();
  return res.status(401).json({ error: 'invalid_api_key' });
}

/* -------------------
   Routes
   ------------------- */

// health
app.get('/health', (req, res) => res.json({ ok:true, ts: new Date().toISOString() }));

// login
app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  if(!username || !password) return res.status(400).json({ success:false, message:'username/password required' });

  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if(err){
      console.error('login db err', err);
      return res.status(500).json({ success:false, message:'server error' });
    }
    if(!user) return res.status(401).json({ success:false, message:'Usuário não encontrado.' });

    let valid = false;
    try {
      valid = bcrypt.compareSync(password, user.password);
    } catch(e) {
      valid = (password === user.password); // fallback if password in DB is plain
    }

    if(!valid) return res.status(401).json({ success:false, message:'Senha incorreta.' });
    return res.json({ success:true, message:'Login bem-sucedido.' });
  });
});

// api_set_mode (create placeholder for cadastrar)
app.post(['/api_set_mode','/api/set_mode'], (req, res) => {
  const done = respondOnce(res);
  const mode = (req.body.mode || '').trim();
  const user_id = req.body.user_id ? parseInt(req.body.user_id) : null;
  const category = (req.body.category || '').trim();

  if(!['cadastrar','retirar','devolver','idle'].includes(mode)) return done(400, { error:'invalid_mode' });

  if(mode === 'cadastrar'){
    // try create unique placeholder
    function genUid(){ return 'PH-' + Date.now() + '-' + Math.floor(Math.random()*90000+10000); }
    let tries = 0;
    (function tryInsert(){
      tries++;
      const placeholderUid = genUid();
      db.run("INSERT INTO tools (uid, name, category, status) VALUES (?, ?, ?, ?)", [placeholderUid, '', category, 'placeholder'], function(err){
        if(err){
          if(err.code === 'SQLITE_CONSTRAINT' && tries < 6) return tryInsert();
          console.error('api_set_mode insert placeholder err', err);
          return done(500, { error:'db_error', detail: err.message });
        }
        const createdToolId = this.lastID;
        db.run("INSERT INTO modes (mode, tool_id, user_id) VALUES (?, ?, ?)", [mode, createdToolId, user_id], function(err2){
          if(err2){
            console.error('api_set_mode insert mode err', err2);
            return done(500, { error:'db_error', detail: err2.message });
          }
          return done(200, { ok:true, mode_id: this.lastID, mode, tool_id: createdToolId, placeholderUid });
        });
      });
    })();
    return;
  }

  // other modes: create mode row with possible tool linkage
  db.run("INSERT INTO modes (mode, tool_id, user_id) VALUES (?, ?, ?)", [mode, null, user_id], function(err){
    if(err) { console.error('api_set_mode err', err); return done(500, { error:'db_error' }); }
    return done(200, { ok:true, mode_id: this.lastID, mode });
  });
});

// api_register_tag (ESP -> register uid). Can be called by GET or POST.
// If mode_id provided, use that mode's placeholder; otherwise fallback to latest placeholder.
app.all(['/api_register_tag','/api/register_tag'], (req, res) => {
  const done = respondOnce(res);
  // accept uid via query or body
  const uid = (req.query.uid || (req.body && req.body.uid) || '').toString().trim();
  const mode_id = req.query.mode_id || (req.body && req.body.mode_id) || null;

  if(!uid) return done(400, { ok:false, error:'missing uid' });

  db.get("SELECT id FROM tools WHERE uid = ?", [uid], (err, existing) => {
    if(err) { console.error('register check err', err); return done(500, { ok:false, error:'db_error' }); }
    if(existing) {
      return done(200, { ok:true, tool_id: existing.id, uid });
    }

    function proceedWithTool(toolId){
      db.get("SELECT category FROM tools WHERE id = ?", [toolId], (err2, trow) => {
        if(err2 || !trow) { console.error('register tool read err', err2); return done(500, { ok:false, error:'no_tool_row' }); }
        const category = (trow.category || 'GEN').replace(/\s+/g,'').substring(0,3).toUpperCase();
        db.get("SELECT COUNT(*) as cnt FROM tools WHERE category = ? AND code IS NOT NULL", [trow.category], (err3, cntRow) => {
          const nextIndex = (cntRow && cntRow.cnt) ? (cntRow.cnt + 1) : 1;
          const code = category + String(nextIndex).padStart(3,'0');
          const name = req.body && req.body.name ? req.body.name : `FERR-${code}`;
          db.run("UPDATE tools SET uid = ?, code = ?, name = ?, status = ? WHERE id = ?", [uid, code, name, 'Disponível', toolId], function(err4){
            if(err4) { console.error('register update err', err4); return done(500, { ok:false, error:'db_error', detail: err4.message }); }
            db.run("INSERT INTO logs (tool_id, user_id, action, borrower_name, borrower_class) VALUES (?, ?, ?, ?, ?)", [toolId, null, 'cadastrado', null, null], function(logErr){
              if(logErr) console.error('register log err', logErr);
              return done(200, { ok:true, tool_id: toolId, uid, code, name });
            });
          });
        });
      });
    }

    if(mode_id){
      db.get("SELECT tool_id FROM modes WHERE id = ? LIMIT 1", [mode_id], (errm, mrow) => {
        if(errm || !mrow) { console.error('register mode err', errm); return done(400, { ok:false, error:'invalid_mode' }); }
        if(!mrow.tool_id) return done(400, { ok:false, error:'mode_has_no_tool' });
        return proceedWithTool(mrow.tool_id);
      });
    } else {
      // fallback: latest placeholder
      db.get("SELECT id FROM tools WHERE status = 'placeholder' ORDER BY id DESC LIMIT 1", [], (errp, prow) => {
        if(errp || !prow) { console.error('register placeholder err', errp); return done(400, { ok:false, error:'no_placeholder' }); }
        return proceedWithTool(prow.id);
      });
    }
  });
});

// api_action (retirar / devolver)
app.all(['/api_action','/api/action'], (req, res) => {
  const done = respondOnce(res);
  // uid + acao via query or body
  const uid = (req.query.uid || (req.body && req.body.uid) || '').toString().trim();
  const acao = (req.query.acao || (req.body && req.body.acao) || '').toString().trim();

  if(!uid || !acao) return done(400, 'missing');

  db.get("SELECT * FROM tools WHERE uid = ?", [uid], (err, tool) => {
    if(err || !tool) { console.error('api_action lookup err', err); return done(404, 'not found'); }
    if(acao === 'retirar'){
      db.run("UPDATE tools SET status = ? WHERE id = ?", ['Em uso', tool.id], function(err2){
        if(err2) { console.error('api_action retirar err', err2); return done(500,'error'); }
        db.run("INSERT INTO logs (tool_id, user_id, action) VALUES (?, ?, ?)", [tool.id, null, 'retirada'], () => {});
        return done(200, 'ok');
      });
    } else if(acao === 'devolver'){
      db.run("UPDATE tools SET status = ? WHERE id = ?", ['Disponível', tool.id], function(err2){
        if(err2) { console.error('api_action devolver err', err2); return done(500,'error'); }
        db.run("INSERT INTO logs (tool_id, user_id, action) VALUES (?, ?, ?)", [tool.id, null, 'devolucao'], () => {});
        return done(200, 'ok');
      });
    } else {
      return done(400, 'unknown_action');
    }
  });
});

// public endpoints
app.get('/public/list', (req, res) => {
  db.all("SELECT * FROM tools ORDER BY id DESC", [], (err, rows) => {
    if(err) return res.status(500).json({ error:'db_error' });
    return res.json({ tools: rows });
  });
});

app.get('/public/logs', (req, res) => {
  db.all("SELECT * FROM logs ORDER BY timestamp DESC LIMIT 200", [], (err, rows) => {
    if(err) return res.status(500).json({ error:'db_error' });
    return res.json({ logs: rows });
  });
});

// secure endpoints example (require API key)
app.post('/api/register', requireApiKey, (req, res) => {
  // example: allows registering event from ESP (not used by front)
  const uid = (req.body.uid || '').toString().trim();
  if(!uid) return res.status(400).json({ error:'missing_uid' });
  res.json({ ok:true });
});

// Serve frontend (static). If you keep front.html in project root, this serves it.
app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'front.html'));
});

// Start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});

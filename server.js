// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// API key middleware (coloque após express.json)
const API_KEY = process.env.API_KEY || 'dev_local_key';
function requireApiKey(req, res, next) {
    const key = req.header('x-api-key') || req.query.api_key;
    if (!key || key !== API_KEY) return res.status(401).json({ error: 'invalid_api_key' });
    next();
}
// --- DATABASE: Postgres if DATABASE_URL set, otherwise SQLite (fallback) ---
let db;      // will be sqlite db object or wrapper for pg
let usingPg = false;

if (process.env.DATABASE_URL) {
    // Postgres setup (Render internal DB)
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    usingPg = true;
    // minimal wrapper to reuse some sqlite style calls in existing code
    db = {
        query: (text, params) => pool.query(text, params),
        get: (sql, params, cb) => {
            pool.query(sql, params)
                .then(r => cb(null, r.rows[0] || null))
                .catch(e => cb(e));
        },
        all: (sql, params, cb) => {
            pool.query(sql, params)
                .then(r => cb(null, r.rows || []))
                .catch(e => cb(e));
        },
        run: (sql, params, cb) => {
            // for INSERT with RETURNING id, you can read rows[0].id
            pool.query(sql, params)
                .then(r => cb && cb(null, r))
                .catch(e => cb && cb(e));
        }
    };
    } else {
    // SQLite fallback
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./ferramentas.db', (err) => {
        if (err) console.error('SQLite open error', err);
        else console.log('SQLite DB opened');
    });
}

// --- CONFIGURAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'front.html'));
});

// ===== middleware API key =====
const API_KEY = process.env.API_KEY || 'dev_local_key';
function requireApiKey(req, res, next) {
    const key = req.header('x-api-key') || req.query.api_key;
    if (!key || key !== API_KEY) {
        return res.status(401).json({ error: 'invalid_api_key' });
    }
    next();
}

// --- CONFIGURAÇÃO DO BANCO DE DADOS ---
const db = new sqlite3.Database('./ferramentas.db', (err) => {
    if (err) {
        console.error("Erro ao abrir o banco de dados", err.message);
    } else {
        console.log("Conectado ao banco de dados SQLite.");

        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT
            );
            CREATE TABLE IF NOT EXISTS tools (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                category TEXT,
                status TEXT DEFAULT 'Disponível'
            );
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_id INTEGER,
                user_id INTEGER,
                action TEXT,
                borrower_name TEXT,
                borrower_class TEXT,
                timestamp DATETIME DEFAULT (datetime('now', '-3 hours')),
                FOREIGN KEY(tool_id) REFERENCES tools(id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE
            );
            CREATE TABLE IF NOT EXISTS modes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mode TEXT,
                tool_id INTEGER,
                user_id INTEGER,
                created_at DATETIME DEFAULT (datetime('now'))
            );
        `, (err) => {
            if (err) console.error("Erro ao criar tabelas", err);

            // Cria admin padrão com senha criptografada
            const adminUser = 'admin';
            const adminPass = '1234';
            db.get(`SELECT id, password FROM users WHERE username = ?`, [adminUser], (err, row) => {
                if (err) console.error("Erro ao verificar admin:", err);
                else if (!row) {
                    const hash = bcrypt.hashSync(adminPass, 10);
                    db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [adminUser, hash]);
                    console.log("Usuário admin criado.");
                } else {
                    const currentPass = row.password || '';
                    if (!currentPass.startsWith('$2a$')) {
                        const hash = bcrypt.hashSync(adminPass, 10);
                        db.run(`UPDATE users SET password = ? WHERE id = ?`, [hash, row.id]);
                        console.log("Senha do admin atualizada para hash.");
                    }
                }
            });
        });
    }
});

// --- ROTAS DE USUÁRIOS ---

// Rota de Login
app.post('/login', (req, res) => {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Usuário e senha obrigatórios.' });
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro no servidor.' });
        if (!user) return res.status(401).json({ success: false, message: 'Usuário não encontrado.' });

        const storedHash = user.password || '';

        // tenta comparar com bcrypt; se storedHash não for hash, permite comparação direta (fallback)
        let valid = false;
        try {
            valid = bcrypt.compareSync(password, storedHash);
        } catch (e) {
            valid = (password === storedHash);
        }

        if (!valid) return res.status(401).json({ success: false, message: 'Senha incorreta.' });

        // login bem-sucedido
        return res.json({ success: true, message: 'Login bem-sucedido.' });
    });
});
// Rota para registrar novo usuário
app.post('/users/register', (req, res) => {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Usuário e senha obrigatórios.' });
    }

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro no servidor.' });
        if (row) return res.status(409).json({ success: false, message: 'Usuário já existe.' });

        const hash = bcrypt.hashSync(password, 10);
        db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hash], function(insertErr) {
            if (insertErr) {
                return res.status(500).json({ success: false, message: 'Erro ao cadastrar usuário.' });
            }
            return res.json({ success: true, message: 'Usuário registrado com sucesso.' });
        });
    });
});

// --- ROTAS DE FERRAMENTAS ---

app.get('/tools', (req, res) => {
    db.all(`SELECT * FROM tools ORDER BY category, name`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Registrar nova ferramenta
app.post('/tools/register', (req, res) => {
    const { uid, name, category } = req.body;
    if (!uid || !name) return res.status(400).json({ message: 'UID e Nome são obrigatórios.' });

    db.run(`INSERT INTO tools (uid, name, category) VALUES (?, ?, ?)`, [uid, name, category], function(err) {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao cadastrar. UID já pode existir.' });
        res.json({ success: true, message: `Ferramenta '${name}' cadastrada com sucesso!`, id: this.lastID });
    });
});

// Remover ferramenta
app.delete('/tools/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM tools WHERE id = ?`, [id], function(err) {
        if (err) return res.status(500).json({ error: "Erro ao remover ferramenta" });
        if (this.changes === 0) return res.status(404).json({ error: "Ferramenta não encontrada" });
        res.json({ message: "Ferramenta removida com sucesso" });
    });
});

// Devolver ferramenta
app.post('/tools/return', (req, res) => {
    const { uid } = req.body;
    db.get(`SELECT id FROM tools WHERE uid = ?`, [uid], (err, tool) => {
        if (err || !tool) return res.status(404).json({ success: false, message: 'Ferramenta não encontrada.' });
        db.run(`UPDATE tools SET status = 'Disponível' WHERE id = ?`, [tool.id], (err) => {
            if (err) return res.status(500).json({ success: false, message: 'Erro ao atualizar status.' });
            db.run(`INSERT INTO logs (tool_id, user_id, action) VALUES (?, ?, ?)`, [tool.id, 1, 'Devolução']);
            res.json({ success: true, message: 'Ferramenta devolvida com sucesso!' });
        });
    });
});

// Atualizar status
app.put('/tools/:id/status', (req, res) => {
    const { status, borrower_name, borrower_class } = req.body;
    const { id } = req.params;
    db.run(`UPDATE tools SET status = ? WHERE id = ?`, [status, id], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao atualizar status.' });
        const action = status === 'Em uso' ? 'Retirada (Uso)' : 'Retirada (Empréstimo)';
        db.run(`INSERT INTO logs (tool_id, user_id, action, borrower_name, borrower_class) VALUES (?, ?, ?, ?, ?)`, 
            [id, 1, action, borrower_name, borrower_class]);
        res.json({ success: true, message: `Status da ferramenta atualizado para '${status}'.` });
    });
});

// Histórico
app.get('/logs', (req, res) => {
    const query = `
        SELECT l.timestamp, u.username, t.name, l.action, l.borrower_name, l.borrower_class
        FROM logs l
        JOIN tools t ON l.tool_id = t.id
        JOIN users u ON l.user_id = u.id
        ORDER BY l.timestamp DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- CONTROLE ARDUINO ---
let unlockCommand = false;
app.get('/arduino/status', (req, res) => {
    if (unlockCommand) {
        unlockCommand = false;
        res.send("UNLOCK");
    } else {
        res.send("OK");
    }
});

// --- API ACTION ---
// ===============================================================
app.get('/api_action', (req, res) => {
    console.log(" /api_action", req.query);
    res.setHeader("Content-Type", "text/plain");

    const uid = (req.query.uid || "").trim().toUpperCase();
    const acao = (req.query.acao || "").trim(); // retirar | devolver
    const codigo = (req.query.codigo || "").trim(); // código gerado no Arduino

    if (!uid || !acao) {
        return res.send("error: missing parameters");
    }

    console.log("📥 Recebido do Arduino:", uid, acao, codigo);

    // 1) Procurar ferramenta pelo UID
    db.get("SELECT id, name, status FROM tools WHERE uid = ?", [uid], (err, tool) => {
        if (err) {
            console.error(err);
            return res.send("error: db");
        }

        if (!tool) {
            // Se ferramenta não existe → criar automaticamente
            db.run(
                "INSERT INTO tools (uid, name, category, status) VALUES (?, ?, ?, ?)",
                [uid, codigo || ("Ferramenta " + uid), "N/D", "Disponível"],
                function (err) {
                    if (err) return res.send("error: insert");

                    tool = { id: this.lastID, name: codigo };
                    console.log("🆕 Ferramenta criada automaticamente:", uid);
                    processarAcao(tool.id);
                }
            );
        } else {
            processarAcao(tool.id);
        }
    });

    // 2) Processar retirar/devolver
    function processarAcao(tool_id) {
        if (acao === "retirar") {
            db.run("UPDATE tools SET status = 'Em uso' WHERE id = ?", [tool_id]);
            db.run(
                "INSERT INTO logs (tool_id, user_id, action, borrower_name, borrower_class) VALUES (?, ?, ?, ?, ?)",
                [tool_id, 1, "retirada", null, null]
            );
            console.log(" Retirada registrada para:", uid);
            return res.send("ok");
        }

        if (acao === "devolver") {
            db.run("UPDATE tools SET status = 'Disponível' WHERE id = ?", [tool_id]);
            db.run(
                "INSERT INTO logs (tool_id, user_id, action, borrower_name, borrower_class) VALUES (?, ?, ?, ?, ?)",
                [tool_id, 1, "devolucao", null, null]
            );
            console.log(" Devolução registrada para:", uid);
            return res.send("ok");
        }

        return res.send("error: invalid action");
    }
});

// ===== NOVAS ROTAS para comunicação com ESP32 (JSON + x-api-key) =====
app.post('/api/register', requireApiKey, (req, res) => {
  // payload esperado: { uid, code, timestamp, state, meta }
    const { uid, code, timestamp, state, meta } = req.body || {};
    if (!uid || !code || !timestamp || !state) {
        return res.status(400).json({ success:false, error:'missing_fields' });
    }
    // se já existir UID, retorna info; caso não exista cria
    db.get('SELECT id FROM tools WHERE uid = ?', [uid], (err, row) => {
        if (err) return res.status(500).json({ success:false, error:'db' });
        if (row) {
        // atualizar código/nome se necessário
            db.run('UPDATE tools SET code = COALESCE(code, ?), name = COALESCE(name, ?) WHERE id = ?', [code, `FERR-${code}`, row.id]);
            // log
            db.run('INSERT INTO logs (tool_id, user_id, action, timestamp) VALUES (?, ?, ?, ?)', [row.id, null, 'cadastrado_via_esp', timestamp]);
            return res.json({ success:true, message:'already_exists', id: row.id });
        }
        // inserir novo registro
        if (!usingPg) {
            db.run('INSERT INTO tools (uid, code, name, status) VALUES (?, ?, ?, ?)', [uid, code, name, status], function(err) {
                if (err) { /* handle */ }
                const id = this.lastID;
                // rest of logic
            });
        } else {
            db.run('INSERT INTO tools (uid, code, name, status) VALUES ($1, $2, $3, $4) RETURNING id', [uid, code, name, status], (err, res) => {
                if (err) { /* handle */ }
                const id = res && res.rows && res.rows[0] ? res.rows[0].id : null;
                // rest of logic (same as sqlite branch)
            });
        }
    });
});

app.post('/api/return', requireApiKey, (req, res) => {
    // payload esperado: { uid, code, timestamp, state }
    const { uid, code, timestamp } = req.body || {};
    if (!uid || !timestamp) return res.status(400).json({ success:false, error:'missing_fields' });

    db.get('SELECT id FROM tools WHERE uid = ?', [uid], (err, row) => {
        if (err) return res.status(500).json({ success:false, error:'db' });
        if (!row) return res.status(404).json({ success:false, error:'not_found' });

        db.run('UPDATE tools SET status = ? WHERE id = ?', ['Disponível', row.id], (err2) => {
            if (err2) return res.status(500).json({ success:false, error:'update_failed' });
            db.run('INSERT INTO logs (tool_id, user_id, action, timestamp) VALUES (?, ?, ?, ?)', [row.id, null, 'devolucao_via_esp', timestamp]);
            return res.json({ success:true, message: 'returned' });
        });
    });
});

app.post('/api/event', requireApiKey, (req, res) => {
    // leitura bruta/log: { uid, code, timestamp, state, raw }
    const { uid, code, timestamp, state, raw } = req.body || {};
    if (!uid || !timestamp) return res.status(400).json({ success:false, error:'missing_fields' });

    db.get('SELECT id FROM tools WHERE uid = ?', [uid], (err, row) => {
        if (err) return res.status(500).json({ success:false, error:'db' });
        const tool_id = row ? row.id : null;
        db.run('INSERT INTO logs (tool_id, user_id, action, borrower_name, borrower_class, timestamp) VALUES (?, ?, ?, ?, ?, ?)', 
            [tool_id, null, (state || 'leitura'), raw && raw.user ? raw.user : null, raw && raw.class ? raw.class : null, timestamp],
            function(logErr) {
                if (logErr) console.error('log insert err', logErr);
                // também cria ferramenta-placeholder caso não exista (opcional)
                if (!row) {
                    db.run('INSERT INTO tools (uid, name, category, status) VALUES (?, ?, ?, ?)', [uid, raw && raw.name ? raw.name : '', 'N/D', 'placeholder'], function(insErr) {
                        if (insErr) console.error('create placeholder err', insErr);
                    });
                }
                return res.json({ success:true, message:'logged' });
            });
    });
});

app.get('/health', (req,res) => res.json({ ok: true, ts: new Date().toISOString() }));


// --- GET /api_categories  -> retorna lista de categorias ---
app.get('/api_categories', (req, res) => {
    db.all("SELECT id, name FROM categories ORDER BY name COLLATE NOCASE", [], (err, rows) => {
        if (err) {
            console.error("api_categories err:", err);
            return res.status(500).json({ error: 'db_error' });
        }
        res.json({ categories: rows });
        });
});

// --- POST /api_categories -> cria nova categoria (admin) ---
app.post('/api_categories', express.json(), (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'missing_name' });

    db.run("INSERT INTO categories (name) VALUES (?)", [name], function(err) {
    if (err) {
        console.error(err);
        return res.status(500).json({ error: 'insert_failed' });
    }
    res.json({ id: this.lastID, name });
    });
});

// PUT /api_tools/:id -> atualiza name, category e/ou status (unificado)
app.put('/api_tools/:id', express.json(), (req, res) => {
    const id = parseInt(req.params.id);
    console.log(" PUT /api_tools/:id chamado -> id:", id, "body:", req.body);

    if (!id || isNaN(id)) return res.status(400).json({ error: 'invalid_id' });

    // pegar campos (aceita atualização parcial)
    const name = ('name' in req.body) ? (req.body.name || '').trim() : null;
    const category = ('category' in req.body) ? (req.body.category || '').trim() : null;
    const status = ('status' in req.body) ? req.body.status : null;

    // Se foi chamado pelo front para salvar placeholder, queremos pelo menos name+category
    // Mas mantemos flexibilidade: se vier apenas uma atualização parcial, aplicamos.
    // Se vc deseja impedir atualizações parciais, descomente a validação abaixo:
    // if (!name || !category) return res.status(400).json({ error: 'missing_fields' });

    // montar query dinamicamente conforme campos presentes
    const sets = [];
    const params = [];

    if (name !== null) { sets.push("name = ?"); params.push(name); }
    if (category !== null) { sets.push("category = ?"); params.push(category); }
    if (status !== null) { sets.push("status = ?"); params.push(status); }

    if (sets.length === 0) {
        return res.status(400).json({ error: 'nothing_to_update' });
    }

    params.push(id);
    const sql = `UPDATE tools SET ${sets.join(', ')} WHERE id = ?`;
    db.run(sql, params, function(err) {
        if (err) {
            console.error("api_tools PUT err:", err);
            return res.status(500).json({ error: 'update_failed' });
        }
        if (this.changes === 0) return res.status(404).json({ error: 'not_found' });
        console.log("api_tools PUT ok -> changes:", this.changes);
        return res.json({ success: true, changes: this.changes });
    });
});


// Retorna o último placeholder criado pelo Arduino (name LIKE 'Ferramenta-%' ou category='N/D')
// GET /api_last_placeholder
app.get('/api_last_placeholder', (req, res) => {
    console.log(" /api_last_placeholder chamado");
    const sql = `
    SELECT 
        m.id AS mode_id,
        t.id AS tool_id,
        t.uid,
        t.name,
        t.category,
        t.code,
        t.status
    FROM modes m
    LEFT JOIN tools t ON m.tool_id = t.id
    WHERE m.mode = 'cadastrar'
    ORDER BY m.id DESC
    LIMIT 1
    `;

    db.get(sql, [], (err, row) => {
        if (err) {
            console.error('api_last_placeholder err:', err);
            return res.status(500).json({ error: 'db_error' });
        }
        if (!row) {
            return res.json({ found: false });
        }
        return res.json({ found: true, placeholder: row });
    });
});


// --- GET /api_categories: retorna lista de categorias ---
app.get('/api_categories', (req, res) => {
    db.all("SELECT id, name FROM categories ORDER BY name COLLATE NOCASE", [], (err, rows) => {
        if (err) {
        console.error("api_categories err:", err);
        return res.status(500).json({ error: 'db_error' });
        }
        res.json({ categories: rows });
    });
});

// GET /api_register_tag?uid=XXXX&mode_id=NN
app.get('/api_register_tag', (req, res) => {
    console.log(" /api_register_tag UID recebido:", req.query.uid);
    const uid = (req.query.uid || '').trim();
    const mode_id = req.query.mode_id ? parseInt(req.query.mode_id) : null;

    if (!uid) return res.status(400).json({ error:'missing_uid' });

    // If UID already exists for another tool -> return informative error
    db.get("SELECT id FROM tools WHERE uid = ?", [uid], (errCheck, existing) => {
            if (errCheck) {
            console.error('api_register_tag check err:', errCheck);
            return res.status(500).json({ error:'db_error', detail: errCheck.message });
        }
        if (existing) {
            // uid already registered to a tool -> return error so front/arduino can handle
            return res.status(409).json({ error: 'uid_exists', existing_tool_id: existing.id });
        }

        // proceed: find the mode row (if mode_id provided use it, else find last 'cadastrar')
        const modeQuery = mode_id
            ? { sql: "SELECT id, tool_id FROM modes WHERE id = ? LIMIT 1", params: [mode_id] }
            : { sql: "SELECT id, tool_id FROM modes WHERE mode='cadastrar' ORDER BY id DESC LIMIT 1", params: [] };

        db.get(modeQuery.sql, modeQuery.params, (err, modeRow) => {
            if (err || !modeRow) { console.error('api_register_tag mode err:', err); return res.status(500).json({ error:'no_mode' }); }

            const toolId = modeRow.tool_id;
            if (!toolId) return res.status(400).json({ error:'no_tool' });

            // get category of the placeholder tool
            db.get("SELECT category FROM tools WHERE id = ?", [toolId], (err2, trow) => {
                if (err2 || !trow) { console.error('api_register_tag tool err:', err2); return res.status(500).json({ error:'no_tool_row' }); }
                const category = trow.category || 'GEN';

                // compute prefix (3 letters) and count to create code
                const prefix = category.replace(/\s+/g,'').substring(0,3).toUpperCase();

                db.get("SELECT COUNT(*) as cnt FROM tools WHERE category = ? AND code IS NOT NULL", [category], (err3, cntRow) => {
                    if (err3) { console.error('api_register_tag count err:', err3); return res.status(500).json({ error:'db_error' }); }
                    const nextIndex = (cntRow && cntRow.cnt) ? (cntRow.cnt + 1) : 1;
                    const code = prefix + String(nextIndex).padStart(3, '0'); // ex: AUT001

                    const name = `FERR-${code}`;

                    // update tool with uid, code, name and set status as Disponível
                    db.run("UPDATE tools SET uid = ?, code = ?, name = ?, status = ? WHERE id = ?",
                        [uid, code, name, 'Disponível', toolId],
                        function(err4) {
                            if (err4) { 
                                console.error('api_register_tag update err:', err4); 
                                return res.status(500).json({ error:'db_error', detail: err4.message });
                        }

                // insert a log entry (optional)
                        db.run("INSERT INTO logs (tool_id, user_id, action, borrower_name, borrower_class, timestamp) VALUES (?, ?, ?, ?, ?, datetime('now'))",
                            [toolId, null, 'cadastrado', null, null], function(logErr) {
                                if (logErr) console.error('api_register_tag log err:', logErr);
                                return res.json({ ok:true, tool_id: toolId, uid, code, name });
                    }
                );
            });

            });

        });

        });
    });
});



// POST /api_set_mode
app.post('/api_set_mode', express.json(), (req, res) => {
    console.log("📡 /api_set_mode chamado:", req.body);
    const mode = (req.body.mode || '').trim();
    const tool_id_body = req.body.tool_id ? parseInt(req.body.tool_id) : null;
    const user_id = req.body.user_id ? parseInt(req.body.user_id) : null;
    const category = (req.body.category || '').trim();

    if (!['retirar','devolver','idle','cadastrar'].includes(mode)) {
        return res.status(400).json({ error: 'invalid_mode' });
    }

    // If mode is 'cadastrar', create a placeholder tool record and link it to modes
    if (mode === 'cadastrar') {
 // create placeholder tool (uid must be unique -> generate temporary placeholder UID with retry)
        function generatePlaceholderUid() {
            return 'PH-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
        }

        const maxTries = 6;
        let createdToolId = null;

        (function tryInsertPlaceholder(attempt) {
            if (attempt > maxTries) {
                console.error('api_set_mode: failed to create unique placeholder after', maxTries, 'attempts');
                return res.status(500).json({ error: 'db_error', detail: 'unable_to_create_placeholder' });
        }

            const placeholderUid = generatePlaceholderUid();

            db.run(
                "INSERT INTO tools (uid, name, category, status) VALUES (?, ?, ?, ?)",
                [placeholderUid, '', category, 'placeholder'],
                function(err) {
                    if (err) {
                        // If uid has collision, retry
                        if (err.code === 'SQLITE_CONSTRAINT' && err.message.includes('uid')) {
                            console.warn('api_set_mode placeholder uid conflict, retrying.. attempt', attempt);
                            return tryInsertPlaceholder(attempt + 1);
                        }

                    console.error('api_set_mode (insert placeholder) err:', err);
                    return res.status(500).json({ error: 'db_error', detail: err.message });
                }

                createdToolId = this.lastID;

                // Insert mode
                db.run("INSERT INTO modes (mode, tool_id, user_id) VALUES (?, ?, ?)",
                    [mode, createdToolId, user_id],
                    function(err2) {
                        if (err2) {
                            console.error('api_set_mode (insert mode) err:', err2);
                            return res.status(500).json({ error: 'db_error', detail: err2.message });
                        }

                        return res.json({
                            ok: true,
                            mode_id: this.lastID,
                            mode,
                            tool_id: createdToolId,
                            category,
                            placeholderUid
                        });
                        }
                    );
                    }
                );

            })(1);
    }

    // default (retirar/devolver/idle) - original behavior
    db.run("INSERT INTO modes (mode, tool_id, user_id) VALUES (?, ?, ?)",
        [mode, tool_id_body, user_id],
        function(err) {
            if (err) {
                console.error('api_set_mode err:', err);
                return res.status(500).json({ error: 'db_error' });
            }
            return res.json({ ok: true, mode_id: this.lastID, mode, tool_id: tool_id_body, user_id });
    });
});


// --- GET /api_tool_uid?id=NN  (retorna uid da ferramenta pedida)
app.get('/api_tool_uid', (req, res) => {
    const id = parseInt(req.query.id);
    if (!id) return res.status(400).json({ error: 'missing_id' });
    db.get("SELECT uid FROM tools WHERE id = ?", [id], (err, row) => {
        if (err) {
            console.error('api_tool_uid err:', err);
            return res.status(500).json({ error: 'db_error' });
        }
        if (!row) return res.status(404).json({ error: 'not_found' });
        return res.json({ uid: row.uid });
        });
});

// --- POST /api_mode_complete  (Arduino chama quando conclui abrir a trava)
app.post('/api_mode_complete', express.json(), (req, res) => {
    const mode_id = req.body.mode_id ? parseInt(req.body.mode_id) : null;
  // apenas confirma recebimento; você pode aprimorar para marcar concluído em DB
    console.log('api_mode_complete received for mode_id:', mode_id);
    return res.json({ ok: true });
});



// --- INICIAR SERVIDOR ---
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

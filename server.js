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

// --- CONFIGURAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'front.html'));
});

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

// --- GET /api_categories  -> retorna lista de categorias ---
app.get('/api_categories', (req, res) => {
    db.all("SELECT id, name FROM categories ORDER BY name COLLATE NOCASE", [], (err, rows) => {
    if (err) {
        console.error(err);
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

// --- PUT /api_tools/:id -> atualizar nome / categoria / status de uma ferramenta ---
app.put('/api_tools/:id', express.json(), (req, res) => {
    const id = parseInt(req.params.id);
    const name = ('name' in req.body) ? req.body.name.trim() : null;
    const category = ('category' in req.body) ? req.body.category : null;
    const status = ('status' in req.body) ? req.body.status : null;

  // montar query dinamicamente
    const sets = [];
    const params = [];

    if (name !== null) { sets.push("name = ?"); params.push(name); }
    if (category !== null) { sets.push("category = ?"); params.push(category); }
    if (status !== null) { sets.push("status = ?"); params.push(status); }

    if (sets.length === 0) return res.status(400).json({ error: 'nothing_to_update' });

    params.push(id);
    const sql = `UPDATE tools SET ${sets.join(', ')} WHERE id = ?`;
    db.run(sql, params, function(err) {
        if (err) { console.error(err); return res.status(500).json({ error: 'update_failed' }); }
        res.json({ success: true, changes: this.changes });
    });
});

// Retorna o último placeholder criado pelo Arduino (name LIKE 'Ferramenta-%' ou category='N/D')
app.get('/api_last_placeholder', (req, res) => {
  // procura o último registro com categoria N/D ou nome começando com 'Ferramenta-'
    db.get(
        "SELECT id, uid, name, category, status FROM tools WHERE category = 'N/D' OR name LIKE 'Ferramenta-%' ORDER BY id DESC LIMIT 1",
        [],
        (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'db_error' });
        }
        if (!row) return res.json({ found: false });
        return res.json({
            found: true,
            id: row.id,
            uid: row.uid,
            name: row.name,
            category: row.category,
            status: row.status
        });
        }
    );
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

// --- GET /api_register_tag: cria ou retorna placeholder ao cadastrar tag via Arduino ---
app.get('/api_register_tag', (req, res) => {
    res.setHeader("Content-Type", "application/json");
    const uid_raw = (req.query.uid || '').trim();
    if (!uid_raw) return res.status(400).json({ error: 'missing_uid' });

    const uid = uid_raw.toUpperCase();

    console.log("[api_register_tag] uid:", uid);

    db.get("SELECT id, uid, name, category, status FROM tools WHERE uid = ?", [uid], (err, row) => {
        if (err) {
        console.error("api_register_tag db err:", err);
        return res.status(500).json({ error: 'db_error' });
        }

        if (row) {
        // já existe
        return res.json({
            status: 'exists',
            id: row.id,
            uid: row.uid,
            name: row.name,
            category: row.category,
            status_tool: row.status
        });
    }

    // cria placeholder
    const placeholder = "Ferramenta-" + uid;
    db.run(
        "INSERT INTO tools (uid, name, category, status) VALUES (?, ?, ?, ?)",
        [uid, placeholder, "N/D", "Disponível"],
        function(err) {
            if (err) {
            console.error("api_register_tag insert err:", err);
            return res.status(500).json({ error: 'insert_failed' });
            }
            console.log("[api_register_tag] created id:", this.lastID);
            return res.json({
            status: 'created',
            id: this.lastID,
            uid: uid,
            name: placeholder,
            category: 'N/D',
            status_tool: 'Disponível'
            });
        }
        );
    });
});

// --- GET /api_last_placeholder: retorna último placeholder (para polling do front) ---
app.get('/api_last_placeholder', (req, res) => {
  // Busca o mais recente com category = 'N/D' ou nome começando com 'Ferramenta-'
    db.get(
        "SELECT id, uid, name, category, status FROM tools WHERE category = 'N/D' OR name LIKE 'Ferramenta-%' ORDER BY id DESC LIMIT 1",
        [],
        (err, row) => {
        if (err) {
            console.error("api_last_placeholder err:", err);
            return res.status(500).json({ error: 'db_error' });
        }
        if (!row) return res.json({ found: false });
        return res.json({
            found: true,
            id: row.id,
            uid: row.uid,
            name: row.name,
            category: row.category,
            status: row.status
        });
        }
    );
});

// --- PUT /api_tools/:id -> atualiza name e category (usado pelo front para salvar placeholder) ---
app.put('/api_tools/:id', express.json(), (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });

    const name = (req.body.name || '').trim();
    const category = (req.body.category || '').trim();

    if (!name || !category) return res.status(400).json({ error: 'missing_fields' });

    db.run("UPDATE tools SET name = ?, category = ? WHERE id = ?", [name, category, id], function(err) {
        if (err) {
        console.error("api_tools PUT err:", err);
        return res.status(500).json({ error: 'update_failed' });
        }
        if (this.changes === 0) return res.status(404).json({ error: 'not_found' });
        return res.json({ success: true, changes: this.changes });
    });
});



// --- INICIAR SERVIDOR ---
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

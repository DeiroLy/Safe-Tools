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
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ success: false, message: 'Usuário e senha obrigatórios.' });

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro no servidor.' });
        if (!user) return res.status(401).json({ success: false, message: 'Usuário não encontrado.' });

        const valid = bcrypt.compareSync(password, user.password);
        if (!valid) return res.status(401).json({ success: false, message: 'Senha incorreta.' });

        res.json({ success: true, message: 'Login bem-sucedido!' });
    });
});

// Rota para registrar novo usuário
app.post('/users/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ success: false, message: 'Preencha usuário e senha.' });

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro no banco.' });
        if (row) return res.status(409).json({ success: false, message: 'Usuário já existe.' });

        const hash = bcrypt.hashSync(password, 10);
        db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hash], (err) => {
            if (err) return res.status(500).json({ success: false, message: 'Erro ao criar usuário.' });
            res.json({ success: true, message: 'Usuário cadastrado com sucesso!' });
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

// --- INICIAR SERVIDOR ---
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

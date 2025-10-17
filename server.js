// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'front.html'));
});
app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});
// --- Configuração do Banco de Dados SQLite ---
const db = new sqlite3.Database('./ferramentas.db', (err) => {
    if (err) {
        console.error("Erro ao abrir o banco de dados", err.message);
    } else {
        console.log("Conectado ao banco de dados SQLite.");
        // Criar tabelas se não existirem
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
                status TEXT DEFAULT 'Disponível' -- Disponível, Em uso, Emprestada
            );
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_id INTEGER,
                user_id INTEGER,
                action TEXT, -- Retirada (Uso), Retirada (Empréstimo), Devolução
                borrower_name TEXT,
                borrower_class TEXT,
                timestamp DATETIME DEFAULT (datetime('now', '-3 hours')),
                FOREIGN KEY(tool_id) REFERENCES tools(id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
        `, (err) => {
            if (err) console.error("Erro ao criar tabelas", err);
            // Inserir usuário padrão se não existir
            db.run(`INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)`, ['admin', '1234']);
        });
    }
});
// Variável para controlar a trava
let unlockCommand = false;

// --- Rotas da API ---

// Rota de Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro no servidor.' });
        if (row) {
            unlockCommand = true; // Ativa o comando para destravar
            res.json({ success: true, message: 'Login bem-sucedido!' });
        } else {
            res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
        }
    });
});

// Rotas de Ferramentas
app.get('/tools', (req, res) => {
    db.all(`SELECT * FROM tools ORDER BY category, name`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Registrar nova ferramenta (via UID do Arduino)
app.post('/tools/register', (req, res) => {
    const { uid, name, category } = req.body;
    if (!uid || !name) return res.status(400).json({ message: 'UID e Nome são obrigatórios.' });

    db.run(`INSERT INTO tools (uid, name, category) VALUES (?, ?, ?)`, [uid, name, category], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: 'Erro ao cadastrar. UID já pode existir.' });
        }
        res.json({ success: true, message: `Ferramenta '${name}' cadastrada com sucesso!`, id: this.lastID });
    });
});

// --- ROTA PARA REMOVER FERRAMENTA ---
app.delete('/tools/:id', (req, res) => {
    const { id } = req.params;

    db.run(`DELETE FROM tools WHERE id = ?`, [id], function(err) {
        if (err) {
            console.error("Erro ao remover ferramenta:", err.message);
            res.status(500).json({ error: "Erro ao remover ferramenta" });
        } else if (this.changes === 0) {
            res.status(404).json({ error: "Ferramenta não encontrada" });
        } else {
            console.log(`Ferramenta ${id} removida com sucesso.`);
            res.json({ message: "Ferramenta removida com sucesso" });
        }
    });
});

// Devolver ferramenta (via UID do Arduino)
app.post('/tools/return', (req, res) => {
    const { uid } = req.body;
    db.get(`SELECT id FROM tools WHERE uid = ?`, [uid], (err, tool) => {
        if (err || !tool) return res.status(404).json({ success: false, message: 'Ferramenta não encontrada.' });
        
        db.run(`UPDATE tools SET status = 'Disponível' WHERE id = ?`, [tool.id], (err) => {
            if (err) return res.status(500).json({ success: false, message: 'Erro ao atualizar status.' });
            
            // Adicionar log de devolução (user_id 1 = admin, simplificado)
            db.run(`INSERT INTO logs (tool_id, user_id, action) VALUES (?, ?, ?)`, [tool.id, 1, 'Devolução']);
            res.json({ success: true, message: 'Ferramenta devolvida com sucesso!' });
        });
    });
});

// Atualizar status da ferramenta (Uso / Empréstimo)
app.put('/tools/:id/status', (req, res) => {
    const { status, borrower_name, borrower_class } = req.body;
    const { id } = req.params;
    
    db.run(`UPDATE tools SET status = ? WHERE id = ?`, [status, id], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao atualizar status.' });
        
        // Adicionar log
        const action = status === 'Em uso' ? 'Retirada (Uso)' : 'Retirada (Empréstimo)';
        db.run(`INSERT INTO logs (tool_id, user_id, action, borrower_name, borrower_class) VALUES (?, ?, ?, ?, ?)`, 
               [id, 1, action, borrower_name, borrower_class]); // user_id = 1 (admin)
        
        res.json({ success: true, message: `Status da ferramenta atualizado para '${status}'.` });
    });
});

// Rotas de Histórico
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

// Rota Arduino
app.get('/arduino/status', (req, res) => {
    if (unlockCommand) {
        unlockCommand = false;
        res.send("UNLOCK");
    } else {
        res.send("OK");
    }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});
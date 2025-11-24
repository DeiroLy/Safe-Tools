// migrate_db.js
// Uso: node migrate_db.js
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve(__dirname, 'ferramentas.db'); // ajuste se necessário
const BACKUP_PATH = DB_PATH + '.bak';

if (!fs.existsSync(DB_PATH)) {
    console.error('Arquivo de banco não encontrado em:', DB_PATH);
    process.exit(1);
}

// 1) backup
if (!fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(DB_PATH, BACKUP_PATH);
    console.log('Backup criado em:', BACKUP_PATH);
} else {
    console.log('Backup já existe em:', BACKUP_PATH);
}

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Erro ao abrir DB:', err);
        process.exit(1);
    }
});

// wrapper promise para executar SQL sequencialmente
function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function getAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

async function migrate() {
    try {
        // 2) criar tables categories e modes (se não existirem)
        await runAsync(`
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE
            );
        `);
        console.log('Tabela categories ok');

        await runAsync(`
            CREATE TABLE IF NOT EXISTS modes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mode TEXT,
                tool_id INTEGER,
                user_id INTEGER,
                created_at DATETIME DEFAULT (datetime('now'))
            );
        `);
        console.log('Tabela modes ok');

        // 3) verificar existência da coluna "code" na tabela tools
        const colInfo = await getAsync("PRAGMA table_info('tools');");
        // colInfo é apenas a primeira linha; vamos buscar todas as colunas
        const cols = await new Promise((resolve, reject) => {
            db.all("PRAGMA table_info('tools');", (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });

        const hasCode = cols.some(c => c.name && c.name.toLowerCase() === 'code');

        if (!hasCode) {
            console.log('Coluna "code" não existe — adicionando...');
            await runAsync("ALTER TABLE tools ADD COLUMN code TEXT;");
            console.log('Coluna "code" adicionada com sucesso.');
        } else {
            console.log('Coluna "code" já existe — nada a fazer.');
        }

        // 4) popular categories padrão (opcional)
        const categories = ['AUT', 'ELE', 'PNEU', 'GEN'];
        for (const c of categories) {
            await runAsync("INSERT OR IGNORE INTO categories(name) VALUES (?)", [c]);
        }
        console.log('Categorias padrão inseridas/confirmadas.');

        console.log('Migração finalizada com sucesso.');
        db.close();
        process.exit(0);
    } catch (err) {
        console.error('Erro na migração:', err);
        db.close();
        process.exit(1);
    }
}

migrate();

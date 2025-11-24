// arduino-proxy.js
// Pequeno proxy HTTP para aceitar requests do Arduino (HTTP) e encaminhar para o backend (HTTP ou HTTPS).
// Uso:
// 1) ajuste TARGET_BASE (ex: 'https://safe-tools.onrender.com' ou 'http://localhost:3000')
// 2) npm init -y
// 3) npm install express node-fetch@2
// 4) node arduino-proxy.js
//
// O proxy escuta na porta PROXY_PORT e repassa requisições GET /api_register_tag?uid=... para TARGET_BASE + /api_register_tag?uid=...
// Também encaminha POST e outros paths simples (preserva querystring).
//
// Nota: use node-fetch v2 (node-fetch@2) para compatibilidade via require()

// arduino-proxy.js
// Proxy HTTP → HTTPS usando fetch nativo do Node (Node 18+)
// Funciona com Node 22 SEM instalar node-fetch.

// arduino-proxy.js  (corrigido)
// Proxy HTTP -> HTTPS usando fetch nativo (Node 18+).
// Usa app.use(...) para evitar erro do path-to-regexp com '*'.
//
// Uso:
//   set TARGET_BASE=https://safe-tools.onrender.com
//   set PROXY_PORT=3001
//   node arduino-proxy.js

const express = require('express');
const { URL } = require('url');
const app = express();

const PROXY_PORT = process.env.PROXY_PORT || 3001;
const TARGET_BASE = process.env.TARGET_BASE || 'https://safe-tools.onrender.com';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function buildTargetUrl(originalUrl) {
    return new URL(originalUrl, TARGET_BASE).toString();
}

// middleware universal: recebe todas as requisições e repassa
app.use(async (req, res) => {
    try {
        const originalUrl = req.originalUrl || req.url || '/';
        const targetUrl = buildTargetUrl(originalUrl);
        console.log(`[proxy] ${req.method} ${originalUrl} -> ${targetUrl}`);

        if (req.method === 'GET') {
        const response = await fetch(targetUrl, { method: 'GET' });
        const text = await response.text();
        res.status(response.status).send(text);
        return;
        }

        if (req.method === 'POST') {
        // repassa body JSON
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body || {})
        });
        const text = await response.text();
        res.status(response.status).send(text);
        return;
        }

        // outros métodos (PUT, DELETE, etc.) se necessário:
        if (['PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: { 'Content-Type': req.get('Content-Type') || 'application/json' },
            body: req.method === 'GET' ? undefined : JSON.stringify(req.body || {})
        });
        const text = await response.text();
        res.status(response.status).send(text);
        return;
        }

        res.status(405).send('Method Not Allowed');
    } catch (err) {
        console.error('[proxy] erro ao encaminhar:', err);
        res.status(502).json({ error: 'proxy_error', detail: err.message });
    }
});

app.listen(PROXY_PORT, () => {
    console.log(`✔ Proxy rodando na porta ${PROXY_PORT}`);
    console.log(`✔ Encaminhando para: ${TARGET_BASE}`);
});

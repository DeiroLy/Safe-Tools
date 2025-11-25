/* Demo mock server — sobrescrito automaticamente pelo script do ChatGPT */
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(bodyParser.json());
app.use(express.static(__dirname)); // serve front.html and assets

let users = [
  { id: 1, username: 'admin', password: '1234' }
];
let nextUserId = 2;

let tools = [
  { id: 1, uid: '101', name: 'Multímetro', category: 'Eletrônica', status: 'Emprestada' },
  { id: 2, uid: '102', name: 'Paquímetro', category: 'Medição', status: 'Disponível' },
  { id: 3, uid: '201', name: 'Escalímetro', category: 'Medição', status: 'Em uso' }
];
let nextToolId = 4;

let logs = [
  { id: 1, tool_id: 2, user_id: 1, action: 'retirada', borrower_name: 'Aluno A', borrower_class: '1A', timestamp: new Date().toISOString() }
];
let nextLogId = 2;

let categories = ['Eletrônica', 'Medição', 'Mecânica', 'Oficina'];

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'front.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, message: 'Usuário e senha obrigatórios.' });
  const u = users.find(x => x.username === username);
  if (!u) return res.status(401).json({ success: false, message: 'Usuário não encontrado.' });
  if (u.password !== password) return res.status(401).json({ success: false, message: 'Senha incorreta.' });
  return res.json({ success: true, message: 'Login bem-sucedido.', user: { id: u.id, username: u.username } });
});

app.post('/users/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, message: 'Usuário e senha obrigatórios.' });
  if (users.find(u => u.username === username)) return res.status(409).json({ success: false, message: 'Usuário já existe.' });
  const u = { id: nextUserId++, username, password };
  users.push(u);
  return res.json({ success: true, message: 'Usuário registrado com sucesso.' });
});

app.get('/tools', (req, res) => {
  res.json(tools);
});

app.delete('/tools/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idx = tools.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Ferramenta não encontrada.' });
  tools.splice(idx, 1);
  return res.json({ success: true, message: 'Ferramenta removida.' });
});

app.put('/api_tools/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const t = tools.find(x => x.id === id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  const { name, category, status } = req.body || {};
  if (name) t.name = name;
  if (category) t.category = category;
  if (status) t.status = status;
  return res.json({ success: true, changes: 1 });
});

app.get('/logs', (req, res) => {
  const enriched = logs.map(l => {
    const tool = tools.find(t => t.id === l.tool_id) || {};
    const user = users.find(u => u.id === l.user_id) || {};
    return {
      ...l,
      name: tool.name || '',
      username: user.username || ''
    };
  });
  res.json(enriched);
});

app.get('/api_categories', (req, res) => {
  res.json({ categories: categories.map(c => ({ id: c, name: c }))});
});

app.put('/tools/:id/status', (req, res) => {
  const id = parseInt(req.params.id);
  const t = tools.find(x => x.id === id);
  if (!t) return res.status(404).json({ success: false, message: 'Ferramenta não encontrada.' });
  const { status, borrower_name, borrower_class } = req.body || {};
  if (status) t.status = status;
  logs.push({ id: nextLogId++, tool_id: id, user_id: 1, action: status, borrower_name: borrower_name || null, borrower_class: borrower_class || null, timestamp: new Date().toISOString()});
  return res.json({ success: true, message: 'Status atualizado.' });
});

app.post('/tools/return', (req, res) => {
  const { uid } = req.body || {};
  if (!uid) return res.status(400).json({ success: false, message: 'missing uid' });
  const t = tools.find(x => x.uid === uid || String(x.id) === String(uid));
  if (!t) return res.status(404).json({ success: false, message: 'Ferramenta não encontrada.' });
  t.status = 'Disponível';
  logs.push({ id: nextLogId++, tool_id: t.id, user_id: 1, action: 'devolucao', borrower_name: null, borrower_class: null, timestamp: new Date().toISOString()});
  return res.json({ success: true, message: 'Devolução registrada.' });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Demo offline server running on http://localhost:${PORT}`);
  console.log('Admin user: admin / 1234');
});

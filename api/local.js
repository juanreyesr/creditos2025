// api/local.js
const express = require('express');
const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, env: 'local', timestamp: Date.now() });
});

// Otras rutas locales que quieras testear:
app.get('*', (req, res) => {
  res.json({ message: 'Local dev server', path: req.path });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Local server listening on http://localhost:${PORT}`);
});

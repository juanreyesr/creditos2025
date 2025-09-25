// api/index.js
const express = require('express');
const app = express();

app.use(express.json());

// Rutas de tu app (ejemplos)
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'creditos', timestamp: Date.now() });
});

// Ejemplo de endpoint principal (sirve tu SPA/API)
app.get('*', (req, res) => {
  res.json({ message: 'Directorio de psicólogos – API/Router activo', path: req.path });
});

// 👉 Exporta el handler para Vercel (SIN app.listen)
module.exports = (req, res) => app(req, res);

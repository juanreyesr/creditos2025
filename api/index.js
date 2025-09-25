const express = require('express');
const app = express();

app.use(express.json());

// Rutas de negocio (ejemplos)
app.get('/health', (req, res) => {
res.json({ ok: true, service: 'creditos', runtime: 'vercel-serverless', ts: Date.now() });
});

app.get('/psicologos', (req, res) => {
const { especialidad, minPrecio, maxPrecio, lat, lng, radioKm } = req.query;
res.json({ filtros: { especialidad, minPrecio, maxPrecio, lat, lng, radioKm }, resultados: [] });
});

app.get('/instituciones', (req, res) => {
res.json({ instituciones: [] });
});

// Catch-all (dejar al final)
app.get('*', (req, res) => {
res.json({ message: 'Directorio de psicólogos – API/Router activo', path: req.path });
});

// Exportar handler para Vercel (SIN app.listen)
module.exports = (req, res) => app(req, res);

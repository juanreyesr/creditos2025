// Helper para leer parámetros ?c=...&h=...
function getParam(key) {
  return new URLSearchParams(location.search).get(key);
}

function renderMsg(html) {
  const box = document.getElementById('result');
  box.innerHTML = `<div style="padding:10px">${html}</div>`;
}

function renderTable(row) {
  const box = document.getElementById('result');
  box.innerHTML = `
    <table class="table"><tbody>
      <tr><th>Correlativo</th><td>${row.correlativo}</td></tr>
      <tr><th>Nombre</th><td>${row.nombre}</td></tr>
      <tr><th>Actividad</th><td>${row.actividad}</td></tr>
      <tr><th>Institución</th><td>${row.institucion}</td></tr>
      <tr><th>Tipo</th><td>${row.tipo}</td></tr>
      <tr><th>Fecha</th><td>${row.fecha}</td></tr>
      <tr><th>Horas</th><td>${row.horas}</td></tr>
      <tr><th>Créditos</th><td>${row.creditos}</td></tr>
    </tbody></table>
    <p class="muted" style="padding:8px 10px">Constancia válida encontrada en la base de datos.</p>
  `;
}

(async function main() {
  const c = getParam('c');
  const h = getParam('h');

  if (!c || !h) {
    renderMsg('<strong>Parámetros inválidos.</strong> Debes acceder con un enlace que incluya <code>?c=</code> y <code>&h=</code>.');
    return;
  }

  // Crear cliente de Supabase (usa variables globales definidas en index.html o en este archivo)
  const url = window.NEXT_PUBLIC_SUPABASE_URL || window.SB_URL || 'https://ilyospunwucdojrnfgti.supabase.co';
  const key = window.NEXT_PUBLIC_SUPABASE_ANON_KEY || window.SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlseW9zcHVud3VjZG9qcm5mZ3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4Mjk5NzYsImV4cCI6MjA3NDQwNTk3Nn0.gernmW9y1zuvjPCOFo2ie2_2xFIIRKeZWybft7eeoD4';
  if (!url || !key) {
    renderMsg('No se encontraron credenciales de Supabase. Define <code>window.SB_URL</code> y <code>window.SB_KEY</code>.');
    return;
  }
  const supabase = window.supabase.createClient(url, key);

  // Llamar a la función RPC pública para verificar
  try {
    const { data, error } = await supabase.rpc('verify_constancia', { c, h });
    if (error) {
      console.error(error);
      renderMsg('Ocurrió un error al verificar la constancia.');
      return;
    }
    if (!data || data.length === 0) {
      renderMsg('<strong>No se encontró una constancia válida</strong> para los parámetros proporcionados.');
      return;
    }
    renderTable(data[0]);
  } catch (e) {
    console.error(e);
    renderMsg('Error inesperado durante la verificación.');
  }
})();

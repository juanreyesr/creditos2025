function getParams() {
  const u = new URLSearchParams(location.search);
  return { c: u.get('c') || '', h: u.get('h') || '' };
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
function getSupabase() {
  try {
    if (!window.supabase || !window.SB_URL || !window.SB_KEY) return null;
    if (!getSupabase._c) getSupabase._c = window.supabase.createClient(window.SB_URL, window.SB_KEY);
    return getSupabase._c;
  } catch { return null; }
}

async function verify(c, h) {
  const box = document.getElementById('result');
  const sb = getSupabase();
  if (!sb) { renderMsg('No hay credenciales de Supabase.'); return; }
  if (!c || !h) { renderMsg('Debes ingresar correlativo y hash.'); return; }

  box.textContent = 'Verificando…';
  try {
    const { data, error } = await sb.rpc('verify_constancia', { c, h });
    if (error) { console.error(error); renderMsg('Ocurrió un error al verificar la constancia.'); return; }
    if (!data || data.length === 0) { renderMsg('<strong>No se encontró una constancia válida</strong> para esos datos.'); return; }
    renderTable(data[0]);
  } catch (e) {
    console.error(e);
    renderMsg('Error inesperado durante la verificación.');
  }
}

document.getElementById('verifyForm')?.addEventListener('submit', (e)=>{
  e.preventDefault();
  const c = document.getElementById('vc').value.trim();
  const h = document.getElementById('vh').value.trim();
  verify(c, h);
});

document.getElementById('useQuery')?.addEventListener('click', ()=>{
  const { c, h } = getParams();
  document.getElementById('vc').value = c || '';
  document.getElementById('vh').value = h || '';
  if (c && h) verify(c, h);
});

// Autocompletar si viene desde QR
window.addEventListener('DOMContentLoaded', ()=>{
  const { c, h } = getParams();
  if (c) document.getElementById('vc').value = c;
  if (h) document.getElementById('vh').value = h;
  if (c && h) verify(c, h);
});

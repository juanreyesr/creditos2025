/* =======================================================
   Supabase lazy init
======================================================= */
function getSupabaseClient() {
  try {
    const hasSDK = !!window.supabase && typeof window.supabase.createClient === 'function';
    const url = (window?.ENV?.SUPABASE_URL) ||
                window.NEXT_PUBLIC_SUPABASE_URL ||
                window.__env?.SUPABASE_URL ||
                window.SB_URL ||
                (typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_SUPABASE_URL : null);
    const key = (window?.ENV?.SUPABASE_ANON) ||
                window.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
                window.__env?.SUPABASE_ANON_KEY ||
                window.SB_KEY ||
                (typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY : null);
    if (!hasSDK || !url || !key) return null;
    if (!getSupabaseClient._client) {
      console.log('[SB] creating client with', url);
      getSupabaseClient._client = window.supabase.createClient(url, key);
    }
    return getSupabaseClient._client;
  } catch (e) {
    console.error('Error creando Supabase client:', e);
    return null;
  }
}

/* =======================================================
   Config/Utils
======================================================= */
const ADMIN_PASSWORD = "CAEDUC2025";
const ADMIN_SESSION_MIN = 10;
const MAX_FILE_MB = 10;
const ALLOWED_MIME = ["application/pdf","image/png","image/jpeg","image/jpg"];

function sanitize(str){
  return String(str || "").replace(/[&<>\"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
}
function showToast(msg, type="info"){
  const el = document.getElementById('toast');
  if(!el){ alert(msg); return; }
  el.textContent = msg;
  el.style.borderColor = type==="error"?"#f43f5e": type==="warn"?"#f59e0b":"#243055";
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 2800);
}
function phoneValidGT(v){ return /^(?:\+?502)?\s?\d{8}$/.test(v.trim()); }
function withinFiveYears(dateStr){
  const d=new Date(dateStr), now=new Date();
  if(isNaN(d) || d>now) return false;
  const past=new Date(); past.setFullYear(now.getFullYear()-5);
  return d>=past;
}
function calcCreditos(h){ const n=Number(h); if(!isFinite(n)||n<=0) return 0; return Math.round((n/16)*100)/100; }
function hashSimple(text){ let h=0; for(let i=0;i<text.length;i++){ h=(h<<5)-h + text.charCodeAt(i); h|=0; } return Math.abs(h).toString(36); }

/* =======================================================
   DOM refs
======================================================= */
const form = document.getElementById('registroForm');
const horasEl = document.getElementById('horas');
const creditosEl = document.getElementById('creditos');
const tablaBody = document.querySelector('#tablaRegistros tbody');
const obsEl = document.getElementById('observaciones');
const fechaEl = document.getElementById('fecha');

const upZone = document.getElementById('uploader');
const fileInput = document.getElementById('archivo');
const browseBtn = document.getElementById('browseBtn');
const preview = document.getElementById('preview');
let fileRef = null;

const adminModal = document.getElementById('adminModal');
const openAdminBtn = document.getElementById('openAdminBtn');
const closeAdmin = document.getElementById('closeAdmin');
const adminAuth = document.getElementById('adminAuth');
const adminBody = document.getElementById('adminBody');
const adminPass = document.getElementById('adminPass');
const adminLogin = document.getElementById('adminLogin');
const exportCSVBtn = document.getElementById('exportCSV');
const exportXLSXBtn = document.getElementById('exportXLSX');
const clearDataBtn = document.getElementById('clearData');
const adminTbody = document.querySelector('#adminTable tbody');
const exportStatus = document.getElementById('exportStatus');

// Auth modal
const authBtn = document.getElementById('authBtn');
const authModal = document.getElementById('authModal');
const closeAuth = document.getElementById('closeAuth');
const authEmail = document.getElementById('authEmail');
const authPass = document.getElementById('authPass');
const doLogin = document.getElementById('doLogin');
const doSignup = document.getElementById('doSignup');
const authState = document.getElementById('authState');

/* =======================================================
   Inicialización UI + Auth
======================================================= */
(function(){
  const now=new Date();
  if(fechaEl) fechaEl.max = now.toISOString().slice(0,10);
  try { adminModal?.setAttribute('aria-hidden','true'); authModal?.setAttribute('aria-hidden','true'); } catch {}
})();

if (horasEl && creditosEl) {
  horasEl.addEventListener('input', ()=> creditosEl.value = calcCreditos(horasEl.value));
}

/* ---------- Uploader (robusto + logs) ---------- */
browseBtn?.addEventListener('click', ()=>{
  if(!fileInput){ console.warn('[uploader] fileInput no encontrado'); return; }
  fileInput.click();
});
upZone?.addEventListener('click', (e)=>{
  if(!fileInput){ console.warn('[uploader] fileInput no encontrado'); return; }
  if (e.target && e.target.id === 'browseBtn') return;
  fileInput.click();
});
['dragenter','dragover'].forEach(ev=> upZone?.addEventListener(ev, e=>{
  e.preventDefault(); if(upZone) upZone.style.borderColor='#60a5fa';
}));
['dragleave','drop'].forEach(ev=> upZone?.addEventListener(ev, e=>{
  e.preventDefault(); if(upZone) upZone.style.borderColor='#334155';
  if(ev==='drop'){ handleFile(e.dataTransfer.files?.[0]||null); }
}));
fileInput?.addEventListener('change', (e)=> handleFile(e.target.files?.[0]||null));
upZone?.addEventListener('keydown', (e)=>{
  if(e.key==='Enter' || e.key===' '){ e.preventDefault(); fileInput?.click(); }
});

function handleFile(file){
  if(!preview) return;
  preview.innerHTML=''; fileRef=null; if(!file) return;
  if(!ALLOWED_MIME.includes(file.type)) { showToast('Tipo no permitido. Solo PDF/JPG/PNG.', 'error'); return; }
  const mb=file.size/1024/1024; if(mb>MAX_FILE_MB){ showToast('Archivo supera 10 MB.', 'error'); return; }
  fileRef=file;
  console.log('[uploader] file ok:', file.name, file.type, file.size);
  if(file.type==='application/pdf'){
    const url=URL.createObjectURL(file);
    const emb=document.createElement('embed');
    emb.src=url; emb.type='application/pdf'; emb.className='pdf';
    preview.appendChild(emb);
  } else {
    const img=document.createElement('img');
    img.className='thumb'; img.alt='Vista previa'; img.src=URL.createObjectURL(file);
    preview.appendChild(img);
  }
}

/* ---------- Auth UI ---------- */
function openModal(m){ m?.setAttribute('aria-hidden','false'); }
function closeModal(m){ m?.setAttribute('aria-hidden','true'); if(authState) authState.textContent='—'; }

authBtn?.addEventListener('click', ()=>{
  const sb = getSupabaseClient();
  if(!sb){ showToast('No se pudo inicializar autenticación (Supabase).', 'error'); return; }
  openModal(authModal);
});
closeAuth?.addEventListener('click', ()=> closeModal(authModal));
authPass?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin?.click(); });

// SIGNUP con redirect explícito
doSignup?.addEventListener('click', async ()=>{
  const sb = getSupabaseClient();
  if(!sb){ showToast('Supabase no disponible.', 'error'); return; }
  if(authState) authState.textContent = 'Creando cuenta...';

  const email = (authEmail?.value||'').trim();
  const password = authPass?.value || '';
  const redirectTo = `${location.origin}/auth-callback.html`;

  const { error } = await sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo }
  });

  if(error){ if(authState) authState.textContent='Error: '+error.message; return; }
  if(authState) authState.textContent='Te enviamos un correo de verificación. Abre el enlace para activar tu cuenta.';
});

// LOGIN
doLogin?.addEventListener('click', async ()=>{
  const sb = getSupabaseClient();
  if(!sb){ showToast('Supabase no disponible.', 'error'); return; }
  if(authState) authState.textContent = 'Ingresando...';
  const { error } = await sb.auth.signInWithPassword({ email: (authEmail?.value||'').trim(), password: authPass?.value || '' });
  if(error){ if(authState) authState.textContent='Error: '+error.message; return; }
  if(authState) authState.textContent='OK';
  closeModal(authModal); await loadAndRender();
});

const sbForSession = getSupabaseClient();
sbForSession?.auth.onAuthStateChange(async (_evt, session)=>{
  if(authBtn) authBtn.textContent = session?.user ? 'Mi sesión' : 'Iniciar sesión';
});

/* =======================================================
   Datos (Supabase)
======================================================= */
async function loadAndRender(){
  const sb = getSupabaseClient();
  if(!sb) return;
  const { data: session } = await sb.auth.getSession();
  if(!session?.session){ if(tablaBody) tablaBody.innerHTML=''; return; }
  const { data, error } = await sb.from('registros').select('*').order('created_at', { ascending:false });
  if(error){ console.error(error); showToast('No se pudieron cargar registros','error'); return; }
  renderTabla(data);
}

function renderTabla(rows){
  if(!tablaBody) return;
  tablaBody.innerHTML='';
  for(const r of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sanitize(r.correlativo)}</td>
      <td>${sanitize(r.fecha)}</td>
      <td title="${sanitize(r.actividad)}">${sanitize(r.actividad.slice(0,30))}${r.actividad.length>30?'…':''}</td>
      <td>${r.horas}</td>
      <td>${r.creditos}</td>
      <td><button class="btn" data-id="${r.id}" data-action="pdf" type="button">PDF</button></td>`;
    tablaBody.appendChild(tr);
  }
}

tablaBody?.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button[data-action="pdf"]');
  if(!btn) return;
  const id = btn.getAttribute('data-id');
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  const { data: rows, error } = await sb.from('registros').select('*').eq('id', id).limit(1);
  if(error || !rows?.length) return showToast('Registro no disponible','error');
  await generarConstanciaPDF(rows[0]).catch(()=> showToast('Error al generar PDF','error'));
});

/* =======================================================
   Submit (insert en Supabase + Storage)
======================================================= */
form?.addEventListener('submit', async (e)=>{
  e.preventDefault();

  const sb = getSupabaseClient();
  if(!sb){ showToast('Supabase no está disponible. Verifica scripts/credenciales.', 'error'); return; }

  const { data: s, error: sesErr } = await sb.auth.getSession();
  if(sesErr || !s?.session){ showToast('Inicia sesión para registrar.', 'error'); return; }
  const user = s.session.user;

  // Validaciones
  const nombre = (form.nombre?.value||'').trim();
  const telefono = (form.telefono?.value||'').trim();
  const colegiadoNumero = (form.colegiadoNumero?.value||'').trim();
  const colegiadoActivo = form.colegiadoActivo?.value;
  const actividad = (form.actividad?.value||'').trim();
  const institucion = (form.institucion?.value||'').trim();
  const tipo = form.tipo?.value;
  const fecha = form.fecha?.value;
  const horas = Number(form.horas?.value);
  const observaciones = (obsEl?.value||'').trim();

  if(!nombre || !telefono || !colegiadoNumero || !colegiadoActivo || !actividad || !institucion || !tipo || !fecha || !horas){
    showToast('Complete todos los campos obligatorios (*), incluido el número de colegiado.', 'error'); return;
  }
  if(!phoneValidGT(telefono)){ showToast('Teléfono inválido (+502 ########)', 'error'); return; }
  if(!withinFiveYears(fecha)){ showToast('Fecha inválida (no futura, ≤ 5 años)', 'error'); return; }
  if(!(horas>=0.5 && horas<=200)){ showToast('Horas fuera de rango (0.5 a 200).', 'error'); return; }
  if(observaciones.length>250){ showToast('Observaciones exceden 250 caracteres.', 'error'); return; }
  if(fileRef){
    if(!ALLOWED_MIME.includes(fileRef.type)){ showToast('Archivo no permitido.', 'error'); return; }
    const sizeMB = fileRef.size/1024/1024; if(sizeMB>MAX_FILE_MB){ showToast('Archivo supera 10 MB.', 'error'); return; }
  }

  // Correlativo atómico
  const { data: corrData, error: corrErr } = await sb.rpc('next_correlativo');
  if(corrErr || !corrData){ showToast('No se pudo obtener correlativo', 'error'); return; }
  const correlativo = corrData;

  const creditos = calcCreditos(horas);
  const hash = hashSimple(`${correlativo}|${nombre}|${telefono}|${fecha}|${horas}|${creditos}`);

  // Subir archivo (opcional)
  let archivo_url = null, archivo_mime = null;
  if(fileRef){
    const safeName = fileRef.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const path = `${user.id}/${correlativo}-${safeName}`;
    const { error: upErr } = await sb.storage.from('comprobantes').upload(path, fileRef, { contentType: fileRef.type, upsert:false });
    if(upErr){ showToast('No se pudo subir el archivo','error'); return; }
    archivo_url = path; archivo_mime = fileRef.type;
  }

  // Insert
  const payload = {
    usuario_id: user.id,
    correlativo,
    nombre, telefono, colegiado_numero: colegiadoNumero, colegiado_activo: colegiadoActivo,
    actividad, institucion, tipo, fecha,
    horas, creditos, observaciones,
    archivo_url, archivo_mime,
    hash
  };

  const { data: inserted, error: insErr } = await sb.from('registros').insert(payload).select().single();
  if(insErr){ console.error(insErr); showToast('No se pudo guardar el registro','error'); return; }

  // PDF
  await generarConstanciaPDF(inserted).catch(()=> showToast('Error al generar PDF','error'));
  showToast('Registro guardado y constancia generada.');

  // Reset controlado
  form.reset(); if(preview) preview.innerHTML=''; if(creditosEl) creditosEl.value='';
  fileRef = null;

  loadAndRender();
});

/* =======================================================
   Panel Admin (local; exporta registros del usuario)
======================================================= */
function openAdmin(){ adminModal?.setAttribute('aria-hidden','false'); if(adminPass) adminPass.value=''; }
function closeAdminFn(){ adminModal?.setAttribute('aria-hidden','true'); if(adminBody) adminBody.hidden=true; if(adminAuth) adminAuth.hidden=false; if(adminPass) adminPass.value=''; }
openAdminBtn?.addEventListener('click', openAdmin);
closeAdmin?.addEventListener('click', closeAdminFn);
window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeAdminFn(); if(e.key.toLowerCase()==='a' && e.shiftKey && e.ctrlKey){ openAdmin(); } });

let adminSessionEnd = 0;
function startAdminSession(){ adminSessionEnd = Date.now() + ADMIN_SESSION_MIN*60*1000; }
function adminSessionValid(){ return Date.now() < adminSessionEnd; }

adminLogin?.addEventListener('click', async (ev)=>{
  ev.preventDefault();
  if((adminPass?.value||'').trim() !== ADMIN_PASSWORD){ showToast('Contraseña incorrecta','error'); return; }
  if(adminAuth) adminAuth.hidden = true; if(adminBody) adminBody.hidden = false; startAdminSession(); await renderAdmin(); showToast('Sesión admin iniciada','ok');
});

async function renderAdmin(){
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  const { data: rows, error } = await sb.from('registros').select('*').order('created_at', { ascending:false });
  if(error){ if(exportStatus) exportStatus.textContent='Error al cargar'; return; }
  if(!adminTbody) return;
  adminTbody.innerHTML='';
  for(const r of rows){
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${sanitize(r.correlativo)}</td>
      <td>${sanitize(r.nombre)}</td>
      <td>${sanitize(r.telefono)}</td>
      <td>${sanitize(r.colegiado_numero||'')}</td>
      <td>${sanitize(r.colegiado_activo)}</td>
      <td>${sanitize(r.actividad)}</td>
      <td>${sanitize(r.institucion)}</td>
      <td>${sanitize(r.tipo)}</td>
      <td>${sanitize(r.fecha)}</td>
      <td>${r.horas}</td>
      <td>${r.creditos}</td>
      <td>${r.archivo_url||''}</td>
      <td>${sanitize(r.hash)}</td>
      <td>${r.exportado? 'Sí':'No'}</td>`;
    adminTbody.appendChild(tr);
  }
}

setInterval(()=>{ if(!adminBody?.hidden && !adminSessionValid()){ showToast('Sesión admin expirada','warn'); if(adminBody) adminBody.hidden=true; if(adminAuth) adminAuth.hidden=false; if(adminPass) adminPass.value=''; } }, 2000);

exportCSVBtn?.addEventListener('click', async ()=>{
  if(adminBody?.hidden || !adminSessionValid()) return showToast('Inicie sesión admin','error');
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  const { data: rows } = await sb.from('registros').select('*').order('created_at',{ascending:false});
  if(!rows?.length) return showToast('Sin registros','warn');
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')].concat(
    rows.map(o=> `"${headers.map(h=>String(o[h]??'').replace(/"/g,'""')).join('","')}"`)
  ).join('\n');
  const blob = new Blob(["\ufeff"+csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`registros_cpg_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
  if(exportStatus) exportStatus.textContent='CSV descargado';
});

exportXLSXBtn?.addEventListener('click', async ()=>{
  if(adminBody?.hidden || !adminSessionValid()) return showToast('Inicie sesión admin','error');
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  const { data: rows } = await sb.from('registros').select('*').order('created_at',{ascending:false});
  if(!rows?.length) return showToast('Sin registros','warn');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registros');
  XLSX.writeFile(wb, `registros_cpg_${new Date().toISOString().slice(0,10)}.xlsx`);
  if(exportStatus) exportStatus.textContent='Excel descargado';
});

clearDataBtn?.addEventListener('click', ()=>{
  showToast('Con Supabase, “borrar todo” no está habilitado aquí. Usa la consola si lo necesitas.','warn');
});

/* =======================================================
   PDF + QR (robusto)
======================================================= */
async function generarConstanciaPDF(rec){
  if (!window.jspdf || !window.jspdf.jsPDF) {
    console.error('jsPDF no está disponible.'); showToast('jsPDF no cargó.', 'error'); throw new Error('jsPDF missing');
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'pt', format:'a4' });
  const pad = 48;

  doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text('Constancia de Registro de Créditos Académicos', pad, 64);
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.text('Colegio de Psicólogos de Guatemala — Artículo 16: 1 crédito = 16 horas', pad, 84);

  doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text(`No. ${rec.correlativo}`, pad, 112);

  doc.setFont('helvetica','normal'); doc.setFontSize(12);
  const lines = [
    `Nombre: ${rec.nombre}`,
    `Teléfono: ${rec.telefono}`,
    `Colegiado No.: ${(rec.colegiado_numero ?? rec.colegiadoNumero) || '—'} (Activo: ${(rec.colegiado_activo ?? rec.colegiadoActivo) || '—'})`,
    `Actividad: ${rec.actividad}`,
    `Institución: ${rec.institucion}`,
    `Tipo: ${rec.tipo}`,
    `Fecha: ${rec.fecha}`,
    `Horas: ${rec.horas}`,
    `Créditos (16h = 1): ${rec.creditos}`,
  ];
  let y = 140; const lineH = 18;
  for (const ln of lines) { doc.text(String(ln), pad, y); y += lineH; }
  if (rec.observaciones) { doc.text(`Observaciones: ${rec.observaciones}`, pad, y); y += lineH; }

  try {
    const verifyUrl = `${location.origin}/verificar.html?c=${encodeURIComponent(rec.correlativo)}&h=${encodeURIComponent(rec.hash)}`;
    const qrDataUrl = await getQrDataUrl(verifyUrl, 96);
    if (qrDataUrl) {
      doc.addImage(qrDataUrl, 'PNG', 450, 64, 96, 96);
      doc.setFontSize(10); doc.setTextColor(120);
      doc.text('Verifique la autenticidad escaneando el código QR o visitando:', pad, 790);
      doc.text(verifyUrl, pad, 805, { maxWidth: 500 });
    }
  } catch (err) {
    console.warn('QR no pudo generarse, se continúa sin QR:', err);
  }

  doc.setFontSize(10); doc.setTextColor(120);
  if (rec.hash) doc.text(`Hash: ${rec.hash}`, pad, 820);

  doc.save(`Constancia_${rec.correlativo}.pdf`);
}

function getBase64Image(img){
  const canvas=document.createElement('canvas');
  canvas.width=img.naturalWidth || img.width;
  canvas.height=img.naturalHeight || img.height;
  const ctx=canvas.getContext('2d');
  ctx.drawImage(img,0,0);
  return canvas.toDataURL('image/png');
}
function getBase64FromCanvas(canvas){
  try { return canvas.toDataURL('image/png'); }
  catch(e){ console.error('No se pudo leer canvas como dataURL:', e); return null; }
}
async function getQrDataUrl(text, size=96){
  if (typeof QRCode === 'undefined') {
    console.warn('QRCode.js no está disponible.'); return null;
  }
  return new Promise((resolve)=>{
    const tmp = document.createElement('div');
    new QRCode(tmp, { text, width:size, height:size, correctLevel: QRCode.CorrectLevel.M });
    const img = tmp.querySelector('img');
    const canvas = tmp.querySelector('canvas');

    if (canvas) return resolve(getBase64FromCanvas(canvas));
    if (img) {
      if (img.complete) { try { return resolve(getBase64Image(img)); } catch { return resolve(null); } }
      img.onload = () => { try { resolve(getBase64Image(img)); } catch { resolve(null); } };
      img.onerror = () => resolve(null);
      return;
    }
    resolve(null);
  });
}

/* =======================================================
   Carga inicial
======================================================= */
loadAndRender();

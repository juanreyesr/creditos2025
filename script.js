/* =======================================================
   Configuración y utilidades
======================================================= */
const ADMIN_PASSWORD = "CAEDUC2025";      // <-- cámbiala
const ADMIN_SESSION_MIN = 10;            // minutos
const MAX_FILE_MB = 10;
const ALLOWED_MIME = ["application/pdf","image/png","image/jpeg","image/jpg"];

// Persistencia simple en localStorage
const store = {
  key: "cpg_registros_v1",
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
  save(arr) { localStorage.setItem(this.key, JSON.stringify(arr)); },
};

// Correlativo en sesión: CPG-AAAAMM-0000
function getNextCorrelativo() {
  const k = "cpg_corr_v1";
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,'0');
  const prefix = `CPG-${y}${m}-`;
  let n = Number(sessionStorage.getItem(k) || 0) + 1;
  sessionStorage.setItem(k, String(n));
  return prefix + String(n).padStart(4,'0');
}

function sanitize(str){
  return String(str || "").replace(/[&<>\"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
}

function showToast(msg, type="info"){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = type==="error"?"#f43f5e": type==="warn"?"#f59e0b":"#243055";
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 2800);
}

function phoneValidGT(v){
  return /^(?:\+?502)?\s?\d{8}$/.test(v.trim());
}

function withinFiveYears(dateStr){
  const d = new Date(dateStr);
  const now = new Date();
  if (isNaN(d)) return false;
  if (d > now) return false;
  const pastLimit = new Date();
  pastLimit.setFullYear(now.getFullYear()-5);
  return d >= pastLimit;
}

function calcCreditos(horas){
  const n = Number(horas);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round((n/16)*100)/100; // 2 decimales
}

function hashSimple(text){
  // hash muy simple (no criptográfico) para simulación de verificación
  let h = 0; for (let i=0;i<text.length;i++){ h = (h<<5)-h + text.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

/* =======================================================
   Elementos del DOM
======================================================= */
const form = document.getElementById('registroForm');
const horasEl = document.getElementById('horas');
const creditosEl = document.getElementById('creditos');
const tablaBody = document.querySelector('#tablaRegistros tbody');
const obsEl = document.getElementById('observaciones');
const fechaEl = document.getElementById('fecha');
const telEl = document.getElementById('telefono');

// Uploader
const upZone = document.getElementById('uploader');
const fileInput = document.getElementById('archivo');
const browseBtn = document.getElementById('browseBtn');
const preview = document.getElementById('preview');
let fileRef = null;

// Admin modal
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

/* =======================================================
   Inicialización UI
======================================================= */
// set fecha máxima = hoy
(function(){
  const now = new Date();
  fechaEl.max = now.toISOString().slice(0,10);
})();

// Forzar modal admin oculto al cargar (por si algún estilo lo dejó visible)
try { adminModal?.setAttribute('aria-hidden','true'); } catch {}

// Créditos dinámicos
horasEl.addEventListener('input', () => {
  creditosEl.value = calcCreditos(horasEl.value);
});

// Uploader
browseBtn.addEventListener('click', ()=> fileInput.click());
fileInput.addEventListener('change', (e)=> handleFile(e.target.files?.[0]||null));

// Drag & drop
['dragenter','dragover'].forEach(ev=> upZone.addEventListener(ev, e=>{
  e.preventDefault(); upZone.style.borderColor = '#60a5fa';
}));
['dragleave','drop'].forEach(ev=> upZone.addEventListener(ev, e=>{
  e.preventDefault(); upZone.style.borderColor = '#334155';
  if(ev==='drop'){handleFile(e.dataTransfer.files?.[0]||null);}
}));

function handleFile(file){
  preview.innerHTML = '';
  fileRef = null;
  if(!file){ return; }
  if(!ALLOWED_MIME.includes(file.type)){
    showToast('Tipo de archivo no permitido. Solo PDF/JPG/PNG.', 'error'); return;
  }
  const sizeMB = file.size/1024/1024;
  if(sizeMB > MAX_FILE_MB){ showToast('Archivo supera 10 MB.', 'error'); return; }
  fileRef = file;
  // Previsualización
  if(file.type === 'application/pdf'){
    const url = URL.createObjectURL(file);
    const emb = document.createElement('embed');
    emb.src = url; emb.type = 'application/pdf'; emb.className = 'pdf';
    preview.appendChild(emb);
  } else {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.alt = 'Vista previa';
    img.src = URL.createObjectURL(file);
    preview.appendChild(img);
  }
}

/* =======================================================
   Registro y tabla
======================================================= */
function renderTabla(){
  const data = store.load();
  tablaBody.innerHTML = '';
  for(const r of data){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sanitize(r.correlativo)}</td>
      <td>${sanitize(r.fecha)}</td>
      <td title="${sanitize(r.actividad)}">${sanitize(r.actividad.slice(0,30))}${r.actividad.length>30?'…':''}</td>
      <td>${r.horas}</td>
      <td>${r.creditos}</td>
      <td><button class="btn" data-id="${r.id}" data-action="pdf">PDF</button></td>`;
    tablaBody.appendChild(tr);
  }
}

function renderAdmin(){
  const data = store.load();
  adminTbody.innerHTML = '';
  for(const r of data){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sanitize(r.correlativo)}</td>
      <td>${sanitize(r.nombre)}</td>
      <td>${sanitize(r.telefono)}</td>
      <td>${sanitize(r.colegiadoNumero||'')}</td>
      <td>${sanitize(r.colegiadoActivo)}</td>
      <td>${sanitize(r.actividad)}</td>
      <td>${sanitize(r.institucion)}</td>
      <td>${sanitize(r.tipo)}</td>
      <td>${sanitize(r.fecha)}</td>
      <td>${r.horas}</td>
      <td>${r.creditos}</td>
      <td>${r.archivoNombre||''}</td>
      <td>${sanitize(r.hash)}</td>
      <td>${r.exportado? 'Sí':'No'}</td>`;
    adminTbody.appendChild(tr);
  }
}

function genId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  // Validaciones
  const nombre = form.nombre.value.trim();
  const telefono = form.telefono.value.trim();
  const colegiadoNumero = form.colegiadoNumero.value.trim();
  const colegiadoActivo = form.colegiadoActivo.value;
  const actividad = form.actividad.value.trim();
  const institucion = form.institucion.value.trim();
  const tipo = form.tipo.value;
  const fecha = form.fecha.value;
  const horas = Number(form.horas.value);
  const observaciones = obsEl.value.trim();

  if(!nombre || !telefono || !colegiadoActivo || !actividad || !institucion || !tipo || !fecha || !horas){
    showToast('Complete los campos obligatorios (*)', 'error'); return;
  }
  if(!phoneValidGT(telefono)){ showToast('Formato de teléfono inválido (+502 ########)', 'error'); return; }
  if(!withinFiveYears(fecha)){ showToast('La fecha debe ser válida, no futura y dentro de 5 años atrás.', 'error'); return; }
  if(!(horas>=0.5 && horas<=200)){ showToast('Horas fuera de rango (0.5 a 200).', 'error'); return; }
  if(observaciones.length>250){ showToast('Observaciones exceden 250 caracteres.', 'error'); return; }
  if(fileRef){
    if(!ALLOWED_MIME.includes(fileRef.type)){ showToast('Archivo no permitido.', 'error'); return; }
    const sizeMB = fileRef.size/1024/1024; if(sizeMB>MAX_FILE_MB){ showToast('Archivo supera 10 MB.', 'error'); return; }
  }

  const creditos = calcCreditos(horas);
  const correlativo = getNextCorrelativo();
  const id = genId();
  const hash = hashSimple(`${correlativo}|${nombre}|${telefono}|${fecha}|${horas}|${creditos}`);

  const record = {
    id, correlativo,
    nombre, telefono, colegiadoNumero, colegiadoActivo,
    actividad, institucion, tipo, fecha,
    horas, creditos, observaciones,
    archivoNombre: fileRef? fileRef.name: '',
    archivoTipo: fileRef? fileRef.type: '',
    exportado: false,
    hash,
    createdAt: new Date().toISOString(),
  };
  const data = store.load();
  data.unshift(record);
  store.save(data);
  renderTabla();

  // Generar constancia PDF
  try {
    await generarConstanciaPDF(record);
    showToast('Registro guardado y constancia generada.');
    form.reset();
    preview.innerHTML = '';
    creditosEl.value = '';
  } catch(err){
    console.error(err); showToast('No se pudo generar PDF.', 'error');
  }
});

// Clicks en tabla para generar/abrir PDFs anteriores
tablaBody.addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-action="pdf"]');
  if(!btn) return;
  const id = btn.getAttribute('data-id');
  const rec = store.load().find(x=>x.id===id);
  if(rec){ generarConstanciaPDF(rec).catch(()=> showToast('Error al generar PDF', 'error')); }
});

/* =======================================================
   Panel Admin (Ctrl+Shift+A o botón oculto)
======================================================= */
function openModal(){ adminModal.setAttribute('aria-hidden','false'); adminPass.focus(); }
function closeModalFn(){ adminModal.setAttribute('aria-hidden','true'); adminPass.value=''; adminBody.hidden=true; adminAuth.hidden=false; }

openAdminBtn.addEventListener('click', openModal);
closeAdmin.addEventListener('click', closeModalFn);
window.addEventListener('keydown', (e)=>{
  if(e.key==='Escape') closeModalFn();
  if(e.key.toLowerCase()==='a' && e.shiftKey && e.ctrlKey){ openModal(); }
});

// Abrir admin si URL contiene #admin
if(location.hash === '#admin'){ openModal(); }

let adminSessionEnd = 0;
function startAdminSession(){ adminSessionEnd = Date.now() + ADMIN_SESSION_MIN*60*1000; }
function adminSessionValid(){ return Date.now() < adminSessionEnd; }

adminLogin.addEventListener('click', (ev)=>{
  ev.preventDefault();
  const pass = (adminPass.value || '').trim();
  if(pass === ADMIN_PASSWORD){
    adminAuth.hidden = true; adminBody.hidden = false; startAdminSession(); renderAdmin(); showToast('Sesión admin iniciada', 'ok');
  } else { showToast('Contraseña incorrecta', 'error'); }
});

// Enter para login
adminPass.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ adminLogin.click(); }});

// Cerrar al hacer click fuera
adminModal.addEventListener('click', (e)=>{ if(e.target===adminModal) closeModalFn(); });

// Expirar sesión admin
setInterval(()=>{
  if(!adminBody.hidden && !adminSessionValid()){
    showToast('Sesión admin expirada', 'warn');
    adminBody.hidden = true; adminAuth.hidden = false; adminPass.value='';
  }
}, 2000);

// Exportaciones
exportCSVBtn.addEventListener('click', ()=>{
  if(adminBody.hidden || !adminSessionValid()) return showToast('Inicie sesión admin', 'error');
  const data = store.load();
  if(!data.length) return showToast('Sin registros', 'warn');
  const headers = Object.keys(data[0]);
  const rows = [headers.join(',')].concat(data.map(o=> `"${headers.map(h=>String(o[h]??'').replace(/"/g,'""')).join('","')}"`));
  const blob = new Blob(["\ufeff"+rows.join('\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`registros_cpg_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
  exportStatus.textContent = 'CSV descargado';
  marcarExportado();
});

exportXLSXBtn.addEventListener('click', ()=>{
  if(adminBody.hidden || !adminSessionValid()) return showToast('Inicie sesión admin', 'error');
  const data = store.load();
  if(!data.length) return showToast('Sin registros', 'warn');
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registros');
  XLSX.writeFile(wb, `registros_cpg_${new Date().toISOString().slice(0,10)}.xlsx`);
  exportStatus.textContent = 'Excel descargado';
  marcarExportado();
});

function marcarExportado(){
  const data = store.load();
  for(const r of data){ r.exportado = true; }
  store.save(data);
  if(!adminBody.hidden) renderAdmin();
}

clearDataBtn.addEventListener('click', ()=>{
  if(!confirm('¿Borrar TODOS los registros locales?')) return;
  store.save([]); sessionStorage.removeItem('cpg_corr_v1');
  renderTabla(); if(!adminBody.hidden) renderAdmin();
  showToast('Registros locales eliminados');
});

/* =======================================================
   Constancia PDF con QR
======================================================= */
async function generarConstanciaPDF(rec){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'pt',format:'a4'});
  const pad = 48;

  // Encabezado
  doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text('Constancia de Registro de Créditos Académicos', pad, 64);
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.text('Colegio de Psicólogos de Guatemala — Artículo 16: 1 crédito = 16 horas', pad, 84);

  // Correlativo
  doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text(`No. ${rec.correlativo}`, pad, 112);

  // Datos
  doc.setFont('helvetica','normal'); doc.setFontSize(12);
  const lines = [
    `Nombre: ${rec.nombre}`,
    `Teléfono: ${rec.telefono}`,
    `Colegiado No.: ${rec.colegiadoNumero || '—'} (Activo: ${rec.colegiadoActivo})`,
    `Actividad: ${rec.actividad}`,
    `Institución: ${rec.institucion}`,
    `Tipo: ${rec.tipo}`,
    `Fecha: ${rec.fecha}`,
    `Horas: ${rec.horas}`,
    `Créditos (16h = 1): ${rec.creditos}`,
  ];
  let y = 140; const lineH = 18;
  for(const ln of lines){ doc.text(ln, pad, y); y+=lineH; }
  if(rec.observaciones){ doc.text(`Observaciones: ${rec.observaciones}`, pad, y); y+=lineH; }

  // QR (verificación simulada)
  const qrDiv = document.createElement('div');
  new QRCode(qrDiv, { text: `CPG|${rec.correlativo}|${rec.hash}`, width: 96, height: 96, correctLevel: QRCode.CorrectLevel.M });
  const qrImg = qrDiv.querySelector('img');
  await new Promise(res=> { if(qrImg?.complete) res(); else qrImg.onload = res; });
  const qrData = getBase64Image(qrImg);
  doc.addImage(qrData, 'PNG', 450, 64, 96, 96);

  // Pie
  doc.setFontSize(10); doc.setTextColor(120);
  doc.text('Este documento es una constancia generada automáticamente a partir de los datos ingresados por el usuario, cualquier dato falso invalida la constancia generada.', pad, 790);
  doc.text(`Hash: ${rec.hash}`, pad, 805);

  doc.save(`Constancia_${rec.correlativo}.pdf`);
}

function getBase64Image(img){
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img,0,0);
  return canvas.toDataURL('image/png');
}

/* =======================================================
   Carga inicial
======================================================= */
renderTabla();

// Accesibilidad mínima: foco visible en zona uploader con teclado
upZone.addEventListener('keydown', (e)=>{
  if(e.key==='Enter' || e.key===' '){ e.preventDefault(); fileInput.click(); }
});

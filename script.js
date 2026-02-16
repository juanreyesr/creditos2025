/* =======================================================
   Supabase init (lazy)
======================================================= */
function getSupabaseClient() {
  try {
    const hasSDK = !!window.supabase && typeof window.supabase.createClient === 'function';
    const url = window.SB_URL || window.NEXT_PUBLIC_SUPABASE_URL || window.__env?.SUPABASE_URL;
    const key = window.SB_KEY || window.NEXT_PUBLIC_SUPABASE_ANON_KEY || window.__env?.SUPABASE_ANON_KEY;
    if (!hasSDK || !url || !key) return null;
    if (!getSupabaseClient._client) {
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
const ADMIN_SESSION_MIN = 15;
const MAX_FILE_MB = 10;
const ALLOWED_MIME = ["application/pdf","image/png","image/jpeg","image/jpg"];

const PDF_LOGO_URL = './assets/Logo-cpg.png';
const PDF_LOGO_W = 96;
const PDF_LOGO_H = 96;
const QR_X = 450;
const QR_Y = 64;
const QR_SIZE = 96;
const LOGO_BELOW_GAP = 12;

let __PDF_LOGO_DATAURL = null;
let __HAS_DELETED_AT = true;

let __USER_ROWS_CACHE = [];
let __CONSOLIDADO_PATH = null;

/* Indica si el usuario ya aceptó el modal de entrada en esta visita */
let __ENTRY_ACCEPTED = false;

/* PDF.js worker */
window.addEventListener('load', ()=>{
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }
});

function sanitize(str){
  return String(str || "").replace(/[&<>\"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
}
function showToast(msg, type="info"){
  const el = document.getElementById('toast');
  if(!el){ alert(msg); return; }
  el.textContent = msg;
  el.style.borderColor = type==="error"?"#f43f5e": type==="warn"?"#f59e0b":"#243055";
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 3200);
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
function sbErrMsg(err){ return err?.message || err?.hint || err?.code || 'Error desconocido'; }


/* =======================================================
   Prefill datos personales
======================================================= */
function lsKey(userId, field) {
  return `creditos2025:${userId}:${field}`;
}

function precargarDesdeLocalStorage(userId) {
  if(!userId) return;
  const elNombre = document.querySelector("#nombre");
  const elTelefono = document.querySelector("#telefono");
  const elColegiado = document.querySelector("#colegiadoNumero");

  if (elNombre && !elNombre.value) {
    const v = localStorage.getItem(lsKey(userId, "nombre"));
    if (v) elNombre.value = v;
  }
  if (elTelefono && !elTelefono.value) {
    const v = localStorage.getItem(lsKey(userId, "telefono"));
    if (v) elTelefono.value = v;
  }
  if (elColegiado && !elColegiado.value) {
    const v = localStorage.getItem(lsKey(userId, "colegiadoNumero"));
    if (v) elColegiado.value = v;
  }
}

function guardarDatosRapidos(userId, nombre, telefono, colegiadoNumero) {
  if(!userId) return;
  if (nombre) localStorage.setItem(lsKey(userId, "nombre"), nombre);
  if (telefono) localStorage.setItem(lsKey(userId, "telefono"), telefono);
  if (colegiadoNumero) localStorage.setItem(lsKey(userId, "colegiadoNumero"), colegiadoNumero);
}

function limpiarDatosRapidos(userId) {
  if(!userId) return;
  try {
    localStorage.removeItem(lsKey(userId, "nombre"));
    localStorage.removeItem(lsKey(userId, "telefono"));
    localStorage.removeItem(lsKey(userId, "colegiadoNumero"));
    localStorage.removeItem('cpg_colegiado_verificado');
  } catch {}
}

async function precargarDatosDesdeUltimoRegistro(userId) {
  const sb = getSupabaseClient();
  if(!sb || !userId) return;

  const { data, error } = await sb
    .from("registros")
    .select("nombre, telefono, colegiado_numero")
    .eq("usuario_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) { console.warn("No se pudo precargar:", error.message); return; }

  const last = data?.[0];
  if (!last) return;

  const nombre = last.nombre || "";
  const telefono = last.telefono || "";
  const colegiadoNumero = last.colegiado_numero || "";

  const elNombre = document.querySelector("#nombre");
  const elTelefono = document.querySelector("#telefono");
  const elColegiado = document.querySelector("#colegiadoNumero");

  if (elNombre && !elNombre.value && nombre) elNombre.value = nombre;
  if (elTelefono && !elTelefono.value && telefono) elTelefono.value = telefono;
  if (elColegiado && !elColegiado.value && colegiadoNumero) elColegiado.value = colegiadoNumero;

  guardarDatosRapidos(userId, nombre, telefono, colegiadoNumero);
}

/* =======================================================
   DOM refs
======================================================= */
const form = document.getElementById('registroForm');
const horasEl = document.getElementById('horas');
const creditosEl = document.getElementById('creditos');
const tablaBody = document.querySelector('#tablaRegistros tbody');
const totalCreditosLabel = document.getElementById('totalCreditosLabel');
const downloadConsolidadoBtn = document.getElementById('downloadConsolidadoBtn');
const downloadByYearBtn = document.getElementById('downloadByYearBtn');
const yearSelect = document.getElementById('yearSelect');
const downloadYearBtn = document.getElementById('downloadYearBtn');
const consolidadoState = document.getElementById('consolidadoState');
const obsEl = document.getElementById('observaciones');
const fechaEl = document.getElementById('fecha');
const colegiadoEl = document.getElementById('colegiadoNumero');

const upZone = document.getElementById('uploader');
const fileInput = document.getElementById('archivo');
const browseBtn = document.getElementById('browseBtn');
const preview = document.getElementById('preview');
let fileRef = null;

// Colegiado verification
const verificarColegiadoBtn = document.getElementById('verificarColegiadoBtn');
const colegiadoInfoDiv = document.getElementById('colegiadoInfo');
const colegiadoInfoContent = document.getElementById('colegiadoInfoContent');
const colegiadoActivoHidden = document.getElementById('colegiadoActivoHidden');
let __COLEGIADO_VERIFIED = false; // Track if the current number has been verified

// Admin
const adminModal = document.getElementById('adminModal');
const openAdminBtn = document.getElementById('openAdminBtn');
const closeAdmin = document.getElementById('closeAdmin');
const adminAuth = document.getElementById('adminAuth');
const adminBody = document.getElementById('adminBody');
const adminPass = document.getElementById('adminPass');
const adminLogin = document.getElementById('adminLogin');
const adminTbody = document.querySelector('#adminTable tbody');
const exportCSVBtn = document.getElementById('exportCSV');
const exportXLSXBtn = document.getElementById('exportXLSX');
const adminSearch = document.getElementById('adminSearch');
const adminSearchBtn = document.getElementById('adminSearchBtn');
const adminClearSearch = document.getElementById('adminClearSearch');
const exportStatus = document.getElementById('exportStatus');
const showDeleted = document.getElementById('showDeleted');
const adminModeBadge = document.getElementById('adminModeBadge');
const superEmail = document.getElementById('superEmail');
const superPass = document.getElementById('superPass');
const superLogin = document.getElementById('superLogin');
const adminState = document.getElementById('adminState');
const diagBox = document.getElementById('diagBox');

// Superadmin: activación de usuarios
const userAdminPanel = document.getElementById('userAdminPanel');
const userAdminEmail = document.getElementById('userAdminEmail');
const userCheckBtn = document.getElementById('userCheckBtn');
const userActivateBtn = document.getElementById('userActivateBtn');
const userAdminState = document.getElementById('userAdminState');

// Superadmin: gestión de roles
const adminRoleEmail = document.getElementById('adminRoleEmail');
const makeAdminBtn = document.getElementById('makeAdminBtn');
const removeAdminBtn = document.getElementById('removeAdminBtn');
const adminRoleState = document.getElementById('adminRoleState');

// Auth modal
const authBtn = document.getElementById('authBtn');
const authModal = document.getElementById('authModal');
const closeAuth = document.getElementById('closeAuth');
const authEmail = document.getElementById('authEmail');
const authPass2 = document.getElementById('authPass');
const doLogin = document.getElementById('doLogin');
const doSignup = document.getElementById('doSignup');
const doResetPassword = document.getElementById('doResetPassword');
const authState = document.getElementById('authState');

// Entry modal
const entryModal = document.getElementById('entryModal');
const entryAccept = document.getElementById('entryAccept');

// Secciones condicionales
const mainNav = document.getElementById('mainNav');
const formSection = document.getElementById('formSection');
const histSection = document.getElementById('histSection');
const loginRequiredSection = document.getElementById('loginRequiredSection');
const loginRequiredBtn = document.getElementById('loginRequiredBtn');
const signupRequiredBtn = document.getElementById('signupRequiredBtn');

/* =======================================================
   UI State Management
   - Controla qué se muestra según: modal aceptado + sesión
======================================================= */
function showNav(){ if(mainNav) mainNav.style.display = 'flex'; }
function hideNav(){ if(mainNav) mainNav.style.display = 'none'; }

function showAuthenticatedUI(){
  if(formSection) formSection.style.display = '';
  if(histSection) histSection.style.display = '';
  if(loginRequiredSection) loginRequiredSection.style.display = 'none';
  // Restore cached colegiado verification if available
  setTimeout(()=>{ try { restaurarVerificacionCacheada(); } catch {} }, 100);
}

function showUnauthenticatedUI(){
  if(formSection) formSection.style.display = 'none';
  if(histSection) histSection.style.display = 'none';
  if(loginRequiredSection) loginRequiredSection.style.display = '';
}

function hideAllContent(){
  if(formSection) formSection.style.display = 'none';
  if(histSection) histSection.style.display = 'none';
  if(loginRequiredSection) loginRequiredSection.style.display = 'none';
}

function updateAuthButton(isLoggedIn){
  if(!authBtn) return;
  if(isLoggedIn){
    authBtn.innerHTML = '<span class="nav-icon">👤</span> Mi sesión';
    authBtn.classList.add('session-active-btn');
    authBtn.classList.remove('primary-nav');
  } else {
    authBtn.innerHTML = '<span class="nav-icon">🔐</span> Iniciar sesión';
    authBtn.classList.remove('session-active-btn');
    authBtn.classList.add('primary-nav');
  }
}

/** Aplica el estado correcto de la UI basado en sesión */
async function applyUIState(){
  if(!__ENTRY_ACCEPTED){
    hideNav();
    hideAllContent();
    return;
  }

  showNav();

  const sb = getSupabaseClient();
  if(!sb){ showUnauthenticatedUI(); updateAuthButton(false); return; }

  const { data: s } = await sb.auth.getSession();
  const isLoggedIn = !!s?.session?.user;

  updateAuthButton(isLoggedIn);

  if(isLoggedIn){
    showAuthenticatedUI();
    await loadAndRender();
  } else {
    showUnauthenticatedUI();
  }
}

/* =======================================================
   Inicialización UI + detecciones
======================================================= */
(function(){
  const now = new Date();
  if(fechaEl) fechaEl.max = now.toISOString().slice(0,10);
  try { adminModal?.setAttribute('aria-hidden','true'); authModal?.setAttribute('aria-hidden','true'); } catch {}

  // SIEMPRE mostrar el modal de entrada (cada visita)
  hideNav();
  hideAllContent();
  openModal(entryModal);
})();

/* Aceptar modal de entrada */
entryAccept?.addEventListener('click', async ()=>{
  __ENTRY_ACCEPTED = true;
  closeModal(entryModal);
  await applyUIState();
});

/* Botón "Iniciar sesión" dentro de la sección login-required */
loginRequiredBtn?.addEventListener('click', ()=>{
  openModal(authModal);
});

/* Botón "Crear cuenta" dentro de la sección login-required */
signupRequiredBtn?.addEventListener('click', ()=>{
  openModal(authModal);
  // Limpiar campos y poner foco en email para crear cuenta
  if(authEmail) authEmail.value = '';
  if(authPass2) authPass2.value = '';
  if(authState) authState.textContent = 'Completa los campos y presiona "Crear cuenta"';
  setTimeout(()=> authEmail?.focus(), 150);
});

if (horasEl && creditosEl) {
  horasEl.addEventListener('input', ()=> creditosEl.value = calcCreditos(horasEl.value));
}

/* --- Solo números en campo de colegiado --- */
if (colegiadoEl) {
  colegiadoEl.addEventListener('input', ()=>{
    colegiadoEl.value = colegiadoEl.value.replace(/[^0-9]/g, '');
  });
  colegiadoEl.addEventListener('keydown', (e)=>{
    if ([8,9,13,27,46].includes(e.keyCode)) return;
    if ((e.ctrlKey || e.metaKey) && [65,67,86,88].includes(e.keyCode)) return;
    if (e.keyCode >= 35 && e.keyCode <= 40) return;
    if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
      e.preventDefault();
    }
  });
  colegiadoEl.addEventListener('paste', (e)=>{
    setTimeout(()=>{
      colegiadoEl.value = colegiadoEl.value.replace(/[^0-9]/g, '');
    }, 0);
  });

  // Reset verification when number changes
  colegiadoEl.addEventListener('input', ()=>{
    __COLEGIADO_VERIFIED = false;
    habilitarFormulario(false);
    const activoEl = document.getElementById('colegiadoActivo');
    if(activoEl) { activoEl.value = ''; activoEl.style.color = 'var(--muted)'; }
    if(colegiadoActivoHidden) colegiadoActivoHidden.value = '';
    if(colegiadoInfoDiv){
      colegiadoInfoDiv.style.display = 'none';
      colegiadoInfoDiv.className = 'colegiado-info';
    }
  });
}

/* =======================================================
   Verificación automática de colegiado (CPG)
======================================================= */
const datosPersonalesFs = document.getElementById('datosPersonalesFieldset');
const actividadFs = document.getElementById('actividadFieldset');

function habilitarFormulario(habilitar) {
  if(datosPersonalesFs) datosPersonalesFs.disabled = !habilitar;
  if(actividadFs) actividadFs.disabled = !habilitar;
}

function guardarVerificacionLocal(numero, data) {
  try {
    const payload = { numero, nombre: data.nombre||'', estatus: data.estatus||'', fecha_colegiacion: data.fecha_colegiacion||'', ultimo_pago: data.ultimo_pago||'', ts: Date.now() };
    localStorage.setItem('cpg_colegiado_verificado', JSON.stringify(payload));
  } catch {}
}

function obtenerVerificacionLocal() {
  try {
    const raw = localStorage.getItem('cpg_colegiado_verificado');
    if(!raw) return null;
    const d = JSON.parse(raw);
    // Cache valid for 24 hours
    if(Date.now() - d.ts > 24*60*60*1000) { localStorage.removeItem('cpg_colegiado_verificado'); return null; }
    return d;
  } catch { return null; }
}

function aplicarResultadoVerificacion(numero, data, fromCache) {
  const activoEl = document.getElementById('colegiadoActivo');
  const nombreEl = document.getElementById('nombre');
  const estatus = (data.estatus || '').toUpperCase();
  const isActivo = estatus === 'ACTIVO';

  // Set readonly fields
  if(activoEl) { activoEl.value = isActivo ? 'Sí' : 'No'; activoEl.style.color = isActivo ? '#4ade80' : '#fca5a5'; }
  if(colegiadoActivoHidden) colegiadoActivoHidden.value = isActivo ? 'Sí' : 'No';
  __COLEGIADO_VERIFIED = true;

  // Auto-fill nombre from CPG (authoritative source, always overwrite)
  if(data.nombre && nombreEl) {
    nombreEl.value = data.nombre;
  }

  // Enable the rest of the form
  habilitarFormulario(true);

  // Style the info div
  if(colegiadoInfoDiv) { colegiadoInfoDiv.style.display = 'block'; colegiadoInfoDiv.className = `colegiado-info ${isActivo ? 'status-activo' : 'status-inactivo'}`; }

  // Build info HTML
  let html = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">`;
  html += `<strong>Colegiado No. ${sanitize(data.numero || numero)}</strong>`;
  html += `<span class="status-badge ${isActivo ? 'activo' : 'inactivo'}">${sanitize(estatus)}</span>`;
  if(fromCache) html += `<span style="font-size:11px;color:var(--muted)">(verificación en caché)</span>`;
  html += `</div>`;

  if(data.nombre) html += `<div class="info-row"><span class="info-label">Nombre:</span><span class="info-value">${sanitize(data.nombre)}</span></div>`;
  if(data.fecha_colegiacion) html += `<div class="info-row"><span class="info-label">Fecha colegiación:</span><span class="info-value">${sanitize(data.fecha_colegiacion)}</span></div>`;
  if(data.ultimo_pago) html += `<div class="info-row"><span class="info-label">Último pago:</span><span class="info-value">${sanitize(data.ultimo_pago)}</span></div>`;

  if(!isActivo){
    html += `<p style="margin:10px 0 0;color:#fca5a5;font-size:13px">⚠️ Tu estatus aparece como <strong>INACTIVO</strong> en la base del Colegio. Si crees que es un error, contacta al CPG.</p>`;
  }

  if(colegiadoInfoContent) colegiadoInfoContent.innerHTML = html;
}

async function verificarColegiado(numero) {
  if (!numero || !/^\d+$/.test(numero)) {
    showToast('Ingresa un número de colegiado válido.', 'warn');
    return;
  }

  const activoEl = document.getElementById('colegiadoActivo');
  const btn = verificarColegiadoBtn;

  // UI: loading state
  if(btn) { btn.disabled = true; btn.innerHTML = '<span class="verifying-spinner"></span>Verificando…'; }
  if(colegiadoInfoDiv) { colegiadoInfoDiv.style.display = 'block'; colegiadoInfoDiv.className = 'colegiado-info'; }
  if(colegiadoInfoContent) colegiadoInfoContent.innerHTML = '<span class="verifying-spinner"></span> Consultando estado en la base del Colegio de Psicólogos…';

  try {
    const url = window.SB_URL + '/functions/v1/consultar-colegiado';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: numero })
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      __COLEGIADO_VERIFIED = false;
      habilitarFormulario(false);
      if(activoEl) activoEl.value = '';
      if(colegiadoActivoHidden) colegiadoActivoHidden.value = '';
      if(colegiadoInfoDiv) colegiadoInfoDiv.className = 'colegiado-info status-error';
      if(colegiadoInfoContent) colegiadoInfoContent.innerHTML =
        `<strong>⚠️ ${data.error || 'No se pudo verificar'}</strong><br>` +
        `<span class="muted">Verifica que el número sea correcto e intenta de nuevo.</span>`;
      return;
    }

    aplicarResultadoVerificacion(numero, data, false);
    guardarVerificacionLocal(numero, data);

  } catch (e) {
    console.error('Error verificando colegiado:', e);
    __COLEGIADO_VERIFIED = false;
    habilitarFormulario(false);
    if(activoEl) activoEl.value = '';
    if(colegiadoActivoHidden) colegiadoActivoHidden.value = '';
    if(colegiadoInfoDiv) colegiadoInfoDiv.className = 'colegiado-info status-error';
    if(colegiadoInfoContent) colegiadoInfoContent.innerHTML =
      `<strong>⚠️ Error de conexión</strong><br>` +
      `<span class="muted">No se pudo conectar con el servicio. Intenta de nuevo.</span>`;
  } finally {
    if(btn) { btn.disabled = false; btn.textContent = 'Verificar'; }
  }
}

// Restore cached verification on page load
function restaurarVerificacionCacheada() {
  const cached = obtenerVerificacionLocal();
  if(!cached) return;
  const currentVal = (colegiadoEl?.value || '').trim();
  // Only restore if field is empty or matches cached number
  if(currentVal && currentVal !== cached.numero) return;
  if(colegiadoEl && !currentVal) colegiadoEl.value = cached.numero;
  aplicarResultadoVerificacion(cached.numero, cached, true);
}

verificarColegiadoBtn?.addEventListener('click', ()=>{
  const numero = (colegiadoEl?.value || '').trim();
  verificarColegiado(numero);
});

// Also verify on Enter key in the colegiado field
colegiadoEl?.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){
    e.preventDefault();
    verificarColegiadoBtn?.click();
  }
});

/* Detección de deleted_at */
(async function detectDeletedAt(){
  const sb = getSupabaseClient(); if(!sb) return;
  try {
    const { error } = await sb.from('registros').select('deleted_at').limit(1);
    if (error && /(column|columna).*(deleted_at).*(does not exist|no existe)/i.test(sbErrMsg(error))) {
      __HAS_DELETED_AT = false;
      if (showDeleted) showDeleted.disabled = true;
      if (diagBox) diagBox.textContent = 'Diagnóstico: la tabla public.registros no tiene columna deleted_at.';
    }
  } catch {}
})();

/* =======================================================
   Uploader obligatorio
======================================================= */
function markUploaderError(on=true){
  if(!upZone) return;
  upZone.style.transition = 'border-color .2s';
  upZone.style.borderColor = on ? '#f43f5e' : '#334155';
}
browseBtn?.addEventListener('click', ()=> fileInput?.click());
upZone?.addEventListener('click', (e)=>{
  if (e.target && e.target.id === 'browseBtn') return;
  fileInput?.click();
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
  preview.innerHTML=''; fileRef=null;
  if(!file){ markUploaderError(true); return; }

  if(!ALLOWED_MIME.includes(file.type)) {
    showToast('Tipo no permitido. Solo PDF/JPG/PNG.', 'error');
    markUploaderError(true); return;
  }
  const mb=file.size/1024/1024;
  if(mb>MAX_FILE_MB){
    showToast('Archivo supera 10 MB.', 'error');
    markUploaderError(true); return;
  }
  fileRef=file; markUploaderError(false);

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

/* =======================================================
   Auth UI + reset password
======================================================= */
function openModal(m){ m?.setAttribute('aria-hidden','false'); }
function closeModal(m){ m?.setAttribute('aria-hidden','true'); if(authState) authState.textContent='—'; }

authBtn?.addEventListener('click', async ()=>{
  const sb = getSupabaseClient();
  if(!sb){ showToast('No se pudo inicializar autenticación (Supabase).', 'error'); return; }

  const { data: s } = await sb.auth.getSession();

  if (s?.session?.user) {
    const ok = confirm('¿Deseas cerrar sesión en este dispositivo?');
    if(!ok) return;

    const userId = s.session.user.id;
    const { error } = await sb.auth.signOut();
    if(error){ showToast('No se pudo cerrar sesión: ' + sbErrMsg(error), 'error'); return; }

    limpiarDatosRapidos(userId);

    try { form?.reset(); } catch {}
    if(preview) preview.innerHTML='';
    if(creditosEl) creditosEl.value='';
    if(tablaBody) tablaBody.innerHTML='';
    if(totalCreditosLabel) totalCreditosLabel.textContent = 'Total créditos acumulados: 0';
    if(downloadConsolidadoBtn) downloadConsolidadoBtn.disabled = true;
    if(downloadByYearBtn) downloadByYearBtn.disabled = true;
    hideYearSelector();
    if(consolidadoState) consolidadoState.textContent = '—';

    showToast('Sesión cerrada.');
    updateAuthButton(false);
    showUnauthenticatedUI();
    return;
  }

  openModal(authModal);
});

closeAuth?.addEventListener('click', ()=> closeModal(authModal));
authPass2?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin?.click(); });

doSignup?.addEventListener('click', async ()=>{
  const sb = getSupabaseClient();
  if(!sb){ showToast('Supabase no disponible.', 'error'); return; }
  authState.textContent = 'Creando cuenta...';
  const email = (authEmail?.value||'').trim();
  const password = authPass2?.value || '';
  const redirectTo = `${location.origin}/auth-callback.html`;
  const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
  if(error){ authState.textContent='Error: '+sbErrMsg(error); return; }
  authState.textContent='Ya se ha creado tu cuenta, debes verificarla en el enlace que se ha enviado a su correo';
});

doLogin?.addEventListener('click', async ()=>{
  const sb = getSupabaseClient();
  if(!sb){ showToast('Supabase no disponible.', 'error'); return; }
  authState.textContent = 'Ingresando...';
  const { error } = await sb.auth.signInWithPassword({
    email: (authEmail?.value||'').trim(),
    password: authPass2?.value || ''
  });
  if(error){ authState.textContent='Error: '+sbErrMsg(error); return; }
  authState.textContent='OK';
  closeModal(authModal);
  updateAuthButton(true);
  showAuthenticatedUI();
  await loadAndRender();
});

doResetPassword?.addEventListener('click', async ()=>{
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.', 'error'); return; }
  const email = (authEmail?.value||'').trim();
  if(!email){ showToast('Escriba su correo en el campo Email y vuelva a pulsar.', 'warn'); return; }
  authState.textContent = 'Enviando enlace...';
  const redirectTo = `${location.origin}/auth-callback.html`;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if(error){ authState.textContent = 'Error: '+sbErrMsg(error); return; }
  authState.textContent = 'Te enviamos un enlace para restablecer tu contraseña.';
});

/* Listener de cambio de estado de auth (sesión persistente) */
getSupabaseClient()?.auth.onAuthStateChange(async (_evt, session)=>{
  const isLoggedIn = !!session?.user;
  updateAuthButton(isLoggedIn);

  // Solo actualizar secciones si ya se aceptó el modal de entrada
  if(__ENTRY_ACCEPTED){
    if(isLoggedIn){
      showAuthenticatedUI();
      await loadAndRender();
    } else {
      showUnauthenticatedUI();
    }
  }
});

/* =======================================================
   Datos (vista usuario)
======================================================= */
async function loadAndRender(){
  const sb = getSupabaseClient();
  if(!sb) return;

  const { data: session } = await sb.auth.getSession();
  if(!session?.session){
    if(tablaBody) tablaBody.innerHTML='';
    if(totalCreditosLabel) totalCreditosLabel.textContent = 'Total créditos acumulados: 0';
    if(downloadConsolidadoBtn) downloadConsolidadoBtn.disabled = true;
    if(downloadByYearBtn) downloadByYearBtn.disabled = true;
    hideYearSelector();
    if(consolidadoState) consolidadoState.textContent = '—';
    return;
  }

  const userId = session.session.user.id;

  try { precargarDesdeLocalStorage(userId); } catch {}
  try { await precargarDatosDesdeUltimoRegistro(userId); } catch {}

  let q = sb.from('registros').select('*').eq('usuario_id', userId).order('created_at', { ascending:false });
  if (__HAS_DELETED_AT) q = q.is('deleted_at', null);

  const { data, error } = await q;
  if(error){
    console.error('loadAndRender error:', error);
    showToast('No se pudieron cargar registros: ' + sbErrMsg(error), 'error');
    return;
  }

  const rows = data || [];
  __USER_ROWS_CACHE = rows;
  updateUserTotalsUI(rows);
  populateYearSelect(rows);
  renderTabla(rows);
}

function updateUserTotalsUI(rows){
  const totalCred = (rows || []).reduce((acc, r)=> acc + (Number(r.creditos) || 0), 0);
  if (totalCreditosLabel) totalCreditosLabel.textContent = `Total créditos acumulados: ${Math.round(totalCred*100)/100}`;
  const enabled = (rows && rows.length > 0);
  if (downloadConsolidadoBtn) downloadConsolidadoBtn.disabled = !enabled;
  if (downloadByYearBtn) downloadByYearBtn.disabled = !enabled;
  if (!enabled) {
    hideYearSelector();
    if (consolidadoState) consolidadoState.textContent = '—';
  }
}

/* --- Selector de año para reportes --- */
function getYearsFromRows(rows) {
  const years = new Set();
  for (const r of (rows || [])) {
    const fecha = r.fecha || r.created_at || '';
    const y = new Date(fecha).getFullYear();
    if (y && !isNaN(y)) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

function populateYearSelect(rows) {
  if (!yearSelect) return;
  const years = getYearsFromRows(rows);
  yearSelect.innerHTML = '<option value="">— Año —</option>';
  for (const y of years) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    yearSelect.appendChild(opt);
  }
  if (years.length > 0) {
    yearSelect.disabled = false;
  } else {
    yearSelect.disabled = true;
  }
}

function hideYearSelector() {
  if (yearSelect) { yearSelect.style.display = 'none'; yearSelect.value = ''; }
  if (downloadYearBtn) downloadYearBtn.style.display = 'none';
}

function showYearSelector() {
  if (yearSelect) yearSelect.style.display = '';
  if (downloadYearBtn) downloadYearBtn.style.display = '';
}

downloadByYearBtn?.addEventListener('click', ()=>{
  if (yearSelect?.style.display === 'none' || yearSelect?.style.display === '') {
    if (yearSelect?.style.display === 'none') {
      showYearSelector();
    } else {
      hideYearSelector();
    }
  } else {
    hideYearSelector();
  }
});

downloadYearBtn?.addEventListener('click', async ()=>{
  const selectedYear = yearSelect?.value;
  if (!selectedYear) { showToast('Selecciona un año.', 'warn'); return; }

  const yearRows = (__USER_ROWS_CACHE || []).filter(r => {
    const fecha = r.fecha || r.created_at || '';
    return new Date(fecha).getFullYear() === Number(selectedYear);
  });

  if (!yearRows.length) {
    showToast('No hay registros para el año ' + selectedYear, 'warn');
    return;
  }

  try {
    if (consolidadoState) consolidadoState.textContent = 'Generando reporte ' + selectedYear + '...';
    const { doc, blob, filename } = await generarConsolidadoPDF(yearRows, selectedYear);
    savePdfMobile(doc, filename);
    if (consolidadoState) consolidadoState.textContent = 'Reporte ' + selectedYear + ' descargado.';
  } catch (e) {
    console.error(e);
    if (consolidadoState) consolidadoState.textContent = 'Error.';
    showToast('No se pudo generar el reporte: ' + (e?.message || e), 'error');
  }
});

function renderTabla(rows){
  if(!tablaBody) return;
  tablaBody.innerHTML='';
  for(const r of rows){
    const compBtn = r.archivo_url ? `<button class="btn" data-action="dl" data-path="${sanitize(r.archivo_url)}" type="button">Comp.</button>` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sanitize(r.correlativo)}</td>
      <td>${sanitize(r.fecha)}</td>
      <td title="${sanitize(r.actividad)}">${sanitize(r.actividad.slice(0,30))}${r.actividad.length>30?'…':''}</td>
      <td>${r.horas}</td>
      <td>${r.creditos}</td>
      <td>
        <button class="btn" data-id="${r.id}" data-action="pdf" type="button">PDF</button>
        ${compBtn}
        <button class="btn warn" data-id="${r.id}" data-corr="${sanitize(r.correlativo)}" data-action="userdel" type="button">Borrar</button>
      </td>`;
    tablaBody.appendChild(tr);
  }
}

tablaBody?.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button');
  if(!btn) return;
  const act = btn.getAttribute('data-action');
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }

  if (act === 'pdf') {
    const id = btn.getAttribute('data-id');
    const { data: rows, error } = await sb.from('registros').select('*').eq('id', id).limit(1);
    if(error || !rows?.length) return showToast('Registro no disponible: '+(error?sbErrMsg(error):'no encontrado'),'error');
    await generarConstanciaPDF(rows[0]).catch(()=> showToast('Error al generar PDF','error'));
  }

  if (act === 'dl') {
    const path = btn.getAttribute('data-path');
    await downloadComprobante(path);
  }

  if (act === 'userdel') {
    const corr = btn.getAttribute('data-corr') || '—';
    const id = btn.getAttribute('data-id');
    const ok = confirm(`¿Deseas eliminar el registro ${corr}?\n\nEsta acción no se puede deshacer.`);
    if(!ok) return;

    if (__HAS_DELETED_AT) {
      const { error: upErr } = await sb.from('registros').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if(upErr){ showToast('No se pudo eliminar: '+sbErrMsg(upErr),'error'); return; }
    } else {
      const { error: delErr } = await sb.from('registros').delete().eq('id', id);
      if(delErr){ showToast('No se pudo eliminar: '+sbErrMsg(delErr),'error'); return; }
    }

    showToast('Registro ' + corr + ' eliminado.');
    await loadAndRender();
  }
});

downloadConsolidadoBtn?.addEventListener('click', async ()=>{
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  const { data: s } = await sb.auth.getSession();
  if(!s?.session){ showToast('Inicia sesión para descargar el consolidado.', 'error'); return; }
  const userId = s.session.user.id;
  const rows = __USER_ROWS_CACHE || [];
  if(!rows.length){ showToast('No tienes registros para consolidar.', 'warn'); return; }

  try {
    if (consolidadoState) consolidadoState.textContent = 'Generando consolidado...';
    const { doc, blob, filename } = await generarConsolidadoPDF(rows);

    const path = `consolidados/${userId}/registro_unificado_creditos.pdf`;
    const { error: upErr } = await sb.storage.from('comprobantes').upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if(upErr){
      console.warn('No se pudo subir consolidado:', upErr);
      if (consolidadoState) consolidadoState.textContent = 'Consolidado generado (sin subir).';
    } else {
      __CONSOLIDADO_PATH = path;
      if (consolidadoState) consolidadoState.textContent = 'Consolidado actualizado.';
    }

    savePdfMobile(doc, filename);
  } catch (e) {
    console.error(e);
    if (consolidadoState) consolidadoState.textContent = 'Error.';
    showToast('No se pudo generar el consolidado: ' + (e?.message || e), 'error');
  }
});

/* =======================================================
   Submit
======================================================= */
let __SUBMITTING = false;
const submitBtn = form?.querySelector('button[type="submit"]');

function resetSubmitBtn(originalText) {
  __SUBMITTING = false;
  if(submitBtn){ submitBtn.disabled = false; submitBtn.innerHTML = originalText || 'Registrar y generar constancia'; }
}

form?.addEventListener('submit', async (e)=>{
  e.preventDefault();

  if(__SUBMITTING) return;
  __SUBMITTING = true;
  const originalBtnText = submitBtn?.innerHTML || 'Registrar y generar constancia';
  if(submitBtn){ submitBtn.disabled = true; submitBtn.innerHTML = '<span class="verifying-spinner"></span> Registrando…'; }

  // Safety timeout: reset button after 45 seconds no matter what
  const safetyTimer = setTimeout(()=>{
    console.error('SUBMIT SAFETY TIMEOUT: resetting after 45s');
    showToast('La operación tardó demasiado. Revisa tu conexión e intenta de nuevo.', 'error');
    resetSubmitBtn(originalBtnText);
  }, 45000);

  try {
    console.log('[SUBMIT] 1. Iniciando...');
    const sb = getSupabaseClient();
    if(!sb){ showToast('Supabase no está disponible.', 'error'); return; }

    console.log('[SUBMIT] 2. Obteniendo sesión...');
    const sessionPromise = sb.auth.getSession();
    const sessionTimeout = new Promise((_, reject) => setTimeout(()=> reject(new Error('Timeout obteniendo sesión')), 10000));
    const { data: s } = await Promise.race([sessionPromise, sessionTimeout]);
    if(!s?.session){ showToast('Inicia sesión para registrar.', 'error'); return; }
    const user = s.session.user;

    console.log('[SUBMIT] 3. Leyendo campos...');
    const nombre = (document.getElementById('nombre')?.value||'').trim();
    const telefono = (document.getElementById('telefono')?.value||'').trim();
    const colegiadoNumero = (document.getElementById('colegiadoNumero')?.value||'').trim();
    const colegiadoActivo = (document.getElementById('colegiadoActivo')?.value || '').trim();
    const actividad = (document.getElementById('actividad')?.value||'').trim();
    const institucion = (document.getElementById('institucion')?.value||'').trim();
    const tipo = document.getElementById('tipo')?.value;
    const fecha = document.getElementById('fecha')?.value;
    const horas = Number(document.getElementById('horas')?.value);
    const observaciones = (obsEl?.value||'').trim();

    console.log('[SUBMIT] 4. Validando...', { nombre:!!nombre, telefono:!!telefono, colegiadoNumero:!!colegiadoNumero, colegiadoActivo:!!colegiadoActivo, actividad:!!actividad, institucion:!!institucion, tipo:!!tipo, fecha:!!fecha, horas });

    if(!nombre || !telefono || !colegiadoNumero || !colegiadoActivo || !actividad || !institucion || !tipo || !fecha || !horas){
      showToast('Complete todos los campos obligatorios (*), incluido la verificación del colegiado.', 'error'); return;
    }
    if (!__COLEGIADO_VERIFIED) {
      showToast('Debes verificar tu número de colegiado. Presiona "Verificar".', 'error');
      try { colegiadoEl?.scrollIntoView({ behavior:'smooth', block:'center' }); } catch {}
      return;
    }
    if (!/^\d+$/.test(colegiadoNumero)) {
      showToast('El número de colegiado solo debe contener números.', 'error'); return;
    }
    if(!phoneValidGT(telefono)){ showToast('Teléfono inválido (+502 ########)', 'error'); return; }
    if(!withinFiveYears(fecha)){ showToast('Fecha inválida (no futura, ≤ 5 años)', 'error'); return; }
    if(!(horas>=0.5 && horas<=200)){ showToast('Horas fuera de rango (0.5 a 200).', 'error'); return; }
    if(observaciones.length>250){ showToast('Observaciones exceden 250 caracteres.', 'error'); return; }

    if(!fileRef){
      showToast('Adjunte el comprobante (PDF/JPG/PNG) antes de registrar.', 'error');
      markUploaderError(true);
      try { upZone?.scrollIntoView({ behavior:'smooth', block:'center' }); } catch {}
      upZone?.focus?.();
      return;
    }
    if(!ALLOWED_MIME.includes(fileRef.type)){ showToast('Archivo no permitido.', 'error'); markUploaderError(true); return; }
    const sizeMB = fileRef.size/1024/1024;
    if(sizeMB>MAX_FILE_MB){ showToast('Archivo supera 10 MB.', 'error'); markUploaderError(true); return; }

    console.log('[SUBMIT] 5. Obteniendo correlativo...');
    if(submitBtn) submitBtn.innerHTML = '<span class="verifying-spinner"></span> Obteniendo correlativo…';
    const { data: corrData, error: corrErr } = await sb.rpc('next_correlativo');
    if(corrErr || !corrData){ showToast('No se pudo obtener correlativo: '+(corrErr?sbErrMsg(corrErr):''), 'error'); return; }
    const correlativo = corrData;

    const creditos = calcCreditos(horas);
    const hash = hashSimple(`${correlativo}|${nombre}|${telefono}|${fecha}|${horas}|${creditos}`);

    console.log('[SUBMIT] 6. Subiendo comprobante...');
    if(submitBtn) submitBtn.innerHTML = '<span class="verifying-spinner"></span> Subiendo comprobante…';
    let archivo_url = null, archivo_mime = null;
    {
      const safeName = fileRef.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      const path = `${user.id}/${correlativo}-${safeName}`;
      const { error: upErr } = await sb.storage.from('comprobantes').upload(path, fileRef, { contentType: fileRef.type, upsert:false });
      if(upErr){ showToast('No se pudo subir el archivo: '+sbErrMsg(upErr),'error'); return; }
      archivo_url = path; archivo_mime = fileRef.type;
    }

    console.log('[SUBMIT] 7. Insertando registro...');
    if(submitBtn) submitBtn.innerHTML = '<span class="verifying-spinner"></span> Guardando registro…';
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
    if(insErr){ console.error(insErr); showToast('No se pudo guardar el registro: '+sbErrMsg(insErr),'error'); return; }

    console.log('[SUBMIT] 8. Registro guardado OK. Generando PDF...');
    guardarDatosRapidos(user.id, nombre, telefono, colegiadoNumero);

    if(submitBtn) submitBtn.innerHTML = '<span class="verifying-spinner"></span> Generando constancia…';
    try {
      await Promise.race([
        generarConstanciaPDF(inserted, fileRef),
        new Promise((_, reject) => setTimeout(()=> reject(new Error('PDF timeout')), 15000))
      ]);
    } catch (pdfErr) {
      console.error('Error/timeout generando PDF:', pdfErr);
      showToast('Registro guardado ✅, pero la constancia no pudo generarse. Puedes regenerarla desde el historial.', 'warn');
    }

    console.log('[SUBMIT] 9. Limpiando formulario...');
    showToast('✅ Registro guardado y constancia generada.');

    form.reset(); if(preview) preview.innerHTML=''; if(creditosEl) creditosEl.value='';
    try { precargarDesdeLocalStorage(user.id); } catch {}
    try { restaurarVerificacionCacheada(); } catch {}
    fileRef = null; markUploaderError(false);

    console.log('[SUBMIT] 10. Recargando historial...');
    await loadAndRender().catch(e => console.warn('Error recargando historial:', e));

    try {
      await actualizarConsolidadoEnStorage(user.id, __USER_ROWS_CACHE);
    } catch (e) {
      console.warn('No se pudo actualizar consolidado automáticamente:', e);
    }
    console.log('[SUBMIT] ✅ Completado.');

  } catch (fatalErr) {
    console.error('Error fatal en submit:', fatalErr);
    showToast('Error: ' + (fatalErr?.message || 'Intenta de nuevo.'), 'error');
  } finally {
    clearTimeout(safetyTimer);
    resetSubmitBtn(originalBtnText);
  }
});

/* =======================================================
   Panel Admin (local y superadmin)
======================================================= */
function openAdmin(){ adminModal?.setAttribute('aria-hidden','false'); if(adminPass) adminPass.value=''; }
function closeAdminFn(){ adminModal?.setAttribute('aria-hidden','true'); if(adminBody) adminBody.hidden=true; if(adminAuth) adminAuth.hidden=false; if(adminPass) adminPass.value=''; }
openAdminBtn?.addEventListener('click', openAdmin);
closeAdmin?.addEventListener('click', closeAdminFn);
window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeAdminFn(); if(e.key.toLowerCase()==='a' && e.shiftKey && e.ctrlKey){ openAdmin(); } });

let currentAdminFilter = null;
let isSuperAdmin = false;
function updateAdminBadge(){
  if(adminModeBadge) adminModeBadge.textContent = `Modo: ${isSuperAdmin ? 'Superadmin' : 'Admin local'}`;
  if (userAdminPanel) userAdminPanel.hidden = !isSuperAdmin;
}

adminLogin?.addEventListener('click', async (ev)=>{
  ev.preventDefault();
  if((adminPass?.value||'').trim() !== ADMIN_PASSWORD){ showToast('Contraseña incorrecta','error'); return; }
  adminAuth.hidden = true; adminBody.hidden = false; isSuperAdmin = false; updateAdminBadge();
  await renderAdmin();
  showToast('Sesión admin local iniciada','ok');
});

superLogin?.addEventListener('click', async ()=>{
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  adminState.textContent = 'Verificando...';
  const email = (superEmail?.value||'').trim();
  const pass = (superPass?.value||'').trim();
  if(!email || !pass){ adminState.textContent = 'Escribe correo y contraseña'; return; }

  try {
    // Siempre intentar login con las credenciales proporcionadas
    const { error: loginErr } = await sb.auth.signInWithPassword({ email, password: pass });
    if(loginErr){
      adminState.textContent = 'Contraseña o correo incorrectos.';
      return;
    }

    const { data: me, error: uErr } = await sb.auth.getUser();
    if(uErr || !me?.user){
      adminState.textContent = 'Error obteniendo usuario: ' + (uErr ? sbErrMsg(uErr) : 'sin sesión');
      return;
    }

    const { data: perfil, error: pErr } = await sb
      .from('perfiles')
      .select('is_admin')
      .eq('user_id', me.user.id)
      .maybeSingle();

    if(pErr){
      adminState.textContent = 'Error leyendo perfil: ' + sbErrMsg(pErr);
      return;
    }
    if(!perfil?.is_admin){
      adminState.textContent = 'No tienes permisos de superadmin';
      return;
    }

    adminAuth.hidden = true; adminBody.hidden = false; isSuperAdmin = true; updateAdminBadge();
    currentAdminFilter = null;
    await renderAdmin();
    adminState.textContent = 'OK (superadmin)';
    showToast('Sesión superadmin iniciada','ok');

    // Actualizar botón de auth ya que se inició sesión
    updateAuthButton(true);
  } catch (e) {
    adminState.textContent = 'Error: ' + (e?.message || 'desconocido');
  }
});

/* --- Gestión de usuarios y roles --- */

userCheckBtn?.addEventListener('click', async ()=>{
  if(!isSuperAdmin){ showToast('Solo superadmin puede usar esta opción.', 'warn'); return; }
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  const email = (userAdminEmail?.value||'').trim();
  if(!email){ showToast('Ingresa el correo del usuario.', 'warn'); return; }
  try {
    if(userAdminState) userAdminState.textContent = 'Consultando...';
    const { data, error } = await sb.rpc('check_user_status', { target_email: email });
    if(error){ if(userAdminState) userAdminState.textContent = 'Error: ' + sbErrMsg(error); return; }
    if(userAdminState) userAdminState.textContent = data?.message || JSON.stringify(data);
  } catch (e) {
    if(userAdminState) userAdminState.textContent = 'Error: ' + (e?.message || e);
  }
});

userActivateBtn?.addEventListener('click', async ()=>{
  if(!isSuperAdmin){ showToast('Solo superadmin puede usar esta opción.', 'warn'); return; }
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  const email = (userAdminEmail?.value||'').trim();
  if(!email){ showToast('Ingresa el correo del usuario.', 'warn'); return; }
  const ok = confirm('¿Activar la cuenta de ' + email + '?\nEsta acción confirma su correo sin necesidad de verificación.');
  if(!ok) return;
  try {
    if(userAdminState) userAdminState.textContent = 'Activando...';
    const { data, error } = await sb.rpc('activate_user_by_email', { target_email: email });
    if(error){ if(userAdminState) userAdminState.textContent = 'Error: ' + sbErrMsg(error); return; }
    if(userAdminState) userAdminState.textContent = data?.message || 'Usuario activado.';
    if(data?.success) showToast(data.message, 'ok');
  } catch (e) {
    if(userAdminState) userAdminState.textContent = 'Error: ' + (e?.message || e);
  }
});

makeAdminBtn?.addEventListener('click', async ()=>{
  if(!isSuperAdmin){ showToast('Solo superadmin puede usar esta opción.', 'warn'); return; }
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  const email = (adminRoleEmail?.value||'').trim();
  if(!email){ showToast('Ingresa el correo del usuario.', 'warn'); return; }
  const ok = confirm('¿Asignar permisos de superadmin a ' + email + '?\n\nEsta persona podrá ver todos los registros, exportar datos y gestionar usuarios.');
  if(!ok) return;
  try {
    if(adminRoleState) adminRoleState.textContent = 'Procesando...';
    const { data, error } = await sb.rpc('make_user_admin', { target_email: email });
    if(error){ if(adminRoleState) adminRoleState.textContent = 'Error: ' + sbErrMsg(error); return; }
    if(adminRoleState) adminRoleState.textContent = data?.message || 'Superadmin asignado.';
    if(data?.success) showToast(data.message, 'ok');
  } catch (e) {
    if(adminRoleState) adminRoleState.textContent = 'Error: ' + (e?.message || e);
  }
});

removeAdminBtn?.addEventListener('click', async ()=>{
  if(!isSuperAdmin){ showToast('Solo superadmin puede usar esta opción.', 'warn'); return; }
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  const email = (adminRoleEmail?.value||'').trim();
  if(!email){ showToast('Ingresa el correo del usuario.', 'warn'); return; }
  const ok = confirm('¿Quitar permisos de superadmin a ' + email + '?\n\nEsta persona ya no podrá acceder al panel de administración.');
  if(!ok) return;
  try {
    if(adminRoleState) adminRoleState.textContent = 'Procesando...';
    const { data, error } = await sb.rpc('remove_user_admin', { target_email: email });
    if(error){ if(adminRoleState) adminRoleState.textContent = 'Error: ' + sbErrMsg(error); return; }
    if(adminRoleState) adminRoleState.textContent = data?.message || 'Permisos removidos.';
    if(data?.success) showToast(data.message, 'ok');
  } catch (e) {
    if(adminRoleState) adminRoleState.textContent = 'Error: ' + (e?.message || e);
  }
});

/* Render admin */
async function renderAdmin(){
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  let q = sb.from('registros').select('*').order('created_at', { ascending:false });
  if (currentAdminFilter) q = q.eq('correlativo', currentAdminFilter);
  if (__HAS_DELETED_AT) {
    if (!showDeleted?.checked) q = q.is('deleted_at', null);
  } else {
    if (showDeleted) showDeleted.disabled = true;
  }

  const { data: rows, error } = await q;
  if(error){
    exportStatus && (exportStatus.textContent='Error al cargar: '+sbErrMsg(error));
    showToast('No se pudieron cargar registros: '+sbErrMsg(error), 'error');
    if (diagBox) diagBox.textContent = 'Diagnóstico: ' + sbErrMsg(error);
    return;
  }
  adminTbody.innerHTML='';
  for(const r of rows || []){
    const estado = r.deleted_at ? 'Eliminado' : 'Activo';
    const dlBtn = r.archivo_url ? `<button class="btn" data-action="dl" data-path="${sanitize(r.archivo_url)}" type="button">Descargar</button>` : '';
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${sanitize(r.correlativo)}</td>
      <td>${sanitize(r.nombre)}</td>
      <td>${sanitize(r.telefono)}</td>
      <td>${sanitize(r.colegiado_numero||'')}</td>
      <td>${sanitize(r.colegiado_activo)}</td>
      <td title="${sanitize(r.actividad)}">${sanitize(r.actividad.slice(0,40))}${r.actividad.length>40?'…':''}</td>
      <td>${sanitize(r.institucion)}</td>
      <td>${sanitize(r.tipo)}</td>
      <td>${sanitize(r.fecha)}</td>
      <td>${r.horas}</td>
      <td>${r.creditos}</td>
      <td>${r.archivo_url||''}</td>
      <td class="mono">${sanitize(r.hash)}</td>
      <td>${estado}</td>
      <td>
        <button class="btn" data-id="${r.id}" data-action="pdf" type="button">PDF</button>
        ${dlBtn}
        ${r.deleted_at ? '' : `<button class="btn warn" data-id="${r.id}" data-corr="${sanitize(r.correlativo)}" data-action="del" type="button">Eliminar</button>`}
      </td>`;
    adminTbody.appendChild(tr);
  }

  if (diagBox) {
    diagBox.textContent = `Diagnóstico: deleted_at=${__HAS_DELETED_AT ? 'sí' : 'no'}. Registros cargados: ${rows?.length||0}.`;
  }
}

adminSearchBtn?.addEventListener('click', async ()=>{
  currentAdminFilter = (adminSearch?.value||'').trim() || null;
  await renderAdmin();
});
adminClearSearch?.addEventListener('click', async ()=>{
  currentAdminFilter = null; if(adminSearch) adminSearch.value=''; await renderAdmin();
});
adminSearch?.addEventListener('keydown', async (e)=>{
  if(e.key==='Enter'){ e.preventDefault(); adminSearchBtn?.click(); }
});
showDeleted?.addEventListener('change', ()=> renderAdmin());

document.getElementById('adminTable')?.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const action = btn.getAttribute('data-action');
  const id = btn.getAttribute('data-id');

  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }

  if(action==='pdf'){
    const { data: rows, error } = await sb.from('registros').select('*').eq('id', id).limit(1);
    if(error || !rows?.length) return showToast('Registro no disponible: '+(error?sbErrMsg(error):'no encontrado'),'error');
    await generarConstanciaPDF(rows[0]).catch(()=> showToast('Error al generar PDF','error'));
  }

  if(action==='dl'){
    const path = btn.getAttribute('data-path');
    await downloadComprobante(path);
  }

  if(action==='del'){
    const corr = btn.getAttribute('data-corr') || '—';
    const ok = confirm(`¿Eliminar (soft delete) el registro con correlativo ${corr}?`);
    if(!ok) return;
    const patch = __HAS_DELETED_AT ? { deleted_at: new Date().toISOString() } : {};
    const { error: upErr } = await sb.from('registros').update(patch).eq('id', id);
    if(upErr){ console.error(upErr); showToast('No se pudo eliminar (RLS): '+sbErrMsg(upErr),'error'); return; }
    showToast('Registro marcado como eliminado.');
    await renderAdmin();
  }
});

/* Exportar */
exportCSVBtn?.addEventListener('click', async ()=>{
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  let q = sb.from('registros').select('*').order('created_at',{ascending:false});
  if(__HAS_DELETED_AT && !showDeleted?.checked) q = q.is('deleted_at', null);
  if(currentAdminFilter) q = q.eq('correlativo', currentAdminFilter);
  const { data: rows, error } = await q;
  if(error){ showToast('Error al exportar (RLS): '+sbErrMsg(error),'error'); return; }
  if(!rows?.length) return showToast('Sin registros','warn');
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')].concat(
    rows.map(o=> `"${headers.map(h=>String(o[h]??'').replace(/"/g,'""')).join('","')}"`)
  ).join('\n');
  const blob = new Blob(["\ufeff"+csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`registros_cpg_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
  exportStatus && (exportStatus.textContent='CSV descargado');
});

exportXLSXBtn?.addEventListener('click', async ()=>{
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  let q = sb.from('registros').select('*').order('created_at',{ascending:false});
  if(__HAS_DELETED_AT && !showDeleted?.checked) q = q.is('deleted_at', null);
  if(currentAdminFilter) q = q.eq('correlativo', currentAdminFilter);
  const { data: rows, error } = await q;
  if(error){ showToast('Error al exportar (RLS): '+sbErrMsg(error),'error'); return; }
  if(!rows?.length) return showToast('Sin registros','warn');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registros');
  XLSX.writeFile(wb, `registros_cpg_${new Date().toISOString().slice(0,10)}.xlsx`);
  exportStatus && (exportStatus.textContent='Excel descargado');
});

/* =======================================================
   Descargar comprobante (signed URL)
======================================================= */
async function downloadComprobante(path){
  const sb = getSupabaseClient(); if(!sb){ showToast('Supabase no disponible.','error'); return; }
  if(!path){ showToast('No hay archivo asociado.','warn'); return; }
  try {
    const { data, error } = await sb.storage.from('comprobantes').createSignedUrl(path, 60*60);
    if(error || !data?.signedUrl){ showToast('No se pudo generar enlace de descarga: '+sbErrMsg(error),'error'); return; }
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  } catch (e) {
    showToast('Error al descargar: '+(e?.message||e),'error');
  }
}

/* =======================================================
   Helpers: obtener imagen del comprobante
======================================================= */
function savePdfMobile(doc, filename) {
  try {
    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
    if (isMobile) {
      const newTab = window.open(blobUrl, '_blank');
      if (!newTab) {
        const a = document.createElement('a');
        a.href = blobUrl; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 2000);
      } else {
        setTimeout(()=> URL.revokeObjectURL(blobUrl), 60000);
      }
    } else {
      const a = document.createElement('a');
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 2000);
    }
  } catch (e) {
    console.warn('Blob save failed, fallback to doc.save:', e);
    doc.save(filename);
  }
}

function blobToDataURL(blob){
  return new Promise((resolve)=>{
    const fr = new FileReader();
    fr.onload = ()=> resolve(fr.result);
    fr.onerror = ()=> resolve(null);
    fr.readAsDataURL(blob);
  });
}

async function pdfFirstPageToDataURL(blob, scale=1.4){
  if(!window.pdfjsLib) return null;
  const url = URL.createObjectURL(blob);
  try{
    const pdf = await pdfjsLib.getDocument({url}).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({scale});
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({canvasContext: ctx, viewport}).promise;
    return canvas.toDataURL('image/png');
  }catch(e){
    console.warn('pdf render fail', e); return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function getPreviewDataUrlFromLocal(file){
  if(!file) return null;
  if(file.type.startsWith('image/')) return await blobToDataURL(file);
  if(file.type === 'application/pdf') return await pdfFirstPageToDataURL(file);
  return null;
}

async function getPreviewDataUrlFromStorage(path){
  if(!path) return null;
  const sb = getSupabaseClient(); if(!sb) return null;
  const { data, error } = await sb.storage.from('comprobantes').createSignedUrl(path, 60*5);
  if(error || !data?.signedUrl) return null;
  try{
    const res = await fetch(data.signedUrl);
    const blob = await res.blob();
    if(blob.type.startsWith('image/')) return await blobToDataURL(blob);
    if(blob.type === 'application/pdf') return await pdfFirstPageToDataURL(blob);
  }catch(e){ return null; }
  return null;
}

/* =======================================================
   PDF + QR + LOGO + COMPROBANTE incrustado
======================================================= */
async function ensurePdfLogoDataUrl(){
  if (__PDF_LOGO_DATAURL !== null) return __PDF_LOGO_DATAURL;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const url = PDF_LOGO_URL;
    const dataUrl = await new Promise((resolve)=>{
      img.onload = ()=>{
        try{
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img,0,0);
          resolve(canvas.toDataURL('image/png'));
        }catch(e){ resolve(null); }
      };
      img.onerror = ()=> resolve(null);
      img.src = url + (url.includes('?') ? '&' : '?') + 'cachebust=' + Date.now();
    });
    __PDF_LOGO_DATAURL = dataUrl;
    return __PDF_LOGO_DATAURL;
  } catch {
    __PDF_LOGO_DATAURL = null;
    return null;
  }
}

async function generarConstanciaPDF(rec, localFileBlob){
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
    const qrDataUrl = await getQrDataUrl(verifyUrl, QR_SIZE);
    if (qrDataUrl) {
      doc.addImage(qrDataUrl, 'PNG', QR_X, QR_Y, QR_SIZE, QR_SIZE);
      doc.setFontSize(10); doc.setTextColor(120);
      doc.text('Verifique la autenticidad escaneando el código QR o visitando:', pad, 790);
      doc.text(verifyUrl, pad, 805, { maxWidth: 500 });
    }
  } catch (err) { console.warn('QR no pudo generarse:', err); }

  try {
    const logo = await ensurePdfLogoDataUrl();
    if (logo) {
      const logoY = QR_Y + QR_SIZE + LOGO_BELOW_GAP;
      doc.addImage(logo, 'PNG', QR_X, logoY, PDF_LOGO_W, PDF_LOGO_H);
    }
  } catch (e) { console.warn('No se pudo insertar logo en PDF:', e); }

  try {
    // Timeout evidence embedding at 8 seconds to prevent mobile hang
    const evidPromise = (async ()=>{
      let evidDataUrl = null;
      if (localFileBlob) {
        evidDataUrl = await getPreviewDataUrlFromLocal(localFileBlob);
      } else if (rec.archivo_url) {
        evidDataUrl = await getPreviewDataUrlFromStorage(rec.archivo_url);
      }
      return evidDataUrl;
    })();

    const timeoutPromise = new Promise(r => setTimeout(()=> r(null), 8000));
    const evidDataUrl = await Promise.race([evidPromise, timeoutPromise]);
    if (evidDataUrl) {
      doc.addPage();
      doc.setFont('helvetica','bold'); doc.setFontSize(12);
      doc.text('Comprobante adjunto', pad, pad);

      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const usableW = pageW - pad*2;
      const topY = pad + 12;

      const tmpImg = new Image();
      const loaded = new Promise(res => {
        tmpImg.onload = res; tmpImg.onerror = res;
        setTimeout(res, 5000); // Timeout for image load
      });
      tmpImg.src = evidDataUrl; await loaded;

      const imgW = tmpImg.naturalWidth || 1000;
      const imgH = tmpImg.naturalHeight || 1000;
      const aspect = imgW / imgH;

      let drawW = usableW;
      let drawH = drawW / aspect;
      const maxH = pageH - pad - topY;

      if (drawH > maxH) {
        const scale = maxH / drawH;
        drawW *= scale;
        drawH *= scale;
      }

      doc.addImage(evidDataUrl, 'PNG', pad, topY, drawW, drawH);
    }
  } catch (e) {
    console.warn('No se pudo incrustar comprobante:', e);
  }

  doc.setFontSize(10); doc.setTextColor(120);
  if (rec.hash) doc.text(`Hash: ${rec.hash}`, pad, 820);

  savePdfMobile(doc, `Constancia_${rec.correlativo}.pdf`);
}

/* =======================================================
   PDF consolidado
======================================================= */
function baseName(path){
  const p = String(path || '').split('?')[0];
  const parts = p.split('/');
  return parts[parts.length-1] || '—';
}

async function generarConsolidadoPDF(rows, yearFilter){
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF missing');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'pt', format:'a4' });
  const pad = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - pad*2;

  const sorted = [...(rows||[])].sort((a,b)=> new Date(a.created_at||a.fecha) - new Date(b.created_at||b.fecha));
  const last = sorted[sorted.length-1] || rows[0] || {};

  const totalCred = (rows||[]).reduce((acc, r)=> acc + (Number(r.creditos) || 0), 0);
  const totalCredRounded = Math.round(totalCred*100)/100;

  const titleSuffix = yearFilter ? ` — Año ${yearFilter}` : '';

  doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text('Registro unificado de Créditos Académicos' + titleSuffix, pad, 56);
  doc.setFont('helvetica','normal'); doc.setFontSize(11);
  doc.text('Colegio de Psicólogos de Guatemala — Artículo 16: 1 crédito = 16 horas', pad, 74);

  try {
    const logo = await ensurePdfLogoDataUrl();
    if (logo) doc.addImage(logo, 'PNG', pageW - pad - 64, 24, 64, 64);
  } catch {}

  const nombre = last.nombre || '—';
  const colegiado = (last.colegiado_numero ?? last.colegiadoNumero) || '—';
  const activo = (last.colegiado_activo ?? last.colegiadoActivo) || '—';

  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text('Datos del agremiado', pad, 104);
  doc.setFont('helvetica','normal'); doc.setFontSize(11);
  doc.text(`Nombre completo: ${nombre}`, pad, 124);
  doc.text(`Colegiado No.: ${colegiado} (Activo: ${activo})`, pad, 140);
  doc.text(`Fecha de emisión: ${new Date().toISOString().slice(0,10)}`, pad, 156);

  let y = 186;
  const rowH = 18;
  const col = {
    act: pad,
    inst: pad + Math.floor(usableW*0.36),
    horas: pad + Math.floor(usableW*0.66),
    cred: pad + Math.floor(usableW*0.76),
    docu: pad + Math.floor(usableW*0.86),
  };

  const drawHeader = ()=>{
    doc.setFont('helvetica','bold'); doc.setFontSize(10);
    doc.text('Actividad', col.act, y);
    doc.text('Institución', col.inst, y);
    doc.text('Horas', col.horas, y, { align:'right' });
    doc.text('Créditos', col.cred, y, { align:'right' });
    doc.text('Documento', col.docu, y);
    doc.setLineWidth(0.5);
    doc.line(pad, y+6, pageW-pad, y+6);
    y += rowH;
    doc.setFont('helvetica','normal'); doc.setFontSize(10);
  };

  drawHeader();

  for (const r of sorted) {
    if (y > pageH - 90) {
      doc.addPage();
      y = 60;
      drawHeader();
    }
    const actividad = String(r.actividad || '—');
    const institucion = String(r.institucion || '—');
    const horas = (Number(r.horas) || 0).toString();
    const creditos = (Math.round((Number(r.creditos)||0)*100)/100).toString();
    const docName = r.archivo_url ? baseName(r.archivo_url) : '—';

    const cut = (t, n)=> t.length>n ? (t.slice(0, n-1)+'…') : t;
    doc.text(cut(actividad, 38), col.act, y);
    doc.text(cut(institucion, 28), col.inst, y);
    doc.text(horas, col.horas, y, { align:'right' });
    doc.text(creditos, col.cred, y, { align:'right' });
    doc.text(cut(docName, 22), col.docu, y);
    y += rowH;
  }

  y += 10;
  doc.setLineWidth(0.8);
  doc.line(pad, y, pageW-pad, y);
  y += 18;
  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text(`Total de créditos acumulados${titleSuffix}: ${totalCredRounded}`, pad, y);

  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text('Este documento se actualiza cada vez que se registra una nueva actividad.', pad, pageH - 48);

  const yearTag = yearFilter ? `_${yearFilter}` : '';
  const filename = `Registro_Unificado_Creditos${yearTag}_${String(colegiado).replace(/[^0-9A-Za-z_-]/g,'') || 'CPG'}_${new Date().toISOString().slice(0,10)}.pdf`;
  const blob = doc.output('blob');
  return { doc, blob, filename };
}

async function actualizarConsolidadoEnStorage(userId, rows){
  const sb = getSupabaseClient(); if(!sb) throw new Error('Supabase no disponible');
  if(!userId) throw new Error('userId requerido');
  if(!rows?.length) return;
  const { blob } = await generarConsolidadoPDF(rows);
  const path = `consolidados/${userId}/registro_unificado_creditos.pdf`;
  const { error: upErr } = await sb.storage.from('comprobantes').upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if(upErr) throw upErr;
  __CONSOLIDADO_PATH = path;
}

/* Utilidades para QR */
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
   Carga inicial — NO usa localStorage para el modal.
   Siempre muestra el modal de entrada.
   Si hay sesión activa, después de aceptar va directo al form.
======================================================= */
(async function initAuthButton(){
  const sb = getSupabaseClient();
  if(!sb){ updateAuthButton(false); return; }
  const { data: s } = await sb.auth.getSession();
  const isLoggedIn = !!s?.session?.user;
  updateAuthButton(isLoggedIn);
  // No cargamos datos aún — esperamos a que acepten el modal
})();

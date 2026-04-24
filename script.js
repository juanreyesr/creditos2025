/* =======================================================
   Supabase init (lazy)
======================================================= */
let __CACHED_SESSION = null;

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

async function getCurrentUser() {
  if (__CACHED_SESSION?.user) return __CACHED_SESSION.user;
  try {
    const sb = getSupabaseClient();
    if (!sb) return null;
    const { data: s } = await Promise.race([
      sb.auth.getSession(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('session timeout')), 6000))
    ]);
    return s?.session?.user || null;
  } catch { return null; }
}

/* =======================================================
   Config / Utils
======================================================= */
const ADMIN_PASSWORD = "CAEDUC2025";
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
let __ENTRY_ACCEPTED = false;
let __APP_CONFIG = { video_guia_url: 'https://youtu.be/zitwRCdNgQc', reglamento_path: null };
let __USER_PROFILE = null; // { nombre, telefono, colegiado_numero, colegiado_activo, is_admin }
let __SETUP_VERIFIED_DATA = null; // temporal durante el setup
let __AUTH_MODAL_COLEGIADO_DATA = null; // temporal durante el flujo de login
const GUEST_COLEGIADO = '100000'; // número de prueba que salta verificación CPG

/* PDF.js worker */
window.addEventListener('load', () => {
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }
});

function sanitize(str) {
  return String(str || "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
}
function showToast(msg, type="info") {
  const el = document.getElementById('toast');
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.style.borderColor = type==="error"?"#f43f5e": type==="warn"?"#f59e0b":"#243055";
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}
function phoneValidGT(v) { return /^(?:\+?502)?\s?\d{8}$/.test(v.trim()); }
function withinFiveYears(dateStr) {
  const d = new Date(dateStr), now = new Date();
  if (isNaN(d) || d > now) return false;
  const past = new Date(); past.setFullYear(now.getFullYear()-5);
  return d >= past;
}
function calcCreditos(h) { const n = Number(h); if (!isFinite(n)||n<=0) return 0; return Math.round((n/16)*100)/100; }
function hashSimple(text) { let h = 0; for (let i = 0; i < text.length; i++) { h = (h<<5)-h + text.charCodeAt(i); h|=0; } return Math.abs(h).toString(36); }
function sbErrMsg(err) { return err?.message || err?.hint || err?.code || 'Error desconocido'; }

/* =======================================================
   Configuración de la app (cargada desde Supabase)
======================================================= */
async function loadConfig() {
  const sb = getSupabaseClient();
  if (!sb) return;
  try {
    const { data, error } = await sb.from('configuracion').select('clave,valor');
    if (error) { console.warn('No se pudo cargar configuracion:', error.message); return; }
    for (const row of (data || [])) {
      __APP_CONFIG[row.clave] = row.valor;
    }
    // Actualizar campo de configuración si el panel está visible
    const cfgVideo = document.getElementById('cfgVideoUrl');
    if (cfgVideo && __APP_CONFIG.video_guia_url) cfgVideo.value = __APP_CONFIG.video_guia_url;
    updateReglamentoStatus();
  } catch (e) {
    console.warn('loadConfig error:', e.message);
  }
}

function updateReglamentoStatus() {
  const box = document.getElementById('cfgReglamentoActual');
  if (!box) return;
  if (__APP_CONFIG.reglamento_path) {
    box.innerHTML = `<span style="color:#4ade80">✅ Documento cargado:</span> <code style="font-size:12px">${sanitize(__APP_CONFIG.reglamento_path)}</code>`;
    box.className = 'colegiado-info status-activo';
  } else {
    box.innerHTML = '<span style="color:#fca5a5">⚠️ No hay documento cargado aún.</span>';
    box.className = 'colegiado-info status-inactivo';
  }
}

/* =======================================================
   Video modal
======================================================= */
function youtubeEmbedUrl(url) {
  if (!url) return null;
  url = url.trim();
  // youtu.be/ID
  let m = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}?autoplay=1`;
  // youtube.com/watch?v=ID
  m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}?autoplay=1`;
  // youtube.com/embed/ID
  m = url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}?autoplay=1`;
  // Si no es YouTube, usar directamente como src del iframe
  return url;
}

function openVideoModal() {
  const embedUrl = youtubeEmbedUrl(__APP_CONFIG.video_guia_url || 'https://youtu.be/zitwRCdNgQc');
  const iframe = document.getElementById('videoIframe');
  if (iframe && embedUrl) iframe.src = embedUrl;
  openModal(document.getElementById('videoModal'));
}

function closeVideoModalFn() {
  const iframe = document.getElementById('videoIframe');
  if (iframe) iframe.src = ''; // stop video
  closeModal(document.getElementById('videoModal'));
}

document.getElementById('guiaBtn')?.addEventListener('click', openVideoModal);
document.getElementById('closeVideoModal')?.addEventListener('click', closeVideoModalFn);

/* =======================================================
   Reglamento download
======================================================= */
document.getElementById('reglamentoBtn')?.addEventListener('click', async () => {
  const path = __APP_CONFIG.reglamento_path;
  if (!path) {
    showToast('El reglamento aún no ha sido cargado por el administrador.', 'warn');
    return;
  }
  const sb = getSupabaseClient();
  if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  try {
    // Bucket público → URL directa
    const { data } = sb.storage.from('configuracion').getPublicUrl(path);
    const a = document.createElement('a');
    a.href = data.publicUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.download = 'Reglamento-CAEDUC.pdf';
    a.click();
  } catch (e) {
    showToast('No se pudo obtener el reglamento: ' + (e?.message || e), 'error');
  }
});

/* =======================================================
   Prefill datos personales
======================================================= */
function lsKey(userId, field) { return `creditos2025:${userId}:${field}`; }

function precargarDesdeLocalStorage(userId) {
  if (!userId) return;
  const elNombre = document.querySelector("#nombre");
  const elTelefono = document.querySelector("#telefono");
  const elColegiado = document.querySelector("#colegiadoNumero");
  if (elNombre && !elNombre.value) { const v = localStorage.getItem(lsKey(userId, "nombre")); if (v) elNombre.value = v; }
  if (elTelefono && !elTelefono.value) { const v = localStorage.getItem(lsKey(userId, "telefono")); if (v) elTelefono.value = v; }
  if (elColegiado && !elColegiado.value) { const v = localStorage.getItem(lsKey(userId, "colegiadoNumero")); if (v) elColegiado.value = v; }
}

function guardarDatosRapidos(userId, nombre, telefono, colegiadoNumero) {
  if (!userId) return;
  if (nombre) localStorage.setItem(lsKey(userId, "nombre"), nombre);
  if (telefono) localStorage.setItem(lsKey(userId, "telefono"), telefono);
  if (colegiadoNumero) localStorage.setItem(lsKey(userId, "colegiadoNumero"), colegiadoNumero);
}

function limpiarDatosRapidos(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(lsKey(userId, "nombre"));
    localStorage.removeItem(lsKey(userId, "telefono"));
    localStorage.removeItem(lsKey(userId, "colegiadoNumero"));
    localStorage.removeItem('cpg_colegiado_verificado');
  } catch {}
}

/* =======================================================
   Perfil de usuario (perfiles table)
======================================================= */
async function loadUserProfile(userId) {
  const sb = getSupabaseClient();
  if (!sb || !userId) return null;
  try {
    const { data } = await sb.from('perfiles')
      .select('nombre, telefono, colegiado_numero, colegiado_activo, is_admin')
      .eq('user_id', userId)
      .maybeSingle();
    __USER_PROFILE = data || null;
    return __USER_PROFILE;
  } catch { return null; }
}

async function saveUserProfile(userId, profileData) {
  const sb = getSupabaseClient();
  if (!sb || !userId) return new Error('Sin cliente');
  try {
    const { error } = await sb.from('perfiles')
      .upsert({ user_id: userId, ...profileData }, { onConflict: 'user_id' });
    if (!error) __USER_PROFILE = { ...(__USER_PROFILE || {}), ...profileData };
    return error;
  } catch (e) { return e; }
}

function applyProfileToUI(profile) {
  if (!profile) return;
  const inicial = (profile.nombre || '?').charAt(0).toUpperCase();
  const colegNum = profile.colegiado_numero || '—';
  const isActivo = profile.colegiado_activo === true || profile.colegiado_activo === 'Sí';

  // Badge en la nav
  const badge = document.getElementById('profileNavBadge');
  const navAvatar = document.getElementById('profileNavAvatar');
  const navName = document.getElementById('profileNavName');
  const navCol = document.getElementById('profileNavColegiado');
  if (badge) badge.style.display = '';
  if (navAvatar) navAvatar.textContent = inicial;
  if (navName) navName.textContent = profile.nombre || '—';
  if (navCol) navCol.textContent = 'Colegiado ' + colegNum;

  // Banner en el formulario
  const bannerAvatar = document.getElementById('profileBannerAvatar');
  const bannerName = document.getElementById('profileBannerName');
  const bannerCol = document.getElementById('profileBannerColegiado');
  const bannerStatus = document.getElementById('profileBannerStatus');
  if (bannerAvatar) bannerAvatar.textContent = inicial;
  if (bannerName) bannerName.textContent = profile.nombre || '—';
  if (bannerCol) bannerCol.textContent = 'Colegiado ' + colegNum;
  if (bannerStatus) {
    bannerStatus.style.display = '';
    bannerStatus.textContent = isActivo ? 'ACTIVO' : 'INACTIVO';
    bannerStatus.className = 'status-badge ' + (isActivo ? 'activo' : 'inactivo');
  }

  // Pre-rellenar campos del formulario
  const nombreEl = document.getElementById('nombre');
  const telefonoEl = document.getElementById('telefono');
  if (nombreEl && !nombreEl.value && profile.nombre) nombreEl.value = profile.nombre;
  if (telefonoEl && !telefonoEl.value && profile.telefono) telefonoEl.value = profile.telefono;
}

function showProfileSetupUI() {
  if (formSection) formSection.style.display = 'none';
  if (histSection) histSection.style.display = 'none';
  if (aulavirtualSection) aulavirtualSection.style.display = 'none';
  if (loginRequiredSection) loginRequiredSection.style.display = 'none';
  if (adminSection) adminSection.style.display = 'none';
  const setup = document.getElementById('profileSetupSection');
  if (setup) setup.style.display = '';
  const bar = document.getElementById('statsBar');
  if (bar) bar.style.display = 'none';
}

function showMainDashboardUI() {
  if (formSection) formSection.style.display = '';
  if (histSection) histSection.style.display = '';
  if (aulavirtualSection) aulavirtualSection.style.display = '';
  if (loginRequiredSection) loginRequiredSection.style.display = 'none';
  if (adminSection) adminSection.style.display = 'none';
  const setup = document.getElementById('profileSetupSection');
  if (setup) setup.style.display = 'none';
  const bar = document.getElementById('statsBar');
  if (bar) bar.style.display = '';
}

async function precargarDatosDesdeUltimoRegistro(userId) {
  const sb = getSupabaseClient();
  if (!sb || !userId) return;
  const { data, error } = await sb.from("registros").select("nombre, telefono, colegiado_numero").eq("usuario_id", userId).order("created_at", { ascending: false }).limit(1);
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

const verificarColegiadoBtn = document.getElementById('verificarColegiadoBtn');
const colegiadoInfoDiv = document.getElementById('colegiadoInfo');
const colegiadoInfoContent = document.getElementById('colegiadoInfoContent');
const colegiadoActivoHidden = document.getElementById('colegiadoActivoHidden');
let __COLEGIADO_VERIFIED = false;

// Admin
const adminModal = document.getElementById('adminModal');
const openAdminBtn = document.getElementById('openAdminBtn');
const closeAdmin = document.getElementById('closeAdmin');
const adminAuth = document.getElementById('adminAuth');
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

const userAdminEmail = document.getElementById('userAdminEmail');
const userCheckBtn = document.getElementById('userCheckBtn');
const userActivateBtn = document.getElementById('userActivateBtn');
const userAdminState = document.getElementById('userAdminState');
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
// Auth modal — paso 1 (colegiado)
const authStep1 = document.getElementById('authStep1');
const authStep2 = document.getElementById('authStep2');
const authColegiadoNum = document.getElementById('authColegiadoNum');
const authVerificarBtn = document.getElementById('authVerificarBtn');
const authColegiadoInfo = document.getElementById('authColegiadoInfo');
const authProceedBtn = document.getElementById('authProceedBtn');
const authBackBtn = document.getElementById('authBackBtn');
const authVerifiedName = document.getElementById('authVerifiedName');
const authVerifiedStatus = document.getElementById('authVerifiedStatus');
// Auth modal — estado correo enviado
const authLoginForm = document.getElementById('authLoginForm');
const authSignupSent = document.getElementById('authSignupSent');
const authVerifiedBanner = document.getElementById('authVerifiedBanner');

// Entry modal
const entryModal = document.getElementById('entryModal');
const entryAccept = document.getElementById('entryAccept');

// Sections
const mainNav = document.getElementById('mainNav');
const formSection = document.getElementById('formSection');
const histSection = document.getElementById('histSection');
const loginRequiredSection = document.getElementById('loginRequiredSection');
const loginRequiredBtn = document.getElementById('loginRequiredBtn');
const signupRequiredBtn = document.getElementById('signupRequiredBtn');
const adminSection = document.getElementById('adminSection');
const aulavirtualSection = document.getElementById('aulavirtualSection');

/* =======================================================
   UI State Management
======================================================= */
function showNav() { if (mainNav) mainNav.style.display = 'flex'; }
function hideNav() { if (mainNav) mainNav.style.display = 'none'; }

function showAuthenticatedUI() { showMainDashboardUI(); }

function showUnauthenticatedUI() {
  if (formSection) formSection.style.display = 'none';
  if (histSection) histSection.style.display = 'none';
  if (aulavirtualSection) aulavirtualSection.style.display = 'none';
  if (loginRequiredSection) loginRequiredSection.style.display = '';
  if (adminSection) adminSection.style.display = 'none';
  const setup = document.getElementById('profileSetupSection');
  if (setup) setup.style.display = 'none';
  const bar = document.getElementById('statsBar');
  if (bar) bar.style.display = 'none';
  const badge = document.getElementById('profileNavBadge');
  if (badge) badge.style.display = 'none';
}

function hideAllContent() {
  if (formSection) formSection.style.display = 'none';
  if (histSection) histSection.style.display = 'none';
  if (aulavirtualSection) aulavirtualSection.style.display = 'none';
  if (loginRequiredSection) loginRequiredSection.style.display = 'none';
  if (adminSection) adminSection.style.display = 'none';
  const setup = document.getElementById('profileSetupSection');
  if (setup) setup.style.display = 'none';
  const bar = document.getElementById('statsBar');
  if (bar) bar.style.display = 'none';
}

const aulaVirtualNavBtn = document.getElementById('aulaVirtualNavBtn');

function updateAuthButton(isLoggedIn) {
  if (!authBtn) return;
  if (isLoggedIn) {
    authBtn.innerHTML = '<span class="nav-icon">👤</span> Mi sesión';
    authBtn.classList.add('session-active-btn');
    authBtn.classList.remove('primary-nav');
  } else {
    authBtn.innerHTML = '<span class="nav-icon">🔐</span> Iniciar sesión';
    authBtn.classList.remove('session-active-btn');
    authBtn.classList.add('primary-nav');
  }
  if (aulaVirtualNavBtn) aulaVirtualNavBtn.style.display = isLoggedIn ? '' : 'none';
}

aulaVirtualNavBtn?.addEventListener('click', async () => {
  const sb = getSupabaseClient(); if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { showToast('Inicia sesión primero.', 'warn'); return; }
  const colegiado = __USER_PROFILE?.colegiado_numero || '';
  const nombre = __USER_PROFILE?.nombre || '';
  const hash = `access_token=${session.access_token}&refresh_token=${session.refresh_token}&token_type=bearer&expires_in=${session.expires_in || 3600}&type=magiclink`;
  const query = colegiado ? `?sso_colegiado=${encodeURIComponent(colegiado)}&sso_nombre=${encodeURIComponent(nombre)}` : '';
  window.location.href = `https://aulavirtualcpg.org/${query}#${hash}`;
});

async function applyUIState() {
  if (!__ENTRY_ACCEPTED) { hideNav(); hideAllContent(); return; }
  showNav();
  const sb = getSupabaseClient();
  if (!sb) { showUnauthenticatedUI(); updateAuthButton(false); return; }
  const currentUser = await getCurrentUser();
  const isLoggedIn = !!currentUser;
  updateAuthButton(isLoggedIn);
  if (!isLoggedIn) { showUnauthenticatedUI(); return; }

  const profile = await loadUserProfile(currentUser.id);

  // SSO desde Aula Virtual o pendingColData (Google OAuth redirect): si no hay perfil, auto-guardarlo
  if (!profile?.colegiado_numero) {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const ssoColegiado = urlParams.get('sso_colegiado');
      const ssoNombre = decodeURIComponent(urlParams.get('sso_nombre') || '');
      if (ssoColegiado) {
        await saveUserProfile(currentUser.id, {
          colegiado_numero: ssoColegiado,
          nombre: ssoNombre || '',
          colegiado_activo: true,
        });
        window.history.replaceState(null, '', window.location.pathname);
        await loadUserProfile(currentUser.id);
      } else {
        await handlePostAuthColData(currentUser.id);
        await loadUserProfile(currentUser.id);
      }
    } catch {}
  }

  if (__USER_PROFILE?.colegiado_numero) {
    applyProfileToUI(__USER_PROFILE);
    showMainDashboardUI();
    await loadAndRender();
    loadAulaVirtualCerts(); // carga en segundo plano
  } else {
    showProfileSetupUI();
  }
}

/* =======================================================
   Admin section (sub-menú)
======================================================= */
let isSuperAdmin = false;

function openAdminSection() {
  if (formSection) formSection.style.display = 'none';
  if (histSection) histSection.style.display = 'none';
  if (aulavirtualSection) aulavirtualSection.style.display = 'none';
  if (loginRequiredSection) loginRequiredSection.style.display = 'none';
  if (adminSection) adminSection.style.display = '';
  const setup = document.getElementById('profileSetupSection');
  if (setup) setup.style.display = 'none';
  const bar = document.getElementById('statsBar');
  if (bar) bar.style.display = 'none';
  // Load config fields
  const cfgVideo = document.getElementById('cfgVideoUrl');
  if (cfgVideo && __APP_CONFIG.video_guia_url) cfgVideo.value = __APP_CONFIG.video_guia_url;
  updateReglamentoStatus();
  renderAdmin();
}

function closeAdminSection() {
  if (adminSection) adminSection.style.display = 'none';
  // Restore appropriate main UI
  if (__ENTRY_ACCEPTED) applyUIState();
}

function updateAdminBadge() {
  if (!adminModeBadge) return;
  if (isSuperAdmin) {
    adminModeBadge.textContent = 'Superadmin';
    adminModeBadge.className = 'admin-mode-badge';
  } else {
    adminModeBadge.textContent = 'Admin local';
    adminModeBadge.className = 'admin-mode-badge local';
  }
}

// Tab switching
document.getElementById('adminTabs')?.addEventListener('click', e => {
  const btn = e.target.closest('.admin-tab-btn');
  if (!btn) return;
  const tab = btn.getAttribute('data-tab');
  showAdminTab(tab);
});

function showAdminTab(tabId) {
  document.querySelectorAll('.admin-tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.admin-tab-panel').forEach(p => {
    p.style.display = p.id === `adminTab-${tabId}` ? '' : 'none';
  });
  // Load registros only when that tab is shown
  if (tabId === 'registros') renderAdmin();
}

// Volver al inicio
document.getElementById('backToMainBtn')?.addEventListener('click', () => {
  closeAdminSection();
});

// Open admin → show auth modal
function openAdmin() {
  openModal(adminModal);
  if (adminPass) adminPass.value = '';
  if (adminState) adminState.textContent = '—';
}

closeAdmin?.addEventListener('click', () => closeModal(adminModal));
openAdminBtn?.addEventListener('click', openAdmin);

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal(adminModal);
  if (e.key.toLowerCase() === 'a' && e.shiftKey && e.ctrlKey) openAdmin();
});

let currentAdminFilter = null;

adminLogin?.addEventListener('click', async ev => {
  ev.preventDefault();
  if ((adminPass?.value || '').trim() !== ADMIN_PASSWORD) { showToast('Contraseña incorrecta', 'error'); return; }
  isSuperAdmin = false;
  updateAdminBadge();
  closeModal(adminModal);
  openAdminSection();
  showAdminTab('registros');
  showToast('Sesión admin local iniciada');
});

superLogin?.addEventListener('click', async () => {
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  if (adminState) adminState.textContent = 'Verificando...';
  const email = (superEmail?.value || '').trim();
  const pass = (superPass?.value || '').trim();
  if (!email || !pass) { if (adminState) adminState.textContent = 'Escribe correo y contraseña'; return; }
  try {
    const { error: loginErr } = await sb.auth.signInWithPassword({ email, password: pass });
    if (loginErr) { if (adminState) adminState.textContent = 'Contraseña o correo incorrectos.'; return; }
    const { data: me, error: uErr } = await sb.auth.getUser();
    if (uErr || !me?.user) { if (adminState) adminState.textContent = 'Error obteniendo usuario: ' + (uErr ? sbErrMsg(uErr) : 'sin sesión'); return; }
    const { data: perfil, error: pErr } = await sb.from('perfiles').select('is_admin').eq('user_id', me.user.id).maybeSingle();
    if (pErr) { if (adminState) adminState.textContent = 'Error leyendo perfil: ' + sbErrMsg(pErr); return; }
    if (!perfil?.is_admin) { if (adminState) adminState.textContent = 'No tienes permisos de superadmin'; return; }
    isSuperAdmin = true;
    updateAdminBadge();
    currentAdminFilter = null;
    closeModal(adminModal);
    openAdminSection();
    showAdminTab('registros');
    if (adminState) adminState.textContent = 'OK (superadmin)';
    showToast('Sesión superadmin iniciada');
    updateAuthButton(true);
  } catch (e) {
    if (adminState) adminState.textContent = 'Error: ' + (e?.message || 'desconocido');
  }
});

/* =======================================================
   Configuración: guardar video URL
======================================================= */
document.getElementById('cfgSaveVideoBtn')?.addEventListener('click', async () => {
  if (!isSuperAdmin) { showToast('Solo superadmin puede cambiar la configuración.', 'warn'); return; }
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  const url = (document.getElementById('cfgVideoUrl')?.value || '').trim();
  if (!url) { showToast('Ingresa una URL válida.', 'warn'); return; }
  const stateEl = document.getElementById('cfgVideoState');
  if (stateEl) stateEl.textContent = 'Guardando…';
  const { error } = await sb.from('configuracion').upsert({ clave: 'video_guia_url', valor: url, updated_at: new Date().toISOString() });
  if (error) { if (stateEl) stateEl.textContent = 'Error: ' + sbErrMsg(error); return; }
  __APP_CONFIG.video_guia_url = url;
  if (stateEl) stateEl.textContent = '✅ Guardado correctamente';
  showToast('URL del video actualizada.');
});

document.getElementById('cfgPreviewVideoBtn')?.addEventListener('click', () => {
  const url = (document.getElementById('cfgVideoUrl')?.value || '').trim() || __APP_CONFIG.video_guia_url;
  if (!url) { showToast('No hay URL para previsualizar.', 'warn'); return; }
  const tmp = __APP_CONFIG.video_guia_url;
  __APP_CONFIG.video_guia_url = url; // temporal
  openVideoModal();
  __APP_CONFIG.video_guia_url = tmp;
});

/* =======================================================
   Configuración: subir reglamento PDF
======================================================= */
document.getElementById('cfgUploadReglamentoBtn')?.addEventListener('click', async () => {
  if (!isSuperAdmin) { showToast('Solo superadmin puede subir documentos.', 'warn'); return; }
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  const fileInput = document.getElementById('cfgReglamentoFile');
  const file = fileInput?.files?.[0];
  if (!file) { showToast('Selecciona un archivo PDF primero.', 'warn'); return; }
  if (file.type !== 'application/pdf') { showToast('Solo se permiten archivos PDF.', 'error'); return; }
  const mb = file.size / 1024 / 1024;
  if (mb > 20) { showToast('El archivo supera 20 MB.', 'error'); return; }
  const stateEl = document.getElementById('cfgReglamentoState');
  const uploadBtn = document.getElementById('cfgUploadReglamentoBtn');
  if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.innerHTML = '<span class="verifying-spinner"></span> Subiendo…'; }
  if (stateEl) stateEl.textContent = 'Subiendo…';
  try {
    // Get fresh token
    const { data: s } = await sb.auth.getSession();
    const accessToken = s?.session?.access_token;
    if (!accessToken) { showToast('Sesión expirada. Inicia sesión de nuevo.', 'error'); return; }
    const path = 'reglamento/Reglamento-CAEDUC.pdf';
    const storageUrl = `${window.SB_URL}/storage/v1/object/configuracion/${path}`;
    const uploadResult = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', storageUrl, true);
      xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.upload.onprogress = e => {
        if (e.lengthComputable && stateEl) {
          stateEl.textContent = `Subiendo ${Math.round(e.loaded/e.total*100)}%…`;
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve({ error: null });
        else {
          let msg = 'Error ' + xhr.status;
          try { const j = JSON.parse(xhr.responseText); msg = j.message || j.error || msg; } catch {}
          resolve({ error: msg });
        }
      };
      xhr.onerror = () => reject(new Error('Error de red'));
      xhr.timeout = 120000;
      xhr.ontimeout = () => reject(new Error('Timeout'));
      xhr.send(file);
    });
    if (uploadResult.error) { if (stateEl) stateEl.textContent = 'Error: ' + uploadResult.error; return; }
    // Save path in configuracion table
    const { error: dbErr } = await sb.from('configuracion').upsert({ clave: 'reglamento_path', valor: path, updated_at: new Date().toISOString() });
    if (dbErr) { if (stateEl) stateEl.textContent = 'Subido, pero error al guardar ruta: ' + sbErrMsg(dbErr); return; }
    __APP_CONFIG.reglamento_path = path;
    if (stateEl) stateEl.textContent = '✅ Reglamento actualizado correctamente';
    updateReglamentoStatus();
    showToast('Reglamento CAEDUC subido y actualizado.');
    if (fileInput) fileInput.value = '';
  } catch (e) {
    if (stateEl) stateEl.textContent = 'Error: ' + (e?.message || e);
  } finally {
    if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = 'Subir y reemplazar'; }
  }
});

/* =======================================================
   Inicialización UI
======================================================= */
(function () {
  const now = new Date();
  if (fechaEl) fechaEl.max = now.toISOString().slice(0, 10);
  try { adminModal?.setAttribute('aria-hidden', 'true'); authModal?.setAttribute('aria-hidden', 'true'); } catch {}
  hideNav();
  hideAllContent();
  openModal(entryModal);
})();

entryAccept?.addEventListener('click', async () => {
  __ENTRY_ACCEPTED = true;
  closeModal(entryModal);
  await applyUIState();
});

loginRequiredBtn?.addEventListener('click', () => { openAuthModal(); });
signupRequiredBtn?.addEventListener('click', () => { openAuthModal(); });

if (horasEl && creditosEl) {
  horasEl.addEventListener('input', () => creditosEl.value = calcCreditos(horasEl.value));
}

if (colegiadoEl) {
  colegiadoEl.addEventListener('input', () => { colegiadoEl.value = colegiadoEl.value.replace(/[^0-9]/g, ''); });
  colegiadoEl.addEventListener('keydown', e => {
    if ([8,9,13,27,46].includes(e.keyCode)) return;
    if ((e.ctrlKey || e.metaKey) && [65,67,86,88].includes(e.keyCode)) return;
    if (e.keyCode >= 35 && e.keyCode <= 40) return;
    if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) e.preventDefault();
  });
  colegiadoEl.addEventListener('paste', () => { setTimeout(() => { colegiadoEl.value = colegiadoEl.value.replace(/[^0-9]/g, ''); }, 0); });
  colegiadoEl.addEventListener('input', () => {
    __COLEGIADO_VERIFIED = false;
    habilitarFormulario(false);
    const activoEl = document.getElementById('colegiadoActivo');
    if (activoEl) { activoEl.value = ''; activoEl.style.color = 'var(--muted)'; }
    if (colegiadoActivoHidden) colegiadoActivoHidden.value = '';
    if (colegiadoInfoDiv) { colegiadoInfoDiv.style.display = 'none'; colegiadoInfoDiv.className = 'colegiado-info'; }
  });
}

/* =======================================================
   Verificación de colegiado
======================================================= */
const datosPersonalesFs = document.getElementById('datosPersonalesFieldset');
const actividadFs = document.getElementById('actividadFieldset');

function habilitarFormulario(habilitar) {
  if (datosPersonalesFs) datosPersonalesFs.disabled = !habilitar;
  if (actividadFs) actividadFs.disabled = !habilitar;
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
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (Date.now() - d.ts > 24*60*60*1000) { localStorage.removeItem('cpg_colegiado_verificado'); return null; }
    return d;
  } catch { return null; }
}

function aplicarResultadoVerificacion(numero, data, fromCache) {
  const activoEl = document.getElementById('colegiadoActivo');
  const nombreEl = document.getElementById('nombre');
  const estatus = (data.estatus || '').toUpperCase();
  const isActivo = estatus === 'ACTIVO';
  if (activoEl) { activoEl.value = isActivo ? 'Sí' : 'No'; activoEl.style.color = isActivo ? '#4ade80' : '#fca5a5'; }
  if (colegiadoActivoHidden) colegiadoActivoHidden.value = isActivo ? 'Sí' : 'No';
  __COLEGIADO_VERIFIED = true;
  if (data.nombre && nombreEl) nombreEl.value = data.nombre;
  habilitarFormulario(true);
  if (colegiadoInfoDiv) { colegiadoInfoDiv.style.display = 'block'; colegiadoInfoDiv.className = `colegiado-info ${isActivo ? 'status-activo' : 'status-inactivo'}`; }
  let html = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">`;
  html += `<strong>Colegiado No. ${sanitize(data.numero || numero)}</strong>`;
  html += `<span class="status-badge ${isActivo ? 'activo' : 'inactivo'}">${sanitize(estatus)}</span>`;
  if (fromCache) html += `<span style="font-size:11px;color:var(--muted)">(verificación en caché)</span>`;
  html += `</div>`;
  if (data.nombre) html += `<div class="info-row"><span class="info-label">Nombre:</span><span class="info-value">${sanitize(data.nombre)}</span></div>`;
  if (data.fecha_colegiacion) html += `<div class="info-row"><span class="info-label">Fecha colegiación:</span><span class="info-value">${sanitize(data.fecha_colegiacion)}</span></div>`;
  if (data.ultimo_pago) html += `<div class="info-row"><span class="info-label">Último pago:</span><span class="info-value">${sanitize(data.ultimo_pago)}</span></div>`;
  if (!isActivo) html += `<p style="margin:10px 0 0;color:#fca5a5;font-size:13px">⚠️ Tu estatus aparece como <strong>INACTIVO</strong> en la base del Colegio. Si crees que es un error, contacta al CPG.</p>`;
  if (colegiadoInfoContent) colegiadoInfoContent.innerHTML = html;
}

async function verificarColegiado(numero) {
  if (!numero || !/^\d+$/.test(numero)) { showToast('Ingresa un número de colegiado válido.', 'warn'); return; }
  const activoEl = document.getElementById('colegiadoActivo');
  const btn = verificarColegiadoBtn;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="verifying-spinner"></span>Verificando…'; }
  if (colegiadoInfoDiv) { colegiadoInfoDiv.style.display = 'block'; colegiadoInfoDiv.className = 'colegiado-info'; }
  if (colegiadoInfoContent) colegiadoInfoContent.innerHTML = '<span class="verifying-spinner"></span> Consultando estado en la base del Colegio de Psicólogos…';
  try {
    const url = window.SB_URL + '/functions/v1/consultar-colegiado';
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: numero }) });
    const data = await res.json();
    if (!res.ok || data.error) {
      __COLEGIADO_VERIFIED = false; habilitarFormulario(false);
      if (activoEl) activoEl.value = '';
      if (colegiadoActivoHidden) colegiadoActivoHidden.value = '';
      if (colegiadoInfoDiv) colegiadoInfoDiv.className = 'colegiado-info status-error';
      if (colegiadoInfoContent) colegiadoInfoContent.innerHTML = `<strong>⚠️ ${data.error || 'No se pudo verificar'}</strong><br><span class="muted">Verifica que el número sea correcto e intenta de nuevo.</span>`;
      return;
    }
    aplicarResultadoVerificacion(numero, data, false);
    guardarVerificacionLocal(numero, data);
  } catch (e) {
    console.error('Error verificando colegiado:', e);
    __COLEGIADO_VERIFIED = false; habilitarFormulario(false);
    if (activoEl) activoEl.value = '';
    if (colegiadoActivoHidden) colegiadoActivoHidden.value = '';
    if (colegiadoInfoDiv) colegiadoInfoDiv.className = 'colegiado-info status-error';
    if (colegiadoInfoContent) colegiadoInfoContent.innerHTML = `<strong>⚠️ Error de conexión</strong><br><span class="muted">No se pudo conectar con el servicio. Intenta de nuevo.</span>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Verificar'; }
  }
}

function restaurarVerificacionCacheada() {
  const cached = obtenerVerificacionLocal();
  if (!cached) return;
  const currentVal = (colegiadoEl?.value || '').trim();
  if (currentVal && currentVal !== cached.numero) return;
  if (colegiadoEl && !currentVal) colegiadoEl.value = cached.numero;
  aplicarResultadoVerificacion(cached.numero, cached, true);
}

verificarColegiadoBtn?.addEventListener('click', () => { verificarColegiado((colegiadoEl?.value || '').trim()); });
colegiadoEl?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); verificarColegiadoBtn?.click(); } });

(async function detectDeletedAt() {
  const sb = getSupabaseClient(); if (!sb) return;
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
   Uploader
======================================================= */
function markUploaderError(on = true) {
  if (!upZone) return;
  upZone.style.transition = 'border-color .2s';
  upZone.style.borderColor = on ? '#f43f5e' : '#334155';
}
browseBtn?.addEventListener('click', () => fileInput?.click());
upZone?.addEventListener('click', e => { if (e.target && e.target.id === 'browseBtn') return; fileInput?.click(); });
['dragenter','dragover'].forEach(ev => upZone?.addEventListener(ev, e => { e.preventDefault(); if (upZone) upZone.style.borderColor = '#60a5fa'; }));
['dragleave','drop'].forEach(ev => upZone?.addEventListener(ev, e => { e.preventDefault(); if (upZone) upZone.style.borderColor = '#334155'; if (ev === 'drop') handleFile(e.dataTransfer.files?.[0] || null); }));
fileInput?.addEventListener('change', e => handleFile(e.target.files?.[0] || null));
upZone?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput?.click(); } });

function compressImage(file, maxWidthPx = 1600, quality = 0.75, maxSizeKB = 800) {
  return new Promise(resolve => {
    if (!file.type.startsWith('image/')) { resolve(file); return; }
    if (file.size / 1024 <= maxSizeKB) { resolve(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > maxWidthPx) { h = Math.round(h * (maxWidthPx / w)); w = maxWidthPx; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return; }
          const compressed = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });
          resolve(compressed);
        }, 'image/jpeg', quality);
      } catch { resolve(file); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

function handleFile(file) {
  if (!preview) return;
  preview.innerHTML = ''; fileRef = null;
  if (!file) { markUploaderError(true); return; }
  if (!ALLOWED_MIME.includes(file.type)) { showToast('Tipo no permitido. Solo PDF/JPG/PNG.', 'error'); markUploaderError(true); return; }
  if (file.size/1024/1024 > MAX_FILE_MB) { showToast('Archivo supera 10 MB.', 'error'); markUploaderError(true); return; }
  compressImage(file).then(compressed => {
    fileRef = compressed; markUploaderError(false);
    if (compressed.type === 'application/pdf') {
      const emb = document.createElement('embed');
      emb.src = URL.createObjectURL(compressed); emb.type = 'application/pdf'; emb.className = 'pdf';
      preview.appendChild(emb);
    } else {
      const img = document.createElement('img');
      img.className = 'thumb'; img.alt = 'Vista previa'; img.src = URL.createObjectURL(compressed);
      preview.appendChild(img);
      if (compressed.size < file.size) showToast(`Imagen optimizada (${Math.round((file.size-compressed.size)/1024)}KB reducidos) para subida rápida.`);
    }
  });
}

/* =======================================================
   Auth UI
======================================================= */
function openModal(m) { m?.setAttribute('aria-hidden', 'false'); }
function closeModal(m) { m?.setAttribute('aria-hidden', 'true'); if (authState) authState.textContent = '—'; }

function showAuthSignupSentUI(email) {
  const emailEl = document.getElementById('authSignupEmail');
  const stateEl = document.getElementById('authResendState');
  if (emailEl) emailEl.textContent = email || '';
  if (stateEl) stateEl.textContent = '';
  if (authLoginForm) authLoginForm.style.display = 'none';
  if (authSignupSent) authSignupSent.style.display = '';
}
function hideAuthSignupSentUI() {
  if (authLoginForm) authLoginForm.style.display = '';
  if (authSignupSent) authSignupSent.style.display = 'none';
}

function resetAuthModal() {
  if (authStep1) authStep1.style.display = '';
  if (authStep2) authStep2.style.display = 'none';
  if (authColegiadoNum) authColegiadoNum.value = '';
  if (authColegiadoInfo) { authColegiadoInfo.style.display = 'none'; authColegiadoInfo.innerHTML = ''; }
  if (authProceedBtn) authProceedBtn.style.display = 'none';
  const guestDiv = document.getElementById('authGuestNameDiv');
  const guestInput = document.getElementById('authGuestName');
  if (guestDiv) guestDiv.style.display = 'none';
  if (guestInput) guestInput.value = '';
  hideAuthSignupSentUI();
  __AUTH_MODAL_COLEGIADO_DATA = null;
}
function openAuthModal() { resetAuthModal(); openModal(authModal); }

authBtn?.addEventListener('click', async () => {
  const sb = getSupabaseClient();
  if (!sb) { showToast('No se pudo inicializar autenticación.', 'error'); return; }
  const currentUser = await getCurrentUser();
  if (currentUser) {
    const ok = confirm('¿Deseas cerrar sesión en este dispositivo?');
    if (!ok) return;
    const userId = currentUser.id;
    const { error } = await sb.auth.signOut();
    if (error) { showToast('No se pudo cerrar sesión: ' + sbErrMsg(error), 'error'); return; }
    __USER_PROFILE = null;
    limpiarDatosRapidos(userId);
    try { form?.reset(); } catch {}
    if (preview) preview.innerHTML = '';
    if (creditosEl) creditosEl.value = '';
    if (tablaBody) tablaBody.innerHTML = '';
    if (totalCreditosLabel) totalCreditosLabel.textContent = 'Total créditos acumulados: 0';
    if (downloadConsolidadoBtn) downloadConsolidadoBtn.disabled = true;
    if (downloadByYearBtn) downloadByYearBtn.disabled = true;
    hideYearSelector();
    if (consolidadoState) consolidadoState.textContent = '—';
    showToast('Sesión cerrada.');
    updateAuthButton(false);
    showUnauthenticatedUI();
    return;
  }
  openAuthModal();
});

closeAuth?.addEventListener('click', () => closeModal(authModal));
authPass2?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin?.click(); });

// ── Paso 1: verificar colegiado ───────────────────────────────────────────────
authColegiadoNum?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); authVerificarBtn?.click(); } });

authVerificarBtn?.addEventListener('click', async () => {
  const numero = (authColegiadoNum?.value || '').trim();
  if (!numero || !/^\d+$/.test(numero)) { showToast('Ingresa un número de colegiado válido (solo números).', 'warn'); return; }

  // Colegiado de prueba: salta CPG y pide nombre
  if (numero === GUEST_COLEGIADO) {
    if (authColegiadoInfo) {
      authColegiadoInfo.style.display = 'block';
      authColegiadoInfo.className = 'colegiado-info status-activo';
      authColegiadoInfo.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <strong>No. ${GUEST_COLEGIADO} — Acceso de prueba</strong>
          <span class="status-badge activo">ACTIVO</span>
        </div>
        <p style="margin:6px 0 0;font-size:12px;color:#94a3b8">Este número no requiere verificación con el CPG.</p>`;
    }
    const guestDiv = document.getElementById('authGuestNameDiv');
    if (guestDiv) guestDiv.style.display = '';
    if (authProceedBtn) authProceedBtn.style.display = 'none';
    return;
  }

  if (authVerificarBtn) { authVerificarBtn.disabled = true; authVerificarBtn.innerHTML = '<span class="verifying-spinner"></span>'; }
  if (authColegiadoInfo) { authColegiadoInfo.style.display = 'block'; authColegiadoInfo.className = 'colegiado-info'; authColegiadoInfo.innerHTML = '<span class="verifying-spinner"></span> Consultando en el Colegio de Psicólogos…'; }
  if (authProceedBtn) authProceedBtn.style.display = 'none';
  __AUTH_MODAL_COLEGIADO_DATA = null;
  try {
    const res = await fetch(window.SB_URL + '/functions/v1/consultar-colegiado', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: numero })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      if (authColegiadoInfo) { authColegiadoInfo.className = 'colegiado-info status-error'; authColegiadoInfo.innerHTML = `<strong>⚠️ ${sanitize(data.error || 'No se pudo verificar')}</strong><br><span class="muted">Verifica que el número sea correcto.</span>`; }
      return;
    }
    const estatus = (data.estatus || '').toUpperCase();
    const isActivo = estatus === 'ACTIVO';
    __AUTH_MODAL_COLEGIADO_DATA = { numero, nombre: data.nombre || '', activo: isActivo, estatus };
    if (authColegiadoInfo) {
      authColegiadoInfo.className = `colegiado-info ${isActivo ? 'status-activo' : 'status-inactivo'}`;
      authColegiadoInfo.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <strong>No. ${sanitize(numero)}</strong>
          <span class="status-badge ${isActivo ? 'activo' : 'inactivo'}">${estatus}</span>
        </div>
        ${data.nombre ? `<div class="info-row"><span class="info-label">Nombre:</span><span class="info-value">${sanitize(data.nombre)}</span></div>` : ''}
        ${!isActivo ? '<p style="margin:8px 0 0;color:#fca5a5;font-size:12px">⚠️ Estatus INACTIVO. Puedes continuar, pero verifica tu situación con el CPG.</p>' : ''}`;
    }
    if (authProceedBtn) authProceedBtn.style.display = '';
  } catch {
    if (authColegiadoInfo) { authColegiadoInfo.className = 'colegiado-info status-error'; authColegiadoInfo.innerHTML = '<strong>⚠️ Error de conexión.</strong> Intenta de nuevo.'; }
  } finally {
    if (authVerificarBtn) { authVerificarBtn.disabled = false; authVerificarBtn.textContent = 'Verificar'; }
  }
});

authProceedBtn?.addEventListener('click', () => {
  if (!__AUTH_MODAL_COLEGIADO_DATA) return;
  sessionStorage.setItem('pendingColData', JSON.stringify(__AUTH_MODAL_COLEGIADO_DATA));
  if (authVerifiedName) authVerifiedName.textContent = __AUTH_MODAL_COLEGIADO_DATA.nombre || `Colegiado No. ${__AUTH_MODAL_COLEGIADO_DATA.numero}`;
  if (authVerifiedStatus) authVerifiedStatus.textContent = `No. ${__AUTH_MODAL_COLEGIADO_DATA.numero} · ${__AUTH_MODAL_COLEGIADO_DATA.estatus}`;
  if (authStep1) authStep1.style.display = 'none';
  if (authStep2) authStep2.style.display = '';
});

authBackBtn?.addEventListener('click', () => {
  if (authStep2) authStep2.style.display = 'none';
  if (authStep1) authStep1.style.display = '';
  hideAuthSignupSentUI();
  __AUTH_MODAL_COLEGIADO_DATA = null;
  sessionStorage.removeItem('pendingColData');
});

document.getElementById('authGuestNameBtn')?.addEventListener('click', () => {
  const name = (document.getElementById('authGuestName')?.value || '').trim();
  if (!name) { showToast('Ingresa tu nombre completo.', 'warn'); return; }
  __AUTH_MODAL_COLEGIADO_DATA = { numero: GUEST_COLEGIADO, nombre: name, activo: true, estatus: 'ACTIVO' };
  sessionStorage.setItem('pendingColData', JSON.stringify(__AUTH_MODAL_COLEGIADO_DATA));
  if (authVerifiedName) authVerifiedName.textContent = name;
  if (authVerifiedStatus) authVerifiedStatus.textContent = `No. ${GUEST_COLEGIADO} · Acceso de prueba`;
  const guestDiv = document.getElementById('authGuestNameDiv');
  if (guestDiv) guestDiv.style.display = 'none';
  if (authStep1) authStep1.style.display = 'none';
  if (authStep2) authStep2.style.display = '';
});

document.getElementById('authGuestName')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('authGuestNameBtn')?.click(); }
});

document.getElementById('authResendBtn')?.addEventListener('click', async () => {
  const sb = getSupabaseClient(); if (!sb) return;
  const email = (authEmail?.value || '').trim() || document.getElementById('authSignupEmail')?.textContent?.trim();
  if (!email) return;
  const btn = document.getElementById('authResendBtn');
  const stateEl = document.getElementById('authResendState');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  const { error } = await sb.auth.resend({ type: 'signup', email });
  if (btn) { btn.disabled = false; btn.textContent = 'Reenviar correo de confirmación'; }
  if (error) { if (stateEl) stateEl.textContent = 'Error: ' + sbErrMsg(error); return; }
  if (stateEl) stateEl.textContent = '✓ Correo reenviado. Revisa tu bandeja de entrada.';
});

document.getElementById('authResendBack')?.addEventListener('click', () => {
  hideAuthSignupSentUI();
  if (authState) authState.textContent = '—';
});

// ── Paso 2: autenticación ─────────────────────────────────────────────────────
document.getElementById('doGoogleLogin')?.addEventListener('click', async () => {
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${location.origin}/auth-callback.html` },
  });
  if (error) showToast('Error al iniciar con Google: ' + sbErrMsg(error), 'error');
});

doSignup?.addEventListener('click', async () => {
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  if (authState) authState.textContent = 'Creando cuenta...';
  const email = (authEmail?.value || '').trim();
  const password = authPass2?.value || '';
  if (!email || !password) { if (authState) authState.textContent = 'Ingresa correo y contraseña.'; return; }
  const redirectTo = `${location.origin}/auth-callback.html`;
  const { data: signUpData, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
  if (error) { if (authState) authState.textContent = 'Error: ' + sbErrMsg(error); return; }
  if (!signUpData?.session) {
    showAuthSignupSentUI(email);
    return;
  }
  if (authState) authState.textContent = 'OK';
  closeModal(authModal);
  updateAuthButton(true);
});

doLogin?.addEventListener('click', async () => {
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  if (authState) authState.textContent = 'Ingresando...';
  const email = (authEmail?.value || '').trim();
  const { data: loginData, error } = await sb.auth.signInWithPassword({ email, password: authPass2?.value || '' });
  if (error) {
    if (error.message?.toLowerCase().includes('not confirmed') || error.message?.toLowerCase().includes('email not confirmed')) {
      showAuthSignupSentUI(email);
      return;
    }
    if (authState) authState.textContent = 'Error: ' + sbErrMsg(error);
    return;
  }
  if (authState) authState.textContent = 'OK';
  closeModal(authModal);
  updateAuthButton(true);
  // La carga del perfil y routing la maneja onAuthStateChange automáticamente
});

doResetPassword?.addEventListener('click', async () => {
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  const email = (authEmail?.value || '').trim();
  if (!email) { showToast('Escriba su correo en el campo Email y vuelva a pulsar.', 'warn'); return; }
  if (authState) authState.textContent = 'Enviando enlace...';
  const redirectTo = `${location.origin}/auth-callback.html`;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) { if (authState) authState.textContent = 'Error: ' + sbErrMsg(error); return; }
  if (authState) authState.textContent = 'Te enviamos un enlace para restablecer tu contraseña.';
});

async function handlePostAuthColData(userId) {
  const sb = getSupabaseClient();
  if (!sb || !userId) return;
  if (__USER_PROFILE?.colegiado_numero) return;
  const pending = sessionStorage.getItem('pendingColData');
  if (!pending) return;
  let colData;
  try { colData = JSON.parse(pending); } catch { sessionStorage.removeItem('pendingColData'); return; }
  sessionStorage.removeItem('pendingColData');
  if (colData.numero !== GUEST_COLEGIADO) {
    const { data: existing } = await sb.from('perfiles').select('user_id').eq('colegiado_numero', colData.numero).maybeSingle();
    if (existing?.user_id && existing.user_id !== userId) {
      await sb.auth.signOut();
      showToast('Este número de colegiado ya está vinculado a otra cuenta. Contacta al administrador si crees que es un error.', 'error');
      showUnauthenticatedUI();
      updateAuthButton(false);
      return;
    }
  }
  await saveUserProfile(userId, {
    colegiado_numero: colData.numero,
    colegiado_activo: colData.activo,
    nombre: colData.nombre || '',
  });
}

getSupabaseClient()?.auth.onAuthStateChange(async (_evt, session) => {
  __CACHED_SESSION = session || null;
  const isLoggedIn = !!session?.user;
  updateAuthButton(isLoggedIn);
  if (!__ENTRY_ACCEPTED) return;
  if (!isLoggedIn) {
    __USER_PROFILE = null;
    showUnauthenticatedUI();
    return;
  }
  await handlePostAuthColData(session.user.id);
  const profile = await loadUserProfile(session.user.id);
  if (profile?.colegiado_numero) {
    applyProfileToUI(profile);
    showMainDashboardUI();
    await loadAndRender();
    loadAulaVirtualCerts();
  } else {
    showProfileSetupUI();
  }
});

/* =======================================================
   Datos (vista usuario)
======================================================= */
async function loadAndRender() {
  const sb = getSupabaseClient(); if (!sb) return;
  let userId = __CACHED_SESSION?.user?.id;
  if (!userId) {
    const { data: session } = await sb.auth.getSession();
    if (!session?.session) {
      if (tablaBody) tablaBody.innerHTML = '';
      if (totalCreditosLabel) totalCreditosLabel.textContent = 'Total créditos acumulados: 0';
      if (downloadConsolidadoBtn) downloadConsolidadoBtn.disabled = true;
      if (downloadByYearBtn) downloadByYearBtn.disabled = true;
      hideYearSelector();
      if (consolidadoState) consolidadoState.textContent = '—';
      return;
    }
    userId = session.session.user.id;
  }
  if (__USER_PROFILE) { try { applyProfileToUI(__USER_PROFILE); } catch {} }
  else { try { precargarDesdeLocalStorage(userId); } catch {}; try { await precargarDatosDesdeUltimoRegistro(userId); } catch {} }
  let q = sb.from('registros').select('*').eq('usuario_id', userId).order('created_at', { ascending: false });
  if (__HAS_DELETED_AT) q = q.is('deleted_at', null);
  const { data, error } = await q;
  if (error) { console.error('loadAndRender error:', error); showToast('No se pudieron cargar registros: ' + sbErrMsg(error), 'error'); return; }
  const rows = data || [];
  __USER_ROWS_CACHE = rows;
  updateUserTotalsUI(rows);
  populateYearSelect(rows);
  renderTabla(rows);
}

function updateUserTotalsUI(rows) {
  const totalCred = (rows || []).reduce((acc, r) => acc + (Number(r.creditos) || 0), 0);
  const totalCredRounded = Math.round(totalCred * 100) / 100;
  if (totalCreditosLabel) totalCreditosLabel.textContent = `Total créditos acumulados: ${totalCredRounded}`;
  const enabled = (rows && rows.length > 0);
  if (downloadConsolidadoBtn) downloadConsolidadoBtn.disabled = !enabled;
  if (downloadByYearBtn) downloadByYearBtn.disabled = !enabled;
  if (!enabled) { hideYearSelector(); if (consolidadoState) consolidadoState.textContent = '—'; }

  // Actualizar stats bar
  const years = new Set((rows || []).map(r => new Date(r.fecha || r.created_at || '').getFullYear()).filter(y => y && !isNaN(y)));
  const statCred = document.getElementById('statCreditos');
  const statAct = document.getElementById('statActividades');
  const statAnios = document.getElementById('statAnios');
  if (statCred) statCred.textContent = totalCredRounded;
  if (statAct) statAct.textContent = (rows || []).length;
  if (statAnios) statAnios.textContent = years.size || 0;
}

function getYearsFromRows(rows) {
  const years = new Set();
  for (const r of (rows || [])) { const y = new Date(r.fecha || r.created_at || '').getFullYear(); if (y && !isNaN(y)) years.add(y); }
  return [...years].sort((a, b) => b - a);
}

function populateYearSelect(rows) {
  if (!yearSelect) return;
  const years = getYearsFromRows(rows);
  yearSelect.innerHTML = '<option value="">— Año —</option>';
  for (const y of years) { const opt = document.createElement('option'); opt.value = y; opt.textContent = y; yearSelect.appendChild(opt); }
  yearSelect.disabled = years.length === 0;
}

function hideYearSelector() {
  if (yearSelect) { yearSelect.style.display = 'none'; yearSelect.value = ''; }
  if (downloadYearBtn) downloadYearBtn.style.display = 'none';
}
function showYearSelector() {
  if (yearSelect) yearSelect.style.display = '';
  if (downloadYearBtn) downloadYearBtn.style.display = '';
}

downloadByYearBtn?.addEventListener('click', () => {
  if (yearSelect?.style.display === 'none' || yearSelect?.style.display === '') {
    if (yearSelect?.style.display === 'none') showYearSelector(); else hideYearSelector();
  } else { hideYearSelector(); }
});

downloadYearBtn?.addEventListener('click', async () => {
  const selectedYear = yearSelect?.value;
  if (!selectedYear) { showToast('Selecciona un año.', 'warn'); return; }
  const yearRows = (__USER_ROWS_CACHE || []).filter(r => new Date(r.fecha || r.created_at || '').getFullYear() === Number(selectedYear));
  if (!yearRows.length) { showToast('No hay registros para el año ' + selectedYear, 'warn'); return; }
  try {
    if (consolidadoState) consolidadoState.textContent = 'Generando reporte ' + selectedYear + '...';
    const { doc, filename } = await generarConsolidadoPDF(yearRows, selectedYear);
    savePdfMobile(doc, filename);
    if (consolidadoState) consolidadoState.textContent = 'Reporte ' + selectedYear + ' descargado.';
  } catch (e) {
    console.error(e);
    if (consolidadoState) consolidadoState.textContent = 'Error.';
    showToast('No se pudo generar el reporte: ' + (e?.message || e), 'error');
  }
});

function renderTabla(rows) {
  if (!tablaBody) return;
  tablaBody.innerHTML = '';
  for (const r of rows) {
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

tablaBody?.addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const act = btn.getAttribute('data-action');
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  if (act === 'pdf') {
    const id = btn.getAttribute('data-id');
    const { data: rows, error } = await sb.from('registros').select('*').eq('id', id).limit(1);
    if (error || !rows?.length) return showToast('Registro no disponible: ' + (error ? sbErrMsg(error) : 'no encontrado'), 'error');
    await generarConstanciaPDF(rows[0]).catch(() => showToast('Error al generar PDF', 'error'));
  }
  if (act === 'dl') await downloadComprobante(btn.getAttribute('data-path'));
  if (act === 'userdel') {
    const corr = btn.getAttribute('data-corr') || '—';
    const id = btn.getAttribute('data-id');
    const ok = confirm(`¿Deseas eliminar el registro ${corr}?\n\nEsta acción no se puede deshacer.`);
    if (!ok) return;
    if (__HAS_DELETED_AT) {
      const { error: upErr } = await sb.from('registros').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (upErr) { showToast('No se pudo eliminar: ' + sbErrMsg(upErr), 'error'); return; }
    } else {
      const { error: delErr } = await sb.from('registros').delete().eq('id', id);
      if (delErr) { showToast('No se pudo eliminar: ' + sbErrMsg(delErr), 'error'); return; }
    }
    showToast('Registro ' + corr + ' eliminado.');
    await loadAndRender();
  }
});

downloadConsolidadoBtn?.addEventListener('click', async () => {
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  const user = await getCurrentUser();
  if (!user) { showToast('Inicia sesión para descargar el consolidado.', 'error'); return; }
  const rows = __USER_ROWS_CACHE || [];
  if (!rows.length) { showToast('No tienes registros para consolidar.', 'warn'); return; }
  try {
    if (consolidadoState) consolidadoState.textContent = 'Generando consolidado...';
    const { doc, blob, filename } = await generarConsolidadoPDF(rows);
    const path = `consolidados/${user.id}/registro_unificado_creditos.pdf`;
    const { error: upErr } = await sb.storage.from('comprobantes').upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (upErr) { console.warn('No se pudo subir consolidado:', upErr); if (consolidadoState) consolidadoState.textContent = 'Consolidado generado (sin subir).'; }
    else { __CONSOLIDADO_PATH = path; if (consolidadoState) consolidadoState.textContent = 'Consolidado actualizado.'; }
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
  if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = originalText || 'Registrar y generar constancia'; }
}

form?.addEventListener('submit', async e => {
  e.preventDefault();
  if (__SUBMITTING) return;
  __SUBMITTING = true;
  const originalBtnText = submitBtn?.innerHTML || 'Registrar y generar constancia';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span class="verifying-spinner"></span> Registrando…'; }
  const safetyTimer = setTimeout(() => {
    console.error('SUBMIT SAFETY TIMEOUT');
    showToast('La operación tardó demasiado. Revisa tu conexión e intenta de nuevo.', 'error');
    resetSubmitBtn(originalBtnText);
  }, 90000);
  try {
    const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no está disponible.', 'error'); return; }
    let user = __CACHED_SESSION?.user;
    if (!user) {
      try {
        const { data: s } = await Promise.race([sb.auth.getSession(), new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 8000))]);
        user = s?.session?.user;
      } catch (sessErr) { console.warn('getSession fallback failed:', sessErr); }
    }
    if (!user) { showToast('Inicia sesión para registrar.', 'error'); return; }
    const nombre = (document.getElementById('nombre')?.value || '').trim();
    const telefono = (document.getElementById('telefono')?.value || '').trim();
    const colegiadoNumero = __USER_PROFILE?.colegiado_numero || '';
    const colegiadoActivo = (__USER_PROFILE?.colegiado_activo === true || __USER_PROFILE?.colegiado_activo === 'Sí') ? 'Sí' : 'No';
    const actividad = (document.getElementById('actividad')?.value || '').trim();
    const institucion = (document.getElementById('institucion')?.value || '').trim();
    const tipo = document.getElementById('tipo')?.value;
    const fecha = document.getElementById('fecha')?.value;
    const horas = Number(document.getElementById('horas')?.value);
    const observaciones = (obsEl?.value || '').trim();
    if (!colegiadoNumero) { showToast('No se encontró tu número de colegiado. Recarga la página.', 'error'); return; }
    if (!nombre || !telefono || !actividad || !institucion || !tipo || !fecha || !horas) {
      showToast('Complete todos los campos obligatorios (*).', 'error'); return;
    }
    if (!phoneValidGT(telefono)) { showToast('Teléfono inválido (+502 ########)', 'error'); return; }
    if (!withinFiveYears(fecha)) { showToast('Fecha inválida (no futura, ≤ 5 años)', 'error'); return; }
    if (!(horas >= 0.5 && horas <= 200)) { showToast('Horas fuera de rango (0.5 a 200).', 'error'); return; }
    if (observaciones.length > 250) { showToast('Observaciones exceden 250 caracteres.', 'error'); return; }
    if (!fileRef) { showToast('Adjunte el comprobante (PDF/JPG/PNG) antes de registrar.', 'error'); markUploaderError(true); try { upZone?.scrollIntoView({ behavior:'smooth', block:'center' }); } catch {} upZone?.focus?.(); return; }
    if (!ALLOWED_MIME.includes(fileRef.type)) { showToast('Archivo no permitido.', 'error'); markUploaderError(true); return; }
    if (fileRef.size/1024/1024 > MAX_FILE_MB) { showToast('Archivo supera 10 MB.', 'error'); markUploaderError(true); return; }
    if (submitBtn) submitBtn.innerHTML = '<span class="verifying-spinner"></span> Preparando…';
    let accessToken = __CACHED_SESSION?.access_token;
    try {
      const { data: freshSession } = await Promise.race([sb.auth.getSession(), new Promise((_, r) => setTimeout(() => r('timeout'), 5000))]);
      if (freshSession?.session?.access_token) accessToken = freshSession.session.access_token;
    } catch (e) { console.warn('Token refresh skipped:', e); }
    if (!accessToken) { showToast('Sesión expirada. Cierra sesión e inicia de nuevo.', 'error'); return; }
    const creditos = calcCreditos(horas);
    const tempId = `${user.id}-${Date.now()}`;
    const hash = hashSimple(`${tempId}|${nombre}|${telefono}|${fecha}|${horas}|${creditos}`);
    if (submitBtn) submitBtn.innerHTML = '<span class="verifying-spinner"></span> Subiendo 0%…';
    let archivo_url = null, archivo_mime = null;
    {
      const safeName = fileRef.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${user.id}/${Date.now()}-${safeName}`;
      const storageUrl = `${window.SB_URL}/storage/v1/object/comprobantes/${path}`;
      const uploadResult = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', storageUrl, true);
        xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.upload.onprogress = ev => { if (ev.lengthComputable && submitBtn) submitBtn.innerHTML = `<span class="verifying-spinner"></span> Subiendo ${Math.round(ev.loaded/ev.total*100)}%…`; };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve({ error: null });
          else { let msg = 'Error ' + xhr.status; try { const j = JSON.parse(xhr.responseText); msg = j.message || j.error || msg; } catch {} resolve({ error: msg }); }
        };
        xhr.onerror = () => reject(new Error('Error de red al subir archivo.'));
        xhr.ontimeout = () => reject(new Error('Timeout subiendo archivo.'));
        xhr.timeout = 120000;
        xhr.send(fileRef);
      });
      if (uploadResult.error) { showToast('No se pudo subir el archivo: ' + uploadResult.error, 'error'); return; }
      archivo_url = path; archivo_mime = fileRef.type;
    }
    if (submitBtn) submitBtn.innerHTML = '<span class="verifying-spinner"></span> Guardando registro…';
    const payload = { usuario_id: user.id, nombre, telefono, colegiado_numero: colegiadoNumero, colegiado_activo: colegiadoActivo, actividad, institucion, tipo, fecha, horas, creditos, observaciones, archivo_url, archivo_mime, hash };
    const anonKey = window.SB_KEY || '';
    let inserted = null;
    try {
      inserted = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${window.SB_URL}/rest/v1/registros`, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
        xhr.setRequestHeader('apikey', anonKey);
        xhr.setRequestHeader('Prefer', 'return=representation');
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) { try { const rows = JSON.parse(xhr.responseText); resolve(Array.isArray(rows) ? rows[0] : rows); } catch { resolve(null); } }
          else { let msg = 'Error ' + xhr.status; try { const j = JSON.parse(xhr.responseText); msg = j.message || j.details || j.hint || msg; } catch {} reject(new Error(msg)); }
        };
        xhr.onerror = () => reject(new Error('Error de red'));
        xhr.ontimeout = () => reject(new Error('Timeout XHR'));
        xhr.timeout = 30000;
        xhr.send(JSON.stringify(payload));
      });
    } catch (xhrErr) {
      console.warn('[SUBMIT] XHR insert failed:', xhrErr.message);
      if (submitBtn) submitBtn.innerHTML = '<span class="verifying-spinner"></span> Verificando…';
      await new Promise(r => setTimeout(r, 2000));
      try {
        const checkXhr = await new Promise((resolve, reject) => {
          const x = new XMLHttpRequest();
          x.open('GET', `${window.SB_URL}/rest/v1/registros?hash=eq.${encodeURIComponent(hash)}&select=*&limit=1`, true);
          x.setRequestHeader('Authorization', 'Bearer ' + accessToken);
          x.setRequestHeader('apikey', anonKey);
          x.onload = () => { if (x.status >= 200 && x.status < 300) { try { resolve(JSON.parse(x.responseText)); } catch { resolve([]); } } else resolve([]); };
          x.onerror = () => resolve([]); x.ontimeout = () => resolve([]);
          x.timeout = 10000; x.send();
        });
        if (checkXhr.length > 0) inserted = checkXhr[0];
      } catch (e) { console.error('Fallback check failed:', e); }
    }
    if (!inserted) { showToast('No se pudo confirmar el registro. Revisa "Mis registros" — es posible que se haya guardado.', 'error'); await loadAndRender().catch(() => {}); return; }
    guardarDatosRapidos(user.id, nombre, telefono, colegiadoNumero);
    // Actualizar perfil si cambió nombre o teléfono
    const profileUpdates = {};
    if (nombre && nombre !== __USER_PROFILE?.nombre) profileUpdates.nombre = nombre;
    if (telefono && telefono !== __USER_PROFILE?.telefono) profileUpdates.telefono = telefono;
    if (Object.keys(profileUpdates).length) {
      saveUserProfile(user.id, profileUpdates).catch(() => {});
      applyProfileToUI(__USER_PROFILE);
    }
    if (submitBtn) submitBtn.innerHTML = '<span class="verifying-spinner"></span> Generando constancia…';
    try { await Promise.race([generarConstanciaPDF(inserted, fileRef), new Promise((_, reject) => setTimeout(() => reject(new Error('PDF timeout')), 15000))]); }
    catch (pdfErr) { console.error('PDF error:', pdfErr); showToast('Registro guardado ✅, pero la constancia no pudo generarse. Puedes regenerarla desde el historial.', 'warn'); }
    showToast('✅ Registro guardado y constancia generada.');
    form.reset(); if (preview) preview.innerHTML = ''; if (creditosEl) creditosEl.value = '';
    if (__USER_PROFILE) { try { applyProfileToUI(__USER_PROFILE); } catch {} }
    fileRef = null; markUploaderError(false);
    await loadAndRender().catch(e => console.warn('Error recargando historial:', e));
    try { await actualizarConsolidadoEnStorage(user.id, __USER_ROWS_CACHE); } catch (e) { console.warn('No se pudo actualizar consolidado:', e); }
  } catch (fatalErr) {
    console.error('Error fatal en submit:', fatalErr);
    showToast('Error: ' + (fatalErr?.message || 'Intenta de nuevo.'), 'error');
  } finally {
    clearTimeout(safetyTimer);
    resetSubmitBtn(originalBtnText);
  }
});

/* =======================================================
   Panel Admin: render registros
======================================================= */
async function renderAdmin() {
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  let q = sb.from('registros').select('*').order('created_at', { ascending: false });
  if (currentAdminFilter) q = q.eq('correlativo', currentAdminFilter);
  if (__HAS_DELETED_AT) { if (!showDeleted?.checked) q = q.is('deleted_at', null); }
  else { if (showDeleted) showDeleted.disabled = true; }
  const { data: rows, error } = await q;
  if (error) { exportStatus && (exportStatus.textContent = 'Error al cargar: ' + sbErrMsg(error)); showToast('No se pudieron cargar registros: ' + sbErrMsg(error), 'error'); if (diagBox) diagBox.textContent = 'Diagnóstico: ' + sbErrMsg(error); return; }
  if (!adminTbody) return;
  adminTbody.innerHTML = '';
  for (const r of rows || []) {
    const estado = r.deleted_at ? 'Eliminado' : 'Activo';
    const dlBtn = r.archivo_url ? `<button class="btn" data-action="dl" data-path="${sanitize(r.archivo_url)}" type="button">Descargar</button>` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sanitize(r.correlativo)}</td><td>${sanitize(r.nombre)}</td><td>${sanitize(r.telefono)}</td>
      <td>${sanitize(r.colegiado_numero||'')}</td><td>${sanitize(r.colegiado_activo)}</td>
      <td title="${sanitize(r.actividad)}">${sanitize(r.actividad.slice(0,40))}${r.actividad.length>40?'…':''}</td>
      <td>${sanitize(r.institucion)}</td><td>${sanitize(r.tipo)}</td><td>${sanitize(r.fecha)}</td>
      <td>${r.horas}</td><td>${r.creditos}</td>
      <td>${r.archivo_url||''}</td><td class="mono">${sanitize(r.hash)}</td><td>${estado}</td>
      <td>
        <button class="btn" data-id="${r.id}" data-action="pdf" type="button">PDF</button>
        ${dlBtn}
        ${r.deleted_at ? '' : `<button class="btn warn" data-id="${r.id}" data-corr="${sanitize(r.correlativo)}" data-action="del" type="button">Eliminar</button>`}
      </td>`;
    adminTbody.appendChild(tr);
  }
  if (diagBox) diagBox.textContent = `Diagnóstico: deleted_at=${__HAS_DELETED_AT ? 'sí' : 'no'}. Registros cargados: ${rows?.length || 0}.`;
}

adminSearchBtn?.addEventListener('click', async () => { currentAdminFilter = (adminSearch?.value || '').trim() || null; await renderAdmin(); });
adminClearSearch?.addEventListener('click', async () => { currentAdminFilter = null; if (adminSearch) adminSearch.value = ''; await renderAdmin(); });
adminSearch?.addEventListener('keydown', async e => { if (e.key === 'Enter') { e.preventDefault(); adminSearchBtn?.click(); } });
showDeleted?.addEventListener('change', () => renderAdmin());

document.getElementById('adminTable')?.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  const id = btn.getAttribute('data-id');
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  if (action === 'pdf') {
    const { data: rows, error } = await sb.from('registros').select('*').eq('id', id).limit(1);
    if (error || !rows?.length) return showToast('Registro no disponible: ' + (error ? sbErrMsg(error) : 'no encontrado'), 'error');
    await generarConstanciaPDF(rows[0]).catch(() => showToast('Error al generar PDF', 'error'));
  }
  if (action === 'dl') await downloadComprobante(btn.getAttribute('data-path'));
  if (action === 'del') {
    const corr = btn.getAttribute('data-corr') || '—';
    const ok = confirm(`¿Eliminar (soft delete) el registro con correlativo ${corr}?`);
    if (!ok) return;
    const patch = __HAS_DELETED_AT ? { deleted_at: new Date().toISOString() } : {};
    const { error: upErr } = await sb.from('registros').update(patch).eq('id', id);
    if (upErr) { console.error(upErr); showToast('No se pudo eliminar (RLS): ' + sbErrMsg(upErr), 'error'); return; }
    showToast('Registro marcado como eliminado.');
    await renderAdmin();
  }
});

exportCSVBtn?.addEventListener('click', async () => {
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  let q = sb.from('registros').select('*').order('created_at', { ascending: false });
  if (__HAS_DELETED_AT && !showDeleted?.checked) q = q.is('deleted_at', null);
  if (currentAdminFilter) q = q.eq('correlativo', currentAdminFilter);
  const { data: rows, error } = await q;
  if (error) { showToast('Error al exportar (RLS): ' + sbErrMsg(error), 'error'); return; }
  if (!rows?.length) return showToast('Sin registros', 'warn');
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')].concat(rows.map(o => `"${headers.map(h => String(o[h]??'').replace(/"/g,'""')).join('","')}"`)).join('\n');
  const blob = new Blob(["\ufeff"+csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `registros_cpg_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
  exportStatus && (exportStatus.textContent = 'CSV descargado');
});

exportXLSXBtn?.addEventListener('click', async () => {
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  let q = sb.from('registros').select('*').order('created_at', { ascending: false });
  if (__HAS_DELETED_AT && !showDeleted?.checked) q = q.is('deleted_at', null);
  if (currentAdminFilter) q = q.eq('correlativo', currentAdminFilter);
  const { data: rows, error } = await q;
  if (error) { showToast('Error al exportar (RLS): ' + sbErrMsg(error), 'error'); return; }
  if (!rows?.length) return showToast('Sin registros', 'warn');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registros');
  XLSX.writeFile(wb, `registros_cpg_${new Date().toISOString().slice(0,10)}.xlsx`);
  exportStatus && (exportStatus.textContent = 'Excel descargado');
});

/* Gestión de usuarios (superadmin) */
userCheckBtn?.addEventListener('click', async () => {
  if (!isSuperAdmin) { showToast('Solo superadmin puede usar esta opción.', 'warn'); return; }
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  const email = (userAdminEmail?.value || '').trim();
  if (!email) { showToast('Ingresa el correo del usuario.', 'warn'); return; }
  try {
    if (userAdminState) userAdminState.textContent = 'Consultando...';
    const { data, error } = await sb.rpc('check_user_status', { target_email: email });
    if (error) { if (userAdminState) userAdminState.textContent = 'Error: ' + sbErrMsg(error); return; }
    if (userAdminState) userAdminState.textContent = data?.message || JSON.stringify(data);
  } catch (e) { if (userAdminState) userAdminState.textContent = 'Error: ' + (e?.message || e); }
});

userActivateBtn?.addEventListener('click', async () => {
  if (!isSuperAdmin) { showToast('Solo superadmin puede usar esta opción.', 'warn'); return; }
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  const email = (userAdminEmail?.value || '').trim();
  if (!email) { showToast('Ingresa el correo del usuario.', 'warn'); return; }
  const ok = confirm('¿Activar la cuenta de ' + email + '?\nEsta acción confirma su correo sin necesidad de verificación.');
  if (!ok) return;
  try {
    if (userAdminState) userAdminState.textContent = 'Activando...';
    const { data, error } = await sb.rpc('activate_user_by_email', { target_email: email });
    if (error) { if (userAdminState) userAdminState.textContent = 'Error: ' + sbErrMsg(error); return; }
    if (userAdminState) userAdminState.textContent = data?.message || 'Usuario activado.';
    if (data?.success) showToast(data.message);
  } catch (e) { if (userAdminState) userAdminState.textContent = 'Error: ' + (e?.message || e); }
});

makeAdminBtn?.addEventListener('click', async () => {
  if (!isSuperAdmin) { showToast('Solo superadmin puede usar esta opción.', 'warn'); return; }
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  const email = (adminRoleEmail?.value || '').trim();
  if (!email) { showToast('Ingresa el correo del usuario.', 'warn'); return; }
  const ok = confirm('¿Asignar permisos de superadmin a ' + email + '?');
  if (!ok) return;
  try {
    if (adminRoleState) adminRoleState.textContent = 'Procesando...';
    const { data, error } = await sb.rpc('make_user_admin', { target_email: email });
    if (error) { if (adminRoleState) adminRoleState.textContent = 'Error: ' + sbErrMsg(error); return; }
    if (adminRoleState) adminRoleState.textContent = data?.message || 'Superadmin asignado.';
    if (data?.success) showToast(data.message);
  } catch (e) { if (adminRoleState) adminRoleState.textContent = 'Error: ' + (e?.message || e); }
});

removeAdminBtn?.addEventListener('click', async () => {
  if (!isSuperAdmin) { showToast('Solo superadmin puede usar esta opción.', 'warn'); return; }
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  const email = (adminRoleEmail?.value || '').trim();
  if (!email) { showToast('Ingresa el correo del usuario.', 'warn'); return; }
  const ok = confirm('¿Quitar permisos de superadmin a ' + email + '?');
  if (!ok) return;
  try {
    if (adminRoleState) adminRoleState.textContent = 'Procesando...';
    const { data, error } = await sb.rpc('remove_user_admin', { target_email: email });
    if (error) { if (adminRoleState) adminRoleState.textContent = 'Error: ' + sbErrMsg(error); return; }
    if (adminRoleState) adminRoleState.textContent = data?.message || 'Permisos removidos.';
    if (data?.success) showToast(data.message);
  } catch (e) { if (adminRoleState) adminRoleState.textContent = 'Error: ' + (e?.message || e); }
});

/* =======================================================
   Descargar comprobante
======================================================= */
async function downloadComprobante(path) {
  const sb = getSupabaseClient(); if (!sb) { showToast('Supabase no disponible.', 'error'); return; }
  if (!path) { showToast('No hay archivo asociado.', 'warn'); return; }
  try {
    const { data, error } = await sb.storage.from('comprobantes').createSignedUrl(path, 60*60);
    if (error || !data?.signedUrl) { showToast('No se pudo generar enlace de descarga: ' + sbErrMsg(error), 'error'); return; }
    const a = document.createElement('a'); a.href = data.signedUrl; a.target = '_blank'; a.rel = 'noopener'; a.click();
  } catch (e) { showToast('Error al descargar: ' + (e?.message || e), 'error'); }
}

/* =======================================================
   Helpers PDF
======================================================= */
function savePdfMobile(doc, filename) {
  try {
    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
    if (isMobile) {
      const newTab = window.open(blobUrl, '_blank');
      if (!newTab) { const a = document.createElement('a'); a.href = blobUrl; a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 2000); }
      else { setTimeout(() => URL.revokeObjectURL(blobUrl), 60000); }
    } else {
      const a = document.createElement('a'); a.href = blobUrl; a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 2000);
    }
  } catch (e) { console.warn('Blob save failed:', e); doc.save(filename); }
}

function blobToDataURL(blob) {
  return new Promise(resolve => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => resolve(null); fr.readAsDataURL(blob); });
}

async function pdfFirstPageToDataURL(blob, scale = 1.4) {
  if (!window.pdfjsLib) return null;
  const url = URL.createObjectURL(blob);
  try {
    const pdf = await pdfjsLib.getDocument({ url }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/png');
  } catch (e) { console.warn('pdf render fail', e); return null; }
  finally { URL.revokeObjectURL(url); }
}

async function getPreviewDataUrlFromLocal(file) {
  if (!file) return null;
  if (file.type.startsWith('image/')) return await blobToDataURL(file);
  if (file.type === 'application/pdf') return await pdfFirstPageToDataURL(file);
  return null;
}

async function getPreviewDataUrlFromStorage(path) {
  if (!path) return null;
  const sb = getSupabaseClient(); if (!sb) return null;
  const { data, error } = await sb.storage.from('comprobantes').createSignedUrl(path, 60*5);
  if (error || !data?.signedUrl) return null;
  try {
    const res = await fetch(data.signedUrl);
    const blob = await res.blob();
    if (blob.type.startsWith('image/')) return await blobToDataURL(blob);
    if (blob.type === 'application/pdf') return await pdfFirstPageToDataURL(blob);
  } catch { return null; }
  return null;
}

/* =======================================================
   PDF constancia
======================================================= */
async function ensurePdfLogoDataUrl() {
  if (__PDF_LOGO_DATAURL !== null) return __PDF_LOGO_DATAURL;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const dataUrl = await new Promise(resolve => {
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width; canvas.height = img.naturalHeight || img.height;
          canvas.getContext('2d').drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = PDF_LOGO_URL + (PDF_LOGO_URL.includes('?') ? '&' : '?') + 'cachebust=' + Date.now();
    });
    __PDF_LOGO_DATAURL = dataUrl;
    return __PDF_LOGO_DATAURL;
  } catch { __PDF_LOGO_DATAURL = null; return null; }
}

async function generarConstanciaPDF(rec, localFileBlob) {
  if (!window.jspdf || !window.jspdf.jsPDF) { console.error('jsPDF no disponible.'); showToast('jsPDF no cargó.', 'error'); throw new Error('jsPDF missing'); }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pad = 48;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('Constancia de Registro de Créditos Académicos', pad, 64);
  doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text('Colegio de Psicólogos de Guatemala — Artículo 16: 1 crédito = 16 horas', pad, 84);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(`No. ${rec.correlativo}`, pad, 112);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
  const lines = [`Nombre: ${rec.nombre}`, `Teléfono: ${rec.telefono}`, `Colegiado No.: ${(rec.colegiado_numero ?? rec.colegiadoNumero) || '—'} (Activo: ${(rec.colegiado_activo ?? rec.colegiadoActivo) || '—'})`, `Actividad: ${rec.actividad}`, `Institución: ${rec.institucion}`, `Tipo: ${rec.tipo}`, `Fecha: ${rec.fecha}`, `Horas: ${rec.horas}`, `Créditos (16h = 1): ${rec.creditos}`];
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
    if (logo) doc.addImage(logo, 'PNG', QR_X, QR_Y + QR_SIZE + LOGO_BELOW_GAP, PDF_LOGO_W, PDF_LOGO_H);
  } catch (e) { console.warn('No se pudo insertar logo:', e); }
  try {
    const evidPromise = (async () => {
      if (localFileBlob) return await getPreviewDataUrlFromLocal(localFileBlob);
      if (rec.archivo_url) return await getPreviewDataUrlFromStorage(rec.archivo_url);
      return null;
    })();
    const evidDataUrl = await Promise.race([evidPromise, new Promise(r => setTimeout(() => r(null), 8000))]);
    if (evidDataUrl) {
      doc.addPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text('Comprobante adjunto', pad, pad);
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const usableW = pageW - pad*2;
      const topY = pad + 12;
      const tmpImg = new Image();
      const loaded = new Promise(res => { tmpImg.onload = res; tmpImg.onerror = res; setTimeout(res, 5000); });
      tmpImg.src = evidDataUrl; await loaded;
      const imgW = tmpImg.naturalWidth || 1000, imgH = tmpImg.naturalHeight || 1000;
      let drawW = usableW, drawH = drawW / (imgW / imgH);
      const maxH = pageH - pad - topY;
      if (drawH > maxH) { const s = maxH / drawH; drawW *= s; drawH *= s; }
      doc.addImage(evidDataUrl, 'PNG', pad, topY, drawW, drawH);
    }
  } catch (e) { console.warn('No se pudo incrustar comprobante:', e); }
  doc.setFontSize(10); doc.setTextColor(120);
  if (rec.hash) doc.text(`Hash: ${rec.hash}`, pad, 820);
  savePdfMobile(doc, `Constancia_${rec.correlativo}.pdf`);
}

/* =======================================================
   PDF consolidado
======================================================= */
function baseName(path) { const p = String(path || '').split('?')[0]; const parts = p.split('/'); return parts[parts.length-1] || '—'; }

async function generarConsolidadoPDF(rows, yearFilter) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF missing');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pad = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - pad*2;
  const sorted = [...(rows||[])].sort((a,b) => new Date(a.created_at||a.fecha) - new Date(b.created_at||b.fecha));
  const last = sorted[sorted.length-1] || rows[0] || {};
  const totalCred = (rows||[]).reduce((acc, r) => acc + (Number(r.creditos) || 0), 0);
  const totalCredRounded = Math.round(totalCred*100)/100;
  const titleSuffix = yearFilter ? ` — Año ${yearFilter}` : '';
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('Registro unificado de Créditos Académicos' + titleSuffix, pad, 56);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text('Colegio de Psicólogos de Guatemala — Artículo 16: 1 crédito = 16 horas', pad, 74);
  try { const logo = await ensurePdfLogoDataUrl(); if (logo) doc.addImage(logo, 'PNG', pageW - pad - 64, 24, 64, 64); } catch {}
  const nombre = last.nombre || '—';
  const colegiado = (last.colegiado_numero ?? last.colegiadoNumero) || '—';
  const activo = (last.colegiado_activo ?? last.colegiadoActivo) || '—';
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('Datos del agremiado', pad, 104);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text(`Nombre completo: ${nombre}`, pad, 124);
  doc.text(`Colegiado No.: ${colegiado} (Activo: ${activo})`, pad, 140);
  doc.text(`Fecha de emisión: ${new Date().toISOString().slice(0,10)}`, pad, 156);
  let y = 186;
  const rowH = 18;
  const col = { act: pad, inst: pad + Math.floor(usableW*0.36), horas: pad + Math.floor(usableW*0.66), cred: pad + Math.floor(usableW*0.76), docu: pad + Math.floor(usableW*0.86) };
  const drawHeader = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Actividad', col.act, y); doc.text('Institución', col.inst, y);
    doc.text('Horas', col.horas, y, { align: 'right' }); doc.text('Créditos', col.cred, y, { align: 'right' });
    doc.text('Documento', col.docu, y);
    doc.setLineWidth(0.5); doc.line(pad, y+6, pageW-pad, y+6);
    y += rowH; doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  };
  drawHeader();
  for (const r of sorted) {
    if (y > pageH - 90) { doc.addPage(); y = 60; drawHeader(); }
    const cut = (t, n) => t.length > n ? (t.slice(0, n-1) + '…') : t;
    doc.text(cut(String(r.actividad || '—'), 38), col.act, y);
    doc.text(cut(String(r.institucion || '—'), 28), col.inst, y);
    doc.text(String(Number(r.horas) || 0), col.horas, y, { align: 'right' });
    doc.text(String(Math.round((Number(r.creditos)||0)*100)/100), col.cred, y, { align: 'right' });
    doc.text(cut(r.archivo_url ? baseName(r.archivo_url) : '—', 22), col.docu, y);
    y += rowH;
  }
  y += 10; doc.setLineWidth(0.8); doc.line(pad, y, pageW-pad, y); y += 18;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text(`Total de créditos acumulados${titleSuffix}: ${totalCredRounded}`, pad, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120);
  doc.text('Este documento se actualiza cada vez que se registra una nueva actividad.', pad, pageH - 48);
  const yearTag = yearFilter ? `_${yearFilter}` : '';
  const filename = `Registro_Unificado_Creditos${yearTag}_${String(colegiado).replace(/[^0-9A-Za-z_-]/g,'') || 'CPG'}_${new Date().toISOString().slice(0,10)}.pdf`;
  const blob = doc.output('blob');
  return { doc, blob, filename };
}

async function actualizarConsolidadoEnStorage(userId, rows) {
  const sb = getSupabaseClient(); if (!sb) throw new Error('Supabase no disponible');
  if (!userId) throw new Error('userId requerido');
  if (!rows?.length) return;
  const { blob } = await generarConsolidadoPDF(rows);
  const path = `consolidados/${userId}/registro_unificado_creditos.pdf`;
  const { error: upErr } = await sb.storage.from('comprobantes').upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw upErr;
  __CONSOLIDADO_PATH = path;
}

/* QR helpers */
function getBase64FromCanvas(canvas) { try { return canvas.toDataURL('image/png'); } catch { return null; } }
function getBase64Image(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width; canvas.height = img.naturalHeight || img.height;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}
async function getQrDataUrl(text, size = 96) {
  if (typeof QRCode === 'undefined') { console.warn('QRCode.js no disponible.'); return null; }
  return new Promise(resolve => {
    const tmp = document.createElement('div');
    new QRCode(tmp, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
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
   Setup de perfil (primera vez)
======================================================= */
document.getElementById('setupVerificarBtn')?.addEventListener('click', async () => {
  const numero = (document.getElementById('setupColegiadoNum')?.value || '').trim();
  if (!numero || !/^\d+$/.test(numero)) { showToast('Ingresa un número de colegiado válido (solo números).', 'warn'); return; }
  const btn = document.getElementById('setupVerificarBtn');
  const infoDiv = document.getElementById('setupColegiadoInfo');
  const personalFields = document.getElementById('setupPersonalFields');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="verifying-spinner"></span>Verificando…'; }
  if (infoDiv) { infoDiv.style.display = 'block'; infoDiv.className = 'colegiado-info'; infoDiv.innerHTML = '<span class="verifying-spinner"></span> Consultando en la base del Colegio de Psicólogos…'; }
  __SETUP_VERIFIED_DATA = null;
  try {
    const res = await fetch(window.SB_URL + '/functions/v1/consultar-colegiado', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: numero })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      if (infoDiv) { infoDiv.className = 'colegiado-info status-error'; infoDiv.innerHTML = `<strong>⚠️ ${sanitize(data.error || 'No se pudo verificar')}</strong><br><span class="muted">Verifica que el número sea correcto.</span>`; }
      if (personalFields) personalFields.style.display = 'none';
      return;
    }
    const estatus = (data.estatus || '').toUpperCase();
    const isActivo = estatus === 'ACTIVO';
    __SETUP_VERIFIED_DATA = { numero, nombre: data.nombre || '', activo: isActivo };
    if (infoDiv) {
      infoDiv.className = `colegiado-info ${isActivo ? 'status-activo' : 'status-inactivo'}`;
      infoDiv.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <strong>Colegiado No. ${sanitize(numero)}</strong>
          <span class="status-badge ${isActivo ? 'activo' : 'inactivo'}">${estatus}</span>
        </div>
        ${data.nombre ? `<div class="info-row"><span class="info-label">Nombre:</span><span class="info-value">${sanitize(data.nombre)}</span></div>` : ''}
        ${!isActivo ? '<p style="margin:10px 0 0;color:#fca5a5;font-size:13px">⚠️ Tu estatus aparece como INACTIVO. Puedes continuar, pero verifica con el CPG.</p>' : ''}`;
    }
    const setupNombre = document.getElementById('setupNombre');
    if (setupNombre && data.nombre) setupNombre.value = data.nombre;
    if (personalFields) personalFields.style.display = '';
  } catch (e) {
    if (infoDiv) { infoDiv.className = 'colegiado-info status-error'; infoDiv.innerHTML = '<strong>⚠️ Error de conexión.</strong> Intenta de nuevo.'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Verificar'; }
  }
});

document.getElementById('setupGuardarBtn')?.addEventListener('click', async () => {
  if (!__SETUP_VERIFIED_DATA) { showToast('Primero verifica tu número de colegiado.', 'warn'); return; }
  const nombre = (document.getElementById('setupNombre')?.value || '').trim();
  const telefono = (document.getElementById('setupTelefono')?.value || '').trim();
  if (!nombre) { showToast('Ingresa tu nombre completo.', 'warn'); return; }
  if (!telefono || !phoneValidGT(telefono)) { showToast('Ingresa un teléfono válido (+502 ########).', 'warn'); return; }

  const stateEl = document.getElementById('setupState');
  const btn = document.getElementById('setupGuardarBtn');
  if (stateEl) stateEl.textContent = 'Guardando…';
  if (btn) btn.disabled = true;

  const user = __CACHED_SESSION?.user;
  if (!user) { showToast('Sesión expirada. Recarga la página.', 'error'); if (btn) btn.disabled = false; return; }

  const error = await saveUserProfile(user.id, {
    colegiado_numero: __SETUP_VERIFIED_DATA.numero,
    colegiado_activo: __SETUP_VERIFIED_DATA.activo,
    nombre,
    telefono,
  });

  if (error) {
    if (stateEl) stateEl.textContent = 'Error: ' + sbErrMsg(error);
    if (btn) btn.disabled = false;
    return;
  }

  showToast('¡Perfil guardado! Bienvenido al sistema.', 'info');
  applyProfileToUI(__USER_PROFILE);
  showMainDashboardUI();
  await loadAndRender();
  loadAulaVirtualCerts();
});

// Permitir Enter en el input de colegiado de setup
document.getElementById('setupColegiadoNum')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('setupVerificarBtn')?.click(); }
});

/* =======================================================
   Carga inicial
======================================================= */
(async function initAuthButton() {
  const sb = getSupabaseClient();
  if (!sb) { updateAuthButton(false); return; }
  const currentUser = await getCurrentUser();
  updateAuthButton(!!currentUser);
  // Cargar config en segundo plano (sin bloquear)
  loadConfig().catch(e => console.warn('Config load error:', e));
})();

/* =======================================================
   Aula Virtual CPG — importar certificados
======================================================= */
function getAulaVirtualClient() {
  if (!getAulaVirtualClient._client) {
    const sdk = window.supabase;
    if (!sdk?.createClient || !window.SB_URL || !window.SB_KEY) return null;
    getAulaVirtualClient._client = sdk.createClient(window.SB_URL, window.SB_KEY, {
      db: { schema: 'aulacaeduc' },
    });
  }
  return getAulaVirtualClient._client;
}

let __AV_CERTS = [];
let __AV_IMPORTED_HASHES = new Set();

// Collapsible toggle Aula Virtual
(function setupAvToggle() {
  const header = document.querySelector('#aulavirtualSection h2');
  const body = document.getElementById('avBody');
  const chevron = document.getElementById('avChevron');
  if (!header || !body) return;
  header.addEventListener('click', () => {
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (chevron) chevron.style.transform = open ? '' : 'rotate(90deg)';
  });
})();

document.getElementById('avRefreshBtn')?.addEventListener('click', loadAulaVirtualCerts);

async function loadAulaVirtualCerts() {
  const sb = getSupabaseClient(); if (!sb) return;
  const user = __CACHED_SESSION?.user; if (!user) return;
  const avStatus = document.getElementById('avStatus');
  const avResults = document.getElementById('avResults');
  const colegiadoNum = __USER_PROFILE?.colegiado_numero || '';
  if (!colegiadoNum) { if (avStatus) avStatus.textContent = 'Sin número de colegiado vinculado.'; return; }
  if (avStatus) avStatus.textContent = 'Buscando…';
  const avSb = getAulaVirtualClient(); if (!avSb) { if (avStatus) avStatus.textContent = 'Error de conexión.'; return; }
  const { data: certs, error } = await avSb
    .from('cpg_certificates')
    .select('certificate_code, video_title, video_duration, issued_at, recipient_name, verify_url')
    .eq('collegiate_number', colegiadoNum)
    .order('issued_at', { ascending: false });
  if (error) { if (avStatus) avStatus.textContent = 'Error: ' + error.message; return; }
  const codes = (certs || []).map(c => c.certificate_code).filter(Boolean);
  let importedHashes = new Set();
  if (codes.length) {
    const { data: imp } = await sb.from('registros').select('hash').eq('usuario_id', user.id).in('hash', codes);
    (imp || []).forEach(r => { if (r.hash) importedHashes.add(r.hash); });
  }
  __AV_CERTS = certs || [];
  __AV_IMPORTED_HASHES = importedHashes;
  renderAvCerts();
  if (avResults) avResults.style.display = __AV_CERTS.length ? '' : 'none';
  const pending = __AV_CERTS.filter(c => !__AV_IMPORTED_HASHES.has(c.certificate_code)).length;
  if (avStatus) avStatus.textContent = __AV_CERTS.length
    ? `${__AV_CERTS.length} certificado(s) — Colegiado ${colegiadoNum}`
    : `Sin certificados en el Aula Virtual para el colegiado ${colegiadoNum}.`;
  const countBadge = document.getElementById('avCountBadge');
  if (countBadge) countBadge.textContent = pending > 0 ? ` (${pending} por importar)` : '';
}

function renderAvCerts() {
  const tbody = document.getElementById('avCertsBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  __AV_CERTS.forEach(cert => {
    const imported = __AV_IMPORTED_HASHES.has(cert.certificate_code);
    const horas = Number(cert.video_duration) || '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${sanitize(cert.video_title)}">${sanitize(cert.video_title.slice(0, 40))}${cert.video_title.length > 40 ? '…' : ''}</td>
      <td>${cert.issued_at ? cert.issued_at.slice(0, 10) : '—'}</td>
      <td>${horas !== '—' ? horas + ' h' : '—'}</td>
      <td>${imported
        ? '<span class="muted" style="font-size:13px">✓ Ya importado</span>'
        : `<button class="btn" data-cert="${sanitize(cert.certificate_code)}" data-av-import type="button" style="padding:4px 10px;font-size:13px">Importar</button>`
      }</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById('avCertsBody')?.addEventListener('click', async e => {
  const btn = e.target.closest('[data-av-import]');
  if (!btn) return;
  const certCode = btn.dataset.cert;
  btn.disabled = true; btn.textContent = 'Importando…';
  await importAvCert(certCode);
});

async function importAvCert(certCode) {
  const cert = __AV_CERTS.find(c => c.certificate_code === certCode);
  if (!cert) return;
  const sb = getSupabaseClient(); if (!sb) return;
  const user = __CACHED_SESSION?.user; if (!user) return;

  const nombre = __USER_PROFILE?.nombre || cert.recipient_name || '';
  const telefono = __USER_PROFILE?.telefono || '';
  const colegiadoActivo = (__USER_PROFILE?.colegiado_activo === true || __USER_PROFILE?.colegiado_activo === 'Sí') ? 'Sí' : 'No';
  const colegiadoNum = __USER_PROFILE?.colegiado_numero || '';

  if (!nombre || !telefono || !colegiadoNum) {
    showToast('Completa tu perfil antes de importar certificados.', 'warn');
    renderAvCerts(); return;
  }
  const horas = Number(cert.video_duration) || 1;
  const creditos = calcCreditos(horas);
  const fecha = cert.issued_at ? cert.issued_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const payload = {
    usuario_id: user.id, nombre, telefono,
    colegiado_numero: colegiadoNum, colegiado_activo: colegiadoActivo,
    actividad: cert.video_title, institucion: 'CAEDUC - Aula Virtual CPG',
    tipo: 'Teórica', fecha, horas, creditos,
    observaciones: 'Importado desde Aula Virtual CPG',
    hash: cert.certificate_code,
    archivo_url: null, archivo_mime: null,
  };
  const { error } = await sb.from('registros').insert(payload);
  if (error) { showToast('Error al importar: ' + sbErrMsg(error), 'error'); renderAvCerts(); return; }
  __AV_IMPORTED_HASHES.add(cert.certificate_code);
  renderAvCerts();
  showToast('¡Certificado importado correctamente!', 'info');
  await loadAndRender();
}

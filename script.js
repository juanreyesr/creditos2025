/* =======================================================
   Supabase init
======================================================= */
const SB_URL =
  window?.ENV?.SUPABASE_URL ||
  window.NEXT_PUBLIC_SUPABASE_URL ||
  window.__env?.SUPABASE_URL ||
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_URL : null) ||
  window.localStorage.getItem('SB_URL') ||
  (typeof window !== 'undefined' ? window?.SB_URL : null) ||
  (typeof globalThis !== 'undefined' ? globalThis?.SB_URL : null) ||
  (typeof document !== 'undefined' ? document?.SB_URL : null);

const SB_KEY =
  window?.ENV?.SUPABASE_ANON ||
  window.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  window.__env?.SUPABASE_ANON_KEY ||
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : null) ||
  window.localStorage.getItem('SB_KEY') ||
  (typeof window !== 'undefined' ? window?.SB_KEY : null);

if (!window.supabase) {
  console.error('Supabase SDK no cargó. Revisa el <script> de @supabase/supabase-js en index.html');
}

const supabase = window.supabase?.createClient(
  SB_URL ||
    (typeof NEXT_PUBLIC_SUPABASE_URL !== 'undefined' ? NEXT_PUBLIC_SUPABASE_URL : null) ||
    (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_URL : null) ||
    (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_URL : null),
  SB_KEY ||
    (typeof NEXT_PUBLIC_SUPABASE_ANON_KEY !== 'undefined' ? NEXT_PUBLIC_SUPABASE_ANON_KEY : null) ||
    (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_ANON_KEY : null) ||
    (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_ANON_KEY : null)
);

/* =======================================================
   Config/Utils
======================================================= */
const ADMIN_PASSWORD = "CAEDUC2025";  // solo para panel local de export
const ADMIN_SESSION_MIN = 10;
const MAX_FILE_MB = 10;
const ALLOWED_MIME = ["application/pdf","image/png","image/jpeg","image/jpg"];

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
const telEl = document.getElementById('telefono');

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
(function(){ const now=new Date(); fechaEl.max = now.toISOString().slice(0,10); })();
try { adminModal?.setAttribute('aria-hidden','true'); authModal?.setAttribute('aria-hidden','true'); } catch {}

horasEl.addEventListener('input', ()=> creditosEl.value = calcCreditos(horasEl.value));
browseBtn.addEventListener('click', ()=> fileInput.click());
fileInput.addEventListener('change', (e)=> handleFile(e.target.files?.[0]||null));
['dragenter','dragover'].forEach(ev=> upZone.addEventListener(ev, e=>{e.preventDefault(); upZone.style.borderColor = '#60a5fa';}));
['dragleave','drop'].forEach(ev=> upZone.addEventListener(ev, e=>{e.preventDefault(); upZone.style.borderColor = '#334155'; if(ev==='drop'){handleFile(e.dataTransfer.files?.[0]||null);} }));

function handleFile(file){
  preview.innerHTML=''; fileRef=null; if(!file) return;
  if(!ALLOWED_MIME.includes(file.type)) return showToast('Tipo no permitido. Solo PDF/JPG/PNG.', 'error');
  const mb=file.size/1024/1024; if(mb>MAX_FILE_MB) return showToast('Archivo supera 10 MB.', 'error');
  fileRef=file;
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
function openModal(m){ m.setAttribute('aria-hidden','false'); }
function closeModal(m){ m.setAttribute('aria-hidden','true'); }
authBtn?.addEventListener('click', ()=> openModal(authModal));
closeAuth?.addEventListener('click', ()=> closeModal(authModal));
authPass?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin.click(); });

doSignup?.addEventListener('click', async ()=>{
  authState.textContent = 'Creando cuenta...';
  const { error } = await supabase.auth.signUp({ email: authEmail.value.trim(), password: authPass.value });
  if(error) return authState.textContent = 'Error: '+error.message;
  authState.textContent = 'Cu

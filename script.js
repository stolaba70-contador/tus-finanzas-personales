const SUPABASE_URL = 'https://ltgybtkxncsghmtlmorh.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0Z3lidGt4bmNzZ2htdGxtb3JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0ODk0NzIsImV4cCI6MjA5MTA2NTQ3Mn0.8ASfW92EQpN3oll81ko2vqwAgaG8u6_7LYqHw6S6OJs';

// Almacenamiento en memoria para evitar problemas con localStorage bloqueado
const memStorage = {
  _data: {},
  getItem(key) { return this._data[key] ?? null; },
  setItem(key, val) { this._data[key] = val; },
  removeItem(key) { delete this._data[key]; }
};

window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage: memStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  }
});

// ============================================================
// AUTH STATE
// ============================================================
let currentUser = null;
let isLoginMode = true;

function showScreen(name) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('app-wrapper').style.display = 'none';
  if (name === 'auth') document.getElementById('auth-screen').style.display = 'flex';
  else if (name === 'pending') document.getElementById('pending-screen').style.display = 'flex';
  else if (name === 'app') document.getElementById('app-wrapper').style.display = 'block';
}

function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  document.getElementById('auth-subtitle').textContent = isLoginMode ? 'Iniciá sesión para continuar' : 'Creá tu cuenta';
  document.getElementById('auth-btn').textContent = isLoginMode ? 'Ingresar' : 'Registrarse';
  document.getElementById('auth-toggle-text').textContent = isLoginMode ? '¿No tenés cuenta?' : '¿Ya tenés cuenta?';
  document.getElementById('auth-toggle-link').textContent = isLoginMode ? 'Registrarse' : 'Iniciar sesión';
  document.getElementById('auth-pass2-wrap').style.display = isLoginMode ? 'none' : 'flex';
  setAuthMsg('', '');
}

function setAuthMsg(msg, type) {
  const el = document.getElementById('auth-msg');
  el.textContent = msg;
  el.className = 'auth-msg' + (type ? ' ' + type : '');
  el.style.display = msg ? 'block' : 'none';
}

async function submitAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const pass = document.getElementById('auth-pass').value;
  const pass2 = document.getElementById('auth-pass2').value;
  const btn = document.getElementById('auth-btn');

  if (!email || !pass) return setAuthMsg('Completá todos los campos', 'error');
  if (!isLoginMode && pass !== pass2) return setAuthMsg('Las contraseñas no coinciden', 'error');
  if (!isLoginMode && pass.length < 6) return setAuthMsg('La contraseña debe tener al menos 6 caracteres', 'error');

  btn.disabled = true;
  btn.textContent = 'Procesando...';
  setAuthMsg('', '');

  try {
    if (isLoginMode) {
      const { error } = await window.sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    } else {
      const { error } = await window.sb.auth.signUp({ email, password: pass });
      if (error) throw error;
      setAuthMsg('¡Cuenta creada! Esperá la aprobación para ingresar.', 'success');
      btn.disabled = false;
      btn.textContent = 'Registrarse';
      return;
    }
  } catch (err) {
    const msg = err.message.includes('Invalid login') ? 'Email o contraseña incorrectos' :
                err.message.includes('already registered') ? 'Este email ya está registrado' :
                err.message;
    setAuthMsg(msg, 'error');
    btn.disabled = false;
    btn.textContent = isLoginMode ? 'Ingresar' : 'Registrarse';
  }
}

async function checkApproval(user) {
  const { data, error } = await window.sb
    .from('usuarios')
    .select('aprobado')
    .eq('id', user.id)
    .single();
  if (error || !data) return false;
  return data.aprobado === true;
}

async function cerrarSesion() {
  await window.sb.auth.signOut();
  currentUser = null;
  expenses = [];
  ingresosData = {};
  presupuestoData = {};
  showScreen('auth');
}

// ============================================================
// INIT WITH AUTH
// ============================================================
window.sb.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    currentUser = session.user;
    const approved = await checkApproval(session.user);
    if (approved) {
      showScreen('app');
      await loadExpenses();
      await loadPresupuestoForMes(currentMesKey());
      rebuildCategoryUI();
      applyFilters();
      renderProgresoInicio();
    } else {
      showScreen('pending');
    }
  } else {
    currentUser = null;
    showScreen('auth');
  }
});

// ============================================================
// SUPABASE DATA: GASTOS
// ============================================================
async function loadExpenses() {
  const { data, error } = await window.sb
    .from('gastos')
    .select('*')
    .order('fecha', { ascending: false });
  if (!error && data) {
    expenses = data;
    filteredExpenses = [...expenses];
  }
}


// ============================================================
// STATE
// ============================================================
let expenses = [];
let apiKey = ''; // No longer needed - Edge Function handles Gemini
let currentTab = 'photo';
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordInterval = null;
let recordSeconds = 0;
let capturedPhotoBase64 = null;
let sortField = 'fecha';
let sortAsc = false;
let filteredExpenses = [...expenses];

const DEFAULT_CATS = [
  {name:'Alimentación', emoji:'🍔'},
  {name:'Transporte', emoji:'🚗'},
  {name:'Salud', emoji:'💊'},
  {name:'Entretenimiento', emoji:'🎬'},
  {name:'Servicios', emoji:'💡'},
  {name:'Ropa', emoji:'👕'},
  {name:'Tecnología', emoji:'💻'},
  {name:'Hogar', emoji:'🏠'},
  {name:'Educación', emoji:'📚'},
  {name:'Otros', emoji:'📦'},
];
let categories = JSON.parse(localStorage.getItem('mg_categories') || 'null') || DEFAULT_CATS.map(c => ({...c, custom: false}));

function saveCategories() {
  localStorage.setItem('mg_categories', JSON.stringify(categories));
}

// Init is handled by window.sb.auth.onAuthStateChange
// window.onload kept only for API status
window.onload = () => {
  updateApiStatus();
};

// ============================================================
// API KEY
// ============================================================
function openApiModal() {
  document.getElementById('apiKeyInput').value = apiKey;
  document.getElementById('apiModal').classList.add('open');
}
function closeApiModal() {
  document.getElementById('apiModal').classList.remove('open');
}
function saveApiKey() {
  const val = document.getElementById('apiKeyInput').value.trim();
  if (!val) return showToast('Ingresá una API key', 'warning', 'warning');
  apiKey = val;
  localStorage.setItem('mg_api_key', apiKey);
  updateApiStatus();
  closeApiModal();
  showToast('API key guardada', 'success', 'check_circle');
}
function updateApiStatus() {
  const el = document.getElementById('apiKeyStatus');
  if (el) el.textContent = apiKey ? '✓ API Key configurada' : 'Configurar API Key';
}

// ============================================================
// TABS
// ============================================================

function toggleRegistrar() {
  document.getElementById('registrarCard').classList.toggle('open');
}

function switchTab(tab, btn) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + tab).classList.add('active');
  hideError(); hideResult();
  capturedPhotoBase64 = null;
  capturedFileMime = null;
  document.getElementById('previewImg').style.display = 'none';
  document.getElementById('pdfPreview').style.display = 'none';
}

// ============================================================
// FILE HANDLING (photo, PDF, any image format)
// ============================================================
let capturedFileMime = null;

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    capturedPhotoBase64 = ev.target.result.split(',')[1];
    capturedFileMime = file.type || 'image/jpeg';

    const img = document.getElementById('previewImg');
    const pdfPrev = document.getElementById('pdfPreview');

    if (file.type === 'application/pdf') {
      img.style.display = 'none';
      pdfPrev.style.display = 'flex';
      document.getElementById('pdfName').textContent = file.name;
      document.getElementById('pdfSize').textContent = formatFileSize(file.size);
    } else {
      img.src = ev.target.result;
      img.style.display = 'block';
      pdfPrev.style.display = 'none';
    }
  };
  reader.readAsDataURL(file);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ============================================================
// VOICE RECORDING
// ============================================================
async function toggleRecording() {
  if (!isRecording) await startRecording();
  else stopRecording();
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = processAudio;
    mediaRecorder.start();
    isRecording = true;
    recordSeconds = 0;
    document.getElementById('recordBtn').classList.add('recording');
    document.getElementById('recordIcon').textContent = 'stop';
    document.getElementById('recordStatus').textContent = 'Grabando... Hablá tu gasto';
    document.getElementById('recordTimer').style.display = 'block';
    recordInterval = setInterval(() => {
      recordSeconds++;
      const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
      const s = String(recordSeconds % 60).padStart(2, '0');
      document.getElementById('recordTimer').textContent = `${m}:${s}`;
    }, 1000);
  } catch (err) {
    showError('No se pudo acceder al micrófono. Verificá los permisos del navegador.');
  }
}

function stopRecording() {
  if (mediaRecorder) {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  isRecording = false;
  clearInterval(recordInterval);
  document.getElementById('recordBtn').classList.remove('recording');
  document.getElementById('recordIcon').textContent = 'mic';
  document.getElementById('recordStatus').textContent = 'Audio grabado ✓ — Hacé click en "Procesar"';
}

function processAudio() {
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const reader = new FileReader();
  reader.onload = (e) => {
    window._audioBase64 = e.target.result.split(',')[1];
    window._audioMime = blob.type;
  };
  reader.readAsDataURL(blob);
}

// ============================================================
// ANALYZE — via Supabase Edge Function
// ============================================================
async function analyzeExpense() {
  let parts = [];
  let hasContent = false;

  if (currentTab === 'photo') {
    if (!capturedPhotoBase64) return showError('Seleccioná una foto o archivo primero.');
    const mime = capturedFileMime || 'image/jpeg';
    parts.push({ inline_data: { mime_type: mime, data: capturedPhotoBase64 } });
    hasContent = true;
  } else if (currentTab === 'voice') {
    if (!window._audioBase64) return showError('Grabá un audio primero.');
    parts.push({ inline_data: { mime_type: window._audioMime || 'audio/webm', data: window._audioBase64 } });
    hasContent = true;
  } else if (currentTab === 'text') {
    const txt = document.getElementById('textInput').value.trim();
    if (!txt) return showError('Escribí una descripción del gasto.');
    parts.push({ text: txt });
    hasContent = true;
  }

  if (!hasContent) return;

  setLoading(true);
  hideError(); hideResult();

  try {
    const { data: { session } } = await window.sb.auth.getSession();
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/procesar-gasto`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ parts, modo: document.getElementById('modoDetalle')?.checked ? 'detallado' : 'total' })
      }
    );

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

    const items = Array.isArray(data.items) ? data.items : [data.items];
    showMultiResult(items);

  } catch (err) {
    showError('Error al procesar: ' + err.message);
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  const btn = document.getElementById('btnAnalyze');
  btn.disabled = on;
  document.getElementById('loadingSpinner').style.display = on ? 'block' : 'none';
  document.getElementById('analyzeIcon').style.display = on ? 'none' : 'inline';
  document.getElementById('analyzeText').textContent = on ? 'Procesando...' : 'Procesar';
}

const CATS = ['Alimentación','Transporte','Salud','Entretenimiento','Servicios','Ropa','Tecnología','Hogar','Educación','Otros'];
const CAT_OPTS = CATS.map(c => {
  const emojis = {'Alimentación':'🍔','Transporte':'🚗','Salud':'💊','Entretenimiento':'🎬','Servicios':'💡','Ropa':'👕','Tecnología':'💻','Hogar':'🏠','Educación':'📚','Otros':'📦'};
  return `<option value="${c}">${emojis[c]} ${c}</option>`;
}).join('');

const MEDIOS = ['Efectivo','Débito','Crédito','Transferencia','Mercado Pago','Otro'];
const MEDIO_OPTS = MEDIOS.map(m => `<option value="${m}">${m}</option>`).join('');

function getCatOpts() {
  return categories.map(c => `<option value="${c.name}">${c.emoji || '🏷️'} ${c.name}</option>`).join('');
}

// ============================================================
// CATEGORY MANAGEMENT
// ============================================================
function rebuildCategoryUI() {
  // Filtro del Resumen -> categorías del Presupuesto
  rebuildFilterCat();
  // Lista de Config
  renderCatList();
}

function rebuildFilterCat() {
  const filterCat = document.getElementById('filterCat');
  if (!filterCat) return;
  const seleccionActual = filterCat.value;
  filterCat.innerHTML = '<option value="all">Todas</option>' + getEgresoCatOpts();
  // Mantener la selección si todavía existe; si no, volver a "Todas"
  const existe = Array.from(filterCat.options).some(o => o.value === seleccionActual);
  filterCat.value = existe ? seleccionActual : 'all';
}

function renderCatList() {
  const list = document.getElementById('catList');
  if (!list) return;
  list.innerHTML = categories.map((c, i) => `
    <div style="display:flex; align-items:center; justify-content:space-between;
      padding:10px 14px; background:var(--surface-2); border-radius:var(--r-md);
      border:1px solid var(--border);">
      <span style="font-size:14px; font-weight:500;">${c.emoji || '🏷️'} ${c.name}</span>
      <button onclick="deleteCategory(${i})" style="
        background:none; border:none; cursor:pointer; color:var(--error);
        display:flex; align-items:center; padding:4px; border-radius:6px;
        transition:background 0.2s;" onmouseover="this.style.background='var(--error-light)'"
        onmouseout="this.style.background='none'">
        <span class="material-icons-round" style="font-size:18px;">delete_outline</span>
      </button>
    </div>
  `).join('');
}

function addCategory() {
  const input = document.getElementById('newCatInput');
  const name = input.value.trim();
  if (!name) return showToast('Ingresá un nombre', 'warning', 'warning');
  if (categories.find(c => c.name.toLowerCase() === name.toLowerCase())) {
    return showToast('Ya existe esa categoría', 'warning', 'warning');
  }
  categories.push({ name, emoji: '', custom: true });
  saveCategories();
  rebuildCategoryUI();
  input.value = '';
  showToast(`Categoría "${name}" agregada`, 'success', 'check_circle');
}

function deleteCategory(idx) {
  const cat = categories[idx];
  categories.splice(idx, 1);
  saveCategories();
  rebuildCategoryUI();
  showToast(`"${cat.name}" eliminada`, 'info', 'delete');
}

// ============================================================
// CONFIG - API KEY
// ============================================================
function saveApiKeyConfig() {
  const val = document.getElementById('apiKeyInputConfig').value.trim();
  if (!val) return showToast('Ingresá una API key', 'warning', 'warning');
  apiKey = val;
  localStorage.setItem('mg_api_key', apiKey);
  updateApiStatus();
  document.getElementById('apiConfigStatus').textContent = '✓ API Key guardada correctamente';
  showToast('API key guardada', 'success', 'check_circle');
}

// ============================================================
// INGRESOS — Supabase
// ============================================================
const ICONS_INGRESO = {
  'efectivo': 'payments', 'caja': 'point_of_sale', 'cuenta': 'account_balance',
  'banco': 'account_balance', 'sueldo': 'work', 'salario': 'work',
  'mercado': 'smartphone', 'ahorro': 'savings', 'default': 'wallet'
};

function getIngresoIcon(nombre) {
  const n = nombre.toLowerCase();
  for (const key of Object.keys(ICONS_INGRESO)) {
    if (n.includes(key)) return ICONS_INGRESO[key];
  }
  return ICONS_INGRESO.default;
}

let mesActual = new Date().getMonth();
let anioActual = new Date().getFullYear();
let ingresosData = {};

function getMesKey() { return `${anioActual}-${String(mesActual+1).padStart(2,'0')}`; }

function getMesData() {
  const k = getMesKey();
  if (!ingresosData[k]) ingresosData[k] = { fuentes: [] };
  return ingresosData[k];
}

function cambiarMes(delta) {
  mesActual += delta;
  if (mesActual > 11) { mesActual = 0; anioActual++; }
  if (mesActual < 0) { mesActual = 11; anioActual--; }
  renderPresupuesto();
}

const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

async function loadIngresosForMes(mesKey) {
  const { data, error } = await window.sb
    .from('ingresos')
    .select('*')
    .eq('mes_key', mesKey);
  if (!error && data) {
    ingresosData[mesKey] = { fuentes: data };
  }
}

async function renderIngresos() {
  document.getElementById('mesLabel').textContent = `${MESES_ES[mesActual]} ${anioActual}`;
  const mesKey = getMesKey();

  // Load from Supabase if not cached
  if (!ingresosData[mesKey]) {
    await loadIngresosForMes(mesKey);
  }

  const data = getMesData();
  const list = document.getElementById('ingresosList');

  if (data.fuentes.length === 0) {
    list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-3); font-size:13px;">
      No hay fuentes de ingreso. Agregá una abajo.</div>`;
  } else {
    list.innerHTML = data.fuentes.map(f => `
      <div class="ingreso-item">
        <div class="ingreso-item-left">
          <div class="ingreso-icon">
            <span class="material-icons-round">${getIngresoIcon(f.nombre)}</span>
          </div>
          <div><div class="ingreso-nombre">${f.nombre}</div></div>
        </div>
        <div class="ingreso-actions">
          <input type="number" class="ingreso-monto-input" value="${f.monto || ''}"
            placeholder="$ 0" oninput="updateIngreso('${f.id}', this.value)"
            title="Monto disponible">
          <button class="btn-del-ingreso" onclick="eliminarIngreso('${f.id}')">
            <span class="material-icons-round">close</span>
          </button>
        </div>
      </div>
    `).join('');
  }

  // Egresos del mes
  const egresosEl = document.getElementById('egresosList');
  const expMes = expenses.filter(e => {
    const d = new Date(e.fecha + 'T12:00:00');
    return d.getMonth() === mesActual && d.getFullYear() === anioActual;
  });

  const porCat = {};
  expMes.forEach(e => { porCat[e.categoria] = (porCat[e.categoria] || 0) + e.monto; });
  const totalEgresos = expMes.reduce((s, e) => s + e.monto, 0);

  if (Object.keys(porCat).length === 0) {
    egresosEl.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-3); font-size:13px;">Sin gastos registrados este mes.</div>`;
  } else {
    egresosEl.innerHTML = Object.entries(porCat)
      .sort((a,b) => b[1]-a[1])
      .map(([cat, monto]) => `
        <div class="resumen-row">
          <div class="resumen-row-label">
            <span class="category-chip ${getCatColor(cat)}">${getCatEmoji(cat)} ${cat}</span>
          </div>
          <div class="resumen-row-monto">${formatMonto(monto)}</div>
        </div>
      `).join('');
  }

  document.getElementById('totalEgresos').textContent = formatMonto(totalEgresos);
  recalcSaldo();
}

function recalcSaldo() {
  const data = getMesData();
  const totalIngresos = data.fuentes.reduce((s, f) => s + (parseFloat(f.monto) || 0), 0);
  const expMes = expenses.filter(e => {
    const d = new Date(e.fecha + 'T12:00:00');
    return d.getMonth() === mesActual && d.getFullYear() === anioActual;
  });
  const totalEgresos = expMes.reduce((s, e) => s + e.monto, 0);
  const saldo = totalIngresos - totalEgresos;
  const saldoCard = document.getElementById('saldoCard');
  saldoCard.className = 'saldo-card' + (saldo > 0 ? ' positivo' : saldo < 0 ? ' negativo' : '');
  const prefix = saldo > 0 ? '+ ' : saldo < 0 ? '- ' : '';
  document.getElementById('saldoMonto').textContent = prefix + formatMonto(Math.abs(saldo));
  document.getElementById('saldoSub').textContent =
    `${formatMonto(totalIngresos)} ingresos — ${formatMonto(totalEgresos)} egresos`;
}

async function agregarIngreso() {
  const nombre = document.getElementById('newIngresoNombre').value.trim();
  if (!nombre) return showToast('Ingresá un nombre', 'warning', 'warning');
  const { data: { session } } = await window.sb.auth.getSession();
  const mesKey = getMesKey();
  const { data, error } = await window.sb.from('ingresos').insert({
    user_id: session.user.id,
    mes_key: mesKey,
    nombre,
    monto: 0,
  }).select().single();
  if (error) return showToast('Error al agregar', 'warning', 'warning');
  getMesData().fuentes.push({ id: data.id, nombre, monto: 0 });
  document.getElementById('newIngresoNombre').value = '';
  renderIngresos();
  showToast(`"${nombre}" agregado`, 'success', 'check_circle');
}

async function updateIngreso(id, val) {
  const monto = parseFloat(val) || 0;
  await window.sb.from('ingresos').update({ monto }).eq('id', id);
  const f = getMesData().fuentes.find(f => f.id === id);
  if (f) f.monto = monto;
  recalcSaldo();
}

async function eliminarIngreso(id) {
  if (!confirm('¿Eliminár esta fuente de ingreso?')) return;
  await window.sb.from('ingresos').delete().eq('id', id);
  const data = getMesData();
  data.fuentes = data.fuentes.filter(f => f.id !== id);
  renderIngresos();
}

// ============================================================
// PRESUPUESTO — manual (ingresos / egresos)
// ============================================================
let presupuestoData = {}; // mesKey -> { ingresos: [{id,concepto,monto}], egresos: [...] }

async function loadPresupuestoForMes(mesKey) {
  const { data, error } = await window.sb
    .from('presupuesto_items')
    .select('*')
    .eq('mes_key', mesKey)
    .order('created_at', { ascending: true });
  const bucket = { ingresos: [], egresos: [] };
  if (!error && data) {
    data.forEach(it => {
      const item = { id: it.id, concepto: it.concepto, monto: parseFloat(it.monto) || 0 };
      (it.tipo === 'ingreso' ? bucket.ingresos : bucket.egresos).push(item);
    });
  }
  presupuestoData[mesKey] = bucket;
}

let presuEditando = null; // { tipo, id } o null

function renderPresuLista(tipo) {
  const mesKey = getMesKey();
  const data = presupuestoData[mesKey] || { ingresos: [], egresos: [] };
  const arr = tipo === 'ingreso' ? data.ingresos : data.egresos;
  const el = document.getElementById(tipo === 'ingreso' ? 'presuIngList' : 'presuEgrList');
  if (!arr.length) {
    el.innerHTML = `<div class="presu-empty">Sin ${tipo === 'ingreso' ? 'ingresos' : 'egresos'} cargados</div>`;
    return;
  }
  el.innerHTML = arr.map(it => {
    // Línea en modo edición
    if (presuEditando && presuEditando.tipo === tipo && presuEditando.id === it.id) {
      const val = String(it.concepto).replace(/"/g, '&quot;');
      return `
        <div class="presu-form-row">
          <input class="presu-form-concepto" id="edit-concepto-${it.id}" value="${val}">
          <input type="number" class="presu-form-monto" id="edit-monto-${it.id}" value="${it.monto}">
          <div class="presu-form-actions">
            <button class="btn-presu-cancel" onclick="cancelarEdicionPresu('${tipo}')">Cancelar</button>
            <button class="btn-presu-save" onclick="guardarEdicionPresu('${tipo}','${it.id}')">Guardar</button>
          </div>
        </div>`;
    }
    // Línea normal (con lápiz + tacho)
    return `
      <div class="presu-line">
        <span class="presu-line-concepto">${it.concepto}</span>
        <span class="presu-line-monto">${formatMonto(it.monto)}</span>
        <button class="btn-presu-edit" onclick="editarPresuItem('${tipo}','${it.id}')" title="Editar">
          <span class="material-icons-round">edit</span>
        </button>
        <button class="btn-presu-del" onclick="eliminarPresuItem('${tipo}','${it.id}')" title="Eliminar">
          <span class="material-icons-round">close</span>
        </button>
      </div>`;
  }).join('');
}

async function renderPresupuesto() {
  const mesKey = getMesKey();
  document.getElementById('mesLabelPresu').textContent = `${MESES_ES[mesActual]} ${anioActual}`;
  if (!presupuestoData[mesKey]) await loadPresupuestoForMes(mesKey);

  renderPresuLista('ingreso');
  renderPresuLista('egreso');

  const data = presupuestoData[mesKey] || { ingresos: [], egresos: [] };
  const totalIng = data.ingresos.reduce((s, i) => s + (parseFloat(i.monto) || 0), 0);
  const totalEgr = data.egresos.reduce((s, e) => s + (parseFloat(e.monto) || 0), 0);
  const ahorro = totalIng - totalEgr;

  document.getElementById('presuIngTotal').textContent = formatMonto(totalIng);
  document.getElementById('presuEgrTotal').textContent = formatMonto(totalEgr);

  const card = document.getElementById('presuAhorroCard');
  card.className = 'saldo-card' + (ahorro > 0 ? ' positivo' : ahorro < 0 ? ' negativo' : '');
  const prefix = ahorro > 0 ? '+ ' : ahorro < 0 ? '- ' : '';
  document.getElementById('presuAhorroMonto').textContent = prefix + formatMonto(Math.abs(ahorro));

  // Mantener el filtro de categorías del Resumen sincronizado con el Presupuesto
  rebuildFilterCat();
}

function mostrarFormPresu(tipo) {
  const formId = tipo === 'ingreso' ? 'presuIngForm' : 'presuEgrForm';
  const ejemplo = tipo === 'ingreso' ? 'Sueldo' : 'Alquiler';
  document.getElementById(formId).innerHTML = `
    <div class="presu-form-row">
      <input class="presu-form-concepto" id="${formId}-concepto" placeholder="Concepto (ej: ${ejemplo})" autocomplete="off">
      <input type="number" class="presu-form-monto" id="${formId}-monto" placeholder="$ 0">
      <div class="presu-form-actions">
        <button class="btn-presu-cancel" onclick="cancelarFormPresu('${tipo}')">Cancelar</button>
        <button class="btn-presu-save" onclick="guardarFormPresu('${tipo}')">Guardar</button>
      </div>
    </div>`;
  document.getElementById(`${formId}-concepto`).focus();
}

function cancelarFormPresu(tipo) {
  document.getElementById(tipo === 'ingreso' ? 'presuIngForm' : 'presuEgrForm').innerHTML = '';
}

async function guardarFormPresu(tipo) {
  const formId = tipo === 'ingreso' ? 'presuIngForm' : 'presuEgrForm';
  const concepto = document.getElementById(`${formId}-concepto`).value.trim();
  const monto = parseFloat(document.getElementById(`${formId}-monto`).value) || 0;
  if (!concepto) return showToast('Ingresá un concepto', 'warning', 'warning');
  if (monto <= 0) return showToast('Ingresá un monto válido', 'warning', 'warning');

  const mesKey = getMesKey();
  const { data: { session } } = await window.sb.auth.getSession();
  const { data, error } = await window.sb.from('presupuesto_items').insert({
    user_id: session.user.id, mes_key: mesKey, tipo, concepto, monto,
  }).select().single();
  if (error) return showToast('Error al guardar', 'warning', 'warning');

  if (!presupuestoData[mesKey]) presupuestoData[mesKey] = { ingresos: [], egresos: [] };
  const item = { id: data.id, concepto, monto };
  (tipo === 'ingreso' ? presupuestoData[mesKey].ingresos : presupuestoData[mesKey].egresos).push(item);

  cancelarFormPresu(tipo);
  renderPresupuesto();
  showToast('Guardado', 'success', 'check_circle');
}

async function eliminarPresuItem(tipo, id) {
  if (!confirm('¿Eliminar este registro?')) return;
  await window.sb.from('presupuesto_items').delete().eq('id', id);
  const data = presupuestoData[getMesKey()];
  if (data) {
    if (tipo === 'ingreso') data.ingresos = data.ingresos.filter(i => i.id !== id);
    else data.egresos = data.egresos.filter(e => e.id !== id);
  }
  renderPresupuesto();
}

function editarPresuItem(tipo, id) {
  presuEditando = { tipo, id };
  renderPresuLista(tipo);
  const inp = document.getElementById(`edit-concepto-${id}`);
  if (inp) { inp.focus(); inp.select(); }
}

function cancelarEdicionPresu(tipo) {
  presuEditando = null;
  renderPresuLista(tipo);
}

async function guardarEdicionPresu(tipo, id) {
  const concepto = document.getElementById(`edit-concepto-${id}`).value.trim();
  const monto = parseFloat(document.getElementById(`edit-monto-${id}`).value) || 0;
  if (!concepto) return showToast('Ingresá un concepto', 'warning', 'warning');
  if (monto <= 0) return showToast('Ingresá un monto válido', 'warning', 'warning');

  const { error } = await window.sb.from('presupuesto_items')
    .update({ concepto, monto })
    .eq('id', id);
  if (error) return showToast('Error al guardar', 'warning', 'warning');

  const data = presupuestoData[getMesKey()];
  const arr = tipo === 'ingreso' ? data.ingresos : data.egresos;
  const item = arr.find(x => x.id === id);
  if (item) { item.concepto = concepto; item.monto = monto; }

  presuEditando = null;
  renderPresupuesto();
  showToast('Guardado', 'success', 'check_circle');
}

// ── Progreso en Inicio (gastos reales vs egresos presupuestados) ──

// ── Progreso en Inicio (gastos reales vs egresos presupuestados) ──
function currentMesKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

// Opciones de categoría para el registrador = egresos del presupuesto del mes actual
function getEgresoCatOpts() {
  const egresos = (presupuestoData[currentMesKey()]?.egresos) || [];
  if (!egresos.length) return getCatOpts(); // fallback a categorías de Config
  return egresos.map(e => `<option value="${e.concepto}">${e.concepto}</option>`).join('');
}

async function renderProgresoInicio() {
  const now = new Date();
  const mesKey = currentMesKey();
  const lbl = document.getElementById('progresoMes');
  if (lbl) lbl.textContent = `${MESES_ES[now.getMonth()]} ${now.getFullYear()} · gastado vs. presupuestado`;

  if (!presupuestoData[mesKey]) await loadPresupuestoForMes(mesKey);
  const egresos = (presupuestoData[mesKey]?.egresos) || [];

  // Real gastado del mes actual, agrupado por categoría (= concepto del egreso)
  const realPorCat = {};
  expenses.forEach(e => {
    const d = new Date(e.fecha + 'T12:00:00');
    if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
      realPorCat[e.categoria] = (realPorCat[e.categoria] || 0) + e.monto;
    }
  });

  const cont = document.getElementById('progresoList');
  if (!cont) return;
  if (!egresos.length) {
    cont.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-3); font-size:13px;">
      Cargá egresos en la pestaña Presupuesto para ver tu progreso.</div>`;
    return;
  }

  cont.innerHTML = egresos.map(eg => {
    const presu = parseFloat(eg.monto) || 0;
    const real = realPorCat[eg.concepto] || 0;
    const pct = presu > 0 ? (real / presu) * 100 : (real > 0 ? 100 : 0);
    const barW = Math.min(pct, 100);
    let cls = 'ok';
    if (presu > 0 && real > presu) cls = 'over';
    else if (pct >= 80) cls = 'warn';
    const right = real > presu
      ? `<span class="prog-over">+${formatMonto(real - presu)} excedido</span>`
      : `<span>Queda ${formatMonto(presu - real)}</span>`;
    return `
      <div class="prog-row">
        <div class="prog-top">
          <span class="prog-concepto">${eg.concepto}</span>
          <span class="prog-pct ${cls}">${Math.round(pct)}%</span>
        </div>
        <div class="prog-bar-wrap"><div class="prog-bar ${cls}" style="width:${barW}%;"></div></div>
        <div class="prog-figs">
          <span>${formatMonto(real)} de ${formatMonto(presu)}</span>
          ${right}
        </div>
      </div>`;
  }).join('');
}

const _switchScreen = function(name) {
  document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
  document.getElementById('screen-' + name).style.display = 'block';
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('nav-' + name).classList.add('active');
  if (name === 'config') renderCatList();
  if (name === 'presupuesto') renderPresupuesto();
  if (name === 'registrar') renderProgresoInicio();
};

function showMultiResult(items) {
  const list = document.getElementById('resultItemsList');
  list.innerHTML = items.map((item, i) => `
    <div class="result-item" id="item-${i}">
      <div class="result-item-num">
        Ítem ${i + 1}
        <button class="btn-remove-item" onclick="removeItem(${i})" title="Eliminar ítem">
          <span class="material-icons-round">remove_circle_outline</span>
        </button>
      </div>
      <div class="result-fields">
        <div class="result-field">
          <label>Fecha</label>
          <input type="date" id="i${i}-fecha" value="${item.fecha || new Date().toISOString().split('T')[0]}">
        </div>
        <div class="result-field">
          <label>Monto ($)</label>
          <input type="number" id="i${i}-monto" value="${item.monto || ''}" placeholder="0.00" step="0.01">
        </div>
        <div class="result-field">
          <label>Categoría</label>
          <select id="i${i}-categoria">${getEgresoCatOpts()}</select>
        </div>
        <div class="result-field">
          <label>Medio de pago</label>
          <select id="i${i}-medio">${MEDIO_OPTS}</select>
        </div>
        <div class="result-field">
          <label>Comercio</label>
          <input type="text" id="i${i}-comercio" value="${item.comercio || ''}" placeholder="Nombre del lugar">
        </div>
        <div class="result-field full-width">
          <label>Descripción</label>
          <input type="text" id="i${i}-descripcion" value="${item.descripcion || ''}" placeholder="Detalle del gasto">
        </div>
      </div>
    </div>
  `).join('');

  items.forEach((item, i) => {
    const sel = document.getElementById(`i${i}-categoria`);
    if (sel && item.categoria) {
      const opt = Array.from(sel.options).find(o => o.value.toLowerCase() === String(item.categoria).toLowerCase());
      if (opt) sel.value = opt.value;
    }
    const med = document.getElementById(`i${i}-medio`);
    if (med && item.medio && MEDIOS.includes(item.medio)) med.value = item.medio;
  });

  document.getElementById('resultCount').textContent = `${items.length} ítem${items.length !== 1 ? 's' : ''}`;
  document.getElementById('resultPreview').style.display = 'block';
}

function removeItem(idx) {
  const el = document.getElementById('item-' + idx);
  if (el) el.remove();
  const remaining = document.querySelectorAll('.result-item').length;
  document.getElementById('resultCount').textContent = `${remaining} ítem${remaining !== 1 ? 's' : ''}`;
  if (remaining === 0) hideResult();
}

function hideResult() {
  document.getElementById('resultPreview').style.display = 'none';
}

function discardResult() {
  hideResult();
  capturedPhotoBase64 = null;
  capturedFileMime = null;
  document.getElementById('previewImg').style.display = 'none';
  document.getElementById('pdfPreview').style.display = 'none';
  if (currentTab === 'photo') {
    document.getElementById('photoInput').value = '';
    document.getElementById('fileInput').value = '';
  } else if (currentTab === 'voice') {
    window._audioBase64 = null;
    document.getElementById('recordStatus').textContent = 'Presioná el botón para grabar';
    document.getElementById('recordTimer').style.display = 'none';
  } else {
    document.getElementById('textInput').value = '';
  }
}

// ============================================================
// SAVE ALL EXPENSES — Supabase
// ============================================================
async function saveAllExpenses() {
  const items = document.querySelectorAll('.result-item');
  if (!items.length) return;

  const { data: { session } } = await window.sb.auth.getSession();
  const toInsert = [];

  items.forEach(item => {
    const i = item.id.replace('item-', '');
    const monto = parseFloat(document.getElementById(`i${i}-monto`)?.value);
    if (!monto || monto <= 0) return;
    toInsert.push({
      user_id: session.user.id,
      fecha: document.getElementById(`i${i}-fecha`)?.value || new Date().toISOString().split('T')[0],
      monto,
      categoria: document.getElementById(`i${i}-categoria`)?.value || 'Otros',
      medio: document.getElementById(`i${i}-medio`)?.value || 'Efectivo',
      comercio: document.getElementById(`i${i}-comercio`)?.value || '',
      descripcion: document.getElementById(`i${i}-descripcion`)?.value || '',
    });
  });

  if (!toInsert.length) return showToast('Ingresá montos válidos', 'warning', 'warning');

  const { data, error } = await window.sb.from('gastos').insert(toInsert).select();
  if (error) return showToast('Error al guardar: ' + error.message, 'warning', 'warning');

  expenses = [...data, ...expenses];
  discardResult();
  applyFilters();
  renderProgresoInicio();
  showToast(`${toInsert.length} gasto${toInsert.length !== 1 ? 's' : ''} guardado${toInsert.length !== 1 ? 's' : ''}`, 'success', 'check_circle');
}

// ============================================================
// FILTERS & TABLE
// ============================================================
function onPeriodChange() {
  const v = document.getElementById('filterPeriod').value;
  document.getElementById('customRangeGroup').style.display = v === 'custom' ? 'flex' : 'none';
  document.getElementById('customRangeGroup2').style.display = v === 'custom' ? 'flex' : 'none';
  applyFilters();
}

function applyFilters() {
  const period = document.getElementById('filterPeriod').value;
  const cat = document.getElementById('filterCat').value;
  const medio = document.getElementById('filterMedio').value;
  const comercio = (document.getElementById('filterComercio').value || '').toLowerCase().trim();
  const desc = (document.getElementById('filterDesc').value || '').toLowerCase().trim();
  const montoMin = parseFloat(document.getElementById('filterMontoMin').value) || 0;
  const montoMax = parseFloat(document.getElementById('filterMontoMax').value) || Infinity;
  const from = document.getElementById('filterFrom').value;
  const to = document.getElementById('filterTo').value;
  const now = new Date();

  filteredExpenses = expenses.filter(e => {
    const d = new Date(e.fecha + 'T12:00:00');
    if (period === 'today') { if (e.fecha !== now.toISOString().split('T')[0]) return false; }
    else if (period === 'week') { const wa = new Date(now); wa.setDate(now.getDate()-7); if (d < wa) return false; }
    else if (period === 'month') { if (d.getMonth()!==now.getMonth()||d.getFullYear()!==now.getFullYear()) return false; }
    else if (period === 'year') { if (d.getFullYear()!==now.getFullYear()) return false; }
    else if (period === 'custom') { if (from && e.fecha<from) return false; if (to && e.fecha>to) return false; }
    if (cat !== 'all' && e.categoria !== cat) return false;
    if (medio !== 'all' && (e.medio||'') !== medio) return false;
    if (comercio && !(e.comercio||'').toLowerCase().includes(comercio)) return false;
    if (desc && !(e.descripcion||'').toLowerCase().includes(desc)) return false;
    if (e.monto < montoMin || e.monto > montoMax) return false;
    return true;
  });

  filteredExpenses.sort((a, b) => {
    let va = a[sortField], vb = b[sortField];
    if (sortField === 'monto') { va = parseFloat(va); vb = parseFloat(vb); }
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  renderTable();
  updateStats();
}

function clearFilters() {
  document.getElementById('filterPeriod').value = 'all';
  document.getElementById('filterCat').value = 'all';
  document.getElementById('filterMedio').value = 'all';
  document.getElementById('filterComercio').value = '';
  document.getElementById('filterDesc').value = '';
  document.getElementById('filterMontoMin').value = '';
  document.getElementById('filterMontoMax').value = '';
  document.getElementById('filterFrom').value = '';
  document.getElementById('filterTo').value = '';
  document.getElementById('customRangeGroup').style.display = 'none';
  document.getElementById('customRangeGroup2').style.display = 'none';
  applyFilters();
}

function sortBy(field) {
  if (sortField === field) sortAsc = !sortAsc;
  else { sortField = field; sortAsc = false; }
  document.querySelectorAll('.sort-icon').forEach(el => el.textContent = 'unfold_more');
  document.querySelectorAll('thead th').forEach(th => th.classList.remove('sorted'));
  const icon = document.getElementById('sort-' + field);
  if (icon) { icon.textContent = sortAsc ? 'arrow_upward' : 'arrow_downward'; icon.parentElement.classList.add('sorted'); }
  applyFilters();
}

const catColorMap = {
  'Alimentación':'cat-alimentacion','Transporte':'cat-transporte','Salud':'cat-salud',
  'Entretenimiento':'cat-entretenimiento','Servicios':'cat-servicios','Ropa':'cat-ropa',
  'Tecnología':'cat-tecnologia','Hogar':'cat-hogar','Educación':'cat-educacion','Otros':'cat-otros'
};

function getCatEmoji(name) {
  const c = categories.find(x => x.name === name);
  return c ? (c.emoji || '🏷️') : '🏷️';
}
function getCatColor(name) {
  return catColorMap[name] || 'cat-otros';
}

function renderTable() {
  const tbody = document.getElementById('expensesTable');
  const empty = document.getElementById('emptyState');
  document.getElementById('tableCount').textContent = filteredExpenses.length;

  if (filteredExpenses.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = filteredExpenses.map(e => {
    const colorClass = getCatColor(e.categoria);
    const emoji = getCatEmoji(e.categoria);
    const fechaFmt = formatDate(e.fecha);
    const montFmt = formatMonto(e.monto);
    return `
      <tr>
        <td class="td-date">${fechaFmt}</td>
        <td class="td-amount">${montFmt}</td>
        <td><span class="category-chip ${colorClass}">${emoji} ${e.categoria}</span></td>
        <td style="color:var(--text-2); font-size:12px;">${e.medio || '—'}</td>
        <td>${e.comercio || '—'}</td>
        <td class="td-desc"><span title="${e.descripcion}">${e.descripcion || '—'}</span></td>
        <td>
          <button class="btn-delete" onclick="deleteExpense('${e.id}')" title="Eliminar">
            <span class="material-icons-round">delete_outline</span>
          </button>
        </td>
      </tr>`;
  }).join('');
}

async function deleteExpense(id) {
  if (!confirm('¿Seguro que querés eliminar este gasto?')) return;
  const { error } = await window.sb.from('gastos').delete().eq('id', id);
  if (error) return showToast('Error al eliminar', 'warning', 'warning');
  expenses = expenses.filter(e => String(e.id) !== String(id));
  applyFilters();
  renderProgresoInicio();
  showToast('Gasto eliminado', 'info', 'delete');
}

function updateStats() {
  const total = filteredExpenses.reduce((s, e) => s + e.monto, 0);
  const count = filteredExpenses.length;
  // Días distintos en los que hubo gastos (según el filtro aplicado)
  const diasUnicos = new Set(filteredExpenses.map(e => e.fecha)).size;
  const avgPorDia = diasUnicos ? total / diasUnicos : 0;
  const max = count ? Math.max(...filteredExpenses.map(e => e.monto)) : 0;
  const maxExp = filteredExpenses.find(e => e.monto === max);

  document.getElementById('statTotal').textContent = formatMonto(total);
  document.getElementById('statCount').textContent = count;
  document.getElementById('statAvgLabel').textContent =
    `Promedio diario: ${formatMonto(avgPorDia)} · ${diasUnicos} día${diasUnicos !== 1 ? 's' : ''}`;
  document.getElementById('statMax').textContent = formatMonto(max);
  document.getElementById('statMaxCat').textContent = maxExp ? `${getCatEmoji(maxExp.categoria)} ${maxExp.categoria}` : '—';
}

// ============================================================
// EXPORT EXCEL
// ============================================================
function exportCSV() {
  if (!filteredExpenses.length) return showToast('No hay gastos para exportar', 'warning', 'warning');

  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  script.onload = () => {
    const data = [
      ['Fecha', 'Monto', 'Categoría', 'Medio de pago', 'Comercio', 'Descripción'],
      ...filteredExpenses.map(e => [
        e.fecha, e.monto, e.categoria, e.medio || '', e.comercio || '', e.descripcion || ''
      ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    // Column widths
    ws['!cols'] = [
      {wch:12}, {wch:14}, {wch:16}, {wch:16}, {wch:22}, {wch:36}
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
    XLSX.writeFile(wb, 'tus_finanzas.xlsx');
    showToast('Excel exportado', 'success', 'download');
  };
  script.onerror = () => showToast('Error al cargar librería', 'warning', 'warning');
  document.head.appendChild(script);
}

// ============================================================
// HELPERS
// ============================================================
function formatMonto(n) {
  return '$ ' + (n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${d} ${months[parseInt(m)-1]} ${y}`;
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  document.getElementById('errorText').textContent = msg;
  el.style.display = 'flex';
}

function hideError() {
  document.getElementById('errorMsg').style.display = 'none';
}

function showToast(msg, type, icon) {
  const toast = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  document.getElementById('toastIcon').textContent = icon || 'info';
  toast.style.background = type === 'success' ? '#1B6B3A' : type === 'warning' ? '#E65100' : '#2d3a30';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============================================================
// SCREEN SWITCHING
// ============================================================
function switchScreen(name) { _switchScreen(name); }

// ============================================================
// SUPABASE CONFIG
// ============================================================
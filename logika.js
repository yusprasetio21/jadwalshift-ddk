/* =====================================================================
   STATE & KONSTANTA
   ===================================================================== */
const CAP = 2;
const DEFAULT_NAMES = [
  "Hendra Setiaji","Asmadi Djasman","Akbar Yus Prasetio","Amzah","Aziz Setia Aji",
  "Hanapi","M Hajar Zakariya","Grandhista Septya I. P","Reza Pitriyanto","Reza Bayu Perdana"
];
let personnel = DEFAULT_NAMES.map((name,i)=>({ id:i, name, rank:i+1, kuningQuota:10, maxQuota:14, cutiBalances:{} }));
let cutiList = [];
let kuningList = [];
let lockedList = [];
let swapList = [];
let nextId = 1;
const CUTI_DEFAULT_BALANCE = 12;
const HARD_MAX = 14;
const WEEK_WINDOW = 7;
const KUNING_MIN_QUOTA = 4, KUNING_DECAY_RATIO = 0.8;
const MAXDAYS_MIN_QUOTA = 12, MAXDAYS_DECAY_RATIO = 0.9;
let currentRole = 'guest';
let activePanel = null;
let adminTab = 'setup';
let kuningWindow = { start: 20, end: 26, draftDay: 27, distributeDay: 29 };
let printMeta = { lampiran: 'Lampiran Surat', nomor: '', tanggal: '' }; // untuk kop cetak formal
let extraHolidays = {}; // key "Y-M" -> "1,17" (tanggal merah tambahan selain Sabtu/Minggu), string mentah dari input
const monthNames = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
function realToday(){ const t=new Date(); return {y:t.getFullYear(), m:t.getMonth()+1, d:t.getDate()}; }
const rtNow = realToday();
let viewY = rtNow.y;
let viewM = rtNow.m;
let schedules = {};

function esc(str){
  if(str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function getPerson(id){
  return personnel.find(p=>p.id===id) || { id, name:'Personel '+(id!=null?id:'?'), rank:99, maxQuota:14, kuningQuota:10 };
}

/* =====================================================================
   SUPABASE SYNC
   ===================================================================== */
const SUPABASE_URL = 'https://qqosctgfqgdkzwbdzwgw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxb3NjdGdmcWdka3p3YmR6d2d3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMTg5MzEsImV4cCI6MjEwNTg5NDkzMX0.ZpO8s-wZ3AF72zdTZYqX-ZIP4ZwdPib7dwtQXV6xhDY';
const sb = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
if(!sb) console.warn('[supabase] client tidak aktif — cek SUPABASE_URL/ANON_KEY atau koneksi ke CDN.');

async function persistPersonnelField(id, field, value){
  const col = field==='kuningQuota' ? 'kuning_quota' : field==='maxQuota' ? 'max_quota' : field;
  await dbUpdate('personnel', id, { [col]: value });
}
async function persistCutiBalance(pid, year, balance){
  await dbUpsert('cuti_balances', { personnel_id: pid, year, balance }, 'personnel_id,year');
}
async function persistSettings(){
  await dbUpsert('app_settings', {
    id: true,
    kuning_window_start: kuningWindow.start,
    kuning_window_end: kuningWindow.end,
    kuning_window_draft_day: kuningWindow.draftDay,
    kuning_window_distribute_day: kuningWindow.distributeDay,
    print_lampiran: printMeta.lampiran,
    print_nomor: printMeta.nomor || null,
    print_tanggal: printMeta.tanggal || null
  }, 'id');
}
async function persistExtraHoliday(y, m, daysStr){
  await dbUpsert('extra_holidays', { year: y, month: m, days: daysStr }, 'year,month');
}

async function loadFromSupabase(){
  if(!sb) return;
  try{
    const [pRes, cbRes, crRes, krRes, lsRes, srRes, schRes, setRes, ehRes] = await Promise.all([
      sb.from('personnel').select('*').order('id'),
      sb.from('cuti_balances').select('*'),
      sb.from('cuti_requests').select('*'),
      sb.from('kuning_requests').select('*'),
      sb.from('locked_slots').select('*'),
      sb.from('swap_requests').select('*'),
      sb.from('schedules').select('*'),
      sb.from('app_settings').select('*').eq('id', true).maybeSingle(),
      sb.from('extra_holidays').select('*')
    ]);
    const pRows = pRes.data, cbRows = cbRes.data, crRows = crRes.data, krRows = krRes.data,
          lsRows = lsRes.data, srRows = srRes.data, schRows = schRes.data, setRow = setRes.data, ehRows = ehRes.data;

    if(pRows && pRows.length){
      personnel = pRows.map(r=>({
        id: r.id, name: r.name, rank: r.rank, kuningQuota: r.kuning_quota,
        maxQuota: (r.max_quota==null ? 14 : r.max_quota),
        cutiBalances: (cbRows||[]).filter(b=>b.personnel_id===r.id)
          .reduce((acc,b)=>{ acc[b.year]=b.balance; return acc; }, {})
      }));
    }
    if(crRows) cutiList = crRows.map(r=>({ id:r.id, personnelId:r.personnel_id, start:r.start_day, end:r.end_day, reason:r.reason, status:r.status, month:r.month, year:r.year }));
    if(krRows) kuningList = krRows.map(r=>({ id:r.id, personnelId:r.personnel_id, start:r.start_day, end:r.end_day, status:r.status, month:r.month, year:r.year }));
    if(lsRows) lockedList = lsRows.map(r=>({ id:r.id, personnelId:r.personnel_id, date:r.date, slot:r.slot, reason:r.reason, month:r.month, year:r.year }));
    if(srRows) swapList = srRows.map(r=>({ id:r.id, requesterId:r.requester_id, date:r.date, slot:r.slot, partnerId:r.partner_id, reason:r.reason, status:r.status, month:r.month, year:r.year }));
    if(schRows) schRows.forEach(r=>{
      schedules[skey(r.year, r.month)] = { calendar:r.calendar, monthPS:r.month_ps, monthM:r.month_m, logs:r.logs||[], days:r.days, endQueue:r.end_queue||[], endCur:r.end_cur||null };
    });
    if(setRow){
      kuningWindow = { start:setRow.kuning_window_start ?? kuningWindow.start, end:setRow.kuning_window_end ?? kuningWindow.end, draftDay:setRow.kuning_window_draft_day ?? kuningWindow.draftDay, distributeDay:setRow.kuning_window_distribute_day ?? kuningWindow.distributeDay };
      printMeta = { lampiran:setRow.print_lampiran || printMeta.lampiran, nomor:setRow.print_nomor || '', tanggal:setRow.print_tanggal || '' };
    }
    if(ehRows) ehRows.forEach(r=>{ extraHolidays[skey(r.year, r.month)] = r.days; });

    const allIds = [...cutiList, ...kuningList, ...lockedList, ...swapList].map(x=>x.id);
    if(allIds.length) nextId = Math.max(nextId, Math.max(...allIds) + 1);
  }catch(e){
    console.error('[supabase load]', e);
  }
}

function skey(y,m){ return y+'-'+m; }
function nextMonthYear(y,m){ return m===12 ? {y:y+1,m:1} : {y:y,m:m+1}; }
function prevMonthYear(y,m){ return m===1 ? {y:y-1,m:12} : {y:y,m:m-1}; }
function isKuningWindowOpen(){
  const d = realToday().d;
  const {start, end} = kuningWindow;
  if(start<=end) return d>=start && d<=end;
  return d>=start || d<=end;
}
function nextKuningOpenLabel(){
  const rt = realToday();
  if(rt.d < kuningWindow.start) return `tanggal ${kuningWindow.start} ${monthNames[rt.m-1]} ${rt.y}`;
  const nm = nextMonthYear(rt.y, rt.m);
  return `tanggal ${kuningWindow.start} ${monthNames[nm.m-1]} ${nm.y}`;
}
function isAdmin(){ return currentRole==='admin'; }
function isUserRole(){ return typeof currentRole==='string' && currentRole.startsWith('p'); }
function currentPersonnelId(){ return isUserRole() ? parseInt(currentRole.slice(1)) : null; }

/* =====================================================================
   AUTH
   ===================================================================== */
const AUTH_KEY = 'sim-shift-user';
const PIN_ADMIN = '1234';
const PIN_PERSONEL = {};
function saveSession(role){ try{ sessionStorage.setItem(AUTH_KEY, role); }catch(e){} }
function loadSession(){ try{ return sessionStorage.getItem(AUTH_KEY) || null; }catch(e){ return null; } }
function clearSession(){ try{ sessionStorage.removeItem(AUTH_KEY); }catch(e){} }
function roleLabel(role){
  if(role==='admin') return 'Admin';
  if(role && role.startsWith('p')) return 'Personel';
  return 'Tamu';
}
function roleName(role){
  if(role==='admin') return 'Administrator';
  if(role && role.startsWith('p')) return personnel[parseInt(role.slice(1))].name;
  return 'Tamu';
}
function initials(name){
  const parts = String(name).trim().split(/\s+/);
  if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[parts.length-1][0]).toUpperCase();
}
const selYear = document.getElementById('selYear');
for(let y=rtNow.y-1; y<=rtNow.y+2; y++) selYear.innerHTML += `<option value="${y}" ${y===viewY?'selected':''}>${y}</option>`;

function daysInMonthOf(y,m){ return new Date(y, m, 0).getDate(); }
function daysInMonth(){ return daysInMonthOf(viewY, viewM); }
function pad2(n){ return n<10?'0'+n:''+n; }
function monthFirstStr(){ return `${viewY}-${pad2(viewM)}-01`; }
function monthLastStr(){ return `${viewY}-${pad2(viewM)}-${pad2(daysInMonth())}`; }
function todayStr(){ const t=new Date(); return `${t.getFullYear()}-${pad2(t.getMonth()+1)}-${pad2(t.getDate())}`; }

function renderLoginRoles(){
  const box = document.getElementById('loginRoles');
  if(!box) return;
  let html = `<button class="login-role admin" data-role="admin" type="button">
      <span class="av">AD</span>
      <div style="flex:1; min-width:0;">
        <span class="nm" style="display:block;">Administrator</span>
        <span style="font-size:11px; color:#9E7220; font-weight:600;">Akses Penuh · Wajib PIN</span>
      </div>
      <span class="sub-arrow" style="color:#C97A25; background:rgba(201,122,37,.1);">PIN 🔒</span>
    </button>`;
  html += personnel.map(p=>`<button class="login-role person" data-role="p${p.id}" type="button">
      <span class="av">${initials(p.name)}</span>
      <div style="flex:1; min-width:0;">
        <span class="nm" style="display:block;">${esc(p.name)}</span>
        <span style="font-size:11px; color:var(--ink-soft); font-weight:500;">Personel Shift</span>
      </div>
      <span class="sub-arrow">Masuk →</span>
    </button>`).join('');
  box.innerHTML = html;
  box.querySelectorAll('.login-role').forEach(b=>{
    b.addEventListener('click', ()=>{
      const role = b.dataset.role;
      if(role==='admin'){
        box.querySelectorAll('.login-role').forEach(x=>x.classList.remove('selected'));
        b.classList.add('selected');
        const pinSec = document.getElementById('adminPinSection');
        if(pinSec){
          pinSec.style.display = 'block';
          const pinBox = document.getElementById('loginPin');
          if(pinBox){
            pinBox.value = '';
            pinBox.focus();
          }
          const hint = document.getElementById('loginHint');
          if(hint){
            hint.classList.remove('err');
            hint.textContent = 'Masukkan PIN admin untuk melanjutkan.';
          }
        }
      } else {
        // User personel: Langsung masuk tanpa password / PIN
        box.querySelectorAll('.login-role').forEach(x=>x.classList.remove('selected'));
        const pinSec = document.getElementById('adminPinSection');
        if(pinSec) pinSec.style.display = 'none';
        saveSession(role);
        enterApp(role);
        toast(`Selamat datang, ${roleName(role)} 👋`);
      }
    });
  });
}
function selectedLoginRole(){
  const sel = document.querySelector('.login-role.selected');
  return sel ? sel.dataset.role : null;
}
function updateLoginHint(){
  const role = selectedLoginRole();
  const hint = document.getElementById('loginHint');
  if(!hint) return;
  hint.classList.remove('err');
  if(role==='admin'){
    hint.textContent = 'Masukkan PIN admin untuk melanjutkan.';
  } else {
    hint.textContent = '';
  }
}
function tryLogin(){
  const role = selectedLoginRole();
  const hint = document.getElementById('loginHint');
  if(hint) hint.classList.remove('err');
  if(!role || role!=='admin'){
    if(hint){ hint.textContent='Pilih Administrator dulu.'; hint.classList.add('err'); }
    return;
  }
  const pinBox = document.getElementById('loginPin');
  const pin = pinBox ? pinBox.value.trim() : '';
  if(pin!==PIN_ADMIN){
    if(hint){
      hint.textContent='PIN admin salah. Silakan coba lagi.';
      hint.classList.add('err');
    }
    if(pinBox) pinBox.select();
    return;
  }
  saveSession('admin');
  enterApp('admin');
  toast('Login berhasil sebagai Administrator 👋');
}
function enterApp(role){
  currentRole = role;
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('loginScreen').setAttribute('aria-hidden','true');
  document.getElementById('appRoot').style.display = 'block';
  document.getElementById('btnOpenAdmin').style.display = isAdmin() ? 'inline-flex' : 'none';
  updateUserChip();
  renderAll();
}
function logout(){
  clearSession();
  currentRole = 'guest';
  closeModal();
  hideAdminPage();
  document.getElementById('userChipMenu').classList.remove('open');
  document.querySelectorAll('.login-role').forEach(x=>x.classList.remove('selected'));
  const pinSec = document.getElementById('adminPinSection');
  if(pinSec) pinSec.style.display = 'none';
  const pinBox = document.getElementById('loginPin');
  if(pinBox) pinBox.value='';
  updateLoginHint();
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginScreen').setAttribute('aria-hidden','false');
  toast('Anda telah logout');
}
function updateUserChip(){
  const chip = document.getElementById('userChip');
  if(!currentRole || currentRole==='guest'){ chip.hidden = true; return; }
  chip.hidden = false;
  chip.classList.toggle('is-admin', isAdmin());
  const name = roleName(currentRole);
  document.getElementById('userName').textContent = name;
  document.getElementById('userRole').textContent = roleLabel(currentRole);
  document.getElementById('userAvatar').textContent = isAdmin() ? 'AD' : initials(name);
  const subEl = document.getElementById('headerSubText');
  if(subEl) subEl.style.display = isAdmin() ? 'block' : 'none';
}
document.getElementById('userChipBtn').addEventListener('click', e=>{
  e.stopPropagation();
  const menu = document.getElementById('userChipMenu');
  menu.classList.toggle('open');
  document.getElementById('userChipBtn').setAttribute('aria-expanded', menu.classList.contains('open'));
});
document.addEventListener('click', ()=>{
  document.getElementById('userChipMenu').classList.remove('open');
  document.getElementById('userChipBtn').setAttribute('aria-expanded','false');
});
document.getElementById('menuSwitch').addEventListener('click', ()=>{
  document.getElementById('userChipMenu').classList.remove('open');
  document.getElementById('appRoot').style.display='none';
  document.getElementById('adminPage').style.display='none';
  document.querySelectorAll('.login-role').forEach(x=>x.classList.remove('selected'));
  const pinSec = document.getElementById('adminPinSection');
  if(pinSec) pinSec.style.display = 'none';
  const pinBox = document.getElementById('loginPin');
  if(pinBox) pinBox.value = '';
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginScreen').setAttribute('aria-hidden','false');
});
document.getElementById('menuLogout').addEventListener('click', logout);
document.getElementById('loginBtn').addEventListener('click', tryLogin);
document.getElementById('loginPin').addEventListener('keydown', e=>{ if(e.key==='Enter') tryLogin(); });
const btnCancelAdmin = document.getElementById('btnCancelAdminPin');
if(btnCancelAdmin){
  btnCancelAdmin.addEventListener('click', ()=>{
    document.querySelectorAll('.login-role').forEach(x=>x.classList.remove('selected'));
    const pinSec = document.getElementById('adminPinSection');
    if(pinSec) pinSec.style.display = 'none';
    const pinBox = document.getElementById('loginPin');
    if(pinBox) pinBox.value = '';
  });
}

/* =====================================================================
   UTIL
   ===================================================================== */
function updateNavHighlight(){
  document.querySelectorAll('.navbtn[data-panel]').forEach(btn=> btn.classList.toggle('active', btn.dataset.panel===activePanel));
}
function updateGenerateButton(){
  const b = document.getElementById('btnGenerate');
  b.style.display = isAdmin() ? 'inline-flex' : 'none';
  document.getElementById('btnGenerateLabel').textContent = `Generate jadwal ${monthNames[viewM-1]}`;
  const br = document.getElementById('btnResetSched');
  if(br){
    const hasSched = !!schedules[skey(viewY, viewM)];
    br.style.display = (isAdmin() && hasSched) ? 'inline-flex' : 'none';
  }
  updateUndoRedoButtons();
}

/* =====================================================================
   SISTEM RIWAYAT JADWAL (UNDO / REDO / BACK)
   ===================================================================== */
const scheduleHistory = {}; // key: "YYYY-M" -> { undo: [], redo: [] }

function canUndo(y, m){
  const h = getHistory(y, m);
  return h.undo.length > 0;
}

function canRedo(y, m){
  const h = getHistory(y, m);
  return h.redo.length > 0;
}

function updateUndoRedoButtons(){
  const btnUndo = document.getElementById('btnUndoSched');
  const btnRedo = document.getElementById('btnRedoSched');
  if(!btnUndo || !btnRedo) return;
  const show = isAdmin();
  const uAvail = canUndo(viewY, viewM);
  const rAvail = canRedo(viewY, viewM);
  btnUndo.style.display = (show && uAvail) ? 'inline-flex' : 'none';
  btnRedo.style.display = (show && rAvail) ? 'inline-flex' : 'none';
}

/* =====================================================================
   SISTEM MODE PRATINJAU (PREVIEW / DRAFT SEBELUM SUBMIT)
   ===================================================================== */
let previewScheduleState = null; // { year, month, sched, originalSched, actionDesc }

function isPreviewActive(y, m){
  return !!(previewScheduleState && previewScheduleState.year === y && previewScheduleState.month === m);
}

/* =====================================================================
   PENOMORAN VERSI JADWAL HASIL TUKAR DINAS (SCHEDULE VERSIONING)
   ===================================================================== */
function getScheduleVersionInfo(y, m){
  const sched = schedules[skey(y, m)];
  if(!sched) return null;
  const isDraft = isPreviewActive(y, m);
  const approvedSwaps = swapList.filter(s => s.year === y && s.month === m && s.status === 'approved');
  const swapCount = approvedSwaps.length;
  const verNum = isDraft ? 'Draft' : `v1.${swapCount}`;
  const verTitle = isDraft
    ? 'Draft Pratinjau (Belum Disimpan)'
    : (swapCount === 0 ? 'v1.0 (Master / Awal Dibuat)' : `v1.${swapCount} (${swapCount} Tukar Dinas Disetujui)`);
  return {
    version: verNum,
    title: verTitle,
    swapCount,
    isDraft,
    swaps: approvedSwaps
  };
}
function pendingCounts(){
  return {
    cuti: cutiList.filter(c=>c.status==='pending').length,
    kuning: kuningList.filter(k=>k.status==='pending').length,
    swap: swapList.filter(s=>s.status==='pending').length
  };
}
function updateNavBadges(){
  const bc = document.getElementById('badgeCuti');
  const bk = document.getElementById('badgeKuning');
  const bs = document.getElementById('badgeSwap');
  const lk = document.getElementById('lockKuning');
  let nCuti, nKuning, nSwap;
  if(isAdmin()){
    const p = pendingCounts();
    nCuti = p.cuti; nKuning = p.kuning; nSwap = p.swap;
  } else if(isUserRole()){
    nCuti = cutiList.filter(c=>c.personnelId===currentPersonnelId() && c.status==='pending').length;
    nKuning = kuningList.filter(k=>k.personnelId===currentPersonnelId() && k.status==='pending').length;
    nSwap = swapList.filter(s=>s.requesterId===currentPersonnelId() && s.status==='pending').length;
  } else { nCuti = 0; nKuning = 0; nSwap = 0; }
  bc.hidden = nCuti===0; bc.textContent = nCuti;
  bk.hidden = nKuning===0; bk.textContent = nKuning;
  if(bs){ bs.hidden = nSwap===0; bs.textContent = nSwap; }
  if(lk){ lk.hidden = isKuningWindowOpen(); lk.title = isKuningWindowOpen() ? '' : `Ditutup, dibuka lagi ${nextKuningOpenLabel()}`; }

  const ba = document.getElementById('badgeAdmin');
  if(ba){
    const total = pendingCounts().cuti + pendingCounts().kuning + pendingCounts().swap;
    ba.hidden = total===0; ba.textContent = total;
  }
}
function personnelOptions(){ return personnel.map(p=>`<option value="${p.id}">${p.name}</option>`).join(''); }
function kuningUsedInMonth(pid, month, year){
  return kuningList.filter(k=>k.personnelId===pid && k.status!=='rejected' && k.month===month && k.year===year)
    .reduce((sum,k)=> sum + (k.end-k.start+1), 0);
}
function effectiveKuningQuota(pid, year, month){
  const base = personnel[pid].kuningQuota;
  const pv = prevMonthYear(year, month);
  const usedPrev = kuningUsedInMonth(pid, pv.m, pv.y);
  if(usedPrev<=0) return base;
  const quotaPrev = effectiveKuningQuota(pid, pv.y, pv.m);
  if(usedPrev>=quotaPrev && quotaPrev>0) return Math.max(KUNING_MIN_QUOTA, Math.ceil(quotaPrev*KUNING_DECAY_RATIO));
  return base;
}
function effectiveMaxQuota(pid, year, month){
  const base = personnel[pid].maxQuota;
  const pv = prevMonthYear(year, month);
  const prev = schedules[skey(pv.y, pv.m)];
  if(!prev) return base;
  const usedPrev = (prev.monthPS[pid]||0) + (prev.monthM[pid]||0);
  const quotaPrev = effectiveMaxQuota(pid, pv.y, pv.m);
  if(usedPrev>=quotaPrev && quotaPrev>0) return Math.max(MAXDAYS_MIN_QUOTA, Math.round(quotaPrev*MAXDAYS_DECAY_RATIO));
  return base;
}
function cutiBalanceForYear(pid, year){
  const p = personnel[pid];
  return (p.cutiBalances && p.cutiBalances[year]!=null) ? p.cutiBalances[year] : CUTI_DEFAULT_BALANCE;
}
function setCutiBalance(pid, year, val){
  const p = personnel[pid];
  if(!p.cutiBalances) p.cutiBalances = {};
  const balance = Math.max(0, parseInt(val)||0);
  p.cutiBalances[year] = balance;
  persistCutiBalance(pid, year, balance);
}
function cutiUsedInYear(pid, year){
  return cutiList.filter(c=>c.personnelId===pid && c.status!=='rejected' && c.year===year)
    .reduce((sum,c)=> sum + (c.end-c.start+1), 0);
}
function fmtRange(c){ return c.start===c.end ? `tgl ${c.start}` : `tgl ${c.start}–${c.end}`; }
function monthTag(month, year){ return `${monthNames[month-1].slice(0,3)} ${year}`; }
function tomorrowDateStr(y, m){
  const rt = realToday();
  if(y < rt.y || (y === rt.y && m < rt.m)) return null; // bulan lampau, seluruhnya sudah lewat
  if(y === rt.y && m === rt.m){
    const tomorrow = rt.d + 1;
    if(tomorrow > daysInMonthOf(y, m)) return null; // sudah di hari terakhir bulan
    return `${y}-${pad2(m)}-${pad2(tomorrow)}`;
  }
  // bulan masa depan, dibuka mulai tanggal 1
  return `${y}-${pad2(m)}-01`;
}

function applyDateBounds(inputEl){
  if(!inputEl) return;
  const min = tomorrowDateStr(viewY, viewM);
  const max = monthLastStr();
  if(!min || min > max){
    inputEl.disabled = true;
    inputEl.title = 'Bulan ini sudah lewat atau sudah berada di hari terakhir. Jadwal tanggal aktif dan tanggal sebelumnya sudah fix tidak boleh diubah.';
  } else {
    inputEl.disabled = false;
    inputEl.min = min;
    inputEl.max = max;
    inputEl.title = `Hanya tanggal mulai besok (${min}) hingga akhir bulan (${max}) yang dapat diajukan/diubah.`;
  }
}
function dayFromDateInput(value){
  if(!value) return null;
  const [y,m,d] = value.split('-').map(Number);
  if(y!==viewY || m!==viewM) return null;
  return d;
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(()=>t.classList.remove('show'), 2600);
}

/* =====================================================================
   ICON SET
   ===================================================================== */
const ICON = {
  users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  cuti:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>',
  kuning:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18"/></svg>',
  swap:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16H3"/><path d="m7 20-4-4 4-4"/><path d="M17 8h4"/><path d="m17 4 4 4-4 4"/><path d="M3 12h18"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  print:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>',
  edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>'
};

/* =====================================================================
   MODAL (untuk personel)
   ===================================================================== */
const PANEL_META = {
  setup:      { icon:ICON.users, title:'Urutan antrian & kuota kuning' },
  cuti:       { icon:ICON.cuti,  title:'Ajukan cuti' },
  kuning:     { icon:ICON.kuning,title:'Ajukan kuning' },
  swap:       { icon:ICON.swap,  title:'Tukar dinas' },
  lock:       { icon:ICON.lock,  title:'Lock admin' },
  edit_shift: { icon:ICON.edit,  title:'Edit Dinas Manual (Admin)' },
  user_request: { icon:ICON.cuti, title:'Pengajuan Cuti / Kuning' }
};
const backdrop = document.getElementById('modalBackdrop');
function openModal(kind){
  activePanel = kind;
  updateNavHighlight();
  renderModal();
  backdrop.classList.add('open');
  backdrop.setAttribute('aria-hidden','false');
  document.body.style.overflow = 'hidden';
  document.getElementById('modalCard').focus();
}
function closeModal(){
  activePanel = null;
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden','true');
  document.body.style.overflow = '';
  updateNavHighlight();
}
function renderModal(){
  if(!activePanel) return;
  const meta = PANEL_META[activePanel] || { icon:ICON.info, title:'Modal' };
  document.getElementById('mIcon').innerHTML = meta.icon;
  document.getElementById('mTitle').textContent = meta.title;
  document.getElementById('mSub').textContent = activePanel==='setup' ? 'Khusus admin' : `Bulan ${monthNames[viewM-1]} ${viewY}`;
  const body = document.getElementById('modalBody');
  if(activePanel==='setup') renderSetupPanel(body);
  else if(activePanel==='lock') renderLockPanel(body);
  else if(activePanel==='swap') renderSwapPanel(body);
  else if(activePanel==='edit_shift') renderManualEditPanel(body);
  else if(activePanel==='user_request') renderUserRequestPanel(body);
  else renderRequestPanel(body, activePanel, 'personel');
}
document.querySelectorAll('.navbtn[data-panel]').forEach(btn=> btn.addEventListener('click', ()=> openModal(btn.dataset.panel)));
document.getElementById('mClose').addEventListener('click', closeModal);
backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeModal(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && activePanel) closeModal(); });
function accessDenied(area, icon, msg){ area.innerHTML = `<div class="access-denied"><span class="big">${icon}</span>${msg}</div>`; }

/* =====================================================================
   PANEL SETUP / LOCK (dipakai modal admin saja)
   ===================================================================== */
function renderSetupPanel(area){
  if(!isAdmin()){ accessDenied(area, '🔐', `Menu ini <b>khusus admin</b>.<br>Silakan masuk sebagai Admin di kanan atas.`); return; }
  area.innerHTML = `<div class="card">
    <div class="tablewrap"><table class="setup" id="tblPersonel"></table></div>
    <div class="note">Kapasitas per hari: 2 orang PS + 2 orang M. Semua personel menjalani pola sama: PS → M → Libur-1 → Libur-2 → kembali ke ujung antrian.</div>
  </div>`;
  const tbl = document.getElementById('tblPersonel');
  tbl.innerHTML = `<tr><th>Nama</th><th>Urutan antrian</th><th>Kuota kuning<br>(basis/bulan)</th><th>Maks hari<br>dinas/bulan</th><th>Sisa cuti ${viewY}</th></tr>` +
    personnel.map(p=>`<tr>
      <td>${p.name}</td>
      <td><input type="number" min="1" max="${personnel.length}" value="${p.rank}" onchange="personnel[${p.id}].rank=parseInt(this.value)||${p.rank}; persistPersonnelField(${p.id},'rank',personnel[${p.id}].rank);"></td>
      <td><input type="number" min="0" max="31" value="${p.kuningQuota}" onchange="personnel[${p.id}].kuningQuota=parseInt(this.value)||0; persistPersonnelField(${p.id},'kuningQuota',personnel[${p.id}].kuningQuota);"></td>
      <td><input type="number" min="1" max="31" value="${p.maxQuota}" onchange="personnel[${p.id}].maxQuota=parseInt(this.value)||14; persistPersonnelField(${p.id},'maxQuota',personnel[${p.id}].maxQuota);"></td>
      <td><input type="number" min="0" max="60" value="${Math.max(cutiBalanceForYear(p.id, viewY) - cutiUsedInYear(p.id, viewY), 0)}" title="Jatah ${cutiBalanceForYear(p.id, viewY)} hari − terpakai/menunggu ${cutiUsedInYear(p.id, viewY)} hari" onchange="setCutiBalance(${p.id}, ${viewY}, (parseInt(this.value)||0) + cutiUsedInYear(${p.id}, ${viewY})); refreshAdminOrModal();"></td>
    </tr>`).join('');
}
function renderKuningWindowCard(area){
  if(!area) return;
  if(document.getElementById('kuningWindowCard')) document.getElementById('kuningWindowCard').remove();
  const card = document.createElement('div');
  card.id = 'kuningWindowCard';
  card.className = 'card';
  card.style.marginTop = '14px';
  card.innerHTML = `<div class="sect" style="margin-top:0">Jadwal proses pengajuan kuning</div>
    <div class="formrow"><label>Pengajuan dibuka tanggal</label><input type="number" min="1" max="31" value="${kuningWindow.start}" onchange="kuningWindow.start=parseInt(this.value)||1; refreshKuningLockUI(); persistSettings();"></div>
    <div class="formrow"><label>Pengajuan ditutup tanggal</label><input type="number" min="1" max="31" value="${kuningWindow.end}" onchange="kuningWindow.end=parseInt(this.value)||1; refreshKuningLockUI(); persistSettings();"></div>
    <div class="formrow"><label>Draft dicetak ke atasan tgl</label><input type="number" min="1" max="31" value="${kuningWindow.draftDay}" onchange="kuningWindow.draftDay=parseInt(this.value)||1; persistSettings();"></div>
    <div class="formrow"><label>Jadwal diedarkan tgl</label><input type="number" min="1" max="31" value="${kuningWindow.distributeDay}" onchange="kuningWindow.distributeDay=parseInt(this.value)||1; persistSettings();"></div>
    <div class="note">Saat ini pengajuan kuning: <b>${isKuningWindowOpen() ? 'sedang dibuka' : 'sedang ditutup'}</b>.</div>`;
  area.appendChild(card);
}
function refreshKuningLockUI(){ updateNavBadges(); refreshAdminOrModal(); }
function refreshAdminOrModal(){
  if(document.getElementById('adminPage').style.display==='block'){
    renderAdminPanel();
    return;
  }
  if(activePanel) renderModal();
}
function renderLockPanel(area){
  if(!isAdmin()){ accessDenied(area, '🔐', `Menu ini <b>khusus admin</b>.<br>Silakan masuk sebagai Admin di kanan atas.`); return; }
  area.innerHTML = `<div class="card">
    <div class="formrow"><label>Personel</label><select id="lockPersonel">${personnelOptions()}</select></div>
    <div class="formrow"><label>Tanggal</label><input type="date" id="lockDate"></div>
    <div class="formrow"><label>Slot</label><select id="lockSlot"><option value="PS">PS (Pagi Siang)</option><option value="M">M (Malam)</option></select></div>
    <div class="formrow"><label>Alasan</label><input type="text" id="lockReason" placeholder="mis. diminta Kabag"></div>
    <div id="lockWarn" class="warn"></div>
    <button class="submit" id="btnAddLock">Kunci jadwal</button>
    <div class="note">Maksimal 2 lock per slot per tanggal. Tanggal mengikuti bulan yang sedang dibuka.</div>
  </div>
  <div class="sect">Daftar lock</div>
  <div class="reqlist" id="listLock"></div>`;
  applyDateBounds(document.getElementById('lockDate'));
  renderLockList();
  document.getElementById('btnAddLock').addEventListener('click', addLock);
}
function renderLockList(){
  const box = document.getElementById('listLock');
  if(!box) return;
  const rt = realToday();
  box.innerHTML = lockedList.map(l=>{
    const p = getPerson(l.personnelId);
    const isPastOrActive = (l.year < rt.y) || (l.year === rt.y && l.month < rt.m) || (l.year === rt.y && l.month === rt.m && l.date <= rt.d);
    const actionHtml = isPastOrActive
      ? `<span class="badge" style="background:#5A6B7E;color:#fff;">Fix (Aktif/Lewat)</span>`
      : `<button class="x" onclick="removeLock(${l.id})" aria-label="Hapus lock">×</button>`;
    return `<div class="reqrow approved"><span>${esc(p.name)} · tgl ${l.date} (${monthTag(l.month,l.year)}) · ${l.slot}${l.reason?' ('+esc(l.reason)+')':''}</span>${actionHtml}</div>`;
  }).join('') || `<div class="note">Belum ada lock admin.</div>`;
}
function addLock(){
  const personnelId = parseInt(document.getElementById('lockPersonel').value);
  const dateVal = document.getElementById('lockDate').value;
  const slot = document.getElementById('lockSlot').value;
  const reason = document.getElementById('lockReason').value.trim();
  const warnBox = document.getElementById('lockWarn');
  warnBox.classList.remove('show'); warnBox.innerHTML='';
  const date = dayFromDateInput(dateVal);
  const month = viewM, year = viewY;
  if(!date){ warnBox.innerHTML='Pilih tanggal yang valid di dalam bulan yang sedang dibuka.'; warnBox.classList.add('show'); return; }

  const rt = realToday();
  if(year < rt.y || (year===rt.y && month < rt.m)){
    warnBox.innerHTML='⚠ Bulan ini sudah lewat, jadwal tidak dapat diubah.';
    warnBox.classList.add('show'); return;
  }
  if(year === rt.y && month === rt.m && date <= rt.d){
    warnBox.innerHTML=`⚠ Jadwal tanggal aktif (tgl ${rt.d}) dan tanggal sebelumnya sudah fix tidak boleh diubah. Penguncian hanya boleh untuk tanggal mulai besok (tgl ${rt.d + 1} s/d ${daysInMonth()}).`;
    warnBox.classList.add('show'); return;
  }

  const existing = lockedList.filter(l=>l.date===date && l.slot===slot && l.month===month && l.year===year);
  if(existing.length>=CAP){ warnBox.innerHTML=`⚠ Slot ${slot} tanggal ${date} sudah penuh (${existing.map(e=>personnel[e.personnelId].name).join(', ')}).`; warnBox.classList.add('show'); return; }
  if(existing.some(l=>l.personnelId===personnelId)){ warnBox.innerHTML=`⚠ ${personnel[personnelId].name} sudah dikunci di slot ${slot} tanggal ini.`; warnBox.classList.add('show'); return; }
  const p = personnel[personnelId];
  const onCuti = cutiList.some(c=>c.status==='approved' && c.personnelId===personnelId && c.month===month && c.year===year && date>=c.start && date<=c.end);
  const onKuning = kuningList.some(k=>k.status==='approved' && k.personnelId===personnelId && k.month===month && k.year===year && date>=k.start && date<=k.end);
  const doAdd = ()=>{
    const row = {id: nextId++, personnelId, date, slot, reason, month, year};
    lockedList.push(row);
    dbInsert('locked_slots', {id:row.id, personnel_id:personnelId, date, slot, reason, month, year});
    refreshAdminOrModal();
    maybeRegenerate(month, year, `Lock ${slot} ${p.name} ditambahkan — jadwal ${monthNames[month-1]} ${year} otomatis disesuaikan`, date);
  };
  if(onCuti){ warnBox.innerHTML=`⚠ ${p.name} sedang cuti tanggal ${date}. Batalkan cuti dulu kalau memang harus masuk.`; warnBox.classList.add('show'); return; }
  if(onKuning){
    warnBox.innerHTML = `⚠ ${p.name} sudah kuning disetujui yang mencakup tanggal ${date}. Mengunci akan membatalkan seluruh rentang kuning tersebut.
      <label><input type="checkbox" id="lockForce"> Tetap kunci, batalkan kuning</label>`;
    warnBox.classList.add('show');
    document.getElementById('lockForce').addEventListener('change', function(){
      if(this.checked){
        const canceled = kuningList.filter(k=>k.personnelId===personnelId && k.month===month && k.year===year && date>=k.start && date<=k.end);
        canceled.forEach(k=> dbDelete('kuning_requests', k.id));
        kuningList = kuningList.filter(k=>!canceled.includes(k));
        doAdd();
      }
    });
    return;
  }
  doAdd();
}
function removeLock(id){
  const item = lockedList.find(l=>l.id===id);
  if(!item) return;
  const rt = realToday();
  const isPastOrActive = (item.year < rt.y) || (item.year === rt.y && item.month < rt.m) || (item.year === rt.y && item.month === rt.m && item.date <= rt.d);
  if(isPastOrActive){
    toast(`Lock tgl ${item.date} tidak dapat dihapus karena tanggal tersebut sudah fix (aktif/sudah lewat).`);
    return;
  }
  lockedList = lockedList.filter(l=>l.id!==id);
  dbDelete('locked_slots', id);
  refreshAdminOrModal();
  maybeRegenerate(item.month, item.year, `Lock ${item.slot} dihapus — jadwal ${monthNames[item.month-1]} ${item.year} otomatis disesuaikan`, item.date);
}

/* =====================================================================
   TUKAR DINAS
   ===================================================================== */
function myShiftDaysInWindow(pid, sched, from, to){
  const out = [];
  for(let d=from; d<=to; d++){
    const day = sched.calendar[d-1];
    if(day.PS.includes(pid)) out.push({d, slot:'PS'});
    else if(day.M.includes(pid)) out.push({d, slot:'M'});
  }
  return out;
}
function availablePartnersForDay(sched, day, excludeId){
  return sched.calendar[day-1].L2.filter(id=>id!==excludeId);
}
function buildSwapFormHtml(){
  const adminMode = isAdmin();
  const who = adminMode
    ? `<div class="formrow"><label>Personel</label><select id="swapPersonel">${personnelOptions()}</select></div>`
    : `<div class="formrow"><label>Personel</label><div class="me"><b>${personnel[currentPersonnelId()].name}</b> (Anda)</div></div>`;
  const adminNote = adminMode
    ? `<div class="note" style="margin-bottom:10px">Sebagai admin, Anda bisa memilih pengganti <b>siapa saja</b> — tidak harus yang direkomendasikan sistem (Libur-2). Kalau pilih yang di luar rekomendasi, akan diminta konfirmasi dulu. Rotasi bulan ini otomatis menyesuaikan setelah disimpan.</div>`
    : '';
  return `${adminNote}${who}
    <div class="formrow"><label>Tanggal dinas yang ditukar</label><select id="swapDate"></select></div>
    <div class="formrow"><label>Pengganti${adminMode?'':' (rekomendasi sistem)'}</label><select id="swapPartner"></select></div>
    <div class="formrow"><label>Alasan</label><input type="text" id="swapReason" placeholder="opsional"></div>
    <div id="swapWarn" class="warn"></div>
    <button class="submit" id="btnAddSwap">${adminMode?'Tambahkan (langsung disetujui)':'Kirim pengajuan tukar dinas'}</button>`;
}
function currentSwapPersonnelId(){
  const el = document.getElementById('swapPersonel');
  return el ? parseInt(el.value) : currentPersonnelId();
}
function partnerStatusForDay(sched, day, pid){
  const d = sched.calendar[day-1];
  if(d.L2.includes(pid)) return {avail:true, label:'Libur-2 · tersedia'};
  if(d.L1.includes(pid)) return {avail:false, label:'Libur-1 · baru pulang malam'};
  if(d.PS.includes(pid)) return {avail:false, label:'sedang dinas PS'};
  if(d.M.includes(pid)) return {avail:false, label:'sedang dinas M'};
  const info = cellInfo(day, pid, sched, viewM, viewY);
  if(info.cls==='slot-cuti') return {avail:false, label:'cuti'};
  if(info.cls==='slot-kuning') return {avail:false, label:'kuning'};
  return {avail:false, label:'menunggu antrian'};
}
function refreshSwapDateOptions(sched, from, to){
  const dateEl = document.getElementById('swapDate');
  if(!dateEl) return;
  const pid = currentSwapPersonnelId();
  const days = myShiftDaysInWindow(pid, sched, from, to);
  dateEl.innerHTML = days.length
    ? days.map(x=>`<option value="${x.d}|${x.slot}">Tgl ${x.d} · ${x.slot}</option>`).join('')
    : `<option value="">(tidak ada jadwal dinas tersisa bulan ini)</option>`;
  refreshSwapPartnerOptions(sched);
}
function refreshSwapPartnerOptions(sched){
  const dateEl = document.getElementById('swapDate');
  const partnerEl = document.getElementById('swapPartner');
  if(!dateEl || !partnerEl) return;
  if(!dateEl.value){ partnerEl.innerHTML = `<option value="">-</option>`; return; }
  const d = parseInt(dateEl.value.split('|')[0]);
  const pid = currentSwapPersonnelId();
  if(isAdmin()){
    const opts = personnel.filter(p=>p.id!==pid).map(p=>{
      const st = partnerStatusForDay(sched, d, p.id);
      return `<option value="${p.id}">${p.name} — ${st.avail?'✓ ':'⚠ '}${st.label}</option>`;
    });
    partnerEl.innerHTML = opts.length ? opts.join('') : `<option value="">-</option>`;
  } else {
    const candidates = availablePartnersForDay(sched, d, pid);
    partnerEl.innerHTML = candidates.length
      ? candidates.map(id=>`<option value="${id}">${personnel[id].name}</option>`).join('')
      : `<option value="">(tidak ada yang libur penuh tanggal ini)</option>`;
  }
}
function wireSwapForm(sched, from, to){
  const pEl = document.getElementById('swapPersonel');
  if(pEl) pEl.addEventListener('change', ()=> refreshSwapDateOptions(sched, from, to));
  const dEl = document.getElementById('swapDate');
  if(dEl) dEl.addEventListener('change', ()=> refreshSwapPartnerOptions(sched));
  refreshSwapDateOptions(sched, from, to);
  const btn = document.getElementById('btnAddSwap');
  if(btn) btn.addEventListener('click', ()=> addSwap(sched));
}
function addSwap(sched){
  const warnBox = document.getElementById('swapWarn');
  const requesterId = currentSwapPersonnelId();
  const dateEl = document.getElementById('swapDate');
  const partnerEl = document.getElementById('swapPartner');
  const reason = document.getElementById('swapReason').value.trim();
  if(!dateEl.value){ warnBox.innerHTML='Tidak ada jadwal dinas yang bisa ditukar.'; warnBox.classList.add('show'); return; }
  if(!partnerEl.value){ warnBox.innerHTML='Belum ada pengganti yang dipilih.'; warnBox.classList.add('show'); return; }
  const [dStr, slot] = dateEl.value.split('|');
  const date = parseInt(dStr);
  const partnerId = parseInt(partnerEl.value);

  const rt = realToday();
  if(viewY === rt.y && viewM === rt.m && date <= rt.d){
    warnBox.innerHTML = `⚠ Jadwal tanggal aktif (tgl ${rt.d}) dan tanggal sebelumnya sudah fix tidak boleh diubah. Tukar dinas hanya boleh mulai besok (tgl ${rt.d + 1}).`;
    warnBox.classList.add('show'); return;
  }

  const isAvail = sched.calendar[date-1].L2.includes(partnerId);

  if(!isAdmin() && !isAvail){
    warnBox.innerHTML = `⚠ ${personnel[partnerId].name} ternyata sudah tidak libur penuh di tanggal ini. Pilih ulang penggantinya.`;
    warnBox.classList.add('show'); return;
  }
  if(isAdmin() && !isAvail && warnBox.dataset.confirmed!=='1'){
    const st = partnerStatusForDay(sched, date, partnerId);
    warnBox.innerHTML = `⚠ ${personnel[partnerId].name} sedang <b>${st.label}</b> di tanggal ${date} — di luar rekomendasi sistem.
      <label><input type="checkbox" id="swapForceOk"> Tetap paksa, saya (admin) yang atur manual</label>`;
    warnBox.classList.add('show');
    document.getElementById('swapForceOk').addEventListener('change', function(){
      if(this.checked){ warnBox.dataset.confirmed='1'; addSwap(sched); }
    });
    return;
  }
  warnBox.classList.remove('show'); warnBox.innerHTML=''; warnBox.dataset.confirmed='';

  const status = isAdmin() ? 'approved' : 'pending';
  const row = {id: nextId++, requesterId, date, slot, partnerId, reason, status, month: viewM, year: viewY};
  swapList.push(row);
  dbInsert('swap_requests', {id:row.id, requester_id:requesterId, date, slot, partner_id:partnerId, reason, status, month: viewM, year: viewY});
  refreshAdminOrModal();
  updateNavBadges();
  if(status==='approved') maybeRegenerate(viewM, viewY, `Tukar dinas ${personnel[requesterId].name} ↔ ${personnel[partnerId].name} tgl ${date} ditambahkan — jadwal otomatis disesuaikan`, date);
  else toast('Pengajuan tukar dinas terkirim, menunggu persetujuan admin');
}
function buildSwapRecommendationHtml(sched, from, to){
  const dayNamesShort = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  let head = `<tr><th></th><th>Nama</th>`;
  for(let d=from; d<=to; d++){
    const dow = new Date(viewY, viewM - 1, d).getDay();
    const isWknd = (dow === 0 || dow === 6);
    head += `<th class="${isWknd?'weekend':''}"><div>${d}</div><div style="font-size:9px;font-weight:500;opacity:.85;letter-spacing:0;margin-top:2px;">${dayNamesShort[dow]}</div></th>`;
  }
  head += `</tr>`;
  let body = personnel.map((p,idx)=>{
    let cells='';
    for(let d=from; d<=to; d++){
      const info = cellInfo(d, idx, sched, viewM, viewY);
      const dow = new Date(viewY, viewM - 1, d).getDay();
      const isWknd = (dow === 0 || dow === 6);
      const avail = sched.calendar[d-1].L2.includes(idx);
      cells += `<td class="${info.cls}${avail?' avail':''}${isWknd?' weekend':''}" title="${info.title}${avail?' · Tersedia untuk tukar dinas':''}">${info.label}</td>`;
    }
    return `<tr><th class="no">${idx+1}</th><th class="nama">${p.name}</th>${cells}</tr>`;
  }).join('');
  return `<div class="sect">Rekomendasi ketersediaan (tgl ${from}–${to})</div>
    <div class="calwrap"><table class="cal"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <div class="legend" style="margin-top:8px">
      <span><i style="background:rgba(46,125,79,.3);border:2px solid var(--green)"></i> Libur-2 — tersedia, boleh direkomendasikan</span>
      <span><i style="background:#fff;border:1px solid var(--line)"></i> Libur-1 / sedang bertugas — tidak boleh diganggu</span>
      <span><i style="background:#AAB8C6;border:1px solid #475569"></i> Sabtu / Minggu</span>
    </div>`;
}
function renderSwapPanel(area){
  if(!isAdmin() && !isUserRole()){
    accessDenied(area, '🔄', `Untuk mengajukan tukar dinas, silakan <b>masuk sebagai personel</b> dulu.<br>Pilih nama Anda di kanan atas.`);
    return;
  }
  const rt = realToday();
  const isRealCurrentMonth = (viewY===rt.y && viewM===rt.m);
  const sched = isRealCurrentMonth ? schedules[skey(rt.y, rt.m)] : null;
  const from = rt.d+1, to = sched ? sched.days : 0;
  const canForm = isRealCurrentMonth && sched && from<=to;

  let topHtml;
  if(!isRealCurrentMonth){
    topHtml = `<div class="warn show">🗓️ Tukar dinas hanya berlaku untuk sisa bulan berjalan (<b>${monthNames[rt.m-1]} ${rt.y}</b>). Buka tab bulan itu untuk mengajukan.</div>`;
  } else if(!sched){
    topHtml = `<div class="warn show">Jadwal ${monthNames[rt.m-1]} ${rt.y} belum dibuat admin, belum ada yang bisa ditukar.</div>`;
  } else if(from>to){
    topHtml = `<div class="warn show">Sudah di penghujung bulan, tidak ada sisa hari untuk ditukar.</div>`;
  } else {
    topHtml = `<div class="card">${buildSwapFormHtml()}</div>`;
  }

  area.innerHTML = `${topHtml}
    ${canForm ? buildSwapRecommendationHtml(sched, from, to) : ''}
    <div class="sect">${isAdmin() ? 'Semua pengajuan tukar dinas' : 'Pengajuan tukar dinas Anda'}</div>
    <div class="reqlist" id="swapReqList"></div>`;

  if(canForm) wireSwapForm(sched, from, to);
  renderSwapReqList();
}
function renderSwapReqList(){
  const box = document.getElementById('swapReqList');
  if(!box) return;
  const rt = realToday();
  const visible = isAdmin() ? swapList : swapList.filter(x=>x.requesterId===currentPersonnelId());
  box.innerHTML = visible.map(item=>{
    const req = getPerson(item.requesterId), partner = getPerson(item.partnerId);
    const label = `${esc(req.name)} → ${esc(partner.name)}: tgl ${item.date} · ${item.slot} (${monthTag(item.month,item.year)})${item.reason?' ('+esc(item.reason)+')':''}`;
    let actions = '';
    const isPastOrActive = (item.year < rt.y) || (item.year === rt.y && item.month < rt.m) || (item.year === rt.y && item.month === rt.m && item.date <= rt.d);
    if(isAdmin() && item.status==='pending'){
      actions = `<div class="actions">
        <button class="small ok-btn" onclick="setStatus('swap',${item.id},'approved')">Setuju</button>
        <button class="small reject-btn" onclick="setStatus('swap',${item.id},'rejected')">Tolak</button>
      </div>`;
    } else if(isAdmin()){
      actions = (item.status==='approved' && isPastOrActive)
        ? `<span class="badge" style="background:#5A6B7E;color:#fff;">Fix (Aktif/Lewat)</span>`
        : `<button class="x" onclick="removeReq('swap',${item.id})" aria-label="Hapus">×</button>`;
    } else if(item.requesterId===currentPersonnelId()){
      actions = `<span class="badge ${item.status}">${item.status==='pending'?'Menunggu':item.status==='approved'?'Disetujui':'Ditolak'}</span>`;
    }
    return `<div class="reqrow ${item.status}"><span>${label}</span>${actions}</div>`;
  }).join('') || `<div class="note">Belum ada pengajuan tukar dinas.</div>`;
}

/* =====================================================================
   FORM CUTI / KUNING — dengan UID unik supaya tidak bentrok antar konteks
   ===================================================================== */
function renderRequestPanel(area, kind, ctx){
  const isCuti = kind==='cuti';
  ctx = ctx || 'personel';
  const uid = ctx + '_' + kind;

  if(!isAdmin() && !isUserRole()){
    accessDenied(area, '👤', `Untuk mengajukan ${isCuti?'cuti':'kuning'}, silakan <b>masuk sebagai personel</b> dulu.<br>Pilih nama Anda di kanan atas.`);
    return;
  }
  if(!isCuti && !isAdmin() && !isKuningWindowOpen()){
    accessDenied(area, '⏳', `Pengajuan kuning sedang <b>ditutup</b>.<br>Dibuka lagi mulai ${nextKuningOpenLabel()} (rentang tanggal ${kuningWindow.start}–${kuningWindow.end} tiap bulan).`);
    return;
  }

  const windowBanner = (!isCuti && isAdmin() && !isKuningWindowOpen())
    ? `<div class="warn show">⏳ Di luar jadwal pengajuan kuning (tgl ${kuningWindow.start}–${kuningWindow.end}), dibuka lagi ${nextKuningOpenLabel()}. Personel tidak bisa mengajukan sekarang, tapi Anda sebagai admin tetap bisa menambahkan.</div>`
    : '';

  const dateFields = `
    <div class="formrow"><label>Tanggal mulai</label><input type="date" id="reqStart_${uid}"></div>
    <div class="formrow"><label>Tanggal selesai</label><input type="date" id="reqEnd_${uid}"></div>
    ${isCuti ? `<div class="formrow"><label>Alasan</label><input type="text" id="reqReason_${uid}" placeholder="opsional, mis. kedukaan"></div>` : ''}`;

  let who, btnText;
  const personelSelectId = 'reqPersonel_' + uid;
  if(isAdmin()){
    who = `<div class="formrow"><label>Personel</label><select id="${personelSelectId}">${personnelOptions()}</select></div>`;
    btnText = 'Tambahkan (langsung disetujui)';
  } else {
    const me = personnel[currentPersonnelId()];
    who = `<div class="formrow"><label>Personel</label><div class="me"><b>${me.name}</b> (Anda)</div></div>`;
    btnText = 'Kirim pengajuan';
  }

  area.innerHTML = `${windowBanner}
    <div class="card">${who}
      <div class="quotainfo" id="quotaInfo_${uid}"></div>
      ${dateFields}
      <div id="reqWarn_${uid}" class="warn"></div>
      <button class="submit" id="btnAddReq_${uid}" type="button">${btnText}</button>
    </div>
    <div class="sect">${isAdmin() ? 'Semua pengajuan' : 'Pengajuan Anda'}</div>
    <div class="reqlist" id="reqList_${uid}"></div>`;

  ['reqStart_'+uid, 'reqEnd_'+uid].forEach(id=>{
    const el = document.getElementById(id);
    if(el) applyDateBounds(el);
  });

  renderReqListById('reqList_'+uid, kind);
  updateQuotaInfoById('quotaInfo_'+uid, kind, personelSelectId);

  if(isAdmin()){
    const sel = document.getElementById(personelSelectId);
    if(sel) sel.addEventListener('change', ()=> updateQuotaInfoById('quotaInfo_'+uid, kind, personelSelectId));
  }

  const btn = document.getElementById('btnAddReq_'+uid);
  if(btn){
    btn.addEventListener('click', ()=>{
      if(isCuti) addCutiByCtx(uid, ctx);
      else addKuningByCtx(uid, ctx);
    });
  }
}

function renderReqListById(boxId, kind){
  const box = document.getElementById(boxId);
  if(!box) return;
  const rt = realToday();
  const list = kind==='cuti' ? cutiList : kuningList;
  const visible = isAdmin() ? list : list.filter(x=>x.personnelId===currentPersonnelId());
  const sorted = visible.slice().sort((a,b)=> b.id - a.id);
  box.innerHTML = sorted.length ? sorted.map(item=>{
    const p = getPerson(item.personnelId);
    const label = kind==='cuti'
      ? `<span class="who">${esc(p.name)}</span><span class="meta">${fmtRange(item)} · ${monthTag(item.month,item.year)}${item.reason?' · '+esc(item.reason):''}</span>`
      : `<span class="who">${esc(p.name)}</span><span class="meta">${fmtRange(item)} · ${monthTag(item.month,item.year)}</span>`;
    let actions = '';
    const isPastOrActive = (item.year < rt.y) || (item.year === rt.y && item.month < rt.m) || (item.year === rt.y && item.month === rt.m && (item.end || item.start) <= rt.d);
    if(isAdmin() && item.status==='pending'){
      actions = `<div class="actions">
        <button class="small ok-btn" onclick="setStatus('${kind}',${item.id},'approved')">Setuju</button>
        <button class="small reject-btn" onclick="setStatus('${kind}',${item.id},'rejected')">Tolak</button>
      </div>`;
    } else if(isAdmin()){
      actions = (item.status==='approved' && isPastOrActive)
        ? `<span class="badge" style="background:#5A6B7E;color:#fff;">Fix (Aktif/Lewat)</span>`
        : `<button class="x" onclick="removeReq('${kind}',${item.id})" aria-label="Hapus">×</button>`;
    } else if(item.personnelId===currentPersonnelId()){
      actions = `<span class="badge ${item.status}">${item.status==='pending'?'Menunggu':item.status==='approved'?'Disetujui':'Ditolak'}</span>`;
    }
    return `<div class="reqrow ${item.status}"><span>${label}</span>${actions}</div>`;
  }).join('') : `<div class="note">Belum ada pengajuan.</div>`;
}

function updateQuotaInfoById(boxId, kind, selectId){
  const box = document.getElementById(boxId);
  if(!box) return;
  let pid;
  if(isAdmin()){
    const sel = document.getElementById(selectId);
    pid = sel ? parseInt(sel.value) : 0;
  } else {
    pid = currentPersonnelId();
  }
  if(pid==null || isNaN(pid)){ box.innerHTML=''; return; }
  const p = personnel[pid];
  if(kind==='kuning'){
    const quota = effectiveKuningQuota(pid, viewY, viewM);
    const used = kuningUsedInMonth(pid, viewM, viewY);
    const sisa = Math.max(quota-used, 0);
    box.innerHTML = `Kuota kuning <b>${p.name}</b> bulan ${monthTag(viewM,viewY)}: sisa <b>${sisa}</b> dari ${quota} hari${used>0?` (${used} hari sudah terpakai/menunggu)`:''}.`;
  } else {
    const balance = cutiBalanceForYear(pid, viewY);
    const used = cutiUsedInYear(pid, viewY);
    const sisa = Math.max(balance-used, 0);
    box.innerHTML = `Sisa cuti <b>${p.name}</b> tahun ${viewY}: <b>${sisa}</b> dari ${balance} hari${used>0?` (${used} hari sudah terpakai/menunggu)`:''}.`;
  }
}

function addCutiByCtx(uid, ctx){
  const warnBox = document.getElementById('reqWarn_'+uid);
  if(!warnBox) return;
  warnBox.classList.remove('show'); warnBox.innerHTML='';

  let personnelId;
  if(isAdmin()){
    const sel = document.getElementById('reqPersonel_'+uid);
    personnelId = sel ? parseInt(sel.value) : 0;
  } else {
    personnelId = currentPersonnelId();
  }
  const month = viewM, year = viewY;
  const startEl = document.getElementById('reqStart_'+uid);
  const endEl   = document.getElementById('reqEnd_'+uid);
  const reasonEl= document.getElementById('reqReason_'+uid);

  if(startEl && startEl.value && endEl && endEl.value){
    const [sy, sm] = startEl.value.split('-').map(Number);
    const [ey, em] = endEl.value.split('-').map(Number);
    if(sy !== ey || sm !== em){
      warnBox.innerHTML = '⚠ Pengajuan cuti harus dalam bulan yang sama. Untuk cuti lintas bulan, silakan ajukan terpisah untuk masing-masing bulan.';
      warnBox.classList.add('show'); return;
    }
  }

  const start = dayFromDateInput(startEl ? startEl.value : '');
  const end   = dayFromDateInput(endEl ? endEl.value : '') || start;
  const reason= reasonEl ? reasonEl.value.trim() : '';

  if(!start){ warnBox.innerHTML='Pilih tanggal mulai yang valid.'; warnBox.classList.add('show'); return; }
  if(end<start){ warnBox.innerHTML='Tanggal selesai tidak boleh sebelum tanggal mulai.'; warnBox.classList.add('show'); return; }

  const rt = realToday();
  if(year < rt.y || (year===rt.y && month < rt.m)){
    warnBox.innerHTML='⚠ Bulan ini sudah lewat, pengajuan cuti tidak dapat dilakukan.';
    warnBox.classList.add('show'); return;
  }
  if(year === rt.y && month === rt.m && start <= rt.d){
    warnBox.innerHTML=`⚠ Jadwal tanggal aktif (tgl ${rt.d}) dan tanggal sebelumnya sudah fix tidak boleh diubah. Cuti hanya boleh diajukan mulai besok (tgl ${rt.d + 1} s/d ${daysInMonth()}).`;
    warnBox.classList.add('show'); return;
  }

  const conflict = lockedList.filter(l=>l.personnelId===personnelId && l.month===month && l.year===year && l.date>=start && l.date<=end);
  if(conflict.length){
    warnBox.innerHTML = `⚠ Tanggal ini sudah dikunci admin (${conflict.map(c=>'tgl '+c.date+' '+c.slot).join(', ')}). Cuti di tanggal terkunci harus lewat admin langsung.`;
    warnBox.classList.add('show'); return;
  }

  const p = getPerson(personnelId);
  const balance = cutiBalanceForYear(personnelId, year);
  const used = cutiUsedInYear(personnelId, year);
  const requested = end-start+1;
  const remaining = balance - used;

  const doAdd = ()=>{
    if(isAdmin() && schedules[skey(year, month)]){
      const pv = previewLeaves(year, month, [{ personnelId, start, end }]);
      const confirmMsg = `Penambahan Cuti ${p.name}:\n\n${pv.text}\n\nLanjutkan simpan dan sesuaikan jadwal?`;
      if(!confirm(confirmMsg)) return;
    }

    const status = isAdmin() ? 'approved' : 'pending';
    const row = {id: nextId++, personnelId, start, end, reason, status, month, year};
    cutiList.push(row);
    dbInsert('cuti_requests', {id:row.id, personnel_id:personnelId, start_day:start, end_day:end, reason, status, month, year});
    refreshAdminOrModal();
    updateNavBadges();
    if(status==='approved') maybeRegenerate(month, year, `Cuti ${p.name} ditambahkan — jadwal ${monthNames[month-1]} ${year} otomatis disesuaikan`, start, true, [{ personnelId, start, end }]);
    else toast('Pengajuan cuti terkirim, menunggu persetujuan admin');
  };

  if(requested>remaining){
    warnBox.innerHTML = `⚠ Sisa cuti ${p.name} tahun ${year} tinggal <b>${Math.max(remaining,0)}</b> dari ${balance} hari, tapi yang diajukan ${requested} hari.
      <label><input type="checkbox" id="cutiForce_${uid}"> Tetap ajukan (melebihi sisa cuti)</label>`;
    warnBox.classList.add('show');
    const cb = document.getElementById('cutiForce_'+uid);
    if(cb) cb.addEventListener('change', function(){ if(this.checked) doAdd(); });
    return;
  }
  doAdd();
}

function addKuningByCtx(uid, ctx){
  const warnBox = document.getElementById('reqWarn_'+uid);
  if(!warnBox) return;
  warnBox.classList.remove('show'); warnBox.innerHTML='';

  if(!isAdmin() && !isKuningWindowOpen()){
    warnBox.innerHTML = `⏳ Pengajuan kuning sedang ditutup. Dibuka lagi mulai ${nextKuningOpenLabel()}.`;
    warnBox.classList.add('show');
    return;
  }

  let personnelId;
  if(isAdmin()){
    const sel = document.getElementById('reqPersonel_'+uid);
    personnelId = sel ? parseInt(sel.value) : 0;
  } else {
    personnelId = currentPersonnelId();
  }
  const month = viewM, year = viewY;
  const startEl = document.getElementById('reqStart_'+uid);
  const endEl   = document.getElementById('reqEnd_'+uid);

  if(startEl && startEl.value && endEl && endEl.value){
    const [sy, sm] = startEl.value.split('-').map(Number);
    const [ey, em] = endEl.value.split('-').map(Number);
    if(sy !== ey || sm !== em){
      warnBox.innerHTML = '⚠ Pengajuan kuning harus dalam bulan yang sama. Untuk izin lintas bulan, silakan ajukan terpisah untuk masing-masing bulan.';
      warnBox.classList.add('show'); return;
    }
  }

  const start = dayFromDateInput(startEl ? startEl.value : '');
  const end   = dayFromDateInput(endEl ? endEl.value : '') || start;

  if(!start){ warnBox.innerHTML='Pilih tanggal mulai yang valid.'; warnBox.classList.add('show'); return; }
  if(end<start){ warnBox.innerHTML='Tanggal selesai tidak boleh sebelum tanggal mulai.'; warnBox.classList.add('show'); return; }

  const rt = realToday();
  if(year < rt.y || (year===rt.y && month < rt.m)){
    warnBox.innerHTML='⚠ Bulan ini sudah lewat, pengajuan kuning tidak dapat dilakukan.';
    warnBox.classList.add('show'); return;
  }
  if(year === rt.y && month === rt.m && start <= rt.d){
    warnBox.innerHTML=`⚠ Jadwal tanggal aktif (tgl ${rt.d}) dan tanggal sebelumnya sudah fix tidak boleh diubah. Kuning hanya boleh diajukan mulai besok (tgl ${rt.d + 1} s/d ${daysInMonth()}).`;
    warnBox.classList.add('show'); return;
  }

  const p = getPerson(personnelId);
  const quota = effectiveKuningQuota(personnelId, year, month);
  const used = kuningUsedInMonth(personnelId, month, year);
  const requested = end-start+1;
  const remaining = quota - used;

  const doAdd = ()=>{
    if(isAdmin() && schedules[skey(year, month)]){
      const pv = previewLeaves(year, month, [{ personnelId, start, end }]);
      const confirmMsg = `Penambahan Kuning ${p.name}:\n\n${pv.text}\n\nLanjutkan simpan dan sesuaikan jadwal?`;
      if(!confirm(confirmMsg)) return;
    }

    const status = isAdmin() ? 'approved' : 'pending';
    const row = {id: nextId++, personnelId, start, end, status, month, year};
    kuningList.push(row);
    dbInsert('kuning_requests', {id:row.id, personnel_id:personnelId, start_day:start, end_day:end, status, month, year});
    refreshAdminOrModal();
    updateNavBadges();
    if(status==='approved') maybeRegenerate(month, year, `Kuning ${p.name} ditambahkan — jadwal ${monthNames[month-1]} ${year} otomatis disesuaikan`, start, true, [{ personnelId, start, end }]);
    else toast('Pengajuan kuning terkirim, menunggu persetujuan admin');
  };

  if(requested>remaining){
    warnBox.innerHTML = `⚠ Kuota kuning ${p.name} bulan ${monthTag(month,year)} tersisa <b>${Math.max(remaining,0)}</b> dari ${quota} hari, tapi yang diajukan ${requested} hari.
      ${quota<p.kuningQuota?' Kuota sedang diturunkan karena bulan lalu dipakai penuh.':''}
      <label><input type="checkbox" id="kuningForce_${uid}"> Tetap ajukan (melebihi kuota)</label>`;
    warnBox.classList.add('show');
    const cb = document.getElementById('kuningForce_'+uid);
    if(cb) cb.addEventListener('change', function(){ if(this.checked) doAdd(); });
    return;
  }
  doAdd();
}

/* =====================================================================
   HELPER UMUM untuk request
   ===================================================================== */
function maybeRegenerate(month, year, message, triggerDay, repair, extraLeaves){
  if(!schedules[skey(year, month)]) return;
  let re = 0;
  if(repair){
    applyRepair(year, month, extraLeaves);
    re = 0;
  } else {
    re = generateAndStore(year, month, triggerDay);
  }
  renderMonthTabs();
  if(year===viewY && month===viewM) renderScheduleArea();
  toast(message + (re ? ` · ${re} bulan sesudahnya ikut disesuaikan` : ''));
}
function getList(kind){ return kind==='cuti' ? cutiList : kind==='kuning' ? kuningList : swapList; }
function reqLabel(kind){ return kind==='cuti' ? 'Cuti' : kind==='kuning' ? 'Kuning' : 'Tukar dinas'; }
function reqPartyName(kind, item){
  return kind==='swap' ? `${getPerson(item.requesterId).name} ↔ ${getPerson(item.partnerId).name}` : getPerson(item.personnelId).name;
}
function setStatus(kind, id, status){
  const item = getList(kind).find(x=>x.id===id);
  if(!item) return;
  const label = reqLabel(kind), pname = reqPartyName(kind, item);
  const triggerDay = item.start || item.date || 1;
  const rt = realToday();
  const hasPastOverlap = (item.year === rt.y && item.month === rt.m && (item.start || item.date) <= rt.d);
  const extraNotice = hasPastOverlap ? ' (tgl 1 s/d hari ini tetap fix tidak berubah)' : '';

  if(status === 'approved' && kind !== 'swap' && schedules[skey(item.year, item.month)]){
    const pv = previewLeaves(item.year, item.month, [{ personnelId: item.personnelId, start: item.start, end: item.end }]);
    const confirmMsg = `Persetujuan ${label} ${pname}:\n\n${pv.text}\n\nLanjutkan dan sesuaikan jadwal?`;
    if(!confirm(confirmMsg)) return;
  }

  item.status = status;
  const table = kind==='cuti' ? 'cuti_requests' : kind==='kuning' ? 'kuning_requests' : 'swap_requests';
  dbUpdate(table, id, {status});
  refreshAdminOrModal();

  const isRepair = (status === 'approved' && kind !== 'swap');
  const leavesHypo = isRepair ? [{ personnelId: item.personnelId, start: item.start, end: item.end }] : null;

  maybeRegenerate(item.month, item.year, status==='approved'
    ? `${label} ${pname} disetujui${extraNotice} — jadwal ${monthNames[item.month-1]} ${item.year} otomatis disesuaikan`
    : `${label} ${pname} ditolak${extraNotice} — jadwal ${monthNames[item.month-1]} ${item.year} otomatis disesuaikan`, triggerDay, isRepair, leavesHypo);
  updateNavBadges();
}
function removeReq(kind, id){
  const item = getList(kind).find(x=>x.id===id);
  if(!item) return;
  const rt = realToday();
  const isPastOrActive = (item.year < rt.y) || (item.year === rt.y && item.month < rt.m) || (item.year === rt.y && item.month === rt.m && (item.end || item.date || item.start) <= rt.d);
  if(item.status==='approved' && isPastOrActive){
    toast(`${reqLabel(kind)} ini tidak dapat dihapus karena tanggalnya sudah fix (aktif/sudah lewat).`);
    return;
  }
  if(kind==='cuti') cutiList = cutiList.filter(c=>c.id!==id);
  else if(kind==='kuning') kuningList = kuningList.filter(k=>k.id!==id);
  else swapList = swapList.filter(s=>s.id!==id);
  const table = kind==='cuti' ? 'cuti_requests' : kind==='kuning' ? 'kuning_requests' : 'swap_requests';
  dbDelete(table, id);
  refreshAdminOrModal();
  updateNavBadges();
  if(item.status==='approved'){
    const triggerDay = item.start || item.date || 1;
    maybeRegenerate(item.month, item.year, `${reqLabel(kind)} ${reqPartyName(kind,item)} dihapus — jadwal ${monthNames[item.month-1]} ${item.year} otomatis disesuaikan`, triggerDay);
  }
}

/* =====================================================================
   SCHEDULE ENGINE
   ===================================================================== */
function freezeBoundaryForMonth(year, month){
  // Tanggal yang sudah lewat (termasuk hari ini) tidak boleh berubah lagi,
  // walaupun ada perubahan cuti/kuning/lock/swap.
  const rt = realToday();
  if(year < rt.y || (year===rt.y && month < rt.m)) return daysInMonthOf(year, month); // bulan sudah lewat, semua dikunci
  if(year === rt.y && month === rt.m) return rt.d; // bulan berjalan: kunci s/d hari ini
  return 0; // bulan depan, belum ada yang perlu dikunci
}

function computeCell(day, pid, dayEntry, month, year){
  const onCuti = cutiList.some(c=>c.status==='approved' && c.personnelId===pid && c.month===month && c.year===year && day>=c.start && day<=c.end);
  const onKuning = kuningList.some(k=>k.status==='approved' && k.personnelId===pid && k.month===month && k.year===year && day>=k.start && day<=k.end);
  const pendingCuti = cutiList.some(c=>c.status==='pending' && c.personnelId===pid && c.month===month && c.year===year && day>=c.start && day<=c.end);
  const pendingKuning = kuningList.some(k=>k.status==='pending' && k.personnelId===pid && k.month===month && k.year===year && day>=k.start && day<=k.end);
  const swappedOut = swapList.some(s=>s.status==='approved' && s.requesterId===pid && s.month===month && s.year===year && s.date===day);
  const isPS = dayEntry && dayEntry.PS && dayEntry.PS.includes(pid);
  const isM = dayEntry && dayEntry.M && dayEntry.M.includes(pid);
  const locked = (isPS && dayEntry.lockedPS && dayEntry.lockedPS.includes(pid)) || (isM && dayEntry.lockedM && dayEntry.lockedM.includes(pid));
  const swappedIn = (isPS && dayEntry.swappedPS && dayEntry.swappedPS.includes(pid)) || (isM && dayEntry.swappedM && dayEntry.swappedM.includes(pid));

  const currentSlot = isPS ? 'PS' : (isM ? 'M' : null);
  const cutiReplItem = dayEntry && dayEntry.cutiReplacements && dayEntry.cutiReplacements.find(r => r.pid === pid && (!r.slot || r.slot === currentSlot));
  const isCutiRepl = Boolean(cutiReplItem);
  const replacedPerson = isCutiRepl && cutiReplItem.replacedId !== undefined ? getPerson(cutiReplItem.replacedId) : null;
  const replType = (cutiReplItem && cutiReplItem.type === 'kuning') ? 'kuning' : 'cuti';
  const replCls = replType === 'kuning' ? ' kuning-replacement' : ' cuti-replacement';

  if(onCuti) return {cls:'slot-cuti', label:'C', title:'Cuti (Disetujui)'};
  if(onKuning) return {cls:'slot-kuning', label:'K', title:'Kuning (Disetujui)'};
  if(pendingCuti) return {cls:'slot-cuti-pending', label:'C⏳', title:'Pengajuan Cuti (Menunggu persetujuan admin)'};
  if(pendingKuning) return {cls:'slot-kuning-pending', label:'K⏳', title:'Pengajuan Kuning (Menunggu persetujuan admin)'};
  if(swappedOut) return {cls:'slot-swap', label:'T', title:'Tukar dinas — jadwal hari ini digantikan personel lain'};
  if(isPS){
    let cls = 'slot-PS' + (locked ? ' locked' : '') + (swappedIn ? ' swapped' : '') + (isCutiRepl ? replCls : '');
    let title = 'Pagi Siang';
    if(locked) title = 'PS (terkunci admin)';
    else if(swappedIn) title = 'PS (menggantikan, tukar dinas)';
    else if(isCutiRepl) title = `PS (menggantikan ${replacedPerson ? replacedPerson.name : 'rekan'} yang ${replType})`;
    return { cls, label: 'PS', title };
  }
  if(isM){
    let cls = 'slot-M' + (locked ? ' locked' : '') + (swappedIn ? ' swapped' : '') + (isCutiRepl ? replCls : '');
    let title = 'Malam';
    if(locked) title = 'M (terkunci admin)';
    else if(swappedIn) title = 'M (menggantikan, tukar dinas)';
    else if(isCutiRepl) title = `M (menggantikan ${replacedPerson ? replacedPerson.name : 'rekan'} yang ${replType})`;
    return { cls, label: 'M', title };
  }
  if(dayEntry && dayEntry.L1 && dayEntry.L1.includes(pid)) return {cls:'slot-off', label:'–', title:'Libur-1 (baru pulang malam)'};
  if(dayEntry && dayEntry.L2 && dayEntry.L2.includes(pid)) return {cls:'slot-off', label:'–', title:'Libur-2 (libur penuh)'};
  return {cls:'slot-off', label:'–', title:'Menunggu giliran di antrian'};
}

function buildDayCellsSnapshot(day, dayEntry, month, year){
  const cells = {};
  personnel.forEach(p => {
    cells[p.id] = computeCell(day, p.id, dayEntry, month, year);
  });
  return cells;
}

function weekProfile(prevSched){
  if(!prevSched || !prevSched.calendar || !prevSched.calendar.length) return null;
  const cal = prevSched.calendar, len = cal.length;
  const prof = {};
  personnel.forEach(p=> prof[p.id] = { ps:0, m:0, total:0, since:WEEK_WINDOW+1 });
  for(let i=Math.max(0, len-WEEK_WINDOW); i<len; i++){
    const ago = len-1-i, e = cal[i];
    (e.PS||[]).forEach(id=>{ if(prof[id]){ prof[id].ps++; prof[id].total++; prof[id].since=Math.min(prof[id].since, ago); } });
    (e.M||[]).forEach(id=>{  if(prof[id]){ prof[id].m++;  prof[id].total++; prof[id].since=Math.min(prof[id].since, ago); } });
  }
  return prof;
}

function deriveInitStateFromPrev(prevSched, year, month){
  if(!prevSched || !prevSched.calendar || !prevSched.calendar.length) return null;
  const cal = prevSched.calendar;
  const len = cal.length;
  const lastDay = cal[len - 1]; // hari terakhir bulan sebelumnya
  const cur = {
    PS: (lastDay.PS || []).slice(),
    M: (lastDay.M || []).slice(),
    L1: (lastDay.L1 || []).slice(),
    L2: (lastDay.L2 || []).slice()
  };
  const inCur = new Set([...cur.PS, ...cur.M, ...cur.L1, ...cur.L2]);
  const prof = weekProfile(prevSched);
  const ideal = WEEK_WINDOW * CAP * 2 / personnel.length;
  const prevTot = id => (((prevSched.monthPS && prevSched.monthPS[id])||0) + ((prevSched.monthM && prevSched.monthM[id])||0));
  const avgPrev = personnel.reduce((s,p)=> s + prevTot(p.id), 0) / personnel.length;

  // skor kecil = beban minggu lalu ringan & sudah lama libur -> maju ke depan antrian tgl 1
  const score = id => {
    if(!prof || !prof[id]) return 0;
    return (prof[id].total - ideal) * 2
      - Math.min(prof[id].since, WEEK_WINDOW) * 0.5
      + (prevTot(id) - avgPrev) * 0.3;
  };

  const freePeople = personnel.map(p=>p.id).filter(id => !inCur.has(id))
    .sort((a,b)=> score(a) - score(b) || (getPerson(a).rank - getPerson(b).rank));

  const carry = {};
  personnel.forEach(p=> {
    carry[p.id] = (prof && prof[p.id]) ? (prof[p.id].total - ideal) : 0;
  });
  return { initCur: cur, initQueue: freePeople, carry };
}

function onLeave(pid, d, m, y, cutiSrc){
  return (cutiSrc||[]).some(c=>c.personnelId===pid && c.month===m && c.year===y && d>=c.start && d<=c.end)
    || kuningList.some(k=>k.status==='approved' && k.personnelId===pid && k.month===m && k.year===y && d>=k.start && d<=k.end)
    || swapList.some(s=>s.status==='approved' && s.requesterId===pid && s.month===m && s.year===y && s.date===d);
}

function computeMonthTargets(y, m, extraLeaves){
  const days = daysInMonthOf(y, m), n = personnel.length;
  const slots = days * CAP * 2;
  const pv = prevMonthYear(y, m), prev = schedules[skey(pv.y, pv.m)];
  const prevTot = id => prev ? (((prev.monthPS && prev.monthPS[id])||0) + ((prev.monthM && prev.monthM[id])||0)) : 0;
  const rankOf = id => (getPerson(id).rank || 99);
  const capOf = id => Math.min(HARD_MAX, getPerson(id).maxQuota || HARD_MAX);

  const leaves = cutiList.concat(kuningList).filter(x=>x.status==='approved')
    .concat((extraLeaves||[]).map(l=>({ ...l, month:m, year:y })));
  const leaveDays = {};
  personnel.forEach(p=>{
    let c = 0;
    for(let d=1; d<=days; d++){
      if(leaves.some(l=>l.personnelId===p.id && l.month===m && l.year===y && d>=l.start && d<=l.end)) c++;
    }
    leaveDays[p.id] = c;
  });

  // 1-2. Bagi rata; angka lebih tinggi untuk yang bulan lalu paling sedikit (yang cuti diurutkan terakhir)
  const base = Math.floor(slots / n), extra = slots - base * n;
  const order = personnel.map(p=>p.id).sort((a,b)=>
    ((leaveDays[a]>0) - (leaveDays[b]>0)) || (prevTot(a)-prevTot(b)) || (rankOf(a)-rankOf(b)));
  const target = {};
  order.forEach((id,i)=>{ target[id] = base + (i < extra ? 1 : 0); });

  // 3. Potong target orang yang cuti secara proporsional
  let shortfall = 0;
  personnel.forEach(p=>{
    if(!leaveDays[p.id]) return;
    const loss = Math.round(leaveDays[p.id] * target[p.id] / days);
    target[p.id] = Math.max(0, target[p.id] - loss);
    shortfall += loss;
  });

  // 4-5. Hibahkan ke yang tanpa cuti, didahulukan yang targetnya terendah, maks capOf(id) / HARD_MAX
  const receivers = order.filter(id=>!leaveDays[id]);
  while(shortfall > 0){
    const eligibleReceivers = receivers.filter(id=>target[id] < capOf(id))
      .sort((a,b)=> target[a]-target[b] || prevTot(a)-prevTot(b) || rankOf(a)-rankOf(b));
    if(!eligibleReceivers.length) break;
    const r = eligibleReceivers[0];
    target[r]++;
    shortfall--;
  }

  const cap = {};
  personnel.forEach(p=>{ cap[p.id] = Math.min(capOf(p.id), target[p.id] + 1); });
  return { target, cap, leaveDays, unassigned: shortfall, days };
}

function repairMonth(y, m, base, extraLeaves){
  if(!base || !base.calendar) return null;
  const days = base.days, freeze = freezeBoundaryForMonth(y, m);
  const extra = (extraLeaves||[]).map(l=>({ ...l, month:m, year:y }));
  const cutiSrc = cutiList.filter(c=>c.status==='approved').concat(extra);

  const cal = base.calendar.map(e=>({
    ...e,
    PS: (e.PS||[]).slice(),
    M: (e.M||[]).slice(),
    L1: (e.L1||[]).slice(),
    L2: (e.L2||[]).slice(),
    lockedPS: (e.lockedPS||[]).slice(),
    lockedM: (e.lockedM||[]).slice(),
    swappedPS: (e.swappedPS||[]).slice(),
    swappedM: (e.swappedM||[]).slice(),
    cutiReplacements: (e.cutiReplacements||[]).map(r=>({...r}))
  }));
  const logs = [], tot = {}, hard = {}, added = {};
  personnel.forEach(p=>{
    tot[p.id] = 0;
    added[p.id] = 0;
    hard[p.id] = Math.min(HARD_MAX, p.maxQuota || HARD_MAX);
  });
  cal.forEach(e=> (e.PS||[]).concat(e.M||[]).forEach(id=>{ tot[id] = (tot[id]||0)+1; }));

  const pv = prevMonthYear(y, m), nx = nextMonthYear(y, m);
  const prevS = schedules[skey(pv.y, pv.m)], nextS = schedules[skey(nx.y, nx.m)];
  const prevTot = id => prevS ? (((prevS.monthPS && prevS.monthPS[id])||0) + ((prevS.monthM && prevS.monthM[id])||0)) : 0;

  const dutyAt = (pid, d)=>{
    let e = null;
    if(d >= 1 && d <= days) e = cal[d-1];
    else if(d < 1 && prevS && prevS.calendar && prevS.calendar.length) e = prevS.calendar[prevS.calendar.length + d - 1];
    else if(d > days && nextS && nextS.calendar) e = nextS.calendar[d - days - 1];
    if(!e) return null;
    if((e.PS||[]).includes(pid)) return 'PS';
    if((e.M||[]).includes(pid)) return 'M';
    return null;
  };

  // 1. Kosongkan HANYA slot milik yang cuti/kuning/tukar
  const vacancies = [];
  for(let d = freeze + 1; d <= days; d++){
    const e = cal[d-1];
    ['M','PS'].forEach(s=>{
      const gone = (e[s]||[]).filter(id => onLeave(id, d, m, y, cutiSrc));
      gone.forEach(id=>{
        e[s] = e[s].filter(x=>x!==id);
        tot[id] = Math.max(0, (tot[id]||0) - 1);
        const isCuti = (cutiSrc||[]).some(c=>c.personnelId===id && c.month===m && c.year===y && d>=c.start && d<=c.end);
        const isKuning = kuningList.some(k=>k.status==='approved' && k.personnelId===id && k.month===m && k.year===y && d>=k.start && d<=k.end);
        const leaveType = isCuti ? 'cuti' : (isKuning ? 'kuning' : 'cuti');
        vacancies.push({ d, s, replacedId: id, leaveType });
        logs.push({type:'info', text:`Tgl ${d}: ${getPerson(id).name} keluar dari ${s} (${leaveType}).`});
      });
      if(gone.length && e.cutiReplacements){
        e.cutiReplacements = e.cutiReplacements.filter(r => r.slot !== s || !gone.includes(r.replacedId));
      }
    });
  }

  // 2. Syarat calon pengganti
  const canWork = (id, d, s, strict)=>{
    if(dutyAt(id, d)) return false;                                       // sudah dinas hari itu
    if(onLeave(id, d, m, y, cutiSrc)) return false;                       // sedang cuti/kuning
    if(dutyAt(id, d-1) === 'M') return false;                             // hari ini adalah L1 (lepas malam)
    if(s === 'M' && dutyAt(id, d+1)) return false;                        // besok harus L1 (lepas malam)
    if(strict){
      if(tot[id] >= hard[id]) return false;                               // batas keras bulanan
      if(s === 'M' && dutyAt(id, d+2)) return false;                      // idealnya dapat L2 juga setelah M
      if(dutyAt(id, d-2) === 'M' && s === 'M') return false;              // idealnya tidak jeda 1 hari antar M
    }
    return true;
  };
  const poolOf = (d, s, strict)=> personnel.map(p=>p.id).filter(id=>canWork(id, d, s, strict));

  // 3. Isi slot kosong: yang paling sempit pilihannya didahulukan
  const todo = vacancies.slice();
  while(todo.length){
    let bi = 0, bn = Infinity;
    todo.forEach((v,i)=>{
      const n = poolOf(v.d, v.s, false).length;
      if(n < bn || (n === bn && (v.d < todo[bi].d || (v.d === todo[bi].d && v.s === 'M')))){ bn = n; bi = i; }
    });
    const v = todo.splice(bi, 1)[0];
    const { d, s, replacedId, leaveType } = v;

    let pool = poolOf(d, s, true), relaxed = false;
    if(!pool.length){ pool = poolOf(d, s, false); relaxed = true; }
    if(!pool.length){
      logs.push({type:'bad', text:`Tgl ${d}: slot ${s} kurang, tidak ada pengganti yang memenuhi aturan istirahat.`});
      continue;
    }

    // Urutan prioritas:
    // 1) total dinas paling sedikit  2) paling sedikit sudah jadi pengganti
    // 3) paling "libur" (tidak dinas di hari sebelum/sesudah)  4) beban bulan lalu  5) urutan antrian
    const near = id => (dutyAt(id, d-1) ? 1 : 0) + (dutyAt(id, d+1) ? 1 : 0);
    pool.sort((a,b)=>
      (tot[a]-tot[b]) || (added[a]-added[b]) || (near(a)-near(b)) ||
      (prevTot(a)-prevTot(b)) || ((getPerson(a).rank||99)-(getPerson(b).rank||99)));

    const pick = pool[0];
    cal[d-1][s].push(pick);
    tot[pick] = (tot[pick]||0) + 1;
    added[pick]++;
    if(!cal[d-1].cutiReplacements) cal[d-1].cutiReplacements = [];
    cal[d-1].cutiReplacements.push({
      pid: pick,
      slot: s,
      replacedId: v.replacedId,
      type: v.leaveType || 'cuti'
    });
    logs.push({type:'info', text:`Tgl ${d}: ${getPerson(pick).name} mengisi ${s} (pengganti ${v.leaveType||'cuti'} ${getPerson(v.replacedId).name}, total jadi ${tot[pick]} hari).`});
    if(tot[pick] > hard[pick]){
      logs.push({type:'bad', text:`Tgl ${d}: ${getPerson(pick).name} melewati batas maksimal ${hard[pick]} hari karena tidak ada pengganti lain.`});
    } else if(relaxed){
      logs.push({type:'info', text:`Tgl ${d}: ${getPerson(pick).name} mengisi ${s} dengan penyesuaian aturan istirahat minimal (L1 terpenuhi).`});
    }
  }

  // 4. Hitung ulang L1/L2
  for(let d = Math.max(2, freeze + 1); d <= days; d++){
    cal[d-1].L1 = (cal[d-2].M || []).slice();
    cal[d-1].L2 = (cal[d-2].L1 || []).slice();
  }

  const monthPS = {}, monthM = {};
  personnel.forEach(p=>{ monthPS[p.id] = 0; monthM[p.id] = 0; });
  cal.forEach(e=>{
    (e.PS||[]).forEach(id=> { monthPS[id] = (monthPS[id]||0) + 1; });
    (e.M||[]).forEach(id=> { monthM[id] = (monthM[id]||0) + 1; });
  });

  for(let d = freeze + 1; d <= days; d++){
    cal[d-1].cells = buildDayCellsSnapshot(d, cal[d-1], m, y);
  }

  const diff = [];
  for(let d = freeze + 1; d <= days; d++){
    personnel.forEach(p=>{
      const a = (base.calendar[d-1].PS||[]).includes(p.id) ? 'PS' : ((base.calendar[d-1].M||[]).includes(p.id) ? 'M' : '-');
      const b = dutyAt(p.id, d) || '-';
      if(a !== b) diff.push({ d, pid: p.id, from: a, to: b });
    });
  }

  return {
    calendar: cal, monthPS, monthM, days, logs, diff,
    endQueue: base.endQueue || [], endCur: cal[days-1], carry: base.carry || null
  };
}

function previewLeaves(y, m, leaves){
  const base = schedules[skey(y, m)];
  if(!base) return { r: null, text: 'Jadwal bulan ini belum dibuat.', bad: 0, diff: [], others: [] };
  const r = repairMonth(y, m, base, leaves.map(l=>({ ...l, month: m, year: y })));
  if(!r) return { r: null, text: 'Gagal melakukan kalkulasi dampak jadwal.', bad: 0, diff: [], others: [] };
  const own = new Set(leaves.map(l=>l.personnelId));
  const perPerson = {};
  r.diff.forEach(x=>{
    if(!own.has(x.pid)) perPerson[x.pid] = (perPerson[x.pid] || 0) + 1;
  });
  const others = Object.entries(perPerson).map(([id, n])=> `${getPerson(Number(id)).name} (${n} sel)`);
  const bad = r.logs.filter(l=>l.type==='bad').length;
  const text = `Total ${r.diff.length} sel jadwal disesuaikan.\n`
    + (others.length ? `Personel lain yang terdampak: ${others.join(', ')}.` : `Tidak ada personel lain yang terdampak.`)
    + (bad ? `\n⚠ Perhatian: Terdapat ${bad} catatan/masalah (slot kurang atau kuota).` : '');
  return { r, text, bad, diff: r.diff, others };
}

function applyRepair(y, m, extraLeaves){
  const base = schedules[skey(y, m)];
  if(!base) return null;
  recordScheduleAction(y, m, `Penyesuaian cuti/kuning ${monthNames[m-1]} ${y}`);
  const r = repairMonth(y, m, base, extraLeaves);
  if(!r) return null;
  r.logs = [{ type:'info', text:`Penyesuaian cuti: ${r.diff.length} sel disesuaikan dari jadwal sebelumnya.` }]
    .concat((base.logs||[]).filter(l=>!/^(Penyesuaian|Tgl \d+: .* (keluar dari|mengisi)|Efek berantai)/.test(l.text)), r.logs);
  schedules[skey(y, m)] = r;
  persistSchedule(y, m, r);
  return r;
}

function approveTogether(kind, ids){
  if(!ids || !ids.length) return;
  const items = ids.map(id => getList(kind).find(x => x.id === id)).filter(Boolean);
  if(!items.length) return;
  const y = items[0].year, m = items[0].month;
  const leavesHypo = items.map(i => ({ personnelId: i.personnelId, start: i.start, end: i.end }));

  if(schedules[skey(y, m)]){
    const pv = previewLeaves(y, m, leavesHypo);
    const confirmMsg = `Persetujuan ${items.length} ${reqLabel(kind)} Bersamaan:\n\n${pv.text}\n\nApakah Anda ingin menyetujui semuanya dan memperbarui jadwal?`;
    if(!confirm(confirmMsg)) return;
  }

  items.forEach(i=>{
    i.status = 'approved';
    dbUpdate(kind==='cuti'?'cuti_requests':'kuning_requests', i.id, { status: 'approved' });
  });

  maybeRegenerate(m, y, `${items.length} ${reqLabel(kind)} disetujui bersamaan — jadwal otomatis disesuaikan`, 1, true, leavesHypo);
  refreshAdminOrModal();
  updateNavBadges();
}


function generateSchedule(year, month, initQueue, initCur, existingResult, triggerDay, carry, forceFresh){
  const days = daysInMonthOf(year, month);
  const freezeBoundary = freezeBoundaryForMonth(year, month);

  // Aturan perubahan minimal: jika ada perubahan di triggerDay (mis. tgl 27 saat hari ini tgl 25),
  // maka tgl 26 tetap dipertahankan beku dari jadwal yang sudah ada (tgl 26 tidak berubah).
  let effectiveFreeze = freezeBoundary;
  if(existingResult && existingResult.calendar && existingResult.calendar.length >= days){
    if(triggerDay && triggerDay > freezeBoundary){
      effectiveFreeze = Math.max(freezeBoundary, triggerDay - 1);
    }
  }

  const order = personnel.slice().sort((a,b)=>a.rank-b.rank).map(p=>p.id);
  const T = computeMonthTargets(year, month);
  const effMax = {};
  personnel.forEach(p=>{ effMax[p.id] = T.cap[p.id]; });

  const carryBias = (id, day)=> carry ? ((carry[id]||0) * Math.max(0, 1 - (day-1)/WEEK_WINDOW)) : 0;
  const lag = (id, day)=> (monthPS[id] + monthM[id]) - T.target[id] * (day-1)/days + carryBias(id, day);

  function isOnCuti(pid, day){ return cutiList.some(c=>c.status==='approved' && c.personnelId===pid && c.month===month && c.year===year && day>=c.start && day<=c.end); }
  function isOnKuning(pid, day){ return kuningList.some(k=>k.status==='approved' && k.personnelId===pid && k.month===month && k.year===year && day>=k.start && day<=k.end); }
  function isSwappedOut(pid, day){ return swapList.some(s=>s.status==='approved' && s.requesterId===pid && s.month===month && s.year===year && s.date===day); }
  function isOverMaxQuota(pid){ return (monthPS[pid]+monthM[pid]) >= effMax[pid]; }
  function ineligReason(pid, day){
    if(isOnCuti(pid, day)) return 'cuti';
    if(isOnKuning(pid, day)) return 'kuning';
    if(isSwappedOut(pid, day)) return 'tukar dinas';
    if(isOverMaxQuota(pid)) return `kuota maks ${effMax[pid]} hari/bulan tercapai`;
    return null;
  }
  function eligible(pid, day){ return ineligReason(pid, day)===null; }
  function removeFromArray(arr, id){ const i=arr.indexOf(id); if(i>=0) arr.splice(i,1); }

  // Fungsi pemilih dari waitQueue yang memprioritaskan laju ketertinggalan dinas (lag)
  function takeBestEligible(arr, day, n, exclude){
    const candidates = [];
    for(let i=0; i<arr.length; i++){
      const id = arr[i];
      if(exclude.includes(id)) continue;
      if(eligible(id, day)) candidates.push({ id, idx: i, shifts: lag(id, day) });
    }
    candidates.sort((a,b) => a.shifts - b.shifts);
    const chosen = candidates.slice(0, n).map(c => c.id);
    chosen.forEach(id => removeFromArray(arr, id));
    return chosen;
  }

  const pairHistory = {};
  function pairKey(a,b){ return a<b ? a+'_'+b : b+'_'+a; }
  function pairCount(a,b){ return pairHistory[pairKey(a,b)] || 0; }
  function bumpPair(a,b){ const k=pairKey(a,b); pairHistory[k]=(pairHistory[k]||0)+1; }
  function bumpAllPairs(arr){ for(let i=0;i<arr.length;i++) for(let j=i+1;j<arr.length;j++) bumpPair(arr[i],arr[j]); }

  let waitQueue = initQueue ? initQueue.slice() : order.slice(CAP*2);
  let pendingM = [];
  let cur = initCur ? { PS:initCur.PS.slice(), M:initCur.M.slice(), L1:initCur.L1.slice(), L2:initCur.L2.slice() } : null;
  let calendar = [];
  let logs = [];
  let monthPS={}, monthM={};
  personnel.forEach(p=>{ monthPS[p.id]=0; monthM[p.id]=0; });

  for(let day=1; day<=days; day++){
    // --- TANGGAL BEKU (<= effectiveFreeze):
    // Jadwal tanggal ini FIX 100%, salin persis dari hasil yang tersimpan sebelumnya agar tidak berubah. ---
    if(existingResult && day<=effectiveFreeze && existingResult.calendar && existingResult.calendar[day-1]){
      const frozenEntry = existingResult.calendar[day-1];
      if(cur){ cur.L2.forEach(id=> waitQueue.push(id)); }
      const todayFrozen = { PS: frozenEntry.PS.slice(), M: frozenEntry.M.slice(), L1: (frozenEntry.L1||[]).slice(), L2: (frozenEntry.L2||[]).slice() };
      [...todayFrozen.PS, ...todayFrozen.M].forEach(id=>{ removeFromArray(waitQueue,id); removeFromArray(pendingM,id); });
      bumpAllPairs(todayFrozen.PS);
      bumpAllPairs(todayFrozen.M);
      if(cur){
        const missedM = cur.PS.filter(id => !todayFrozen.M.includes(id) && !todayFrozen.PS.includes(id));
        missedM.forEach(id => { if(!pendingM.includes(id)) pendingM.push(id); });
      }
      const frozenCells = frozenEntry.cells ? JSON.parse(JSON.stringify(frozenEntry.cells)) : buildDayCellsSnapshot(day, frozenEntry, month, year);
      calendar.push({
        day, PS: todayFrozen.PS.slice(), M: todayFrozen.M.slice(), L1: todayFrozen.L1.slice(), L2: todayFrozen.L2.slice(),
        lockedPS: (frozenEntry.lockedPS||[]).slice(), lockedM: (frozenEntry.lockedM||[]).slice(),
        swappedPS: (frozenEntry.swappedPS||[]).slice(), swappedM: (frozenEntry.swappedM||[]).slice(),
        cutiReplacements: (frozenEntry.cutiReplacements||[]).map(r=>({...r})),
        cells: frozenCells
      });
      todayFrozen.PS.forEach(id=> monthPS[id]++);
      todayFrozen.M.forEach(id=> monthM[id]++);
      cur = todayFrozen;
      continue;
    }

    // --- TANGGAL KE DEPAN (> effectiveFreeze):
    const adminLockPS = lockedList.filter(l=>l.date===day && l.slot==='PS' && l.month===month && l.year===year).map(l=>l.personnelId);
    const adminLockM  = lockedList.filter(l=>l.date===day && l.slot==='M'  && l.month===month && l.year===year).map(l=>l.personnelId);
    const swapInPS    = swapList.filter(s=>s.status==='approved' && s.slot==='PS' && s.date===day && s.month===month && s.year===year).map(s=>s.partnerId);
    const swapInM     = swapList.filter(s=>s.status==='approved' && s.slot==='M'  && s.date===day && s.month===month && s.year===year).map(s=>s.partnerId);
    const swapOutPS   = swapList.filter(s=>s.status==='approved' && s.slot==='PS' && s.date===day && s.month===month && s.year===year).map(s=>s.requesterId);
    const swapOutM    = swapList.filter(s=>s.status==='approved' && s.slot==='M'  && s.date===day && s.month===month && s.year===year).map(s=>s.requesterId);

    adminLockPS.forEach(id=> logs.push({type:'info', text:`Tgl ${day}: PS dikunci untuk ${getPerson(id).name} (perintah atasan).`}));
    adminLockM.forEach(id=> logs.push({type:'info', text:`Tgl ${day}: M dikunci untuk ${getPerson(id).name} (perintah atasan).`}));
    swapInPS.forEach(id=>{ const s=swapList.find(x=>x.status==='approved'&&x.slot==='PS'&&x.date===day&&x.month===month&&x.year===year&&x.partnerId===id);
      logs.push({type:'info', text:`Tgl ${day}: PS ditukar — ${getPerson(id).name} menggantikan ${s?getPerson(s.requesterId).name:'?'} (tukar dinas).`}); });
    swapInM.forEach(id=>{ const s=swapList.find(x=>x.status==='approved'&&x.slot==='M'&&x.date===day&&x.month===month&&x.year===year&&x.partnerId===id);
      logs.push({type:'info', text:`Tgl ${day}: M ditukar — ${getPerson(id).name} menggantikan ${s?getPerson(s.requesterId).name:'?'} (tukar dinas).`}); });

    // === KONDISI A: JIKA SUDAH ADA JADWAL BASELINE (PENYESUAIAN LOKAL) ===
    if(existingResult && !forceFresh && existingResult.calendar && existingResult.calendar[day-1]){
      const baseDay = existingResult.calendar[day-1];
      let todayPS = (baseDay.PS || []).slice();
      let todayM  = (baseDay.M  || []).slice();

      // 1. Keluarkan personel yang berhalangan di tanggal ini (Cuti, Kuning, atau Swapped Out)
      todayPS = todayPS.filter(pid => eligible(pid, day) && !swapOutPS.includes(pid));
      todayM  = todayM.filter(pid => eligible(pid, day) && !swapOutM.includes(pid));

      let displaced = [];

      // 2. Terapkan Lock & Swap In untuk PS:
      const wantedPS = Array.from(new Set([...adminLockPS, ...swapInPS])).slice(0, CAP);
      wantedPS.forEach(pid => {
        if(todayPS.includes(pid)) return; // sudah ada di PS
        removeFromArray(todayM, pid); // pindahkan dari M jika sebelumnya di M

        if(todayPS.length >= CAP){
          let replaceIdx = -1;
          for(let i = todayPS.length - 1; i >= 0; i--){
            if(!wantedPS.includes(todayPS[i])){
              if(replaceIdx === -1 || (lag(todayPS[i], day) > lag(todayPS[replaceIdx], day))){
                replaceIdx = i;
              }
            }
          }
          if(replaceIdx >= 0){
            displaced.push(todayPS[replaceIdx]);
            todayPS[replaceIdx] = pid;
          }
        } else {
          todayPS.push(pid);
        }
      });

      // 3. Terapkan Lock & Swap In untuk M:
      const wantedM = Array.from(new Set([...adminLockM, ...swapInM])).slice(0, CAP);
      wantedM.forEach(pid => {
        if(todayM.includes(pid)) return;
        removeFromArray(todayPS, pid);

        if(todayM.length >= CAP){
          let replaceIdx = -1;
          for(let i = todayM.length - 1; i >= 0; i--){
            if(!wantedM.includes(todayM[i])){
              if(replaceIdx === -1 || (lag(todayM[i], day) > lag(todayM[replaceIdx], day))){
                replaceIdx = i;
              }
            }
          }
          if(replaceIdx >= 0){
            displaced.push(todayM[replaceIdx]);
            todayM[replaceIdx] = pid;
          }
        } else {
          todayM.push(pid);
        }
      });

      // 4. Jika ada slot PS yang kurang (< CAP):
      let psNeeded = CAP - todayPS.length;
      if(psNeeded > 0){
        for(let i = displaced.length - 1; i >= 0 && psNeeded > 0; i--){
          const dId = displaced[i];
          if(!todayPS.includes(dId) && !todayM.includes(dId) && eligible(dId, day) && !(cur && cur.M && cur.M.includes(dId))){
            todayPS.push(dId);
            displaced.splice(i, 1);
            psNeeded--;
          }
        }
      }
      if(psNeeded > 0){
        const exclude = todayPS.concat(todayM);
        if(cur && cur.M) exclude.push(...cur.M);
        const candidates = personnel.map(p=>p.id).filter(id => !exclude.includes(id) && eligible(id, day));
        candidates.sort((a,b) => lag(a, day) - lag(b, day));
        const chosen = candidates.slice(0, psNeeded);
        chosen.forEach(id => todayPS.push(id));
      }

      // 5. Jika ada slot M yang kurang (< CAP):
      let mNeeded = CAP - todayM.length;
      if(mNeeded > 0){
        for(let i = displaced.length - 1; i >= 0 && mNeeded > 0; i--){
          const dId = displaced[i];
          if(!todayPS.includes(dId) && !todayM.includes(dId) && eligible(dId, day)){
            todayM.push(dId);
            displaced.splice(i, 1);
            mNeeded--;
          }
        }
      }
      if(mNeeded > 0){
        const exclude = todayPS.concat(todayM);
        if(cur && cur.M) exclude.push(...cur.M);
        const candidates = personnel.map(p=>p.id).filter(id => !exclude.includes(id) && eligible(id, day));
        candidates.sort((a,b) => lag(a, day) - lag(b, day));
        const chosen = candidates.slice(0, mNeeded);
        chosen.forEach(id => todayM.push(id));
      }

      let todayL1 = cur ? cur.M.slice() : (baseDay.L1 || []).slice();
      let todayL2 = cur ? cur.L1.slice() : (baseDay.L2 || []).slice();
      if(cur && cur.L2){ cur.L2.forEach(id => { if(!waitQueue.includes(id)) waitQueue.push(id); }); }
      [...todayPS, ...todayM].forEach(id => removeFromArray(waitQueue, id));

      bumpAllPairs(todayPS);
      bumpAllPairs(todayM);
      const dayCells = buildDayCellsSnapshot(day, {
        PS: todayPS, M: todayM, L1: todayL1, L2: todayL2,
        lockedPS: adminLockPS, lockedM: adminLockM,
        swappedPS: swapInPS, swappedM: swapInM
      }, month, year);
      calendar.push({
        day, PS: todayPS.slice(), M: todayM.slice(), L1: todayL1.slice(), L2: todayL2.slice(),
        lockedPS: adminLockPS.slice(), lockedM: adminLockM.slice(), swappedPS: swapInPS.slice(), swappedM: swapInM.slice(),
        cutiReplacements: (baseDay.cutiReplacements||[]).map(r=>({...r})),
        cells: dayCells
      });
      todayPS.forEach(id => monthPS[id]++);
      todayM.forEach(id => monthM[id]++);
      cur = { PS: todayPS.slice(), M: todayM.slice(), L1: todayL1.slice(), L2: todayL2.slice() };
      continue;
    }

    // === KONDISI B: GENERATE AWAL DARI NOL (FRESH ROTATION) ===
    const lockPSList = Array.from(new Set([...adminLockPS, ...swapInPS])).slice(0,CAP);
    const lockMList  = Array.from(new Set([...adminLockM,  ...swapInM ])).slice(0,CAP);
    let today = { PS: lockPSList.slice(), M: lockMList.slice(), L1:[], L2:[] };
    [...lockPSList, ...lockMList].forEach(id=>{ removeFromArray(waitQueue,id); removeFromArray(pendingM,id); });

    let naturalM = [];
    let isBootstrap = (cur === null);
    if(isBootstrap){
      naturalM = order.slice(CAP, CAP*2);
      const bootstrapPS = order.slice(0, CAP);
      bootstrapPS.forEach(id => {
        if(today.PS.length < CAP && !today.PS.includes(id) && !today.M.includes(id)) {
          today.PS.push(id);
        } else if(!today.PS.includes(id) && !today.M.includes(id) && !waitQueue.includes(id)) {
          waitQueue.unshift(id);
        }
      });
    } else {
      today.L1 = cur.M.slice();
      today.L2 = cur.L1.slice();
      cur.L2.forEach(id=> waitQueue.push(id));
      naturalM = cur.PS.slice();
    }

    naturalM.forEach(id=>{
      if(today.PS.includes(id) || today.M.includes(id)) return;
      if(today.M.length>=CAP){ pendingM.push(id); logs.push({type:'info', text:`Tgl ${day}: giliran M ${getPerson(id).name} tertunda, slot penuh oleh lock.`}); return; }
      if(eligible(id, day)) today.M.push(id);
      else { pendingM.push(id); logs.push({type:'bad', text:`Tgl ${day}: giliran M ${getPerson(id).name} tertunda (${ineligReason(id, day)}).`}); }
    });

    let mNeeded = CAP - today.M.length;
    if(mNeeded>0){
      const fromPending = takeBestEligible(pendingM, day, mNeeded, today.PS.concat(today.M));
      fromPending.forEach(id=>{ today.M.push(id); logs.push({type:'info', text:`Tgl ${day}: giliran M tertunda ${getPerson(id).name} terpenuhi.`}); });
      mNeeded = CAP - today.M.length;
    }
    if(mNeeded>0){
      const fromQueue = takeBestEligible(waitQueue, day, mNeeded, today.PS.concat(today.M));
      fromQueue.forEach(id=> today.M.push(id));
      mNeeded = CAP - today.M.length;
      if(mNeeded>0) logs.push({type:'bad', text:`Tgl ${day}: slot M kurang ${mNeeded} orang.`});
    }

    let psNeeded = CAP - today.PS.length;
    if(psNeeded>0){
      const exclude = today.PS.concat(today.M).concat(today.L1);
      const fromQueue = takeBestEligible(waitQueue, day, psNeeded, exclude);
      fromQueue.forEach(id=> today.PS.push(id));
      psNeeded = CAP - today.PS.length;
      if(psNeeded>0) logs.push({type:'bad', text:`Tgl ${day}: slot PS kurang ${psNeeded} orang.`});
    }

    bumpAllPairs(today.PS);
    bumpAllPairs(today.M);
    const dayCells = buildDayCellsSnapshot(day, {
      PS: today.PS, M: today.M, L1: today.L1, L2: today.L2,
      lockedPS: adminLockPS, lockedM: adminLockM,
      swappedPS: swapInPS, swappedM: swapInM
    }, month, year);

    calendar.push({
      day, PS: today.PS.slice(), M: today.M.slice(), L1: today.L1.slice(), L2: today.L2.slice(),
      lockedPS: adminLockPS.slice(), lockedM: adminLockM.slice(), swappedPS: swapInPS.slice(), swappedM: swapInM.slice(),
      cutiReplacements: [],
      cells: dayCells
    });
    today.PS.forEach(id=> monthPS[id]++);
    today.M.forEach(id=> monthM[id]++);
    cur = today;
  }

  // --- SAFETY AUDIT PASS: PEMERATAAN DINAS SESUAI TARGET BULANAN ---
  const isFreshGen = (!existingResult || forceFresh || !existingResult.calendar || existingResult.calendar.length < days);
  if(isFreshGen){
    for(let p of personnel){
      const totCuti = cutiList.filter(c=>c.status==='approved' && c.personnelId===p.id && c.month===month && c.year===year).reduce((s,c)=>s+(c.end-c.start+1),0);
      const targetMin = Math.max(1, T.target[p.id] - 1);
      if(totCuti < 15 && (monthPS[p.id] + monthM[p.id]) < targetMin){
        for(let d=freezeBoundary+1; d<=days; d++){
          if((monthPS[p.id] + monthM[p.id]) >= targetMin) break;
          const entry = calendar[d-1];
          if(!entry || !eligible(p.id, d)) continue;
          if(entry.PS.includes(p.id) || entry.M.includes(p.id) || entry.L1.includes(p.id)) continue;
          
          let donor = null, donorSlot = null;
          for(let dId of entry.PS){
            if((monthPS[dId] + monthM[dId]) > T.target[dId] && !entry.lockedPS.includes(dId) && !entry.swappedPS.includes(dId)){
              donor = dId; donorSlot = 'PS'; break;
            }
          }
          if(!donor){
            for(let dId of entry.M){
              if((monthPS[dId] + monthM[dId]) > T.target[dId] && !entry.lockedM.includes(dId) && !entry.swappedM.includes(dId)){
                donor = dId; donorSlot = 'M'; break;
              }
            }
          }
          if(donor){
            if(donorSlot === 'PS'){
              entry.PS = entry.PS.map(x => x===donor ? p.id : x);
              monthPS[donor]--; monthPS[p.id]++;
            } else {
              entry.M = entry.M.map(x => x===donor ? p.id : x);
              monthM[donor]--; monthM[p.id]++;
            }
            entry.cells = buildDayCellsSnapshot(d, entry, month, year);
            logs.push({type:'info', text:`Pemerataan tgl ${d}: ${getPerson(donor).name} dialihkan ke ${p.name} agar dinas seimbang sesuai target.`});
          }
        }
      }
    }
  }

  const partnerSets = {};
  personnel.forEach(p=> partnerSets[p.id] = new Set());
  calendar.forEach(d=>{
    [d.PS, d.M].forEach(arr=>{
      for(let i=0;i<arr.length;i++) for(let j=i+1;j<arr.length;j++) if(i!==j) partnerSets[arr[i]].add(arr[j]);
    });
  });
  const sizes = personnel.map(p=> partnerSets[p.id].size);
  const avgPartner = sizes.length ? (sizes.reduce((a,b)=>a+b,0)/sizes.length) : 0;
  const maxPossible = Math.max(personnel.length-1, 0);
  logs.unshift({type:'info', text:`Variasi pasangan bulan ini: rata-rata tiap personel bertemu ${avgPartner.toFixed(1)} partner berbeda (dari maksimal ${maxPossible}).`});
  return { calendar, monthPS, monthM, logs, days, endQueue: waitQueue.slice(), endCur: cur, carry };
}

function generateAndStore(y, m, triggerDay, forceFresh){
  recordScheduleAction(y, m, `Penyesuaian jadwal ${monthNames[m-1]} ${y}`);
  const res = computeGeneratedSchedule(y, m, triggerDay, forceFresh);
  schedules[skey(y, m)] = res;
  persistSchedule(y, m, res);

  let regenerated = 0, last = res, n = nextMonthYear(y, m);
  while(schedules[skey(n.y, n.m)] && !triggerDay){
    const existingNext = schedules[skey(n.y, n.m)];
    const derivedNext = deriveInitStateFromPrev(last, n.y, n.m);
    const r = generateSchedule(n.y, n.m, derivedNext ? derivedNext.initQueue : last.endQueue, derivedNext ? derivedNext.initCur : last.endCur, existingNext, null, derivedNext ? derivedNext.carry : null, false);
    r.logs.unshift({type:'info', text:`Rotasi disambung dari profil minggu terakhir ${monthNames[prevMonthYear(n.y,n.m).m-1]} ${prevMonthYear(n.y,n.m).y}.`});
    schedules[skey(n.y, n.m)] = r;
    persistSchedule(n.y, n.m, r);
    last = r; regenerated++;
    n = nextMonthYear(n.y, n.m);
  }
  return regenerated;
}

/* =====================================================================
   FITUR RESET & JADWAL MANUAL (ADMIN)
   ===================================================================== */
const btnResetEl = document.getElementById('btnResetSched');
if(btnResetEl) btnResetEl.addEventListener('click', () => resetSchedule(viewY, viewM));

const btnAdminResetEl = document.getElementById('btnAdminReset');
if(btnAdminResetEl) btnAdminResetEl.addEventListener('click', () => resetSchedule(viewY, viewM));

function auditMonthSchedule(sched, year, month){
  if(!sched || !sched.calendar) return;
  const problems = [];
  const days = sched.days;

  // 1. Periksa kapasitas harian (2 PS + 2 M)
  for(let d=1; d<=days; d++){
    const entry = sched.calendar[d - 1];
    if(!entry) continue;
    const psCount = (entry.PS || []).length;
    const mCount = (entry.M || []).length;
    if(psCount !== 2){
      problems.push({ type: 'bad', text: `Tgl ${d}: Slot PS terisi ${psCount} orang (${(entry.PS||[]).map(id=>getPerson(id).name).join(', ')||'kosong'}), standar adalah 2 orang.` });
    }
    if(mCount !== 2){
      problems.push({ type: 'bad', text: `Tgl ${d}: Slot M terisi ${mCount} orang (${(entry.M||[]).map(id=>getPerson(id).name).join(', ')||'kosong'}), standar adalah 2 orang.` });
    }
  }

  // 2. Periksa jeda istirahat malam & batas keras kuota
  personnel.forEach(p => {
    const tot = (sched.monthPS[p.id] || 0) + (sched.monthM[p.id] || 0);
    if(tot > HARD_MAX){
      problems.push({ type: 'bad', text: `Batas keras terlampaui: ${p.name} total dinas ${tot} hari (maksimal ${HARD_MAX} hari/bulan).` });
    } else if(tot > 13){
      problems.push({ type: 'warn', text: `Di atas target: ${p.name} total dinas ${tot} hari (target standar 12-13 hari).` });
    }

    for(let d=1; d<=days; d++){
      const entry = sched.calendar[d - 1];
      if((entry.M || []).includes(p.id)){
        if(d + 1 <= days){
          const nextD = sched.calendar[d];
          if((nextD.PS || []).includes(p.id) || (nextD.M || []).includes(p.id)){
            problems.push({ type: 'bad', text: `Pelanggaran jeda istirahat: ${p.name} dinas Malam tgl ${d}, namun berdinas pada tgl ${d+1} (wajib Libur-1).` });
          }
        }
        if(d + 2 <= days){
          const day2D = sched.calendar[d + 1];
          if((day2D.PS || []).includes(p.id) || (day2D.M || []).includes(p.id)){
            problems.push({ type: 'bad', text: `Pelanggaran jeda istirahat: ${p.name} dinas Malam tgl ${d}, namun berdinas pada tgl ${d+2} (wajib Libur-2).` });
          }
        }
      }
    }
  });

  if(!problems.length){
    sched.logs = [{ type: 'ok', text: 'Semua kaedah rotasi terpenuhi: kapasitas 2+2 per hari, jeda malam aman, dan kuota seimbang.' }];
  } else {
    sched.logs = problems;
  }
}

function createBlankSchedule(y, m){
  if(!isAdmin()) return;
  const days = daysInMonthOf(y, m);
  const pv = prevMonthYear(y, m);
  const prev = schedules[skey(pv.y, pv.m)];

  let initialDay1L1 = [], initialDay1L2 = [], initialDay2L2 = [];
  if(prev && prev.calendar && prev.calendar.length){
    const lastDay = prev.calendar[prev.calendar.length - 1];
    initialDay1L1 = (lastDay.M || []).slice();
    const secondLastDay = prev.calendar.length >= 2 ? prev.calendar[prev.calendar.length - 2] : null;
    if(secondLastDay){
      initialDay1L2 = (secondLastDay.M || []).slice();
    }
    initialDay2L2 = (lastDay.M || []).slice();
  }

  const calendar = [];
  const monthPS = {}, monthM = {};
  personnel.forEach(p => { monthPS[p.id] = 0; monthM[p.id] = 0; });

  for(let d=1; d<=days; d++){
    const entry = {
      day: d,
      PS: [],
      M: [],
      L1: d===1 ? initialDay1L1.slice() : [],
      L2: d===1 ? initialDay1L2.slice() : (d===2 ? initialDay2L2.slice() : []),
      lockedPS: [],
      lockedM: [],
      swappedPS: [],
      swappedM: [],
      cutiReplacements: [],
      cells: {}
    };
    entry.cells = buildDayCellsSnapshot(d, entry, m, y);
    calendar.push(entry);
  }

  const order = personnel.slice().sort((a,b)=>a.rank-b.rank).map(p=>p.id);
  const res = {
    year: y,
    month: m,
    days,
    calendar,
    monthPS,
    monthM,
    logs: [{ type: 'info', text: `Jadwal manual kosong dibuat oleh Admin. Silakan klik sel untuk mengisi dinas per personel.` }],
    endQueue: order,
    endCur: { PS: [], M: [], L1: [], L2: [] }
  };

  auditMonthSchedule(res, y, m);
  recordScheduleAction(y, m, `Buat jadwal kosong ${monthNames[m-1]} ${y}`);
  schedules[skey(y, m)] = res;
  persistSchedule(y, m, res);
  renderAll();
  toast(`Jadwal kosong ${monthNames[m-1]} ${y} siap diisi secara manual.`);
}

function checkManualShiftWarnings(day, pid, newShift, sched, year, month){
  const warnings = [];
  const freeze = freezeBoundaryForMonth(year, month);
  if(day <= freeze){
    warnings.push({ level: 'bad', text: `Tanggal ${day} sudah berjalan (fix) dan terkunci permanen sesuai kaedah riwayat dinas.` });
    return warnings;
  }

  const p = getPerson(pid);
  const onCuti = cutiList.some(c=>c.status==='approved' && c.personnelId===pid && c.month===month && c.year===year && day>=c.start && day<=c.end);
  const onKuning = kuningList.some(k=>k.status==='approved' && k.personnelId===pid && k.month===month && k.year===year && day>=k.start && day<=k.end);

  if((newShift === 'PS' || newShift === 'M') && onCuti){
    warnings.push({ level: 'bad', text: `${p.name} sedang dalam masa CUTI yang telah disetujui pada tanggal ${day}.` });
  }
  if((newShift === 'PS' || newShift === 'M') && onKuning){
    warnings.push({ level: 'warn', text: `${p.name} memiliki pengajuan KUNING (keinginan libur) yang disetujui pada tanggal ${day}.` });
  }

  function getShiftAt(d){
    if(d >= 1 && d <= sched.days){
      if(d === day) return newShift;
      const entry = sched.calendar[d - 1];
      if(!entry) return 'OFF';
      if((entry.PS || []).includes(pid)) return 'PS';
      if((entry.M || []).includes(pid)) return 'M';
      return 'OFF';
    }
    if(d < 1){
      const pv = prevMonthYear(year, month);
      const prevSched = schedules[skey(pv.y, pv.m)];
      if(prevSched && prevSched.calendar && prevSched.calendar.length){
        const prevDay = prevSched.days + d;
        if(prevDay >= 1 && prevDay <= prevSched.calendar.length){
          const entry = prevSched.calendar[prevDay - 1];
          if((entry.PS || []).includes(pid)) return 'PS';
          if((entry.M || []).includes(pid)) return 'M';
        }
      }
      return 'OFF';
    }
    if(d > sched.days){
      const nx = nextMonthYear(year, month);
      const nextSched = schedules[skey(nx.y, nx.m)];
      if(nextSched && nextSched.calendar && nextSched.calendar.length){
        const nxDay = d - sched.days;
        if(nxDay >= 1 && nxDay <= nextSched.calendar.length){
          const entry = nextSched.calendar[nxDay - 1];
          if((entry.PS || []).includes(pid)) return 'PS';
          if((entry.M || []).includes(pid)) return 'M';
        }
      }
      return 'OFF';
    }
    return 'OFF';
  }

  // Kaedah istirahat pasca-malam
  if(newShift === 'PS' || newShift === 'M'){
    const prev1 = getShiftAt(day - 1);
    if(prev1 === 'M'){
      warnings.push({ level: 'bad', text: `Pelanggaran Istirahat: Personel dinas Malam kemarin (tgl ${day-1}). Hari ini wajib Libur-1 (L1) untuk pemulihan fisik.` });
    }
    const prev2 = getShiftAt(day - 2);
    if(prev2 === 'M'){
      warnings.push({ level: 'bad', text: `Pelanggaran Istirahat: Personel dinas Malam 2 hari lalu (tgl ${day-2}). Hari ini masih wajib Libur-2 (L2).` });
    }
  }

  if(newShift === 'M'){
    const next1 = getShiftAt(day + 1);
    if(next1 === 'PS' || next1 === 'M'){
      warnings.push({ level: 'bad', text: `Pelanggaran Istirahat: Jika dinas Malam hari ini, besok (tgl ${day+1}) wajib Libur-1, tetapi sudah terjadwal dinas ${next1}.` });
    }
    const next2 = getShiftAt(day + 2);
    if(next2 === 'PS' || next2 === 'M'){
      warnings.push({ level: 'bad', text: `Pelanggaran Istirahat: Jika dinas Malam hari ini, lusa (tgl ${day+2}) wajib Libur-2, tetapi sudah terjadwal dinas ${next2}.` });
    }
  }

  // Kapasitas harian slot
  const dayEntry = sched.calendar[day - 1] || {};
  const otherPs = (dayEntry.PS || []).filter(id => id !== pid);
  const otherM = (dayEntry.M || []).filter(id => id !== pid);

  if(newShift === 'PS'){
    if(otherPs.length >= 2){
      const names = otherPs.map(id => getPerson(id).name).join(', ');
      warnings.push({ level: 'warn', text: `Kelebihan Kapasitas: Slot PS tanggal ${day} sudah diisi oleh ${names}. Menambah personel ini akan menjadi ${otherPs.length + 1} orang (standar: 2).` });
    }
  } else if(newShift === 'M'){
    if(otherM.length >= 2){
      const names = otherM.map(id => getPerson(id).name).join(', ');
      warnings.push({ level: 'warn', text: `Kelebihan Kapasitas: Slot M tanggal ${day} sudah diisi oleh ${names}. Menambah personel ini akan menjadi ${otherM.length + 1} orang (standar: 2).` });
    }
  } else if(newShift === 'OFF'){
    const wasPS = (dayEntry.PS || []).includes(pid);
    const wasM = (dayEntry.M || []).includes(pid);
    if(wasPS && otherPs.length < 2){
      warnings.push({ level: 'info', text: `Perhatian: Slot PS tanggal ${day} menjadi ${otherPs.length} orang (kurang dari standar 2 orang).` });
    }
    if(wasM && otherM.length < 2){
      warnings.push({ level: 'info', text: `Perhatian: Slot M tanggal ${day} menjadi ${otherM.length} orang (kurang dari standar 2 orang).` });
    }
  }

  // Kuota bulanan
  let projected = 0;
  for(let d=1; d<=sched.days; d++){
    if(d === day){
      if(newShift === 'PS' || newShift === 'M') projected++;
    } else {
      const e = sched.calendar[d - 1];
      if(e && ((e.PS||[]).includes(pid) || (e.M||[]).includes(pid))) projected++;
    }
  }

  if(projected > HARD_MAX){
    warnings.push({ level: 'bad', text: `Melampaui Batas Keras: Total dinas ${p.name} bulan ini akan menjadi ${projected} hari (melebihi HARD_MAX ${HARD_MAX} hari/bulan).` });
  } else if(projected > 13){
    warnings.push({ level: 'warn', text: `Di Atas Target: Total dinas ${p.name} akan menjadi ${projected} hari (target standar pemerataan: 12–13 hari).` });
  }

  if(newShift === 'PS' && getShiftAt(day - 1) === 'PS'){
    warnings.push({ level: 'warn', text: `Dinas Berturut-turut: Personel dinas PS 2 hari beruntun (pola rotasi normal adalah PS lalu M).` });
  }

  return warnings;
}

let manualEditState = null;

function openManualEditModal(day, pid){
  if(!isAdmin()) return;
  const sched = schedules[skey(viewY, viewM)];
  if(!sched) return;
  const freeze = freezeBoundaryForMonth(viewY, viewM);
  if(day <= freeze){
    toast(`Tanggal ${day} sudah berjalan (fix) dan tidak dapat diubah.`);
    return;
  }
  const entry = sched.calendar[day-1] || {};
  const isPS = (entry.PS||[]).includes(pid);
  const isM = (entry.M||[]).includes(pid);
  const onCuti = cutiList.find(c=>c.status==='approved' && c.personnelId===pid && c.month===viewM && c.year===viewY && day>=c.start && day<=c.end);
  const onKuning = kuningList.find(k=>k.status==='approved' && k.personnelId===pid && k.month===viewM && k.year===viewY && day>=k.start && day<=k.end);
  const lockItem = lockedList.find(l=>l.personnelId===pid && l.date===day && l.month===viewM && l.year===viewY);

  let initialMode = 'OFF';
  let lockSlot = 'PS';
  let lockReason = 'Permintaan Pimpinan / Bos suruh masuk';
  let cutiReason = 'Cuti tahunan';
  let kuningReason = 'Keinginan libur';

  if(lockItem){
    initialMode = 'LOCK';
    lockSlot = lockItem.slot || (isM ? 'M' : 'PS');
    lockReason = lockItem.reason || lockReason;
  } else if(onCuti){
    initialMode = 'CUTI';
    cutiReason = onCuti.reason || cutiReason;
  } else if(onKuning){
    initialMode = 'KUNING';
    kuningReason = onKuning.reason || kuningReason;
  } else if(isPS){
    initialMode = 'PS';
  } else if(isM){
    initialMode = 'M';
  }

  manualEditState = {
    day,
    pid,
    sched,
    year: viewY,
    month: viewM,
    selectedMode: initialMode,
    lockSlot,
    lockReason,
    cutiReason,
    kuningReason
  };
  openModal('edit_shift');
}

function renderManualEditPanel(area){
  if(!manualEditState) return;
  const { day, pid, sched, year, month, selectedMode, lockSlot, lockReason, cutiReason, kuningReason } = manualEditState;
  const p = getPerson(pid);
  const dow = new Date(year, month - 1, day).getDay();
  const dayNamesFull = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const dayStr = `${dayNamesFull[dow]}, ${day} ${monthNames[month-1]} ${year}`;

  const modeLabels = {
    'OFF': 'Libur / Antre (–)',
    'PS': 'Pagi Siang (PS)',
    'M': 'Malam (M)',
    'CUTI': 'Cuti Resmi (C)',
    'KUNING': 'Kuning Disetujui (K)',
    'LOCK': `🔒 Lock Khusus (${lockSlot})`
  };

  document.getElementById('mSub').textContent = `${p.name} · ${dayStr}`;

  area.innerHTML = `
    <div class="card">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid var(--line);">
        <div>
          <div style="font-size:15px; font-weight:700; color:var(--ink);">${esc(p.name)}</div>
          <div style="font-size:12px; color:var(--ink-soft);">${dayStr}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px; color:var(--ink-soft); text-transform:uppercase; font-weight:600;">Status Terpilih</div>
          <div id="manualCurrentBadge" style="font-family:var(--mono); font-weight:700; font-size:14px; color:var(--navy);">${modeLabels[selectedMode] || selectedMode}</div>
        </div>
      </div>

      <div class="formrow">
        <label style="font-weight:700;">Pilih Status / Jenis Shift:</label>
        <div class="shift-picker" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin:8px 0;">
          <button type="button" class="shift-opt opt-off ${selectedMode==='OFF'?'active':''}" data-mode="OFF">Libur (–)</button>
          <button type="button" class="shift-opt opt-ps ${selectedMode==='PS'?'active':''}" data-mode="PS">Pagi Siang (PS)</button>
          <button type="button" class="shift-opt opt-m ${selectedMode==='M'?'active':''}" data-mode="M">Malam (M)</button>
          <button type="button" class="shift-opt opt-cuti ${selectedMode==='CUTI'?'active':''}" data-mode="CUTI">🏖 Cuti (C)</button>
          <button type="button" class="shift-opt opt-kuning ${selectedMode==='KUNING'?'active':''}" data-mode="KUNING">⭐ Kuning (K)</button>
          <button type="button" class="shift-opt opt-lock ${selectedMode==='LOCK'?'active':''}" data-mode="LOCK">🔒 Lock Khusus</button>
        </div>
      </div>

      <!-- Detail Box untuk Lock Khusus -->
      <div id="lockConfigBox" style="${selectedMode==='LOCK'?'':'display:none;'} background:#F0F4F8; border:1px solid #C8D8E8; border-radius:8px; padding:12px; margin:10px 0;">
        <div style="font-size:12.5px; font-weight:700; color:var(--navy); margin-bottom:8px;">🔒 Pengaturan Lock Khusus (Permintaan Masuk)</div>
        <div class="formrow" style="margin-bottom:8px;">
          <label style="font-size:12px; font-weight:600;">Pilih Slot Dinas:</label>
          <div style="display:flex; gap:16px; margin-top:3px;">
            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:13px; font-weight:600;">
              <input type="radio" name="radLockSlot" value="PS" ${lockSlot==='PS'?'checked':''}> PS (Pagi Siang)
            </label>
            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:13px; font-weight:600;">
              <input type="radio" name="radLockSlot" value="M" ${lockSlot==='M'?'checked':''}> M (Malam)
            </label>
          </div>
        </div>
        <div class="formrow" style="margin-bottom:0;">
          <label style="font-size:12px; font-weight:600;">Alasan Lock Khusus:</label>
          <input type="text" id="txtLockReason" value="${esc(lockReason)}" placeholder="mis. Permintaan pimpinan / Bos suruh masuk">
        </div>
      </div>

      <!-- Detail Box untuk Cuti -->
      <div id="cutiConfigBox" style="${selectedMode==='CUTI'?'':'display:none;'} background:#FDF2F1; border:1px solid #F5C6C2; border-radius:8px; padding:12px; margin:10px 0;">
        <div style="font-size:12.5px; font-weight:700; color:var(--red); margin-bottom:6px;">🏖 Alasan Cuti</div>
        <input type="text" id="txtCutiReason" value="${esc(cutiReason)}" placeholder="mis. Cuti tahunan / keperluan keluarga">
        ${(()=>{ const jatah=cutiBalanceForYear(pid,year), pakai=cutiUsedInYear(pid,year), sudah=cutiList.some(c=>c.personnelId===pid&&c.month===month&&c.year===year&&c.status!=='rejected'&&day>=c.start&&day<=c.end), sisa=Math.max(jatah-pakai,0);
          return `<div style="font-size:12px; color:#7E1F16; margin-top:8px; line-height:1.5;">Sisa cuti <b>${esc(p.name)}</b> ${year}: <b>${sisa}</b> dari ${jatah} hari${sudah?'.':` → jadi <b>${Math.max(sisa-1,0)}</b>. Cuti mengurangi jatah 1 hari, termasuk bila diambil di hari libur.`}</div>`; })()}
      </div>

      <!-- Detail Box untuk Kuning -->
      <div id="kuningConfigBox" style="${selectedMode==='KUNING'?'':'display:none;'} background:#FEF9E7; border:1px solid #FCE599; border-radius:8px; padding:12px; margin:10px 0;">
        <div style="font-size:12.5px; font-weight:700; color:#7D5A06; margin-bottom:6px;">⭐ Alasan Pengajuan Kuning (Keinginan Libur)</div>
        <input type="text" id="txtKuningReason" value="${esc(kuningReason)}" placeholder="mis. Keinginan libur tanggal ini">
      </div>

      <div class="sect" style="margin:16px 0 8px;">Pemeriksaan Kaedah Rotasi &amp; Kuota (Live)</div>
      <div id="manualWarnBox"></div>

      <div style="display:flex; gap:10px; margin-top:20px;">
        <button class="submit" id="btnSaveManualEdit" style="flex:1;">Simpan Jadwal</button>
        <button class="ghost" type="button" onclick="closeModal()">Batal</button>
      </div>
    </div>
  `;

  // Attach button mode switches
  area.querySelectorAll('.shift-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      area.querySelectorAll('.shift-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      manualEditState.selectedMode = btn.dataset.mode;

      const lockBox = document.getElementById('lockConfigBox');
      const cutiBox = document.getElementById('cutiConfigBox');
      const kuningBox = document.getElementById('kuningConfigBox');

      if(lockBox) lockBox.style.display = manualEditState.selectedMode === 'LOCK' ? 'block' : 'none';
      if(cutiBox) cutiBox.style.display = manualEditState.selectedMode === 'CUTI' ? 'block' : 'none';
      if(kuningBox) kuningBox.style.display = manualEditState.selectedMode === 'KUNING' ? 'block' : 'none';

      const badge = document.getElementById('manualCurrentBadge');
      if(badge) {
        if(manualEditState.selectedMode === 'LOCK'){
          badge.textContent = `🔒 Lock Khusus (${manualEditState.lockSlot})`;
        } else {
          badge.textContent = modeLabels[manualEditState.selectedMode] || manualEditState.selectedMode;
        }
      }
      updateManualWarnBox();
    });
  });

  // Lock Slot radios
  area.querySelectorAll('input[name="radLockSlot"]').forEach(rad => {
    rad.addEventListener('change', () => {
      manualEditState.lockSlot = rad.value;
      const badge = document.getElementById('manualCurrentBadge');
      if(badge && manualEditState.selectedMode === 'LOCK'){
        badge.textContent = `🔒 Lock Khusus (${manualEditState.lockSlot})`;
      }
      updateManualWarnBox();
    });
  });

  // Reason inputs
  const txtLock = document.getElementById('txtLockReason');
  if(txtLock) txtLock.addEventListener('input', () => { manualEditState.lockReason = txtLock.value; });

  const txtCuti = document.getElementById('txtCutiReason');
  if(txtCuti) txtCuti.addEventListener('input', () => { manualEditState.cutiReason = txtCuti.value; });

  const txtKuning = document.getElementById('txtKuningReason');
  if(txtKuning) txtKuning.addEventListener('input', () => { manualEditState.kuningReason = txtKuning.value; });

  const btnSave = document.getElementById('btnSaveManualEdit');
  if(btnSave) btnSave.addEventListener('click', saveManualEdit);

  updateManualWarnBox();
}

function updateManualWarnBox(){
  const box = document.getElementById('manualWarnBox');
  if(!box || !manualEditState) return;
  const { day, pid, sched, year, month, selectedMode, lockSlot } = manualEditState;

  let effectiveShift = 'OFF';
  if(selectedMode === 'PS') effectiveShift = 'PS';
  else if(selectedMode === 'M') effectiveShift = 'M';
  else if(selectedMode === 'LOCK') effectiveShift = lockSlot;
  else effectiveShift = 'OFF';

  const warnings = checkManualShiftWarnings(day, pid, effectiveShift, sched, year, month);

  // Filter out self cuti/kuning warnings jika sedang memilih cuti/kuning
  const filtered = warnings.filter(w => {
    if(selectedMode === 'CUTI' && w.text.includes('CUTI')) return false;
    if(selectedMode === 'KUNING' && w.text.includes('KUNING')) return false;
    return true;
  });

  if(selectedMode === 'LOCK'){
    filtered.unshift({
      level: 'info',
      text: `🔒 Kunci Khusus (${lockSlot}): Slot ini akan dikunci permanen oleh Admin (tidak tergeser saat auto-generate).`
    });
  } else if(selectedMode === 'CUTI'){
    filtered.unshift({
      level: 'info',
      text: `🏖 Status Cuti: Personel ditandai Cuti resmi pada tanggal ${day}. Jatah cuti tahunan akan berkurang 1 hari.`
    });
  } else if(selectedMode === 'KUNING'){
    filtered.unshift({
      level: 'info',
      text: `⭐ Status Kuning: Personel ditandai Kuning (keinginan libur disetujui) pada tanggal ${day}.`
    });
  }

  if(!filtered.length){
    box.innerHTML = `
      <div class="warn-item ok">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="flex:none;"><polyline points="20 6 9 17 4 12"/></svg>
        <div><b>Sesuai Kaedah Rotasi BMKG:</b> Tidak ada pelanggaran jeda malam, kuota slot dinas terpenuhi, dan beban bulanan seimbang.</div>
      </div>
    `;
    return;
  }

  box.innerHTML = filtered.map(w => {
    const icon = w.level === 'bad' ? '⛔' : (w.level === 'warn' ? '⚠' : 'ℹ');
    return `<div class="warn-item ${w.level}">
      <span style="font-size:14px; flex:none;">${icon}</span>
      <div>${esc(w.text)}</div>
    </div>`;
  }).join('');
}

async function saveManualEdit(){
  if(!manualEditState) return;
  const { day, pid, sched, year, month, selectedMode, lockSlot, lockReason, cutiReason, kuningReason } = manualEditState;

  let effectiveShift = 'OFF';
  if(selectedMode === 'PS') effectiveShift = 'PS';
  else if(selectedMode === 'M') effectiveShift = 'M';
  else if(selectedMode === 'LOCK') effectiveShift = lockSlot;

  const warnings = checkManualShiftWarnings(day, pid, effectiveShift, sched, year, month);
  const bads = warnings.filter(w => {
    if(selectedMode === 'CUTI' && w.text.includes('CUTI')) return false;
    if(selectedMode === 'KUNING' && w.text.includes('KUNING')) return false;
    return w.level === 'bad';
  });

  if(bads.length > 0){
    const msg = bads.map(b => '• ' + b.text).join('\n');
    const ok = confirm(`PERINGATAN KAEDAH KERAS:\n\nTerdapat potensi pelanggaran kaedah:\n${msg}\n\nApakah Anda sebagai Admin tetap ingin menyimpan perubahan ini (Diskresi Admin)?`);
    if(!ok) return;
  }

  if(!isPreviewActive(year, month)){
    recordScheduleAction(year, month, `Ubah shift ${getPerson(pid).name} tgl ${day}`);
  }

  const dEntry = sched.calendar[day - 1];
  if(!dEntry) return;

  // Slot dinas asal personel di hari ini (dipakai untuk mencarikan pengganti saat cuti/kuning)
  const prevSlot = (dEntry.PS||[]).includes(pid) ? 'PS' : ((dEntry.M||[]).includes(pid) ? 'M' : null);
  let needRepair = false, cancelledLeave = false, replMsg = '';

  // 1. Bersihkan status dinas lama hari itu
  dEntry.PS = (dEntry.PS || []).filter(id => id !== pid);
  dEntry.M = (dEntry.M || []).filter(id => id !== pid);
  dEntry.L1 = (dEntry.L1 || []).filter(id => id !== pid);
  dEntry.L2 = (dEntry.L2 || []).filter(id => id !== pid);
  dEntry.lockedPS = (dEntry.lockedPS || []).filter(id => id !== pid);
  dEntry.lockedM = (dEntry.lockedM || []).filter(id => id !== pid);

  // 2. Bersihkan lock lama jika ada
  const existingLockIdx = lockedList.findIndex(l => l.personnelId === pid && l.date === day && l.month === month && l.year === year);
  if(existingLockIdx >= 0){
    const lockId = lockedList[existingLockIdx].id;
    lockedList.splice(existingLockIdx, 1);
    dbDelete('locked_slots', lockId);
  }

  // 3. Bersihkan cuti lama pada tanggal ini jika beralih ke mode selain cuti
  const existingCutiIdx = cutiList.findIndex(c => c.personnelId === pid && c.month === month && c.year === year && day >= c.start && day <= c.end);
  if(existingCutiIdx >= 0 && selectedMode !== 'CUTI'){
    const cItem = cutiList[existingCutiIdx];
    cancelledLeave = true;
    cutiList.splice(existingCutiIdx, 1);
    dbDelete('cuti_requests', cItem.id);
  }

  // 4. Bersihkan kuning lama pada tanggal ini jika beralih ke mode selain kuning
  const existingKuningIdx = kuningList.findIndex(k => k.personnelId === pid && k.month === month && k.year === year && day >= k.start && day <= k.end);
  if(existingKuningIdx >= 0 && selectedMode !== 'KUNING'){
    const kItem = kuningList[existingKuningIdx];
    cancelledLeave = true;
    kuningList.splice(existingKuningIdx, 1);
    dbDelete('kuning_requests', kItem.id);
  }

  // 5. Terapkan mode baru
  if(selectedMode === 'PS'){
    dEntry.PS.push(pid);
  } else if(selectedMode === 'M'){
    dEntry.M.push(pid);
    if(day + 1 <= sched.days){
      const nextD = sched.calendar[day];
      if(!nextD.L1) nextD.L1 = [];
      if(!nextD.L1.includes(pid)) nextD.L1.push(pid);
      nextD.cells = buildDayCellsSnapshot(day + 1, nextD, month, year);
    }
    if(day + 2 <= sched.days){
      const day2D = sched.calendar[day + 1];
      if(!day2D.L2) day2D.L2 = [];
      if(!day2D.L2.includes(pid)) day2D.L2.push(pid);
      day2D.cells = buildDayCellsSnapshot(day + 2, day2D, month, year);
    }
  } else if(selectedMode === 'CUTI'){
    if(existingCutiIdx < 0){
      const row = { id: nextId++, personnelId: pid, start: day, end: day, reason: cutiReason || 'Cuti tahunan', month, year, status: 'approved' };
      cutiList.push(row);
      needRepair = true;
      dbInsert('cuti_requests', row);
      // Sisa cuti = jatah − cuti tercatat (cutiUsedInYear), jadi cukup mencatat barisnya; jatah tidak diubah.
    }
  } else if(selectedMode === 'KUNING'){
    if(existingKuningIdx < 0){
      const row = { id: nextId++, personnelId: pid, start: day, end: day, reason: kuningReason || 'Keinginan libur', month, year, status: 'approved' };
      kuningList.push(row);
      needRepair = true;
      dbInsert('kuning_requests', row);
    }
  } else if(selectedMode === 'LOCK'){
    if(lockSlot === 'PS'){
      dEntry.PS.push(pid);
      dEntry.lockedPS.push(pid);
    } else {
      dEntry.M.push(pid);
      dEntry.lockedM.push(pid);
      if(day + 1 <= sched.days){
        const nextD = sched.calendar[day];
        if(!nextD.L1) nextD.L1 = [];
        if(!nextD.L1.includes(pid)) nextD.L1.push(pid);
        nextD.cells = buildDayCellsSnapshot(day + 1, nextD, month, year);
      }
      if(day + 2 <= sched.days){
        const day2D = sched.calendar[day + 1];
        if(!day2D.L2) day2D.L2 = [];
        if(!day2D.L2.includes(pid)) day2D.L2.push(pid);
        day2D.cells = buildDayCellsSnapshot(day + 2, day2D, month, year);
      }
    }
    const row = { id: nextId++, personnelId: pid, date: day, slot: lockSlot, reason: lockReason || 'Permintaan pimpinan', month, year };
    lockedList.push(row);
    dbInsert('locked_slots', row);
  }

  // 6a. CUTI/KUNING baru pada hari yang sebelumnya berdinas -> cari pengganti otomatis.
  //     Memakai repairMonth() yang sama dengan jalur "setujui cuti": prioritas total hari paling sedikit
  //     (dinamis, berhenti bila sudah sama), lalu paling sedikit jadi pengganti, lalu yang paling libur.
  if(needRepair && prevSlot){
    dEntry[prevSlot].push(pid);   // kembalikan sementara agar slot terdeteksi kosong oleh repairMonth
    const r = repairMonth(year, month, sched, []);
    if(r){
      const keepLogs = (sched.logs||[]).filter(l => !/^(Penyesuaian|Tgl \d+: .* (keluar dari|mengisi)|Efek berantai)/.test(l.text));
      Object.assign(sched, { calendar:r.calendar, monthPS:r.monthPS, monthM:r.monthM, logs:keepLogs.concat(r.logs), endCur:r.endCur });
      const rp = (sched.calendar[day-1].cutiReplacements||[]).find(x => x.replacedId === pid && x.slot === prevSlot);
      replMsg = rp
        ? ` · pengganti ${prevSlot}: ${getPerson(rp.pid).name} (total ${(sched.monthPS[rp.pid]||0)+(sched.monthM[rp.pid]||0)} hari)`
        : ` · ⚠ belum ada pengganti ${prevSlot} yang memenuhi aturan`;
    }
  }

  // 6b. Cuti/kuning dibatalkan dan personel kembali ke slot semula -> lepas penggantinya agar tidak kelebihan orang
  if(cancelledLeave){
    const newSlot = selectedMode==='PS' ? 'PS' : (selectedMode==='M' ? 'M' : (selectedMode==='LOCK' ? lockSlot : null));
    const dNow = sched.calendar[day-1];
    const rp = newSlot && (dNow.cutiReplacements||[]).find(x => x.replacedId === pid && x.slot === newSlot);
    if(rp){
      dNow[newSlot] = (dNow[newSlot]||[]).filter(id => id !== rp.pid);
      dNow.cutiReplacements = dNow.cutiReplacements.filter(x => x !== rp);
      if(newSlot === 'M'){
        for(let d = day + 1; d <= sched.days; d++){
          sched.calendar[d-1].L1 = (sched.calendar[d-2].M || []).slice();
          sched.calendar[d-1].L2 = (sched.calendar[d-2].L1 || []).slice();
        }
      }
      for(let d = day; d <= Math.min(day + 2, sched.days); d++){
        sched.calendar[d-1].cells = buildDayCellsSnapshot(d, sched.calendar[d-1], month, year);
      }
      replMsg = ` · pengganti ${getPerson(rp.pid).name} dilepas`;
    }
  }

  // Hitung ulang total dinas bulanan per personel
  personnel.forEach(p => {
    sched.monthPS[p.id] = 0;
    sched.monthM[p.id] = 0;
  });
  sched.calendar.forEach(entry => {
    (entry.PS || []).forEach(id => { sched.monthPS[id] = (sched.monthPS[id] || 0) + 1; });
    (entry.M || []).forEach(id => { sched.monthM[id] = (sched.monthM[id] || 0) + 1; });
  });

  // Perbarui snapshot tampilan sel hari ini
  dEntry.cells = buildDayCellsSnapshot(day, dEntry, month, year);

  // Jalankan audit kepatuhan kaedah
  auditMonthSchedule(sched, year, month);

  // Simpan ke Supabase (jika bukan mode pratinjau)
  if(!isPreviewActive(year, month)){
    await persistSchedule(year, month, sched);
  } else {
    previewScheduleState.sched = sched;
  }

  closeModal();
  renderScheduleArea();
  updateNavBadges();
  if(document.getElementById('adminPage').style.display==='block') renderAdminPanel();
  toast(`Jadwal ${getPerson(pid).name} tanggal ${day} berhasil diperbarui` + replMsg + (isPreviewActive(year, month) ? ' (dalam mode pratinjau)' : '') + '.');
}

/* =====================================================================
   PENGAJUAN CEPAT CUTI & KUNING VIA POPUP (UNTUK PERSONEL)
   ===================================================================== */
let userRequestState = null;

function openUserRequestModal(day, pid){
  if(!isUserRole()){
    toast('Silakan masuk sebagai Personel di kanan atas.');
    return;
  }
  const myPid = currentPersonnelId();
  if(pid !== myPid){
    toast(`Anda hanya dapat mengajukan Cuti atau Kuning untuk akun Anda sendiri (${personnel[myPid].name}).`);
    return;
  }
  const freeze = freezeBoundaryForMonth(viewY, viewM);
  if(day <= freeze){
    toast(`Tanggal ${day} sudah berjalan (fix) dan tidak dapat diajukan.`);
    return;
  }

  const existingCuti = cutiList.find(c => c.personnelId === pid && c.year === viewY && c.month === viewM && day >= c.start && day <= c.end);
  const existingKuning = kuningList.find(k => k.personnelId === pid && k.year === viewY && k.month === viewM && day >= k.start && day <= k.end);

  let initialMode = 'CUTI';
  let initialReason = '';
  if(existingKuning){
    initialMode = 'KUNING';
    initialReason = existingKuning.reason || '';
  } else if(existingCuti){
    initialMode = 'CUTI';
    initialReason = existingCuti.reason || '';
  }

  userRequestState = {
    day,
    pid,
    year: viewY,
    month: viewM,
    selectedMode: initialMode,
    reason: initialReason,
    existingCuti,
    existingKuning
  };

  openModal('user_request');
}

function renderUserRequestPanel(area){
  if(!userRequestState) return;
  const { day, pid, year, month, selectedMode, reason, existingCuti, existingKuning } = userRequestState;
  const p = getPerson(pid);
  const dow = new Date(year, month - 1, day).getDay();
  const dayNamesFull = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const dayStr = `${dayNamesFull[dow]}, ${day} ${monthNames[month-1]} ${year}`;

  const sched = schedules[skey(year, month)];
  let currentShiftLabel = 'Libur / Belum ada jadwal';
  if(sched && sched.calendar && sched.calendar[day-1]){
    const dEntry = sched.calendar[day-1];
    if((dEntry.PS||[]).includes(pid)) currentShiftLabel = 'Pagi Siang (PS)';
    else if((dEntry.M||[]).includes(pid)) currentShiftLabel = 'Malam (M)';
    else if((dEntry.L1||[]).includes(pid)) currentShiftLabel = 'Libur-1 (L1)';
    else if((dEntry.L2||[]).includes(pid)) currentShiftLabel = 'Libur-2 (L2)';
    else currentShiftLabel = 'Libur / Antre';
  }

  // Quota Cuti
  const totalCuti = cutiBalanceForYear(pid, year);
  const usedCuti = cutiUsedInYear(pid, year);
  const sisaCuti = Math.max(0, totalCuti - usedCuti);

  // Quota Kuning
  const isKuningOpen = isKuningWindowOpen();
  const quotaKuning = effectiveKuningQuota(pid, year, month);
  const usedKuning = kuningUsedInMonth(pid, month, year);
  const sisaKuning = Math.max(0, quotaKuning - usedKuning);

  // Existing request banner
  let existingBanner = '';
  const existingItem = existingCuti || existingKuning;
  if(existingCuti){
    const isApp = existingCuti.status === 'approved';
    existingBanner = `
      <div style="background:#FDF2F1; border:1px solid #F5C6C2; border-radius:10px; padding:12px 14px; margin-bottom:14px; font-size:12.5px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
          <span style="font-weight:700; color:var(--red); font-size:13px;">🏖 Pengajuan Cuti Tanggal Ini</span>
          <span class="badge ${isApp?'approved':'pending'}">${isApp?'Disetujui':'Menunggu Admin'}</span>
        </div>
        <div style="color:var(--ink-soft); font-size:12px;">Alasan: <i>${esc(existingCuti.reason || 'Cuti tahunan')}</i></div>
      </div>
    `;
  } else if(existingKuning){
    const isApp = existingKuning.status === 'approved';
    existingBanner = `
      <div style="background:#FEF9E7; border:1px solid #FCE599; border-radius:10px; padding:12px 14px; margin-bottom:14px; font-size:12.5px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
          <span style="font-weight:700; color:#7D5A06; font-size:13px;">⭐ Pengajuan Kuning Tanggal Ini</span>
          <span class="badge ${isApp?'approved':'pending'}">${isApp?'Disetujui':'Menunggu Admin'}</span>
        </div>
        <div style="color:var(--ink-soft); font-size:12px;">Alasan: <i>${esc(existingKuning.reason || 'Keinginan libur')}</i></div>
      </div>
    `;
  }

  document.getElementById('mSub').textContent = `${p.name} · ${dayStr}`;

  area.innerHTML = `
    <div class="card" style="box-shadow:none; border:none; padding:4px;">
      <!-- Header Info -->
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid var(--line);">
        <div>
          <div style="font-size:15px; font-weight:700; color:var(--ink);">${esc(p.name)}</div>
          <div style="font-size:12.5px; color:var(--ink-soft);">${dayStr}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px; color:var(--ink-soft); text-transform:uppercase; font-weight:600;">Jadwal Tanggal Ini</div>
          <div style="font-family:var(--mono); font-weight:700; font-size:13px; color:var(--navy);">${currentShiftLabel}</div>
        </div>
      </div>

      ${existingBanner}

      <!-- Pilihan 2 Tombol: Cuti vs Kuning -->
      <div class="formrow" style="margin-bottom:12px;">
        <label style="font-weight:700; font-size:13px;">Pilih Jenis Pengajuan:</label>
        <div class="user-req-toggle">
          <button type="button" class="user-opt-btn opt-cuti ${selectedMode==='CUTI'?'active':''}" data-mode="CUTI">
            <span class="u-icon">🏖</span>
            <span class="u-title" style="color:var(--red);">Cuti Resmi (C)</span>
            <span class="u-sub">Potong cuti tahunan</span>
          </button>
          <button type="button" class="user-opt-btn opt-kuning ${selectedMode==='KUNING'?'active':''}" data-mode="KUNING">
            <span class="u-icon">⭐</span>
            <span class="u-title" style="color:#7D5A06;">Kuning (K)</span>
            <span class="u-sub">Keinginan libur</span>
          </button>
        </div>
      </div>

      <!-- Detail Box Cuti -->
      <div id="userCutiDetailBox" style="${selectedMode==='CUTI'?'':'display:none;'}">
        <div class="quotainfo" style="margin-bottom:12px; background:#F0FDF4; border:1px solid #BBF7D0; color:#14532D; border-radius:10px; padding:11px 13px;">
          Sisa cuti tahunan Anda (${year}): <b>${sisaCuti}</b> dari <b>${totalCuti}</b> hari${usedCuti>0?` (${usedCuti} hari terpakai/menunggu)`:''}.
          ${sisaCuti <= 0 ? '<div style="color:var(--red); font-weight:700; margin-top:4px;">⚠ Kuota cuti tahunan Anda telah habis.</div>' : ''}
        </div>
        <div class="formrow" style="margin-bottom:0;">
          <label style="font-size:12.5px; font-weight:600;">Alasan Cuti:</label>
          <input type="text" id="txtUserCutiReason" value="${esc(reason)}" placeholder="mis. Keperluan keluarga / acara penting / mudik">
        </div>
      </div>

      <!-- Detail Box Kuning -->
      <div id="userKuningDetailBox" style="${selectedMode==='KUNING'?'':'display:none;'}">
        ${!isKuningOpen ? `
          <div style="background:#FFF7ED; border:1px solid #FFEDD5; border-radius:10px; padding:10px 13px; font-size:12px; color:#9A3412; margin-bottom:10px; display:flex; gap:8px; align-items:flex-start;">
            <span style="font-size:16px; flex:none;">⏳</span>
            <div><b>Pengajuan Kuning Sedang Ditutup:</b> Pengajuan hanya dibuka tiap tanggal ${kuningWindow.start}–${kuningWindow.end} tiap bulan (dibuka lagi ${nextKuningOpenLabel()}).</div>
          </div>
        ` : ''}
        <div class="quotainfo" style="margin-bottom:12px; background:#FEF9E7; border:1px solid #FCE599; color:#7D5A06; border-radius:10px; padding:11px 13px;">
          Kuota kuning bulan ${monthNames[month-1]} ${year}: sisa <b>${sisaKuning}</b> dari <b>${quotaKuning}</b> hari${usedKuning>0?` (${usedKuning} hari terpakai/menunggu)`:''}.
          ${sisaKuning <= 0 ? '<div style="color:var(--red); font-weight:700; margin-top:4px;">⚠ Batas kuota kuning bulan ini telah tercapai.</div>' : ''}
        </div>
        <div class="formrow" style="margin-bottom:0;">
          <label style="font-size:12.5px; font-weight:600;">Alasan Kuning (Keinginan Libur):</label>
          <input type="text" id="txtUserKuningReason" value="${esc(reason)}" placeholder="mis. Keinginan libur tanggal ini">
        </div>
      </div>

      <!-- Tombol Aksi -->
      <div style="display:flex; flex-direction:column; gap:10px; margin-top:20px;">
        <button class="submit" id="btnSubmitUserReq" style="padding:14px; font-size:14px; font-weight:700; border-radius:10px; display:flex; align-items:center; justify-content:center; gap:8px;">
          ${selectedMode==='CUTI' ? '🏖 Kirim Pengajuan Cuti' : '⭐ Kirim Pengajuan Kuning'}
        </button>
        ${existingItem ? `
          <button type="button" id="btnCancelUserReq" style="padding:11px; font-size:13px; font-weight:600; color:var(--red); background:#FFF5F5; border:1px solid #FED7D7; border-radius:10px; cursor:pointer;">
            🗑 Batalkan Pengajuan Tanggal Ini
          </button>
        ` : ''}
        <button class="ghost" type="button" onclick="closeModal()" style="padding:10px; border-radius:10px;">Tutup</button>
      </div>
    </div>
  `;

  // Mode buttons
  area.querySelectorAll('.user-opt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      area.querySelectorAll('.user-opt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      userRequestState.selectedMode = btn.dataset.mode;

      const cutiBox = document.getElementById('userCutiDetailBox');
      const kuningBox = document.getElementById('userKuningDetailBox');
      const submitBtn = document.getElementById('btnSubmitUserReq');

      if(cutiBox) cutiBox.style.display = userRequestState.selectedMode === 'CUTI' ? 'block' : 'none';
      if(kuningBox) kuningBox.style.display = userRequestState.selectedMode === 'KUNING' ? 'block' : 'none';
      if(submitBtn){
        submitBtn.innerHTML = userRequestState.selectedMode === 'CUTI'
          ? '🏖 Kirim Pengajuan Cuti'
          : '⭐ Kirim Pengajuan Kuning';
      }
    });
  });

  // Reason inputs
  const txtCuti = document.getElementById('txtUserCutiReason');
  if(txtCuti){
    txtCuti.addEventListener('input', () => { userRequestState.reason = txtCuti.value; });
  }
  const txtKuning = document.getElementById('txtUserKuningReason');
  if(txtKuning){
    txtKuning.addEventListener('input', () => { userRequestState.reason = txtKuning.value; });
  }

  // Buttons
  const btnSubmit = document.getElementById('btnSubmitUserReq');
  if(btnSubmit) btnSubmit.addEventListener('click', submitUserRequest);

  const btnCancel = document.getElementById('btnCancelUserReq');
  if(btnCancel) btnCancel.addEventListener('click', cancelUserRequest);
}

async function submitUserRequest(){
  if(!userRequestState) return;
  const { day, pid, year, month, selectedMode, reason, existingCuti, existingKuning } = userRequestState;

  if(selectedMode === 'KUNING' && !isKuningWindowOpen()){
    alert(`Pengajuan kuning sedang ditutup. Pengajuan hanya dibuka tiap tanggal ${kuningWindow.start}–${kuningWindow.end} tiap bulan.`);
    return;
  }

  // Bersihkan request tipe lain jika beralih jenis
  if(selectedMode === 'CUTI' && existingKuning){
    const idx = kuningList.findIndex(k => k.id === existingKuning.id);
    if(idx >= 0){
      kuningList.splice(idx, 1);
      await dbDelete('kuning_requests', existingKuning.id);
    }
  } else if(selectedMode === 'KUNING' && existingCuti){
    const idx = cutiList.findIndex(c => c.id === existingCuti.id);
    if(idx >= 0){
      cutiList.splice(idx, 1);
      await dbDelete('cuti_requests', existingCuti.id);
    }
  }

  if(selectedMode === 'CUTI'){
    const balance = cutiBalanceForYear(pid, year);
    const used = cutiUsedInYear(pid, year);
    const remaining = balance - used;
    if(remaining <= 0 && !existingCuti){
      const ok = confirm(`Sisa cuti tahunan Anda tinggal ${remaining} hari. Apakah Anda tetap ingin mengajukan permohonan cuti ini?`);
      if(!ok) return;
    }

    if(existingCuti){
      existingCuti.reason = reason || 'Cuti tahunan';
      await dbUpdate('cuti_requests', existingCuti.id, { reason: existingCuti.reason });
      toast(`Pengajuan cuti tanggal ${day} berhasil diperbarui.`);
    } else {
      const row = {
        id: nextId++,
        personnelId: pid,
        start: day,
        end: day,
        reason: reason || 'Cuti tahunan',
        status: 'pending',
        month,
        year
      };
      cutiList.push(row);
      await dbInsert('cuti_requests', {
        id: row.id,
        personnel_id: pid,
        start_day: day,
        end_day: day,
        reason: row.reason,
        status: 'pending',
        month,
        year
      });
      toast(`Pengajuan cuti tanggal ${day} terkirim (menunggu persetujuan admin).`);
    }
  } else if(selectedMode === 'KUNING'){
    const quota = effectiveKuningQuota(pid, year, month);
    const used = kuningUsedInMonth(pid, month, year);
    const remaining = quota - used;
    if(remaining <= 0 && !existingKuning){
      const ok = confirm(`Kuota kuning Anda bulan ini sudah terpakai (${used}/${quota} hari). Apakah Anda tetap ingin mengajukan?`);
      if(!ok) return;
    }

    if(existingKuning){
      existingKuning.reason = reason || 'Keinginan libur';
      await dbUpdate('kuning_requests', existingKuning.id, { reason: existingKuning.reason });
      toast(`Pengajuan kuning tanggal ${day} berhasil diperbarui.`);
    } else {
      const row = {
        id: nextId++,
        personnelId: pid,
        start: day,
        end: day,
        reason: reason || 'Keinginan libur',
        status: 'pending',
        month,
        year
      };
      kuningList.push(row);
      await dbInsert('kuning_requests', {
        id: row.id,
        personnel_id: pid,
        start_day: day,
        end_day: day,
        reason: row.reason,
        status: 'pending',
        month,
        year
      });
      toast(`Pengajuan kuning tanggal ${day} terkirim (menunggu persetujuan admin).`);
    }
  }

  closeModal();
  renderScheduleArea();
  updateNavBadges();
}

async function cancelUserRequest(){
  if(!userRequestState) return;
  const { day, existingCuti, existingKuning } = userRequestState;
  const target = existingCuti || existingKuning;
  if(!target) return;

  const kindLabel = existingCuti ? 'Cuti' : 'Kuning';
  if(target.status === 'approved'){
    const ok = confirm(`Pengajuan ini sudah DISETUJUI oleh Admin. Apakah Anda yakin ingin membatalkannya?`);
    if(!ok) return;
  } else {
    const ok = confirm(`Batalkan pengajuan ${kindLabel} untuk tanggal ${day}?`);
    if(!ok) return;
  }

  if(existingCuti){
    const idx = cutiList.findIndex(c => c.id === existingCuti.id);
    if(idx >= 0){
      cutiList.splice(idx, 1);
      await dbDelete('cuti_requests', existingCuti.id);
    }
  } else if(existingKuning){
    const idx = kuningList.findIndex(k => k.id === existingKuning.id);
    if(idx >= 0){
      kuningList.splice(idx, 1);
      await dbDelete('kuning_requests', existingKuning.id);
    }
  }

  toast(`Pengajuan ${kindLabel} tanggal ${day} berhasil dibatalkan.`);
  closeModal();
  renderScheduleArea();
  updateNavBadges();
}

/* =====================================================================
   RENDER JADWAL
   ===================================================================== */
function cellInfo(day, personnelId, result, month, year){
  const freezeBoundary = freezeBoundaryForMonth(year, month);
  const d = result && result.calendar && result.calendar[day-1];
  if(!d) return {cls:'slot-off', label:'–', title:'-'};

  // 1. Rekonstruksi cutiReplacements otomatis jika belum ada (misal jadwal dari Supabase lama):
  if(!d.cutiReplacements && result && result.logs){
    d.cutiReplacements = [];
    const prefix = `Tgl ${day}:`;
    result.logs.forEach(l => {
      if(l.text && l.text.startsWith(prefix) && l.text.includes('mengisi') && l.text.includes('pengganti')){
        const m = l.text.match(/^Tgl\s+\d+:\s+(.+?)\s+mengisi\s+(PS|M)\s+\(pengganti(?:\s+(cuti|kuning))?(?:\s+([^,\)]+))?/i);
        if(m){
          const pName = m[1].trim();
          const slot = m[2];
          const replKind = (m[3] && m[3].toLowerCase()==='kuning') ? 'kuning' : 'cuti';
          const pObj = personnel.find(p => p.name.trim().toLowerCase() === pName.toLowerCase());
          if(pObj){
            let replacedId = undefined;
            if(m[4]){
              const rObj = personnel.find(p => p.name.trim().toLowerCase() === m[4].trim().toLowerCase());
              if(rObj) replacedId = rObj.id;
            }
            if(replacedId === undefined){
              const onLeaveColleague = personnel.find(p => onLeave(p.id, day, month, year, cutiList.filter(c => c.status === 'approved')));
              if(onLeaveColleague) replacedId = onLeaveColleague.id;
            }
            d.cutiReplacements.push({ pid: pObj.id, slot, replacedId, type: replKind });
          }
        }
      }
    });
  }

  // 2. Cek apakah personel adalah pengganti cuti/kuning
  const isPS = (d.PS || []).includes(personnelId);
  const isM = (d.M || []).includes(personnelId);
  const currentSlot = isPS ? 'PS' : (isM ? 'M' : null);
  const cutiReplItem = d.cutiReplacements && d.cutiReplacements.find(r => r.pid === personnelId && (!r.slot || r.slot === currentSlot));
  const isCutiRepl = Boolean(cutiReplItem);

  return computeCell(day, personnelId, d, month, year);
}
function selectionEnd(year, month, days){
  const rt = realToday();
  if(year<rt.y || (year===rt.y && month<rt.m)) return days;
  if(year===rt.y && month===rt.m) return Math.min(rt.d, days);
  return 0;
}
function buildScheduleBlockHtml(year, month){
  const verInfo = getScheduleVersionInfo(year, month);
  const verBadgeHtml = verInfo ? `
    <div style="margin-top:5px;">
      <span class="sched-ver-badge ${verInfo.isDraft ? 'draft' : ''}" title="${esc(verInfo.title)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        Versi: ${verInfo.version} ${verInfo.swapCount > 0 ? `· ${verInfo.swapCount} Tukar Dinas` : ''}
      </span>
    </div>` : '';

  const uAvail = canUndo(year, month);
  const _h = uAvail ? getHistory(year, month) : null;
  const _last = _h && _h.undo.length ? _h.undo[_h.undo.length-1] : null;
  const _nm = _last ? String(_last.actionName||'perubahan') : '';
  const _short = _nm.length > 30 ? _nm.slice(0,29)+'…' : _nm;
  const adminUndoNotice = uAvail ? ` <span style="display:inline-flex; align-items:center; gap:6px;"><button type="button" class="small ghost" title="${esc('Batalkan 1 langkah terakhir: '+_nm+(_h.undo.length>1?' ('+_h.undo.length+' langkah tersedia)':''))}" onclick="undoSchedule(${year}, ${month})" style="background:#fff; border-color:#0C2B47; color:#0C2B47; font-weight:700; padding:2px 8px; font-size:11px; cursor:pointer;">↶ Undo: <span style="font-weight:500;">${esc(_short)}</span></button></span>` : '';
  const adminTip = isAdmin() ? `
    <div class="admin-tip-row" style="background:#EBF2F7; border:1px solid #C8D9E6; border-radius:8px; padding:9px 14px; font-size:12px; color:var(--navy); display:flex; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="flex:none;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <b>Mode Admin</b>
      ${adminUndoNotice}
    </div>` : '';
  const myPid = currentPersonnelId();
  const userTip = (!isAdmin() && isUserRole() && myPid !== null) ? `
    <div style="background:#EBF7EE; border:1px solid #B8E4C4; border-radius:8px; padding:9px 14px; font-size:12px; color:#14532D; display:flex; align-items:center; gap:8px; margin-bottom:12px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="flex:none;"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
      <span><b>Halo, ${esc(personnel[myPid].name)}:</b> Anda dapat mengetuk / mengklik tanggal pada baris jadwal Anda untuk mengajukan <b>Cuti (C)</b> atau <b>Kuning (K)</b> secara cepat.</span>
    </div>` : '';
  const guestTip = (!isAdmin() && !isUserRole()) ? `
    <div style="background:#F4F6F8; border:1px solid #D5DCE2; border-radius:8px; padding:9px 14px; font-size:12px; color:var(--ink-soft); display:flex; align-items:center; gap:8px; margin-bottom:12px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="flex:none;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <span>Masuk sebagai <b>Personel</b> (di kanan atas) untuk mengajukan <b>Cuti</b> atau <b>Kuning</b> langsung dengan mengetuk tanggal pada kalender.</span>
    </div>` : '';

  return `<div class="sched-block">
    <div class="sched-title">
      <div class="t1">JADWAL DINAS SHIFT</div>
      <div class="t2">DIREKTORAT DATA DAN KOMPUTASI</div>
      <div class="t3">${monthNames[month-1]} ${year}</div>
      ${verBadgeHtml}
    </div>
    ${adminTip}
    ${userTip}
    ${guestTip}
    <div class="calwrap" id="calWrap"></div>
    <div class="legend">
      <span><i style="background:#EDF6F6;border:1px solid #0E5C6E"></i> PS</span>
      <span><i style="background:#F4F1FA;border:1px solid #433878"></i> M</span>
      <span><i style="background:#fff;border:1px solid var(--line)"></i> Libur/antre</span>
      <span><i style="background:#AAB8C6;border:1px solid #475569"></i> Sabtu / Minggu (abu-abu)</span>
      <span><i style="background:var(--red)"></i> Cuti</span>
      <span><i style="background:#FDF2F1;border:1.5px dashed var(--red)"></i> Cuti (menunggu admin)</span>
      <span><i style="background:var(--kuning)"></i> Kuning</span>
      <span><i style="background:#FEF9E7;border:1.5px dashed #C8990A"></i> Kuning (menunggu admin)</span>
      <span><i style="background:#fff;border:2px solid var(--indigo)"></i> Terkunci admin</span>
      <span><i style="background:#D7ECEA;border:1px solid #0F6B5C"></i> Ditukar (digantikan)</span>
      <span><i style="background:#fff;border:2px dashed var(--green)"></i> Pengganti (tukar dinas)</span>
      <span><i style="background:#fff;border:2.5px dashed var(--red);position:relative;display:inline-block;"><span style="position:absolute;top:1px;right:1px;width:4px;height:4px;background:var(--red);border-radius:50%;display:block;"></span></i> Pengganti (karena cuti)</span>
      <span><i style="background:rgba(31,95,191,.25);border:2px solid var(--blue)"></i> Tanggal 1 s/d hari ini (fix &amp; terkunci permanen)</span>
    </div>
    ${isAdmin() ? `
      <div style="margin-top:16px;">
        <div style="font-size:12px; font-weight:700; color:var(--navy); margin-bottom:6px; display:flex; align-items:center; gap:6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>Log Audit Kaedah Rotasi &amp; Catatan Penyesuaian Jadwal (Khusus Admin):</span>
        </div>
        <div class="log" id="logBox"></div>
      </div>
    ` : ''}
  </div>`;
}
function fillScheduleBlock(year, month, result){
  const rt = realToday();
  const selTo = selectionEnd(year, month, result.days);
  const isTodayCol = d => year===rt.y && month===rt.m && d===rt.d;
  const dayNamesShort = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const myPid = currentPersonnelId();
  let head = `<tr><th></th><th>Nama</th>`;
  for(let d=1; d<=result.days; d++){
    const dow = new Date(year, month - 1, d).getDay();
    const isWknd = (dow === 0 || dow === 6);
    let cls = isWknd ? 'weekend' : '';
    if(d<=selTo){ cls += (cls?' ':'') + 'sel' + (d===1?' sel-l':'') + (d===selTo?' sel-r':'') + (isTodayCol(d)?' today':''); }
    head += `<th class="${cls}"><div>${d}</div><div style="font-size:9px;font-weight:500;opacity:.85;letter-spacing:0;margin-top:2px;">${dayNamesShort[dow]}</div></th>`;
  }
  head += `<th class="total">PS</th><th class="total">M</th><th class="total">Total</th></tr>`;
  let body = personnel.map((p,idx)=>{
    let cells='';
    for(let d=1; d<=result.days; d++){
      const info = cellInfo(d, idx, result, month, year);
      const dow = new Date(year, month - 1, d).getDay();
      const isWknd = (dow === 0 || dow === 6);
      let sel = '';
      if(d<=selTo){ sel = ' sel' + (d===1?' sel-l':'') + (d===selTo?' sel-r':'') + (idx===personnel.length-1?' sel-b':''); }
      const wkndCls = isWknd ? ' weekend' : '';
      cells += `<td class="${info.cls}${sel}${wkndCls}" title="${info.title}" data-day="${d}" data-pid="${p.id}">${info.label}</td>`;
    }
    const isMe = (myPid === p.id);
    const rowCls = isMe ? ' class="my-user-row"' : '';
    const nameLabel = isMe ? `${esc(p.name)} <span class="badge" style="background:#137333;color:#fff;font-size:9px;padding:2px 6px;margin-left:4px;vertical-align:middle;">Anda</span>` : esc(p.name);
    return `<tr${rowCls}><th class="no">${idx+1}</th><th class="nama">${nameLabel}</th>${cells}
      <td class="total">${result.monthPS[idx]}</td><td class="total">${result.monthM[idx]}</td>
      <td class="total">${result.monthPS[idx]+result.monthM[idx]}</td></tr>`;
  }).join('');
  document.getElementById('calWrap').innerHTML = `<table class="cal"><thead>${head}</thead><tbody>${body}</tbody></table>`;

  const calEl = document.getElementById('calWrap');
  const freeze = freezeBoundaryForMonth(year, month);

  if(isAdmin()){
    const tbl = calEl.querySelector('table.cal');
    if(tbl) tbl.classList.add('admin-mode');
    calEl.querySelectorAll('td[data-day]').forEach(td => {
      const d = parseInt(td.dataset.day);
      const pid = parseInt(td.dataset.pid);
      if(d > freeze){
        td.classList.add('cell-clickable');
        td.title = (td.title ? td.title + ' · ' : '') + 'Klik untuk edit manual (Admin)';
        td.addEventListener('click', () => openManualEditModal(d, pid));
      }
    });
  } else if(isUserRole() && myPid !== null){
    calEl.querySelector('table.cal').classList.add('user-mode');
    calEl.querySelectorAll('td[data-day]').forEach(td => {
      const d = parseInt(td.dataset.day);
      const pid = parseInt(td.dataset.pid);
      if(pid === myPid){
        if(d > freeze){
          td.classList.add('cell-clickable', 'user-cell-clickable');
          td.title = (td.title ? td.title + ' · ' : '') + 'Klik / Ketuk untuk ajukan Cuti atau Kuning';
          td.addEventListener('click', () => openUserRequestModal(d, myPid));
        }
      } else {
        td.addEventListener('click', () => {
          toast(`Ini baris ${personnel[pid].name}. Anda hanya dapat mengajukan Cuti atau Kuning untuk akun Anda sendiri (${personnel[myPid].name}).`);
        });
      }
    });
  } else {
    // Pengunjung belum login
    calEl.querySelectorAll('td[data-day]').forEach(td => {
      td.addEventListener('click', () => {
        toast('Silakan masuk sebagai Personel di kanan atas untuk mengajukan Cuti atau Kuning.');
      });
    });
  }

  const logEl = document.getElementById('logBox');
  if(logEl){
    if(isAdmin()){
      const problems = result.logs.filter(l=>l.type!=='ok');
      const hasBad = problems.some(l=>l.type==='bad');
      logEl.innerHTML = (hasBad ? '' : `<div class="ok">Tidak ada konflik. Semua slot PS/M (2+2 tiap hari) terisi.</div>`)
        + problems.map(l=>`<div class="${l.type}">${l.type==='bad'?'✕':'→'} ${l.text}</div>`).join('');
    } else {
      logEl.innerHTML = '';
      logEl.style.display = 'none';
    }
  }
}
function renderScheduleArea(){
  const area = document.getElementById('scheduleArea');
  const res = schedules[skey(viewY, viewM)];
  if(!res){
    const label = `${monthNames[viewM-1]} ${viewY}`;
    if(isAdmin()){
      const pv = prevMonthYear(viewY, viewM);
      const hasPrev = !!schedules[skey(pv.y, pv.m)];
      area.innerHTML = `<div class="empty-note">
        Jadwal <b>${label}</b> belum dibuat.<br>
        ${hasPrev
          ? `Rotasi akan disambung dari akhir ${monthNames[pv.m-1]} ${pv.y}.`
          : `${monthNames[pv.m-1]} ${pv.y} belum digenerate, jadi rotasi dimulai dari urutan antrian awal.`}
        <div style="margin-top:16px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <button class="generate" id="btnEmptyAutoGenerate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
            Generate jadwal otomatis
          </button>
          <button class="ghost" id="btnEmptyManualBlank" style="border-color:var(--navy); color:var(--navy); font-weight:600;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            Buat jadwal manual (mulai kosong)
          </button>
        </div>
      </div>`;
      const btnAuto = document.getElementById('btnEmptyAutoGenerate');
      if(btnAuto) btnAuto.addEventListener('click', () => document.getElementById('btnGenerate').click());
      const btnBlank = document.getElementById('btnEmptyManualBlank');
      if(btnBlank) btnBlank.addEventListener('click', () => createBlankSchedule(viewY, viewM));
    } else {
      area.innerHTML = `<div class="empty-note">Jadwal <b>${label}</b> belum tersedia.<br>Admin belum membuat jadwal untuk bulan ini.</div>`;
    }
    return;
  }

  let previewBannerHtml = '';
  if(isAdmin() && isPreviewActive(viewY, viewM)){
    previewBannerHtml = `
      <div class="preview-banner">
        <div class="preview-banner-text">
          <div class="p-icon">📌</div>
          <div>
            <b>Mode Pratinjau (Draft) Jadwal ${monthNames[viewM-1]} ${viewY}</b>
            <span>Jadwal baru selesai digenerate dan <b>belum disimpan permanen</b> ke database. Anda dapat meneliti rotasi, atau mengklik sel tanggal untuk penyesuaian manual terlebih dahulu.</span>
          </div>
        </div>
        <div class="preview-banner-actions">
          <button type="button" class="btn-commit" onclick="commitSchedulePreview(${viewY}, ${viewM})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg>
            Simpan &amp; Publikasikan (Submit)
          </button>
          <button type="button" class="btn-discard" onclick="cancelSchedulePreview(${viewY}, ${viewM})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Batalkan Pratinjau
          </button>
        </div>
      </div>`;
  }

  area.innerHTML = previewBannerHtml + buildScheduleBlockHtml(viewY, viewM);
  fillScheduleBlock(viewY, viewM, res);
}
function renderMonthTabs(){
  document.getElementById('yearLabel').textContent = viewY;
  const box = document.getElementById('monthTabs');
  box.innerHTML = monthNames.map((n,i)=>{
    const m = i+1;
    const has = !!schedules[skey(viewY, m)];
    return `<button class="mtab ${m===viewM?'active':''}" role="tab" aria-selected="${m===viewM}" data-m="${m}">${n}${has?'<span class="dot" title="Jadwal sudah dibuat"></span>':''}</button>`;
  }).join('');
  box.querySelectorAll('.mtab').forEach(b=> b.addEventListener('click', ()=>{ viewM = parseInt(b.dataset.m); renderAll(); }));
  const act = box.querySelector('.mtab.active');
  if(act && act.scrollIntoView) act.scrollIntoView({inline:'center', block:'nearest'});
}
selYear.addEventListener('change', ()=>{ viewY = parseInt(selYear.value); renderAll(); });

/* =====================================================================
   PANEL ADMIN
   ===================================================================== */
function showAdminPage(){
  if(!isAdmin()){ toast('Hanya admin yang bisa membuka panel ini'); return; }
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('adminPage').style.display = 'block';
  document.body.style.overflow = '';
  adminTab = 'setup';
  document.querySelectorAll('.admin-tab').forEach(t=> t.classList.toggle('active', t.dataset.atab==='setup'));
  renderAdminPanel();
  window.scrollTo(0,0);
}
function hideAdminPage(){
  document.getElementById('adminPage').style.display = 'none';
  document.getElementById('appRoot').style.display = 'block';
  renderAll();
}
document.getElementById('btnOpenAdmin').addEventListener('click', showAdminPage);
document.getElementById('btnBackFromAdmin').addEventListener('click', hideAdminPage);
document.getElementById('adminUserChipBtn').addEventListener('click', ()=>{
  if(confirm('Logout dari akun admin?')) logout();
});
document.getElementById('btnAdminPrint').addEventListener('click', ()=>{
  adminTab = 'print';
  document.querySelectorAll('.admin-tab').forEach(t=> t.classList.toggle('active', t.dataset.atab==='print'));
  renderAdminPanel();
});
document.querySelectorAll('.admin-tab').forEach(t=>{
  t.addEventListener('click', ()=>{
    adminTab = t.dataset.atab;
    document.querySelectorAll('.admin-tab').forEach(x=> x.classList.toggle('active', x===t));
    renderAdminPanel();
  });
});

function adminPanelHead(iconSvg, title, sub){
  return `<div class="admin-panel-head">
    <div class="ph-icon">${iconSvg}</div>
    <div class="ph-text">
      <h3>${title}</h3>
      <p>${sub}</p>
    </div>
  </div>`;
}

function renderAdminPanel(){
  const body = document.getElementById('adminPanelBody');
  if(!body) return;

  const p = pendingCounts();
  document.getElementById('cntCuti').textContent = p.cuti;
  document.getElementById('cntKuning').textContent = p.kuning;
  document.getElementById('cntSwap').textContent = p.swap;
  document.getElementById('cntCuti').classList.toggle('zero', p.cuti===0);
  document.getElementById('cntKuning').classList.toggle('zero', p.kuning===0);
  document.getElementById('cntSwap').classList.toggle('zero', p.swap===0);

  const btnReset = document.getElementById('btnAdminReset');
  if(btnReset){
    const hasSched = !!schedules[skey(viewY, viewM)];
    btnReset.style.display = hasSched ? 'inline-flex' : 'none';
  }

  renderAdminNotifBanner();

  if(adminTab==='setup')        renderAdminSetup(body);
  else if(adminTab==='kuningwindow') renderAdminKuningWindow(body);
  else if(adminTab==='cuti')    renderAdminCuti(body);
  else if(adminTab==='kuning')  renderAdminKuning(body);
  else if(adminTab==='swap')    renderAdminSwap(body);
  else if(adminTab==='lock')    renderAdminLock(body);
  else if(adminTab==='print')   renderAdminPrint(body);
}

function renderAdminNotifBanner(){
  const box = document.getElementById('adminNotifBanner');
  if(!box) return;
  const p = pendingCounts();
  const total = p.cuti + p.kuning + p.swap;
  if(total===0){ box.innerHTML = ''; return; }
  const parts = [];
  if(p.cuti)   parts.push(`<button class="ghost" onclick="gotoAdminTab('cuti')">${p.cuti} cuti</button>`);
  if(p.kuning) parts.push(`<button class="ghost" onclick="gotoAdminTab('kuning')">${p.kuning} kuning</button>`);
  if(p.swap)   parts.push(`<button class="ghost" onclick="gotoAdminTab('swap')">${p.swap} tukar dinas</button>`);
  box.innerHTML = `<div class="admin-notif">
    <div class="ni-icon">${ICON.bell}</div>
    <div class="ni-text">
      <b>Ada ${total} pengajuan menunggu persetujuan Anda</b>
      <span>Klik salah satu tombol untuk langsung ke halaman persetujuan.</span>
    </div>
    <div class="ni-actions">
      ${parts.join('')}
      <button onclick="gotoAdminTab('cuti')" style="background:#7A4E0D;">Proses sekarang</button>
    </div>
  </div>`;
}
function gotoAdminTab(tab){
  adminTab = tab;
  document.querySelectorAll('.admin-tab').forEach(t=> t.classList.toggle('active', t.dataset.atab===tab));
  renderAdminPanel();
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ================= TAB: URUTAN ANTRIAN ================= */
function renderAdminSetup(body){
  body.innerHTML = `
    ${adminPanelHead(ICON.users, 'Urutan antrian & kuota personel',
      'Atur nomor urut, kuota kuning basis, dan sisa cuti tahunan. Perubahan berlaku setelah jadwal digenerate ulang.')}
    <div class="admin-panel-body">
      <div class="admin-grid">
        <div class="admin-col">
          <div class="admin-card soft">
            <div class="admin-card-title"><span class="num">i</span> Catatan aturan</div>
            <div class="note" style="margin:0">
              <b>Urutan Awal</b>: Nomor 1 &amp; 2 jadi PS pertama, nomor 3 &amp; 4 jadi M pertama di tanggal 1. Bulan berikutnya menyambung otomatis dengan profil beban dinas dan istirahat 7 hari terakhir.<br><br>
              <b>Distribusi Adil (12–13 Hari)</b>: Total slot bulanan (hari &times; 4) dibagi rata. Personel bergantian mendapatkan 12 atau 13 hari kerja (yang bulan lalu bertugas lebih sedikit akan diprioritaskan mendapat 13 hari di bulan berikutnya).<br><br>
              <b>Hibahan Cuti Panjang &amp; Batas Keras 14 Hari</b>: Personel yang cuti panjang target dinasnya dipotong secara proporsional. Selisih slot dihibahkan ke personel aktif yang beban dinasnya paling sedikit, dengan <b>batas keras maksimal 14 hari kerja</b> (tidak akan melebihi 14 hari).<br><br>
              <b>Cuti Dadakan &amp; Kunci Permanen</b>: Tanggal 1 s/d hari ini fix 100% dan terkunci permanen. Cuti dadakan disimulasikan terlebih dahulu dengan menjaga ketat aturan istirahat wajib setelah dinas malam (M &rarr; Libur-1 &rarr; Libur-2).<br><br>
              <b>Sisa cuti</b> dihitung per tahun kalender.
            </div>
          </div>
        </div>
        <div class="admin-col">
          <div class="admin-card" style="padding:0;">
            <div class="admin-card-title" style="padding:18px 18px 0; margin-bottom:12px;">
              <span class="num">${personnel.length}</span> Data personel
              <span class="sub">Urutan &amp; kuota</span>
            </div>
            <div class="tablewrap">
              <table class="setup" id="tblPersonel"></table>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  const tbl = document.getElementById('tblPersonel');
  tbl.innerHTML = `<thead><tr>
      <th style="width:34px">#</th>
      <th>Nama</th>
      <th style="width:100px">Urutan</th>
      <th style="width:120px">Kuota kuning</th>
      <th style="width:120px">Maks hari/bln</th>
      <th style="width:110px">Sisa cuti ${viewY}</th>
    </tr></thead><tbody>` +
    personnel.map(p=>`<tr>
      <td style="color:var(--ink-soft); font-family:var(--mono);">${p.id+1}</td>
      <td>${p.name}</td>
      <td><input type="number" min="1" max="${personnel.length}" value="${p.rank}" onchange="personnel[${p.id}].rank=parseInt(this.value)||${p.rank}; persistPersonnelField(${p.id},'rank',personnel[${p.id}].rank);"></td>
      <td><input type="number" min="0" max="31" value="${p.kuningQuota}" onchange="personnel[${p.id}].kuningQuota=parseInt(this.value)||0; persistPersonnelField(${p.id},'kuningQuota',personnel[${p.id}].kuningQuota);"></td>
      <td><input type="number" min="1" max="31" value="${p.maxQuota}" onchange="personnel[${p.id}].maxQuota=parseInt(this.value)||14; persistPersonnelField(${p.id},'maxQuota',personnel[${p.id}].maxQuota);"></td>
      <td><input type="number" min="0" max="60" value="${Math.max(cutiBalanceForYear(p.id, viewY) - cutiUsedInYear(p.id, viewY), 0)}" title="Jatah ${cutiBalanceForYear(p.id, viewY)} hari − terpakai/menunggu ${cutiUsedInYear(p.id, viewY)} hari" onchange="setCutiBalance(${p.id}, ${viewY}, (parseInt(this.value)||0) + cutiUsedInYear(${p.id}, ${viewY})); refreshAdminOrModal();"></td>
    </tr>`).join('') + `</tbody>`;
}

/* ================= TAB: JADWAL PROSES KUNING ================= */
function renderAdminKuningWindow(body){
  const open = isKuningWindowOpen();
  body.innerHTML = `
    ${adminPanelHead(ICON.clock, 'Jadwal proses pengajuan kuning',
      'Atur kapan personel boleh mengajukan kuning. Di luar rentang ini, menu "Ajukan kuning" untuk personel otomatis terkunci.')}
    <div class="admin-panel-body">
      <div class="admin-grid equal">
        <div class="admin-col">
          <div class="admin-card">
            <div class="admin-card-title"><span class="num">1</span> Jendela pengajuan</div>
            <div class="admin-info">${ICON.info}<div>Tanggal di bawah dihitung berdasarkan <b>tanggal hari ini</b> (${realToday().d} ${monthNames[realToday().m-1]}), bukan bulan yang sedang dibuka di kalender.</div></div>
            <div class="field-row">
              <div class="formrow"><label>Dibuka tanggal</label><input type="number" min="1" max="31" value="${kuningWindow.start}" onchange="kuningWindow.start=parseInt(this.value)||1; renderAdminPanel(); updateNavBadges(); persistSettings();"></div>
              <div class="formrow"><label>Ditutup tanggal</label><input type="number" min="1" max="31" value="${kuningWindow.end}" onchange="kuningWindow.end=parseInt(this.value)||1; renderAdminPanel(); updateNavBadges(); persistSettings();"></div>
            </div>
            <div class="note" style="margin-top:4px">Kalau rentang melewati akhir bulan (mis. buka tgl 28, tutup tgl 5), sistem otomatis memperlakukan rentang membungkus bulan.</div>
          </div>
        </div>
        <div class="admin-col">
          <div class="admin-card">
            <div class="admin-card-title"><span class="num">2</span> Catatan proses (tidak mengunci)</div>
            <div class="field-row">
              <div class="formrow"><label>Draft dicetak ke atasan</label><input type="number" min="1" max="31" value="${kuningWindow.draftDay}" onchange="kuningWindow.draftDay=parseInt(this.value)||1; persistSettings();"></div>
              <div class="formrow"><label>Jadwal diedarkan tgl</label><input type="number" min="1" max="31" value="${kuningWindow.distributeDay}" onchange="kuningWindow.distributeDay=parseInt(this.value)||1; persistSettings();"></div>
            </div>
            <div class="note" style="margin-top:4px">Tanggal draft &amp; edar hanya sebagai pengingat jadwal kerja, tidak mengunci fitur apa pun.</div>
          </div>

          <div class="admin-card soft">
            <div class="admin-card-title"><span class="num">!</span> Status saat ini</div>
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:${open?'var(--green-pale)':'var(--amber-pale)'};color:${open?'var(--green)':'#7A4E0D'};">
                ${open ? ICON.check : ICON.lock}
              </div>
              <div>
                <div style="font-weight:700; font-size:14px; color:${open?'var(--green)':'#7A4E0D'};">${open?'Pengajuan kuning DIBUKA':'Pengajuan kuning DITUTUP'}</div>
                <div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">${open ? 'Personel bisa mengajukan kuning sekarang.' : `Personel tidak bisa mengajukan. Dibuka lagi ${nextKuningOpenLabel()}.`}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

/* ================= TAB: PERSETUJUAN CUTI ================= */
function renderAdminCuti(body){
  const pending = cutiList.filter(c=>c.status==='pending');
  const approved = cutiList.filter(c=>c.status==='approved');
  const rejected = cutiList.filter(c=>c.status==='rejected');
  const totalHari = approved.reduce((s,c)=> s + (c.end-c.start+1), 0);
  const pendingCount = pending.length;
  const batchBtn = pendingCount > 1
    ? `<div style="margin-bottom:12px;"><button class="submit" style="background:var(--teal);padding:8px 14px;font-size:12px;border-radius:6px;cursor:pointer;color:#fff;border:none;width:100%;" onclick="approveTogether('cuti', [${pending.map(p=>p.id).join(',')}])">⚡ Setujui Semua (${pendingCount} Pengajuan Cuti) Sekaligus</button></div>`
    : '';

  body.innerHTML = `
    ${adminPanelHead(ICON.cuti, 'Persetujuan cuti',
      'Setujui atau tolak pengajuan cuti. Perubahan otomatis memperbarui jadwal bulan terkait dan bulan sesudahnya.')}
    <div class="admin-panel-body">
      <div class="admin-stats">
        <div class="admin-stat warn"><div class="lbl">Menunggu</div><div class="val">${pending.length}</div></div>
        <div class="admin-stat ok"><div class="lbl">Disetujui</div><div class="val">${approved.length}</div></div>
        <div class="admin-stat bad"><div class="lbl">Ditolak</div><div class="val">${rejected.length}</div></div>
        <div class="admin-stat"><div class="lbl">Total hari (acc)</div><div class="val">${totalHari}</div></div>
      </div>

      <div class="admin-grid">
        <div class="admin-col">
          <div class="admin-card">
            <div class="admin-card-title"><span class="num">1</span> Tambah cuti (langsung disetujui)</div>
            <div id="adminCutiForm"></div>
          </div>
        </div>
        <div class="admin-col">
          <div class="admin-card">
            <div class="admin-card-title"><span class="num">2</span> Daftar pengajuan
              <span class="sub">${cutiList.length} total</span>
            </div>
            ${batchBtn}
            <div class="reqlist" id="adminCutiList"></div>
          </div>
        </div>
      </div>
    </div>`;

  renderRequestPanel(document.getElementById('adminCutiForm'), 'cuti', 'admin');
  const rt = realToday();
  const list = cutiList.slice().sort((a,b)=> b.id - a.id);
  document.getElementById('adminCutiList').innerHTML = list.length ? list.map(item=>{
    const p = getPerson(item.personnelId);
    let actions = '';
    const isPastOrActive = (item.year < rt.y) || (item.year === rt.y && item.month < rt.m) || (item.year === rt.y && item.month === rt.m && (item.end || item.start) <= rt.d);
    if(item.status==='pending'){
      actions = `<div class="actions">
        <button class="small ok-btn" onclick="setStatus('cuti',${item.id},'approved')">Setuju</button>
        <button class="small reject-btn" onclick="setStatus('cuti',${item.id},'rejected')">Tolak</button>
      </div>`;
    } else {
      const btnOrBadge = (item.status==='approved' && isPastOrActive)
        ? `<span class="badge" style="background:#5A6B7E;color:#fff;">Fix (Aktif/Lewat)</span>`
        : `<button class="x" onclick="removeReq('cuti',${item.id})" aria-label="Hapus">×</button>`;
      actions = `<div class="actions">
        <span class="badge ${item.status}">${item.status==='approved'?'Disetujui':'Ditolak'}</span>
        ${btnOrBadge}
      </div>`;
    }
    return `<div class="reqrow ${item.status}">
      <span><span class="who">${esc(p.name)}</span><span class="meta">${fmtRange(item)} · ${monthTag(item.month,item.year)}${item.reason?' · '+esc(item.reason):''}</span></span>
      ${actions}
    </div>`;
  }).join('') : `<div class="admin-empty">Belum ada pengajuan cuti.<br><b>Kotak masuk kosong.</b></div>`;
}

/* ================= TAB: PERSETUJUAN KUNING ================= */
function renderAdminKuning(body){
  const pending = kuningList.filter(c=>c.status==='pending');
  const approved = kuningList.filter(c=>c.status==='approved');
  const rejected = kuningList.filter(c=>c.status==='rejected');
  const totalHari = approved.reduce((s,c)=> s + (c.end-c.start+1), 0);
  const open = isKuningWindowOpen();
  const pendingCount = pending.length;
  const batchBtn = pendingCount > 1
    ? `<div style="margin-bottom:12px;"><button class="submit" style="background:var(--teal);padding:8px 14px;font-size:12px;border-radius:6px;cursor:pointer;color:#fff;border:none;width:100%;" onclick="approveTogether('kuning', [${pending.map(p=>p.id).join(',')}])">⚡ Setujui Semua (${pendingCount} Pengajuan Kuning) Sekaligus</button></div>`
    : '';

  body.innerHTML = `
    ${adminPanelHead(ICON.kuning, 'Persetujuan kuning',
      'Kelola pengajuan kuning personel. Admin tetap bisa menambahkan kuning meskipun di luar jendela pengajuan.')}
    <div class="admin-panel-body">
      <div class="admin-stats">
        <div class="admin-stat warn"><div class="lbl">Menunggu</div><div class="val">${pending.length}</div></div>
        <div class="admin-stat ok"><div class="lbl">Disetujui</div><div class="val">${approved.length}</div></div>
        <div class="admin-stat bad"><div class="lbl">Ditolak</div><div class="val">${rejected.length}</div></div>
        <div class="admin-stat"><div class="lbl">Total hari (acc)</div><div class="val">${totalHari}</div></div>
      </div>

      <div class="admin-grid">
        <div class="admin-col">
          <div class="admin-card">
            <div class="admin-card-title"><span class="num">1</span> Tambah kuning (langsung disetujui)</div>
            ${!open ? `<div class="admin-info" style="background:var(--amber-pale); color:#6B4308;">${ICON.clock}<div>Di luar jendela pengajuan (tgl ${kuningWindow.start}–${kuningWindow.end}). Personel tidak bisa mengajukan, tapi admin tetap bisa menambahkan.</div></div>` : ''}
            <div id="adminKuningForm"></div>
          </div>
        </div>
        <div class="admin-col">
          <div class="admin-card">
            <div class="admin-card-title"><span class="num">2</span> Daftar pengajuan
              <span class="sub">${kuningList.length} total</span>
            </div>
            ${batchBtn}
            <div class="reqlist" id="adminKuningList"></div>
          </div>
        </div>
      </div>
    </div>`;

  renderRequestPanel(document.getElementById('adminKuningForm'), 'kuning', 'admin');
  const rt = realToday();
  const list = kuningList.slice().sort((a,b)=> b.id - a.id);
  document.getElementById('adminKuningList').innerHTML = list.length ? list.map(item=>{
    const p = getPerson(item.personnelId);
    let actions = '';
    const isPastOrActive = (item.year < rt.y) || (item.year === rt.y && item.month < rt.m) || (item.year === rt.y && item.month === rt.m && (item.end || item.start) <= rt.d);
    if(item.status==='pending'){
      actions = `<div class="actions">
        <button class="small ok-btn" onclick="setStatus('kuning',${item.id},'approved')">Setuju</button>
        <button class="small reject-btn" onclick="setStatus('kuning',${item.id},'rejected')">Tolak</button>
      </div>`;
    } else {
      const btnOrBadge = (item.status==='approved' && isPastOrActive)
        ? `<span class="badge" style="background:#5A6B7E;color:#fff;">Fix (Aktif/Lewat)</span>`
        : `<button class="x" onclick="removeReq('kuning',${item.id})" aria-label="Hapus">×</button>`;
      actions = `<div class="actions">
        <span class="badge ${item.status}">${item.status==='approved'?'Disetujui':'Ditolak'}</span>
        ${btnOrBadge}
      </div>`;
    }
    return `<div class="reqrow ${item.status}">
      <span><span class="who">${esc(p.name)}</span><span class="meta">${fmtRange(item)} · ${monthTag(item.month,item.year)}</span></span>
      ${actions}
    </div>`;
  }).join('') : `<div class="admin-empty">Belum ada pengajuan kuning.<br><b>Kotak masuk kosong.</b></div>`;
}

/* ================= TAB: PERSETUJUAN TUKAR DINAS ================= */
function renderAdminSwap(body){
  const pending = swapList.filter(c=>c.status==='pending');
  const approved = swapList.filter(c=>c.status==='approved');
  const rejected = swapList.filter(c=>c.status==='rejected');

  body.innerHTML = `
    ${adminPanelHead(ICON.swap, 'Persetujuan tukar dinas',
      'Sistem hanya merekomendasikan personel yang libur penuh (Libur-2). Libur-1 tidak pernah direkomendasikan.')}
    <div class="admin-panel-body">
      <div class="admin-stats">
        <div class="admin-stat warn"><div class="lbl">Menunggu</div><div class="val">${pending.length}</div></div>
        <div class="admin-stat ok"><div class="lbl">Disetujui</div><div class="val">${approved.length}</div></div>
        <div class="admin-stat bad"><div class="lbl">Ditolak</div><div class="val">${rejected.length}</div></div>
      </div>

      <div class="admin-grid">
        <div class="admin-col">
          <div class="admin-card">
            <div class="admin-card-title"><span class="num">1</span> Ajukan tukar dinas (langsung disetujui)</div>
            <div id="adminSwapForm"></div>
          </div>
        </div>
        <div class="admin-col">
          <div class="admin-card">
            <div class="admin-card-title"><span class="num">2</span> Daftar pengajuan
              <span class="sub">${swapList.length} total</span>
            </div>
            <div class="reqlist" id="adminSwapList"></div>
          </div>
        </div>
      </div>

      <!-- CARD 3: Laporan & Log Tukar Dinas Bulan Ini -->
      <div class="admin-card" style="margin-top:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--line);">
          <div>
            <div class="admin-card-title" style="margin-bottom:2px;">
              <span class="num" style="background:var(--navy);">3</span> Laporan &amp; Log Tukar Dinas Bulan ${monthNames[viewM-1]} ${viewY}
            </div>
            <div style="font-size:12px; color:var(--ink-soft);">Rekapitulasi personel yang terlibat tukar dinas dan log perubahan versi jadwal</div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button class="small ghost" onclick="openSwapReportPrint(viewY, viewM)" style="display:inline-flex; align-items:center; gap:5px; border-color:var(--navy); color:var(--navy); font-weight:600; cursor:pointer;" type="button">
              ${ICON.print} Cetak Laporan
            </button>
          </div>
        </div>

        <div id="adminSwapReportArea"></div>
      </div>
    </div>`;

  const rt = realToday();
  const sched = schedules[skey(rt.y, rt.m)];
  const from = rt.d+1, to = sched ? sched.days : 0;
  const canForm = sched && from<=to;

  if(canForm){
    const mount = document.createElement('div');
    renderSwapPanel(mount);
    const formCard = mount.querySelector('.card');
    document.getElementById('adminSwapForm').innerHTML = formCard ? formCard.outerHTML : mount.innerHTML;
    wireSwapForm(sched, from, to);
  } else {
    document.getElementById('adminSwapForm').innerHTML = `<div class="admin-empty">Tukar dinas hanya berlaku untuk sisa bulan berjalan (mulai besok). Saat ini tidak ada sisa hari atau jadwal bulan ini belum dibuat.</div>`;
  }

  const list = swapList.slice().sort((a,b)=> b.id - a.id);
  document.getElementById('adminSwapList').innerHTML = list.length ? list.map(item=>{
    const req = personnel[item.requesterId], partner = personnel[item.partnerId];
    let actions = '';
    const isPastOrActive = (item.year < rt.y) || (item.year === rt.y && item.month < rt.m) || (item.year === rt.y && item.month === rt.m && item.date <= rt.d);
    if(item.status==='pending'){
      actions = `<div class="actions">
        <button class="small ok-btn" onclick="setStatus('swap',${item.id},'approved')">Setuju</button>
        <button class="small reject-btn" onclick="setStatus('swap',${item.id},'rejected')">Tolak</button>
      </div>`;
    } else {
      const btnOrBadge = (item.status==='approved' && isPastOrActive)
        ? `<span class="badge" style="background:#5A6B7E;color:#fff;">Fix (Aktif/Lewat)</span>`
        : `<button class="x" onclick="removeReq('swap',${item.id})" aria-label="Hapus">×</button>`;
      actions = `<div class="actions">
        <span class="badge ${item.status}">${item.status==='approved'?'Disetujui':'Ditolak'}</span>
        ${btnOrBadge}
      </div>`;
    }
    return `<div class="reqrow ${item.status}">
      <span><span class="who">${esc(req.name)} → ${esc(partner.name)}</span><span class="meta">Tgl ${item.date} · ${item.slot} · ${monthTag(item.month,item.year)}${item.reason?' · '+esc(item.reason):''}</span></span>
      ${actions}
    </div>`;
  }).join('') : `<div class="admin-empty">Belum ada pengajuan tukar dinas.<br><b>Kotak masuk kosong.</b></div>`;

  const repArea = document.getElementById('adminSwapReportArea');
  if(repArea) renderAdminSwapReport(repArea, viewY, viewM);
}

function renderAdminSwapReport(container, year, month){
  if(!container) return;
  const approved = swapList.filter(s => s.year === year && s.month === month && s.status === 'approved');
  const stats = {};
  personnel.forEach(p => {
    stats[p.id] = { outCount: 0, inCount: 0, outDetails: [], inDetails: [] };
  });
  approved.forEach(s => {
    if(stats[s.requesterId]){
      stats[s.requesterId].outCount++;
      stats[s.requesterId].outDetails.push({ date: s.date, slot: s.slot, partner: getPerson(s.partnerId).name });
    }
    if(stats[s.partnerId]){
      stats[s.partnerId].inCount++;
      stats[s.partnerId].inDetails.push({ date: s.date, slot: s.slot, requester: getPerson(s.requesterId).name });
    }
  });

  const active = personnel.filter(p => stats[p.id].outCount > 0 || stats[p.id].inCount > 0);
  const psCount = approved.filter(s => s.slot === 'PS').length;
  const mCount = approved.filter(s => s.slot === 'M').length;

  let rekapRows = active.map((p, idx) => {
    const st = stats[p.id];
    const details = [];
    st.outDetails.forEach(d => details.push(`<span style="color:#B91C1C; font-weight:600;">Digantikan</span> oleh <b>${esc(d.partner)}</b> (Tgl ${d.date}, Slot ${d.slot})`));
    st.inDetails.forEach(d => details.push(`<span style="color:#15803D; font-weight:600;">Menggantikan</span> <b>${esc(d.requester)}</b> (Tgl ${d.date}, Slot ${d.slot})`));
    return `<tr>
      <td style="text-align:center; color:var(--ink-soft);">${idx + 1}</td>
      <td><b>${esc(p.name)}</b></td>
      <td style="text-align:center;"><span class="swap-badge-count swap-badge-out">${st.outCount}×</span></td>
      <td style="text-align:center;"><span class="swap-badge-count swap-badge-in">${st.inCount}×</span></td>
      <td style="text-align:center;"><span class="swap-badge-count swap-badge-total">${st.outCount + st.inCount}×</span></td>
      <td style="font-size:12px; line-height:1.4;">${details.join('<br>') || '–'}</td>
    </tr>`;
  }).join('');

  if(!active.length){
    rekapRows = `<tr><td colspan="6" style="text-align:center; padding:18px; color:var(--ink-soft);">Belum ada personel yang melakukan tukar dinas pada bulan ${monthNames[month-1]} ${year}.</td></tr>`;
  }

  let logRows = approved.map((s, idx) => {
    const req = getPerson(s.requesterId);
    const part = getPerson(s.partnerId);
    return `<tr>
      <td style="text-align:center; font-family:var(--mono); font-weight:700; color:var(--navy);">v1.${idx + 1}</td>
      <td style="text-align:center;"><b>Tgl ${s.date}</b> ${monthNames[month-1]}</td>
      <td style="text-align:center;"><span class="badge ${s.slot==='PS'?'info':'warn'}">${esc(s.slot)}</span></td>
      <td><b>${esc(req.name)}</b></td>
      <td><b>${esc(part.name)}</b></td>
      <td style="font-size:12px; color:var(--ink-soft);">${esc(s.reason || '–')}</td>
      <td style="text-align:center;"><span class="badge approved">Disetujui</span></td>
    </tr>`;
  }).join('');

  if(!approved.length){
    logRows = `<tr><td colspan="7" style="text-align:center; padding:18px; color:var(--ink-soft);">Belum ada riwayat tukar dinas yang disetujui bulan ini.</td></tr>`;
  }

  container.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-bottom:14px;">
      <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:10px 12px; text-align:center;">
        <div style="font-size:11px; color:#166534; font-weight:700; text-transform:uppercase;">Total Disetujui</div>
        <div style="font-size:20px; font-weight:800; color:#14532D; margin-top:2px;">${approved.length}</div>
      </div>
      <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:10px 12px; text-align:center;">
        <div style="font-size:11px; color:#1E40AF; font-weight:700; text-transform:uppercase;">Personel Terlibat</div>
        <div style="font-size:20px; font-weight:800; color:#1E3A8A; margin-top:2px;">${active.length} <span style="font-size:12px; font-weight:500;">/ ${personnel.length}</span></div>
      </div>
      <div style="background:#F5F3FF; border:1px solid #DDD6FE; border-radius:8px; padding:10px 12px; text-align:center;">
        <div style="font-size:11px; color:#5B21B6; font-weight:700; text-transform:uppercase;">Shift PS vs M</div>
        <div style="font-size:15px; font-weight:700; color:#4C1D95; margin-top:4px;">PS: ${psCount} · M: ${mCount}</div>
      </div>
      <div style="background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; padding:10px 12px; text-align:center;">
        <div style="font-size:11px; color:#92400E; font-weight:700; text-transform:uppercase;">Versi Jadwal</div>
        <div style="font-size:18px; font-weight:800; color:#78350F; margin-top:2px;">v1.${approved.length}</div>
      </div>
    </div>

    <div style="font-weight:700; font-size:13px; color:var(--navy); margin:12px 0 6px; display:flex; align-items:center; gap:6px;">
      <span>👥 Rekapitulasi Personel yang Tukar Dinas Bulan Ini:</span>
    </div>
    <div style="overflow-x:auto;">
      <table class="swap-report-table">
        <thead>
          <tr>
            <th style="width:30px; text-align:center;">No</th>
            <th>Nama Personel</th>
            <th style="text-align:center; width:100px;">Digantikan</th>
            <th style="text-align:center; width:110px;">Menggantikan</th>
            <th style="text-align:center; width:70px;">Total</th>
            <th>Rincian Tanggal &amp; Rekan</th>
          </tr>
        </thead>
        <tbody>${rekapRows}</tbody>
      </table>
    </div>

    <div style="font-weight:700; font-size:13px; color:var(--navy); margin:18px 0 6px; display:flex; align-items:center; gap:6px;">
      <span>📜 Log Riwayat Versi Jadwal (Kronologis Tukar Dinas):</span>
    </div>
    <div style="overflow-x:auto;">
      <table class="swap-report-table">
        <thead>
          <tr>
            <th style="width:55px; text-align:center;">Versi</th>
            <th style="width:110px; text-align:center;">Tgl Dinas</th>
            <th style="width:60px; text-align:center;">Shift</th>
            <th>Personel Digantikan</th>
            <th>Personel Pengganti</th>
            <th>Alasan</th>
            <th style="width:80px; text-align:center;">Status</th>
          </tr>
        </thead>
        <tbody>${logRows}</tbody>
      </table>
    </div>
  `;
}

function openSwapReportPrint(y, m){
  const approved = swapList.filter(s => s.year === y && s.month === m && s.status === 'approved');
  const stats = {};
  personnel.forEach(p => {
    stats[p.id] = { outCount: 0, inCount: 0, outDetails: [], inDetails: [] };
  });
  approved.forEach(s => {
    if(stats[s.requesterId]){
      stats[s.requesterId].outCount++;
      stats[s.requesterId].outDetails.push({ date: s.date, slot: s.slot, partner: getPerson(s.partnerId).name });
    }
    if(stats[s.partnerId]){
      stats[s.partnerId].inCount++;
      stats[s.partnerId].inDetails.push({ date: s.date, slot: s.slot, requester: getPerson(s.requesterId).name });
    }
  });

  const active = personnel.filter(p => stats[p.id].outCount > 0 || stats[p.id].inCount > 0);
  const nomor = printMeta.nomor ? esc(printMeta.nomor) : '&nbsp;';
  const tgl = printMeta.tanggal ? esc(formatIndoDate(printMeta.tanggal)) : esc(formatIndoDate(new Date().toISOString().slice(0,10)));
  const lamp = printMeta.lampiran ? esc(printMeta.lampiran) : 'Laporan Rekapitulasi Tukar Dinas';

  let rekapRows = active.map((p, idx) => {
    const st = stats[p.id];
    const details = [];
    st.outDetails.forEach(d => details.push(`<span style="color:#B91C1C;">Digantikan</span> ${esc(d.partner)} (Tgl ${d.date}, ${d.slot})`));
    st.inDetails.forEach(d => details.push(`<span style="color:#15803D;">Menggantikan</span> ${esc(d.requester)} (Tgl ${d.date}, ${d.slot})`));
    return `<tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td><b>${esc(p.name)}</b></td>
      <td style="text-align:center;">${st.outCount} kali</td>
      <td style="text-align:center;">${st.inCount} kali</td>
      <td style="text-align:center;"><b>${st.outCount + st.inCount}</b></td>
      <td>${details.join('<br>') || '-'}</td>
    </tr>`;
  }).join('');

  if(!active.length){
    rekapRows = `<tr><td colspan="6" style="text-align:center; padding:16px; color:#666;">Tidak ada personel yang melakukan tukar dinas pada bulan ini.</td></tr>`;
  }

  let logRows = approved.map((s, idx) => {
    const req = getPerson(s.requesterId);
    const part = getPerson(s.partnerId);
    return `<tr>
      <td style="text-align:center;">v1.${idx + 1}</td>
      <td style="text-align:center;">${s.date} ${monthNames[m-1]} ${y}</td>
      <td style="text-align:center;"><b>${esc(s.slot)}</b></td>
      <td>${esc(req.name)}</td>
      <td>${esc(part.name)}</td>
      <td>${esc(s.reason || '-')}</td>
      <td style="text-align:center;"><span style="color:#15803D; font-weight:bold;">Disetujui</span></td>
    </tr>`;
  }).join('');

  if(!approved.length){
    logRows = `<tr><td colspan="7" style="text-align:center; padding:16px; color:#666;">Belum ada log perubahan versi jadwal tukar dinas.</td></tr>`;
  }

  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
  <title>Laporan Tukar Dinas ${monthNames[m-1]} ${y}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #111; margin: 0; padding: 12px; font-size: 12px; }
    .letterhead { display: flex; justify-content: flex-end; margin-bottom: 14px; font-size: 12px; }
    .letterhead table { border-collapse: collapse; }
    .letterhead td { padding: 1px 4px; }
    .title { text-align: center; font-weight: bold; font-size: 15px; margin-bottom: 4px; }
    .sub-title { text-align: center; font-size: 12.5px; color: #333; margin-bottom: 16px; }
    .meta-box { display: flex; gap: 20px; background: #F8FAFC; border: 1px solid #CBD5E1; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; }
    .meta-item { flex: 1; }
    .meta-item .lbl { font-size: 10px; color: #64748B; text-transform: uppercase; font-weight: bold; }
    .meta-item .val { font-size: 14px; font-weight: bold; color: #0F172A; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11.5px; }
    th, td { border: 1px solid #000; padding: 5px 8px; }
    th { background: #E2E8F0; text-align: left; }
    .sect-title { font-weight: bold; font-size: 13px; margin: 14px 0 6px; }
    .sig-area { margin-top: 36px; display: flex; justify-content: flex-end; }
    .sig-box { text-align: center; width: 220px; }
    @media print { .noprint { display: none !important; } }
    .noprint { position: fixed; top: 12px; right: 12px; }
    .noprint button { padding: 8px 16px; background: #0E5C6E; color: #fff; border: 1px solid #0A4552; border-radius: 6px; cursor: pointer; font-weight: bold; }
  </style></head><body>
    <div class="noprint"><button onclick="window.print()">🖨️ Cetak / Simpan PDF</button></div>
    <div class="letterhead">
      <table>
        <tr><td colspan="3">${lamp}</td></tr>
        <tr><td>Nomor</td><td>:</td><td>${nomor}</td></tr>
        <tr><td>Tanggal</td><td>:</td><td>${tgl}</td></tr>
      </table>
    </div>
    <div class="title">LAPORAN REKAPITULASI TUKAR DINAS SHIFT</div>
    <div class="sub-title">DIREKTORAT DATA DAN KOMPUTASI — BMKG<br>Bulan ${monthNames[m-1]} ${y}</div>

    <div class="meta-box">
      <div class="meta-item"><div class="lbl">Total Tukar Dinas</div><div class="val">${approved.length} kejadian</div></div>
      <div class="meta-item"><div class="lbl">Personel Terlibat</div><div class="val">${active.length} personel</div></div>
      <div class="meta-item"><div class="lbl">Versi Jadwal Aktif</div><div class="val">v1.${approved.length}</div></div>
    </div>

    <div class="sect-title">I. Rekapitulasi Personel yang Melakukan Tukar Dinas</div>
    <table>
      <thead>
        <tr>
          <th style="width:28px; text-align:center;">No</th>
          <th>Nama Personel</th>
          <th style="text-align:center; width:95px;">Digantikan (Keluar)</th>
          <th style="text-align:center; width:95px;">Menggantikan (Masuk)</th>
          <th style="text-align:center; width:60px;">Total</th>
          <th>Rincian Tanggal &amp; Rekan</th>
        </tr>
      </thead>
      <tbody>${rekapRows}</tbody>
    </table>

    <div class="sect-title">II. Log Kronologis Riwayat Versi Jadwal (Tukar Dinas)</div>
    <table>
      <thead>
        <tr>
          <th style="width:50px; text-align:center;">Versi</th>
          <th style="width:90px; text-align:center;">Tanggal Dinas</th>
          <th style="width:50px; text-align:center;">Shift</th>
          <th>Personel Asli (Digantikan)</th>
          <th>Personel Pengganti (Masuk)</th>
          <th>Alasan</th>
          <th style="width:70px; text-align:center;">Status</th>
        </tr>
      </thead>
      <tbody>${logRows}</tbody>
    </table>

    <div class="sig-area">
      <div class="sig-box">
        <div>Jakarta, ${tgl}</div>
        <div style="margin-top:4px;">Mengetahui,<br><b>Admin Shift DDK</b></div>
        <div style="margin-top:60px; border-bottom:1px solid #000; width:170px; margin-left:auto; margin-right:auto;"></div>
      </div>
    </div>
  </body></html>`;

  const w = window.open('', '_blank');
  if(!w){ toast('Popup diblokir browser — izinkan popup untuk situs ini agar bisa mencetak laporan.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

/* ================= TAB: LOCK ADMIN ================= */
function renderAdminLock(body){
  body.innerHTML = `
    ${adminPanelHead(ICON.lock, 'Lock admin',
      'Kunci slot PS/M untuk personel tertentu di tanggal tertentu. Maksimal 2 lock per slot per tanggal.')}
    <div class="admin-panel-body">
      <div class="admin-grid">
        <div class="admin-col">
          <div class="admin-card">
            <div class="admin-card-title"><span class="num">1</span> Tambah lock</div>
            <div class="formrow"><label>Personel</label><select id="lockPersonel">${personnelOptions()}</select></div>
            <div class="formrow"><label>Tanggal</label><input type="date" id="lockDate"></div>
            <div class="formrow"><label>Slot</label><select id="lockSlot"><option value="PS">PS (Pagi Siang)</option><option value="M">M (Malam)</option></select></div>
            <div class="formrow"><label>Alasan</label><input type="text" id="lockReason" placeholder="mis. diminta Kabag"></div>
            <div id="lockWarn" class="warn"></div>
            <button class="submit" id="btnAddLock">Kunci jadwal</button>
            <div class="note">Tanggal mengikuti bulan yang sedang dibuka (${monthNames[viewM-1]} ${viewY}).</div>
          </div>
        </div>
        <div class="admin-col">
          <div class="admin-card">
            <div class="admin-card-title"><span class="num">2</span> Daftar lock
              <span class="sub">${lockedList.length} total</span>
            </div>
            <div class="reqlist" id="adminLockList"></div>
          </div>
        </div>
      </div>
    </div>`;
  applyDateBounds(document.getElementById('lockDate'));
  document.getElementById('btnAddLock').addEventListener('click', addLock);
  renderAdminLockList();
}
function renderAdminLockList(){
  const box = document.getElementById('adminLockList');
  if(!box) return;
  const rt = realToday();
  const list = lockedList.slice().sort((a,b)=> a.month-b.month || a.date-b.date);
  box.innerHTML = list.length ? list.map(l=>{
    const p = personnel[l.personnelId];
    const isPastOrActive = (l.year < rt.y) || (l.year === rt.y && l.month < rt.m) || (l.year === rt.y && l.month === rt.m && l.date <= rt.d);
    const actionHtml = isPastOrActive
      ? `<span class="badge" style="background:#5A6B7E;color:#fff;">Fix (Aktif/Lewat)</span>`
      : `<button class="x" onclick="removeLock(${l.id})" aria-label="Hapus lock">×</button>`;
    return `<div class="reqrow approved">
      <span><span class="who">${esc(p.name)}</span><span class="meta">Tgl ${l.date} · ${l.slot} · ${monthTag(l.month,l.year)}${l.reason?' · '+esc(l.reason):''}</span></span>
      ${actionHtml}
    </div>`;
  }).join('') : `<div class="admin-empty">Belum ada lock admin.</div>`;
}

/* ================= TAB: CETAK JADWAL ================= */
function renderAdminPrint(body){
  const monthsWithSched = [];
  Object.keys(schedules).forEach(k=>{
    const [y,m] = k.split('-').map(Number);
    monthsWithSched.push({y, m});
  });
  monthsWithSched.sort((a,b)=> a.y===b.y ? a.m-b.m : a.y-b.y);

  const listHtml = monthsWithSched.length
    ? monthsWithSched.map(x=>`<button class="print-item compact" onclick="printSchedule(${x.y}, ${x.m})" type="button">
        <div class="pi-icon">${ICON.print}</div>
        <div class="pi-text">
          <div class="pi-title">${monthNames[x.m-1]} ${x.y}</div>
          <div class="pi-sub">${schedules[skey(x.y,x.m)].days} hari · ${personnel.length} personel</div>
        </div>
        <span class="pi-badge">Cetak</span>
      </button>`).join('')
    : `<div class="admin-empty">Belum ada jadwal yang digenerate.<br><b>Kembali ke halaman jadwal lalu klik "Generate jadwal".</b></div>`;

  body.innerHTML = `
    ${adminPanelHead(ICON.print, 'Cetak jadwal bulanan',
      'Cetak jadwal bulan yang sudah digenerate. Format sudah dioptimalkan untuk A4 landscape.')}
    <div class="admin-panel-body" style="padding:14px 18px;">
      <div class="admin-print-grid">
        <div class="admin-print-cards">
          <!-- CARD 1: Cetak bulan tertentu -->
          <div class="admin-card compact-card" style="display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div class="admin-card-title"><span class="num">1</span> Cetak bulan tertentu</div>
              <div class="field-row" style="gap:8px; margin-bottom:8px;">
                <div class="formrow" style="margin-bottom:0; flex:1;">
                  <label>Bulan</label>
                  <select id="printMonth">${monthNames.map((n,i)=>`<option value="${i+1}" ${i+1===viewM?'selected':''}>${n}</option>`).join('')}</select>
                </div>
                <div class="formrow" style="margin-bottom:0; flex:1;">
                  <label>Tahun</label>
                  <select id="printYear">${[rtNow.y-1, rtNow.y, rtNow.y+1, rtNow.y+2].map(y=>`<option value="${y}" ${y===viewY?'selected':''}>${y}</option>`).join('')}</select>
                </div>
              </div>
            </div>
            <div>
              <button class="submit" id="btnPrintNow" type="button">${ICON.print} Cetak tampilan biasa</button>
              <div style="font-size:11px; color:var(--ink-soft); margin-top:7px; display:flex; align-items:center; gap:5px; line-height:1.35;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="flex:none;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                <span>Pilih <b>Landscape</b> &amp; centang <b>Background graphics</b> saat dialog cetak.</span>
              </div>
            </div>
          </div>

          <!-- CARD 2: Cetak format resmi (untuk atasan) -->
          <div class="admin-card compact-card" style="display:flex; flex-direction:column; justify-content:space-between; border-color:#DFBD70; background:#FFFDF9;">
            <div>
              <div class="admin-card-title" style="color:#7D5A06;"><span class="num" style="background:#C97A25;">2</span> Cetak format resmi (untuk atasan)</div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px 9px; margin-bottom:8px;">
                <div class="formrow" style="margin-bottom:0;">
                  <label>Lampiran</label>
                  <input type="text" id="fpLampiran" value="${esc(printMeta.lampiran || '')}" placeholder="Lampiran Surat II">
                </div>
                <div class="formrow" style="margin-bottom:0;">
                  <label>Nomor surat</label>
                  <input type="text" id="fpNomor" value="${esc(printMeta.nomor || '')}" placeholder="e.B/DB.00.01/...">
                </div>
                <div class="formrow" style="margin-bottom:0;">
                  <label>Tanggal surat</label>
                  <input type="date" id="fpTanggal" value="${esc(printMeta.tanggal || '')}">
                </div>
                <div class="formrow" style="margin-bottom:0;">
                  <label>Tgl libur ekstra</label>
                  <input type="text" id="fpHolidays" value="${esc(extraHolidays[skey(viewY,viewM)] || '')}" placeholder="mis. 1, 17">
                </div>
              </div>
            </div>
            <div>
              <button class="submit" id="btnPrintFormal" type="button" style="background:linear-gradient(135deg, #123A5E, #0E5C6E);">${ICON.print} Cetak format resmi</button>
              <div style="font-size:11px; color:#8C6818; margin-top:7px; display:flex; align-items:center; gap:5px; line-height:1.35;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="flex:none;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                <span>Format resmi BMKG (Sabtu/Minggu abu-abu, Cuti merah, Kuning kuning). Buka di tab baru.</span>
              </div>
            </div>
          </div>
        </div>

        <!-- CARD 3: Jadwal tersedia -->
        <div class="admin-card compact-card">
          <div class="admin-card-title"><span class="num">3</span> Jadwal tersedia
            <span class="sub">${monthsWithSched.length} bulan</span>
          </div>
          <div class="print-list" style="max-height:210px; overflow-y:auto; -webkit-overflow-scrolling:touch; gap:6px;">${listHtml}</div>
        </div>
      </div>
    </div>`;

  document.getElementById('btnPrintNow').addEventListener('click', ()=>{
    const m = parseInt(document.getElementById('printMonth').value);
    const y = parseInt(document.getElementById('printYear').value);
    printSchedule(y, m);
  });
  document.getElementById('btnPrintFormal').addEventListener('click', ()=>{
    const m = parseInt(document.getElementById('printMonth').value);
    const y = parseInt(document.getElementById('printYear').value);
    printMeta.lampiran = document.getElementById('fpLampiran').value.trim() || 'Lampiran Surat';
    printMeta.nomor = document.getElementById('fpNomor').value.trim();
    printMeta.tanggal = document.getElementById('fpTanggal').value;
    extraHolidays[skey(y,m)] = document.getElementById('fpHolidays').value.trim();
    persistSettings();
    persistExtraHoliday(y, m, extraHolidays[skey(y,m)]);
    openFormalPrint(y, m);
  });
}
function isTanggalMerah(y, m, day){
  const dow = new Date(y, m-1, day).getDay(); // 0=Minggu, 6=Sabtu
  if(dow===0 || dow===6) return true;
  const raw = extraHolidays[skey(y,m)] || '';
  const list = raw.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>!isNaN(n));
  return list.includes(day);
}
function formatIndoDate(dateStr){
  if(!dateStr) return '';
  const [y,m,d] = dateStr.split('-').map(Number);
  if(!y||!m||!d) return dateStr;
  return `${d} ${monthNames[m-1]} ${y}`;
}
function buildFormalPrintHtml(y, m){
  const sched = schedules[skey(y,m)];
  const days = sched.days;
  let headCells = '';
  for(let d=1; d<=days; d++) headCells += `<th class="${isTanggalMerah(y,m,d)?'merah':''}">${d}</th>`;
  const rows = personnel.map((p,idx)=>{
    let cells = '';
    for(let d=1; d<=days; d++){
      const dayData = sched.calendar[d-1];
      const onCuti = cutiList.some(c=>c.status==='approved' && c.personnelId===idx && c.month===m && c.year===y && d>=c.start && d<=c.end);
      const onKuning = kuningList.some(k=>k.status==='approved' && k.personnelId===idx && k.month===m && k.year===y && d>=k.start && d<=k.end);
      const isPS = dayData.PS.includes(idx), isM = dayData.M.includes(idx);
      const merah = isTanggalMerah(y,m,d);
      let label = onCuti ? '-' : (onKuning ? 'K' : (isPS ? 'PS' : (isM ? 'M' : '-')));
      const cls = onCuti ? 'cuti' : (onKuning ? 'kuning' : (merah ? 'merah' : ''));
      cells += `<td class="${cls}">${label}</td>`;
    }
    return `<tr><td class="no">${idx+1}</td><td class="nama">${esc(p.name)}</td>${cells}</tr>`;
  }).join('');
  const nomor = printMeta.nomor ? esc(printMeta.nomor) : '&nbsp;';
  const tgl = printMeta.tanggal ? esc(formatIndoDate(printMeta.tanggal)) : '&nbsp;';
  const lamp = printMeta.lampiran ? esc(printMeta.lampiran) : 'Lampiran Surat';
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Jadwal Dinas ${monthNames[m-1]} ${y}</title>
<style>
  @page{ size:A4 landscape; margin:14mm; }
  *{ box-sizing:border-box; }
  body{ font-family:Arial, Helvetica, sans-serif; color:#000; margin:0; padding:16px 22px; }
  .letterhead{ display:flex; justify-content:flex-end; margin-bottom:22px; }
  .letterhead table{ border-collapse:collapse; font-size:13px; }
  .letterhead td{ padding:1px 4px; vertical-align:top; white-space:nowrap; }
  .letterhead td.lbl{ padding-right:14px; }
  .title{ text-align:center; font-weight:bold; font-size:16px; line-height:1.45; margin-bottom:16px; }
  table.jadwal{ border-collapse:collapse; width:100%; font-size:11px; }
  table.jadwal th, table.jadwal td{ border:1px solid #000; padding:4px 6px; text-align:center; }
  table.jadwal td.nama, table.jadwal th.nama{ text-align:left; white-space:nowrap; }
  table.jadwal th.merah, table.jadwal td.merah{ background:#C9C9C9 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  table.jadwal td.cuti{ background:#FF0000 !important; color:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  table.jadwal td.kuning{ background:#F2C230 !important; color:#6B4E05 !important; font-weight:bold; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .keterangan{ margin-top:18px; font-size:13px; }
  .keterangan .judul{ font-weight:bold; margin-bottom:8px; }
  .ket-row{ display:flex; align-items:center; gap:10px; margin-bottom:7px; }
  .ket-label{ width:26px; display:inline-block; font-weight:bold; }
  .swatch{ width:28px; height:16px; display:inline-block; border:1px solid #888; vertical-align:middle; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .swatch.merah{ background:#C9C9C9; }
  .swatch.cuti{ background:#FF0000; }
  .swatch.kuning{ background:#F2C230; }
  @media print{ .noprint{ display:none !important; } }
  .noprint{ position:fixed; top:10px; right:10px; }
  .noprint button{ font-family:Arial; font-size:13px; padding:8px 14px; border-radius:6px; border:1px solid #999; background:#0E5C6E; color:#fff; cursor:pointer; }
</style></head><body>
  <div class="noprint"><button onclick="window.print()">🖨️ Cetak / Simpan PDF</button></div>
  <div class="letterhead">
    <table>
      <tr><td colspan="3">${lamp}</td></tr>
      <tr><td class="lbl">Nomor</td><td>:</td><td>${nomor}</td></tr>
      <tr><td class="lbl">Tanggal</td><td>:</td><td>${tgl}</td></tr>
    </table>
  </div>
  <div class="title">Jadwal Dinas Shift Pengelola Data dan Komputasi<br>Direktorat Data dan Komputasi<br>Bulan ${monthNames[m-1]} ${y}</div>
  <table class="jadwal">
    <thead>
      <tr><th rowspan="2">No</th><th rowspan="2" class="nama">Nama</th><th colspan="${days}">Tanggal</th></tr>
      <tr>${headCells}</tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="keterangan">
    <div class="judul">Keterangan :</div>
    <div class="ket-row"><span class="ket-label">PS</span><span>= Pagi (08.00 - 20.00 WIB)</span></div>
    <div class="ket-row"><span class="ket-label">M</span><span>= Malam (20.00 - 08.00 WIB)</span></div>
    <div class="ket-row"><span class="ket-label">-</span><span>= Lepas Dinas/Libur</span></div>
    <div class="ket-row"><span class="swatch merah"></span><span>= Tanggal Merah</span></div>
    <div class="ket-row"><span class="swatch cuti"></span><span>= Cuti</span></div>
    <div class="ket-row"><span class="swatch kuning"></span><span>= Kuning (Keinginan Libur)</span></div>
  </div>
</body></html>`;
}
function openFormalPrint(y, m){
  if(!schedules[skey(y,m)]){ toast(`Jadwal ${monthNames[m-1]} ${y} belum dibuat`); return; }
  const html = buildFormalPrintHtml(y, m);
  const w = window.open('', '_blank');
  if(!w){ toast('Popup diblokir browser — izinkan popup untuk situs ini agar bisa mencetak.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
function printSchedule(y, m){
  if(!schedules[skey(y,m)]){ toast(`Jadwal ${monthNames[m-1]} ${y} belum dibuat`); return; }
  viewY = y; viewM = m;
  if(selYear.value != y) selYear.value = y;
  hideAdminPage();
  renderMonthTabs();
  renderScheduleArea();
  setTimeout(()=>{
    toast('Menyiapkan cetak… pilih "Landscape" di dialog');
    window.print();
  }, 180);
}

/* =====================================================================
   INIT
   ===================================================================== */
function renderAll(){
  updateUserChip();
  updateNavHighlight();
  updateGenerateButton();
  renderMonthTabs();
  renderScheduleArea();
  updateNavBadges();
  if(activePanel) renderModal();
  if(document.getElementById('adminPage').style.display==='block') renderAdminPanel();
}

const btnUndoSchedEl = document.getElementById('btnUndoSched');
if(btnUndoSchedEl) btnUndoSchedEl.addEventListener('click', () => undoSchedule(viewY, viewM));

const btnRedoSchedEl = document.getElementById('btnRedoSched');
if(btnRedoSchedEl) btnRedoSchedEl.addEventListener('click', () => redoSchedule(viewY, viewM));

renderLoginRoles();
updateLoginHint();

(async function initApp(){
  await loadFromSupabase();   // tarik data terbaru dari Supabase (kalau tersedia) sebelum render
  renderLoginRoles();
  updateLoginHint();
  const savedRole = loadSession();
  if(savedRole && (savedRole==='admin' || savedRole.startsWith('p'))){
    enterApp(savedRole);
  } else {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('loginScreen').setAttribute('aria-hidden','false');
  }
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.log('SW registration note:', err);
    });
  });
}

/* =====================================================================
   MODUL DRAFT TERINTEGRASI — tempel di AKHIR logika.js (setelah initApp),
   lalu hapus <script src="logika-draft.js"> dari HTML.
   Draft = semua aksi admin tertahan di memori; DB baru tersentuh saat Submit.
   ===================================================================== */
(function(){
'use strict';

const clone=o=>o==null?o:JSON.parse(JSON.stringify(o));
const nowStr=()=>new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
const DK='sim-shift-draft', PAL=['#0E9AA7','#E8590C','#7048E8','#2F9E44','#D6336C','#1971C2'];
let _suppress=false,_rl=false,_noBal=false,draftTab='all',dbFail=0;
const nm=id=>esc(getPerson(id).name);

/* ---------- 1. Helper DB: mengembalikan true/false + blokir saat draft ---------- */
const DRAFT_TABLES=new Set(['schedules','cuti_requests','kuning_requests','locked_slots','swap_requests']);
const blocked=t=>!!previewScheduleState&&DRAFT_TABLES.has(t);
async function run(thunk){
  if(!sb) return true;
  try{ const {error}=await thunk(); if(error){ dbFail++; console.error('[supabase]',error.message); return false; } return true; }
  catch(e){ dbFail++; console.error('[supabase]',e); return false; }
}
window.dbInsert=async(t,r)=>blocked(t)||run(()=>sb.from(t).insert(r));
window.dbUpdate=async(t,id,p)=>blocked(t)||run(()=>sb.from(t).update(p).eq('id',id));
window.dbDelete=async(t,id)=>blocked(t)||run(()=>sb.from(t).delete().eq('id',id));
window.dbUpsert=async(t,r,oc)=>blocked(t)||run(()=>sb.from(t).upsert(r,oc?{onConflict:oc}:undefined));
window.dbDeleteSchedule=async(y,m)=>blocked('schedules')||run(()=>sb.from('schedules').delete().eq('year',y).eq('month',m));
window.persistSchedule=(y,m,r)=>dbUpsert('schedules',{year:y,month:m,days:r.days,calendar:r.calendar,month_ps:r.monthPS,month_m:r.monthM,logs:r.logs,end_queue:r.endQueue,end_cur:r.endCur},'year,month');
{ const o=window.setCutiBalance; window.setCutiBalance=function(...a){ if(_noBal) return; return o(...a); }; }

/* ---------- 2. Snapshot jadwal + daftar pengajuan per bulan ---------- */
function snapLists(y,m){ const f=l=>l.filter(x=>x.month===m&&x.year===y); return clone({cuti:f(cutiList),kuning:f(kuningList),locked:f(lockedList),swap:f(swapList)}); }
function restoreLists(s,y,m){ if(!s) return; const rep=(l,a)=>l.filter(x=>!(x.month===m&&x.year===y)).concat(clone(a)||[]);
  cutiList=rep(cutiList,s.cuti); kuningList=rep(kuningList,s.kuning); lockedList=rep(lockedList,s.locked); swapList=rep(swapList,s.swap); }
const makeSnapshot=(y,m,a)=>({y,m,sched:clone(schedules[skey(y,m)])||null,lists:snapLists(y,m),actionName:a,timestamp:nowStr()});
const sig=(y,m)=>JSON.stringify([schedules[skey(y,m)]||null,snapLists(y,m)]);
const bumpId=()=>{ nextId=Math.max(nextId,...[...cutiList,...kuningList,...lockedList,...swapList].map(x=>x.id+1),1); };

window.getHistory=function(y,m){ if(isPreviewActive(y,m)) return previewScheduleState.history;
  const k=skey(y,m); return scheduleHistory[k]||(scheduleHistory[k]={undo:[],redo:[]}); };
function pushUndo(s){ const h=getHistory(s.y,s.m); h.undo.push(s); if(h.undo.length>25) h.undo.shift(); h.redo=[]; updateUndoRedoButtons(); }
window.recordScheduleAction=function(y,m,n){ if(_suppress||_rl) return; _rl=true; Promise.resolve().then(()=>{_rl=false;}); pushUndo(makeSnapshot(y,m,n)); };

const ROW={
  cuti:{t:'cuti_requests',r:r=>({id:r.id,personnel_id:r.personnelId,start_day:r.start,end_day:r.end,reason:r.reason||null,status:r.status,month:r.month,year:r.year})},
  kuning:{t:'kuning_requests',r:r=>({id:r.id,personnel_id:r.personnelId,start_day:r.start,end_day:r.end,status:r.status,month:r.month,year:r.year})},
  locked:{t:'locked_slots',r:r=>({id:r.id,personnel_id:r.personnelId,date:r.date,slot:r.slot,reason:r.reason||null,month:r.month,year:r.year})},
  swap:{t:'swap_requests',r:r=>({id:r.id,requester_id:r.requesterId,date:r.date,slot:r.slot,partner_id:r.partnerId,reason:r.reason||null,status:r.status,month:r.month,year:r.year})}
};
async function syncListsToDb(from,to){   // idempoten (upsert) → aman di-retry bila Submit gagal separuh jalan
  if(!from||!to) return true; let ok=true;
  for(const k of Object.keys(ROW)){
    const {t,r}=ROW[k], a=new Map((from[k]||[]).map(x=>[x.id,x])), b=new Map((to[k]||[]).map(x=>[x.id,x]));
    for(const [id] of a) if(!b.has(id)) ok=(await dbDelete(t,id))&&ok;
    for(const [id,x] of b) if(!a.has(id)||JSON.stringify(a.get(id))!==JSON.stringify(x)) ok=(await dbUpsert(t,r(x),'id'))&&ok;
  }
  return ok;
}
async function applySnapshot(y,m,s){
  const before=snapLists(y,m); restoreLists(s.lists,y,m);
  if(s.sched) schedules[skey(y,m)]=clone(s.sched); else delete schedules[skey(y,m)];
  if(previewScheduleState) previewScheduleState.sched=schedules[skey(y,m)]||null;
  else{ if(s.sched) await persistSchedule(y,m,s.sched); else await dbDeleteSchedule(y,m); await syncListsToDb(before,snapLists(y,m)); }
  persistDraft(); renderAll();
}
window.undoSchedule=async function(y,m){ if(!isAdmin()||!canUndo(y,m)) return; const h=getHistory(y,m),s=h.undo.pop(); h.redo.push(makeSnapshot(y,m,s.actionName)); await applySnapshot(y,m,s); toast(`↶ Undo: "${s.actionName}"`); };
window.redoSchedule=async function(y,m){ if(!isAdmin()||!canRedo(y,m)) return; const h=getHistory(y,m),s=h.redo.pop(); h.undo.push(makeSnapshot(y,m,s.actionName)); await applySnapshot(y,m,s); toast(`↷ Redo: "${s.actionName}"`); };

/* ---------- 3. Sesi draft ---------- */
function startDraft(y,m,desc){
  const cur=schedules[skey(y,m)]||null;
  previewScheduleState={year:y,month:m,sched:cur,originalSched:clone(cur),originalLists:snapLists(y,m),history:{undo:[],redo:[]},checkpoint:null,actionDesc:desc||`Perubahan jadwal ${monthNames[m-1]} ${y}`};
}
function gate(y,m){   // 'none' | 'draft' | 'new' | false
  if(!isAdmin()) return 'none';
  if(previewScheduleState){
    if(previewScheduleState.year===y&&previewScheduleState.month===m) return 'draft';
    toast(`Submit atau batalkan draft ${monthNames[previewScheduleState.month-1]} dulu.`); return false;
  }
  if(!schedules[skey(y,m)]) return 'none';
  startDraft(y,m); return 'new';
}
window.enterSchedulePreview=function(y,m,d,desc){
  if(isPreviewActive(y,m)) pushUndo(makeSnapshot(y,m,'Generate ulang (draft)')); else startDraft(y,m,desc);
  previewScheduleState.sched=d; schedules[skey(y,m)]=d; persistDraft(); renderAll();
  toast('📌 Mode DRAFT: perubahan belum masuk database sampai Anda Submit.');
};
window.commitSchedulePreview=async function(y,m){
  if(!isPreviewActive(y,m)) return;
  const st=previewScheduleState, fs=schedules[skey(y,m)], fl=snapLists(y,m);
  previewScheduleState=null; dbFail=0;                                   // buka blokir tulis
  let ok=fs?await persistSchedule(y,m,fs):await dbDeleteSchedule(y,m);
  ok=(await syncListsToDb(st.originalLists,fl))&&ok;
  if(!ok||dbFail){ previewScheduleState=st; renderAll(); toast('⚠ Gagal menyimpan ke database. Draft DIPERTAHANKAN — periksa koneksi lalu Submit lagi.'); return; }
  clearDraftStore();
  const h=getHistory(y,m); h.undo.push({y,m,sched:st.originalSched,lists:st.originalLists,actionName:st.actionDesc,timestamp:nowStr()}); h.redo=[];
  let n=nextMonthYear(y,m), last=fs;
  while(last&&schedules[skey(n.y,n.m)]){
    const ex=schedules[skey(n.y,n.m)], dv=deriveInitStateFromPrev(last,n.y,n.m);
    const r=generateSchedule(n.y,n.m,dv?dv.initQueue:last.endQueue,dv?dv.initCur:last.endCur,ex,null,dv?dv.carry:null,false);
    schedules[skey(n.y,n.m)]=r; await persistSchedule(n.y,n.m,r); last=r; n=nextMonthYear(n.y,n.m);
  }
  renderAll(); toast(`✅ FINAL: jadwal ${monthNames[m-1]} ${y} tersimpan di database.`);
};
function parkDraft(){ const st=previewScheduleState; if(!st) return; persistDraft(); restoreLists(st.originalLists,st.year,st.month);
  if(st.originalSched) schedules[skey(st.year,st.month)]=st.originalSched; else delete schedules[skey(st.year,st.month)]; previewScheduleState=null; }
window.cancelSchedulePreview=function(y,m){ if(!isPreviewActive(y,m)) return; parkDraft(); clearDraftStore(); renderAll(); toast('Draft dibuang. Kembali ke jadwal FINAL.'); };
window.draftCheckpoint=function(){ const s=previewScheduleState; if(!s) return; s.checkpoint=makeSnapshot(s.year,s.month,'Titik simpan'); persistDraft(); renderAll(); toast('💾 Titik simpan dibuat.'); };
window.draftToCheckpoint=async function(){ const s=previewScheduleState; if(!s||!s.checkpoint) return; pushUndo(makeSnapshot(s.year,s.month,'Sebelum ke titik simpan')); await applySnapshot(s.year,s.month,s.checkpoint); toast('↩ Kembali ke titik simpan.'); };
window.draftDiscard=function(){ const s=previewScheduleState; if(s&&confirm('Buang SEMUA perubahan draft dan kembali ke jadwal FINAL?')) cancelSchedulePreview(s.year,s.month); };

function clearDraftStore(){ try{sessionStorage.removeItem(DK);}catch(e){} }
function persistDraft(){
  const s=previewScheduleState; if(!s){ clearDraftStore(); return; }
  const b={year:s.year,month:s.month,sched:schedules[skey(s.year,s.month)]||null,originalSched:s.originalSched,originalLists:s.originalLists,actionDesc:s.actionDesc,lists:snapLists(s.year,s.month),checkpoint:s.checkpoint};
  try{ sessionStorage.setItem(DK,JSON.stringify({...b,history:{undo:s.history.undo.slice(-8),redo:s.history.redo.slice(-8)}})); }
  catch(e){ try{ sessionStorage.setItem(DK,JSON.stringify({...b,history:{undo:[],redo:[]}})); }catch(_){} }
}
function restoreDraft(){
  if(previewScheduleState) return;
  try{ const raw=sessionStorage.getItem(DK); if(!raw) return; const p=JSON.parse(raw);
    previewScheduleState={year:p.year,month:p.month,sched:p.sched,originalSched:p.originalSched,originalLists:p.originalLists,history:p.history||{undo:[],redo:[]},checkpoint:p.checkpoint,actionDesc:p.actionDesc};
    restoreLists(p.lists,p.year,p.month); bumpId();
    if(p.sched) schedules[skey(p.year,p.month)]=p.sched; else delete schedules[skey(p.year,p.month)];
    viewY=p.year; viewM=p.month; selYear.value=p.year; renderAll(); toast('📌 Draft sebelumnya dipulihkan.');
  }catch(e){ clearDraftStore(); }
}
{ const o=window.enterApp; window.enterApp=function(r){ if(r!=='admin'&&previewScheduleState) parkDraft(); o(r); if(r==='admin') restoreDraft(); }; }
{ const o=window.logout; window.logout=function(){ if(previewScheduleState&&!confirm('Ada draft yang belum di-Submit (disimpan sementara di sesi ini). Tetap logout?')) return; parkDraft(); o(); };
  const b=document.getElementById('menuLogout'); if(b){ const nb=b.cloneNode(true); b.replaceWith(nb); nb.addEventListener('click',()=>window.logout()); } }
window.addEventListener('beforeunload',e=>{ if(previewScheduleState){ e.preventDefault(); e.returnValue=''; } });

/* ---------- 4. Generate (otomatis) ---------- */
window.computeGeneratedSchedule=function(y,m,td,ff,useOrig){
  const pv=prevMonthYear(y,m), prev=schedules[skey(pv.y,pv.m)];
  const ex=(useOrig&&isPreviewActive(y,m))?(previewScheduleState.originalSched||schedules[skey(y,m)]):schedules[skey(y,m)];
  let iq=null,ic=null,cr=null;
  if(prev&&prev.calendar&&prev.calendar.length){ const d=deriveInitStateFromPrev(prev,y,m); if(d){ ic=d.initCur; iq=d.initQueue; cr=d.carry; } }
  const res=generateSchedule(y,m,iq,ic,ex,td,cr,ff);
  res.logs.unshift({type:'info',text:prev?`Rotasi disambung dari profil minggu terakhir ${monthNames[pv.m-1]} ${pv.y}.`:`${monthNames[m-1]} ${y} dimulai dari urutan antrian awal.`});
  return res;
};
function doGenerate(fromAdmin){
  const y=viewY,m=viewM;
  if(previewScheduleState&&!isPreviewActive(y,m)){ toast('Submit atau batalkan draft bulan lain dulu.'); return; }
  if(isPreviewActive(y,m)&&previewScheduleState.history.undo.length&&!confirm('Generate ulang akan menimpa edit sel manual di draft (masih bisa di-Undo). Lanjut?')) return;
  let ff=false;
  if(schedules[skey(y,m)]) ff=confirm(`Jadwal ${monthNames[m-1]} ${y} sudah ada.\n\nOK = GENERATE ULANG PENUH dari antrian (tgl 1 s/d hari ini tetap terkunci).\nBatal = penyesuaian lokal.\n\nHasil masuk DRAFT, belum tersimpan.`);
  const d=computeGeneratedSchedule(y,m,null,ff,true); if(fromAdmin) hideAdminPage();
  enterSchedulePreview(y,m,d,`Generate jadwal ${monthNames[m-1]}`);
}
['btnGenerate','btnAdminGenerate'].forEach(id=>{ const b=document.getElementById(id); if(!b) return; const nb=b.cloneNode(true); b.replaceWith(nb); nb.addEventListener('click',()=>doGenerate(id==='btnAdminGenerate')); });

/* ---------- 5. Semua aksi admin → draft ---------- */
function splitAtDay(kind,pid,day,m,y){
  const list=kind==='cuti'?cutiList:kuningList;
  const i=list.findIndex(c=>c.personnelId===pid&&c.month===m&&c.year===y&&c.status==='approved'&&day>=c.start&&day<=c.end);
  if(i<0) return; const c=list[i]; if(c.start===c.end) return; const parts=[];
  if(c.start<day) parts.push({...c,start:c.start,end:day-1});
  parts.push({...c,start:day,end:day});
  if(c.end>day) parts.push({...c,start:day+1,end:c.end});
  parts.forEach((p,k)=>{ p.id=k===0?c.id:nextId++; }); list.splice(i,1,...parts);
}
function wrapOp(name,ymOf,label,opts){
  opts=opts||{}; const orig=window[name];
  window[name]=async function(...args){
    const ym=ymOf(...args); if(!ym) return orig.apply(this,args);
    const g=gate(ym.y,ym.m); if(g===false) return; if(g==='none') return orig.apply(this,args);
    const before=makeSnapshot(ym.y,ym.m,label(...args)), s0=sig(ym.y,ym.m);
    if(opts.pre) opts.pre(...args);
    const oc=window.confirm, ob=_noBal;
    if(opts.noConfirm) window.confirm=()=>true; if(opts.noBal) _noBal=true; _suppress=true;
    try{ const r=orig.apply(this,args); if(r&&r.then) await r; } finally{ window.confirm=oc; _noBal=ob; _suppress=false; }
    if(previewScheduleState&&sig(ym.y,ym.m)!==s0){ pushUndo(before); persistDraft(); }
    else if(g==='new'&&previewScheduleState&&!previewScheduleState.history.undo.length){ previewScheduleState=null; clearDraftStore(); }
    renderAll(); if(opts.arm) armForce(opts.arm(...args),label(...args));
  };
}
function armForce(box,label){   // aksi yang baru jalan setelah centang "Tetap ajukan/kunci"
  if(!box||box.dataset.armed) return; box.dataset.armed='1';
  box.addEventListener('change',e=>{
    if(!(e.target.type==='checkbox'&&e.target.checked)) return;
    const y=viewY,m=viewM,g=gate(y,m); if(g===false||g==='none') return;
    const before=makeSnapshot(y,m,label), s0=sig(y,m), oc=window.confirm; window.confirm=()=>true; _suppress=true;
    setTimeout(()=>{ _suppress=false; window.confirm=oc;
      if(previewScheduleState&&sig(y,m)!==s0){ pushUndo(before); persistDraft(); }
      else if(g==='new'&&previewScheduleState&&!previewScheduleState.history.undo.length){ previewScheduleState=null; clearDraftStore(); }
      renderAll(); },0);
  },true);
}
const itemYM=(k,id)=>{ const it=getList(k).find(x=>x.id===id); return it?{y:it.year,m:it.month}:null; };
const curYM=()=>({y:viewY,m:viewM}), rtYM=()=>{ const r=realToday(); return {y:r.y,m:r.m}; };
{ const o=window.approveTogether; window.approveTogether=function(k,ids){
    const its=(ids||[]).map(id=>getList(k).find(x=>x.id===id)).filter(Boolean);
    if(new Set(its.map(i=>i.year+'-'+i.month)).size>1){ toast('Pengajuan beda bulan: setujui per bulan.'); return; } return o(k,ids); }; }
{ const o=window.addSwap; window.addSwap=function(s){   // tukar dinas selalu untuk bulan berjalan, bukan bulan yang sedang dilihat
    const y=viewY,m=viewM,r=realToday(); viewY=r.y; viewM=r.m; try{ return o(s); } finally{ viewY=y; viewM=m; } }; }
wrapOp('setStatus',(k,id)=>itemYM(k,id),(k,id)=>{ const it=getList(k).find(x=>x.id===id); return `${reqLabel(k)} ${it?reqPartyName(k,it):''}`; },{noConfirm:true});
wrapOp('removeReq',(k,id)=>itemYM(k,id),k=>`Hapus ${reqLabel(k)}`);
wrapOp('removeLock',id=>{ const l=lockedList.find(x=>x.id===id); return l?{y:l.year,m:l.month}:null; },()=>'Hapus lock');
wrapOp('approveTogether',(k,ids)=>itemYM(k,(ids||[])[0]),(k,ids)=>`${(ids||[]).length} ${reqLabel(k)} sekaligus`,{noConfirm:true});
wrapOp('addCutiByCtx',curYM,()=>'Tambah cuti',{noConfirm:true,arm:uid=>document.getElementById('reqWarn_'+uid)});
wrapOp('addKuningByCtx',curYM,()=>'Tambah kuning',{noConfirm:true,arm:uid=>document.getElementById('reqWarn_'+uid)});
wrapOp('addLock',curYM,()=>'Tambah lock',{arm:()=>document.getElementById('lockWarn')});
wrapOp('addSwap',rtYM,()=>'Tukar dinas');
wrapOp('saveManualEdit',()=>manualEditState?{y:manualEditState.year,m:manualEditState.month}:null,
  ()=>manualEditState?`Ubah shift ${getPerson(manualEditState.pid).name} tgl ${manualEditState.day}`:'Ubah shift',
  {noBal:true,pre:()=>{ const s=manualEditState; if(!s) return;
    if(s.selectedMode!=='CUTI') splitAtDay('cuti',s.pid,s.day,s.month,s.year);
    if(s.selectedMode!=='KUNING') splitAtDay('kuning',s.pid,s.day,s.month,s.year); }});
{ const o=window.createBlankSchedule; window.createBlankSchedule=function(y,m){
    if(!isAdmin()) return; if(previewScheduleState&&!isPreviewActive(y,m)){ toast('Submit atau batalkan draft bulan lain dulu.'); return; }
    if(!previewScheduleState) startDraft(y,m,`Buat jadwal manual ${monthNames[m-1]} ${y}`);
    _suppress=true; try{ o(y,m); } finally{ _suppress=false; } previewScheduleState.sched=schedules[skey(y,m)]; persistDraft(); renderAll(); }; }
window.resetSchedule=function(y,m){   // reset = kosongkan di DRAFT; DB terhapus hanya setelah Submit
  if(!isAdmin()) return; const g=gate(y,m); if(g===false) return;
  if(!schedules[skey(y,m)]){ toast('Jadwal bulan ini memang belum dibuat.'); return; }
  if(!confirm(`Kosongkan jadwal ${monthNames[m-1]} ${y} di DRAFT?\nDatabase baru terhapus setelah Anda Submit.`)){
    if(g==='new'){ previewScheduleState=null; clearDraftStore(); } return; }
  pushUndo(makeSnapshot(y,m,'Reset jadwal')); delete schedules[skey(y,m)]; previewScheduleState.sched=null; persistDraft(); renderAll();
};

/* ---------- 6. Kunci navigasi & cetak saat draft ---------- */
const mt=document.getElementById('monthTabs');
if(mt) mt.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('.mtab'); if(!b||!previewScheduleState) return;
  if(!(previewScheduleState.year===viewY&&previewScheduleState.month===parseInt(b.dataset.m))){ e.stopImmediatePropagation(); toast('Submit atau batalkan draft dulu sebelum pindah bulan.'); } },true);
selYear.addEventListener('change',e=>{ if(previewScheduleState){ e.stopImmediatePropagation(); selYear.value=viewY; toast('Submit atau batalkan draft dulu.'); } },true);
{ const o=window.printSchedule; window.printSchedule=function(y,m){
    if(previewScheduleState&&!(previewScheduleState.year===y&&previewScheduleState.month===m)){ toast('Submit atau batalkan draft dulu sebelum mencetak bulan lain.'); return; } o(y,m); }; }

/* ---------- 7. Personel: pengajuan yang sudah disetujui hanya bisa dibatalkan admin ---------- */
{ const o=window.submitUserRequest; window.submitUserRequest=async function(){ const s=userRequestState;
    if(s){ const x=s.selectedMode==='CUTI'?s.existingKuning:s.existingCuti; if(x&&x.status==='approved'){ alert('Pengajuan tanggal ini sudah DISETUJUI admin; jenisnya tidak bisa diganti.'); return; } } return o(); }; }
{ const o=window.cancelUserRequest; window.cancelUserRequest=async function(){ const s=userRequestState,t=s&&(s.existingCuti||s.existingKuning);
    if(t&&t.status==='approved'){ alert('Sudah disetujui admin. Pembatalan lewat admin.'); return; } return o(); }; }
{ const o=window.renderUserRequestPanel; window.renderUserRequestPanel=function(a){ o(a); const s=userRequestState,t=s&&(s.existingCuti||s.existingKuning),b=a.querySelector('#btnCancelUserReq');
    if(b&&t&&t.status==='approved'){ b.textContent='🔒 Sudah disetujui — hubungi admin'; b.disabled=true; } }; }

/* ---------- 8. Tampilan DRAFT vs FINAL ---------- */
// (CSS draft ada di index.html)

/* Tampilan sel versi FINAL = jadwal asli + daftar cuti/kuning/lock/tukar asli (sebelum draft) */
function finalCellInfo(day,pid){
  const st=previewScheduleState; if(!st||!st.originalSched) return null;
  const y=st.year,m=st.month,o=st.originalLists||{},keep=[cutiList,kuningList,lockedList,swapList];
  const rest=l=>l.filter(x=>!(x.month===m&&x.year===y));
  cutiList=rest(cutiList).concat(clone(o.cuti)||[]); kuningList=rest(kuningList).concat(clone(o.kuning)||[]);
  lockedList=rest(lockedList).concat(clone(o.locked)||[]); swapList=rest(swapList).concat(clone(o.swap)||[]);
  try{ return computeCell(day,pid,st.originalSched.calendar[day-1],m,y); }
  finally{ [cutiList,kuningList,lockedList,swapList]=keep; }
}
const cellTxt=i=>i.label+(/locked/.test(i.cls)?' 🔒':'')+(/swapped/.test(i.cls)?' ⇄':'')+(/replacement/.test(i.cls)?' (pengganti)':'');
function cellKind(i){ const c=i.cls||'';
  if(/slot-cuti/.test(c)) return 'cuti'; if(/slot-kuning/.test(c)) return 'kuning';
  if(/slot-swap|swapped/.test(c)) return 'swap'; if(/locked/.test(c)) return 'lock'; return 'shift'; }
const KIND_LABEL={shift:'Shift/libur manual',cuti:'Cuti',kuning:'Kuning',lock:'Lock admin',swap:'Tukar dinas'};
const KIND_COLOR={shift:'#E8590C',cuti:'#C2255C',kuning:'#0B7285',lock:'#364FC7',swap:'#2B8A3E'};
function cellDiffs(){
  const st=previewScheduleState,out=[]; if(!st||!st.originalSched) return out;
  const s=schedules[skey(st.year,st.month)]; if(!s) return out;
  for(let d=1;d<=s.days;d++) personnel.forEach(p=>{
    const a=finalCellInfo(d,p.id), b=computeCell(d,p.id,s.calendar[d-1],st.month,st.year); if(!a||!b) return;
    if(a.cls===b.cls&&a.label===b.label) return;
    const kb=cellKind(b), ka=cellKind(a);
    out.push({d,pid:p.id,from:cellTxt(a),to:cellTxt(b),kind:kb!=='shift'?kb:ka!=='shift'?ka:'shift'}); });
  return out;
}
const legendHtml=()=>Object.keys(KIND_LABEL).map(k=>`<span style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px;color:var(--ink-soft);white-space:nowrap"><i style="width:10px;height:10px;border-radius:2px;border:2.5px solid ${KIND_COLOR[k]};display:inline-block"></i>${KIND_LABEL[k]}</span>`).join('');
function listRows(){
  const st=previewScheduleState,y=st.year,m=st.month,o=st.originalLists||{},rows=[],cur={cuti:cutiList,kuning:kuningList,locked:lockedList,swap:swapList};
  ['cuti','kuning','locked','swap'].forEach(k=>{
    const old=new Map((o[k]||[]).map(x=>[x.id,x])), now=cur[k].filter(x=>x.month===m&&x.year===y);
    now.forEach(x=>{ const isNew=!old.has(x.id), chg=!isNew&&JSON.stringify(old.get(x.id))!==JSON.stringify(x);
      if(!isNew&&!chg&&!(k==='swap'&&x.status==='approved')) return;
      const tx=(k==='cuti'||k==='kuning')?`${nm(x.personnelId)} · ${fmtRange(x)} · ${k} ${x.status}`:k==='locked'?`${nm(x.personnelId)} · tgl ${x.date} · lock ${x.slot}`:`${nm(x.requesterId)} ⇄ ${nm(x.partnerId)} · tgl ${x.date} · ${x.slot} (${x.status})`;
      rows.push({k,id:x.id,tx,isNew:isNew||chg,del:true,d:x.start||x.date,pid:x.personnelId!=null?x.personnelId:x.requesterId}); });
    old.forEach((x,id)=>{ if(!now.some(n=>n.id===id)) rows.push({k,id,tx:`<s>${k} ${nm(x.personnelId!=null?x.personnelId:x.requesterId)}</s> (dihapus di draft)`,isNew:true,del:false}); });
  });
  return rows;
}
window.draftFlash=function(d,p){ const td=document.querySelector(`#calWrap td[data-day="${d}"][data-pid="${p}"]`); if(!td) return;
  td.scrollIntoView({block:'center',inline:'center',behavior:'smooth'}); td.classList.add('flash'); setTimeout(()=>td.classList.remove('flash'),2000); };
window.draftDel=function(k,id){ if(k==='locked') removeLock(id); else removeReq(k,id); };
window.draftTabSet=function(t){ draftTab=t; renderDraftPanel(); };
const swapsOf=(y,m)=>swapList.filter(s=>s.year===y&&s.month===m&&s.status==='approved');
function markSwaps(w,y,m){ swapsOf(y,m).forEach((s,i)=>{ const c=PAL[i%PAL.length],n=i+1;
  [s.requesterId,s.partnerId].forEach(pid=>{ const td=w.querySelector(`td[data-day="${s.date}"][data-pid="${pid}"]`); if(!td) return;
    td.style.boxShadow=`inset 0 0 0 3px ${c}`; td.title+=` · Tukar dinas #${n}: ${getPerson(s.requesterId).name} ⇄ ${getPerson(s.partnerId).name}`;
    td.insertAdjacentHTML('beforeend',`<span class="swn" style="background:${c}">${n}</span>`); }); }); }
function markChanged(w){ cellDiffs().forEach(x=>{ const td=w.querySelector(`td[data-day="${x.d}"][data-pid="${x.pid}"]`); if(td){ td.classList.add('chg','chg-'+x.kind); td.title+=` · ${KIND_LABEL[x.kind]} · FINAL: ${x.from} → DRAFT: ${x.to}`; } }); }
function renderDraftPanel(){
  const host=document.getElementById('draftPanel'); if(!host||!previewScheduleState) return;
  const st=previewScheduleState,y=st.year,m=st.month,cells=cellDiffs(),rows=listRows();
  const tabs=[['all','Semua'],['cell','Sel manual'],['cuti','Cuti'],['kuning','Kuning'],['locked','Lock'],['swap','Tukar dinas']];
  const cnt=t=>t==='all'?cells.length+rows.filter(r=>r.isNew).length:t==='cell'?cells.length:rows.filter(r=>r.k===t&&(t==='swap'||r.isNew)).length;
  const cellRow=x=>`<div class="dp-row"><span class="dp-dot" style="background:${KIND_COLOR[x.kind]}"></span><span class="tx">${nm(x.pid)} · tgl ${x.d}: <b>${x.from}</b> → <b>${x.to}</b></span><button class="small ghost" onclick="draftFlash(${x.d},${x.pid})">Sorot</button></div>`;
  const listRow=r=>{ const sw=r.k==='swap'?swapsOf(y,m).findIndex(s=>s.id===r.id):-1;
    return `<div class="dp-row">${sw>=0?`<span class="dp-dot" style="background:${PAL[sw%PAL.length]}"></span>`:''}<span class="tx">${sw>=0?`#${sw+1} `:''}${r.tx} ${r.isNew?'<span class="dp-new">draft</span>':''}</span>`
      +(r.d&&r.pid!=null?`<button class="small ghost" onclick="draftFlash(${r.d},${r.pid})">Sorot</button>`:'')+(r.del&&r.isNew?`<button class="small reject-btn" onclick="draftDel('${r.k}',${r.id})">Hapus</button>`:'')+`</div>`; };
  let body=draftTab==='cell'?cells.slice(0,80).map(cellRow).join(''):draftTab==='all'?rows.filter(r=>r.isNew).map(listRow).join('')+cells.slice(0,80).map(cellRow).join(''):rows.filter(r=>r.k===draftTab&&(draftTab==='swap'||r.isNew)).map(listRow).join('');
  host.innerHTML=`<div style="font-weight:700;font-size:13px;color:#92400E;margin-bottom:8px">📌 Perubahan DRAFT vs FINAL — ${monthNames[m-1]} ${y}</div>
    <div class="dp-tabs">${tabs.map(([t,l])=>`<button class="dp-tab ${draftTab===t?'on':''}" onclick="draftTabSet('${t}')">${l} (${cnt(t)})</button>`).join('')}</div>
    ${body||'<div class="note">Belum ada perubahan di kategori ini.</div>'}${cells.length>80?'<div class="note">Menampilkan 80 sel pertama.</div>':''}`;
}
function decorate(){
  const y=viewY,m=viewM,w=document.getElementById('calWrap'),draft=isAdmin()&&isPreviewActive(y,m);
  document.body.classList.toggle('is-draft',!!previewScheduleState&&isAdmin());
  if(!w||!schedules[skey(y,m)]) return;
  markSwaps(w,y,m);
  const t3=document.querySelector('#scheduleArea .sched-title .t3');
  if(t3) t3.insertAdjacentHTML('afterend',draft?`<div><span class="st-chip draft">✏️ DRAFT — belum disimpan ke database</span></div>`:`<div><span class="st-chip final">✔ FINAL — sudah di database</span></div>`);
  if(!draft) return;
  markChanged(w);
  const bn=document.querySelector('#scheduleArea > .preview-banner'); if(bn) bn.remove();
  const row=document.querySelector('#scheduleArea .admin-tip-row');
  if(row){
    const nc=cellDiffs().length,nl=listRows().filter(r=>r.isNew).length;
    row.classList.add('is-draft-row');
    row.insertAdjacentHTML('beforeend',`<span class="pb-tag">✏️ DRAFT</span><span class="pb-count">${nc} sel${nl?` · ${nl} pengajuan`:''}</span><span class="pb-legend">${legendHtml()}</span>
      <span class="pb-actions">
        <button type="button" class="pb-btn pb-discard" title="Buang SEMUA perubahan draft dan kembali ke jadwal FINAL" onclick="draftDiscard()">Kembali ke awal</button>
        <button type="button" class="pb-btn pb-submit" onclick="commitSchedulePreview(${y},${m})">✔ Submit</button>
      </span>`);
    // pindahkan tombol Undo ke grup tombol kanan, tepat sebelum "Kembali ke awal"
    const ub=row.querySelector('button[onclick^="undoSchedule"]'), acts=row.querySelector('.pb-actions'), dis=row.querySelector('.pb-discard');
    if(ub&&acts&&dis){ const wrap=ub.parentElement; ub.removeAttribute('style'); ub.className='pb-btn ghost'; acts.insertBefore(ub,dis); if(wrap&&wrap!==row&&!wrap.children.length) wrap.remove(); }
  }
  const blk=document.querySelector('#scheduleArea .sched-block'); if(blk){ const p=document.createElement('div'); p.id='draftPanel'; blk.appendChild(p); renderDraftPanel(); }
}
{ const o=window.renderScheduleArea; window.renderScheduleArea=function(){ o(); decorate(); }; }
function updateDraftBar(){
  const bar=document.getElementById('draftBar'); if(!bar) return;
  const st=previewScheduleState; document.body.classList.toggle('is-draft',!!st&&isAdmin());
  if(!st||!isAdmin()){ bar.style.display='none'; return; }
  const nc=cellDiffs().length,nl=listRows().filter(r=>r.isNew).length;
  bar.style.display='none'; return;
  bar.innerHTML=`<span>✏️ <b>DRAFT ${monthNames[st.month-1]} ${st.year}</b> · ${nc} sel berubah${nl?` · ${nl} pengajuan/lock`:''} · belum disimpan</span>
    <button class="ok-btn" onclick="commitSchedulePreview(${st.year},${st.month})">Submit ke database</button>
    <button class="ghost" onclick="draftDiscard()" style="color:#B91C1C;border-color:#F87171">Kembali ke awal</button>`;
}
{ const o=window.renderAll; window.renderAll=function(){ o(); updateDraftBar(); }; }
updateDraftBar();
})();

// ============================================================
// SoftStock — app logic (Supabase backend)
// ============================================================
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TYPES = ['Napkins','Facial Tissue','Toilet Paper','Towels','Dispenser','Spunlace','Other'];
const TYPE_COLOR = {
  'Napkins':'#3b82f6','Facial Tissue':'#8b5cf6','Toilet Paper':'#f59e0b',
  'Towels':'#0F6E56','Dispenser':'#f97316','Spunlace':'#06b6d4','Other':'#6b7280'
};

let me = null;          // { id, email }
let myProfile = null;   // { full_name, role }
let products = [];
let stockLog = [];      // last 60 days, joined with product name client-side
let suppliers = [];
let deliveries = [];
let levelsTypeFilter = '';

// ---------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------
function showAuthForm(mode){
  const signIn = document.getElementById('signInForm');
  const signUp = document.getElementById('signUpForm');
  const a = document.getElementById('toggleToSignUp');
  const b = document.getElementById('toggleToSignIn');
  if(mode==='signup'){ signIn.classList.add('hidden'); signUp.classList.remove('hidden'); a.classList.add('hidden'); b.classList.remove('hidden'); }
  else { signUp.classList.add('hidden'); signIn.classList.remove('hidden'); b.classList.add('hidden'); a.classList.remove('hidden'); }
}

document.getElementById('signInForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const email = document.getElementById('si-email').value.trim();
  const password = document.getElementById('si-password').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  document.getElementById('siError').textContent = error ? humanAuthError(error) : '';
});

document.getElementById('signUpForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const full_name = document.getElementById('su-name').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const password = document.getElementById('su-password').value;
  const { error } = await sb.auth.signUp({ email, password, options:{ data:{ full_name } } });
  const err = document.getElementById('suError');
  if(error){ err.textContent = humanAuthError(error); return; }
  err.style.color='var(--green)';
  err.textContent = 'Готово — проверьте почту для подтверждения (если требуется), затем войдите.';
});

function humanAuthError(error){
  const m = error.message||'';
  if(m.includes('Invalid login')) return 'Неверный email или пароль';
  if(m.includes('already registered')) return 'Этот email уже зарегистрирован';
  return m;
}

async function signOut(){ await sb.auth.signOut(); }

sb.auth.onAuthStateChange(async (_event, session)=>{
  if(session && session.user){
    me = session.user;
    await loadProfile();
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('whoName').textContent = myProfile?.full_name || me.email;
    document.getElementById('whoRole').textContent = roleLabel(myProfile?.role);
    applyRoleNav();
    await refreshAll();
    if(myProfile?.role==='restricted') showPane('reservations');
  } else {
    me = null; myProfile = null;
    document.getElementById('app').classList.add('hidden');
    document.getElementById('authScreen').classList.remove('hidden');
  }
});

const RESTRICTED_PAGES = ['reservations','levels','deliveries'];

function applyRoleNav(){
  const restricted = myProfile?.role==='restricted';
  document.querySelectorAll('.nav-item').forEach(el=>{
    el.style.display = (!restricted || RESTRICTED_PAGES.includes(el.dataset.pane)) ? '' : 'none';
  });
  document.querySelectorAll('.nav-group-label').forEach(el=>{ el.style.display = restricted ? 'none' : ''; });
}

function roleLabel(r){
  return r==='admin' ? '👑 Администратор' : r==='restricted' ? '👁 Только просмотр' : '👤 Пользователь';
}

async function loadProfile(){
  const { data, error } = await sb.from('profiles').select('full_name, role').eq('id', me.id).single();
  if(!error) myProfile = data;
}

function canEdit(){ return myProfile && myProfile.role !== 'restricted'; }

// ---------------------------------------------------------------
// NAV
// ---------------------------------------------------------------
function showPane(name){
  if(myProfile?.role==='restricted' && !RESTRICTED_PAGES.includes(name)) name = 'reservations';
  document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('pane-'+name).classList.add('active');
  document.querySelector('.nav-item[data-pane="'+name+'"]').classList.add('active');
  document.querySelector('.main')?.scrollTo(0,0);
  if(window.innerWidth<=820) toggleSidebar(false);
}

function toggleSidebar(force){
  const sb = document.getElementById('appSidebar');
  const ov = document.getElementById('sidebarOverlay');
  if(!sb) return;
  const open = typeof force==='boolean' ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  ov?.classList.toggle('show', open);
}
// ---------------------------------------------------------------
// DATA LOADING
// ---------------------------------------------------------------
async function refreshAll(){
  await Promise.all([loadProducts(), loadSuppliers(), loadDeliveries(), loadStockLog(), loadReservations()]);
  fillProductSelects();
  fillSupplierSelect();
  renderDashboard();
  renderLevels();
  renderHistory();
  renderForecast();
  renderOrders();
  renderDeliveries();
  renderProducts();
  renderSuppliers();
  filterResProductDropdown();
  renderReservations();
  document.getElementById('se-date').value = todayISO();
  document.getElementById('lvlAsOf').value = todayISO();
  document.getElementById('dv-date').value = todayISO();
  document.getElementById('res-date').value = todayISO();
}

async function loadProducts(){
  const { data, error } = await sb.from('products').select('*').order('type').order('name');
  if(error){ toast('Ошибка загрузки товаров: '+error.message, true); return; }
  products = data||[];
}
async function loadSuppliers(){
  const { data } = await sb.from('suppliers').select('*').order('name');
  suppliers = data||[];
}
async function loadDeliveries(){
  const { data } = await sb.from('deliveries').select('*, products(name,type,width_cm,ply,gsm), suppliers(name)').order('created_at',{ascending:false});
  deliveries = data||[];
}
async function loadStockLog(){
  // wide enough to cover Jan 1 of the current year, for the monthly overview
  const since = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10);
  const { data, error } = await sb.from('stock_log')
    .select('*, products(name,type)')
    .gte('date', since)
    .order('date',{ascending:false})
    .order('created_at',{ascending:false})
    .limit(5000);
  if(error){ toast('Ошибка загрузки истории: '+error.message, true); return; }
  stockLog = data||[];
}

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------
function todayISO(){ return new Date().toISOString().slice(0,10); }
function daysAgoISO(n){ const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }
function firstOfMonthISO(){ const d=new Date(); d.setDate(1); return d.toISOString().slice(0,10); }
function fmt(n){ return Math.round((n||0)*10)/10; }
function toast(msg, isError){
  const el = document.createElement('div');
  el.className = 'toast'+(isError?' err':'');
  el.textContent = msg;
  document.getElementById('toastHost').appendChild(el);
  setTimeout(()=>el.remove(), 3500);
}
function productLabel(p){ return p.name+' · '+(p.width_cm||'—')+'cm·'+p.ply+'ply·'+(p.gsm||'—')+'gsm'; }

function fillProductSelects(){
  const opts = products.map(p=>`<option value="${p.id}">${productLabel(p)} [${p.type}]</option>`).join('');
  document.getElementById('se-product').innerHTML = opts || '<option value="">— нет товаров —</option>';
  filterDeliveryProductDropdown();
}
function fillSupplierSelect(){
  document.getElementById('dv-supplier').innerHTML =
    '<option value="">— select supplier —</option>' +
    suppliers.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
}

function filterDeliveryProductDropdown(){
  const typeFilter = document.getElementById('dv-type-filter').value;
  const sel = document.getElementById('dv-product');
  const list = typeFilter ? products.filter(p=>p.type===typeFilter) : products;
  sel.innerHTML = '<option value="">— select product —</option>' +
    list.map(p=>`<option value="${p.id}">${p.name} — ${p.width_cm||'—'}cm · ${p.ply}ply · ${p.gsm||'—'}gsm</option>`).join('');
  ['dv-width','dv-ply','dv-gsm'].forEach(id=>document.getElementById(id).value='');
}
function onDeliveryProductSelect(){
  const pid = document.getElementById('dv-product').value;
  const hint = document.getElementById('dvHint');
  const p = products.find(x=>String(x.id)===String(pid));
  if(!p){ ['dv-width','dv-ply','dv-gsm'].forEach(id=>document.getElementById(id).value=''); hint.textContent='💡 Select product — Width, Ply, GSM auto-fill'; return; }
  document.getElementById('dv-width').value = p.width_cm ?? '';
  document.getElementById('dv-ply').value = p.ply ?? '';
  document.getElementById('dv-gsm').value = p.gsm ?? '';
  hint.textContent = '✓ '+p.name+' selected';
}

// avg daily usage (m/day) per product — matches the old app's "weighted" rate:
// 70% × (last-30-days total ÷ distinct active days within that window)
// + 30% × (all-time total ÷ distinct active days ever), falling back to whichever exists.
function avgDailyByProduct(){
  const since30 = daysAgoISO(29);
  const sum30 = {}, days30 = {};   // days30[pid] = Set of dates with usage in last 30d
  const sumAll = {}, daysAll = {};
  stockLog.forEach(r=>{
    if(r.operation!=='deduct') return;
    const q = Number(r.quantity);
    if(!(q>0)) return;
    if(!sumAll[r.product_id]) { sumAll[r.product_id]=0; daysAll[r.product_id]=new Set(); }
    sumAll[r.product_id]+=q; daysAll[r.product_id].add(r.date);
    if(r.date>=since30){
      if(!sum30[r.product_id]) { sum30[r.product_id]=0; days30[r.product_id]=new Set(); }
      sum30[r.product_id]+=q; days30[r.product_id].add(r.date);
    }
  });
  const out = {};
  const allIds = new Set([...Object.keys(sumAll), ...Object.keys(sum30)]);
  allIds.forEach(pid=>{
    const rate30 = days30[pid] && days30[pid].size>0 ? sum30[pid]/days30[pid].size : 0;
    const rateAll = daysAll[pid] && daysAll[pid].size>0 ? sumAll[pid]/daysAll[pid].size : 0;
    let rate;
    if(rate30>0 && rateAll>0) rate = rate30*0.7 + rateAll*0.3;
    else if(rate30>0) rate = rate30;
    else rate = rateAll;
    out[pid] = rate;
  });
  return out;
}

// "active-days" average for a date range: mean of per-day totals, counting only
// days where SOMETHING was consumed (matches the old app's sheet-wide avgDaily).
function activeDaysAvg(sinceISO, untilISOExclusive){
  const totals = {};
  stockLog.forEach(r=>{
    if(r.operation==='deduct' && r.date>=sinceISO && r.date<untilISOExclusive){
      totals[r.date] = (totals[r.date]||0) + Number(r.quantity);
    }
  });
  const positiveDays = Object.values(totals).filter(v=>v>0);
  const total = positiveDays.reduce((s,v)=>s+v,0);
  const activeDays = positiveDays.length;
  return { avg: activeDays>0 ? total/activeDays : 0, activeDays, total };
}

function currentMonthActiveDaysAvg(){
  return activeDaysAvg(firstOfMonthISO(), daysAgoISO(-1)); // today inclusive
}

// per-type average this month, using the SAME active-days denominator as the
// headline (so type bars sum to the headline number) — matches getTypeDailyAverages().
function typeDailyAvgCurrentMonth(){
  const { activeDays } = currentMonthActiveDaysAvg();
  const since = firstOfMonthISO(), until = daysAgoISO(-1);
  const byType = {};
  stockLog.forEach(r=>{
    if(r.operation==='deduct' && r.date>=since && r.date<until){
      const p = products.find(x=>x.id===r.product_id);
      const type = p ? p.type : 'Other';
      byType[type] = (byType[type]||0) + Number(r.quantity);
    }
  });
  const out = {};
  const days = activeDays>0 ? activeDays : 1;
  Object.keys(byType).forEach(t=>{ out[t] = byType[t]/days; });
  return out;
}
// total usage since first of this month, per product
function mtdUsageByProduct(){
  const since = firstOfMonthISO();
  const totals = {};
  stockLog.forEach(r=>{
    if(r.operation==='deduct' && r.date>=since){
      totals[r.product_id] = (totals[r.product_id]||0) + Number(r.quantity);
    }
  });
  return totals;
}

// ---------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------
let chartByTypeInst = null, chartDailyInst = null;

function typeAgg(fn){
  const out = {};
  products.forEach(p=>{ out[p.type] = (out[p.type]||0) + fn(p); });
  return out;
}

// total deduct qty per calendar date (all products), for the last N days
function dailyDeductTotals(days){
  const since = daysAgoISO(days-1);
  const out = {};
  for(let i=0;i<days;i++){ out[daysAgoISO(days-1-i)] = 0; }
  stockLog.forEach(r=>{
    if(r.operation==='deduct' && r.date>=since){ out[r.date] = (out[r.date]||0) + Number(r.quantity); }
  });
  return out;
}

// last30 / prev30 totals per product
function windowTotalsByProduct(startDaysAgo, endDaysAgo){
  const since = daysAgoISO(startDaysAgo-1), until = daysAgoISO(endDaysAgo);
  const out = {};
  stockLog.forEach(r=>{
    if(r.operation==='deduct' && r.date>=since && r.date<until){
      out[r.product_id] = (out[r.product_id]||0) + Number(r.quantity);
    }
  });
  return out;
}

function monthsOfYear(){
  const now = new Date();
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const out = [];
  for(let m=0;m<=now.getMonth();m++){
    out.push({ m, label:names[m], year: now.getFullYear() });
  }
  return out;
}

function renderDashboard(){
  const now = new Date();
  document.getElementById('dashDateSub').textContent = now.toLocaleDateString('ru-RU',{weekday:'long', day:'2-digit', month:'long', year:'numeric'});

  const monthAvg = currentMonthActiveDaysAvg(); // matches old app's headline avg-daily (active-days method)

  const todayTotal = stockLog.filter(r=>r.operation==='deduct' && r.date===todayISO())
    .reduce((s,r)=>s+Number(r.quantity),0);

  const mtdByProd = mtdUsageByProduct();
  const totalMtd = Object.values(mtdByProd).reduce((s,v)=>s+v,0);

  // last full calendar month total
  const lm = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const lmStart = lm.toISOString().slice(0,10);
  const lmEnd = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const lastMonthTotal = stockLog.filter(r=>r.operation==='deduct' && r.date>=lmStart && r.date<lmEnd)
    .reduce((s,r)=>s+Number(r.quantity),0);

  document.getElementById('kpiToday').textContent = fmt(todayTotal).toLocaleString();
  document.getElementById('kpiAvgDaily').textContent = fmt(monthAvg.avg).toLocaleString();
  document.getElementById('kpiMtdUsage').textContent = fmt(totalMtd).toLocaleString();
  document.getElementById('kpiMtdSub').textContent = 'с ' + firstOfMonthISO();
  document.getElementById('kpiLastMonth').textContent = fmt(lastMonthTotal).toLocaleString();

  renderChartByType();
  renderTop10(windowTotalsByProduct(30,0));
  renderChartDaily();
  renderMonthlyOverview();
  renderDashDetail();
  renderDashRecent();
}

function goToLevelsType(type){
  levelsTypeFilter = type;
  showPane('levels');
  renderLevels();
}

// ---------- Consumption Explorer: type -> products -> single-product daily detail ----------
let ceLevel = 0, ceType = null, ceProdList = [];

function ceSetHeader(title, crumb, showBack){
  document.getElementById('ceTitle').textContent = title;
  document.getElementById('ceBreadcrumb').textContent = crumb;
  document.getElementById('ceBack').classList.toggle('hidden', !showBack);
}

function ceCanvas(px){
  document.getElementById('ceChartWrap').style.height = px+'px';
  document.getElementById('ceChartWrap').innerHTML = '<canvas id="chartByType"></canvas>';
  if(chartByTypeInst){ chartByTypeInst.destroy(); chartByTypeInst=null; }
  return document.getElementById('chartByType');
}

function renderChartByType(){
  ceLevel = 0; ceType = null;
  const byType = typeDailyAvgCurrentMonth();
  const entries = Object.entries(byType).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const labels = entries.map(e=>e[0]);
  ceSetHeader('📊 Средний расход/день по типам', entries.length? 'Нажмите на столбец, чтобы открыть товары этого типа' : 'Нет данных за этот месяц', false);
  if(!entries.length){ document.getElementById('ceChartWrap').innerHTML = '<div class="empty">Нет данных</div>'; return; }
  const ctx = ceCanvas(260);
  chartByTypeInst = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: entries.map(e=>fmt(e[1])), backgroundColor: entries.map(e=>TYPE_COLOR[e[0]]||TYPE_COLOR.Other), borderRadius:4 }] },
    options: {
      onClick:(evt, els)=>{ if(els.length){ ceShowProducts(labels[els[0].index]); } },
      onHover:(evt, els)=>{ evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>c.parsed.y.toLocaleString()+' м/день — нажмите для товаров'}} },
      scales:{ y:{ beginAtZero:true, grid:{color:'#EEF0ED'} }, x:{ grid:{display:false} } },
      maintainAspectRatio:false
    }
  });
}

function ceShowProducts(type){
  ceLevel = 1; ceType = type;
  const c = TYPE_COLOR[type]||TYPE_COLOR.Other;
  const avgByProd = avgDailyByProduct();
  let prods = products.filter(p=>p.type===type).map(p=>({p, v: avgByProd[p.id]||0})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
  ceProdList = prods;
  ceSetHeader('📦 '+type+' — расход/день по товарам', 'Все типы → '+type+' · нажмите на товар для истории за 30 дней', true);
  if(!prods.length){ document.getElementById('ceChartWrap').innerHTML = '<div class="empty">Нет товаров с расходом в '+type+'</div>'; return; }
  const h = Math.max(220, Math.min(560, prods.length*30+60));
  const ctx = ceCanvas(h);
  const labels = prods.map(x=>x.p.name+' '+(x.p.width_cm||'—')+'см/'+x.p.ply+'сл/'+(x.p.gsm||'—')+'гсм');
  chartByTypeInst = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data: prods.map(x=>fmt(x.v)), backgroundColor:c, borderRadius:4 }] },
    options:{
      indexAxis:'y',
      onClick:(evt, els)=>{ if(els.length){ ceShowProductDetail(ceProdList[els[0].index].p); } },
      onHover:(evt, els)=>{ evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c2=>c2.parsed.x.toLocaleString()+' м/день — нажмите для истории'}} },
      scales:{ x:{ beginAtZero:true, grid:{color:'#EEF0ED'} }, y:{ grid:{display:false} } },
      maintainAspectRatio:false
    }
  });
}

const ceDailyCache = {};
function ceShowProductDetail(p){
  ceLevel = 2;
  const c = TYPE_COLOR[p.type]||TYPE_COLOR.Other;
  ceSetHeader('📈 '+p.name+' '+(p.width_cm||'—')+'см · '+p.ply+'сл · '+(p.gsm||'—')+'гсм — 30 дней',
    'Все типы → '+p.type+' → '+p.name+' · дневной расход (м)', true);
  const key = p.id;
  const draw = (days)=>{
    if(!days.length){ document.getElementById('ceChartWrap').innerHTML = '<div class="empty">Нет записей расхода по этому товару</div>'; return; }
    const vals = days.map(d=>fmt(d.qty));
    const nz = vals.filter(v=>v>0);
    const avg = nz.length ? nz.reduce((a,b)=>a+b,0)/nz.length : 0;
    const ctx = ceCanvas(280);
    chartByTypeInst = new Chart(ctx, {
      data:{ labels: days.map(d=>d.date.slice(5)), datasets:[
        { type:'bar', label:'Расход', data: vals, backgroundColor:c, borderRadius:3 },
        { type:'line', label:'Среднее '+fmt(avg).toLocaleString()+' м/д', data: days.map(()=>Math.round(avg)), borderColor:'#D98F2B', borderDash:[5,4], pointRadius:0, borderWidth:1.5 }
      ]},
      options:{ plugins:{ legend:{display:true, labels:{boxWidth:10,font:{size:11}}} },
        scales:{ y:{ beginAtZero:true, grid:{color:'#EEF0ED'} }, x:{ grid:{display:false} } },
        maintainAspectRatio:false }
    });
  };
  if(ceDailyCache[key]){ draw(ceDailyCache[key]); return; }
  const since = daysAgoISO(29);
  const byDate = {};
  for(let i=0;i<30;i++){ byDate[daysAgoISO(29-i)] = 0; }
  stockLog.forEach(r=>{ if(r.product_id===p.id && r.operation==='deduct' && r.date>=since){ byDate[r.date]=(byDate[r.date]||0)+Number(r.quantity); } });
  const days = Object.entries(byDate).map(([date,qty])=>({date,qty}));
  ceDailyCache[key] = days;
  draw(days);
}

function ceBack(){
  if(ceLevel===2) ceShowProducts(ceType);
  else renderChartByType();
}

function openProductInExplorer(pid){
  closeKpiDrill();
  const p = products.find(x=>x.id===pid);
  if(!p) return;
  ceShowProductDetail(p);
  document.getElementById('ceCard').scrollIntoView({behavior:'smooth', block:'start'});
}

// ---------- KPI drill-down modal: metric -> types -> products ----------
const KPI_META = {
  today:     { title:'📅 Сегодня', unit:'м',     crumb:'расход сегодня, по типам' },
  avgDaily:  { title:'📈 Средний расход/день', unit:'м/день', crumb:'за 30 дней, по типам' },
  mtd:       { title:'📦 Расход с начала месяца', unit:'м', crumb:'с начала месяца, по типам' },
  lastMonth: { title:'📦 Итог за прошлый месяц', unit:'м', crumb:'предыдущий календарный месяц, по типам' }
};

function kpiByProductMap(metric){
  if(metric==='today'){
    const out={};
    stockLog.forEach(r=>{ if(r.operation==='deduct' && r.date===todayISO()){ out[r.product_id]=(out[r.product_id]||0)+Number(r.quantity); } });
    return out;
  }
  if(metric==='avgDaily') return avgDailyByProduct();
  if(metric==='mtd') return mtdUsageByProduct();
  if(metric==='lastMonth'){
    const now = new Date();
    const lm = new Date(now.getFullYear(), now.getMonth()-1, 1).toISOString().slice(0,10);
    const lmEnd = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    const out={};
    stockLog.forEach(r=>{ if(r.operation==='deduct' && r.date>=lm && r.date<lmEnd){ out[r.product_id]=(out[r.product_id]||0)+Number(r.quantity); } });
    return out;
  }
  return {};
}

let kpiMetric = null, kpiType = null;

function openKpiDrill(metric){
  kpiMetric = metric; kpiType = null; dayDrillDate = null;
  document.getElementById('kpiDrillModal').classList.remove('hidden');
  kpiDrillTypes();
}
function closeKpiDrill(){ document.getElementById('kpiDrillModal').classList.add('hidden'); }

function kpiDrillTypes(){
  kpiType = null;
  const meta = KPI_META[kpiMetric];
  document.getElementById('kpiDrillTitle').textContent = meta.title;
  document.getElementById('kpiDrillCrumb').textContent = meta.crumb + ' · нажмите тип для товаров';
  document.getElementById('kpiDrillBack').classList.add('hidden');
  const byProd = kpiByProductMap(kpiMetric);
  const byType = {};
  Object.entries(byProd).forEach(([pid,v])=>{
    if(!(v>0)) return;
    const p = products.find(x=>x.id==pid);
    const type = p ? p.type : 'Other';
    byType[type] = (byType[type]||0) + v;
  });
  const entries = Object.entries(byType).sort((a,b)=>b[1]-a[1]);
  const body = document.getElementById('kpiDrillBody');
  if(!entries.length){ body.innerHTML = '<div class="empty">Нет данных</div>'; return; }
  const total = entries.reduce((s,[,v])=>s+v,0);
  body.innerHTML = `<div style="font-size:12px;color:var(--text-3);margin-bottom:12px">Всего: <b style="color:var(--text)">${fmt(total).toLocaleString()} ${meta.unit}</b></div>` +
    entries.map(([type,v])=>{
      const c = TYPE_COLOR[type]||TYPE_COLOR.Other;
      const pct = Math.round(v/total*100);
      return `<div class="type-row" style="--c:${c}" onclick="kpiDrillProducts('${type}')">
        <div class="type-row-head"><span class="type-name">${type}</span>
        <span><span class="type-val num">${fmt(v).toLocaleString()} ${meta.unit}</span><span class="type-pct">${pct}%</span></span></div>
        <div class="type-bar-track"><div class="type-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
}

function kpiDrillProducts(type){
  kpiType = type;
  const meta = KPI_META[kpiMetric];
  const c = TYPE_COLOR[type]||TYPE_COLOR.Other;
  document.getElementById('kpiDrillTitle').textContent = meta.title+' — '+type;
  document.getElementById('kpiDrillCrumb').textContent = 'по типам → '+type+' · разбивка по форматам';
  document.getElementById('kpiDrillBack').classList.remove('hidden');
  const byProd = kpiByProductMap(kpiMetric);
  const entries = Object.entries(byProd).map(([pid,v])=>({p:products.find(x=>x.id==pid), v}))
    .filter(r=>r.p && r.p.type===type && r.v>0).sort((a,b)=>b.v-a.v);
  const body = document.getElementById('kpiDrillBody');
  if(!entries.length){ body.innerHTML = '<div class="empty">Нет товаров</div>'; return; }
  const total = entries.reduce((s,r)=>s+r.v,0)||1;
  body.innerHTML = entries.map(({p,v})=>{
    const pct = Math.round(v/total*100);
    return `<div class="type-row" style="--c:${c}" onclick="openProductInExplorer(${p.id})" title="Открыть историю ${p.name} за 30 дней">
      <div class="type-row-head" style="font-size:12.5px">
        <span>${p.name} <span style="color:var(--text-3)">${p.width_cm||'—'}·${p.ply}пл·${p.gsm||'—'}</span></span>
        <span class="num" style="font-weight:600">${fmt(v).toLocaleString()} ${meta.unit}</span>
      </div>
      <div class="type-bar-track" style="height:4px;margin-top:5px"><div class="type-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function kpiDrillBack(){
  if(dayDrillDate) dayDrillTypes();
  else kpiDrillTypes();
}

// ---------- Day drill-down: one bar from "Дневной расход" -> types -> products ----------
let dayDrillDate = null;

function openDayDrill(dateStr){
  kpiMetric = null; dayDrillDate = dateStr; kpiType = null;
  document.getElementById('kpiDrillModal').classList.remove('hidden');
  dayDrillTypes();
}

function dayByProductMap(dateStr){
  const out = {};
  stockLog.forEach(r=>{ if(r.operation==='deduct' && r.date===dateStr){ out[r.product_id]=(out[r.product_id]||0)+Number(r.quantity); } });
  return out;
}

function dayDrillTypes(){
  kpiType = null;
  const d = new Date(dayDrillDate+'T00:00:00');
  const dLabel = d.toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'});
  document.getElementById('kpiDrillTitle').textContent = '📅 '+dLabel;
  document.getElementById('kpiDrillCrumb').textContent = 'расход за день, по типам · нажмите тип для товаров';
  document.getElementById('kpiDrillBack').classList.add('hidden');
  const byProd = dayByProductMap(dayDrillDate);
  const byType = {};
  Object.entries(byProd).forEach(([pid,v])=>{
    if(!(v>0)) return;
    const p = products.find(x=>x.id==pid);
    const type = p ? p.type : 'Other';
    byType[type] = (byType[type]||0) + v;
  });
  const entries = Object.entries(byType).sort((a,b)=>b[1]-a[1]);
  const body = document.getElementById('kpiDrillBody');
  if(!entries.length){ body.innerHTML = '<div class="empty">Нет расхода за этот день</div>'; return; }
  const total = entries.reduce((s,[,v])=>s+v,0);
  body.innerHTML = `<div style="font-size:12px;color:var(--text-3);margin-bottom:12px">Всего: <b style="color:var(--text)">${fmt(total).toLocaleString()} м</b></div>` +
    entries.map(([type,v])=>{
      const c = TYPE_COLOR[type]||TYPE_COLOR.Other;
      const pct = Math.round(v/total*100);
      return `<div class="type-row" style="--c:${c}" onclick="dayDrillProducts('${type}')">
        <div class="type-row-head"><span class="type-name">${type}</span>
        <span><span class="type-val num">${fmt(v).toLocaleString()} м</span><span class="type-pct">${pct}%</span></span></div>
        <div class="type-bar-track"><div class="type-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
}

function dayDrillProducts(type){
  kpiType = type;
  const d = new Date(dayDrillDate+'T00:00:00');
  const dLabel = d.toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'});
  const c = TYPE_COLOR[type]||TYPE_COLOR.Other;
  document.getElementById('kpiDrillTitle').textContent = '📅 '+dLabel+' — '+type;
  document.getElementById('kpiDrillCrumb').textContent = 'по типам → '+type+' · разбивка по форматам';
  document.getElementById('kpiDrillBack').classList.remove('hidden');
  const byProd = dayByProductMap(dayDrillDate);
  const entries = Object.entries(byProd).map(([pid,v])=>({p:products.find(x=>x.id==pid), v}))
    .filter(r=>r.p && r.p.type===type && r.v>0).sort((a,b)=>b.v-a.v);
  const body = document.getElementById('kpiDrillBody');
  if(!entries.length){ body.innerHTML = '<div class="empty">Нет товаров</div>'; return; }
  const total = entries.reduce((s,r)=>s+r.v,0)||1;
  body.innerHTML = entries.map(({p,v})=>{
    const pct = Math.round(v/total*100);
    return `<div class="type-row" style="--c:${c}" onclick="openProductInExplorer(${p.id})" title="Открыть историю ${p.name} за 30 дней">
      <div class="type-row-head" style="font-size:12.5px">
        <span>${p.name} <span style="color:var(--text-3)">${p.width_cm||'—'}·${p.ply}пл·${p.gsm||'—'}</span></span>
        <span class="num" style="font-weight:600">${fmt(v).toLocaleString()} м</span>
      </div>
      <div class="type-bar-track" style="height:4px;margin-top:5px"><div class="type-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function renderChartDaily(){
  const totals = dailyDeductTotals(30);
  const fullDates = Object.keys(totals);
  const values = Object.values(totals).map(fmt);
  const avg = values.reduce((s,v)=>s+v,0)/(values.length||1);
  const ctx = document.getElementById('chartDaily');
  if(chartDailyInst) chartDailyInst.destroy();
  chartDailyInst = new Chart(ctx, {
    data: {
      labels: fullDates.map(d=>d.slice(5)),
      datasets: [
        { type:'bar', label:'Расход', data: values, backgroundColor:'#0F6E56', borderRadius:3 },
        { type:'line', label:'Среднее', data: fullDates.map(()=>Math.round(avg)), borderColor:'#D98F2B', borderDash:[5,4], pointRadius:0, borderWidth:1.5 }
      ]
    },
    options: {
      onClick:(evt, els)=>{
        const el = els.find(e=>e.datasetIndex===0) || els[0];
        if(el){ openDayDrill(fullDates[el.index]); }
      },
      onHover:(evt, els)=>{ evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins:{ legend:{display:true, labels:{boxWidth:10,font:{size:11}}}, tooltip:{callbacks:{title:c=>fullDates[c[0].dataIndex] + ' — нажмите для разбора по типам'}} },
      scales:{ y:{ beginAtZero:true, grid:{color:'#EEF0ED'} }, x:{ grid:{display:false} } },
      maintainAspectRatio:false
    }
  });
}

function renderTop10(totals){
  const rows = Object.entries(totals).map(([pid,v])=>({p:products.find(x=>x.id==pid), v}))
    .filter(r=>r.p && r.v>0).sort((a,b)=>b.v-a.v).slice(0,10);
  const host = document.getElementById('dashTop10');
  if(!rows.length){ host.innerHTML='<div class="empty">Нет данных за 30 дней</div>'; return; }
  const max = rows[0].v;
  host.innerHTML = rows.map(({p,v})=>{
    const pct = Math.round(v/max*100);
    return `<div class="type-row" style="--c:${TYPE_COLOR[p.type]||TYPE_COLOR.Other};padding:8px 12px;margin-bottom:6px" onclick="openProductInExplorer(${p.id})" title="Открыть историю ${p.name} за 30 дней">
      <div class="type-row-head" style="font-size:12.5px">
        <span>${p.name} <span style="color:var(--text-3)">${p.width_cm||'—'}·${p.ply}пл·${p.gsm||'—'}</span></span>
        <span class="num" style="font-weight:600">${fmt(v).toLocaleString()}</span>
      </div>
      <div class="type-bar-track" style="height:4px;margin-top:5px"><div class="type-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

let openMonthDetail = null;

function renderMonthlyOverview(){
  const months = monthsOfYear();
  const host = document.getElementById('dashMonthly');
  const now = new Date();
  host.innerHTML = months.map(({m,label,year})=>{
    const start = new Date(year,m,1).toISOString().slice(0,10);
    const end = new Date(year,m+1,1).toISOString().slice(0,10);
    let consumed=0, received=0;
    stockLog.forEach(r=>{
      if(r.date>=start && r.date<end){
        if(r.operation==='deduct') consumed += Number(r.quantity);
        if(r.operation==='add') received += Number(r.quantity);
      }
    });
    const isCurrent = (m===now.getMonth());
    const monthAvg = activeDaysAvg(start, end);
    const avgDaily = monthAvg.avg;
    const active = openMonthDetail && openMonthDetail.m===m && openMonthDetail.year===year;
    return `<div class="card" style="padding:10px 12px;cursor:pointer;${active?'border-color:var(--brand)':''}" onclick="toggleMonthDetail(${year},${m},'${label}')" title="Нажмите, чтобы посмотреть разбивку по типам">
      <div style="font-weight:600;font-family:'Space Grotesk',sans-serif;font-size:13px">${label}</div>
      <div style="font-size:10.5px;color:var(--text-3);margin:2px 0 6px">РАСХОД</div>
      <div class="num" style="font-weight:600;color:var(--brand)">${fmt(consumed).toLocaleString()} м</div>
      <div style="font-size:10.5px;color:var(--text-3);margin:6px 0 2px">ПРИХОД</div>
      <div class="num" style="font-size:12.5px;color:var(--text-2)">${fmt(received).toLocaleString()} м</div>
      <div style="font-size:11px;color:var(--text-3);margin-top:6px">Ø ${fmt(avgDaily).toLocaleString()} м/д</div>
    </div>`;
  }).join('');
  if(openMonthDetail) renderMonthDetailPanel(openMonthDetail.year, openMonthDetail.m, openMonthDetail.label);
}

function toggleMonthDetail(year, m, label){
  if(openMonthDetail && openMonthDetail.m===m && openMonthDetail.year===year){
    openMonthDetail = null;
    document.getElementById('dashMonthlyDetail').classList.add('hidden');
    renderMonthlyOverview();
    return;
  }
  openMonthDetail = {year, m, label};
  renderMonthlyOverview();
}

function renderMonthDetailPanel(year, m, label){
  monthDetailType = null;
  const start = new Date(year,m,1).toISOString().slice(0,10);
  const end = new Date(year,m+1,1).toISOString().slice(0,10);
  const byType = {}; // {type: {out, in}}
  stockLog.forEach(r=>{
    if(r.date<start || r.date>=end) return;
    if(r.operation!=='deduct' && r.operation!=='add') return;
    const p = products.find(x=>x.id===r.product_id);
    const type = p ? p.type : (r.products?.type || 'Other');
    if(!byType[type]) byType[type] = {out:0, in:0};
    if(r.operation==='deduct') byType[type].out += Number(r.quantity);
    else byType[type].in += Number(r.quantity);
  });
  const panel = document.getElementById('dashMonthlyDetail');
  panel.classList.remove('hidden');
  const entries = Object.entries(byType).filter(([,v])=>v.out>0||v.in>0).sort((a,b)=>b[1].out-a[1].out);
  if(!entries.length){
    panel.innerHTML = `<div class="card-title">${label} ${year} — расход и приход по типам</div><div class="empty">Нет данных за этот месяц</div>`;
    return;
  }
  const maxVal = Math.max(...entries.map(([,v])=>Math.max(v.out,v.in)), 1);
  panel.innerHTML = `<div class="card-title" style="margin-bottom:10px">${label} ${year} — расход и приход по типам · нажмите тип, чтобы увидеть товары</div>` +
    entries.map(([type,v])=>{
      const c = TYPE_COLOR[type]||TYPE_COLOR.Other;
      const outPct = Math.round(v.out/maxVal*100), inPct = Math.round(v.in/maxVal*100);
      return `<div class="type-row" style="--c:${c}" onclick="showMonthTypeProducts(${year},${m},'${label}','${type}')">
        <div class="type-row-head"><span class="type-name">${type}</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:6px">
          <div>
            <div style="font-size:10px;color:var(--text-3);margin-bottom:3px">РАСХОД</div>
            <div class="type-bar-track"><div class="type-bar-fill" style="width:${outPct}%"></div></div>
            <div class="num" style="font-size:12.5px;font-weight:600;margin-top:3px">${fmt(v.out).toLocaleString()} м</div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text-3);margin-bottom:3px">ПРИХОД</div>
            <div class="type-bar-track"><div class="type-bar-fill" style="width:${inPct}%;background:var(--amber)"></div></div>
            <div class="num" style="font-size:12.5px;font-weight:600;margin-top:3px;color:var(--amber)">${fmt(v.in).toLocaleString()} м</div>
          </div>
        </div>
      </div>`;
    }).join('');
}

let monthDetailType = null;

function showMonthTypeProducts(year, m, label, type){
  monthDetailType = type;
  const start = new Date(year,m,1).toISOString().slice(0,10);
  const end = new Date(year,m+1,1).toISOString().slice(0,10);
  const c = TYPE_COLOR[type]||TYPE_COLOR.Other;
  const byProd = {}; // {pid: {out, in}}
  stockLog.forEach(r=>{
    if(r.date<start || r.date>=end) return;
    if(r.operation!=='deduct' && r.operation!=='add') return;
    const p = products.find(x=>x.id===r.product_id);
    if(!p || p.type!==type) return;
    if(!byProd[p.id]) byProd[p.id] = {out:0, in:0};
    if(r.operation==='deduct') byProd[p.id].out += Number(r.quantity);
    else byProd[p.id].in += Number(r.quantity);
  });
  const entries = Object.entries(byProd).map(([pid,v])=>({p:products.find(x=>x.id==pid), ...v}))
    .filter(r=>r.p && (r.out>0||r.in>0)).sort((a,b)=>b.out-a.out);
  const panel = document.getElementById('dashMonthlyDetail');
  const maxVal = Math.max(...entries.map(r=>Math.max(r.out,r.in)), 1);
  const header = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="card-title">${label} ${year} — ${type}: расход и приход</div>
      <button class="btn btn-ghost btn-sm" onclick="renderMonthDetailPanel(${year},${m},'${label}')">← Назад к типам</button>
    </div>`;
  if(!entries.length){ panel.innerHTML = header + '<div class="empty">Нет движений</div>'; return; }
  panel.innerHTML = header + entries.map(({p,out,in:inn})=>{
    const outPct = Math.round(out/maxVal*100), inPct = Math.round(inn/maxVal*100);
    return `<div class="type-row" style="--c:${c}" onclick="openProductInExplorer(${p.id})" title="Открыть историю ${p.name} за 30 дней">
      <div class="type-row-head" style="font-size:12.5px">
        <span>${p.name} <span style="color:var(--text-3)">${p.width_cm||'—'}·${p.ply}пл·${p.gsm||'—'}</span></span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:5px">
        <div>
          <div class="type-bar-track" style="height:4px"><div class="type-bar-fill" style="width:${outPct}%"></div></div>
          <div class="num" style="font-size:11px;margin-top:2px">↓ ${fmt(out).toLocaleString()} м</div>
        </div>
        <div>
          <div class="type-bar-track" style="height:4px"><div class="type-bar-fill" style="width:${inPct}%;background:var(--amber)"></div></div>
          <div class="num" style="font-size:11px;margin-top:2px;color:var(--amber)">↑ ${fmt(inn).toLocaleString()} м</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

let dashDetailSortCol='', dashDetailSortDir=1;
function setDashDetailSort(col){ if(dashDetailSortCol===col) dashDetailSortDir*=-1; else { dashDetailSortCol=col; dashDetailSortDir=1; } renderDashDetail(); }

function renderDashDetail(){
  const last30 = windowTotalsByProduct(30,0);
  const prev30 = windowTotalsByProduct(60,30);
  const avgByProd = avgDailyByProduct();
  let rows = Object.entries(last30).map(([pid,v])=>{
    const p = products.find(x=>x.id==pid);
    const prev = prev30[pid]||0;
    const delta = prev>0 ? Math.round((v-prev)/prev*100) : (v>0?100:0);
    return {p, v, prev, delta, daily: avgByProd[pid]||0};
  }).filter(r=>r.p);
  if(dashDetailSortCol){
    const key = { name:r=>r.p.name.toLowerCase(), type:r=>r.p.type, v:r=>r.v, prev:r=>r.prev, delta:r=>r.delta, daily:r=>r.daily }[dashDetailSortCol];
    rows.sort((a,b)=>{ const av=key(a), bv=key(b); return (av<bv?-1:av>bv?1:0)*dashDetailSortDir; });
  } else {
    rows.sort((a,b)=>b.v-a.v);
  }
  rows = rows.slice(0,15);

  const tbody = document.querySelector('#dashDetailTable tbody');
  if(!rows.length){ tbody.innerHTML = '<tr><td colspan="6" class="empty">Нет данных</td></tr>'; return; }
  tbody.innerHTML = rows.map(({p,v,prev,delta,daily})=>`<tr>
    <td>${p.name} <span style="color:var(--text-3)">${p.width_cm||'—'}·${p.ply}пл·${p.gsm||'—'}</span></td>
    <td><span style="color:${TYPE_COLOR[p.type]};font-weight:600">${p.type}</span></td>
    <td class="num">${fmt(v).toLocaleString()}</td>
    <td class="num" style="color:var(--text-3)">${fmt(prev).toLocaleString()}</td>
    <td class="num" style="color:${delta>=0?'var(--red)':'var(--green)'}">${delta>=0?'▲':'▼'} ${Math.abs(delta)}%</td>
    <td class="num">${fmt(daily).toLocaleString()}</td>
  </tr>`).join('');
}

let dashRecentSortCol='', dashRecentSortDir=1;
function setDashRecentSort(col){ if(dashRecentSortCol===col) dashRecentSortDir*=-1; else { dashRecentSortCol=col; dashRecentSortDir=1; } renderDashRecent(); }

function renderDashRecent(){
  const seen = new Set();
  let rows = [];
  for(const r of stockLog){
    if(seen.has(r.product_id)) continue;
    seen.add(r.product_id);
    rows.push(r);
    if(!dashRecentSortCol && rows.length>=12) break;
  }
  const avgByProd = avgDailyByProduct();
  if(dashRecentSortCol){
    const key = {
      name:r=>(products.find(x=>x.id===r.product_id)?.name||'').toLowerCase(),
      type:r=>products.find(x=>x.id===r.product_id)?.type||'',
      balance:r=>Number(products.find(x=>x.id===r.product_id)?.balance||0),
      daily:r=>avgByProd[r.product_id]||0,
      date:r=>r.date
    }[dashRecentSortCol];
    rows = [...rows].sort((a,b)=>{ const av=key(a), bv=key(b); return (av<bv?-1:av>bv?1:0)*dashRecentSortDir; }).slice(0,15);
  }
  const tbody = document.querySelector('#dashRecentTable tbody');
  if(!rows.length){ tbody.innerHTML = '<tr><td colspan="5" class="empty">Нет записей</td></tr>'; return; }
  tbody.innerHTML = rows.map(r=>{
    const p = products.find(x=>x.id===r.product_id);
    if(!p) return '';
    return `<tr>
      <td>${p.name} <span style="color:var(--text-3)">${p.width_cm||'—'}·${p.ply}пл·${p.gsm||'—'}</span></td>
      <td><span style="color:${TYPE_COLOR[p.type]};font-weight:600">${p.type}</span></td>
      <td class="num">${fmt(p.balance).toLocaleString()}</td>
      <td class="num">${fmt(avgByProd[p.id]||0).toLocaleString()}</td>
      <td style="color:var(--text-3)">${r.date}</td>
    </tr>`;
  }).join('');
}

function renderTypeBars(hostId, byType){
  const host = document.getElementById(hostId);
  const entries = Object.entries(byType).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const total = entries.reduce((s,[,v])=>s+v,0);
  if(!entries.length){ host.innerHTML = '<div class="empty">Нет данных</div>'; return; }
  host.innerHTML = entries.map(([type,val])=>{
    const pct = total>0 ? Math.round(val/total*100) : 0;
    const c = TYPE_COLOR[type]||TYPE_COLOR.Other;
    return `<div class="type-row" style="--c:${c}" onclick="levelsTypeFilter='${type}';showPane('levels');renderLevels();">
      <div class="type-row-head">
        <span class="type-name">${type}</span>
        <span><span class="type-val num">${fmt(val).toLocaleString()} м</span><span class="type-pct">${pct}%</span></span>
      </div>
      <div class="type-bar-track"><div class="type-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------
// STOCK ENTRY
// ---------------------------------------------------------------
async function submitStockEntry(){
  const err = document.getElementById('seError'); err.textContent='';
  if(!canEdit()){ err.textContent='У вас нет прав на эту операцию.'; return; }
  const product_id = document.getElementById('se-product').value;
  const operation = document.getElementById('se-operation').value;
  const quantity = parseFloat(document.getElementById('se-qty').value);
  const date = document.getElementById('se-date').value || todayISO();
  const note = document.getElementById('se-note').value.trim();
  if(!product_id){ err.textContent='Выберите товар.'; return; }
  if(!(quantity>=0)){ err.textContent='Укажите количество.'; return; }

  const { error } = await sb.from('stock_log').insert({ product_id, operation, quantity, date, note, user_id: me.id });
  if(error){ err.textContent = error.message; return; }
  toast('Сохранено ✓');
  document.getElementById('se-qty').value=''; document.getElementById('se-note').value='';
  await Promise.all([loadProducts(), loadStockLog()]);
  fillProductSelects(); renderDashboard(); renderLevels(); renderHistory(); renderForecast(); renderOrders();
}

// ---------------------------------------------------------------
// STOCK LEVELS
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// STOCK LEVELS
// ---------------------------------------------------------------
let levelsPriorityFilter = '';
let lvlAsOfDate = null;        // null = today (live balance)
let lvlRateMode = 'weighted';  // 'weighted' | 'manual'
let lvlHideZero = false;
let lvlSummaryFilter = '';     // '' | 'zero' | 'low' | 'healthy'
let lvlSortCol = '', lvlSortDir = 1;

const LVL_TYPE_FILTERS = [
  {key:'', label:'Все'},
  {key:'Napkins', label:'Napkins'},
  {key:'Facial Tissue', label:'Facial Tissue'},
  {key:'FT<60', label:'<60см'},
  {key:'FT>=60', label:'≥60см'},
  {key:'Toilet Paper', label:'Toilet Paper'},
  {key:'Towels', label:'Towels'},
  {key:'Spunlace', label:'Spunlace'},
  {key:'Dispenser', label:'Dispenser'}
];

function refreshLevels(){
  Promise.all([loadProducts(), loadDeliveries(), loadStockLog()]).then(renderLevels);
}

function onLvlAsOfChange(){
  const v = document.getElementById('lvlAsOf').value;
  lvlAsOfDate = (v && v !== todayISO()) ? v : null;
  renderLevels();
}
function resetLvlAsOf(){
  lvlAsOfDate = null;
  document.getElementById('lvlAsOf').value = todayISO();
  renderLevels();
}
function setLvlRate(mode){ lvlRateMode = mode; renderLevels(); }
function toggleLvlHideZero(){ lvlHideZero = !lvlHideZero; renderLevels(); }
function setLvlSummaryFilter(f){ lvlSummaryFilter = (lvlSummaryFilter===f && f!=='all') ? '' : (f==='all'?'':f); renderLevels(); }
function setLvlSort(col){
  if(lvlSortCol===col) lvlSortDir *= -1; else { lvlSortCol=col; lvlSortDir=1; }
  renderLevels();
}

// balance of every product as of a given date, replayed from stock_log (add/deduct/update)
function computeBalancesAsOf(dateStr){
  const bal = {};
  const rows = stockLog.filter(r=>r.date<=dateStr).slice().sort((a,b)=> a.date<b.date?-1:a.date>b.date?1: (a.created_at<b.created_at?-1:1));
  rows.forEach(r=>{
    const q = Number(r.quantity);
    if(r.operation==='add') bal[r.product_id] = (bal[r.product_id]||0) + q;
    else if(r.operation==='deduct') bal[r.product_id] = (bal[r.product_id]||0) - q;
    else if(r.operation==='update') bal[r.product_id] = q;
  });
  return bal;
}

function manualDailyRate(p){
  return (p.manual_monthly_rate && p.manual_monthly_rate>0) ? p.manual_monthly_rate/30 : null;
}

function pendingInfo(pid){
  const pend = deliveries.filter(d=>d.product_id===pid && d.status==='pending');
  const qtyM = pend.filter(d=>d.unit!=='kg').reduce((s,d)=>s+Number(d.quantity||0),0);
  const qtyKg = pend.filter(d=>d.unit==='kg').reduce((s,d)=>s+Number(d.quantity||0),0);
  if(!pend.length) return {qtyM:0, qtyKg:0, eta:''};
  const withDate = pend.filter(d=>d.expected_date).sort((a,b)=> a.expected_date<b.expected_date?-1:1);
  let eta = '';
  if(withDate.length){
    const days = Math.round((new Date(withDate[0].expected_date)-new Date(todayISO()))/86400000);
    eta = days<0 ? `просрочено ${-days}д` : days===0 ? 'сегодня' : days===1 ? 'завтра' : `через ${days}д`;
  }
  return {qtyM, qtyKg, eta};
}

async function editManualRate(pid){
  if(!canEdit()) return;
  const p = products.find(x=>x.id===pid);
  if(!p) return;
  const val = prompt('Ручная норма расхода, м/месяц (для товара "'+p.name+'"):', p.manual_monthly_rate||'');
  if(val===null) return;
  const monthly = parseFloat(val)||0;
  const { error } = await sb.from('products').update({ manual_monthly_rate: monthly }).eq('id', pid);
  if(error){ toast(error.message, true); return; }
  p.manual_monthly_rate = monthly;
  toast('Норма сохранена ✓');
  renderLevels();
}

function exportLevelsCsv(){
  const rows = lvlFilteredSortedRows();
  const header = ['Товар','Тип','Ширина','Ply','GSM','Остаток(м)','Ожидается(м)','Ожидается(кг)','30д','Расход/день','Дней'];
  const lines = [header.join(';')];
  rows.forEach(r=>{
    lines.push([r.p.name, r.p.type, r.p.width_cm||'', r.p.ply, r.p.gsm||'', fmt(r.balance), fmt(r.pending.qtyM), fmt(r.pending.qtyKg), fmt(r.u30), fmt(r.daily), isFinite(r.days)?fmt(r.days):'∞'].join(';'));
  });
  const blob = new Blob(['\ufeff'+lines.join('\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'stock-levels-'+(lvlAsOfDate||todayISO())+'.csv';
  a.click(); URL.revokeObjectURL(url);
}

function lvlFilteredSortedRows(){
  const asOfBalances = lvlAsOfDate ? computeBalancesAsOf(lvlAsOfDate) : null;
  const avgByProd = avgDailyByProduct();
  const u30 = windowTotalsByProduct(30,0);

  let rows = products.map(p=>{
    const balance = asOfBalances ? (asOfBalances[p.id]||0) : Number(p.balance);
    const manual = manualDailyRate(p);
    const daily = lvlRateMode==='manual' ? (manual!=null ? manual : (avgByProd[p.id]||0)) : (avgByProd[p.id]||0);
    const usedManual = lvlRateMode==='manual' && manual!=null;
    const days = balance<=0 ? 0 : (daily>0 ? balance/daily : Infinity);
    return { p, balance, daily, usedManual, u30: u30[p.id]||0, days, pending: pendingInfo(p.id) };
  });

  // type filter
  if(levelsTypeFilter==='FT<60') rows = rows.filter(r=>r.p.type==='Facial Tissue' && (r.p.width_cm||0)<60);
  else if(levelsTypeFilter==='FT>=60') rows = rows.filter(r=>r.p.type==='Facial Tissue' && (r.p.width_cm||0)>=60);
  else if(levelsTypeFilter) rows = rows.filter(r=>r.p.type===levelsTypeFilter);

  if(levelsPriorityFilter) rows = rows.filter(r=>(r.p.priority||'')===levelsPriorityFilter);
  if(lvlHideZero) rows = rows.filter(r=>r.balance>0);
  if(lvlSummaryFilter==='zero') rows = rows.filter(r=>r.balance===0);
  else if(lvlSummaryFilter==='low') rows = rows.filter(r=>r.balance>0 && r.balance<1000);
  else if(lvlSummaryFilter==='healthy') rows = rows.filter(r=>r.balance>=1000);

  const search = (document.getElementById('lvlSearch')?.value||'').toLowerCase();
  if(search) rows = rows.filter(r=> r.p.name.toLowerCase().includes(search) || String(r.p.width_cm||'').includes(search));

  if(lvlSortCol){
    const key = {name:r=>r.p.name.toLowerCase(), type:r=>r.p.type, width:r=>r.p.width_cm||0, balance:r=>r.balance, u30:r=>r.u30, daily:r=>r.daily, days:r=>r.days}[lvlSortCol];
    if(key) rows.sort((a,b)=>{ const av=key(a), bv=key(b); return (av<bv?-1:av>bv?1:0)*lvlSortDir; });
  }
  return rows;
}

function renderLevels(){
  // type pills
  document.getElementById('levelsTypeFilter').innerHTML = LVL_TYPE_FILTERS.map(t=>{
    const c = t.key && !t.key.startsWith('FT') ? TYPE_COLOR[t.key] : (t.key?TYPE_COLOR['Facial Tissue']:'#6b7280');
    const active = levelsTypeFilter===t.key;
    return `<span class="pill${active?' active':''}" style="--c:${c}" onclick="levelsTypeFilter='${t.key}';renderLevels();">${t.label}</span>`;
  }).join('');
  // priority pills
  const prios = [['', 'Все приоритеты'], ['high','🔴 High'], ['medium','🟠 Medium'], ['low','⚪ Low']];
  document.getElementById('levelsPriorityFilter').innerHTML = prios.map(([k,l])=>{
    const active = levelsPriorityFilter===k;
    return `<span class="pill${active?' active':''}" onclick="levelsPriorityFilter='${k}';renderLevels();">${l}</span>`;
  }).join('');
  // rate toggle pill state
  document.getElementById('lvlRateWeighted').classList.toggle('active', lvlRateMode==='weighted');
  document.getElementById('lvlRateManual').classList.toggle('active', lvlRateMode==='manual');
  const hzBtn = document.getElementById('lvlHideZeroBtn');
  hzBtn.textContent = (lvlHideZero?'✅ ':'🚫 ')+'Скрыть нулевые';

  const asOfBalances = lvlAsOfDate ? computeBalancesAsOf(lvlAsOfDate) : null;

  // ---- summary cards use type/priority filter but ignore search/hidezero/summary-filter itself ----
  let summaryBase = products.map(p=>({p, balance: asOfBalances ? (asOfBalances[p.id]||0) : Number(p.balance)}));
  if(levelsTypeFilter==='FT<60') summaryBase = summaryBase.filter(r=>r.p.type==='Facial Tissue' && (r.p.width_cm||0)<60);
  else if(levelsTypeFilter==='FT>=60') summaryBase = summaryBase.filter(r=>r.p.type==='Facial Tissue' && (r.p.width_cm||0)>=60);
  else if(levelsTypeFilter) summaryBase = summaryBase.filter(r=>r.p.type===levelsTypeFilter);
  if(levelsPriorityFilter) summaryBase = summaryBase.filter(r=>(r.p.priority||'')===levelsPriorityFilter);

  const totalStock = summaryBase.reduce((s,r)=>s+r.balance,0);
  const zeroCount = summaryBase.filter(r=>r.balance===0).length;
  const lowCount = summaryBase.filter(r=>r.balance>0 && r.balance<1000).length;
  const healthyCount = summaryBase.filter(r=>r.balance>=1000).length;
  document.getElementById('lvlTotalStock').textContent = fmt(totalStock).toLocaleString()+' м';
  document.getElementById('lvlTotalSub').textContent = summaryBase.length+' SKU · сброс фильтра';
  document.getElementById('lvlZeroCount').textContent = zeroCount;
  document.getElementById('lvlLowCount').textContent = lowCount;
  document.getElementById('lvlHealthyCount').textContent = healthyCount;

  // ---- type cards (always "today", ignore as-of, based on current balances) ----
  const byType = {};
  products.forEach(p=>{ byType[p.type] = (byType[p.type]||0) + Number(p.balance); });
  const typeEntries = Object.entries(byType).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const maxType = typeEntries.length? typeEntries[0][1] : 1;
  document.getElementById('lvlTypeCards').innerHTML = typeEntries.map(([type,v])=>{
    const c = TYPE_COLOR[type]||TYPE_COLOR.Other;
    const count = products.filter(p=>p.type===type).length;
    const pct = Math.round(v/maxType*100);
    return `<div class="card" style="padding:10px 12px;cursor:pointer" onclick="levelsTypeFilter='${type}';renderLevels();">
      <div style="display:inline-block;background:${c}22;color:${c};font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;margin-bottom:6px">${type}</div>
      <div class="num" style="font-size:15px;font-weight:700">${fmt(v).toLocaleString()} м</div>
      <div style="font-size:10.5px;color:var(--text-3);margin-bottom:6px">${count} товаров</div>
      <div class="type-bar-track" style="height:4px"><div class="type-bar-fill" style="width:${pct}%;background:${c}"></div></div>
    </div>`;
  }).join('');

  // ---- pending deliveries banner ----
  const pendingCount = deliveries.filter(d=>d.status==='pending').length;
  const banner = document.getElementById('lvlPendingBanner');
  if(pendingCount>0){ banner.classList.remove('hidden'); banner.textContent = '🚚 '+pendingCount+' ожидаемых поставок — см. колонку «Ожидается».'; }
  else banner.classList.add('hidden');

  // ---- table ----
  const rows = lvlFilteredSortedRows();
  const tbody = document.querySelector('#levelsTable tbody');
  if(!rows.length){ tbody.innerHTML = '<tr><td colspan="11" class="empty">Нет товаров</td></tr>'; return; }
  tbody.innerHTML = rows.map(({p,balance,daily,usedManual,u30,days,pending})=>{
    const badge = balance===0 ? '<span class="badge badge-critical" style="margin-left:6px">ZERO</span>'
                : balance<1000 ? '<span class="badge badge-soon" style="margin-left:6px">LOW</span>' : '';
    const dot = p.priority==='high' ? '🔴 ' : p.priority==='medium' ? '🟠 ' : p.priority==='low' ? '⚪ ' : '';
    const daysColor = balance===0 ? 'var(--red)' : days<7 ? 'var(--red)' : days<30 ? 'var(--amber)' : 'var(--green)';
    const daysText = balance===0 ? '0д' : !isFinite(days) ? '∞' : Math.floor(days)+'д';
    const levelPct = !isFinite(days) ? 100 : Math.min(100, Math.round(days/90*100));
    const levelColor = balance===0 ? 'var(--red)' : days<7 ? 'var(--red)' : days<30 ? 'var(--amber)' : 'var(--green)';
    const pendingCell = (pending.qtyM>0||pending.qtyKg>0)
      ? [
          pending.qtyM>0 ? `<span class="num" style="color:var(--brand);font-weight:600">+${fmt(pending.qtyM).toLocaleString()} м</span>` : '',
          pending.qtyKg>0 ? `<span class="num" style="color:var(--amber);font-weight:600">+${fmt(pending.qtyKg).toLocaleString()} кг</span>` : ''
        ].filter(Boolean).join('<br>') + (pending.eta?`<div style="font-size:10px;color:var(--text-3)">${pending.eta}</div>`:'')
      : '—';
    const dailyCell = usedManual
      ? `${fmt(daily).toLocaleString()} <a href="#" onclick="event.preventDefault();editManualRate(${p.id})" title="Изменить ручную норму">✏️</a>`
      : (canEdit() ? `${daily>0?fmt(daily).toLocaleString():'—'} <a href="#" onclick="event.preventDefault();editManualRate(${p.id})" title="Задать ручную норму" style="opacity:.5">✏️</a>` : (daily>0?fmt(daily).toLocaleString():'—'));
    return `<tr>
      <td>${dot}${p.name}${badge}</td>
      <td><span style="color:${TYPE_COLOR[p.type]};font-weight:600">${p.type}</span></td>
      <td>${p.width_cm??'—'}</td><td>${p.ply}</td><td>${p.gsm??'—'}</td>
      <td class="num" style="font-weight:600">${fmt(balance).toLocaleString()}</td>
      <td>${pendingCell}</td>
      <td class="num" style="color:var(--text-2)">${u30>0?fmt(u30).toLocaleString():'—'}</td>
      <td class="num">${dailyCell}</td>
      <td class="num" style="font-weight:600;color:${daysColor}">${daysText}</td>
      <td><div class="type-bar-track" style="height:5px;width:60px"><div class="type-bar-fill" style="width:${levelPct}%;background:${levelColor}"></div></div></td>
    </tr>`;
  }).join('');
}


// ---------------------------------------------------------------
// HISTORY
// ---------------------------------------------------------------
let histSortCol='', histSortDir=1;
function setHistSort(col){ if(histSortCol===col) histSortDir*=-1; else { histSortCol=col; histSortDir=1; } renderHistory(); }

function renderHistory(){
  const search = (document.getElementById('historySearch')?.value||'').toLowerCase();
  const tbody = document.querySelector('#historyTable tbody');
  let rows = stockLog;
  if(search) rows = rows.filter(r=> (r.products?.name||'').toLowerCase().includes(search) || (r.products?.type||'').toLowerCase().includes(search) || (r.note||'').toLowerCase().includes(search));
  if(histSortCol){
    const key = { date:r=>r.date, product:r=>(r.products?.name||'').toLowerCase(), op:r=>r.operation, qty:r=>Number(r.quantity) }[histSortCol];
    if(key) rows = [...rows].sort((a,b)=>{ const av=key(a), bv=key(b); return (av<bv?-1:av>bv?1:0)*histSortDir; });
  } else {
    rows = rows.slice(0,60);
  }
  if(histSortCol) rows = rows.slice(0,200);
  if(!rows.length){ tbody.innerHTML = '<tr><td colspan="6" class="empty">Нет записей</td></tr>'; return; }
  const opLabel = {add:'Приход +', deduct:'Расход −', update:'Установлено ='};
  tbody.innerHTML = rows.map(r=>`<tr>
    <td>${r.date}</td>
    <td>${r.products?.name||'—'} <span style="color:var(--text-3)">[${r.products?.type||''}]</span></td>
    <td>${opLabel[r.operation]||r.operation}</td>
    <td class="num">${fmt(r.quantity).toLocaleString()}</td>
    <td style="color:var(--text-2)">${r.note||''}</td>
    <td style="color:var(--text-3)">${r.user_id===me.id?'Вы':(r.user_id||'').slice(0,8)}</td>
  </tr>`).join('');
}

// ---------------------------------------------------------------
// FORECAST
// ---------------------------------------------------------------
let forecastMethod = 'weighted';   // 'weighted' | 'manual'
let forecastTypeFilterState = '';
let forecastImportanceFilterState = '';
let forecastActiveUrgency = 'all'; // 'all' | 'critical' | 'soon' | 'upcoming' | 'ok'

function onForecastMethodChange(){
  const isManual = document.getElementById('forecastMethodToggle').checked;
  forecastMethod = isManual ? 'manual' : 'weighted';
  const lblW = document.getElementById('fcLblWeighted'), lblM = document.getElementById('fcLblManual');
  lblW.style.color = isManual ? 'var(--text-3)' : 'var(--brand)'; lblW.style.fontWeight = isManual ? 500 : 700;
  lblM.style.color = isManual ? 'var(--brand)' : 'var(--text-3)'; lblM.style.fontWeight = isManual ? 700 : 500;
  document.getElementById('forecastMethodDesc').innerHTML = isManual
    ? 'Используется <b>ручная норма</b> (м/мес ÷ 30), при отсутствии — взвешенное среднее.'
    : 'Используется <b>взвешенное среднее</b> (70% посл. 30д + 30% за всё время).';
  document.getElementById('forecastMethodBanner').style.background = isManual ? 'var(--brand-light)' : '#EFF6FF';
  document.getElementById('forecastMethodBanner').style.borderColor = isManual ? 'var(--brand)' : '#93c5fd';
  document.getElementById('forecastMethodBanner').style.color = isManual ? 'var(--brand-dark)' : '#1d4ed8';
  renderForecast();
}
function setForecastFilter(type, btn){
  forecastTypeFilterState = type;
  document.querySelectorAll('#forecastFilterBar .filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderForecast();
}
function setForecastImportance(level, btn){
  forecastImportanceFilterState = level;
  document.querySelectorAll('#forecastImpBar .impf-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderForecast();
}
function setForecastUrgency(u){
  forecastActiveUrgency = (forecastActiveUrgency===u) ? 'all' : u;
  renderForecast();
}

function forecastRateFor(p, avgByProd){
  const weighted = avgByProd[p.id]||0;
  if(forecastMethod==='manual'){
    const manual = manualDailyRate(p);
    if(manual!=null) return {rate: manual, label:'manual'};
    return {rate: weighted, label: weighted>0 ? 'weighted*' : 'none'};
  }
  return {rate: weighted, label: weighted>0 ? 'weighted' : 'none'};
}

function typeBadgeHtml(type){
  const c = TYPE_COLOR[type]||TYPE_COLOR.Other;
  return `<span class="badge" style="background:${c}1c;color:${c}">${type}</span>`;
}

function renderForecast(){
  const search = (document.getElementById('forecastSearch')?.value||'').toLowerCase();
  const avgByProd = avgDailyByProduct();
  const now = new Date();

  let data = products.map(p=>{
    const {rate, label} = forecastRateFor(p, avgByProd);
    const balance = Number(p.balance);
    let daysLeft, runOutDate, orderByDate, urgency, runOutMonth, runOutYear;
    if(rate>0){
      daysLeft = Math.floor(balance/rate);
      const rod = new Date(now.getTime()+daysLeft*86400000);
      const obd = new Date(rod.getTime()-7*86400000);
      runOutDate = rod.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'});
      orderByDate = obd.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'});
      runOutMonth = rod.getMonth(); runOutYear = rod.getFullYear();
      urgency = daysLeft<=7?'critical':daysLeft<=30?'soon':daysLeft<=60?'upcoming':'ok';
    } else {
      daysLeft = null; runOutDate='нет данных'; orderByDate='нет данных';
      runOutMonth=99; runOutYear=9999; urgency='nodata';
    }
    return {p, rate, rateLabel:label, balance, daysLeft, runOutDate, orderByDate, urgency, runOutMonth, runOutYear};
  }).filter(r=>r.balance>0);

  if(forecastTypeFilterState) data = data.filter(r=>r.p.type===forecastTypeFilterState);
  if(forecastImportanceFilterState) data = data.filter(r=>(r.p.priority||'')===forecastImportanceFilterState);
  if(search) data = data.filter(r=> r.p.name.toLowerCase().includes(search) || String(r.p.width_cm||'').includes(search));

  const critical = data.filter(r=>r.urgency==='critical').length;
  const soon = data.filter(r=>r.urgency==='soon').length;
  const upcoming = data.filter(r=>r.urgency==='upcoming').length;
  const ok = data.filter(r=>r.urgency==='ok').length;
  const isA = u=>forecastActiveUrgency===u;
  const kpi = (u,label,val,colorVar)=>`<div class="avg-card${isA(u)?' active':''}" style="border-left:4px solid ${colorVar}" onclick="setForecastUrgency('${u}')">
      <div class="avg-lbl">${label}</div>
      <div class="avg-val" style="color:${colorVar}">${val}</div>
      <div class="avg-sub">${isA(u)?'✓ активно · сбросить':'нажмите, чтобы отфильтровать'}</div>
    </div>`;
  document.getElementById('forecastSummary').innerHTML =
    kpi('critical','🔴 Критично — 7 дней',critical,'var(--red)') +
    kpi('soon','🟡 Скоро — 30 дней',soon,'var(--amber)') +
    kpi('upcoming','🔵 Предстоит — 60 дней',upcoming,'#3b82f6') +
    kpi('ok','🟢 Норма — 60д+',ok,'var(--green)');

  if(forecastActiveUrgency!=='all') data = data.filter(r=>r.urgency===forecastActiveUrgency);

  const content = document.getElementById('forecastContent');
  if(!data.length){
    content.innerHTML = forecastActiveUrgency!=='all'
      ? `<div class="empty">Нет товаров в этой категории<br><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="setForecastUrgency('all')">← Показать все</button></div>`
      : `<div class="empty">Нет товаров с расходом</div>`;
    return;
  }

  const clearBar = forecastActiveUrgency!=='all'
    ? `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding:10px 14px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm)">
        <span style="font-size:13px;font-weight:600">Показано: <strong>${forecastActiveUrgency.toUpperCase()}</strong> — ${data.length}</span>
        <button class="btn btn-ghost btn-sm" onclick="setForecastUrgency('all')">✕ Все</button>
      </div>` : '';

  const groups = {};
  data.forEach(r=>{
    let key, label;
    if(r.urgency==='nodata'){ key='9999-99'; label='📋 Нет данных'; }
    else { key = r.runOutYear+'-'+String(r.runOutMonth+1).padStart(2,'0'); label = new Date(r.runOutYear,r.runOutMonth,1).toLocaleDateString('ru-RU',{month:'long',year:'numeric'}); }
    if(!groups[key]) groups[key] = {label, items:[]};
    groups[key].items.push(r);
  });

  const US = {
    critical:{bg:'#FBEAEA',border:'#fca5a5',dot:'var(--red)',label:'КРИТИЧНО'},
    soon:{bg:'#FBF1E1',border:'#fcd34d',dot:'var(--amber)',label:'СКОРО'},
    upcoming:{bg:'#E7EFFC',border:'#93c5fd',dot:'#3b82f6',label:'ПРЕДСТОИТ'},
    ok:{bg:'#E5F6EE',border:'#6ee7b7',dot:'var(--green)',label:'НОРМА'},
    nodata:{bg:'var(--surface-2)',border:'var(--border)',dot:'var(--text-3)',label:'НЕТ ДАННЫХ'}
  };

  content.innerHTML = clearBar + Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([key,group])=>{
    const cards = group.items.map(r=>{
      const p = r.p, s = US[r.urgency];
      const isManualFallback = forecastMethod==='manual' && r.rateLabel==='weighted*';
      const pendM = deliveries.filter(d=>d.product_id===p.id && d.status==='pending' && d.unit!=='kg');
      const pendKg = deliveries.filter(d=>d.product_id===p.id && d.status==='pending' && d.unit==='kg');
      const totalPendM = pendM.reduce((s,d)=>s+Number(d.quantity||0),0);
      let daysWithDelivery = null;
      if(totalPendM>0 && r.rate>0 && r.daysLeft!=null) daysWithDelivery = Math.floor((r.balance+totalPendM)/r.rate);
      const hasPending = pendM.length>0 || pendKg.length>0;
      const dot = p.priority==='high'?'🔴 ':p.priority==='medium'?'🟠 ':p.priority==='low'?'⚪ ':'';
      const deliverySection = hasPending ? `<div style="background:#EFF6FF;border:1px solid #93c5fd;border-radius:var(--radius-sm);padding:8px 10px;margin-top:2px">
          <div style="font-size:10px;font-weight:700;color:#1d4ed8;margin-bottom:4px">🚚 Ожидаемые поставки</div>
          <div style="display:flex;flex-direction:column;gap:3px">
            ${[...pendM,...pendKg].map(d=>`<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px">
              <span style="color:#1d4ed8;font-weight:600">+${fmt(d.quantity).toLocaleString()} ${d.unit==='kg'?'кг':'м'}</span>
              <span style="color:var(--text-2)">${d.expected_date||''}</span>
            </div>`).join('')}
          </div>
          ${daysWithDelivery!==null?`<div style="margin-top:6px;padding-top:6px;border-top:1px solid #93c5fd;font-size:11px;color:#1d4ed8">⏱ С учётом поставки: <strong>${daysWithDelivery} дн.</strong></div>`:''}
        </div>` : '';
      return `<div class="fc-card" style="background:${s.bg};border-color:${s.border}">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            <div style="width:8px;height:8px;border-radius:50%;background:${s.dot};flex-shrink:0"></div>
            <span style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${dot}${p.name}</span>
          </div>
          <div style="display:flex;gap:4px;align-items:center;flex-shrink:0;margin-left:6px">
            ${hasPending?'<span style="font-size:12px">🚚</span>':''}
            <span style="font-size:10px;font-weight:700;color:${s.dot};background:#fff;padding:2px 8px;border-radius:99px;border:1px solid ${s.border}">${s.label}</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${typeBadgeHtml(p.type)}
          <span style="font-size:11px;color:var(--text-2);padding:2px 8px;background:#fff;border-radius:99px;border:1px solid var(--border)">${p.width_cm||'—'}см · ${p.ply}сл · ${p.gsm||'—'}gsm</span>
          ${isManualFallback?`<span style="font-size:10px;color:var(--amber);padding:2px 8px;background:#FBF1E1;border-radius:99px;border:1px solid #fcd34d">⚠️ взвеш. (нет ручной)</span>`:''}
          ${r.rateLabel==='manual'?`<span style="font-size:10px;color:var(--brand-dark);padding:2px 8px;background:var(--brand-light);border-radius:99px;border:1px solid var(--brand)">✏️ ручная</span>`:''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div class="fc-box"><div class="fc-box-lbl">📦 Остаток</div><div class="fc-box-val">${fmt(r.balance).toLocaleString()} м</div></div>
          <div class="fc-box"><div class="fc-box-lbl">📉 В день</div><div class="fc-box-val">${r.rate>0?fmt(r.rate).toLocaleString()+' м/д':'—'}${p.manual_monthly_rate>0?`<div style="font-size:9px;color:var(--text-2)">${fmt(p.manual_monthly_rate).toLocaleString()} м/мес</div>`:''}</div></div>
          <div class="fc-box"><div class="fc-box-lbl">🏁 Кончится</div><div class="fc-box-val" style="color:${s.dot}">${r.runOutDate}</div></div>
          <div class="fc-box"><div class="fc-box-lbl">🛒 Заказать до</div><div class="fc-box-val" style="color:var(--amber)">${r.orderByDate}</div></div>
        </div>
        <div style="font-size:11px;color:var(--text-2);padding:4px 0;border-top:1px solid ${s.border}">⏱ ${r.daysLeft==null?'<strong>норма не задана</strong>':'<strong>'+r.daysLeft+' дн.</strong> осталось'}</div>
        ${deliverySection}
      </div>`;
    }).join('');
    return `<div style="margin-bottom:24px">
      <div style="font-size:14px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:10px">
        <span>📅 ${group.label}</span>
        <span style="font-size:11px;font-weight:500;color:var(--text-2);background:var(--surface);border:1px solid var(--border);padding:2px 10px;border-radius:99px">${group.items.length} товаров</span>
      </div>
      <div class="forecast-grid">${cards}</div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------
const ORDER_TYPES = ['Napkins','Facial Tissue','Toilet Paper','Towels','Spunlace','Dispenser'];
let orderTypeFilterState = '';
let orderPriorityFilterState = '';
let orderSortMode = '';
let orderNeedsOnlyState = false;
let orderHideZeroState = false;
let orderGroupBySupplierState = false;
let orderQtyMap = {};   // pid -> qty typed by user
let orderSupMap = {};   // pid -> supplier_id (string) chosen by user

function refreshOrders(){
  Promise.all([loadProducts(), loadDeliveries(), loadStockLog(), loadSuppliers()]).then(()=>{
    fillOrderSupplierOptions(); renderOrders();
  });
}

function getOrderTypeTarget(type){
  const el = document.getElementById('target-'+type);
  return el ? Math.max(1, parseInt(el.value)||2) : 2;
}

function fillOrderSupplierOptions(){
  const filterSel = document.getElementById('orderSupplierFilter');
  if(filterSel){
    const cur = filterSel.value;
    filterSel.innerHTML = '<option value="">— All —</option>' + suppliers.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
    if(cur) filterSel.value = cur;
  }
}

function buildOrderRows(){
  const avgByProd = avgDailyByProduct();
  const pendingByProduct = {};
  deliveries.filter(d=>d.status==='pending' && d.unit!=='kg').forEach(d=>{
    pendingByProduct[d.product_id] = (pendingByProduct[d.product_id]||0) + Number(d.quantity);
  });
  return products.map(p=>{
    const rate = avgByProd[p.id]||0;
    const monthly = rate*30;
    const targetMonths = getOrderTypeTarget(p.type);
    const targetQty = Math.round(monthly*targetMonths);
    const pending = pendingByProduct[p.id]||0;
    const alreadyHave = Number(p.balance)+pending;
    const rawSuggested = Math.max(0, targetQty-alreadyHave);
    const suggested = rawSuggested>0 ? Math.ceil(rawSuggested/500)*500 : 0;
    const daysLeft = rate>0 ? Math.floor(Number(p.balance)/rate) : (Number(p.balance)>0 ? null : 0);
    const hasRate = rate>0;
    const status = !hasRate ? 'noRate' : suggested>0 ? 'needsOrder' : 'okStock';
    return {p, rate, monthly, targetMonths, targetQty, pending, suggested, daysLeft, hasRate, status};
  });
}

function isUrgentOrder(r){
  const d = r.daysLeft==null ? 9999 : r.daysLeft;
  if(r.p.priority==='high') return d<=60;
  if(r.p.priority==='medium') return d<=30;
  return d<=14;
}

function renderOrderTypeTargets(){
  const host = document.getElementById('orderTypeTargets');
  host.innerHTML = ORDER_TYPES.map(t=>{
    const c = TYPE_COLOR[t]||TYPE_COLOR.Other;
    return `<div class="card" style="padding:12px 14px">
      <div style="margin-bottom:8px"><span class="badge" style="background:${c}1c;color:${c}">${t}</span></div>
      <div style="display:flex;align-items:center;gap:6px">
        <input type="number" id="target-${t}" value="2" min="1" max="12" onchange="applyOrderFilters()" style="width:56px;padding:6px 8px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);outline:none">
        <span style="font-size:11px;color:var(--text-2)">months</span>
      </div>
    </div>`;
  }).join('');
}

function setOrderTypeFilter(type){
  orderTypeFilterState = type;
  renderOrderTypeFilterBar();
  applyOrderFilters();
}
function renderOrderTypeFilterBar(){
  const bar = document.getElementById('orderTypeFilterBar');
  bar.innerHTML = ['',...ORDER_TYPES].map(t=>{
    const c = t? TYPE_COLOR[t] : '#6b7280';
    const active = orderTypeFilterState===t;
    return `<span class="pill${active?' active':''}" style="--c:${c}" onclick="setOrderTypeFilter('${t}')">${t||'All'}</span>`;
  }).join('');
}
function setOrderImportance(level){
  orderPriorityFilterState = level;
  renderOrderImpBar();
  applyOrderFilters();
}
function renderOrderImpBar(){
  const bar = document.getElementById('orderImpBar');
  const opts = [['','All'],['high','🔴'],['medium','🟠'],['low','⚪']];
  bar.innerHTML = opts.map(([k,l])=>`<button class="impf-btn${orderPriorityFilterState===k?' active':''}" onclick="setOrderImportance('${k}')">${l}</button>`).join('');
}
function showOnlyNeedsOrder(){
  orderNeedsOnlyState = !orderNeedsOnlyState;
  const btn = document.getElementById('orderNeedsOnlyBtn');
  btn.style.background = orderNeedsOnlyState ? 'var(--brand)' : 'var(--brand-light)';
  btn.style.color = orderNeedsOnlyState ? '#fff' : 'var(--brand-dark)';
  applyOrderFilters();
}
function toggleOrderZero(){
  orderHideZeroState = !orderHideZeroState;
  const btn = document.getElementById('hideZeroOrderBtn');
  btn.innerHTML = (orderHideZeroState?'✅ ':'🚫 ')+'Hide zero/inactive';
  applyOrderFilters();
}
function resetOrderFilters(){
  orderTypeFilterState=''; orderPriorityFilterState=''; orderSortMode=''; orderNeedsOnlyState=false;
  document.getElementById('orderSupplierFilter').value='';
  document.getElementById('orderSortSelect').value='';
  renderOrderTypeFilterBar(); renderOrderImpBar();
  const btn = document.getElementById('orderNeedsOnlyBtn');
  btn.style.background='var(--brand-light)'; btn.style.color='var(--brand-dark)';
  applyOrderFilters();
  toast('Фильтры сброшены');
}

function applyOrderFilters(){
  let rows = buildOrderRows();
  if(orderTypeFilterState) rows = rows.filter(r=>r.p.type===orderTypeFilterState);
  if(orderPriorityFilterState) rows = rows.filter(r=>(r.p.priority||'')===orderPriorityFilterState);
  if(orderHideZeroState) rows = rows.filter(r=>r.suggested>0 || r.status==='needsOrder');
  if(orderNeedsOnlyState) rows = rows.filter(r=>r.status==='needsOrder');
  const supF = document.getElementById('orderSupplierFilter').value;
  if(supF) rows = rows.filter(r=> String(orderSupMap[r.p.id]||'')===String(supF));

  orderSortMode = document.getElementById('orderSortSelect').value;
  if(orderSortMode==='balance-asc') rows.sort((a,b)=>a.p.balance-b.p.balance);
  else if(orderSortMode==='balance-desc') rows.sort((a,b)=>b.p.balance-a.p.balance);
  else if(orderSortMode==='suggested-desc') rows.sort((a,b)=>b.suggested-a.suggested);
  else if(orderSortMode==='monthly-desc') rows.sort((a,b)=>b.monthly-a.monthly);
  else if(orderSortMode==='daysleft-asc') rows.sort((a,b)=>(a.daysLeft??9999)-(b.daysLeft??9999));
  else if(orderSortMode==='supplier') rows.sort((a,b)=>String(orderSupMap[a.p.id]||'').localeCompare(String(orderSupMap[b.p.id]||'')));
  else if(orderSortMode==='type') rows.sort((a,b)=> a.p.type.localeCompare(b.p.type) || a.p.name.localeCompare(b.p.name));
  else if(orderSortMode==='priority'){ const rank={high:0,medium:1,low:2,'':3}; rows.sort((a,b)=> (rank[a.p.priority||'']-rank[b.p.priority||'']) || ((a.daysLeft??9999)-(b.daysLeft??9999))); }

  renderOrderTable(rows);
}

function orderRowHtml(r){
  const p = r.p;
  const balColor = p.balance==0?'var(--red)':p.balance<1000?'var(--amber)':'var(--green)';
  const daysColor = p.balance==0?'var(--red)':(r.daysLeft!=null&&r.daysLeft<7)?'var(--red)':(r.daysLeft!=null&&r.daysLeft<30)?'var(--amber)':'var(--green)';
  const urgent = r.suggested>0 && isUrgentOrder(r);
  const statusHtml = r.status==='noRate'
    ? '<span class="badge" style="background:var(--surface-2);color:var(--text-3)">no rate</span>'
    : r.status==='needsOrder'
    ? '<span class="badge badge-soon">⚠️ needs order</span>'
    : '<span class="badge badge-ok">✓ ok</span>';
  const qty = orderQtyMap[p.id] ?? (r.suggested>0 ? r.suggested : '');
  const sup = orderSupMap[p.id] || '';
  const dot = p.priority==='high'?'🔴 ':p.priority==='medium'?'🟠 ':p.priority==='low'?'⚪ ':'';
  return `<tr data-pid="${p.id}">
    <td>${dot}${p.name}</td>
    <td>${typeBadgeHtml(p.type)}</td>
    <td>${p.width_cm??'—'}</td><td>${p.ply}</td><td>${p.gsm??'—'}</td>
    <td class="num" style="color:${balColor};font-weight:600">${fmt(p.balance).toLocaleString()}${p.balance==0?' <span class="badge badge-critical" style="margin-left:2px">ZERO</span>':''}</td>
    <td class="num" style="font-weight:600;color:${daysColor}">${r.daysLeft==null?'<span style="color:var(--text-3);font-weight:400">∞</span>':r.daysLeft+'d'}${urgent?' 🚨':''}</td>
    <td class="num" style="color:var(--brand)">${r.pending>0?'+'+fmt(r.pending).toLocaleString():'—'}</td>
    <td class="num" style="color:var(--text-2)">${r.monthly>0?fmt(r.monthly).toLocaleString()+' m':'—'}</td>
    <td class="num">${r.targetQty>0?fmt(r.targetQty).toLocaleString()+' m<div style="font-size:9px;color:var(--text-3)">'+r.targetMonths+'mo</div>':'—'}</td>
    <td class="num" style="font-weight:600;color:${r.suggested>0?'var(--red)':'var(--green)'}">${r.suggested>0?fmt(r.suggested).toLocaleString()+' m':'✓'}</td>
    <td><input type="number" class="ord-qty" data-pid="${p.id}" value="${qty}" min="0" step="500" placeholder="0" oninput="onOrderQtyInput(${p.id},this)" style="width:90px;padding:6px 8px;font-size:12.5px;border:1.5px solid ${qty?'var(--brand)':'var(--border)'};border-radius:var(--radius-sm);background:${qty?'var(--brand-light)':'var(--surface)'};color:var(--text);outline:none;font-weight:${qty?600:400}"></td>
    <td><select class="ord-sup" data-pid="${p.id}" onchange="onOrderSupInput(${p.id},this)" style="padding:6px 8px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);outline:none"><option value="">—</option>${suppliers.map(s=>`<option value="${s.id}" ${String(sup)===String(s.id)?'selected':''}>${s.name}</option>`).join('')}</select></td>
    <td>${statusHtml}</td>
  </tr>`;
}

function renderOrderTable(rows){
  const wrap = document.getElementById('orderTableWrap');
  if(!rows.length){ wrap.innerHTML = '<div class="empty">Ничего не найдено под текущими фильтрами</div>'; updateOrderSummary(); return; }

  const header = `<tr>
    <th onclick="orderSortBy('name')" style="cursor:pointer">Product Name ↕</th>
    <th onclick="orderSortBy('type')" style="cursor:pointer">Type ↕</th>
    <th>Width (cm)</th><th>Ply</th><th>GSM</th>
    <th onclick="orderSortBy('balance-desc')" style="cursor:pointer">Current ↕</th>
    <th onclick="orderSortBy('daysleft-asc')" style="cursor:pointer">Days left ↕</th>
    <th>Incoming</th>
    <th onclick="orderSortBy('monthly-desc')" style="cursor:pointer">Monthly need ↕</th>
    <th>Target</th>
    <th onclick="orderSortBy('suggested-desc')" style="cursor:pointer">Suggested ↕</th>
    <th style="color:var(--brand)">Order Qty</th>
    <th style="color:#3b82f6">Supplier</th>
    <th>Status</th>
  </tr>`;

  if(orderGroupBySupplierState){
    const groups = {};
    rows.forEach(r=>{
      const supId = orderSupMap[r.p.id]||'';
      const supName = supId ? (suppliers.find(s=>String(s.id)===String(supId))?.name||'—') : '— No supplier —';
      if(!groups[supName]) groups[supName]=[];
      groups[supName].push(r);
    });
    wrap.innerHTML = Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([supName,grp])=>{
      const total = grp.reduce((s,r)=> s+Number(orderQtyMap[r.p.id]||0),0);
      return `<div style="margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--brand-light);border:1px solid var(--brand);border-radius:var(--radius-sm) var(--radius-sm) 0 0">
          <span style="font-size:13px;font-weight:700;color:var(--brand-dark)">🏭 ${supName}</span>
          <span style="font-size:11px;color:var(--brand-dark)">${grp.length} items · ${fmt(total).toLocaleString()} m total</span>
        </div>
        <table style="border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius-sm) var(--radius-sm)"><thead>${header}</thead><tbody>${grp.map(orderRowHtml).join('')}</tbody></table>
      </div>`;
    }).join('');
  } else {
    wrap.innerHTML = `<table><thead>${header}</thead><tbody>${rows.map(orderRowHtml).join('')}</tbody></table>`;
  }
  updateOrderSummary();
}

function orderSortBy(mode){ document.getElementById('orderSortSelect').value=mode; applyOrderFilters(); }

function onOrderQtyInput(pid, input){
  const v = parseFloat(input.value)||0;
  if(v>0) orderQtyMap[pid]=v; else delete orderQtyMap[pid];
  input.style.borderColor = v ? 'var(--brand)' : 'var(--border)';
  input.style.background = v ? 'var(--brand-light)' : 'var(--surface)';
  input.style.fontWeight = v ? 600 : 400;
  updateOrderSummary();
}
function onOrderSupInput(pid, select){
  if(select.value) orderSupMap[pid]=select.value; else delete orderSupMap[pid];
  updateOrderSummary();
}

function updateOrderSummary(){
  const entries = Object.entries(orderQtyMap).filter(([,v])=>v>0);
  const totalQty = entries.reduce((s,[,v])=>s+Number(v),0);
  const supSet = new Set(entries.map(([pid])=>orderSupMap[pid]).filter(Boolean));
  const bar = document.getElementById('orderSummaryBar');
  document.getElementById('orderTotalQty').textContent = fmt(totalQty).toLocaleString()+' m';
  document.getElementById('orderLineCount').textContent = entries.length;
  document.getElementById('orderSupplierCount').textContent = supSet.size;
  document.getElementById('orderTotalKg').textContent = fmt(totalQty).toLocaleString()+' kg';
  bar.classList.toggle('hidden', entries.length===0);
}

function toggleGroupBySupplier(){
  orderGroupBySupplierState = !orderGroupBySupplierState;
  document.getElementById('groupBySupplierLbl').textContent = orderGroupBySupplierState ? '✓ Grouped by supplier' : 'Group by supplier';
  applyOrderFilters();
}

function fillUrgentOnly(){
  const rows = buildOrderRows();
  let filled=0;
  rows.forEach(r=>{
    if(r.suggested>0 && isUrgentOrder(r)){ orderQtyMap[r.p.id]=r.suggested; filled++; }
    else delete orderQtyMap[r.p.id];
  });
  applyOrderFilters();
  toast(filled>0 ? '🚨 Заполнено срочных: '+filled : 'Нет срочных товаров');
}
function fillAllSuggested(){
  const rows = buildOrderRows();
  rows.forEach(r=>{ if(r.suggested>0) orderQtyMap[r.p.id]=r.suggested; });
  applyOrderFilters();
  toast('⚡ Заполнены все рекомендованные количества');
}
function clearAllOrders(){
  orderQtyMap = {}; orderSupMap = {};
  applyOrderFilters();
}
function setAllOrderSupplier(){
  if(!suppliers.length){ toast('Сначала добавьте поставщиков', true); return; }
  const name = prompt('Поставщик для всех отфильтрованных строк:\n'+suppliers.map(s=>s.name).join('\n'));
  if(!name) return;
  const sup = suppliers.find(s=>s.name.toLowerCase()===name.toLowerCase());
  if(!sup){ toast('Поставщик не найден', true); return; }
  buildOrderRows().forEach(r=>{ orderSupMap[r.p.id]=sup.id; });
  applyOrderFilters();
}

function saveOrderDraft(){
  const draft = { qty: orderQtyMap, sup: orderSupMap };
  localStorage.setItem('ss_order_draft', JSON.stringify(draft));
  toast('💾 Черновик сохранён ('+Object.keys(orderQtyMap).length+' поз.)');
}
function loadOrderDraft(){
  try{
    const raw = localStorage.getItem('ss_order_draft');
    if(!raw){ toast('Черновик не найден', true); return; }
    const draft = JSON.parse(raw);
    orderQtyMap = draft.qty||{}; orderSupMap = draft.sup||{};
    applyOrderFilters();
    toast('📂 Черновик загружен ('+Object.keys(orderQtyMap).length+' поз.)');
  }catch(e){ toast('Ошибка загрузки черновика', true); }
}

function exportOrderPdf(){ window.print(); }
function exportOrderExcelBySupplier(){
  const entries = Object.entries(orderQtyMap).filter(([,v])=>v>0);
  if(!entries.length){ toast('Нечего заказывать', true); return; }
  const rows = buildOrderRows();
  const lines = [['Supplier','Product','Type','Width','Ply','GSM','Order Qty (m)'].join(';')];
  entries.forEach(([pid,qty])=>{
    const r = rows.find(x=>String(x.p.id)===String(pid)); if(!r) return;
    const supId = orderSupMap[pid];
    const supName = supId ? (suppliers.find(s=>String(s.id)===String(supId))?.name||'') : '';
    lines.push([supName, r.p.name, r.p.type, r.p.width_cm||'', r.p.ply, r.p.gsm||'', fmt(qty)].join(';'));
  });
  const blob = new Blob(['\ufeff'+lines.join('\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='order-by-supplier-'+todayISO()+'.csv'; a.click(); URL.revokeObjectURL(url);
}

function renderOrders(){
  renderOrderTypeTargets();
  renderOrderTypeFilterBar();
  renderOrderImpBar();
  fillOrderSupplierOptions();
  applyOrderFilters();
}

// ---------------------------------------------------------------
// DELIVERIES
// ---------------------------------------------------------------
async function submitDelivery(){
  const err = document.getElementById('dvError'); err.textContent='';
  if(!canEdit()){ err.textContent='У вас нет прав на эту операцию.'; return; }
  const product_id = document.getElementById('dv-product').value;
  const supplier_id = document.getElementById('dv-supplier').value || null;
  const quantity = parseFloat(document.getElementById('dv-qty').value);
  const expected_date = document.getElementById('dv-date').value || null;
  const plate_no = document.getElementById('dv-plate').value.trim();
  if(!product_id){ err.textContent='Выберите товар.'; return; }
  if(!(quantity>0)){ err.textContent='Укажите количество.'; return; }

  const { error } = await sb.from('deliveries').insert({ product_id, supplier_id, quantity, unit:'m', expected_date, plate_no });
  if(error){ err.textContent = error.message; return; }
  toast('Поставка добавлена ✓');
  clearDeliveryForm();
  await loadDeliveries(); renderDeliveries(); renderOrders();
}

function clearDeliveryForm(){
  document.getElementById('dv-supplier').value = '';
  document.getElementById('dv-type-filter').value = '';
  filterDeliveryProductDropdown();
  document.getElementById('dv-qty').value = '';
  document.getElementById('dv-plate').value = '';
  document.getElementById('dv-date').value = todayISO();
  document.getElementById('dvHint').textContent = '💡 Select product — Width, Ply, GSM auto-fill';
}

async function markArrived(id){
  if(!canEdit()) return;
  const d = deliveries.find(x=>x.id===id);
  if(!d) return;
  const { error: e1 } = await sb.from('deliveries').update({ status:'arrived', arrived_at:new Date().toISOString() }).eq('id', id);
  if(e1){ toast(e1.message, true); return; }
  if(d.unit==='kg'){
    toast('Отмечено как получено. Количество в кг — добавьте на склад вручную через Stock Entry (в метрах).', true);
    await Promise.all([loadDeliveries(), loadProducts(), loadStockLog()]);
    renderDeliveries(); renderDashboard(); renderLevels(); renderForecast(); renderOrders();
    return;
  }
  const { error: e2 } = await sb.from('stock_log').insert({
    product_id: d.product_id, operation:'add', quantity: d.quantity, date: todayISO(),
    note: 'Поставка получена'+(d.plate_no?' · '+d.plate_no:''), user_id: me.id
  });
  if(e2){ toast(e2.message, true); }
  toast('Отмечено как получено ✓');
  await Promise.all([loadDeliveries(), loadProducts(), loadStockLog()]);
  renderDeliveries(); renderDashboard(); renderLevels(); renderForecast(); renderOrders();
}

async function removeDelivery(id){
  if(!confirm('Удалить эту поставку?')) return;
  const { error } = await sb.from('deliveries').delete().eq('id', id);
  if(error){ toast(error.message, true); return; }
  toast('Поставка удалена ✓');
  await loadDeliveries(); renderDeliveries(); renderOrders();
}

let delFilterState = 'all';
let delCollapsed = {};

function setDelFilter(f){
  delFilterState = f;
  renderDelFilterBar();
  renderDeliveries();
}
function renderDelFilterBar(){
  const bar = document.getElementById('deliveryFilterBar');
  const opts = [['all','All'],['pending','Pending'],['arrived','Arrived']];
  bar.innerHTML = opts.map(([k,l])=>`<span class="pill${delFilterState===k?' active':''}" onclick="setDelFilter('${k}')">${l}</span>`).join('');
}

function toggleDelFolder(key){
  delCollapsed[key] = !delCollapsed[key];
  const el = document.getElementById('delf-'+key);
  if(el) el.classList.toggle('collapsed', delCollapsed[key]);
}

function _delItemHtml(d){
  const p = d.products;
  const spec = p ? ` · ${p.width_cm||'—'}cm · ${p.ply??'—'}ply · ${p.gsm||'—'}gsm` : '';
  const dateStr = d.expected_date ? new Date(d.expected_date+'T00:00:00').toLocaleDateString('en-GB') : '';
  return `<div class="delivery-item">
    <div class="delivery-status ${d.status==='arrived'?'delivery-arrived':'delivery-pending'}"></div>
    <div style="flex:1;min-width:0">
      <div class="del-name">${p?p.name:'—'}${spec}</div>
      <div class="del-meta">${d.suppliers?.name||'—'} · ${fmt(d.quantity).toLocaleString()}${d.unit==='kg'?'кг':'м'} · ${d.status==='arrived'?'✓ Arrived':'Pending'}${dateStr?' · '+dateStr:''}</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0">
      ${d.status==='pending' && canEdit() ? `<button class="btn btn-ghost btn-sm" onclick="markArrived(${d.id})">✓ Arrived</button>` : ''}
      ${myProfile?.role==='admin' ? `<button class="btn-icon" onclick="removeDelivery(${d.id})" title="Удалить">✕</button>` : ''}
    </div>
  </div>`;
}

function renderDeliveries(){
  renderDelFilterBar();
  const wrap = document.getElementById('deliveryList');
  let data = deliveries;
  if(delFilterState==='pending') data = data.filter(d=>d.status==='pending');
  else if(delFilterState==='arrived') data = data.filter(d=>d.status==='arrived');
  if(!data.length){ wrap.innerHTML = '<div class="empty">Нет поставок</div>'; return; }

  const groups = {};
  data.forEach(d=>{
    const truck = (d.plate_no||'').trim() || '— no truck —';
    const date = d.expected_date || '— no date —';
    const key = (truck+'|'+date).replace(/[^a-zA-Z0-9]/g,'_') || 'k'+d.id;
    if(!groups[key]) groups[key] = {truck, date, items:[]};
    groups[key].items.push(d);
  });
  const sortMode = document.getElementById('deliverySort')?.value || 'date-desc';
  const groupQty = g => g.items.reduce((s,x)=>s+Number(x.quantity||0),0);
  const entries = Object.entries(groups).sort((a,b)=>{
    if(sortMode==='qty-desc') return groupQty(b[1]) - groupQty(a[1]);
    if(sortMode==='qty-asc') return groupQty(a[1]) - groupQty(b[1]);
    const da = a[1].date>'— no date —' ? a[1].date : '';
    const db = b[1].date>'— no date —' ? b[1].date : '';
    return sortMode==='date-asc' ? da.localeCompare(db) : db.localeCompare(da);
  });

  wrap.innerHTML = entries.map(([key,g])=>{
    const pending = g.items.filter(x=>x.status==='pending').length;
    const arrived = g.items.filter(x=>x.status==='arrived').length;
    const totalM = g.items.filter(x=>x.unit!=='kg').reduce((s,x)=>s+Number(x.quantity||0),0);
    const totalKg = g.items.filter(x=>x.unit==='kg').reduce((s,x)=>s+Number(x.quantity||0),0);
    const dateLbl = g.date==='— no date —' ? g.date : new Date(g.date+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
    const totalsTxt = [totalM>0?fmt(totalM).toLocaleString()+' m':'', totalKg>0?fmt(totalKg).toLocaleString()+' kg':''].filter(Boolean).join(' · ');
    const collapsed = delCollapsed[key] ? ' collapsed' : '';
    return `<div class="del-folder${collapsed}" id="delf-${key}">
      <div class="del-folder-head" onclick="toggleDelFolder('${key}')">
        <span class="del-chevron">▼</span>
        <div class="del-truck-icon">🚛</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${g.truck}</div>
          <div style="font-size:11px;color:var(--text-2)">📅 ${dateLbl} · ${g.items.length} item${g.items.length>1?'s':''}${totalsTxt?' · '+totalsTxt:''}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          ${pending>0?`<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:#FFFBEB;color:#92400e">${pending} pending</span>`:''}
          ${arrived>0?`<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--brand-light);color:var(--brand-dark)">${arrived} arrived</span>`:''}
        </div>
      </div>
      <div class="del-folder-body">${g.items.map(_delItemHtml).join('')}</div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------
// RESERVATIONS
// ---------------------------------------------------------------
let reservations = [];
let resFilterState = 'reserved';

async function loadReservations(){
  const { data, error } = await sb.from('reservations')
    .select('*, products(name,type,width_cm,ply,gsm)')
    .order('created_at',{ascending:false});
  if(error){ toast('Ошибка загрузки резервов: '+error.message, true); return; }
  reservations = data||[];
}

function reservedQtyFor(pid){
  return reservations.filter(r=>r.product_id===pid && r.status==='reserved').reduce((s,r)=>s+Number(r.quantity||0),0);
}

function filterResProductDropdown(){
  const typeFilter = document.getElementById('res-type-filter').value;
  const sel = document.getElementById('res-product');
  const list = typeFilter ? products.filter(p=>p.type===typeFilter) : products;
  sel.innerHTML = '<option value="">— select product —</option>' +
    list.map(p=>`<option value="${p.id}">${p.name} — ${p.width_cm||'—'}cm · ${p.ply}ply · ${p.gsm||'—'}gsm (${fmt(p.balance).toLocaleString()} m)</option>`).join('');
  onResProductSelect();
}

function onResProductSelect(){
  const pid = document.getElementById('res-product').value;
  const info = document.getElementById('resAvailInfo');
  const p = products.find(x=>String(x.id)===String(pid));
  if(!p){ info.classList.add('hidden'); ['res-width','res-ply','res-gsm'].forEach(id=>document.getElementById(id).value=''); return; }
  document.getElementById('res-width').value = p.width_cm ?? '';
  document.getElementById('res-ply').value = p.ply ?? '';
  document.getElementById('res-gsm').value = p.gsm ?? '';
  const reserved = reservedQtyFor(p.id);
  const avail = Math.max(0, Number(p.balance) - reserved);
  info.classList.remove('hidden');
  info.innerHTML = `📦 Stock: <b>${fmt(p.balance).toLocaleString()} m</b>` +
    (reserved>0 ? ` · 📌 already reserved: <b style="color:var(--amber)">${fmt(reserved).toLocaleString()} m</b>` : '') +
    ` · ✅ available: <b style="color:var(--green)">${fmt(avail).toLocaleString()} m</b>`;
}

function clearResForm(){
  document.getElementById('res-type-filter').value = '';
  filterResProductDropdown();
  ['res-qty','res-dest','res-note'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('res-date').value = todayISO();
}

async function submitReservation(){
  const err = document.getElementById('resError'); err.textContent='';
  const pid = document.getElementById('res-product').value;
  const qty = parseFloat(document.getElementById('res-qty').value)||0;
  const date = document.getElementById('res-date').value || todayISO();
  const p = products.find(x=>String(x.id)===String(pid));
  if(!p){ err.textContent='Выберите товар.'; return; }
  if(!(qty>0)){ err.textContent='Укажите количество.'; return; }
  const reserved = reservedQtyFor(p.id);
  const avail = Math.max(0, Number(p.balance)-reserved);
  if(qty>avail){ err.textContent = 'Доступно к резерву только '+fmt(avail).toLocaleString()+' м (остаток минус активные резервы).'; return; }

  const { error } = await sb.from('reservations').insert({
    product_id: p.id, date, quantity: qty,
    destination: document.getElementById('res-dest').value.trim(),
    note: document.getElementById('res-note').value.trim(),
    reserved_by: me.id, status: 'reserved'
  });
  if(error){ err.textContent = error.message; return; }
  toast('📌 Зарезервировано '+fmt(qty).toLocaleString()+' м — ожидает подтверждения');
  clearResForm();
  await loadReservations(); renderReservations(); onResProductSelect();
}

function setResFilter(status){
  resFilterState = status;
  renderResFilterBar();
  renderReservations();
}
function renderResFilterBar(){
  const bar = document.getElementById('resFilterBar');
  const opts = [['reserved','📌 Active'],['confirmed','✅ Confirmed'],['cancelled','✕ Cancelled'],['all','All']];
  bar.innerHTML = opts.map(([k,l])=>`<span class="pill${resFilterState===k?' active':''}" onclick="setResFilter('${k}')">${l}</span>`).join('');
}
function clearResDateFilter(){
  document.getElementById('res-date-filter').value = '';
  renderReservations();
}

function renderReservationKpis(){
  const active = reservations.filter(r=>r.status==='reserved');
  const confirmed = reservations.filter(r=>r.status==='confirmed');
  const cancelled = reservations.filter(r=>r.status==='cancelled');
  const activeTotal = active.reduce((s,r)=>s+Number(r.quantity||0),0);
  document.getElementById('resKpiActive').textContent = active.length;
  document.getElementById('resKpiTotal').textContent = fmt(activeTotal).toLocaleString()+' m';
  document.getElementById('resKpiConfirmed').textContent = confirmed.length;
  document.getElementById('resKpiCancelled').textContent = cancelled.length;
}

function renderReservations(){
  renderResFilterBar();
  renderReservationKpis();
  let items = reservations;
  if(resFilterState!=='all') items = items.filter(r=>r.status===resFilterState);
  const dateF = document.getElementById('res-date-filter').value;
  document.getElementById('resDateClearBtn').classList.toggle('hidden', !dateF);
  if(dateF) items = items.filter(r=>r.date===dateF);
  document.getElementById('resDateCount').textContent = dateF ? items.length+' on '+dateF : '';
  const sortMode = document.getElementById('resSort')?.value || 'date-desc';
  items = [...items].sort((a,b)=>{
    if(sortMode==='qty-desc') return Number(b.quantity)-Number(a.quantity);
    if(sortMode==='qty-asc') return Number(a.quantity)-Number(b.quantity);
    const da = a.created_at||'', db = b.created_at||'';
    return sortMode==='date-asc' ? da.localeCompare(db) : db.localeCompare(da);
  });

  const wrap = document.getElementById('resList');
  if(!items.length){ wrap.innerHTML = '<div class="empty">No reservations'+(dateF?' on this date':'')+'</div>'; return; }

  const statusBadge = {
    reserved: '<span class="badge badge-soon">📌 Reserved</span>',
    confirmed: '<span class="badge badge-ok">✅ Deducted</span>',
    cancelled: '<span class="badge" style="background:var(--surface-2);color:var(--text-3)">✕ Cancelled</span>'
  };
  wrap.innerHTML = items.map(r=>{
    const p = r.products;
    const diff = (r.status==='confirmed' && r.actual_qty!=null && Number(r.actual_qty)!==Number(r.quantity));
    const border = r.status==='reserved' ? '#fcd34d' : 'var(--border)';
    const when = new Date(r.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const byWho = r.reserved_by===me.id ? 'Вы' : (r.reserved_by||'').slice(0,8);
    return `<div style="background:var(--surface-2);border:1px solid ${border};border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
            <span style="font-size:13px;font-weight:600">${p?p.name:'—'}</span>
            ${p?typeBadgeHtml(p.type):''}
            ${statusBadge[r.status]||''}
          </div>
          <div style="font-size:11px;color:var(--text-2)">${p?`${p.width_cm||'—'}cm · ${p.ply}ply · ${p.gsm||'—'}gsm`:''}
            · <b style="color:var(--amber)">${fmt(r.quantity).toLocaleString()} m reserved</b>
            ${diff?` · verified <b style="color:${Number(r.actual_qty)<Number(r.quantity)?'var(--red)':'var(--green)'}">${fmt(r.actual_qty).toLocaleString()} m</b>`:''}
            ${r.destination?' · → '+r.destination:''}</div>
          <div style="font-size:10px;color:var(--text-3);margin-top:3px">📌 ${when} by ${byWho}${r.closed_at?' · '+(r.status==='confirmed'?'✅':'✕')+' '+new Date(r.closed_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}):''}${r.note?' · 📝 '+r.note:''}</div>
        </div>
        ${r.status==='reserved' ? (canEdit() ? `<div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-brand btn-sm" onclick="openResConfirm(${r.id})">✅ Verified — deduct</button>
            <button class="btn-icon" onclick="cancelRes(${r.id})" title="Отменить">✕</button>
          </div>` : '<div style="font-size:10px;color:var(--amber);font-weight:600;align-self:center">⏳ awaiting verification</div>') : ''}
      </div>
    </div>`;
  }).join('');
}

function openResConfirm(id){
  const r = reservations.find(x=>x.id===id);
  if(!r) return;
  document.getElementById('rc-id').value = id;
  const p = r.products;
  document.getElementById('rc-info').innerHTML = `<b>${p?p.name:'—'}</b> · ${p?`${p.width_cm||'—'}cm · ${p.ply}ply · ${p.gsm||'—'}gsm`:''}
    <div style="font-size:11px;color:var(--text-2);margin-top:3px">Reserved: <b style="color:var(--amber)">${fmt(r.quantity).toLocaleString()} m</b>${r.destination?' → '+r.destination:''}</div>`;
  document.getElementById('rc-actual').value = r.quantity;
  document.getElementById('resConfirmModal').classList.remove('hidden');
}

async function submitResConfirm(){
  const id = parseInt(document.getElementById('rc-id').value);
  const actual = parseFloat(document.getElementById('rc-actual').value)||0;
  if(!(actual>0)){ toast('Укажите подтверждённое количество', true); return; }
  const r = reservations.find(x=>x.id===id);
  if(!r) return;

  const { error: e1 } = await sb.from('reservations').update({
    status:'confirmed', actual_qty: actual, closed_by: me.id, closed_at: new Date().toISOString()
  }).eq('id', id);
  if(e1){ toast(e1.message, true); return; }

  const { error: e2 } = await sb.from('stock_log').insert({
    product_id: r.product_id, operation:'deduct', quantity: actual, date: todayISO(),
    note: 'Reservation #'+id+(r.destination?' → '+r.destination:'')+(actual!==r.quantity?` (reserved ${r.quantity}, verified ${actual})`:''),
    user_id: me.id
  });
  if(e2) toast(e2.message, true);

  document.getElementById('resConfirmModal').classList.add('hidden');
  toast('✅ Списано '+fmt(actual).toLocaleString()+' м со склада');
  await Promise.all([loadReservations(), loadProducts(), loadStockLog()]);
  renderReservations(); renderDashboard(); renderLevels(); renderForecast(); renderOrders();
}

async function cancelRes(id){
  if(!confirm('Отменить этот резерв? Количество останется на складе.')) return;
  const { error } = await sb.from('reservations').update({ status:'cancelled', closed_by: me.id, closed_at: new Date().toISOString() }).eq('id', id);
  if(error){ toast(error.message, true); return; }
  toast('Резерв отменён ✓');
  await loadReservations(); renderReservations();
}

// ---------------------------------------------------------------
// SCANNER (shared helpers + full page + Reservations mini-scanner)
// ---------------------------------------------------------------
async function callScannerApi(base64, mimeType){
  let res;
  try{
    res = await fetch('/.netlify/functions/scan-invoice', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ imageBase64: base64, mimeType })
    });
  }catch(networkErr){
    return { success:false, error: 'Сеть/сервер недоступен: '+networkErr.message };
  }
  const text = await res.text();
  if(!text){
    return { success:false, error: 'Сервер вернул пустой ответ (HTTP '+res.status+'). Обычно это значит, что функция превысила лимит времени/размера — попробуйте фото поменьше или менее детализированное.' };
  }
  try{
    return JSON.parse(text);
  }catch(parseErr){
    return { success:false, error: 'Сервер вернул не-JSON (HTTP '+res.status+'): '+text.slice(0,200) };
  }
}

// Downscale + re-encode an image client-side before sending it to the scanner,
// so large phone photos don't hit the function's payload/time limits.
function resizeImageForScan(file, maxDim=1600, quality=0.82){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = e=>{
      const img = new Image();
      img.onload = ()=>{
        let { width, height } = img;
        if(width>maxDim || height>maxDim){
          if(width>height){ height = Math.round(height*maxDim/width); width = maxDim; }
          else { width = Math.round(width*maxDim/height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.onerror = ()=>reject(new Error('Не удалось прочитать изображение'));
      img.src = e.target.result;
    };
    reader.onerror = ()=>reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function scannerParseWidthCm(mm){
  const m = String(mm||'').match(/(\d+)/);
  if(!m) return '';
  const v = parseInt(m[1]);
  return v>=100 ? String(Math.round(v/10)) : String(v);
}

function scannerGuessType(name){
  const low = (name||'').toLowerCase();
  if(low.includes('toilet')||low.includes('тб')) return 'Toilet Paper';
  if(low.includes('towel')||low.includes('бп')) return 'Towels';
  if(low.includes('napkin')||low.includes('бс')||low.includes('սալֆեթ')) return 'Napkins';
  if(low.includes('spunlace')||low.includes('спанлейс')||low.includes('нетканы')||low.includes('non woven')||low.includes('non-woven')) return 'Spunlace';
  if(low.includes('facial')||low.includes('нп')||low.includes('սալֆեթ')) return 'Facial Tissue';
  if(low.includes('dispenser')) return 'Dispenser';
  return '';
}

function findMatchingProduct(width, layers, gsm){
  const w = String(width||'').replace(/[^0-9.]/g,''), l = String(layers||'').replace(/[^0-9.]/g,''), g = String(gsm||'').replace(/[^0-9.]/g,'');
  return products.find(p=>
    String(p.width_cm||'').replace(/[^0-9.]/g,'')===w &&
    String(p.ply||'').replace(/[^0-9.]/g,'')===l &&
    String(p.gsm||'').replace(/[^0-9.]/g,'')===g
  );
}

// ---- full Scanner page ----
let scannerImgData=null, scannerImgType=null, scannerLines=[];

function resetScanner(){
  scannerImgData=null; scannerImgType=null; scannerLines=[];
  document.getElementById('scannerDropZone').classList.remove('hidden');
  document.getElementById('scannerPreviewZone').classList.add('hidden');
  document.getElementById('scannerLoading').classList.add('hidden');
  document.getElementById('scannerResults').classList.add('hidden');
  document.getElementById('scannerFileInput').value='';
}
function handleScannerDrop(e){ const f=e.dataTransfer.files[0]; if(f) handleScannerFile(f); }
async function handleScannerFile(file){
  if(!file||!file.type.startsWith('image/')){ toast('Загрузите файл изображения', true); return; }
  try{
    const { dataUrl, base64, mimeType } = await resizeImageForScan(file);
    scannerImgData = base64; scannerImgType = mimeType;
    document.getElementById('scannerPreviewImg').src = dataUrl;
    document.getElementById('scannerDropZone').classList.add('hidden');
    document.getElementById('scannerPreviewZone').classList.remove('hidden');
  }catch(e){ toast('Ошибка обработки изображения: '+e.message, true); }
}

async function runScanner(){
  if(!scannerImgData){ toast('Нет изображения', true); return; }
  document.getElementById('scannerPreviewZone').classList.add('hidden');
  document.getElementById('scannerLoading').classList.remove('hidden');
  try{
    const res = await callScannerApi(scannerImgData, scannerImgType);
    document.getElementById('scannerLoading').classList.add('hidden');
    if(!res.success){ document.getElementById('scannerPreviewZone').classList.remove('hidden'); toast('Ошибка сканирования: '+(res.error||'unknown'), true); return; }
    const items = res.items||[];
    scannerLines = items.map((it,i)=>{
      const width = scannerParseWidthCm(it.width_mm);
      const gsm = String(it.gsm||''), layers = String(it.layers||'1');
      const qtyKg = it.net_weight_t ? Math.round(parseFloat(it.net_weight_t)*1000) : '';
      const guessedType = scannerGuessType(it.name_en||it.name_original||'');
      const matched = findMatchingProduct(width, layers, gsm);
      return {
        id:i, name_original: it.name_original||'', name_en: it.name_en||'',
        type: matched?matched.type:guessedType, width, layers, gsm, qtyKg,
        net_weight_t: it.net_weight_t||'', matchedProductId: matched?matched.id:null,
        selected: true, supplier_id:'', plate:''
      };
    });
    renderScannerResults();
  }catch(e){
    document.getElementById('scannerLoading').classList.add('hidden');
    document.getElementById('scannerPreviewZone').classList.remove('hidden');
    toast('Не удалось связаться со сканером: '+e.message, true);
  }
}

function renderScannerResults(){
  const wrap = document.getElementById('scannerResults');
  wrap.classList.remove('hidden');
  const typeOpts = ['','Napkins','Facial Tissue','Toilet Paper','Towels','Dispenser','Spunlace','Other'];
  const selectedCount = scannerLines.filter(l=>l.selected).length;
  wrap.innerHTML = `
    <div style="padding:10px 16px;background:var(--brand-light);border:1px solid var(--brand);border-radius:var(--radius-sm);margin:16px 0 14px;display:flex;align-items:center;justify-content:space-between;font-size:13px">
      <span style="color:var(--brand-dark)">✅ Найдено <b>${scannerLines.length}</b> позиций — проверьте перед добавлением</span>
      <span style="color:var(--text-2)">${selectedCount} выбрано</span>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-title" style="margin-bottom:12px">📋 Применить ко всем строкам</div>
      <div class="form-grid">
        <div class="form-row"><label>🏭 Поставщик</label><select id="scannerGlobalSupplier" onchange="scannerApplyGlobal()"><option value="">— select supplier —</option>${suppliers.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}</select></div>
        <div class="form-row"><label>🚛 Номер машины</label><input type="text" id="scannerGlobalPlate" placeholder="e.g. 97AP560" oninput="scannerApplyGlobal()"></div>
        <div class="form-row"><label>📅 Ожидаемая дата</label><input type="date" id="scannerGlobalDate" value="${todayISO()}"></div>
      </div>
    </div>
    <div id="scannerLineCards">${scannerLines.map(scannerLineCardHtml).join('')}</div>
    <div class="btn-row">
      <button class="btn btn-brand" style="width:100%;justify-content:center;padding:12px" id="scannerConfirmBtn" onclick="scannerConfirm()">✅ Добавить ${selectedCount} строк в поставки</button>
    </div>`;
}

function scannerLineCardHtml(line){
  const isNew = !line.matchedProductId;
  return `<div class="card" style="border-color:${isNew?'#fcd34d':'var(--border)'};margin-bottom:10px" id="scanner-card-${line.id}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <input type="checkbox" ${line.selected?'checked':''} onchange="scannerToggle(${line.id})" style="width:16px;height:16px;accent-color:var(--brand)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${line.name_original}${isNew?' <span class="badge badge-soon">🆕 NEW product</span>':' <span class="badge badge-ok">✓ matched</span>'}</div>
        <div style="font-size:11px;color:var(--text-2)">${line.name_en}</div>
      </div>
    </div>
    <div class="grid grid-4">
      <div class="form-row"><label>Type</label><select onchange="scannerUpdate(${line.id},'type',this.value)">${['Napkins','Facial Tissue','Toilet Paper','Towels','Dispenser','Spunlace','Other'].map(t=>`<option value="${t}" ${line.type===t?'selected':''}>${t||'—'}</option>`).join('')}</select></div>
      <div class="form-row"><label>Width (cm)</label><input type="text" value="${line.width}" onchange="scannerUpdate(${line.id},'width',this.value)"></div>
      <div class="form-row"><label>Ply</label><input type="text" value="${line.layers}" onchange="scannerUpdate(${line.id},'layers',this.value)"></div>
      <div class="form-row"><label>GSM</label><input type="text" value="${line.gsm}" onchange="scannerUpdate(${line.id},'gsm',this.value)"></div>
    </div>
    <div class="grid grid-2" style="margin-top:8px">
      <div class="form-row"><label style="color:var(--brand-dark)">Quantity (kg) ★</label><input type="number" value="${line.qtyKg}" onchange="scannerUpdate(${line.id},'qtyKg',this.value)" style="border-color:var(--brand);background:var(--brand-light);font-weight:600"></div>
      <div class="form-row"><label>Net weight (t), исходно</label><input type="text" value="${line.net_weight_t}" readonly style="color:var(--text-3)"></div>
    </div>
  </div>`;
}

function scannerToggle(id){
  const l = scannerLines.find(x=>x.id===id); if(!l) return;
  l.selected = !l.selected;
  renderScannerResults();
}
function scannerUpdate(id, field, value){
  const l = scannerLines.find(x=>x.id===id); if(!l) return;
  l[field] = value;
  if(field==='width'||field==='layers'||field==='gsm'){
    const matched = findMatchingProduct(l.width, l.layers, l.gsm);
    l.matchedProductId = matched?matched.id:null;
    if(matched) l.type = matched.type;
    renderScannerResults();
  }
}
function scannerApplyGlobal(){
  const sup = document.getElementById('scannerGlobalSupplier').value;
  const plate = document.getElementById('scannerGlobalPlate').value;
  scannerLines.forEach(l=>{ l.supplier_id=sup; l.plate=plate; });
}

async function scannerConfirm(){
  const selected = scannerLines.filter(l=>l.selected);
  if(!selected.length){ toast('Не выбрано ни одной строки', true); return; }
  const globalSupplier = document.getElementById('scannerGlobalSupplier').value;
  const globalPlate = document.getElementById('scannerGlobalPlate').value;
  const globalDate = document.getElementById('scannerGlobalDate').value || todayISO();

  const btn = document.getElementById('scannerConfirmBtn');
  btn.disabled = true; btn.textContent = '⏳ Добавление…';
  let added=0, failed=0;
  for(const line of selected){
    try{
      let pid = line.matchedProductId;
      if(!pid){
        if(!line.type){ failed++; continue; }
        const { data, error } = await sb.from('products').insert({
          name: line.name_original || 'Scanned product', type: line.type,
          width_cm: parseFloat(line.width)||null, ply: parseInt(line.layers)||1, gsm: parseFloat(line.gsm)||null
        }).select().single();
        if(error) throw error;
        pid = data.id;
        products.push(data);
      }
      const qty = parseFloat(line.qtyKg)||0;
      if(!(qty>0)) { failed++; continue; }
      const { error: e2 } = await sb.from('deliveries').insert({
        product_id: pid, supplier_id: line.supplier_id||globalSupplier||null, quantity: qty, unit:'kg',
        plate_no: line.plate||globalPlate||'', expected_date: globalDate, status:'pending'
      });
      if(e2) throw e2;
      added++;
    }catch(e){ failed++; }
  }
  btn.disabled = false;
  toast('✅ Добавлено поставок: '+added+(failed?' · ошибок: '+failed:''), added===0);
  if(added>0){
    await Promise.all([loadDeliveries(), loadProducts()]);
    fillProductSelects(); renderProducts(); renderLevels(); renderOrders();
    resetScanner();
    showPane('deliveries'); renderDeliveries();
  }
}

// ---- Reservations mini-scanner ----
let resScanImgData=null, resScanImgType=null, resScanLines=[];

function toggleResScanner(){
  const area = document.getElementById('resScanArea');
  const show = area.classList.contains('hidden');
  area.classList.toggle('hidden', !show);
  document.getElementById('resScanToggleLbl').textContent = show ? 'Hide scanner' : '📷 Scan document';
  if(!show) resScanReset();
}
function resScanReset(){
  resScanImgData=null; resScanImgType=null; resScanLines=[];
  document.getElementById('resScanDrop').classList.remove('hidden');
  document.getElementById('resScanPreview').classList.add('hidden');
  document.getElementById('resScanLoading').classList.add('hidden');
  document.getElementById('resScanResults').classList.add('hidden');
  document.getElementById('resScanFile').value='';
}
function resScanFromDrop(e){ const f=e.dataTransfer.files[0]; if(f) resScanFile(f); }
async function resScanFile(file){
  if(!file||!file.type.startsWith('image/')){ toast('Загрузите файл изображения', true); return; }
  try{
    const { dataUrl, base64, mimeType } = await resizeImageForScan(file);
    resScanImgData = base64; resScanImgType = mimeType;
    document.getElementById('resScanImg').src = dataUrl;
    document.getElementById('resScanDrop').classList.add('hidden');
    document.getElementById('resScanPreview').classList.remove('hidden');
  }catch(e){ toast('Ошибка обработки изображения: '+e.message, true); }
}

async function resRunScan(){
  if(!resScanImgData){ toast('Нет изображения', true); return; }
  document.getElementById('resScanPreview').classList.add('hidden');
  document.getElementById('resScanLoading').classList.remove('hidden');
  try{
    const res = await callScannerApi(resScanImgData, resScanImgType);
    document.getElementById('resScanLoading').classList.add('hidden');
    if(!res.success){ document.getElementById('resScanPreview').classList.remove('hidden'); toast('Ошибка сканирования: '+(res.error||'unknown'), true); return; }
    const items = res.items||[];
    resScanLines = items.map((it,i)=>{
      const width = scannerParseWidthCm(it.width_mm);
      const gsm = String(it.gsm||''), layers = String(it.layers||'1');
      const matched = findMatchingProduct(width, layers, gsm);
      return { id:i, name: it.name_original||it.name_en||'', width, layers, gsm, net_weight_t: it.net_weight_t||'', matched: matched||null };
    });
    resRenderScanResults();
  }catch(e){
    document.getElementById('resScanLoading').classList.add('hidden');
    document.getElementById('resScanPreview').classList.remove('hidden');
    toast('Не удалось связаться со сканером: '+e.message, true);
  }
}

function resRenderScanResults(){
  const wrap = document.getElementById('resScanResults');
  wrap.classList.remove('hidden');
  wrap.innerHTML = `<div style="font-size:12px;color:var(--brand-dark);background:var(--brand-light);border:1px solid var(--brand);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:10px">Найдено ${resScanLines.length} строк(и). Нажмите «Use», чтобы подставить товар и характеристики в форму выше — количество для резерва впишите вручную (в документе указан вес, а не метры).</div>` +
    resScanLines.map(l=>{
      const m = l.matched;
      return `<div class="card" style="padding:10px 12px;margin-bottom:7px;border-color:${m?'var(--border)':'#fcd34d'}">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600">${m?m.name:l.name}${m?'':' <span style="font-size:10px;color:#b45309">⚠️ no exact match — pick product manually</span>'}</div>
            <div style="font-size:10.5px;color:var(--text-2)">${l.width||'?'}cm · ${l.layers||'?'}ply · ${l.gsm||'?'}gsm${l.net_weight_t?' · '+l.net_weight_t+'t on document':''}</div>
          </div>
          <button class="btn ${m?'btn-brand':'btn-ghost'} btn-sm" onclick="resUseScannedLine(${l.id})">Use ›</button>
        </div>
      </div>`;
    }).join('');
}

function resUseScannedLine(id){
  const l = resScanLines.find(x=>x.id===id); if(!l) return;
  if(l.matched){
    document.getElementById('res-type-filter').value = l.matched.type||'';
    filterResProductDropdown();
    document.getElementById('res-product').value = l.matched.id;
    onResProductSelect();
  } else {
    document.getElementById('res-product').value = '';
    document.getElementById('resAvailInfo').classList.add('hidden');
    document.getElementById('res-width').value = l.width||'';
    document.getElementById('res-ply').value = l.layers||'';
    document.getElementById('res-gsm').value = l.gsm||'';
  }
  document.getElementById('res-note').value = '📷 scanned'+(l.net_weight_t?' · '+l.net_weight_t+'t on document':'');
  document.getElementById('resManualFormAnchor')?.scrollIntoView({behavior:'smooth', block:'center'});
  toast(l.matched ? 'Товар подставлен — впишите количество и Reserve' : 'Товар не найден — выберите вручную из списка');
}

// ---------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------
async function submitProduct(){
  const err = document.getElementById('npError'); err.textContent='';
  if(!canEdit()){ err.textContent='У вас нет прав на эту операцию.'; return; }
  const name = document.getElementById('np-name').value.trim();
  const type = document.getElementById('np-type').value;
  const width_cm = parseFloat(document.getElementById('np-width').value)||null;
  const ply = parseInt(document.getElementById('np-ply').value)||1;
  const gsm = parseFloat(document.getElementById('np-gsm').value)||null;
  const target_months = parseFloat(document.getElementById('np-target').value)||2;
  if(!name){ err.textContent='Укажите название.'; return; }

  const { error } = await sb.from('products').insert({ name, type, width_cm, ply, gsm, target_months });
  if(error){ err.textContent = error.message; return; }
  toast('Товар добавлен ✓');
  document.getElementById('np-name').value=''; document.getElementById('np-width').value=''; document.getElementById('np-gsm').value='';
  await loadProducts(); fillProductSelects(); renderProducts(); renderLevels();
}

async function deleteProduct(id){
  if(!confirm('Удалить товар? Это также удалит всю его историю.')) return;
  const { error } = await sb.from('products').delete().eq('id', id);
  if(error){ toast(error.message, true); return; }
  toast('Товар удалён ✓');
  await Promise.all([loadProducts(), loadStockLog()]);
  fillProductSelects(); renderProducts(); renderLevels(); renderDashboard();
}

let productsTypeFilter = '';

let prodSortCol='', prodSortDir=1;
function setProdSort(col){ if(prodSortCol===col) prodSortDir*=-1; else { prodSortCol=col; prodSortDir=1; } renderProducts(); }

function renderProducts(){
  const search = (document.getElementById('productsSearch')?.value||'').toLowerCase();
  document.getElementById('productsTypeFilter').innerHTML = ['',...TYPES].map(t=>{
    const c = t? TYPE_COLOR[t] : '#6b7280';
    const active = productsTypeFilter===t;
    return `<span class="pill${active?' active':''}" style="--c:${c}" onclick="productsTypeFilter='${t}';renderProducts();">${t||'Все'}</span>`;
  }).join('');

  const avgByProd = avgDailyByProduct();
  const tbody = document.querySelector('#productsTable tbody');
  let rows = products;
  if(productsTypeFilter) rows = rows.filter(p=>p.type===productsTypeFilter);
  if(search) rows = rows.filter(p=> p.name.toLowerCase().includes(search) || p.type.toLowerCase().includes(search));
  if(prodSortCol){
    const key = {
      name:p=>p.name.toLowerCase(), type:p=>p.type, width:p=>p.width_cm||0,
      balance:p=>Number(p.balance), weighted:p=>avgByProd[p.id]||0, manual:p=>p.manual_monthly_rate||0
    }[prodSortCol];
    if(key) rows = [...rows].sort((a,b)=>{ const av=key(a), bv=key(b); return (av<bv?-1:av>bv?1:0)*prodSortDir; });
  }
  if(!rows.length){ tbody.innerHTML = '<tr><td colspan="13" class="empty">Ничего не найдено</td></tr>'; return; }

  tbody.innerHTML = rows.map(p=>{
    const weighted = avgByProd[p.id]||0;
    const manualDaily = (p.manual_monthly_rate && p.manual_monthly_rate>0) ? p.manual_monthly_rate/30 : null;
    const balColor = p.balance==0 ? 'var(--red)' : p.balance<1000 ? 'var(--amber)' : 'var(--green)';
    const tc = TYPE_COLOR[p.type]||TYPE_COLOR.Other;
    const prioStyle = { high:['#FBEAEA','var(--red)','●'], medium:['#FDF1E1','var(--amber)','●'], low:['#EFEBFB','#7C6FBE','○'], '':['var(--surface-2)','var(--text-3)','—'] }[p.priority||''];
    return `<tr data-pid="${p.id}">
      <td>
        <input type="text" class="pr-name-input" data-pid="${p.id}" value="${(p.name||'').replace(/"/g,'&quot;')}">
        <div style="font-size:10.5px;color:var(--text-3);margin-top:2px">${p.width_cm||'—'}cm · ${p.ply}ply · ${p.gsm||'—'}gsm</div>
      </td>
      <td><select class="pr-type pill-select" data-pid="${p.id}" style="background-color:${tc}1c;color:${tc}">
        ${TYPES.map(t=>`<option value="${t}" ${p.type===t?'selected':''}>${t}</option>`).join('')}
      </select></td>
      <td>${p.width_cm??'—'}</td><td>${p.ply}</td><td>${p.gsm??'—'}</td>
      <td class="num" style="color:${balColor};font-weight:600">${fmt(p.balance).toLocaleString()}m</td>
      <td class="num" style="color:var(--text-3)">${weighted>0?fmt(weighted).toLocaleString()+' m/d':'—'}</td>
      <td><input type="number" class="pr-manual-input" data-pid="${p.id}" placeholder="e.g. 3000" value="${p.manual_monthly_rate||''}" min="0" step="10"></td>
      <td class="num" style="color:${manualDaily?'var(--brand)':'var(--text-3)'};font-weight:${manualDaily?600:400}">${manualDaily?fmt(manualDaily).toLocaleString()+' m/d':'—'}</td>
      <td>
        <select class="pr-priority pill-select" data-pid="${p.id}" style="background-color:${prioStyle[0]};color:${prioStyle[1]}">
          <option value="" ${!p.priority?'selected':''}>— None</option>
          <option value="high" ${p.priority==='high'?'selected':''}>● High</option>
          <option value="medium" ${p.priority==='medium'?'selected':''}>● Medium</option>
          <option value="low" ${p.priority==='low'?'selected':''}>○ Low</option>
        </select>
      </td>
      <td><input type="text" class="pr-comp-input" data-pid="${p.id}" placeholder="30/70" value="${p.composition||''}" title="PES/VIS, только для Spunlace"></td>
      <td>—</td>
      <td>
        <div style="display:flex;gap:6px;justify-content:center;align-items:center">
          <button class="btn btn-brand btn-sm" onclick="saveProductRow(${p.id})">Save</button>
          ${canEdit() ? `<button class="btn-icon" onclick="deleteProduct(${p.id})" title="Удалить товар">✕</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function saveProductRow(pid){
  if(!canEdit()) return;
  const row = document.querySelector(`tr[data-pid="${pid}"]`);
  if(!row) return;
  const nameInput = row.querySelector('.pr-name-input');
  const typeSelect = row.querySelector('.pr-type');
  const manualInput = row.querySelector('.pr-manual-input');
  const prioSelect = row.querySelector('.pr-priority');
  const compInput = row.querySelector('.pr-comp-input');
  const name = nameInput.value.trim();
  if(!name){ toast('Название не может быть пустым', true); return; }
  const manual_monthly_rate = manualInput.value ? parseFloat(manualInput.value) : null;
  const priority = prioSelect.value || null;
  const patch = { name, type: typeSelect.value, manual_monthly_rate, priority };
  if(compInput){
    const comp = compInput.value.trim();
    if(comp && !/^\d{1,3}\s*\/\s*\d{1,3}$/.test(comp)){ toast('Состав в формате PES/VIS, напр. 30/70', true); return; }
    patch.composition = comp || null;
  }
  const { error } = await sb.from('products').update(patch).eq('id', pid);
  if(error){ toast(error.message, true); return; }
  const p = products.find(x=>x.id===pid);
  if(p) Object.assign(p, patch);
  toast('Сохранено ✓');
  fillProductSelects();
  renderProducts(); renderLevels(); renderForecast();
}

// ---------------------------------------------------------------
// SUPPLIERS
// ---------------------------------------------------------------
function refreshSuppliers(){ loadSuppliers().then(()=>{ fillSupplierSelect(); renderSuppliers(); }); }

async function submitSupplier(){
  const err = document.getElementById('nsError'); err.textContent='';
  if(!canEdit()){ err.textContent='У вас нет прав на эту операцию.'; return; }
  const editId = document.getElementById('ns-edit-id').value;
  const name = document.getElementById('ns-name').value.trim();
  const contact = document.getElementById('ns-contact').value.trim();
  const phone = document.getElementById('ns-phone').value.trim();
  const email = document.getElementById('ns-email').value.trim();
  const notes = document.getElementById('ns-notes').value.trim();
  if(!name){ err.textContent='Укажите название.'; return; }

  if(editId){
    const { error } = await sb.from('suppliers').update({ name, contact, phone, email, notes }).eq('id', editId);
    if(error){ err.textContent = error.message; return; }
    toast('Поставщик обновлён ✓');
  } else {
    const { error } = await sb.from('suppliers').insert({ name, contact, phone, email, notes });
    if(error){ err.textContent = error.message; return; }
    toast('Поставщик добавлен ✓');
  }
  clearSupplierForm();
  await loadSuppliers(); fillSupplierSelect(); renderSuppliers();
}

function editSupplier(id){
  const s = suppliers.find(x=>x.id===id);
  if(!s) return;
  document.getElementById('ns-edit-id').value = s.id;
  document.getElementById('ns-name').value = s.name||'';
  document.getElementById('ns-contact').value = s.contact||'';
  document.getElementById('ns-phone').value = s.phone||'';
  document.getElementById('ns-email').value = s.email||'';
  document.getElementById('ns-notes').value = s.notes||'';
  document.getElementById('supplierFormTitle').textContent = 'Edit: '+s.name;
  document.getElementById('supplierSubmitBtn').innerHTML = '💾 Save changes';
  document.getElementById('pane-suppliers').scrollIntoView({behavior:'smooth', block:'start'});
}

function clearSupplierForm(){
  document.getElementById('ns-edit-id').value = '';
  ['ns-name','ns-contact','ns-phone','ns-email','ns-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('supplierFormTitle').textContent = 'Add supplier';
  document.getElementById('supplierSubmitBtn').innerHTML = '＋ Add supplier';
}

async function deleteSupplier(id){
  if(!confirm('Удалить этого поставщика?')) return;
  const { error } = await sb.from('suppliers').delete().eq('id', id);
  if(error){ toast(error.message, true); return; }
  toast('Поставщик удалён ✓');
  await loadSuppliers(); fillSupplierSelect(); renderSuppliers();
}

function renderSuppliers(){
  const search = (document.getElementById('suppliersSearch')?.value||'').toLowerCase();
  const sortMode = document.getElementById('suppliersSort')?.value||'';
  const wrap = document.getElementById('supplierList');
  let rows = suppliers;
  if(search) rows = rows.filter(s=> s.name.toLowerCase().includes(search) || (s.contact||'').toLowerCase().includes(search) || (s.phone||'').toLowerCase().includes(search) || (s.email||'').toLowerCase().includes(search));
  if(sortMode==='name-asc') rows = [...rows].sort((a,b)=>a.name.localeCompare(b.name));
  else if(sortMode==='name-desc') rows = [...rows].sort((a,b)=>b.name.localeCompare(a.name));
  if(!rows.length){ wrap.innerHTML = '<div class="empty">Ничего не найдено</div>'; return; }
  wrap.innerHTML = rows.map(s=>{
    const metaParts = [
      s.contact ? `👤 ${s.contact}` : '',
      s.phone ? `📞 ${s.phone}` : '',
      s.email ? `✉️ ${s.email}` : ''
    ].filter(Boolean).join(' · ');
    return `<div class="supplier-card">
      <div class="supplier-icon">🏭</div>
      <div style="flex:1;min-width:0">
        <div class="supplier-name">${s.name}</div>
        <div class="supplier-meta">${metaParts || '—'}${s.notes?`<div style="margin-top:2px;font-style:italic">${s.notes}</div>`:''}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn-edit" onclick="editSupplier(${s.id})">✏️ Edit</button>
        <button class="btn-icon" onclick="deleteSupplier(${s.id})" title="Удалить">✕</button>
      </div>
    </div>`;
  }).join('');
}

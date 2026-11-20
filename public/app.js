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
  if(name==='audit') loadAudit(true);
  if(name==='supstock') renderSupStock(true);
  if(name==='shipments') shLoad(true);
  if(name==='service') renderService();
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
  await Promise.all([loadProducts(), loadSuppliers(), loadDeliveries(), loadStockLog(), loadReservations(), loadProfileNames(), loadSupStock()]);
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
  products = (data||[]).sort(productOrderCmp);
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
  // Supabase returns at most 1000 rows per request, so read the year page by page
  const PAGE = 1000, all = [];
  for(let from = 0; from < 50000; from += PAGE){
    const { data, error } = await sb.from('stock_log')
      .select('*, products(name,type)')
      .gte('date', since)
      .order('date',{ascending:false})
      .order('created_at',{ascending:false})
      .order('id',{ascending:false})
      .range(from, from + PAGE - 1);
    if(error){ toast('Ошибка загрузки истории: '+error.message, true); return; }
    all.push(...(data||[]));
    if(!data || data.length < PAGE) break;
  }
  stockLog = all;
}

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------
function todayISO(){ return new Date().toISOString().slice(0,10); }
function daysAgoISO(n){ const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }
function firstOfMonthISO(){ const d=new Date(); d.setDate(1); return d.toISOString().slice(0,10); }
function fmt(n){ return Math.round((n||0)*10)/10; }
// Formats a kg quantity, adding a tonnes hint for large totals: "12,345.6 кг (12.3 т)"
function fmtKgT(kg){
  const v = fmt(kg);
  const txt = v.toLocaleString()+' кг';
  return Math.abs(v)>=1000 ? txt+' <span style="opacity:.65;font-weight:400">('+(v/1000).toLocaleString(undefined,{maximumFractionDigits:2})+' т)</span>' : txt;
}
function toast(msg, isError){
  const el = document.createElement('div');
  el.className = 'toast'+(isError?' err':'');
  el.textContent = msg;
  document.getElementById('toastHost').appendChild(el);
  setTimeout(()=>el.remove(), isError ? 8000 : 3500);
}
// Порядок товаров по умолчанию во всех таблицах:
// сначала «Ռուլոն սպիտակ», затем остальные; внутри — ширина ↑, слои ↑, GSM ↑, название.
function isWhiteRoll(p){ return /^ռուլոն\s+սպիտակ/.test(String(p?.name||'').toLocaleLowerCase('hy').replace(/\s+/g,' ').trim()); }
function productOrderCmp(a, b){
  if(!a || !b) return !a - !b;
  return (isWhiteRoll(b) - isWhiteRoll(a))
    || ((a.width_cm ?? 1e9) - (b.width_cm ?? 1e9))
    || ((a.ply ?? 99) - (b.ply ?? 99))
    || ((a.gsm ?? 1e9) - (b.gsm ?? 1e9))
    || String(a.name||'').localeCompare(String(b.name||''))
    || String(a.type||'').localeCompare(String(b.type||''));
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
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>c.parsed.y.toLocaleString()+' кг/день — нажмите для товаров'}} },
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
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c2=>c2.parsed.x.toLocaleString()+' кг/день — нажмите для истории'}} },
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
        { type:'line', label:'Среднее '+fmt(avg).toLocaleString()+' кг/д', data: days.map(()=>Math.round(avg)), borderColor:'#D98F2B', borderDash:[5,4], pointRadius:0, borderWidth:1.5 }
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
  today:     { title:'📅 Сегодня', unit:'кг',     crumb:'расход сегодня, по типам' },
  avgDaily:  { title:'📈 Средний расход/день', unit:'кг/день', crumb:'за 30 дней, по типам' },
  mtd:       { title:'📦 Расход с начала месяца', unit:'кг', crumb:'с начала месяца, по типам' },
  lastMonth: { title:'📦 Итог за прошлый месяц', unit:'кг', crumb:'предыдущий календарный месяц, по типам' }
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
  body.innerHTML = `<div style="font-size:12px;color:var(--text-3);margin-bottom:12px">Всего: <b style="color:var(--text)">${fmt(total).toLocaleString()} кг</b></div>` +
    entries.map(([type,v])=>{
      const c = TYPE_COLOR[type]||TYPE_COLOR.Other;
      const pct = Math.round(v/total*100);
      return `<div class="type-row" style="--c:${c}" onclick="dayDrillProducts('${type}')">
        <div class="type-row-head"><span class="type-name">${type}</span>
        <span><span class="type-val num">${fmt(v).toLocaleString()} кг</span><span class="type-pct">${pct}%</span></span></div>
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
        <span class="num" style="font-weight:600">${fmt(v).toLocaleString()} кг</span>
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
      <div class="num" style="font-weight:600;color:var(--brand)">${fmt(consumed).toLocaleString()} кг</div>
      <div style="font-size:10.5px;color:var(--text-3);margin:6px 0 2px">ПРИХОД</div>
      <div class="num" style="font-size:12.5px;color:var(--text-2)">${fmt(received).toLocaleString()} кг</div>
      <div style="font-size:11px;color:var(--text-3);margin-top:6px">Ø ${fmt(avgDaily).toLocaleString()} кг/д</div>
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
            <div class="num" style="font-size:12.5px;font-weight:600;margin-top:3px">${fmt(v.out).toLocaleString()} кг</div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text-3);margin-bottom:3px">ПРИХОД</div>
            <div class="type-bar-track"><div class="type-bar-fill" style="width:${inPct}%;background:var(--amber)"></div></div>
            <div class="num" style="font-size:12.5px;font-weight:600;margin-top:3px;color:var(--amber)">${fmt(v.in).toLocaleString()} кг</div>
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
          <div class="num" style="font-size:11px;margin-top:2px">↓ ${fmt(out).toLocaleString()} кг</div>
        </div>
        <div>
          <div class="type-bar-track" style="height:4px"><div class="type-bar-fill" style="width:${inPct}%;background:var(--amber)"></div></div>
          <div class="num" style="font-size:11px;margin-top:2px;color:var(--amber)">↑ ${fmt(inn).toLocaleString()} кг</div>
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
    <td><span class="pname">${p.name} <span style="color:var(--text-3)">${p.width_cm||'—'}·${p.ply}пл·${p.gsm||'—'}</span></span></td>
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
    return `<tr data-pcard="${p.id}" title="Открыть карточку товара">
      <td><span class="pname">${p.name} <span style="color:var(--text-3)">${p.width_cm||'—'}·${p.ply}пл·${p.gsm||'—'}</span></span></td>
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
        <span><span class="type-val num">${fmt(val).toLocaleString()} кг</span><span class="type-pct">${pct}%</span></span>
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
// Zero-stock items with High/Medium priority are never hidden by the "hide zero" buttons
function isImportantPriority(p){ return p && (p.priority==='high' || p.priority==='medium'); }
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
  const qty = pend.reduce((s,d)=>s+Number(d.quantity||0),0);
  if(!pend.length) return {qty:0, eta:''};
  const withDate = pend.filter(d=>d.expected_date).sort((a,b)=> a.expected_date<b.expected_date?-1:1);
  let eta = '';
  if(withDate.length){
    const days = Math.round((new Date(withDate[0].expected_date)-new Date(todayISO()))/86400000);
    eta = days<0 ? `просрочено ${-days}д` : days===0 ? 'сегодня' : days===1 ? 'завтра' : `через ${days}д`;
  }
  return {qty, eta};
}

async function editManualRate(pid){
  if(!canEdit()) return;
  const p = products.find(x=>x.id===pid);
  if(!p) return;
  const val = prompt('Ручная норма расхода, кг/месяц (для товара "'+p.name+'"):', p.manual_monthly_rate||'');
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
  const header = ['Товар','Тип','Ширина','Ply','GSM','Остаток(кг)','Ожидается(кг)','30д','Расход/день','Дней'];
  const lines = [header.join(';')];
  rows.forEach(r=>{
    lines.push([r.p.name, r.p.type, r.p.width_cm||'', r.p.ply, r.p.gsm||'', fmt(r.balance), fmt(r.pending.qty), fmt(r.u30), fmt(r.daily), isFinite(r.days)?fmt(r.days):'∞'].join(';'));
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
  if(lvlHideZero) rows = rows.filter(r=>r.balance>0 || isImportantPriority(r.p));
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
  hzBtn.title = 'Нулевые позиции с приоритетом High и Medium показываются всегда';

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
  document.getElementById('lvlTotalStock').innerHTML = fmtKgT(totalStock);
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
      <div class="num" style="font-size:15px;font-weight:700">${fmtKgT(v)}</div>
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
  if(!rows.length){ tbody.innerHTML = '<tr><td colspan="12" class="empty">Нет товаров</td></tr>'; return; }
  tbody.innerHTML = rows.map(({p,balance,daily,usedManual,u30,days,pending})=>{
    const badge = balance===0 ? '<span class="badge badge-critical" style="margin-left:6px">ZERO</span>'
                : balance<1000 ? '<span class="badge badge-soon" style="margin-left:6px">LOW</span>' : '';
    const dot = p.priority==='high' ? '🔴 ' : p.priority==='medium' ? '🟠 ' : p.priority==='low' ? '⚪ ' : '';
    const daysColor = balance===0 ? 'var(--red)' : days<7 ? 'var(--red)' : days<30 ? 'var(--amber)' : 'var(--green)';
    const daysText = balance===0 ? '0д' : !isFinite(days) ? '∞' : Math.floor(days)+'д';
    const levelPct = !isFinite(days) ? 100 : Math.min(100, Math.round(days/90*100));
    const levelColor = balance===0 ? 'var(--red)' : days<7 ? 'var(--red)' : days<30 ? 'var(--amber)' : 'var(--green)';
    const pendingCell = pending.qty>0
      ? `<span class="num" style="color:var(--brand);font-weight:600">+${fmt(pending.qty).toLocaleString()} кг</span>${pending.eta?`<div style="font-size:10px;color:var(--text-3)">${pending.eta}</div>`:''}`
      : '—';
    const dailyCell = usedManual
      ? `${fmt(daily).toLocaleString()} <a href="#" onclick="event.preventDefault();editManualRate(${p.id})" title="Изменить ручную норму">✏️</a>`
      : (canEdit() ? `${daily>0?fmt(daily).toLocaleString():'—'} <a href="#" onclick="event.preventDefault();editManualRate(${p.id})" title="Задать ручную норму" style="opacity:.5">✏️</a>` : (daily>0?fmt(daily).toLocaleString():'—'));
    return `<tr data-pcard="${p.id}" title="Открыть карточку товара">
      <td>${dot}<span class="pname">${p.name}</span>${badge}</td>
      <td><span style="color:${TYPE_COLOR[p.type]};font-weight:600">${p.type}</span></td>
      <td>${p.width_cm??'—'}</td><td>${p.ply}</td><td>${p.gsm??'—'}</td>
      <td class="num" style="font-weight:600">${fmt(balance).toLocaleString()}</td>
      <td>${pendingCell}</td>
      <td class="num" data-sort="${supStockFor(p.id).total}">${supStockCellHtml(p.id)}</td>
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
    rows = rows.slice(0,300);
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
    <td style="color:var(--text-3)">${r.user_id===me.id?'Вы':userName(r.user_id)}</td>
  </tr>`).join('');
}

// ---------------------------------------------------------------
// FORECAST
// ---------------------------------------------------------------
let forecastMethod = 'weighted';   // 'weighted' | 'manual'
let forecastTypeFilterState = '';
let forecastImportanceFilterState = '';
let forecastHideZero = (()=>{ try{ return localStorage.getItem('ss_fc_hidezero')==='1'; }catch(e){ return false; } })();
function toggleForecastHideZero(){
  forecastHideZero = !forecastHideZero;
  try{ localStorage.setItem('ss_fc_hidezero', forecastHideZero?'1':'0'); }catch(e){}
  renderForecast();
}
let forecastActiveUrgency = 'all'; // 'all' | 'critical' | 'soon' | 'upcoming' | 'ok'

function onForecastMethodChange(){
  const isManual = document.getElementById('forecastMethodToggle').checked;
  forecastMethod = isManual ? 'manual' : 'weighted';
  const lblW = document.getElementById('fcLblWeighted'), lblM = document.getElementById('fcLblManual');
  lblW.style.color = isManual ? 'var(--text-3)' : 'var(--brand)'; lblW.style.fontWeight = isManual ? 500 : 700;
  lblM.style.color = isManual ? 'var(--brand)' : 'var(--text-3)'; lblM.style.fontWeight = isManual ? 700 : 500;
  document.getElementById('forecastMethodDesc').innerHTML = isManual
    ? 'Используется <b>ручная норма</b> (кг/мес ÷ 30), при отсутствии — взвешенное среднее.'
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
    if(balance<=0 && (rate>0 || isImportantPriority(p))){
      // already out of stock but still consumed — the most urgent case
      daysLeft = 0; runOutDate = 'закончился'; orderByDate = 'срочно';
      runOutMonth = -1; runOutYear = 0; urgency = 'out';
    } else if(rate>0){
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
  }).filter(r=>r.balance>0 || r.urgency==='out');   // zero stock, no consumption, low/no priority = inactive, hidden
  if(forecastHideZero) data = data.filter(r=>r.balance>0 || isImportantPriority(r.p));
  const hzb = document.getElementById('fcHideZeroBtn');
  if(hzb) hzb.textContent = (forecastHideZero?'✅ ':'🚫 ')+'Скрыть нулевые';

  if(forecastTypeFilterState) data = data.filter(r=>r.p.type===forecastTypeFilterState);
  if(forecastImportanceFilterState) data = data.filter(r=>(r.p.priority||'')===forecastImportanceFilterState);
  if(search) data = data.filter(r=> r.p.name.toLowerCase().includes(search) || String(r.p.width_cm||'').includes(search));

  const outCnt = data.filter(r=>r.urgency==='out').length;
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
  document.getElementById('forecastSummary').style.gridTemplateColumns = 'repeat(5,1fr)';
  document.getElementById('forecastSummary').innerHTML =
    kpi('out','⛔ Нет на складе',outCnt,'#991b1b') +
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
    else if(r.urgency==='out'){ key='0000-00'; label='⛔ Нет на складе — нужен заказ'; }
    else { key = r.runOutYear+'-'+String(r.runOutMonth+1).padStart(2,'0'); label = new Date(r.runOutYear,r.runOutMonth,1).toLocaleDateString('ru-RU',{month:'long',year:'numeric'}); }
    if(!groups[key]) groups[key] = {label, items:[]};
    groups[key].items.push(r);
  });

  const US = {
    out:{bg:'#FDE2E2',border:'#ef4444',dot:'#991b1b',label:'НЕТ НА СКЛАДЕ'},
    critical:{bg:'#FBEAEA',border:'#fca5a5',dot:'var(--red)',label:'КРИТИЧНО'},
    soon:{bg:'#FBF1E1',border:'#fcd34d',dot:'var(--amber)',label:'СКОРО'},
    upcoming:{bg:'#E7EFFC',border:'#93c5fd',dot:'#3b82f6',label:'ПРЕДСТОИТ'},
    ok:{bg:'#E5F6EE',border:'#6ee7b7',dot:'var(--green)',label:'НОРМА'},
    nodata:{bg:'var(--surface-2)',border:'var(--border)',dot:'var(--text-3)',label:'НЕТ ДАННЫХ'}
  };

  content.innerHTML = clearBar + Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([key,group])=>{
    const fsort = document.getElementById('forecastSort')?.value || 'format';
    const dk = r => r.daysLeft==null ? Infinity : r.daysLeft;
    group.items.sort((a,b)=>{
      if(fsort==='days-desc') return dk(b)-dk(a);
      if(fsort==='balance-asc') return a.balance-b.balance;
      if(fsort==='balance-desc') return b.balance-a.balance;
      if(fsort==='rate-desc') return b.rate-a.rate;
      if(fsort==='name') return a.p.name.localeCompare(b.p.name) || (a.p.width_cm||0)-(b.p.width_cm||0);
      if(fsort==='days-asc') return dk(a)-dk(b);
      return productOrderCmp(a.p, b.p);
    });
    const cards = group.items.map(r=>{
      const p = r.p, s = US[r.urgency];
      const isManualFallback = forecastMethod==='manual' && r.rateLabel==='weighted*';
      const pend = deliveries.filter(d=>d.product_id===p.id && d.status==='pending');
      const totalPend = pend.reduce((s,d)=>s+Number(d.quantity||0),0);
      let daysWithDelivery = null;
      if(totalPend>0 && r.rate>0 && r.daysLeft!=null) daysWithDelivery = Math.floor((r.balance+totalPend)/r.rate);
      const hasPending = pend.length>0;
      const dot = p.priority==='high'?'🔴 ':p.priority==='medium'?'🟠 ':p.priority==='low'?'⚪ ':'';
      const deliverySection = hasPending ? `<div style="background:#EFF6FF;border:1px solid #93c5fd;border-radius:var(--radius-sm);padding:8px 10px;margin-top:2px">
          <div style="font-size:10px;font-weight:700;color:#1d4ed8;margin-bottom:4px">🚚 Ожидаемые поставки</div>
          <div style="display:flex;flex-direction:column;gap:3px">
            ${pend.map(d=>`<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px">
              <span style="color:#1d4ed8;font-weight:600">+${fmt(d.quantity).toLocaleString()} кг</span>
              <span style="color:var(--text-2)">${d.expected_date||''}</span>
            </div>`).join('')}
          </div>
          ${daysWithDelivery!==null?`<div style="margin-top:6px;padding-top:6px;border-top:1px solid #93c5fd;font-size:11px;color:#1d4ed8">⏱ С учётом поставки: <strong>${daysWithDelivery} дн.</strong></div>`:''}
        </div>` : '';
      const supRows = (typeof supStock!=='undefined' ? supStock : []).filter(x=>x.product_id===p.id && Number(x.quantity)>0);
      const supAgg = {}; supRows.forEach(x=>{ const sn = (suppliers.find(z=>z.id===x.supplier_id)?.name||'?') + (x.warehouse ? ' · '+x.warehouse : '');
        (supAgg[sn] = supAgg[sn] || { kg:0, asOf:'', sid:x.supplier_id, wh:x.warehouse||'' }); supAgg[sn].kg += Number(x.quantity); if((x.as_of||'')>supAgg[sn].asOf) supAgg[sn].asOf = x.as_of; });
      const supTotal = Object.values(supAgg).reduce((a,v)=>a+v.kg,0);
      const supplierSection = supTotal>0 ? `<div class="fc-sup">
          <div class="fc-sup-h">🏭 Готово у поставщика: ${fmt(supTotal).toLocaleString()} кг</div>
          ${Object.entries(supAgg).sort((a,b)=>b[1].kg-a[1].kg).map(([n,v])=>{ const inPlan = fcPlannedQty(p.id, v.sid, v.wh);
            return `<div class="fc-sup-r"><span>${escHtml(n)}${v.asOf?` <span style="color:var(--text-3)">· ${v.asOf.slice(8,10)}.${v.asOf.slice(5,7)}</span>`:''}${inPlan?`<br><span class="fc-inplan">🚛 в плане ${fmt(inPlan).toLocaleString()} кг</span>`:''}</span>
              <span style="display:flex;align-items:center;gap:6px;flex-shrink:0"><b>${fmt(v.kg).toLocaleString()} кг</b>${canEdit()?`<button class="fc-add" title="Добавить в машину" onclick="event.stopPropagation();fcAddToTruck(${p.id},${v.sid},${escHtml(JSON.stringify(v.wh))})">＋ в машину</button>`:''}</span></div>`; }).join('')}
        </div>` : '';
      return `<div class="fc-card" data-pcard="${p.id}" title="Открыть карточку товара" style="background:${s.bg};border-color:${s.border}">
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
          <div class="fc-box"><div class="fc-box-lbl">📦 Остаток</div><div class="fc-box-val">${fmtKgT(r.balance)}</div></div>
          <div class="fc-box"><div class="fc-box-lbl">📉 В день</div><div class="fc-box-val">${r.rate>0?fmt(r.rate).toLocaleString()+' кг/д':'—'}${p.manual_monthly_rate>0?`<div style="font-size:9px;color:var(--text-2)">${fmt(p.manual_monthly_rate).toLocaleString()} кг/мес</div>`:''}</div></div>
          <div class="fc-box"><div class="fc-box-lbl">🏁 Кончится</div><div class="fc-box-val" style="color:${s.dot}">${r.runOutDate}</div></div>
          <div class="fc-box"><div class="fc-box-lbl">🛒 Заказать до</div><div class="fc-box-val" style="color:var(--amber)">${r.orderByDate}</div></div>
        </div>
        <div style="font-size:11px;color:var(--text-2);padding:4px 0;border-top:1px solid ${s.border}">${r.urgency==='out'?'⛔ <strong>Закончился</strong> — '+(r.rate>0?'расход '+fmt(r.rate).toLocaleString()+' кг/день, ':'расхода нет, но приоритет '+(r.p.priority==='high'?'High':'Medium')+' — ')+'нужен заказ':'⏱ '+(r.daysLeft==null?'<strong>норма не задана</strong>':'<strong>'+r.daysLeft+' дн.</strong> осталось')}</div>
        ${deliverySection}
        ${supplierSection}
      </div>`;
    }).join('');
    return `<div style="margin-bottom:24px">
      <div style="font-size:14px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:10px">
        <span>${key==="0000-00"||key==="9999-99" ? "" : "📅 "}${group.label}</span>
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
  if(el) return Math.max(1, parseInt(el.value)||2);
  try{ return Math.max(1, parseInt(localStorage.getItem('ss_target_'+type))||2); }catch(e){ return 2; }
}
function saveOrderTypeTarget(type, v){ try{ localStorage.setItem('ss_target_'+type, String(Math.max(1, parseInt(v)||2))); }catch(e){} }

function fillOrderSupplierOptions(){
  const filterSel = document.getElementById('orderSupplierFilter');
  if(filterSel){
    const cur = filterSel.value;
    filterSel.innerHTML = '<option value="">— All —</option>' + suppliers.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
    if(cur) filterSel.value = cur;
  }
}

let orderRateMode = (()=>{ try{ return localStorage.getItem('ss_order_rate')==='manual' ? 'manual' : 'weighted'; }catch(e){ return 'weighted'; } })();
function setOrderRateMode(mode){
  orderRateMode = mode;
  try{ localStorage.setItem('ss_order_rate', mode); }catch(e){}
  syncOrderRateToggle();
  applyOrderFilters();
}
function syncOrderRateToggle(){
  const isManual = orderRateMode==='manual';
  const t = document.getElementById('orderRateToggle'); if(t) t.checked = isManual;
  const lw = document.getElementById('ordLblWeighted'), lm = document.getElementById('ordLblManual');
  if(lw){ lw.style.color = isManual?'var(--text-3)':'var(--brand)'; lw.style.fontWeight = isManual?500:700; }
  if(lm){ lm.style.color = isManual?'var(--brand)':'var(--text-3)'; lm.style.fontWeight = isManual?700:500; }
  const d = document.getElementById('orderRateDesc');
  if(d) d.innerHTML = isManual
    ? 'Месячная потребность = <b>ручная норма</b> (кг/мес из карточки товара); если нормы нет — взвешенное среднее.'
    : 'Месячная потребность = <b>взвешенное среднее</b> × 30 (70% последних 30 дней + 30% с начала года).';
}
function buildOrderRows(){
  const avgByProd = avgDailyByProduct();
  const pendingByProduct = {};
  deliveries.filter(d=>d.status==='pending').forEach(d=>{
    pendingByProduct[d.product_id] = (pendingByProduct[d.product_id]||0) + Number(d.quantity);
  });
  return products.map(p=>{
    const manual = manualDailyRate(p);
    const usedManual = orderRateMode==='manual' && manual!=null;
    const rate = usedManual ? manual : (avgByProd[p.id]||0);
    const monthly = usedManual ? Number(p.manual_monthly_rate) : rate*30;
    const targetMonths = getOrderTypeTarget(p.type);
    const targetQty = Math.round(monthly*targetMonths);
    const pending = pendingByProduct[p.id]||0;
    const alreadyHave = Number(p.balance)+pending;
    const rawSuggested = Math.max(0, targetQty-alreadyHave);
    const suggested = rawSuggested>0 ? Math.ceil(rawSuggested/500)*500 : 0;
    const daysLeft = rate>0 ? Math.floor(Number(p.balance)/rate) : (Number(p.balance)>0 ? null : 0);
    const hasRate = rate>0;
    const status = !hasRate ? 'noRate' : suggested>0 ? 'needsOrder' : 'okStock';
    return {p, rate, monthly, usedManual, targetMonths, targetQty, pending, suggested, daysLeft, hasRate, status};
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
        <input type="number" id="target-${t}" value="${(()=>{ try{ return parseInt(localStorage.getItem('ss_target_'+t))||2; }catch(e){ return 2; } })()}" min="1" max="12" onchange="saveOrderTypeTarget('${t}', this.value);applyOrderFilters()" style="width:56px;padding:6px 8px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);outline:none">
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
    <td data-pcard="${p.id}" title="Открыть карточку товара" style="text-decoration:underline dotted;text-underline-offset:3px">${dot}<span class="pname">${p.name}</span></td>
    <td>${typeBadgeHtml(p.type)}</td>
    <td>${p.width_cm??'—'}</td><td>${p.ply}</td><td>${p.gsm??'—'}</td>
    <td class="num" style="color:${balColor};font-weight:600">${fmt(p.balance).toLocaleString()}${p.balance==0?' <span class="badge badge-critical" style="margin-left:2px">ZERO</span>':''}</td>
    <td class="num" style="font-weight:600;color:${daysColor}">${r.daysLeft==null?'<span style="color:var(--text-3);font-weight:400">∞</span>':r.daysLeft+'d'}${urgent?' 🚨':''}</td>
    <td class="num" style="color:var(--brand)">${r.pending>0?'+'+fmt(r.pending).toLocaleString():'—'}</td>
    <td class="num" data-sort="${supStockFor(p.id).total}">${supStockCellHtml(p.id)}</td>
    <td class="num" style="color:var(--text-2)">${r.monthly>0?fmt(r.monthly).toLocaleString()+' kg'+(r.usedManual?' <span style="font-size:10px;font-weight:600;color:var(--brand)">ручн.</span>':(orderRateMode==='manual'?' <span style="font-size:10px;color:var(--text-3)" title="Ручной нормы нет — взято взвешенное среднее">взв.</span>':'')):'—'}</td>
    <td class="num">${r.targetQty>0?fmt(r.targetQty).toLocaleString()+' kg<div style="font-size:9px;color:var(--text-3)">'+r.targetMonths+'mo</div>':'—'}</td>
    <td class="num" style="font-weight:600;color:${r.suggested>0?'var(--red)':'var(--green)'}">${r.suggested>0?fmt(r.suggested).toLocaleString()+' kg':'✓'}</td>
    <td><input type="number" class="ord-qty" data-pid="${p.id}" value="${qty}" min="0" step="500" placeholder="0" oninput="onOrderQtyInput(${p.id},this)" style="width:90px;padding:6px 8px;font-size:12.5px;border:1.5px solid ${qty?'var(--brand)':'var(--border)'};border-radius:var(--radius-sm);background:${qty?'var(--brand-light)':'var(--surface)'};color:var(--text);outline:none;font-weight:${qty?600:400}"></td>
    <td><select class="ord-sup" data-pid="${p.id}" onchange="onOrderSupInput(${p.id},this)" style="padding:6px 8px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);outline:none"><option value="">—</option>${suppliers.map(s=>`<option value="${s.id}" ${String(sup)===String(s.id)?'selected':''}>${s.name}</option>`).join('')}</select></td>
    <td>${statusHtml}</td>
  </tr>`;
}

function renderOrderTable(rows){
  const wrap = document.getElementById('orderTableWrap');
  if(!rows.length){ wrap.innerHTML = '<div class="empty">Ничего не найдено под текущими фильтрами</div>'; updateOrderSummary(); return; }

  const header = `<tr>
    <th>Product Name</th>
    <th>Type</th>
    <th>Width (cm)</th><th>Ply</th><th>GSM</th>
    <th>Current</th>
    <th>Days left</th>
    <th>Incoming</th>
    <th style="color:#6d28d9">У поставщика</th>
    <th>Monthly need</th>
    <th>Target</th>
    <th>Suggested</th>
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
          <span style="font-size:11px;color:var(--brand-dark)">${grp.length} items · ${fmt(total).toLocaleString()} kg total</span>
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
  document.getElementById('orderTotalQty').textContent = fmt(totalQty).toLocaleString()+' kg';
  document.getElementById('orderLineCount').textContent = entries.length;
  document.getElementById('orderSupplierCount').textContent = supSet.size;
  document.getElementById('orderTotalKg').textContent = (totalQty/1000).toLocaleString(undefined,{maximumFractionDigits:2})+' t';
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
  const lines = [['Supplier','Product','Type','Width','Ply','GSM','Order Qty (kg)'].join(';')];
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
  syncOrderRateToggle();
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

  const editId = document.getElementById('dv-edit-id').value;
  if(editId){
    const { data, error } = await sb.from('deliveries').update({ product_id, supplier_id, quantity, expected_date, plate_no }).eq('id', editId).select('id');
    if(error){ err.textContent = error.message; return; }
    if(!data || !data.length){ err.textContent = 'Не сохранено: у вашей роли нет права редактировать поставки (выполните migration_permissions.sql).'; return; }
    toast('Поставка обновлена ✓');
  } else {
    const { error } = await sb.from('deliveries').insert({ product_id, supplier_id, quantity, expected_date, plate_no });
    if(error){ err.textContent = error.message; return; }
    toast('Поставка добавлена ✓');
  }
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
  document.getElementById('dv-edit-id').value = '';
  document.getElementById('dvFormTitle').textContent = 'Add delivery';
  document.getElementById('dvSubmitBtn').textContent = '＋ Add delivery';
}

function editDelivery(id){
  const d = deliveries.find(x=>x.id===id);
  if(!d) return;
  document.getElementById('dv-edit-id').value = d.id;
  document.getElementById('dv-supplier').value = d.supplier_id || '';
  document.getElementById('dv-type-filter').value = '';
  filterDeliveryProductDropdown();
  document.getElementById('dv-product').value = d.product_id;
  onDeliveryProductSelect();
  document.getElementById('dv-qty').value = d.quantity;
  document.getElementById('dv-plate').value = d.plate_no || '';
  document.getElementById('dv-date').value = d.expected_date || '';
  document.getElementById('dvFormTitle').textContent = '✏️ Редактирование поставки';
  document.getElementById('dvSubmitBtn').textContent = '💾 Сохранить изменения';
  if(d.status==='arrived') document.getElementById('dvHint').textContent = '⚠️ Поставка уже получена: изменение количества не меняет остаток на складе — при необходимости поправьте его через Stock Entry.';
  document.getElementById('dvFormTitle').scrollIntoView({behavior:'smooth', block:'start'});
}

async function markArrived(id){
  if(!canEdit()) return;
  const d = deliveries.find(x=>x.id===id);
  if(!d) return;
  const { error: e1 } = await sb.from('deliveries').update({ status:'arrived', arrived_at:new Date().toISOString() }).eq('id', id);
  if(e1){ toast(e1.message, true); return; }
  const { error: e2 } = await sb.from('stock_log').insert({
    product_id: d.product_id, operation:'add', quantity: d.quantity, date: todayISO(),
    note: 'Поставка получена'+(d.plate_no?' · '+d.plate_no:''), user_id: me.id
  });
  if(e2){ toast(e2.message, true); }
  toast('Отмечено как получено ✓ +'+fmt(d.quantity).toLocaleString()+' кг на склад');
  await Promise.all([loadDeliveries(), loadProducts(), loadStockLog()]);
  renderDeliveries(); renderDashboard(); renderLevels(); renderForecast(); renderOrders();
}

// Supabase/RLS silently deletes 0 rows when a policy forbids it — detect that
async function deleteRow(table, id){
  const { data, error } = await sb.from(table).delete().eq('id', id).select('id');
  if(error){ toast(error.message, true); return false; }
  if(!data || !data.length){
    toast('Не удалено: у вашей роли нет права удалять ('+table+'). Выполните в Supabase скрипт migration_permissions.sql или попросите администратора.', true);
    return false;
  }
  return true;
}

async function removeDelivery(id){
  if(!confirm('Удалить эту поставку?')) return;
  if(!await deleteRow('deliveries', id)) return;
  toast('Поставка удалена ✓');
  await loadDeliveries(); renderDeliveries(); renderOrders();
}

let delFilterState = 'pending';   // по умолчанию — машины в пути
let delCollapsed = {};

function setDelFilter(f){
  delFilterState = f;
  renderDelFilterBar();
  renderDeliveries();
}
function renderDelFilterBar(){
  const bar = document.getElementById('deliveryFilterBar');
  const nP = deliveries.filter(d=>d.status==='pending').length, nA = deliveries.filter(d=>d.status==='arrived').length;
  const opts = [['pending',`🚚 В пути (${nP})`],['arrived',`Получено (${nA})`],['all',`Все (${deliveries.length})`]];
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
      <div class="del-meta">${d.suppliers?.name||'—'} · ${fmt(d.quantity).toLocaleString()} кг · ${d.status==='arrived'?'✓ Arrived':'Pending'}${dateStr?' · '+dateStr:''}</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0">
      ${d.status==='pending' && canEdit() ? `<button class="btn btn-ghost btn-sm" onclick="markArrived(${d.id})">✓ Arrived</button>` : ''}
      ${canEdit() ? `<button class="btn-edit" onclick="editDelivery(${d.id})">✏️ Edit</button>` : ''}
      ${canEdit() ? `<button class="btn-icon" onclick="removeDelivery(${d.id})" title="Удалить">✕</button>` : ''}
    </div>
  </div>`;
}

let delGroupIds = {};
async function removeDeliveryGroup(key){
  const g = delGroupIds[key]; if(!g) return;
  if(!confirm(`Удалить машину «${g.truck}» целиком: ${g.ids.length} строк, ${fmt(g.kg).toLocaleString()} кг?`
    + (g.arrived ? `\n\n${g.arrived} строк уже отмечены как полученные — приход на склад при этом НЕ отменится.` : ''))) return;
  const { data, error } = await sb.from('deliveries').delete().in('id', g.ids).select('id');
  if(error){ toast('Ошибка: '+error.message, true); return; }
  if(!data || data.length < g.ids.length){ toast(`Удалено ${data?data.length:0} из ${g.ids.length} — нет прав на удаление`, true); }
  else toast('Машина удалена ✓');
  await loadDeliveries(); renderDeliveries();
}
function strHash(str){ let h = 5381; for(let i=0;i<str.length;i++) h = ((h<<5)+h + str.charCodeAt(i))|0; return (h>>>0).toString(36); }
// сводка «Машины в пути»: одна строка на машину, просроченные и ближайшие сверху
function renderTransitSummary(){
  const host = document.getElementById('dvTransit'); if(!host) return;
  const today = todayISO();
  const g = {};
  deliveries.filter(d=>d.status==='pending').forEach(d=>{
    const truck = (d.plate_no||'').trim() || '— без номера —', date = d.expected_date || '';
    const k = 'k'+strHash(truck+'|'+date);
    (g[k] = g[k] || { k, truck, date, sup:new Set(), types:{}, kg:0, n:0 });
    g[k].sup.add(d.suppliers?.name || '—'); g[k].kg += Number(d.quantity||0); g[k].n++;
    const t = d.products?.type || '—'; g[k].types[t] = (g[k].types[t]||0) + Number(d.quantity||0);
  });
  const rows = Object.values(g).sort((a,b)=> (a.date||'9999').localeCompare(b.date||'9999') || a.truck.localeCompare(b.truck));
  if(!rows.length){ host.innerHTML = `<div class="card dv-transit"><div class="card-title">🚚 Машины в пути</div><div class="empty" style="padding:12px">Сейчас машин в пути нет</div></div>`; return; }
  const totalKg = rows.reduce((a,r)=>a+r.kg,0), late = rows.filter(r=>r.date && r.date<today).length;
  const dd = r=>{ if(!r.date) return '<span style="color:var(--text-3)">без даты</span>';
    const diff = Math.round((new Date(r.date+'T00:00:00') - new Date(today+'T00:00:00'))/86400000);
    const dt = r.date.slice(8,10)+'.'+r.date.slice(5,7)+'.'+r.date.slice(0,4);
    if(diff<0) return `<b style="color:var(--red)">${dt}</b><div class="dv-t-sub" style="color:var(--red)">просрочено ${-diff} дн.</div>`;
    if(diff===0) return `<b style="color:var(--amber)">${dt}</b><div class="dv-t-sub" style="color:var(--amber)">сегодня</div>`;
    return `${dt}<div class="dv-t-sub">через ${diff} дн.</div>`; };
  host.innerHTML = `<div class="card dv-transit">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <div class="card-title">🚚 Машины в пути: ${rows.length} · ${fmt(totalKg).toLocaleString()} кг (${(totalKg/1000).toFixed(1).replace('.',',')} т)${late?` · <span style="color:var(--red)">просрочено ${late}</span>`:''}</div>
      <button class="btn btn-ghost btn-sm" onclick="printTransit()">🖨 Печать списка</button>
    </div>
    <div style="overflow-x:auto"><table class="dv-t-table"><thead><tr><th>Машина</th><th>Поставщик</th><th>Ожидается</th><th>Что везёт</th><th class="nosort">Поз.</th><th>Кг</th></tr></thead><tbody>
    ${rows.map(r=>`<tr style="cursor:pointer" onclick="dvJumpTo('${r.k}')" title="Показать состав машины">
      <td><b>${escHtml(r.truck)}</b></td><td>${escHtml([...r.sup].join(', '))}</td><td data-sort="${r.date||'9999'}">${dd(r)}</td>
      <td style="font-size:12px;color:var(--text-2)">${Object.entries(r.types).sort((a,b)=>b[1]-a[1]).map(([t,v])=>`${typeBadgeHtml(t)} ${fmt(v).toLocaleString()}`).join(' ')}</td>
      <td class="num">${r.n}</td><td class="num" data-sort="${r.kg}"><b>${fmt(r.kg).toLocaleString()}</b></td></tr>`).join('')}
    </tbody></table></div></div>`;
}
function dvJumpTo(k){
  if(delFilterState==='arrived') setDelFilter('pending');
  delCollapsed[k] = false;
  const el = document.getElementById('delf-'+k);
  if(el){ el.classList.remove('collapsed'); el.scrollIntoView({behavior:'smooth', block:'start'}); el.classList.add('dv-flash'); setTimeout(()=>el.classList.remove('dv-flash'), 1500); }
}
function printTransit(){
  openDeliveryReport();
  document.getElementById('dvr-kind').value = 'list';
  document.getElementById('dvr-status').value = 'pending';
  document.getElementById('dvr-group').value = 'truck';
  document.getElementById('dvr-from').value = ''; document.getElementById('dvr-to').value = ''; document.getElementById('dvr-sup').value = '';
  buildDeliveryReport();
}
function renderDeliveries(){
  renderDelFilterBar();
  renderTransitSummary();
  const wrap = document.getElementById('deliveryList');
  let data = deliveries;
  if(delFilterState==='pending') data = data.filter(d=>d.status==='pending');
  else if(delFilterState==='arrived') data = data.filter(d=>d.status==='arrived');
  if(!data.length){ wrap.innerHTML = `<div class="empty">${delFilterState==='pending'?'Машин в пути нет':'Нет поставок'}</div>`; return; }

  const groups = {};
  data.forEach(d=>{
    const truck = (d.plate_no||'').trim() || '— no truck —';
    const date = d.expected_date || '— no date —';
    const key = 'k'+strHash(truck+'|'+date);   // кириллица в номере не должна склеивать разные машины
    if(!groups[key]) groups[key] = {truck, date, items:[]};
    groups[key].items.push(d);
  });
  const sortMode = document.getElementById('deliverySort')?.value || 'eta';
  const groupQty = g => g.items.reduce((s,x)=>s+Number(x.quantity||0),0);
  const entries = Object.entries(groups).sort((a,b)=>{
    if(sortMode==='qty-desc') return groupQty(b[1]) - groupQty(a[1]);
    if(sortMode==='qty-asc') return groupQty(a[1]) - groupQty(b[1]);
    if(sortMode==='supplier'){ const sa=(a[1].items[0]?.suppliers?.name||'яяя'), sb_=(b[1].items[0]?.suppliers?.name||'яяя'); return sa.localeCompare(sb_); }
    if(sortMode==='truck') return a[1].truck.localeCompare(b[1].truck);
    const da = a[1].date>'— no date —' ? a[1].date : '';
    const db = b[1].date>'— no date —' ? b[1].date : '';
    if(sortMode==='eta'){   // сначала машины в пути — ближайшие/просроченные первыми, потом полученные — новые первыми
      const pa = a[1].items.some(x=>x.status==='pending'), pb = b[1].items.some(x=>x.status==='pending');
      if(pa!==pb) return pa ? -1 : 1;
      return pa ? (da||'9999').localeCompare(db||'9999') : db.localeCompare(da);
    }
    return sortMode==='date-asc' ? da.localeCompare(db) : db.localeCompare(da);
  });

  entries.forEach(([,g])=> g.items.sort((x,y)=> productOrderCmp(products.find(p=>p.id===x.product_id), products.find(p=>p.id===y.product_id))));
  delGroupIds = {}; entries.forEach(([key,g])=>{ delGroupIds[key] = { ids:g.items.map(x=>x.id), truck:g.truck, kg:g.items.reduce((s,x)=>s+Number(x.quantity||0),0), arrived:g.items.filter(x=>x.status==='arrived').length }; });
  wrap.innerHTML = entries.map(([key,g])=>{
    const pending = g.items.filter(x=>x.status==='pending').length;
    const arrived = g.items.filter(x=>x.status==='arrived').length;
    const totalKg = g.items.reduce((s,x)=>s+Number(x.quantity||0),0);
    const dateLbl = g.date==='— no date —' ? g.date : new Date(g.date+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
    const totalsTxt = totalKg>0 ? fmt(totalKg).toLocaleString()+' kg' : '';
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
          ${canEdit() ? `<button class="btn-icon" title="Удалить всю машину" onclick="event.stopPropagation();removeDeliveryGroup('${key}')">🗑</button>` : ''}
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
    list.map(p=>`<option value="${p.id}">${p.name} — ${p.width_cm||'—'}cm · ${p.ply}ply · ${p.gsm||'—'}gsm (${fmt(p.balance).toLocaleString()} kg)</option>`).join('');
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
  info.innerHTML = `📦 Stock: <b>${fmt(p.balance).toLocaleString()} kg</b>` +
    (reserved>0 ? ` · 📌 already reserved: <b style="color:var(--amber)">${fmt(reserved).toLocaleString()} kg</b>` : '') +
    ` · ✅ available: <b style="color:var(--green)">${fmt(avail).toLocaleString()} kg</b>`;
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
  if(qty>avail){ err.textContent = 'Доступно к резерву только '+fmt(avail).toLocaleString()+' кг (остаток минус активные резервы).'; return; }

  const { error } = await sb.from('reservations').insert({
    product_id: p.id, date, quantity: qty,
    destination: document.getElementById('res-dest').value.trim(),
    note: document.getElementById('res-note').value.trim(),
    reserved_by: me.id, status: 'reserved'
  });
  if(error){ err.textContent = error.message; return; }
  toast('📌 Зарезервировано '+fmt(qty).toLocaleString()+' кг — ожидает подтверждения');
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
  document.getElementById('resKpiTotal').innerHTML = fmtKgT(activeTotal);
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
    if(sortMode==='product') return (a.products?.name||'').localeCompare(b.products?.name||'') || (a.products?.width_cm||0)-(b.products?.width_cm||0);
    if(sortMode==='format') return productOrderCmp(products.find(p=>p.id===a.product_id), products.find(p=>p.id===b.product_id)) || (b.created_at||'').localeCompare(a.created_at||'');
    if(sortMode==='status'){ const o={reserved:0,confirmed:1,cancelled:2}; return (o[a.status]??3)-(o[b.status]??3) || (b.created_at||'').localeCompare(a.created_at||''); }
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
            · <b style="color:var(--amber)">${fmt(r.quantity).toLocaleString()} kg reserved</b>
            ${diff?` · verified <b style="color:${Number(r.actual_qty)<Number(r.quantity)?'var(--red)':'var(--green)'}">${fmt(r.actual_qty).toLocaleString()} kg</b>`:''}
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
    <div style="font-size:11px;color:var(--text-2);margin-top:3px">Reserved: <b style="color:var(--amber)">${fmt(r.quantity).toLocaleString()} kg</b>${r.destination?' → '+r.destination:''}</div>`;
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
  toast('✅ Списано '+fmt(actual).toLocaleString()+' кг со склада');
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
async function callScannerApi(base64, mimeType, kind){
  let res;
  try{
    res = await fetch('/.netlify/functions/scan-invoice', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ imageBase64: base64, mimeType, kind })
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
    if(res.status===504 || /Inactivity Timeout|timed out/i.test(text))
      return { success:false, error: 'Сканер не успел за отведённое время (лимит Netlify ~26 сек) — список слишком длинный. Загрузите Excel или PDF-файл из 1С (они читаются без сканера) или сфотографируйте список частями.' };
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
  let added=0, failed=0; const errs=[];
  for(const line of selected){
    try{
      let pid = line.matchedProductId;
      if(!pid){
        if(!line.type){ failed++; errs.push((line.name_original||'строка')+': не выбран тип'); continue; }
        const { data, error } = await sb.from('products').insert({
          name: line.name_original || 'Scanned product', type: line.type,
          width_cm: parseFloat(line.width)||null, ply: parseInt(line.layers)||1, gsm: parseFloat(line.gsm)||null
        }).select().single();
        if(error) throw error;
        pid = data.id;
        products.push(data);
      }
      const qty = parseFloat(line.qtyKg)||0;
      if(!(qty>0)) { failed++; errs.push((line.name_original||'строка')+': не указано количество (кг)'); continue; }
      const { error: e2 } = await sb.from('deliveries').insert({
        product_id: pid, supplier_id: line.supplier_id||globalSupplier||null, quantity: qty,
        plate_no: line.plate||globalPlate||'', expected_date: globalDate, status:'pending'
      });
      if(e2) throw e2;
      added++;
    }catch(e){ failed++; errs.push((line.name_original||'строка')+': '+(e.message||e)); }
  }
  btn.disabled = false;
  btn.textContent = '✅ Добавить '+scannerLines.filter(l=>l.selected).length+' строк в поставки';
  toast((added?'✅ ':'⚠️ ')+'Добавлено поставок: '+added+(failed?' · ошибок: '+failed+' — '+errs.slice(0,2).join('; '):''), added===0);
  if(errs.length) console.warn('Scanner errors:', errs);
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
  wrap.innerHTML = `<div style="font-size:12px;color:var(--brand-dark);background:var(--brand-light);border:1px solid var(--brand);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:10px">Найдено ${resScanLines.length} строк(и). Нажмите «Use», чтобы подставить товар, характеристики и количество (кг) в форму выше — проверьте перед резервом.</div>` +
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
  if(l.net_weight_t) document.getElementById('res-qty').value = Math.round(parseFloat(l.net_weight_t)*1000);
  document.getElementById('res-note').value = '📷 scanned'+(l.net_weight_t?' · '+l.net_weight_t+'t on document':'');
  document.getElementById('resManualFormAnchor')?.scrollIntoView({behavior:'smooth', block:'center'});
  toast(l.matched ? 'Товар и количество подставлены — проверьте и нажмите Reserve' : 'Товар не найден — выберите вручную из списка');
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
  if(!await deleteRow('products', id)) return;
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
      <td class="num" style="color:${balColor};font-weight:600">${fmt(p.balance).toLocaleString()}kg</td>
      <td class="num" style="color:var(--text-3)">${weighted>0?fmt(weighted).toLocaleString()+' kg/d':'—'}</td>
      <td><input type="number" class="pr-manual-input" data-pid="${p.id}" placeholder="e.g. 3000" value="${p.manual_monthly_rate||''}" min="0" step="10"></td>
      <td class="num" style="color:${manualDaily?'var(--brand)':'var(--text-3)'};font-weight:${manualDaily?600:400}">${manualDaily?fmt(manualDaily).toLocaleString()+' kg/d':'—'}</td>
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
  if(!await deleteRow('suppliers', id)) return;
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


// ---------------------------------------------------------------
// UNIVERSAL TABLE SORTING
// Click any column header in any table: ▲ ascending, ▼ descending.
// The chosen order is kept when the table re-renders (filters, saves).
// ---------------------------------------------------------------
const tableSortState = {};   // key -> {col, dir}

function tableSortKey(table){
  if(table.id) return table.id;
  const host = table.parentElement && table.parentElement.closest('[id]');
  return host ? host.id : null;
}
function clearTableSort(key){ delete tableSortState[key]; }

function cellSortValue(td){
  if(!td) return null;
  if(td.dataset && td.dataset.sort) return td.dataset.sort;
  const sel = td.querySelector('select');
  let t;
  if(sel) t = sel.options[sel.selectedIndex]?.text || '';
  else {
    const inp = td.querySelector('input');
    t = inp ? inp.value : td.textContent;
  }
  t = (t||'').replace(/[  ]/g,' ').trim();
  if(!t || t==='—' || t==='-') return null;
  if(t.startsWith('∞')) return Infinity;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return m[0];
  m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if(m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = t.replace(/,/g,'').match(/^[+▲▼↓↑\s]*([−-]?\s*\d+(?:\.\d+)?)/);
  if(m && !/^\d+\s*[a-zа-яա-ֆ]{3,}/i.test(t.replace(/,/g,''))){
    let v = parseFloat(m[1].replace(/[\s−]/g, x=> x==='−' ? '-' : ''));
    if(t.trim().startsWith('▼')) v = -v;
    return v;
  }
  return t.toLocaleLowerCase();
}

function applyTableSort(table){
  const key = tableSortKey(table);
  const st = key && tableSortState[key];
  const ths = table.tHead ? [...table.tHead.rows[0].cells] : [];
  ths.forEach((th,i)=>{
    th.classList.toggle('sort-asc', !!st && st.col===i && st.dir===1);
    th.classList.toggle('sort-desc', !!st && st.col===i && st.dir===-1);
  });
  if(!st) return;
  const tb = table.tBodies[0]; if(!tb) return;
  const rows = [...tb.rows].filter(r=>r.cells.length>1);
  if(rows.length<2) return;
  const sorted = rows.map((r,idx)=>({r,idx,v:cellSortValue(r.cells[st.col])}))
    .sort((a,b)=>{
      if(a.v===null && b.v===null) return a.idx-b.idx;
      if(a.v===null) return 1;           // empty values always at the bottom
      if(b.v===null) return -1;
      let c;
      if(typeof a.v==='number' && typeof b.v==='number') c = a.v===b.v ? 0 : (a.v<b.v?-1:1);
      else c = String(a.v).localeCompare(String(b.v), undefined, {numeric:true});
      return c*st.dir || a.idx-b.idx;
    }).map(x=>x.r);
  if(sorted.every((r,i)=>r===rows[i])) return;   // already in order — avoid observer loops
  sorted.forEach(r=>tb.appendChild(r));
}

document.addEventListener('click', e=>{
  const th = e.target.closest('th');
  if(!th || th.classList.contains('nosort')) return;
  const table = th.closest('table');
  if(!table || !table.closest('.pane') || !table.tHead || !table.tHead.contains(th)) return;
  const key = tableSortKey(table); if(!key) return;
  const col = th.cellIndex;
  const st = tableSortState[key];
  tableSortState[key] = (st && st.col===col) ? {col, dir:-st.dir} : {col, dir:1};
  document.querySelectorAll('.pane table').forEach(t=>{ if(tableSortKey(t)===key) applyTableSort(t); });
});

let _sortRaf = null;
new MutationObserver(()=>{
  if(_sortRaf) return;
  _sortRaf = requestAnimationFrame(()=>{
    _sortRaf = null;
    document.querySelectorAll('.pane table').forEach(t=>{
      if(t.tHead) [...t.tHead.rows[0].cells].forEach(th=>{ if(!th.classList.contains('nosort')) th.classList.add('sortable'); });
      applyTableSort(t);
    });
  });
}).observe(document.body, {childList:true, subtree:true});


// ---------------------------------------------------------------
// PRODUCT CARD (click a product in Forecast / Stock Levels / Orders / Dashboard)
// ---------------------------------------------------------------
document.addEventListener('click', e=>{
  const el = e.target.closest('[data-pcard]');
  if(!el) return;
  if(e.target.closest('a,button,input,select,textarea,label')) return;   // don't hijack inner controls
  openProductCard(Number(el.dataset.pcard));
});
document.addEventListener('keydown', e=>{
  if(e.key==='Escape' && !document.getElementById('productCardModal').classList.contains('hidden')) closeProductCard();
});

function closeProductCard(){
  document.getElementById('productCardModal').classList.add('hidden');
  pcCharts.forEach(c=>{ try{ c.destroy(); }catch(e){} }); pcCharts = [];
}

// ---------- product card: tabs, analytics, movements ----------
const pcState = { pid:null, tab:'analytics', gran:'month', moveFilter:'all', moveLimit:40 };
let pcCharts = [];
const PC_IN = '#2F6FDB', PC_OUT = '#DC4C4C', PC_BAL = '#0F6E56';   // validated colourblind-safe pair

function setPcTab(tab){
  pcState.tab = tab;
  document.querySelectorAll('#pcTabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('#productCardModal .pc-pane').forEach(el=>el.classList.toggle('active', el.id==='pcTab-'+tab));
  document.getElementById('pcSaveBtn').style.display = (tab==='edit' && canEdit()) ? '' : 'none';
  if(tab==='analytics') renderPcAnalytics();
  if(tab==='moves') renderPcMoves();
  if(tab==='changes') renderPcChanges();
}
function setPcGran(g){ pcState.gran = g; renderPcAnalytics(); }
function setPcMoveFilter(f){ pcState.moveFilter = f; pcState.moveLimit = 40; renderPcMoves(); }
function pcShowMore(){ pcState.moveLimit += 40; renderPcMoves(); }

function pcEvents(){
  return stockLog.filter(r=>r.product_id===pcState.pid)
    .slice().sort((a,b)=> a.date<b.date?1:a.date>b.date?-1:((a.created_at||'')<(b.created_at||'')?1:-1));
}
function isoDay(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

// buckets: [{label, start, end}] as ISO date strings, oldest first
function pcBuckets(gran){
  const now = new Date(); const out = [];
  if(gran==='month'){
    for(let m=0; m<=now.getMonth(); m++){
      const st = new Date(now.getFullYear(), m, 1), en = new Date(now.getFullYear(), m+1, 0);
      out.push({label: st.toLocaleDateString('ru-RU',{month:'short'}).replace('.',''), full: st.toLocaleDateString('ru-RU',{month:'long', year:'numeric'}), start: isoDay(st), end: isoDay(en)});
    }
  } else if(gran==='week'){
    const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay()+6)%7));
    for(let w=25; w>=0; w--){
      const st = new Date(monday); st.setDate(monday.getDate()-7*w);
      const en = new Date(st); en.setDate(st.getDate()+6);
      const lbl = st.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
      out.push({label: lbl, full: 'неделя с '+lbl, start: isoDay(st), end: isoDay(en)});
    }
  } else {
    for(let d=59; d>=0; d--){
      const st = new Date(now); st.setDate(now.getDate()-d);
      const lbl = st.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
      out.push({label: lbl, full: st.toLocaleDateString('ru-RU'), start: isoDay(st), end: isoDay(st)});
    }
  }
  return out;
}

function pcAggregate(gran){
  const p = products.find(x=>x.id===pcState.pid);
  const ev = pcEvents();
  const bal = Number(p?.balance)||0;
  return pcBuckets(gran).map(b=>{
    let inn=0, out=0, corr=0;
    ev.forEach(e=>{ if(e.date>=b.start && e.date<=b.end){
      const q = Number(e.quantity)||0;
      if(e.operation==='add') inn+=q; else if(e.operation==='deduct') out+=q; else corr++;
    }});
    // balance at period end = current balance minus everything that happened after it;
    // unknown if a manual "set balance" correction happened later
    let endBal = bal, known = true;
    ev.forEach(e=>{ if(e.date>b.end){
      const q = Number(e.quantity)||0;
      if(e.operation==='add') endBal -= q; else if(e.operation==='deduct') endBal += q; else known = false;
    }});
    if(b.start > todayISO()) known = false;
    const partial = gran!=='day' && b.end > todayISO() && b.start <= todayISO();
    return {...b, full: b.full + (partial ? ' (неполный)' : ''), partial, inn, out, corr, endBal: known ? Math.max(0, endBal) : null};
  });
}

function renderPcSupStock(p){
  const host = document.getElementById('pcSupStock'); if(!host) return;
  const st = supStockFor(p.id);
  if(!(st.total>0)){ host.innerHTML = ''; return; }
  host.innerHTML = `<div class="fc-sup" style="margin:0 0 12px">
    <div class="fc-sup-h">🏭 Готово у поставщика: ${fmt(st.total).toLocaleString()} кг</div>
    ${st.parts.map(x=>{ const inPlan = fcPlannedQty(p.id, x.sid, x.wh);
      return `<div class="fc-sup-r" style="font-size:12px"><span>${escHtml(x.name)}${x.asOf?` <span style="color:var(--text-3)">· на ${x.asOf.slice(8,10)}.${x.asOf.slice(5,7)}</span>`:''}${inPlan?` <span class="fc-inplan">· 🚛 в плане ${fmt(inPlan).toLocaleString()} кг</span>`:''}</span>
        <span style="display:flex;align-items:center;gap:6px;flex-shrink:0"><b>${fmt(x.kg).toLocaleString()} кг</b>${canEdit()?`<button class="fc-add" onclick="fcAddToTruck(${p.id},${x.sid},${escHtml(JSON.stringify(x.wh))})">＋ в машину</button>`:''}</span></div>`; }).join('')}
  </div>`;
}
function renderPcAnalytics(){
  const p = products.find(x=>x.id===pcState.pid); if(!p) return;
  renderPcSupStock(p);
  document.querySelectorAll('#pcGranBar .pill').forEach(el=>el.classList.toggle('active', el.dataset.gran===pcState.gran));
  const ev = pcEvents();
  const yearStart = new Date().getFullYear()+'-01-01';
  const ytdIn  = ev.filter(e=>e.operation==='add'    && e.date>=yearStart).reduce((a,e)=>a+Number(e.quantity||0),0);
  const ytdOut = ev.filter(e=>e.operation==='deduct' && e.date>=yearStart).reduce((a,e)=>a+Number(e.quantity||0),0);
  const months = pcAggregate('month');
  const activeMonths = months.filter(m=>m.out>0);
  const avgMonth = activeMonths.length ? activeMonths.reduce((a,m)=>a+m.out,0)/activeMonths.length : 0;
  const peak = months.reduce((best,m)=> m.out>(best?best.out:0) ? m : best, null);
  const last30 = windowTotalsByProduct(30,0)[p.id]||0, prev30 = windowTotalsByProduct(60,30)[p.id]||0;
  const trend = prev30>0 ? Math.round((last30-prev30)/prev30*100) : null;
  const outDays = new Set(ev.filter(e=>e.operation==='deduct').map(e=>e.date)).size;
  const kpi = (l,v,sub)=>`<div class="pc-stat"><div class="pc-stat-l">${l}</div><div class="pc-stat-v">${v}</div>${sub?`<div class="pc-note" style="margin-top:2px">${sub}</div>`:''}</div>`;
  document.getElementById('pcAnaKpis').innerHTML =
    kpi('Приход с начала года', fmtKgT(ytdIn)) +
    kpi('Расход с начала года', fmtKgT(ytdOut), pcYoySub(p.id, ytdOut) || (outDays ? outDays+' дн. с расходом' : '')) +
    kpi('Средний расход в месяц', avgMonth>0 ? fmt(avgMonth).toLocaleString()+' кг' : '—', activeMonths.length ? 'по '+activeMonths.length+' мес. с расходом' : '') +
    kpi('Расход за 30 дней', fmt(last30).toLocaleString()+' кг', trend===null ? 'прошлые 30 дн.: '+fmt(prev30).toLocaleString()+' кг' : (trend>=0?'▲ +':'▼ −')+Math.abs(trend)+'% к прошлым 30 дн.') +
    kpi('Пиковый месяц', peak ? peak.full : '—', peak ? fmt(peak.out).toLocaleString()+' кг расхода' : '') +
    kpi('Нетто с начала года', (ytdIn-ytdOut>=0?'+':'')+fmt(ytdIn-ytdOut).toLocaleString()+' кг', 'приход минус расход');
  const yoy = pcPrevYear[p.id];   // undefined = ещё грузится, null = ошибка, {…} = данные
  if(yoy===undefined) loadPcPrevYear(p.id);
  const yoyOn = pcState.gran==='month' && yoy && yoy.total>0;
  document.querySelectorAll('#pcPeriodTable .pc-yoy-col').forEach(el=>el.style.display = yoyOn ? '' : 'none');

  const rows = pcAggregate(pcState.gran);
  pcCharts.forEach(c=>{ try{ c.destroy(); }catch(e){} }); pcCharts = [];
  if(typeof Chart!=='undefined'){
    const tipKg = c=>' '+c.dataset.label+': '+(c.parsed.y==null?'—':c.parsed.y.toLocaleString()+' кг');
    const xOpts = { grid:{display:false}, ticks:{maxRotation:0, autoSkip:true, maxTicksLimit:14, color:'#5B6660', font:{size:11}} };
    const yOpts = { beginAtZero:true, grid:{color:'#EEF0ED'}, border:{display:false}, ticks:{color:'#8A938E', font:{size:11}, callback:v=>v>=1000?(v/1000)+'т':v} };
    pcCharts.push(new Chart(document.getElementById('pcFlowChart'), {
      type:'bar',
      data:{ labels: rows.map(r=>r.label), datasets:[
        { label:'Приход', data: rows.map(r=>fmt(r.inn)), backgroundColor: PC_IN, borderRadius:4, maxBarThickness:18, borderSkipped:'bottom' },
        { label:'Расход', data: rows.map(r=>fmt(r.out)), backgroundColor: PC_OUT, borderRadius:4, maxBarThickness:18, borderSkipped:'bottom' },
        ...(yoyOn ? [{ type:'line', label:'Расход год назад', data: rows.map(r=>fmt(pcPrevOut(yoy, r))),
            borderColor: PC_PREV, backgroundColor: PC_PREV, borderWidth:2, borderDash:[5,4], pointRadius:3, pointHoverRadius:5, tension:0.2, order:-1 }] : [])
      ]},
      options:{ maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
        plugins:{ legend:{position:'top', align:'end', labels:{boxWidth:10, boxHeight:10, usePointStyle:true, pointStyle:'rectRounded', color:'#5B6660', font:{size:12}, sort:(a,b)=>a.datasetIndex-b.datasetIndex}},
          tooltip:{itemSort:(a,b)=>a.datasetIndex-b.datasetIndex, callbacks:{ title:i=>rows[i[0].dataIndex].full, label:tipKg }} },
        scales:{ x:xOpts, y:yOpts } }
    }));
    pcCharts.push(new Chart(document.getElementById('pcBalChart'), {
      type:'line',
      data:{ labels: rows.map(r=>r.label), datasets:[
        { label:'Остаток', data: rows.map(r=>r.endBal==null?null:fmt(r.endBal)), borderColor: PC_BAL, backgroundColor: PC_BAL, borderWidth:2, pointRadius: pcState.gran==='month'?3:0, pointHoverRadius:5, tension:0.2, spanGaps:false }
      ]},
      options:{ maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
        plugins:{ legend:{display:false}, tooltip:{callbacks:{ title:i=>rows[i[0].dataIndex].full, label:tipKg }} },
        scales:{ x:xOpts, y:yOpts } }
    }));
  }
  const unknown = rows.some(r=>r.endBal==null && r.start<=todayISO());
  document.getElementById('pcBalNote').textContent = (unknown
    ? 'Остаток до последней ручной корректировки не восстанавливается — эти периоды пропущены.'
    : 'Остаток восстановлен от текущего по приходам и расходам.') + pcYoyNote(p.id);

  const tb = document.querySelector('#pcPeriodTable tbody');
  const shown = rows.slice().reverse().filter(r=>r.inn||r.out||r.corr||pcState.gran==='month');
  tb.innerHTML = shown.length ? shown.map((r,i)=>{
    const prev = shown[i+1];
    const d = prev && prev.out>0 ? Math.round((r.out-prev.out)/prev.out*100) : null;
    const net = r.inn - r.out;
    return `<tr class="${i===0?'pc-cur':''}">
      <td>${r.full}</td>
      <td class="num">${r.inn?fmt(r.inn).toLocaleString():'—'}</td>
      <td class="num">${r.out?fmt(r.out).toLocaleString():'—'}</td>
      <td class="num">${net?(net>0?'+':'')+fmt(net).toLocaleString():'—'}</td>
      <td class="num">${r.endBal==null?'—':fmt(r.endBal).toLocaleString()}</td>
      <td class="num" style="color:var(--text-2)">${d===null?'—':(d>=0?'▲ +':'▼ −')+Math.abs(d)+'%'}</td>
      ${yoyOn ? (()=>{ const py = pcPrevOut(yoy, r); const yd = py>0 ? Math.round((r.out-py)/py*100) : null;
        return `<td class="num pc-yoy-col">${py?fmt(py).toLocaleString():'—'}</td><td class="num pc-yoy-col" style="color:var(--text-2)">${yd===null?'—':(yd>=0?'▲ +':'▼ −')+Math.abs(yd)+'%'}</td>`; })() : ''}
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="empty">Нет движений за этот период</td></tr>';
}

function renderPcMoves(){
  document.querySelectorAll('#pcMoveBar .pill').forEach(el=>el.classList.toggle('active', el.dataset.mf===pcState.moveFilter));
  let ev = pcEvents();
  if(pcState.moveFilter!=='all') ev = ev.filter(e=>e.operation===pcState.moveFilter);
  const opLabel = {add:'Приход +', deduct:'Расход −', update:'Установлено ='};
  const opColor = {add:PC_IN, deduct:PC_OUT, update:'var(--text-2)'};
  const sum = ev.filter(e=>e.operation!=='update').reduce((a,e)=>a+Number(e.quantity||0),0);
  document.getElementById('pcMoveCount').textContent = ev.length+' записей с 1 января'+(pcState.moveFilter==='add'||pcState.moveFilter==='deduct' ? ' · всего '+fmt(sum).toLocaleString()+' кг' : '');
  document.getElementById('pcHistory').innerHTML = ev.length ? ev.slice(0, pcState.moveLimit).map(r=>`<div class="pc-hist">
      <span style="color:var(--text-2);white-space:nowrap">${r.date}</span>
      <span style="flex:1;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.note||''}</span>
      <span class="num" style="color:${opColor[r.operation]||'inherit'};font-weight:600;white-space:nowrap">${opLabel[r.operation]||r.operation} ${fmt(r.quantity).toLocaleString()} кг</span>
    </div>`).join('') : '<div class="empty" style="padding:10px">Нет записей</div>';
  document.getElementById('pcMoreBtn').classList.toggle('hidden', ev.length <= pcState.moveLimit);
}

function openProductCard(pid){
  const p = products.find(x=>x.id===pid);
  if(!p) return;
  const editable = canEdit();
  const weighted = avgDailyByProduct()[p.id] || 0;
  const manual = manualDailyRate(p);
  const rate = manual!=null ? manual : weighted;
  const bal = Number(p.balance)||0;
  const days = rate>0 ? Math.floor(bal/rate) : null;
  const u30 = windowTotalsByProduct(30,0)[p.id] || 0;
  const pend = deliveries.filter(d=>d.product_id===p.id && d.status==='pending');
  const pendQty = pend.reduce((a,d)=>a+Number(d.quantity||0),0);
  const reserved = (typeof reservedQtyFor==='function') ? reservedQtyFor(p.id) : 0;

  document.getElementById('pcTitle').textContent = p.name;
  document.getElementById('pcSub').innerHTML = `${typeBadgeHtml(p.type)} <span>${p.width_cm??'—'} см · ${p.ply} сл · ${p.gsm??'—'} gsm</span>${p.priority?` <span>${p.priority==='high'?'🔴 High':p.priority==='medium'?'🟠 Medium':'⚪ Low'}</span>`:''}`;

  const daysColor = bal<=0 ? 'var(--red)' : days==null ? 'var(--text-2)' : days<7 ? 'var(--red)' : days<30 ? 'var(--amber)' : 'var(--green)';
  const stat = (l,v,c)=>`<div class="pc-stat"><div class="pc-stat-l">${l}</div><div class="pc-stat-v" ${c?`style="color:${c}"`:''}>${v}</div></div>`;
  document.getElementById('pcStats').innerHTML =
    stat('Остаток', fmtKgT(bal), bal<=0?'var(--red)':'') +
    stat('Расход / день', rate>0 ? fmt(rate).toLocaleString()+' кг'+(manual!=null?' <span style="font-size:10px;font-weight:500;color:var(--brand)">ручн.</span>':'') : '—') +
    stat('Хватит на', bal<=0 ? 'закончился' : days==null ? '∞' : days+' дн.', daysColor) +
    stat('Расход за 30 дн.', u30>0 ? fmt(u30).toLocaleString()+' кг' : '—') +
    (reserved>0 ? stat('В резерве', fmt(reserved).toLocaleString()+' кг', 'var(--amber)') : '') +
    (pendQty>0 ? stat('Ожидается', '+'+fmt(pendQty).toLocaleString()+' кг', 'var(--brand)') : '');

  document.getElementById('pcPending').innerHTML = pend.length ? `<div style="background:#EFF6FF;border:1px solid #93c5fd;border-radius:var(--radius-sm);padding:8px 12px;font-size:12px;color:#1d4ed8">
      🚚 ${pend.map(d=>`<b>+${fmt(d.quantity).toLocaleString()} кг</b>${d.expected_date?' · '+d.expected_date:''}${d.suppliers?.name?' · '+d.suppliers.name:''}`).join('<br>🚚 ')}
    </div>` : '';

  document.getElementById('pc-id').value = p.id;
  document.getElementById('pc-name').value = p.name || '';
  document.getElementById('pc-type').innerHTML = TYPES.map(t=>`<option value="${t}" ${t===p.type?'selected':''}>${t}</option>`).join('');
  document.getElementById('pc-width').value = p.width_cm ?? '';
  document.getElementById('pc-ply').value = p.ply ?? 1;
  document.getElementById('pc-gsm').value = p.gsm ?? '';
  document.getElementById('pc-priority').value = p.priority || '';
  document.getElementById('pc-manual').value = p.manual_monthly_rate || '';
  document.getElementById('pc-target').value = p.target_months ?? 2;
  document.getElementById('pc-comp').value = p.composition || '';
  document.getElementById('pc-balance').value = fmt(bal);
  document.getElementById('pcError').textContent = '';
  document.querySelectorAll('#productCardModal .pc-body input, #productCardModal .pc-body select').forEach(el=>{ el.disabled = !editable; });

  pcState.pid = p.id; pcState.moveFilter = 'all'; pcState.moveLimit = 40;
  document.getElementById('productCardModal').classList.remove('hidden');
  setPcTab(pcState.tab || 'analytics');
}

async function saveProductCard(){
  const err = document.getElementById('pcError'); err.textContent = '';
  if(!canEdit()){ err.textContent = 'У вас нет прав на редактирование.'; return; }
  const id = Number(document.getElementById('pc-id').value);
  const p = products.find(x=>x.id===id); if(!p) return;
  const name = document.getElementById('pc-name').value.trim();
  if(!name){ err.textContent = 'Название не может быть пустым.'; return; }
  const num = idv=>{ const v = document.getElementById(idv).value; return v==='' ? null : parseFloat(v); };
  const comp = document.getElementById('pc-comp').value.trim();
  if(comp && !/^\d{1,3}\s*\/\s*\d{1,3}$/.test(comp)){ err.textContent = 'Состав в формате PES/VIS, например 30/70.'; return; }
  const patch = {
    name, type: document.getElementById('pc-type').value,
    width_cm: num('pc-width'), ply: parseInt(document.getElementById('pc-ply').value)||1, gsm: num('pc-gsm'),
    priority: document.getElementById('pc-priority').value || null,
    manual_monthly_rate: num('pc-manual') || null,
    target_months: num('pc-target') ?? 2,
    composition: comp || null
  };
  const btn = document.getElementById('pcSaveBtn'); btn.disabled = true;
  try{
    const { data, error } = await sb.from('products').update(patch).eq('id', id).select('id');
    if(error){ err.textContent = error.message; return; }
    if(!data || !data.length){ err.textContent = 'Не сохранено: у вашей роли нет права редактировать товары (выполните migration_permissions.sql).'; return; }
    const newBal = num('pc-balance');
    let balMsg = '';
    if(newBal!==null && Math.abs(newBal - fmt(Number(p.balance)||0)) > 0.0001){
      const { error: e2 } = await sb.from('stock_log').insert({
        product_id: id, operation:'update', quantity: newBal, date: todayISO(),
        note: 'Корректировка из карточки товара (было '+fmt(Number(p.balance)||0).toLocaleString()+' кг)', user_id: me.id
      });
      if(e2){ err.textContent = 'Параметры сохранены, но остаток не изменён: '+e2.message; await afterProductCardSave(); return; }
      balMsg = ' · остаток '+fmt(newBal).toLocaleString()+' кг';
    }
    toast('Товар сохранён ✓'+balMsg);
    await afterProductCardSave();
    closeProductCard();
  } finally { btn.disabled = false; }
}

async function afterProductCardSave(){
  await Promise.all([loadProducts(), loadStockLog()]);
  fillProductSelects();
  renderProducts(); renderLevels(); renderForecast(); applyOrderFilters(); renderDashboard();
}


// ---------------------------------------------------------------
// USER NAMES (для «Кто» в History и журнале)
// ---------------------------------------------------------------
let profileNames = {};
async function loadProfileNames(){
  const { data } = await sb.from('profiles').select('id, full_name, role');
  profileNames = {};
  (data||[]).forEach(r=>{ profileNames[r.id] = r.full_name || r.id.slice(0,8); });
}
function userName(id){ return id ? (profileNames[id] || id.slice(0,8)) : '—'; }
function escHtml(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ---------------------------------------------------------------
// СРАВНЕНИЕ С ПРОШЛЫМ ГОДОМ (карточка товара → Аналитика)
// ---------------------------------------------------------------
const PC_PREV = '#3F4A45';    // прошлый год — нейтральная пунктирная линия
const pcPrevYear = {};        // pid → { out:{'01':kg,…}, inn:{…}, total, ytdOut } | null

async function loadPcPrevYear(pid){
  pcPrevYear[pid] = { loading:true, out:{}, inn:{}, total:0, ytdOut:0 };
  const y = new Date().getFullYear() - 1;
  const todayMD = todayISO().slice(5);
  const res = { out:{}, inn:{}, total:0, ytdOut:0, mtd:0 };
  try{
    for(let from=0;;from+=1000){
      const { data, error } = await sb.from('stock_log').select('date, operation, quantity')
        .eq('product_id', pid).in('operation',['add','deduct'])
        .gte('date', y+'-01-01').lte('date', y+'-12-31').order('id').range(from, from+999);
      if(error) throw error;
      (data||[]).forEach(r=>{
        const m = r.date.slice(5,7), q = Number(r.quantity)||0;
        const bucket = r.operation==='add' ? res.inn : res.out;
        bucket[m] = (bucket[m]||0) + q;
        if(r.operation==='deduct'){ res.total += q; if(r.date.slice(5) <= todayMD) res.ytdOut += q; if(m===todayMD.slice(0,2) && r.date.slice(5) <= todayMD) res.mtd += q; }
      });
      if(!data || data.length<1000) break;
    }
    pcPrevYear[pid] = res;
  }catch(e){ pcPrevYear[pid] = null; }
  if(pcState.pid===pid && pcState.tab==='analytics' && !document.getElementById('productCardModal').classList.contains('hidden')) renderPcAnalytics();
}

// подпись под «Расход с начала года»: сравнение с тем же периодом прошлого года
function pcYoySub(pid, ytdOut){
  const d = pcPrevYear[pid], y = new Date().getFullYear() - 1;
  if(!d || d.loading || !(d.ytdOut>0)) return '';
  const pct = Math.round((ytdOut-d.ytdOut)/d.ytdOut*100);
  return (pct>=0?'▲ +':'▼ −')+Math.abs(pct)+'% к '+y+' ('+fmt(d.ytdOut).toLocaleString()+' кг)';
}
function pcYoyNote(pid){
  const d = pcPrevYear[pid], y = new Date().getFullYear() - 1;
  if(d===undefined || (d && d.loading)) return '';
  if(d===null) return ' Сравнение с '+y+' годом не загрузилось.';
  if(!(d.total>0)) return ' Сравнение с '+y+' годом появится, когда в базе будет история за '+y+' год.';
  return pcState.gran==='month' ? ' Пунктир — расход за тот же месяц '+y+' года; текущий месяц сравнивается с теми же числами.' : ' Сравнение с '+y+' годом — в режиме «По месяцам».';
}
// расход год назад для строки периода; для неполного текущего месяца — только по сегодняшнее число
function pcPrevOut(yoy, r){
  const m = r.start.slice(5,7);
  return r.partial ? (yoy.mtd||0) : (yoy.out[m]||0);
}

// ---------------------------------------------------------------
// ЖУРНАЛ ИЗМЕНЕНИЙ
// ---------------------------------------------------------------
const AUDIT_FIELDS = {
  name:'Название', type:'Тип', width_cm:'Ширина, см', ply:'Слои', gsm:'GSM', priority:'Приоритет',
  manual_monthly_rate:'Ручная норма, кг/мес', target_months:'Цель запаса, мес', composition:'Состав',
  balance:'Остаток, кг', note:'Комментарий', contact:'Контакт', phone:'Телефон', email:'Email', notes:'Заметки',
  product_id:'Товар', supplier_id:'Поставщик', quantity:'Количество, кг', plate_no:'Номер машины',
  expected_date:'Ожидаемая дата', status:'Статус', arrived_at:'Получено'
};
const AUDIT_ACTIONS = { insert:'Создано', update:'Изменено', delete:'Удалено', balance:'Остаток' };
const AUDIT_TABLES  = { products:'Товар', deliveries:'Поставка', suppliers:'Поставщик' };
let auditRows = [], auditPage = 0, auditHasMore = false;
const AUDIT_PAGE = 200;

function auditVal(field, v){
  if(v===null || v===undefined || v==='') return '—';
  if(field==='priority') return ({high:'🔴 High', medium:'🟠 Medium', low:'⚪ Low'})[v] || v;
  if(field==='status') return ({pending:'в пути', arrived:'получено'})[v] || v;
  if(field==='product_id'){ const p = products.find(x=>x.id===Number(v)); return p ? productLabel(p) : '#'+v; }
  if(field==='supplier_id'){ const sp = suppliers.find(x=>x.id===Number(v)); return sp ? sp.name : '#'+v; }
  if(field==='arrived_at') return String(v).slice(0,16).replace('T',' ');
  if(typeof v==='number') return fmt(v).toLocaleString();
  return String(v);
}
function auditChangesHtml(r){
  const ch = r.changes || {};
  const keys = Object.keys(ch).sort((a,b)=> (a==='note') - (b==='note'));
  if(!keys.length) return '<span class="pc-note">—</span>';
  return keys.map(k=>{
    const o = ch[k]?.old, n = ch[k]?.new, lbl = AUDIT_FIELDS[k] || k;
    if(k==='note') return `<span class="chg"><b>${lbl}:</b> ${escHtml(n)}</span>`;
    if(r.action==='insert') return `<span class="chg"><b>${lbl}:</b> <span class="new">${escHtml(auditVal(k,n))}</span></span>`;
    if(r.action==='delete') return `<span class="chg"><b>${lbl}:</b> <span class="old">${escHtml(auditVal(k,o))}</span></span>`;
    let delta = '';
    if(typeof o==='number' && typeof n==='number' && o!==n){ const d = n-o; delta = ` <span class="pc-note" style="display:inline">(${d>0?'+':'−'}${fmt(Math.abs(d)).toLocaleString()})</span>`; }
    return `<span class="chg"><b>${lbl}:</b> <span class="old">${escHtml(auditVal(k,o))}</span> → <span class="new">${escHtml(auditVal(k,n))}</span>${delta}</span>`;
  }).join('');
}
function auditWhen(at){
  const d = new Date(at);
  return d.toLocaleDateString('ru-RU')+' <span style="color:var(--text-3)">'+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+'</span>';
}

async function loadAudit(reset){
  if(reset){ auditRows = []; auditPage = 0; }
  const days = Number(document.getElementById('auditPeriod')?.value||30);
  let q = sb.from('audit_log').select('*').order('at',{ascending:false}).range(auditPage*AUDIT_PAGE, auditPage*AUDIT_PAGE+AUDIT_PAGE-1);
  if(days>0) q = q.gte('at', new Date(Date.now()-days*86400000).toISOString());
  const { data, error } = await q;
  const tb = document.querySelector('#auditTableEl tbody');
  if(error){
    tb.innerHTML = `<tr><td colspan="5" class="empty">${/audit_log/.test(error.message) ? 'Журнал ещё не включён — выполните в Supabase скрипт <b>migration_alerts_audit.sql</b>.' : escHtml(error.message)}</td></tr>`;
    document.getElementById('auditMoreBtn').classList.add('hidden');
    return;
  }
  auditRows = auditRows.concat(data||[]);
  auditHasMore = (data||[]).length === AUDIT_PAGE;
  auditPage++;
  const users = [...new Set(auditRows.map(r=>r.user_name).filter(Boolean))].sort();
  const sel = document.getElementById('auditUser'), cur = sel.value;
  sel.innerHTML = '<option value="">Все пользователи</option>' + users.map(u=>`<option ${u===cur?'selected':''}>${escHtml(u)}</option>`).join('');
  renderAudit();
}

function renderAudit(){
  const tb = document.querySelector('#auditTableEl tbody'); if(!tb) return;
  const search = (document.getElementById('auditSearch').value||'').toLowerCase().trim();
  const tbl = document.getElementById('auditTable').value;
  const usr = document.getElementById('auditUser').value;
  let rows = auditRows;
  if(tbl==='balance') rows = rows.filter(r=>r.action==='balance');
  else if(tbl==='products') rows = rows.filter(r=>r.table_name==='products' && r.action!=='balance');
  else if(tbl) rows = rows.filter(r=>r.table_name===tbl);
  if(usr) rows = rows.filter(r=>r.user_name===usr);
  if(search) rows = rows.filter(r=>{
    const hay = (r.row_label+' '+r.user_name+' '+Object.keys(r.changes||{}).map(k=>(AUDIT_FIELDS[k]||k)+' '+JSON.stringify(r.changes[k])).join(' ')).toLowerCase();
    return hay.includes(search);
  });
  document.getElementById('auditCount').textContent = rows.length+' записей'+(auditHasMore ? ' (загружены последние '+auditRows.length+')' : '');
  document.getElementById('auditMoreBtn').classList.toggle('hidden', !auditHasMore);
  if(!rows.length){ tb.innerHTML = '<tr><td colspan="5" class="empty">Нет изменений за выбранный период</td></tr>'; return; }
  tb.innerHTML = rows.map(r=>{
    const isProd = r.table_name==='products' && products.some(p=>p.id===r.row_id);
    return `<tr ${isProd?`data-pcard="${r.row_id}" style="cursor:pointer"`:''}>
      <td data-sort="${r.at}" style="white-space:nowrap">${auditWhen(r.at)}</td>
      <td>${escHtml(r.user_name||'—')}</td>
      <td><span class="act act-${r.action}">${AUDIT_ACTIONS[r.action]||r.action}</span></td>
      <td class="obj"><span class="pc-note" style="display:block;margin:0">${AUDIT_TABLES[r.table_name]||r.table_name}</span>${escHtml(r.row_label||('#'+r.row_id))}</td>
      <td>${auditChangesHtml(r)}</td>
    </tr>`;
  }).join('');
}

async function renderPcChanges(){
  const host = document.getElementById('pcChanges');
  const pid = pcState.pid;
  host.innerHTML = '<div class="empty" style="padding:10px">Загрузка…</div>';
  const { data, error } = await sb.from('audit_log').select('*').eq('table_name','products').eq('row_id', pid).order('at',{ascending:false}).limit(200);
  if(pcState.pid!==pid) return;
  if(error){ host.innerHTML = `<div class="empty" style="padding:10px">${/audit_log/.test(error.message) ? 'Журнал ещё не включён — выполните в Supabase скрипт migration_alerts_audit.sql.' : escHtml(error.message)}</div>`; return; }
  host.innerHTML = (data||[]).length ? data.map(r=>`<div class="pc-chg">
      <div class="pc-chg-h"><span>${auditWhen(r.at)}</span><span>·</span><b style="color:var(--text)">${escHtml(r.user_name||'—')}</b><span class="act act-${r.action}">${AUDIT_ACTIONS[r.action]||r.action}</span></div>
      ${auditChangesHtml(r)}
    </div>`).join('') : '<div class="empty" style="padding:10px">Изменений пока не было. Журнал пишется с момента включения.</div>';
}

// ---------------------------------------------------------------
// СЕРВИС: резервная копия + уведомления на почту
// ---------------------------------------------------------------
function loadScript(src){
  return new Promise((ok, fail)=>{
    if(document.querySelector(`script[src="${src}"]`) && window.XLSX) return ok();
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ()=>fail(new Error('не удалось загрузить '+src));
    document.head.appendChild(s);
  });
}
async function fetchAllRows(table, select, order='id'){
  const out = [];
  for(let from=0;;from+=1000){
    const { data, error } = await sb.from(table).select(select).order(order).range(from, from+999);
    if(error) throw new Error(table+': '+error.message);
    out.push(...(data||[]));
    if(!data || data.length<1000) break;
  }
  return out;
}

async function downloadBackup(){
  const btn = document.getElementById('backupBtn'), st = document.getElementById('backupStatus');
  btn.disabled = true;
  const say = t=>{ st.textContent = t; };
  try{
    say('Загружаю библиотеку Excel…');
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const parts = {};
    const tables = [
      ['products','*'], ['stock_log','*'], ['deliveries','*'], ['reservations','*'], ['suppliers','*'], ['profiles','id, full_name, role, created_at']
    ];
    for(const [t,sel] of tables){ say('Читаю '+t+'…'); parts[t] = await fetchAllRows(t, sel); }
    try{ say('Читаю журнал изменений…'); parts.audit_log = await fetchAllRows('audit_log','*'); }catch(e){ parts.audit_log = null; }

    const pmap = {}; parts.products.forEach(p=>{ pmap[p.id] = p; });
    const smap = {}; parts.suppliers.forEach(x=>{ smap[x.id] = x.name; });
    const umap = {}; parts.profiles.forEach(x=>{ umap[x.id] = x.full_name; });
    const pl = id=>{ const p = pmap[id]; return p ? p.name : ''; };
    const pfmt = id=>{ const p = pmap[id]; return p ? (p.width_cm??'')+'cm·'+p.ply+'ply·'+(p.gsm??'')+'gsm' : ''; };
    const ptype = id=> pmap[id]?.type || '';
    const num = v=> v==null || v==='' ? null : Number(v);
    const dt = v=> v ? String(v).replace('T',' ').slice(0,19) : '';
    const OP = {add:'Приход', deduct:'Расход', update:'Установлен остаток'};

    const sheets = [
      ['Товары', parts.products.map(p=>({ 'ID':p.id, 'Название':p.name, 'Тип':p.type, 'Ширина, см':num(p.width_cm), 'Слои':p.ply, 'GSM':num(p.gsm),
        'Остаток, кг':num(p.balance), 'Приоритет':p.priority||'', 'Ручная норма, кг/мес':num(p.manual_monthly_rate), 'Цель запаса, мес':num(p.target_months),
        'Состав':p.composition||'', 'Создан':dt(p.created_at) }))],
      ['История движений', parts.stock_log.map(r=>({ 'ID':r.id, 'Дата':r.date, 'ID товара':r.product_id, 'Товар':pl(r.product_id), 'Формат':pfmt(r.product_id), 'Тип':ptype(r.product_id),
        'Операция':OP[r.operation]||r.operation, 'Код операции':r.operation, 'Количество, кг':num(r.quantity), 'Примечание':r.note||'', 'Пользователь':umap[r.user_id]||'', 'Записано':dt(r.created_at) }))],
      ['Поставки', parts.deliveries.map(d=>({ 'ID':d.id, 'ID товара':d.product_id, 'Товар':pl(d.product_id), 'Формат':pfmt(d.product_id), 'Тип':ptype(d.product_id),
        'Поставщик':smap[d.supplier_id]||'', 'Количество, кг':num(d.quantity), 'Машина':d.plate_no||'', 'Ожидается':d.expected_date||'',
        'Статус':d.status==='arrived'?'получено':'в пути', 'Создано':dt(d.created_at), 'Получено':dt(d.arrived_at) }))],
      ['Резервы', parts.reservations.map(r=>({ 'ID':r.id, 'Дата':r.date, 'ID товара':r.product_id, 'Товар':pl(r.product_id), 'Формат':pfmt(r.product_id), 'Тип':ptype(r.product_id),
        'Количество, кг':num(r.quantity), 'Факт, кг':num(r.actual_qty), 'Куда':r.destination||'', 'Примечание':r.note||'',
        'Статус':({reserved:'в резерве', confirmed:'подтверждён', cancelled:'отменён'})[r.status]||r.status,
        'Зарезервировал':umap[r.reserved_by]||'', 'Закрыл':umap[r.closed_by]||'', 'Закрыто':dt(r.closed_at), 'Создано':dt(r.created_at) }))],
      ['Поставщики', parts.suppliers.map(x=>({ 'ID':x.id, 'Название':x.name, 'Контакт':x.contact||'', 'Телефон':x.phone||'', 'Email':x.email||'', 'Заметки':x.notes||'', 'Создан':dt(x.created_at) }))],
      ['Пользователи', parts.profiles.map(x=>({ 'Имя':x.full_name, 'Роль':x.role, 'Создан':dt(x.created_at) }))]
    ];
    if(parts.audit_log) sheets.push(['Журнал изменений', parts.audit_log.map(r=>({ 'Когда':dt(r.at), 'Кто':r.user_name, 'Объект':AUDIT_TABLES[r.table_name]||r.table_name,
      'ID':r.row_id, 'Название':r.row_label, 'Действие':AUDIT_ACTIONS[r.action]||r.action,
      'Изменения':Object.keys(r.changes||{}).map(k=>(AUDIT_FIELDS[k]||k)+': '+auditVal(k,r.changes[k]?.old)+' → '+auditVal(k,r.changes[k]?.new)).join('; ') }))]);

    say('Собираю файл…');
    const wb = XLSX.utils.book_new();
    const summary = [['SoftStock — резервная копия'], ['Создана', new Date().toLocaleString('ru-RU')], ['Кем', myProfile?.full_name||me?.email||''], [],
      ['Лист','Строк']].concat(sheets.map(([n,rows])=>[n, rows.length]))
      .concat([[], ['Всего на складе, кг', parts.products.reduce((a,p)=>a+Math.max(0,Number(p.balance)||0),0)]]);
    const ws0 = XLSX.utils.aoa_to_sheet(summary); ws0['!cols'] = [{wch:28},{wch:22}];
    XLSX.utils.book_append_sheet(wb, ws0, 'Сводка');
    sheets.forEach(([name, rows])=>{
      const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['нет данных']]);
      if(rows.length){
        const keys = Object.keys(rows[0]);
        ws['!cols'] = keys.map(k=>({ wch: Math.min(60, Math.max(k.length+2, ...rows.slice(0,300).map(r=>String(r[k]??'').length+1))) }));
        ws['!autofilter'] = { ref: XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:rows.length, c:keys.length-1}}) };
        ws['!freeze'] = { xSplit:0, ySplit:1 };
      }
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    const stamp = new Date(); const pad = n=>String(n).padStart(2,'0');
    const fname = `SoftStock_backup_${stamp.getFullYear()}-${pad(stamp.getMonth()+1)}-${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}.xlsx`;
    XLSX.writeFile(wb, fname);
    say('Готово: '+fname+' · '+sheets.map(([n,r])=>n+' '+r.length).join(' · ')+(parts.audit_log?'':' · журнал изменений не включён'));
    toast('Резервная копия скачана ✓');
  }catch(e){
    say('Ошибка: '+e.message); toast('Резервная копия не создана: '+e.message, true);
  }finally{ btn.disabled = false; }
}

async function renderService(){
  const isAdmin = myProfile?.role==='admin';
  ['set-email','set-days-high','set-days-medium','set-alerts','set-summary','svcSaveBtn'].forEach(id=>{ const el = document.getElementById(id); if(el) el.disabled = !isAdmin; });
  document.querySelectorAll('#pane-service .notify-btn').forEach(b=>b.disabled = !isAdmin);
  document.getElementById('svcError').textContent = isAdmin ? '' : 'Настройки уведомлений меняет только администратор.';
  const { data, error } = await sb.from('app_settings').select('key,value');
  if(error){ document.getElementById('svcError').textContent = 'Уведомления ещё не включены — выполните в Supabase скрипт migration_alerts_audit.sql.'; return; }
  const st = {}; (data||[]).forEach(r=>{ st[r.key] = r.value; });
  document.getElementById('set-email').value = st.alert_email ?? '';
  document.getElementById('set-days-high').value   = st.alert_days_high ?? 14;
  document.getElementById('set-days-medium').value = st.alert_days_medium ?? 7;
  document.getElementById('set-alerts').value  = st.alerts_enabled  === 'false' ? 'false' : 'true';
  document.getElementById('set-summary').value = st.summary_enabled === 'false' ? 'false' : 'true';
}

async function saveAlertSettings(){
  const err = document.getElementById('svcError'); err.textContent = '';
  const hi = parseInt(document.getElementById('set-days-high').value), md = parseInt(document.getElementById('set-days-medium').value);
  if(!(hi>=0) || !(md>=0)){ err.textContent = 'Укажите число дней.'; return; }
  const emails = document.getElementById('set-email').value.split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean);
  const bad = emails.filter(x=>!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  if(!emails.length){ err.textContent = 'Укажите хотя бы один адрес почты.'; return; }
  if(bad.length){ err.textContent = 'Неверный адрес: '+bad.join(', '); return; }
  const now = new Date().toISOString();
  const rows = [
    {key:'alert_days_high', value:String(hi), updated_at:now}, {key:'alert_days_medium', value:String(md), updated_at:now},
    {key:'alert_email', value:emails.join(', '), updated_at:now},
    {key:'alerts_enabled', value:document.getElementById('set-alerts').value, updated_at:now},
    {key:'summary_enabled', value:document.getElementById('set-summary').value, updated_at:now}
  ];
  const { data, error } = await sb.from('app_settings').upsert(rows, {onConflict:'key'}).select('key');
  if(error){ err.textContent = error.message; return; }
  if(!data || data.length<rows.length){ err.textContent = 'Не сохранено: менять настройки может только администратор.'; return; }
  toast('Настройки уведомлений сохранены ✓');
}

async function notifyCall(mode){
  const err = document.getElementById('svcError'), st = document.getElementById('svcStatus'), pv = document.getElementById('svcPreview');
  err.textContent = ''; st.textContent = mode==='preview' ? 'Собираю письмо…' : 'Отправляю…';
  if(mode!=='preview') pv.classList.add('hidden');
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch('/.netlify/functions/email-alerts', {
      method:'POST', headers:{'Content-Type':'application/json', 'Authorization':'Bearer '+(session?.access_token||'')},
      body: JSON.stringify({mode})
    });
    const text = await res.text();
    let j; try{ j = JSON.parse(text); }catch(e){ throw new Error(res.status===404 ? 'функция email-alerts не найдена на сайте — загрузите netlify/functions/email-alerts.js и передеплойте' : 'сервер вернул не-JSON (HTTP '+res.status+')'); }
    if(!j.success) throw new Error(j.error||('HTTP '+res.status));
    st.textContent = '';
    const to = (j.to||[]).join(', ');
    if(mode==='test') toast('Тестовое письмо отправлено ✓ '+to);
    else if(mode==='summary') toast('Сводка отправлена ✓ '+to);
    else if(mode==='alerts') toast(j.sent==='alerts' ? `Отправлено: закончились ${j.newOut}, заканчиваются ${j.newLow}` : 'Новых предупреждений нет — всё уже отправлялось или в порядке');
    else if(mode==='preview'){
      // письма собирает наш сервер (все значения экранированы); показываем в изолированном iframe
      const frame = html=>`<iframe sandbox="allow-same-origin" loading="eager" onload="try{this.style.height=(this.contentDocument.documentElement.scrollHeight+24)+'px'}catch(e){}" style="width:100%;border:1px solid var(--border);border-radius:6px;background:#fff;height:420px;display:block" srcdoc="${escHtml(html)}"></iframe>`;
      const warn = [];
      if(!j.configured.resend) warn.push('нет RESEND_API_KEY в Netlify');
      if(!j.configured.to.length) warn.push('не указан адрес получателя');
      pv.innerHTML = (warn.length ? `<b style="color:var(--red)">Отправка не настроена: ${warn.join(', ')}</b>\n\n` : `<span class="pc-note" style="margin:0">Получатели: ${escHtml(j.configured.to.join(', '))}</span>\n\n`)
        + `<h4>Утренняя сводка — «${escHtml(j.summarySubject)}»</h4>${frame(j.summary)}`
        + `\n\n<h4>Новые предупреждения при следующей проверке</h4>` + (j.alerts ? `«${escHtml(j.alertsSubject)}»\n${frame(j.alerts)}` : 'нет — всё уже отправлялось или в порядке');
      pv.classList.remove('hidden');
    }
  }catch(e){
    st.textContent = ''; err.textContent = 'Ошибка: '+e.message;
  }
}


// ---------------------------------------------------------------
// СКЛАД ПОСТАВЩИКА → РЕКОМЕНДАЦИЯ МАШИН
// ---------------------------------------------------------------
let supStock = [];            // строки supplier_stock
let supStockError = '';
let ssPreviewRows = null;     // разобранный файл до сохранения
let ssForceOne = false;       // «собрать машину, даже если по остаткам не нужно»

async function loadSupStock(){
  const { data, error } = await sb.from('supplier_stock').select('*').order('id');
  supStockError = error ? (/supplier_stock/.test(error.message) ? 'Таблица ещё не создана — выполните в Supabase скрипт migration_supplier_stock.sql.' : error.message) : '';
  supStock = data || [];
}
// ── остаток у поставщиков по товару (для Stock Levels, Orders, карточки, Forecast) ──
function supStockFor(pid){
  const m = {};
  (typeof supStock!=='undefined' ? supStock : []).filter(r=>r.product_id===pid && Number(r.quantity)>0).forEach(r=>{
    const k = r.supplier_id+'|'+(r.warehouse||'');
    (m[k] = m[k] || { sid:r.supplier_id, wh:r.warehouse||'', kg:0, asOf:'' });
    m[k].kg += Number(r.quantity); if((r.as_of||'')>m[k].asOf) m[k].asOf = r.as_of;
  });
  const parts = Object.values(m).map(x=>({ ...x, name:(suppliers.find(s=>s.id===x.sid)?.name||'?') + (x.wh ? ' · '+x.wh : '') })).sort((a,b)=>b.kg-a.kg);
  return { total: parts.reduce((a,x)=>a+x.kg,0), parts };
}
function supStockCellHtml(pid){
  const st = supStockFor(pid);
  if(!(st.total>0)) return '<span style="color:var(--text-3)">—</span>';
  const tip = st.parts.map(x=>x.name+': '+fmt(x.kg).toLocaleString()+' кг'+(x.asOf?' (на '+x.asOf.slice(8,10)+'.'+x.asOf.slice(5,7)+')':'')).join('\n');
  return `<span class="sup-cell" title="${escHtml(tip)}"><b>${fmt(st.total).toLocaleString()}</b>${st.parts.length>1?`<span class="sup-cell-n">${st.parts.length} скл.</span>`:`<span class="sup-cell-n">${escHtml(st.parts[0].name)}</span>`}</span>`;
}

// ── склады поставщиков ──
const whName = w=> (w && String(w).trim()) ? String(w).trim() : 'Основной';
function ssSelWh(){ const el = document.getElementById('ssWh'); return el ? el.value : '__all'; }
// строки остатка выбранного поставщика и склада (или всех его складов)
function ssRowsSel(sid, wh){
  wh = wh===undefined ? ssSelWh() : wh;
  return supStock.filter(r=> r.supplier_id===sid && (wh==='__all' || (r.warehouse||'')===wh));
}
function ssWarehousesOf(sid){
  return [...new Set(supStock.filter(r=>r.supplier_id===sid).map(r=>r.warehouse||''))].sort((a,b)=> (a===''?-1:b===''?1:a.localeCompare(b)));
}
function ssSelectWh(sid, wh){
  document.getElementById('ssSupplier').value = String(sid);
  ssForceOne = false;
  ssFillWhControls(wh);
  renderSupPlan();
  document.getElementById('ssPlan').scrollIntoView({behavior:'smooth', block:'start'});
}
function ssFillWhControls(prefer){
  const sid = Number(document.getElementById('ssSupplier').value);
  const whs = ssWarehousesOf(sid);
  const sel = document.getElementById('ssWh'), cur = prefer!==undefined ? prefer : sel.value;
  sel.innerHTML = (whs.length>1 ? '<option value="__all">Все склады вместе</option>' : '')
    + whs.map(w=>`<option value="${escHtml(w)}">${escHtml(whName(w))}</option>`).join('')
    || '<option value="__all">—</option>';
  if([...sel.options].some(o=>o.value===cur)) sel.value = cur;
  else if(whs.length) sel.value = whs.length>1 ? whs[0] : whs[0];
  document.getElementById('ssWhList').innerHTML = whs.filter(w=>w).map(w=>`<option value="${escHtml(w)}">`).join('');
}
function renderSupWhOverview(){
  const host = document.getElementById('ssWhOverview'); if(!host) return;
  const g = {};
  supStock.forEach(r=>{ const k = r.supplier_id+'|'+(r.warehouse||''); (g[k] = g[k] || { sid:r.supplier_id, wh:r.warehouse||'', kg:0, n:0, unm:0, asOf:'' });
    g[k].kg += Number(r.quantity||0); g[k].n++; if(!r.product_id) g[k].unm++; if((r.as_of||'') > g[k].asOf) g[k].asOf = r.as_of; });
  const list = Object.values(g).filter(x=>x.kg>0 || x.n).sort((a,b)=>{ const sa = suppliers.find(s=>s.id===a.sid)?.name||'', sb = suppliers.find(s=>s.id===b.sid)?.name||''; return sa.localeCompare(sb) || (a.wh===''?-1:b.wh===''?1:a.wh.localeCompare(b.wh)); });
  if(!list.length){ host.innerHTML = `<div class="empty">${supStockError ? escHtml(supStockError) : 'Пока ничего не загружено. Выберите поставщика и склад ниже и загрузите его остаток.'}</div>`; return; }
  const sid = Number(document.getElementById('ssSupplier').value), wh = ssSelWh();
  host.innerHTML = list.map(x=>{
    const sup = suppliers.find(s=>s.id===x.sid);
    const old = x.asOf && (Date.now()-new Date(x.asOf+'T00:00:00'))/86400000 > 7;
    const active = x.sid===sid && (wh==='__all' || wh===x.wh);
    return `<div class="ss-wh${active?' active':''}" onclick="ssSelectWh(${x.sid}, ${escHtml(JSON.stringify(x.wh))})" title="Показать машины с этого склада">
      ${canEdit()?`<button class="ss-x" title="Очистить остаток этого склада" onclick="event.stopPropagation();ssClearWh(${x.sid}, ${escHtml(JSON.stringify(x.wh))})">🗑</button>`:''}
      <div class="ss-wh-sup">${escHtml(sup?.name||'?')}</div>
      <div class="ss-wh-name">🏭 ${escHtml(whName(x.wh))}</div>
      <div class="ss-wh-meta"><b style="color:var(--text)">${fmt(x.kg).toLocaleString()} кг</b> · ${x.n} поз.${x.unm?` · <span style="color:var(--amber)">не сопост. ${x.unm}</span>`:''}</div>
      <div class="ss-wh-meta" style="${old?'color:var(--amber)':''}">на ${x.asOf ? new Date(x.asOf+'T00:00:00').toLocaleDateString('ru-RU') : '—'}${old?' · ⚠️ старше недели':''}</div>
    </div>`;
  }).join('');
}
async function ssClearWh(sid, wh){
  const sup = suppliers.find(s=>s.id===sid);
  if(!confirm(`Удалить остаток склада «${whName(wh)}» поставщика ${sup?.name||''}?`)) return;
  const { data, error } = await sb.from('supplier_stock').delete().eq('supplier_id', sid).eq('warehouse', wh).select('id');
  if(error){ toast('Ошибка: '+error.message, true); return; }
  if(!data || !data.length){ toast('Не удалено — нет прав', true); return; }
  toast('Остаток склада удалён ✓');
  ssDropEdit(sid, wh); await renderSupStock(true);
  renderForecast();
}

function ssNum(v){
  if(typeof v==='number') return v;
  const s = String(v==null?'':v).replace(/ /g,' ').trim();
  if(!s) return NaN;
  // «12 400,5» / «12,400.5» / «12.400,5»
  let t = s.replace(/[^\d.,\-]/g,'');
  if(/,\d{1,2}$/.test(t) && t.indexOf('.')>-1 && t.indexOf('.')<t.lastIndexOf(',')) t = t.replace(/\./g,'').replace(',', '.');
  else if(/^\d{1,3}(,\d{3}){2,}(\.\d+)?$/.test(t) || /^\d{1,3},\d{3}\.\d+$/.test(t)) t = t.replace(/,/g,'');   // 1,234,567 / 1,234.5
  else t = t.replace(',', '.');
  return parseFloat(t);
}
// ячейка — число (а не текст, в котором есть цифры)
function ssIsNum(c){ return typeof c==='number' || /^[\s\u00a0]*-?[\d\s\u00a0]+([.,]\d+)?[\s\u00a0]*(кг|kg|тн|т|t)?\.?[\s\u00a0]*$/i.test(String(c)) && /\d/.test(String(c)); }
const ssKnownWidths = ()=> new Set(products.map(p=>Number(p.width_cm)).filter(x=>x>0));
function ssResolveWidth(w, unit){
  if(!(w>0)) return null;
  if(unit==='mm') return Math.round(w/10*10)/10;
  if(unit==='cm') return w;
  const known = ssKnownWidths();
  if(known.has(w)) return w;
  if(known.has(w/10)) return w/10;
  return w>=100 ? w/10 : w;
}
// формат из текста: «330mm 2ply 16gsm», «33 см 2 слоя 16 г/м²», «33/2/16», «33x2x16»
function ssParseFormat(text){
  const t = String(text||'').replace(/,/g,'.');
  let width=null, ply=null, gsm=null, m;
  if((m = t.match(/(\d+(?:\.\d+)?)\s*(mm|мм)(?![a-zа-яё])/i))) width = ssResolveWidth(parseFloat(m[1]),'mm');
  else if((m = t.match(/(?:формат|ширина|width|format)\s*[:=]?\s*(\d{2,4}(?:\.\d+)?)/i))) width = ssResolveWidth(parseFloat(m[1]), parseFloat(m[1])>=200 ? 'mm' : undefined);
  else if((m = t.match(/(\d+(?:\.\d+)?)\s*(cm|см)(?![a-zа-яё])/i))) width = ssResolveWidth(parseFloat(m[1]),'cm');
  if((m = t.match(/(?:слойност\S*|слоев|слоёв|ply|layers?)\s*[:=]\s*([1-4])(?!\d)/i))) ply = parseInt(m[1]);
  else if((m = t.match(/([1-4])\s*-?\s*(ply|pl(?![a-z])|сло|сл(?![a-zа-яё])|layer|շերտ)/i))) ply = parseInt(m[1]);
  if((m = t.match(/(\d+(?:\.\d+)?)\s*(gsm|g\/m|г\/м|гр(?![a-zа-яё])|gr(?![a-z])|գր)/i))) gsm = parseFloat(m[1]);
  else if((m = t.match(/(?:плотност\S*|gsm|grammage)\s*[:=]?\s*(\d{1,2}(?:\.\d+)?)/i))) gsm = parseFloat(m[1]);
  if((width==null || ply==null || gsm==null) && (m = t.match(/(\d{2,4}(?:\.\d+)?)\s*[\/x×*\-]\s*([1-4])\s*[\/x×*\-]\s*(\d{1,2}(?:\.\d+)?)/i))){
    if(width==null) width = ssResolveWidth(parseFloat(m[1]));
    if(ply==null) ply = parseInt(m[2]);
    if(gsm==null) gsm = parseFloat(m[3]);
  }
  return { width, ply, gsm };
}
const SS_HDR = {
  name:  /наимен|назван|товар|продук|номенкл|product|name|item|описан|descr|row labels|անվան|ապրանք/i,
  width: /ширин|width|формат|size|լայն|^\s*(mm|мм|см|cm)\s*$/i,
  ply:   /сло[йи]|ply|layer|շերտ/i,
  gsm:   /gsm|плотн|г\/м|grammage|density|գրամ/i,
  qty:   /кол|qty|quant|вес|weight|net|нетто|кг|\bkg\b|тонн|\bton|остат|stock|налич|ready|готов|запас|сумма|итого по|մնացորդ|քաշ|քանակ/i
};
function ssRowsFromTable(aoa, opts={}){
  aoa = (aoa||[]).map(r=>(r||[]).map(c=>c==null?'':c)).filter(r=>r.some(c=>String(c).trim()!==''));
  if(!aoa.length) return { rows:[], unit:'kg' };
  // ищем строку заголовков в первых 15 строках
  let hdrIdx = -1, cols = {};
  for(let i=0;i<(opts.noHeader?0:Math.min(15,aoa.length));i++){
    const c = {};
    aoa[i].forEach((v,j)=>{ const s = String(v); if(!s || typeof v==='number') return;
      for(const k of ['qty','gsm','ply','width','name']) if(c[k]==null && SS_HDR[k].test(s)){ c[k]=j; break; } });
    if(Object.keys(c).length>=2 && c.qty!=null){ hdrIdx = i; cols = c; break; }
  }
  let unit = '', hdrQty = hdrIdx>=0 ? String(aoa[hdrIdx][cols.qty]) : '';
  if(/тонн|\bton|\(т\)|,\s*т(?![а-яё])|\bt\b/i.test(hdrQty)) unit = 't';
  else if(/кг|\bkg\b/i.test(hdrQty)) unit = 'kg';
  const rows = [];
  const body = hdrIdx>=0 ? aoa.slice(hdrIdx+1) : aoa;
  body.forEach(r=>{
    // строка-группа сводной таблицы («1200») — только число, без текста
    const filled = r.filter(c=>String(c).trim()!=='');
    if(filled.length===1 && ssIsNum(filled[0])) return;
    const texts = r.filter(c=>String(c).trim()!=='' && !ssIsNum(c)).map(String);
    let raw = hdrIdx>=0 && cols.name!=null ? String(r[cols.name]||'') : texts.join(' ');
    let fmtSrc = r.map(String).join(' ');
    const f = ssParseFormat(hdrIdx>=0 && cols.name!=null ? raw : fmtSrc);
    if(hdrIdx>=0){
      if(cols.width!=null && f.width==null){ const w = ssNum(r[cols.width]); if(w>0) f.width = ssResolveWidth(w); }
      if(cols.ply!=null && f.ply==null){ const v = ssNum(r[cols.ply]); if(v>0) f.ply = Math.round(v); }
      if(cols.gsm!=null && f.gsm==null){ const v = ssNum(r[cols.gsm]); if(v>0) f.gsm = v; }
      if(f.width==null && f.ply==null && f.gsm==null){ const f2 = ssParseFormat(fmtSrc); Object.assign(f, f2); }
    }
    let qty = NaN;
    if(hdrIdx>=0) qty = ssNum(r[cols.qty]);
    else { const nums = r.filter(ssIsNum).map(ssNum).filter(x=>!isNaN(x)); qty = nums.length ? nums[nums.length-1] : NaN; }
    if(!(qty>0)) return;
    if(/итог|всего|total|ընդամենը/i.test(r.map(String).join(' '))) return;
    if(hdrIdx<0 && f.width==null && f.ply==null && f.gsm==null) return;   // без заголовков берём только строки с форматом
    if(!raw.trim()) raw = [f.width&&f.width+'cm', f.ply&&f.ply+'ply', f.gsm&&f.gsm+'gsm'].filter(Boolean).join(' ');
    rows.push({ raw: raw.trim(), width:f.width, ply:f.ply, gsm:f.gsm, qtyRaw: qty });
  });
  // единицы не указаны: если все количества ≤ 40 — это тонны (40 000 кг в одной строке не бывает)
  if(!unit) unit = rows.length && rows.every(r=>r.qtyRaw<=40) ? 't' : 'kg';
  rows.forEach(r=>{ r.typeHint = ssTypeHint(r.raw); });
  return { rows, unit };
}
// тип по названию у поставщика (обозначения из 1С: НП — салфеточная основа, БП — полотенца, ТБ — туалетная, БС — салфетки)
function ssTypeHint(raw){
  const t = ' '+String(raw||'').toLowerCase().replace(/[.,()]/g,' ')+' ';
  if(/\s(тб|tp)\s|туалет|toilet|զ\s*թ/.test(t)) return 'Toilet Paper';
  if(/\s(бп|bp)(\s|d\s)|полотен|towel|սրբիչ/.test(t)) return 'Towels';
  if(/\s(нп|np)\s|facial|косметич/.test(t)) return 'Facial Tissue';
  if(/\s(бс|bs)\s|салфет|napkin|անձեռոց/.test(t)) return 'Napkins';
  if(/spunlace|спанлейс|нетканн/.test(t)) return 'Spunlace';
  return '';
}
// цвет по названию у поставщика → армянское слово в названии нашего товара
const SS_COLORS = [
  [/бел|white|սպիտակ/i, 'սպիտակ'], [/красн|red|կարմիր/i, 'կարմիր'], [/бордо|bordo|burgund|բորդո/i, 'բորդո'],
  [/син|голуб|blue|կապույտ/i, 'կապույտ'], [/желт|жёлт|yellow|դեղին/i, 'դեղին'], [/черн|чёрн|black|սև/i, 'սև'],
  [/розов|pink|վարդագույն/i, 'վարդագույն'], [/цветн|color|գունավոր/i, 'գունավոր'], [/крафт|kraft|эко|eco|էկո/i, 'էկո']
];
function ssColorWord(raw){
  const hits = SS_COLORS.filter(([re])=>re.test(String(raw||'')));
  // «Белая» встречается и в цветных строках редко; если есть другой цвет — он важнее
  const other = hits.find(h=>h[1]!=='սպիտակ');
  return (other || hits[0] || [])[1] || '';
}
function ssAutoMatch(row){
  const same = products.filter(p=> Number(p.width_cm)===Number(row.width) && Number(p.ply)===Number(row.ply) && Number(p.gsm)===Number(row.gsm));
  if(!same.length) return { id:null, cands:[] };
  const normN = s=>String(s||'').toLocaleLowerCase('hy');
  const col = ssColorWord(row.raw);
  if(col && col!=='սպիտակ'){                       // цветная бумага — только товар того же цвета
    const colored = same.filter(p=>normN(p.name).includes(col));
    if(!colored.length) return { id:null, cands:same };
    if(colored.length===1) return { id:colored[0].id, cands:same };
  }
  const hint = row.typeHint || ssTypeHint(row.raw);
  const byType = hint ? same.filter(p=>p.type===hint) : [];
  if(hint && byType.length===1) return { id:byType[0].id, cands:same };
  if(same.length===1) return { id:same[0].id, cands:same };
  const norm = s=>String(s||'').toLocaleLowerCase('hy').replace(/\s+/g,' ').trim();
  const raw = norm(row.raw);
  const pool = byType.length ? byType : same;
  const color = ssColorWord(row.raw);
  const byName = pool.find(p=> raw && raw.includes(norm(p.name))) || (color ? pool.find(p=> norm(p.name).includes(color)) : null);
  const sorted = [...pool].sort(productOrderCmp);
  return { id:(byName||sorted[0]).id, cands:sorted };
}
function ssLoadRows(parsed, source){
  const err = document.getElementById('ssError'); err.textContent = '';
  if(!parsed.rows.length){ err.textContent = 'Не нашёл строк с форматом и количеством. Проверьте файл или вставьте строки вручную.'; return; }
  ssPreviewRows = parsed.rows.map(r=>{ const m = ssAutoMatch(r); return { ...r, product_id:m.id }; });
  document.getElementById('ssUnit').value = parsed.unit;
  document.getElementById('ssStatus').textContent = 'Разобрано строк: '+parsed.rows.length+' ('+source+')';
  document.getElementById('ssPreview').classList.remove('hidden');
  ssRenderPreview();
}
// PDF → строки таблицы: текстовые фрагменты группируются по строкам (координата Y),
// большой промежуток по X = новая колонка
async function ssPdfToTable(file){
  if(!window.pdfjsLib){
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for(let pn=1; pn<=pdf.numPages; pn++){
    const page = await pdf.getPage(pn);
    const tc = await page.getTextContent();
    const items = tc.items.filter(i=>i.str && i.str.trim()).map(i=>({ s:i.str, x:i.transform[4], y:i.transform[5], w:i.width||0, h:Math.abs(i.transform[3])||8 }));
    items.sort((a,b)=> b.y-a.y || a.x-b.x);
    const lines = [];
    items.forEach(it=>{
      const ln = lines.find(l=> Math.abs(l.y-it.y) <= Math.max(2, it.h*0.45));
      if(ln) ln.items.push(it); else lines.push({ y:it.y, items:[it] });
    });
    lines.sort((a,b)=>b.y-a.y).forEach(l=>{
      l.items.sort((a,b)=>a.x-b.x);
      const cells = []; let cur = null, lastEnd = -1e9;
      l.items.forEach(it=>{
        const gap = it.x - lastEnd;
        if(cur===null || gap > Math.max(10, it.h*1.2)){ cur = it.s; cells.push(cur); }
        else cells[cells.length-1] = cells[cells.length-1] + (gap>1?' ':'') + it.s;
        lastEnd = it.x + it.w;
      });
      out.push(cells.map(c=>c.trim()));
    });
  }
  return ssMergeWrappedLines(out);
}
// Длинные названия в PDF переносятся на 2–3 строки, и количество стоит только на одной из них.
// Склеиваем такие строки в одну запись: в счёте из 1С запись начинается с номера строки (1, 2, 3…),
// иначе — со строки, где есть количество.
function ssMergeWrappedLines(lines){
  const isRowNo = c=> /^\d{1,3}\.?$/.test(String(c||'').trim());
  const numCells = l=> l.filter((c,i)=> ssIsNum(c) && !(i===0 && isRowNo(c)));
  // «10 Ц1-И-НС» — номер строки слипся с артикулом: отделяем (используется, только если счёт нумерованный)
  const split = lines.map(l=>{ const m = String(l[0]||'').match(/^(\d{1,3})\.?\s+(\S.*)$/); return m && !ssIsNum(l[0]) ? [m[1], m[2], ...l.slice(1)] : l; });
  const isNumbered = ls=>{ const q = ls.filter(l=>numCells(l).length); return q.length && q.filter(l=>isRowNo(l[0])).length >= q.length*0.6; };
  const numbered = isNumbered(split);
  if(numbered) lines = split;
  const recs = []; let cur = null;
  lines.forEach(l=>{
    if(!numbered && l.length===1 && ssIsNum(l[0])) return;          // заголовок группы сводной таблицы («1200»)
    if(/итог|всего|total|страница|page\s*\d|подпис|отпустил|получил/i.test(l.join(' '))){ cur = null; return; }   // подвал документа
    const hasQty = numCells(l).length>0;
    // нумерованный счёт: новая запись с номера строки; иначе — со строки с количеством,
    // а строки без количества дописываются к предыдущей записи (перенос названия)
    const starts = numbered ? (isRowNo(l[0]) && l.length>1) : (hasQty || !cur || cur.qty==null);
    if(!cur && numbered && !starts) return;                          // текст вне записей (шапка/подвал)
    if(starts || !cur){ cur = { text:[], qty:null }; recs.push(cur); }
    l.forEach((c,i)=>{
      if(numbered && starts && i===0) return;                       // номер строки
      if(ssIsNum(c) && (numbered ? starts : hasQty)) cur.qty = c;   // количество — только со строки записи
      else if(!/^(кг|kg|т|t|шт)\.?$/i.test(String(c).trim())) cur.text.push(c);
    });
  });
  return recs.map(r=> r.qty!=null ? [r.text.join(' '), r.qty] : [r.text.join(' ')]);
}
const _scriptLoads = {};
function loadScriptOnce(src){
  if(!_scriptLoads[src]) _scriptLoads[src] = new Promise((ok, fail)=>{
    const s = document.createElement('script'); s.src = src; s.onload = ok;
    s.onerror = ()=>{ delete _scriptLoads[src]; fail(new Error('не удалось загрузить '+src)); };
    document.head.appendChild(s);
  });
  return _scriptLoads[src];
}
function ssTogglePaste(){ document.getElementById('ssPasteBox').classList.toggle('hidden'); }
function ssParsePaste(){
  const text = document.getElementById('ssPaste').value;
  const aoa = text.split(/\r?\n/).map(l=> l.includes('\t') ? l.split('\t') : (l.includes(';') ? l.split(';') : [l.replace(/\s+(\d{1,3}(?:[ \u00a0]\d{3})*(?:[.,]\d+)?)\s*(кг|kg|т|t)?\s*$/i,'\t$1').split('\t')].flat()));
  ssLoadRows(ssRowsFromTable(aoa), 'вставка');
}
async function ssHandleFile(file){
  if(!file) return;
  const err = document.getElementById('ssError'), st = document.getElementById('ssStatus');
  err.textContent = ''; st.textContent = 'Читаю файл…';
  try{
    const name = file.name.toLowerCase();
    const isPdf = file.type==='application/pdf' || name.endsWith('.pdf');
    if(isPdf){
      // PDF из 1С/Excel содержит текст — читаем его прямо в браузере, без сканера
      st.textContent = 'Читаю PDF…';
      const aoa = await ssPdfToTable(file).catch(()=>null);
      // в PDF колонки заголовка и строк часто не совпадают — разбираем по строкам, без заголовков
      const parsed = aoa ? ssRowsFromTable(aoa, { noHeader:true }) : { rows:[] };
      if(parsed.rows.length){ ssLoadRows(parsed, file.name+' (текст PDF)'); return; }
      // в PDF нет текста (скан) — отправляем сканеру
    }
    if(file.type.startsWith('image/') || isPdf){
      st.textContent = 'Распознаю сканером… (обычно 5–20 сек)';
      let base64, mime;
      if(file.type.startsWith('image/')){ const r = await resizeImageForScan(file, 1800, 0.82); base64 = r.base64; mime = r.mimeType; }
      else { base64 = await new Promise((ok,no)=>{ const fr = new FileReader(); fr.onload = ()=>ok(String(fr.result).split(',')[1]); fr.onerror = ()=>no(new Error('не удалось прочитать PDF')); fr.readAsDataURL(file); }); mime = 'application/pdf'; }
      const res = await callScannerApi(base64, mime, 'stock');
      if(!res.success) throw new Error(res.error||'сканер не ответил');
      const rows = (res.items||[]).map(it=>{
        if(Array.isArray(it)){   // быстрый режим: [name, width_mm, ply, gsm, kg]
          const [nm, wmm, ply, gsm, kg] = it;
          const f = ssParseFormat(nm||'');
          return { raw: String(nm||''), width: f.width ?? ssResolveWidth(ssNum(wmm), 'mm'), ply: f.ply ?? (ssNum(ply)||null), gsm: f.gsm ?? (ssNum(gsm)||null), qtyRaw: ssNum(kg) };
        }
        const f = ssParseFormat((it.name_original||'')+' '+(it.name_en||''));
        return { raw: it.name_original || it.name_en || '', width: f.width ?? ssResolveWidth(ssNum(it.width_mm), 'mm'), ply: f.ply ?? (ssNum(it.layers)||null), gsm: f.gsm ?? (ssNum(it.gsm)||null), qtyRaw: ssNum(it.net_weight_t)*1000 };
      }).filter(r=>r.qtyRaw>0);
      rows.forEach(r=>{ r.typeHint = ssTypeHint(r.raw); });
      ssLoadRows({ rows, unit:'kg' }, 'сканер');
      return;
    }
    if(name.endsWith('.csv') || name.endsWith('.txt')){
      const text = await file.text();
      const sep = (text.match(/\t/g)||[]).length > (text.match(/;/g)||[]).length ? '\t' : ((text.match(/;/g)||[]).length ? ';' : ',');
      ssLoadRows(ssRowsFromTable(text.split(/\r?\n/).map(l=>l.split(sep))), file.name);
      return;
    }
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const wb = XLSX.read(await file.arrayBuffer(), { type:'array' });
    let best = { rows:[], unit:'kg' };
    wb.SheetNames.forEach(n=>{ const p = ssRowsFromTable(XLSX.utils.sheet_to_json(wb.Sheets[n], { header:1, raw:true, defval:'' })); if(p.rows.length > best.rows.length) best = p; });
    ssLoadRows(best, file.name);
  }catch(e){ st.textContent = ''; err.textContent = 'Ошибка: '+e.message; }
}
function ssRenderPreview(){
  const tb = document.querySelector('#ssPreviewTable tbody'); if(!ssPreviewRows) return;
  const mult = document.getElementById('ssUnit').value==='t' ? 1000 : 1;
  const allOpts = id=> products.map(p=>`<option value="${p.id}" ${p.id===id?'selected':''}>${escHtml(productLabel(p))} [${p.type}]</option>`).join('');
  tb.innerHTML = ssPreviewRows.map((r,i)=>{
    const same = products.filter(p=> Number(p.width_cm)===Number(r.width) && Number(p.ply)===Number(r.ply) && Number(p.gsm)===Number(r.gsm)).sort(productOrderCmp);
    const fmtTxt = [r.width!=null?r.width+'cm':'?', r.ply!=null?r.ply+'ply':'?', r.gsm!=null?r.gsm+'gsm':'?'].join('·');
    return `<tr class="${r.product_id?'':'ss-unmatched'}">
      <td style="max-width:280px">${escHtml(r.raw)||'<span class="pc-note">—</span>'}</td>
      <td style="white-space:nowrap">${fmtTxt}</td>
      <td><select onchange="ssPreviewRows[${i}].product_id=this.value?Number(this.value):null;ssRenderPreview()">
        <option value="">— не сопоставлено (не учитывать) —</option>
        ${same.length?`<optgroup label="Тот же формат">${same.map(p=>`<option value="${p.id}" ${p.id===r.product_id?'selected':''}>${escHtml(productLabel(p))} [${p.type}]</option>`).join('')}</optgroup><optgroup label="Все товары">`:''}
        ${allOpts(same.some(p=>p.id===r.product_id)?-1:r.product_id)}${same.length?'</optgroup>':''}
      </select></td>
      <td><input type="number" min="0" step="1" value="${Math.round(r.qtyRaw*mult)}" onchange="ssPreviewRows[${i}].qtyRaw=(parseFloat(this.value)||0)/${mult};ssRenderPreview()"></td>
      <td><button class="btn btn-ghost btn-sm" title="Убрать строку" onclick="ssPreviewRows.splice(${i},1);ssRenderPreview()">✕</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">Строк нет</td></tr>';
  const matched = ssPreviewRows.filter(r=>r.product_id);
  const totalKg = ssPreviewRows.reduce((s,r)=>s+r.qtyRaw*mult,0);
  document.getElementById('ssPreviewInfo').textContent = `сопоставлено ${matched.length} из ${ssPreviewRows.length} · всего ${fmt(totalKg).toLocaleString()} кг`
    + (ssPreviewRows.length>matched.length ? ' · жёлтые строки не будут учтены в расчёте' : '');
}
function ssCancelPreview(){ ssPreviewRows = null; document.getElementById('ssPreview').classList.add('hidden'); document.getElementById('ssStatus').textContent=''; }
async function ssSave(){
  const err = document.getElementById('ssError'); err.textContent = '';
  const sid = Number(document.getElementById('ssSupplier').value);
  if(!sid){ err.textContent = 'Выберите поставщика.'; return; }
  if(!ssPreviewRows || !ssPreviewRows.length){ err.textContent = 'Нечего сохранять.'; return; }
  const mult = document.getElementById('ssUnit').value==='t' ? 1000 : 1;
  const asOf = document.getElementById('ssAsOf').value || todayISO();
  const wh = (document.getElementById('ssWhInput').value||'').trim().replace(/^основной$/i,'');
  const merged = {}, rows = [];
  ssPreviewRows.forEach(r=>{
    const kgv = Math.round(r.qtyRaw*mult*100)/100; if(!(kgv>0)) return;
    if(r.product_id){
      if(merged[r.product_id]){ merged[r.product_id].quantity += kgv; merged[r.product_id].raw_name += ' + '+r.raw; return; }
      merged[r.product_id] = { supplier_id:sid, warehouse:wh, product_id:r.product_id, raw_name:r.raw||'', width_cm:r.width, ply:r.ply, gsm:r.gsm, quantity:kgv, as_of:asOf };
      rows.push(merged[r.product_id]);
    } else rows.push({ supplier_id:sid, warehouse:wh, product_id:null, raw_name:r.raw||'', width_cm:r.width, ply:r.ply, gsm:r.gsm, quantity:kgv, as_of:asOf });
  });
  const btn = document.getElementById('ssSaveBtn'); btn.disabled = true;
  try{
    const del = await sb.from('supplier_stock').delete().eq('supplier_id', sid).eq('warehouse', wh);
    if(del.error) throw del.error;
    const ins = await sb.from('supplier_stock').insert(rows).select('id');
    if(ins.error) throw ins.error;
    if(!ins.data || ins.data.length < rows.length) throw new Error('не сохранено — нет прав на изменение');
    toast('Остаток сохранён ✓ — склад «'+whName(wh)+'», '+rows.length+' строк');
    ssCancelPreview(); document.getElementById('ssPaste').value='';
    ssForceOne = false; ssDropEdit(sid, wh);
    await loadSupStock();
    ssFillWhControls(wh);
    await renderSupStock(false);
    renderForecast(); renderLevels(); renderOrders();
  }catch(e){ err.textContent = /warehouse/.test(e.message||'') ? 'Нужно включить склады: выполните в Supabase скрипт migration_supplier_warehouses.sql.' : 'Ошибка: '+(e.message||e); }
  finally{ btn.disabled = false; }
}

// настройки расчёта запоминаются в браузере
function ssSaveCtl(){
  if(Object.keys(ssEditStore).length && !confirm('Пересчитать машины заново? Ручные правки планов (и добавленное из Forecast) будут сброшены.')){ ssRestoreCtl(); return; }
  ssEdit = null; ssEditStore = {}; try{ localStorage.setItem('ss_plan_edits','{}'); }catch(e){}
  try{ localStorage.setItem('ss_plan_ctl', JSON.stringify({ cap:document.getElementById('ssCap').value, step:document.getElementById('ssStep').value, fill:document.getElementById('ssFill').value })); }catch(e){}
}
function ssRestoreCtl(){
  try{ const c = JSON.parse(localStorage.getItem('ss_plan_ctl')||'{}');
    if(c.cap) document.getElementById('ssCap').value = c.cap;
    if(c.step) document.getElementById('ssStep').value = c.step;
    if(c.fill) document.getElementById('ssFill').value = c.fill; }catch(e){}
}
function ssOnSupplierChange(){ ssForceOne = false; ssFillWhControls(); renderSupPlan(); }

async function renderSupStock(reload){
  if(reload || !supStock.length) await loadSupStock();
  const sel = document.getElementById('ssSupplier'), cur = sel.value;
  if(reload===false){} // данные уже загружены
  const cnt = {}; supStock.forEach(r=>{ cnt[r.supplier_id] = (cnt[r.supplier_id]||0) + Number(r.quantity||0); });
  const sups = [...suppliers].sort((a,b)=> (cnt[b.id]?1:0)-(cnt[a.id]?1:0) || a.name.localeCompare(b.name));
  sel.innerHTML = sups.length ? sups.map(s=>`<option value="${s.id}">${escHtml(s.name)}${cnt[s.id]?' · готово '+fmt(cnt[s.id]/1000).toLocaleString()+' т':''}</option>`).join('') : '<option value="">— сначала добавьте поставщика —</option>';
  if(cur && sups.some(s=>String(s.id)===cur)) sel.value = cur;
  if(!document.getElementById('ssAsOf').value) document.getElementById('ssAsOf').value = todayISO();
  if(!document.getElementById('ssEta').value){ const d = new Date(); d.setDate(d.getDate()+14); document.getElementById('ssEta').value = d.toISOString().slice(0,10); }
  ssRestoreCtl();
  ssFillWhControls();
  document.getElementById('ssError').textContent = supStockError;
  renderSupPlan();
}

// ── расчёт ──
function ssPlanFor(sid){
  const capKg = Math.max(500, (parseFloat(document.getElementById('ssCap').value)||18)*1000);
  const step = Math.max(1, parseFloat(document.getElementById('ssStep').value)||500);
  const fill = document.getElementById('ssFill').value==='fill' || ssForceOne;
  const orderMap = {}; buildOrderRows().forEach(r=>{ orderMap[r.p.id] = r; });
  const ready = {};
  ssRowsSel(sid).filter(r=>r.product_id && Number(r.quantity)>0)
    .forEach(r=>{ ready[r.product_id] = (ready[r.product_id]||0) + Number(r.quantity); });
  const prioRank = {high:0, medium:1, low:2};
  const items = Object.keys(ready).map(Number).map(pid=>{
    const o = orderMap[pid]; if(!o) return null;
    const bal = Number(o.p.balance)||0, have = bal + o.pending;
    const need = Math.max(0, o.targetQty - have);
    const needQ = need>0 ? Math.min(ready[pid], Math.ceil(need/step)*step) : 0;
    return { p:o.p, o, ready:ready[pid], bal, pending:o.pending, rate:o.rate, monthly:o.monthly, need, planned:needQ, top:0,
      cover: o.rate>0 ? have/o.rate : Infinity };
  }).filter(Boolean);
  const urg = (a,b)=> ((b.bal<=0 && isImportantPriority(b.p)) - (a.bal<=0 && isImportantPriority(a.p)))
    || ((prioRank[a.p.priority]??3) - (prioRank[b.p.priority]??3)) || (a.cover - b.cover) || productOrderCmp(a.p,b.p);
  items.sort(urg);

  const needTotal = items.reduce((s,x)=>s+x.planned,0);
  let trucksN = needTotal>0 ? Math.ceil(needTotal/capKg) : (ssForceOne ? 1 : 0);
  if(fill && trucksN>0){
    let room = trucksN*capKg - needTotal;
    let guard = 0;
    while(room >= 1 && guard++ < 5000){
      const cands = items.filter(x=> x.rate>0 && x.ready - x.planned - x.top > 0);
      if(!cands.length) break;
      cands.sort((a,b)=> ((a.bal+a.pending+a.planned+a.top)/a.rate) - ((b.bal+b.pending+b.planned+b.top)/b.rate) || urg(a,b));
      const x = cands[0];
      const add = Math.min(step, x.ready - x.planned - x.top, room);
      x.top += add; room -= add;
    }
  }
  // раскладка по машинам: сначала необходимое (по срочности), потом догрузка
  const queue = [];
  items.forEach(x=>{ if(x.planned>0) queue.push({ x, qty:x.planned, kind:'need' }); });
  items.filter(x=>x.top>0).sort((a,b)=>urg(a,b)).forEach(x=> queue.push({ x, qty:x.top, kind:'top' }));
  const trucks = [];
  let cur = null;
  queue.forEach(q=>{
    let left = q.qty;
    while(left > 0.001){
      if(!cur || cur.total >= capKg - 0.001){ cur = { lines:[], total:0 }; trucks.push(cur); }
      const take = Math.min(left, capKg - cur.total);
      const ex = cur.lines.find(l=>l.x===q.x && l.kind===q.kind);
      if(ex) ex.qty += take; else cur.lines.push({ x:q.x, qty:take, kind:q.kind });
      cur.total += take; left -= take;
    }
  });
  const shortNeed = items.reduce((s,x)=> s + Math.max(0, x.need - x.planned), 0);
  return { items, trucks, capKg, step, needTotal, shortNeed, readyTotal: items.reduce((s,x)=>s+x.ready,0) };
}

let ssLastPlan = null;
function renderSupPlan(){
  const host = document.getElementById('ssPlan'); if(!host) return;
  const sid = Number(document.getElementById('ssSupplier').value);
  const sup = suppliers.find(s=>s.id===sid);
  renderSupWhOverview();
  const wh = ssSelWh();
  const rowsAll = ssRowsSel(sid);
  const asOf = rowsAll.length ? rowsAll.map(r=>r.as_of).sort().pop() : null;
  const unmatched = rowsAll.filter(r=>!r.product_id);
  document.getElementById('ssStockInfo').textContent = rowsAll.length
    ? `${sup?.name||''} · ${wh==='__all'?'все склады':'склад «'+whName(wh)+'»'} на ${new Date(asOf+'T00:00:00').toLocaleDateString('ru-RU')}: ${rowsAll.length} позиций, ${fmt(rowsAll.reduce((s,r)=>s+Number(r.quantity),0)).toLocaleString()} кг`
      + (unmatched.length ? ` · не сопоставлено ${unmatched.length}` : '')
      + ((Date.now()-new Date(asOf+'T00:00:00'))/86400000 > 7 ? ' · ⚠️ данные старше недели' : '')
    : '';
  document.getElementById('ssBasis').innerHTML = `Потребность считается как в Orders: метод <b>${orderRateMode==='manual'?'ручная норма':'взвешенное среднее'}</b>, цель запаса по типам (${ORDER_TYPES.map(t=>t+' '+getOrderTypeTarget(t)).join(', ')} мес.). Нужно = цель − наш остаток − в пути. Изменить можно в разделе Orders.`;

  const tb = document.querySelector('#ssStockTable tbody');
  if(!sid || !rowsAll.length){
    ssLastPlan = null;
    host.innerHTML = `<div class="empty">${supStockError ? escHtml(supStockError) : 'Для этого поставщика остаток ещё не загружен — загрузите его выше.'}</div>`;
    tb.innerHTML = '<tr><td colspan="10" class="empty">Нет данных</td></tr>';
    return;
  }
  const plan = ssPlanFor(sid); ssLastPlan = { plan, sid, wh };
  ssEdit = ssEditStore[ssKey(sid, wh)] || null;
  const trucksNow = ssCurrentTrucks();
  const planned = {}; trucksNow.forEach(t=>t.lines.forEach(l=>{ planned[l.pid] = (planned[l.pid]||0) + (Number(l.qty)||0); }));

  // таблица «готово у поставщика»
  const byPid = {}; plan.items.forEach(x=>{ byPid[x.p.id] = x; });
  const stockRows = [...plan.items].sort((a,b)=>productOrderCmp(a.p,b.p));
  const whOf = pid=>{ const m = {}; rowsAll.filter(r=>r.product_id===pid && Number(r.quantity)>0).forEach(r=>{ m[whName(r.warehouse)] = (m[whName(r.warehouse)]||0) + Number(r.quantity); });
    return Object.entries(m).map(([w,q])=> Object.keys(m).length>1 ? `${escHtml(w)} ${fmt(q).toLocaleString()}` : escHtml(w)).join('<br>'); };
  tb.innerHTML = stockRows.map(x=>`<tr data-pcard="${x.p.id}" style="cursor:pointer">
      <td>${isImportantPriority(x.p)?(x.p.priority==='high'?'🔴 ':'🟠 '):''}${escHtml(productLabel(x.p))}</td>
      <td>${typeBadgeHtml(x.p.type)}</td>
      <td style="font-size:12px;color:var(--text-2)">${whOf(x.p.id)}</td>
      <td class="num"><b>${fmt(x.ready).toLocaleString()}</b></td>
      <td class="num" style="color:${x.bal<=0?'var(--red)':'inherit'}">${fmt(x.bal).toLocaleString()}</td>
      <td class="num">${x.pending?fmt(x.pending).toLocaleString():'—'}</td>
      <td class="num">${x.monthly>0?fmt(x.monthly).toLocaleString():'—'}</td>
      <td class="num" data-sort="${isFinite(x.cover)?x.cover:999999}">${isFinite(x.cover)?Math.floor(x.cover):'∞'}</td>
      <td class="num" style="color:${x.need>0?'var(--red)':'var(--text-3)'}">${x.need>0?fmt(x.need).toLocaleString():'—'}</td>
      <td class="num"><b>${planned[x.p.id]?fmt(planned[x.p.id]).toLocaleString():'—'}</b></td>
    </tr>`).join('') + unmatched.map(r=>`<tr class="ss-unmatched"><td colspan="2">${escHtml(r.raw_name)} <span class="pc-note" style="display:inline">не сопоставлено</span></td><td style="font-size:12px">${escHtml(whName(r.warehouse))}</td><td class="num">${fmt(r.quantity).toLocaleString()}</td><td colspan="6"></td></tr>`).join('')
    || '<tr><td colspan="10" class="empty">Нет данных</td></tr>';

  renderSupTrucks();
}

// ── машины: ручная правка плана ──
let ssEdit = null;            // { sid, wh, trucks:[{lines:[{pid,qty,kind}]}] } — план машин, исправленный руками
// правки хранятся отдельно для каждого поставщика/склада и переживают перезагрузку страницы
const ssKey = (sid, wh)=> sid+'|'+(wh??'');
let ssEditStore = (()=>{ try{ return JSON.parse(localStorage.getItem('ss_plan_edits')||'{}'); }catch(e){ return {}; } })();
function ssPersistEdits(){
  if(ssEdit) ssEditStore[ssKey(ssEdit.sid, ssEdit.wh)] = ssEdit;
  try{ localStorage.setItem('ss_plan_edits', JSON.stringify(ssEditStore)); }catch(e){}
}
function ssDropEdit(sid, wh){
  delete ssEditStore[ssKey(sid, wh)];
  if(ssEdit && ssEdit.sid===sid && ssEdit.wh===wh) ssEdit = null;
  try{ localStorage.setItem('ss_plan_edits', JSON.stringify(ssEditStore)); }catch(e){}
}

// подпись товара в машине: вид основы + формат (+ цвет/название, если это не белый рулон)
function ssTruckLabel(p){
  if(!p) return '—';
  const fmtTxt = (p.width_cm??'—')+'cm·'+p.ply+'ply·'+(p.gsm??'—')+'gsm';
  return p.type+' · '+fmtTxt + (isWhiteRoll(p) ? '' : ' · '+p.name);
}
function ssCurrentTrucks(){
  if(ssEdit && ssLastPlan && ssEdit.sid===ssLastPlan.sid && ssEdit.wh===ssLastPlan.wh) return ssEdit.trucks;
  if(!ssLastPlan) return [];
  return ssLastPlan.plan.trucks.map(t=>({ lines: t.lines.map(l=>({ pid:l.x.p.id, qty:Math.round(l.qty), kind:l.kind })) }));
}
function ssReadyMap(sid){
  const m = {}; ssRowsSel(sid).filter(r=>r.product_id).forEach(r=>{ m[r.product_id] = (m[r.product_id]||0) + Number(r.quantity||0); });
  return m;
}
function ssBeginEdit(){
  if(!ssEdit){ ssEdit = { sid: ssLastPlan.sid, wh: ssLastPlan.wh, trucks: JSON.parse(JSON.stringify(ssCurrentTrucks())) }; ssPersistEdits(); }
  return ssEdit.trucks;
}
function ssAfterEdit(){ ssPersistEdits(); renderSupPlan(); }
function ssSetQty(ti, li, v){ const t = ssBeginEdit(); t[ti].lines[li].qty = Math.max(0, Math.round(parseFloat(v)||0)); ssAfterEdit(); }
function ssDelLine(ti, li){ const t = ssBeginEdit(); t[ti].lines.splice(li,1); ssAfterEdit(); }
function ssDelTruck(ti){ const t = ssBeginEdit(); t.splice(ti,1); ssAfterEdit(); }
function ssAddTruck(){ const t = ssBeginEdit(); t.push({ lines:[] }); ssAfterEdit(); }
function ssMoveLine(ti, li, to){
  to = Number(to); if(isNaN(to) || to===ti) return;
  const t = ssBeginEdit(); const [l] = t[ti].lines.splice(li,1);
  if(to>=t.length) t.push({ lines:[] });
  const ex = t[to].lines.find(x=>x.pid===l.pid && x.kind===l.kind);
  if(ex) ex.qty += l.qty; else t[to].lines.push(l);
  ssAfterEdit();
}
function ssAddLine(ti){
  const pid = Number(document.getElementById('ssAddP-'+ti).value), qty = Math.round(parseFloat(document.getElementById('ssAddQ-'+ti).value)||0);
  if(!pid || !(qty>0)){ toast('Выберите товар и количество', true); return; }
  const t = ssBeginEdit();
  const ex = t[ti].lines.find(x=>x.pid===pid);
  if(ex) ex.qty += qty; else t[ti].lines.push({ pid, qty, kind:'manual' });
  ssAfterEdit();
}
function ssResetEdit(){ if(ssLastPlan) ssDropEdit(ssLastPlan.sid, ssLastPlan.wh); ssEdit = null; renderSupPlan(); }

function renderSupTrucks(){
  const host = document.getElementById('ssPlan');
  const { plan, sid } = ssLastPlan;
  const sup = suppliers.find(s=>s.id===sid);
  const trucks = ssCurrentTrucks();
  const capKg = plan.capKg;
  const ready = ssReadyMap(sid);
  const used = {}; trucks.forEach(t=>t.lines.forEach(l=>{ used[l.pid] = (used[l.pid]||0) + (Number(l.qty)||0); }));
  const P = id=>products.find(p=>p.id===id);

  if(!trucks.length){
    host.innerHTML = `<div class="empty" style="padding:18px">${ssEdit ? 'Все машины удалены.' : `✓ По нашим остаткам и тому, что в пути, у ${escHtml(sup?.name||'поставщика')} сейчас заказывать не нужно.`}
      <div class="svc-btns" style="justify-content:center;margin-top:10px">
        ${ssEdit ? '<button class="btn btn-ghost btn-sm" onclick="ssResetEdit()">↺ Вернуть расчёт</button>' : '<button class="btn btn-ghost btn-sm" onclick="ssForceOne=true;renderSupPlan()">Собрать 1 машину из самого нужного</button>'}
        <button class="btn btn-ghost btn-sm" onclick="ssAddTruck()">＋ Пустая машина</button>
      </div></div>`;
    return;
  }
  const totalKg = trucks.reduce((s,t)=>s+t.lines.reduce((a,l)=>a+(Number(l.qty)||0),0),0);
  const sumKind = k=> trucks.reduce((s,t)=>s+t.lines.filter(l=>l.kind===k).reduce((a,l)=>a+(Number(l.qty)||0),0),0);
  const over = Object.keys(used).map(Number).filter(pid=> used[pid] > (ready[pid]||0) + 0.5);
  const lastTotal = trucks[trucks.length-1].lines.reduce((a,l)=>a+(Number(l.qty)||0),0);
  // товары поставщика для «добавить»: сначала с остатком
  const addOpts = Object.keys(ready).map(Number).map(pid=>({ p:P(pid), left:(ready[pid]||0)-(used[pid]||0) })).filter(x=>x.p)
    .sort((a,b)=> (b.left>0)-(a.left>0) || productOrderCmp(a.p,b.p))
    .map(x=>`<option value="${x.p.id}">${escHtml(ssTruckLabel(x.p))} — свободно ${fmt(Math.max(0,x.left)).toLocaleString()} кг</option>`).join('');

  host.innerHTML = `
    <div class="ss-sum">
      <span>Машин: <b>${trucks.length}</b></span>
      <span>Всего: <b>${fmt(totalKg).toLocaleString()} кг</b></span>
      <span>Необходимое: <b>${fmt(sumKind('need')).toLocaleString()} кг</b></span>
      ${sumKind('top')>0?`<span>Догрузка: <b>${fmt(sumKind('top')).toLocaleString()} кг</b></span>`:''}
      ${sumKind('manual')>0?`<span>Добавлено вручную: <b>${fmt(sumKind('manual')).toLocaleString()} кг</b></span>`:''}
    </div>
    ${ssEdit?`<div class="pc-note" style="color:var(--brand)">✎ План изменён вручную. <a href="#" onclick="ssResetEdit();return false">↺ Вернуть расчёт</a></div>`:''}
    ${over.length?`<div class="pc-note" style="color:var(--red)">⚠️ Больше, чем готово у поставщика: ${over.map(pid=>escHtml(ssTruckLabel(P(pid)))+' ('+fmt(used[pid]).toLocaleString()+' из '+fmt(ready[pid]||0).toLocaleString()+' кг)').join('; ')}</div>`:''}
    ${!ssEdit && plan.shortNeed>0?`<div class="pc-note" style="color:var(--amber)">У поставщика не хватает ещё ${fmt(plan.shortNeed).toLocaleString()} кг до нашей цели по этим позициям.</div>`:''}
    ${!ssEdit && lastTotal < capKg-1 ? `<div class="pc-note">Последняя машина загружена на ${Math.round(lastTotal/capKg*100)}% — ${document.getElementById('ssFill').value==='fill' ? 'больше догрузить нечем (у поставщика закончились нужные нам позиции).' : 'можно включить «Догружать до полной».'}</div>`:''}
    <div class="ss-trucks">${trucks.map((t,ti)=>{
      const tot = t.lines.reduce((a,l)=>a+(Number(l.qty)||0),0), pct = Math.round(tot/capKg*100), isOver = tot > capKg + 0.5;
      return `<div class="ss-truck${isOver?' ss-over':''}">
        <div class="ss-truck-h"><b>🚛 Машина ${ti+1}</b>
          <span style="display:flex;align-items:center;gap:8px"><span style="${isOver?'color:var(--red);font-weight:700':''}">${fmt(tot).toLocaleString()} кг · ${pct}%</span>
          <button class="ss-x" title="Удалить машину" onclick="ssDelTruck(${ti})">🗑</button></span></div>
        <div class="ss-bar ${isOver?'over':(tot<capKg-1?'part':'')}"><span style="width:${Math.min(100,tot/capKg*100)}%"></span></div>
        ${isOver?`<div class="pc-note" style="color:var(--red);margin:-4px 0 6px">Перегруз на ${fmt(tot-capKg).toLocaleString()} кг</div>`:''}
        ${t.lines.map((l,li)=>{ const p = P(l.pid);
          return `<div class="ss-line ss-line-e">
            <span class="ss-lbl">${escHtml(ssTruckLabel(p))}${l.kind==='need'?'<span class="ss-tag need">нужно</span>':l.kind==='top'?'<span class="ss-tag top">догрузка</span>':'<span class="ss-tag man">вручную</span>'}</span>
            <span class="ss-ctl">
              <input type="number" min="0" step="50" value="${Math.round(Number(l.qty)||0)}" onchange="ssSetQty(${ti},${li},this.value)" title="кг">
              ${trucks.length>1||true?`<select title="Переложить в другую машину" onchange="ssMoveLine(${ti},${li},this.value)"><option value="">⇄</option>${trucks.map((_,k)=>k===ti?'':`<option value="${k}">в маш. ${k+1}</option>`).join('')}<option value="${trucks.length}">в новую</option></select>`:''}
              <button class="ss-x" title="Удалить строку" onclick="ssDelLine(${ti},${li})">✕</button>
            </span></div>`; }).join('') || '<div class="pc-note" style="padding:6px 0">Пустая машина — добавьте товар ниже</div>'}
        <div class="ss-add">
          <select id="ssAddP-${ti}"><option value="">＋ Добавить товар…</option>${addOpts}</select>
          <input type="number" id="ssAddQ-${ti}" min="0" step="50" placeholder="кг" value="${Math.max(0, Math.round(capKg-tot))||''}">
          <button class="btn btn-ghost btn-sm" onclick="ssAddLine(${ti})">＋</button>
        </div>
      </div>`; }).join('')}
    </div>
    <div class="svc-btns" style="margin-top:14px">
      <button class="btn btn-brand" onclick="ssCreateDeliveries()">🚚 Создать поставки (${trucks.length} маш.)</button>
      <button class="btn btn-ghost" onclick="ssExportPlan()">📊 Excel для поставщика</button>
      <button class="btn btn-ghost" onclick="ssAddTruck()">＋ Машина</button>
      ${ssEdit?'<button class="btn btn-ghost" onclick="ssResetEdit()">↺ Вернуть расчёт</button>':''}
    </div>`;
}

async function ssCreateDeliveries(){
  if(!ssLastPlan) return;
  const { plan, sid } = ssLastPlan;
  const trucks = ssCurrentTrucks().map(t=>({ lines: t.lines.filter(l=>Number(l.qty)>0) })).filter(t=>t.lines.length);
  if(!trucks.length){ toast('В плане нет машин', true); return; }
  const over = trucks.findIndex(t=> t.lines.reduce((a,l)=>a+Number(l.qty),0) > plan.capKg + 0.5);
  const eta = document.getElementById('ssEta').value || null;
  const sup = suppliers.find(s=>s.id===sid);
  if(!confirm(`Создать ${trucks.length} машин(ы) от ${sup?.name||''} в разделе Deliveries со статусом «в пути»?`+(over>=0?`\n\n⚠️ Машина ${over+1} перегружена.`:''))) return;
  const stamp = new Date().toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
  const whTxt = ssLastPlan.wh && ssLastPlan.wh!=='__all' && ssLastPlan.wh!=='' ? ' · '+ssLastPlan.wh : '';
  const rows = [];
  trucks.forEach((t,i)=> t.lines.forEach(l=> rows.push({ product_id:l.pid, supplier_id:sid, quantity:Math.round(Number(l.qty)), expected_date:eta, status:'pending', plate_no:`План ${stamp}${whTxt} · машина ${i+1}` })));
  const { data, error } = await sb.from('deliveries').insert(rows).select('id');
  if(error){ toast('Ошибка: '+error.message, true); return; }
  if(!data || data.length<rows.length){ toast('Не все строки сохранены — нет прав', true); return; }
  // забранное вычитаем из остатка поставщика, чтобы его не предложило повторно
  const taken = {}; rows.forEach(r=>{ taken[r.product_id] = (taken[r.product_id]||0) + r.quantity; });
  for(const pid of Object.keys(taken).map(Number)){
    let left = taken[pid];
    for(const st of ssRowsSel(sid, ssLastPlan.wh).filter(x=>x.product_id===pid)){
      if(left<=0) break;
      const q = Number(st.quantity), nq = Math.max(0, Math.round((q-left)*100)/100);
      left -= (q-nq);
      await sb.from('supplier_stock').update({ quantity:nq }).eq('id', st.id);
    }
  }
  toast(`Создано ${trucks.length} машин(ы), ${rows.length} строк в Deliveries ✓ · остаток поставщика уменьшен`);
  await Promise.all([loadDeliveries(), loadSupStock()]);
  ssForceOne = false; ssDropEdit(sid, ssLastPlan.wh);
  renderSupPlan(); renderForecast(); renderLevels(); renderOrders();
}

async function ssExportPlan(){
  if(!ssLastPlan) return;
  const { sid } = ssLastPlan;
  const trucks = ssCurrentTrucks();
  const sup = suppliers.find(s=>s.id===sid);
  await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  const whT = ssLastPlan.wh && ssLastPlan.wh!=='__all' ? whName(ssLastPlan.wh) : 'все склады';
  const aoa = [['Заказ SoftStock' + (sup?' — '+sup.name:'')], ['Склад', whT], ['Дата', new Date().toLocaleDateString('ru-RU')], [],
    ['Машина','Вид основы','Ширина, см','Слои','GSM','Цвет / название','Количество, кг']];
  trucks.forEach((t,i)=>{
    let tot = 0;
    t.lines.filter(l=>Number(l.qty)>0).forEach(l=>{ const p = products.find(x=>x.id===l.pid); if(!p) return; tot += Number(l.qty);
      aoa.push(['Машина '+(i+1), p.type, Number(p.width_cm)||'', p.ply, Number(p.gsm)||'', isWhiteRoll(p)?'белая':p.name, Math.round(Number(l.qty))]); });
    aoa.push(['', 'Итого машина '+(i+1), '', '', '', '', Math.round(tot)]);
    aoa.push([]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{wch:12},{wch:16},{wch:11},{wch:6},{wch:6},{wch:20},{wch:15}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Заказ');
  XLSX.writeFile(wb, `Заказ_${(sup?.name||'поставщик').replace(/[^\wА-Яа-яԱ-Ֆա-ֆ-]+/g,'_')}_${todayISO()}.xlsx`);
}


// ---------------------------------------------------------------
// FORECAST → «＋ в машину» (план машин поставщика/склада)
// ---------------------------------------------------------------
function fcPlannedQty(pid, sid, wh){
  const e = ssEditStore[ssKey(sid, wh)]; if(!e) return 0;
  return e.trucks.reduce((a,t)=>a+t.lines.filter(l=>l.pid===pid).reduce((b,l)=>b+(Number(l.qty)||0),0),0);
}
// план для поставщика/склада: сохранённые правки или свежий расчёт
function fcGetPlanTrucks(sid, wh){
  const k = ssKey(sid, wh);
  if(ssEditStore[k]) return ssEditStore[k].trucks;
  const supSel = document.getElementById('ssSupplier'), whSel = document.getElementById('ssWh');
  const prevSid = supSel.value, prevWh = whSel.value;
  if(![...supSel.options].length) renderSupStock(false);
  supSel.value = String(sid); ssFillWhControls(wh);
  renderSupPlan();                                     // считает ssLastPlan для этого склада
  const trucks = JSON.parse(JSON.stringify(ssCurrentTrucks()));
  supSel.value = prevSid; ssFillWhControls(prevWh); renderSupPlan();
  return trucks;
}
let fcAddCtx = null;
function fcAddToTruck(pid, sid, wh){
  const p = products.find(x=>x.id===pid), sup = suppliers.find(x=>x.id===sid);
  const readyAll = supStock.filter(r=>r.supplier_id===sid && (r.warehouse||'')===wh && r.product_id===pid).reduce((a,r)=>a+Number(r.quantity||0),0);
  const capKg = Math.max(500, (parseFloat(document.getElementById('ssCap').value)||18)*1000);
  const step = Math.max(1, parseFloat(document.getElementById('ssStep').value)||500);
  const trucks = fcGetPlanTrucks(sid, wh);
  const used = trucks.reduce((a,t)=>a+t.lines.filter(l=>l.pid===pid).reduce((b,l)=>b+(Number(l.qty)||0),0),0);
  const free = Math.max(0, readyAll - used);
  const o = buildOrderRows().find(r=>r.p.id===pid);
  const need = o ? Math.max(0, o.targetQty - (Number(p.balance)||0) - o.pending - used) : 0;
  const def = Math.max(0, Math.min(free, need>0 ? Math.ceil(need/step)*step : free));
  fcAddCtx = { pid, sid, wh, capKg, free };
  let m = document.getElementById('fcAddModal');
  if(!m){ m = document.createElement('div'); m.id = 'fcAddModal'; m.className = 'modal-bg'; document.body.appendChild(m);
    m.addEventListener('click', e=>{ if(e.target===m) fcCloseAdd(); }); }
  const tot = t=> t.lines.reduce((a,l)=>a+(Number(l.qty)||0),0);
  m.innerHTML = `<div class="fc-add-box">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">
      <div><div style="font-size:15px;font-weight:700">🚛 Добавить в машину</div>
        <div class="pc-note" style="margin:2px 0 0">${escHtml(sup?.name||'')} · склад «${escHtml(whName(wh))}»</div></div>
      <button class="ss-x" onclick="fcCloseAdd()" style="font-size:16px">✕</button>
    </div>
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">${escHtml(ssTruckLabel(p))}</div>
    <div class="fc-add-stats">
      <div><span>Готово у поставщика</span><b>${fmt(readyAll).toLocaleString()} кг</b></div>
      <div><span>Уже в плане</span><b>${fmt(used).toLocaleString()} кг</b></div>
      <div><span>Нужно до цели</span><b style="color:${need>0?'var(--red)':'inherit'}">${need>0?fmt(need).toLocaleString()+' кг':'—'}</b></div>
    </div>
    ${free<=0?`<div class="pc-note" style="color:var(--amber);margin:-4px 0 10px">Весь готовый остаток этого склада уже в расчёте машин. Можно добавить больше вручную — программа предупредит.</div>`:''}
    <div class="form-row"><label>Сколько добавить, кг (свободно ${fmt(free).toLocaleString()})</label>
      <input type="number" id="fcAddQty" min="0" step="${step}" value="${Math.round(def)}"></div>
    <div class="form-row"><label>В какую машину</label><select id="fcAddTruck">
      <option value="auto">Автоматически — куда поместится</option>
      ${trucks.map((t,i)=>`<option value="${i}">Машина ${i+1} — свободно ${fmt(Math.max(0,capKg-tot(t))).toLocaleString()} кг</option>`).join('')}
      <option value="new">Новая машина</option>
    </select></div>
    <div class="auth-error" id="fcAddErr"></div>
    <div class="svc-btns" style="justify-content:flex-end;margin-top:8px">
      <button class="btn btn-ghost" onclick="fcCloseAdd()">Отмена</button>
      <button class="btn btn-brand" onclick="fcConfirmAdd()">＋ Добавить</button>
    </div>
  </div>`;
  m.classList.remove('hidden'); m.style.display = 'flex';
  setTimeout(()=>document.getElementById('fcAddQty')?.select(), 30);
}
function fcCloseAdd(){ const m = document.getElementById('fcAddModal'); if(m){ m.style.display = 'none'; } fcAddCtx = null; }
function fcConfirmAdd(){
  const c = fcAddCtx; if(!c) return;
  const qty = Math.round(parseFloat(document.getElementById('fcAddQty').value)||0);
  const err = document.getElementById('fcAddErr');
  if(!(qty>0)){ err.textContent = 'Укажите количество.'; return; }
  if(qty > c.free + 0.5 && !confirm(`У поставщика свободно только ${fmt(c.free).toLocaleString()} кг. Всё равно добавить ${fmt(qty).toLocaleString()} кг?`)) return;
  const k = ssKey(c.sid, c.wh);
  const trucks = JSON.parse(JSON.stringify(fcGetPlanTrucks(c.sid, c.wh)));
  const tot = t=> t.lines.reduce((a,l)=>a+(Number(l.qty)||0),0);
  const put = (ti, q)=>{ while(ti>=trucks.length) trucks.push({ lines:[] });
    const ex = trucks[ti].lines.find(l=>l.pid===c.pid); if(ex) ex.qty += q; else trucks[ti].lines.push({ pid:c.pid, qty:q, kind:'manual' }); };
  const choice = document.getElementById('fcAddTruck').value;
  const touched = new Set();
  if(choice==='auto'){
    let left = qty;
    for(let i=0; left>0 && i<trucks.length; i++){ const room = c.capKg - tot(trucks[i]); if(room>0){ const q = Math.min(room, left); put(i, q); touched.add(i+1); left -= q; } }
    while(left>0){ const i = trucks.length; const q = Math.min(c.capKg, left); put(i, q); touched.add(i+1); left -= q; }
  } else if(choice==='new'){ put(trucks.length, qty); touched.add(trucks.length); }
  else { put(Number(choice), qty); touched.add(Number(choice)+1); }
  ssEditStore[k] = { sid:c.sid, wh:c.wh, trucks };
  if(ssEdit && ssEdit.sid===c.sid && ssEdit.wh===c.wh) ssEdit = ssEditStore[k];
  try{ localStorage.setItem('ss_plan_edits', JSON.stringify(ssEditStore)); }catch(e){}
  const sup = suppliers.find(x=>x.id===c.sid);
  fcCloseAdd();
  toast(`Добавлено ${fmt(qty).toLocaleString()} кг → ${sup?.name||''} · ${whName(c.wh)}, машина ${[...touched].join(', ')}. Поставки создаются в «Склад поставщика».`);
  renderForecast();
  if(document.getElementById('pane-supstock')?.classList.contains('active')) renderSupPlan();
  const pc = document.getElementById('productCardModal');
  if(pc && !pc.classList.contains('hidden') && pcState.pid===c.pid){ const pp = products.find(x=>x.id===c.pid); if(pp) renderPcSupStock(pp); }
}


// ---------------------------------------------------------------
// DELIVERIES → отчёт для печати / PDF
// ---------------------------------------------------------------
function openDeliveryReport(){
  let m = document.getElementById('dvRepModal');
  if(!m){ m = document.createElement('div'); m.id = 'dvRepModal'; document.body.appendChild(m);
    m.addEventListener('click', e=>{ if(e.target===m) m.style.display='none'; }); }
  const sups = [...new Set(deliveries.map(d=>d.supplier_id).filter(Boolean))].map(id=>suppliers.find(s=>s.id===id)).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name));
  const today = todayISO();
  m.innerHTML = `<div class="fc-add-box" style="width:500px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
      <div style="font-size:15px;font-weight:700">🖨 Отчёт по поставкам (PDF / печать)</div>
      <button class="ss-x" style="font-size:16px" onclick="document.getElementById('dvRepModal').style.display='none'">✕</button>
    </div>
    <div class="dv-rep-grid">
      <div class="form-row"><label>Вид отчёта</label><select id="dvr-kind">
        <option value="list">Список поставок (сводка)</option>
        <option value="receive">Приёмка по машинам — с колонкой «Факт» и подписями</option></select></div>
      <div class="form-row"><label>Статус</label><select id="dvr-status">
        <option value="pending">В пути</option><option value="arrived">Получено</option><option value="all">Все</option></select></div>
      <div class="form-row"><label>Ожидаемая дата с</label><input type="date" id="dvr-from"></div>
      <div class="form-row"><label>по</label><input type="date" id="dvr-to"></div>
      <div class="form-row"><label>Поставщик</label><select id="dvr-sup"><option value="">Все поставщики</option>${sups.map(x=>`<option value="${x.id}">${escHtml(x.name)}</option>`).join('')}</select></div>
      <div class="form-row"><label>Группировка</label><select id="dvr-group">
        <option value="truck">По машинам</option><option value="supplier">По поставщикам</option><option value="type">По виду основы</option><option value="date">По датам</option></select></div>
    </div>
    <label class="dv-rep-chk"><input type="checkbox" id="dvr-pagebreak"> Каждая машина / группа — с новой страницы</label>
    <label class="dv-rep-chk"><input type="checkbox" id="dvr-landscape"> Альбомная ориентация</label>
    <div class="pc-note" id="dvr-info" style="margin:8px 0 0"></div>
    <div class="svc-btns" style="justify-content:flex-end;margin-top:12px">
      <button class="btn btn-ghost" onclick="document.getElementById('dvRepModal').style.display='none'">Отмена</button>
      <button class="btn btn-brand" onclick="buildDeliveryReport()">🖨 Сформировать</button>
    </div>
  </div>`;
  m.style.display = 'flex';
  const upd = ()=>{ const n = dvReportRows().length; document.getElementById('dvr-info').textContent = n ? `В отчёт попадёт строк: ${n}` : 'Под выбранные условия поставок нет'; };
  ['dvr-kind','dvr-status','dvr-from','dvr-to','dvr-sup'].forEach(id=>document.getElementById(id).addEventListener('change', ()=>{
    if(id==='dvr-kind'){ const rc = document.getElementById('dvr-kind').value==='receive';
      document.getElementById('dvr-group').value = rc ? 'truck' : document.getElementById('dvr-group').value;
      document.getElementById('dvr-pagebreak').checked = rc; }
    upd(); }));
  upd();
}
function dvReportRows(){
  const st = document.getElementById('dvr-status').value, from = document.getElementById('dvr-from').value, to = document.getElementById('dvr-to').value, sup = document.getElementById('dvr-sup').value;
  return deliveries.filter(d=> (st==='all' || d.status===st)
    && (!from || (d.expected_date && d.expected_date>=from))
    && (!to || (d.expected_date && d.expected_date<=to))
    && (!sup || String(d.supplier_id)===sup));
}
function buildDeliveryReport(){
  const rows = dvReportRows();
  if(!rows.length){ toast('Нет поставок под выбранные условия', true); return; }
  const kind = document.getElementById('dvr-kind').value, group = document.getElementById('dvr-group').value;
  const st = document.getElementById('dvr-status').value, from = document.getElementById('dvr-from').value, to = document.getElementById('dvr-to').value;
  const supSel = document.getElementById('dvr-sup'); const supName = supSel.value ? supSel.options[supSel.selectedIndex].text : 'все';
  const pageBreak = document.getElementById('dvr-pagebreak').checked, landscape = document.getElementById('dvr-landscape').checked;
  const receive = kind==='receive';
  const P = d=> d.products || products.find(p=>p.id===d.product_id) || {};
  const ruD = iso=> iso ? iso.slice(8,10)+'.'+iso.slice(5,7)+'.'+iso.slice(0,4) : '—';
  const kg = v=> Math.round(Number(v)||0).toLocaleString('ru-RU');
  const today = new Date();
  const isLate = d=> d.status==='pending' && d.expected_date && d.expected_date < todayISO();
  // группы
  const gkey = d=> group==='supplier' ? (d.suppliers?.name || '— без поставщика —')
    : group==='type' ? (P(d).type || '—')
    : group==='date' ? (d.expected_date || '— без даты —')
    : ((d.plate_no||'').trim() || '— без номера —') + '|' + (d.expected_date||'');
  const groups = {};
  rows.forEach(d=>{ const k = gkey(d); (groups[k] = groups[k] || []).push(d); });
  const entries = Object.entries(groups).sort((a,b)=>{
    if(group==='date') return a[0].localeCompare(b[0]);
    if(group==='truck'){ const da = a[1][0].expected_date||'9999', db = b[1][0].expected_date||'9999'; return da.localeCompare(db) || a[0].localeCompare(b[0]); }
    return a[0].localeCompare(b[0]);
  });
  entries.forEach(([,items])=> items.sort((x,y)=> productOrderCmp(products.find(p=>p.id===x.product_id), products.find(p=>p.id===y.product_id))));
  const total = rows.reduce((a,d)=>a+Number(d.quantity||0),0);
  const trucks = new Set(rows.map(d=>((d.plate_no||'').trim()||'?')+'|'+(d.expected_date||''))).size;
  const late = rows.filter(isLate).length;
  // итоги по видам основы
  const byType = {}; rows.forEach(d=>{ const t = P(d).type||'—'; byType[t] = (byType[t]||0) + Number(d.quantity||0); });

  const groupTitle = (k, items)=>{
    const d0 = items[0];
    if(group==='truck') return `Машина: ${escHtml(k.split('|')[0])}<span class="gt-sub">${escHtml(d0.suppliers?.name||'—')} · ожидается ${ruD(d0.expected_date)}${items.some(isLate)?' · <b class="late">просрочено</b>':''}</span>`;
    if(group==='date') return `Ожидается ${k.startsWith('—')?k:ruD(k)}`;
    return escHtml(k);
  };
  const head = `<tr><th class="n">№</th>${group!=='type'?'<th>Вид основы</th>':''}<th>Товар</th><th>Ширина, см</th><th>Слои</th><th>GSM</th>
    ${group!=='supplier'?'<th>Поставщик</th>':''}${group!=='truck'?'<th>Машина</th>':''}${group!=='truck'&&group!=='date'?'<th>Ожидается</th>':''}
    <th class="r">Кол-во, кг</th>${receive?'<th class="r fact">Факт, кг</th><th class="fact">Примечание</th>':'<th>Статус</th>'}</tr>`;
  const body = entries.map(([k, items])=>{
    const sum = items.reduce((a,d)=>a+Number(d.quantity||0),0);
    const lines = items.map((d,i)=>{ const p = P(d);
      return `<tr><td class="n">${i+1}</td>${group!=='type'?`<td>${escHtml(p.type||'—')}</td>`:''}<td>${escHtml(p.name||'—')}</td>
        <td class="c">${p.width_cm??'—'}</td><td class="c">${p.ply??'—'}</td><td class="c">${p.gsm??'—'}</td>
        ${group!=='supplier'?`<td>${escHtml(d.suppliers?.name||'—')}</td>`:''}${group!=='truck'?`<td>${escHtml(d.plate_no||'—')}</td>`:''}
        ${group!=='truck'&&group!=='date'?`<td class="c${isLate(d)?' late':''}">${ruD(d.expected_date)}</td>`:''}
        <td class="r b">${kg(d.quantity)}</td>${receive?'<td class="fact"></td><td class="fact"></td>':`<td class="${isLate(d)?'late':''}">${d.status==='arrived'?'получено '+(d.arrived_at?ruD(String(d.arrived_at).slice(0,10)):''):(isLate(d)?'просрочено':'в пути')}</td>`}</tr>`; }).join('');
    const span = head.match(/<th/g).length;
    const sumSpan = span - (receive?3:2);
    return `<section class="grp${pageBreak?' pb':''}">
      <h2>${groupTitle(k, items)}</h2>
      <table><thead>${head}</thead><tbody>${lines}</tbody>
      <tfoot><tr><td colspan="${sumSpan}" class="r">Итого${group==='truck'?' по машине':''}: ${items.length} поз.</td><td class="r b">${kg(sum)}</td>${receive?'<td class="fact"></td><td class="fact"></td>':'<td></td>'}</tr></tfoot></table>
      ${receive && group==='truck' ? `<div class="sign"><div>Принял: ______________________ / ______________ /</div><div>Водитель: ______________________ / ______________ /</div><div>Дата и время приёмки: ____.____.________ ____:____</div></div>` : ''}
    </section>`;
  }).join('');
  const statusTxt = ({pending:'в пути', arrived:'получено', all:'все'})[st];
  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Поставки ${ruD(todayISO())}</title>
<style>
  @page{ size:A4 ${landscape?'landscape':'portrait'}; margin:12mm 10mm 14mm }
  *{ box-sizing:border-box }
  body{ font-family:Arial,Helvetica,sans-serif; color:#111; font-size:10.5pt; margin:0 }
  .bar{ position:sticky; top:0; background:#0F6E56; color:#fff; padding:10px 16px; display:flex; gap:10px; align-items:center; justify-content:space-between }
  .bar button{ background:#fff; color:#0F6E56; border:0; border-radius:6px; padding:8px 14px; font-weight:700; cursor:pointer; font-size:13px }
  .doc{ padding:14px 18px; max-width:${landscape?'1120px':'800px'}; margin:0 auto }
  h1{ font-size:16pt; margin:0 0 2px } .muted{ color:#555; font-size:9.5pt }
  .meta{ display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #0F6E56; padding-bottom:6px; margin-bottom:10px }
  .kpis{ display:flex; gap:8px; margin:8px 0 12px; flex-wrap:wrap }
  .kpi{ border:1px solid #ccc; border-radius:4px; padding:5px 10px } .kpi b{ display:block; font-size:12pt }
  .types{ font-size:9.5pt; color:#333; margin:-4px 0 10px }
  h2{ font-size:11.5pt; margin:14px 0 4px; padding:5px 8px; background:#E7F3EE; border-left:4px solid #0F6E56 }
  .gt-sub{ font-weight:400; font-size:9.5pt; color:#333; margin-left:10px }
  table{ width:100%; border-collapse:collapse; font-size:9.5pt }
  th,td{ border:1px solid #999; padding:3px 5px; vertical-align:top }
  th{ background:#f2f2f2; font-size:8.5pt; text-align:left } th.r,td.r{ text-align:right } td.c{ text-align:center } td.n,th.n{ width:22px; text-align:center }
  td.b{ font-weight:700 } tfoot td{ background:#fafafa; font-weight:700 }
  td.fact,th.fact{ min-width:70px } th.fact{ background:#fff8e1 }
  .late{ color:#B42318 } b.late{ color:#B42318 }
  .sign{ display:flex; flex-direction:column; gap:10px; margin:12px 0 4px; font-size:10pt }
  .grp{ break-inside:avoid-page } .pb{ break-after:page } section.grp:last-of-type{ break-after:auto }
  thead{ display:table-header-group } tr{ break-inside:avoid }
  .foot{ margin-top:14px; font-size:8.5pt; color:#666; border-top:1px solid #ccc; padding-top:4px }
  @media print{ .bar{ display:none } .doc{ padding:0; max-width:none } h2{ -webkit-print-color-adjust:exact; print-color-adjust:exact } th{ -webkit-print-color-adjust:exact; print-color-adjust:exact } }
</style></head><body>
<div class="bar"><span>Отчёт готов. Для PDF выберите в окне печати «Сохранить как PDF».</span><span><button onclick="window.print()">🖨 Печать / PDF</button> <button onclick="window.close()">Закрыть</button></span></div>
<div class="doc">
  <div class="meta"><div><h1>${receive?'Акт приёмки поставок':'Поставки'}</h1>
    <div class="muted">Статус: ${statusTxt} · период: ${from||to ? (from?ruD(from):'…')+' — '+(to?ruD(to):'…') : 'все даты'} · поставщик: ${escHtml(supName)}</div></div>
    <div class="muted" style="text-align:right">SoftStock<br>${today.toLocaleDateString('ru-RU')} ${today.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}<br>${escHtml(myProfile?.full_name||'')}</div></div>
  <div class="kpis">
    <div class="kpi">Всего, кг<b>${kg(total)}</b></div>
    <div class="kpi">Тонн<b>${(total/1000).toFixed(2).replace('.',',')}</b></div>
    <div class="kpi">Машин<b>${trucks}</b></div>
    <div class="kpi">Позиций<b>${rows.length}</b></div>
    ${late?`<div class="kpi late">Просрочено<b>${late}</b></div>`:''}
  </div>
  <div class="types">${Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([t,v])=>`${escHtml(t)}: <b>${kg(v)} кг</b>`).join(' · ')}</div>
  ${body}
  <div class="foot">Сформировано в SoftStock · ${today.toLocaleString('ru-RU')}</div>
</div>
<script>setTimeout(function(){ window.print(); }, 400);<\/script>
</body></html>`;
  const w = window.open('', '_blank');
  if(!w){ toast('Браузер заблокировал новое окно — разрешите всплывающие окна для этого сайта', true); return; }
  w.document.open(); w.document.write(html); w.document.close();
  document.getElementById('dvRepModal').style.display = 'none';
}


// ---------------------------------------------------------------
// КОНТЕЙНЕРЫ — отдельный учёт готовой продукции / оборудования.
// Свои таблицы (shipments, shipment_items, shipment_events); со складом сырья не связан.
// ---------------------------------------------------------------
const SH_STATUS = [
  ['ordered','Заказано','#64748b'], ['production','Производство','#7c3aed'], ['shipped','В пути','#2563eb'],
  ['port','В порту','#0891b2'], ['customs','Таможня','#d97706'], ['delivered','Доставлено','#0F6E56'], ['cancelled','Отменено','#9ca3af']
];
const SH_STEPS = ['ordered','production','shipped','port','customs','delivered'];
const SH_CAT  = { finished:'Готовая продукция', equipment:'Оборудование / станки', parts:'Запчасти', other:'Прочее' };
const SH_KIND = { container:'Контейнер', truck:'Авто', air:'Авиа', rail:'Ж/д', other:'Другое' };
const SH_ACTIVE = ['ordered','production','shipped','port','customs'];
let shRows = [], shItems = [], shEvents = [], shErr = '', shFilter = 'active', shLoaded = false;
const shSt = k=> SH_STATUS.find(x=>x[0]===k) || [k,k,'#64748b'];
const shRu = iso=> iso ? iso.slice(8,10)+'.'+iso.slice(5,7)+'.'+iso.slice(0,4) : '—';

async function shLoad(force){
  if(shLoaded && !force){ shRender(); return; }
  const [a,b,c] = await Promise.all([
    sb.from('shipments').select('*').order('id',{ascending:false}),
    sb.from('shipment_items').select('*').order('id'),
    sb.from('shipment_events').select('*').order('at').order('id')
  ]);
  shErr = a.error ? (/shipments/.test(a.error.message) ? 'Раздел ещё не включён — выполните в Supabase скрипт migration_shipments.sql.' : a.error.message) : '';
  shRows = a.data||[]; shItems = b.data||[]; shEvents = c.data||[]; shLoaded = !a.error;
  shRender();
}
function shTargetDate(r){ return r.eta_final || r.eta || null; }
function shIsLate(r){ const d = shTargetDate(r); return SH_ACTIVE.includes(r.status) && d && d < todayISO(); }
function shDaysTo(iso){ return Math.round((new Date(iso+'T00:00:00') - new Date(todayISO()+'T00:00:00'))/86400000); }

function shRender(){
  const tb = document.querySelector('#shTable tbody'); if(!tb) return;
  // KPI
  const active = shRows.filter(r=>SH_ACTIVE.includes(r.status));
  const moving = shRows.filter(r=>['shipped','port','customs'].includes(r.status));
  const soon = active.filter(r=>{ const d = shTargetDate(r); return d && d>=todayISO() && shDaysTo(d)<=14; });
  const late = shRows.filter(shIsLate);
  const kpi = (l,v,sub,col,f)=>`<div class="card kpi-card" style="cursor:pointer;padding:12px 14px" onclick="shSetFilter('${f}')"><div class="pc-note" style="margin:0;text-transform:uppercase;font-size:10.5px;letter-spacing:.04em">${l}</div><div style="font-size:22px;font-weight:700;color:${col||'inherit'}">${v}</div><div class="pc-note" style="margin:0">${sub}</div></div>`;
  document.getElementById('shKpis').innerHTML =
    kpi('Активные', active.length, 'всё, что ещё не доставлено', '', 'active') +
    kpi('В пути / порт / таможня', moving.length, 'уже отгружено', '#2563eb', 'moving') +
    kpi('Прибудут за 14 дней', soon.length, 'по плановой дате', '#0891b2', 'soon') +
    kpi('Просрочено', late.length, 'плановая дата прошла', late.length?'var(--red)':'', 'late');
  // фильтр по статусу
  const cnt = k=> shRows.filter(r=>r.status===k).length;
  const pills = [['active',`Активные (${active.length})`], ...SH_STATUS.map(([k,l])=>[k,`${l} (${cnt(k)})`]), ['all',`Все (${shRows.length})`]];
  document.getElementById('shStatusBar').innerHTML = pills.map(([k,l])=>`<span class="pill${shFilter===k?' active':''}" onclick="shSetFilter('${k}')">${l}</span>`).join('');
  if(shErr){ tb.innerHTML = `<tr><td colspan="6" class="empty">${escHtml(shErr)}</td></tr>`; return; }
  const cat = document.getElementById('shCat').value, q = (document.getElementById('shSearch').value||'').toLowerCase().trim();
  let rows = shRows.filter(r=>{
    if(shFilter==='active') return SH_ACTIVE.includes(r.status);
    if(shFilter==='moving') return ['shipped','port','customs'].includes(r.status);
    if(shFilter==='soon') return soon.includes(r);
    if(shFilter==='late') return shIsLate(r);
    if(shFilter==='all') return true;
    return r.status===shFilter;
  });
  if(cat) rows = rows.filter(r=>r.category===cat);
  if(q) rows = rows.filter(r=> [r.ref_no,r.title,r.sender,r.origin,r.destination,r.carrier,r.vessel,r.bl_no,r.notes, ...shItems.filter(i=>i.shipment_id===r.id).map(i=>i.name)].join(' ').toLowerCase().includes(q));
  rows.sort((a,b)=> (shIsLate(b)-shIsLate(a)) || (shTargetDate(a)||'9999').localeCompare(shTargetDate(b)||'9999') || b.id-a.id);
  if(!rows.length){ tb.innerHTML = `<tr><td colspan="6" class="empty">${shRows.length ? 'Ничего не найдено' : 'Пока нет отправок — нажмите «＋ Новая отправка»'}</td></tr>`; return; }
  tb.innerHTML = rows.map(r=>{
    const st = shSt(r.status), items = shItems.filter(i=>i.shipment_id===r.id), ev = shEvents.filter(e=>e.shipment_id===r.id).slice(-1)[0];
    const d = shTargetDate(r), dd = d ? shDaysTo(d) : null;
    const stepIdx = SH_STEPS.indexOf(r.status);
    return `<tr style="cursor:pointer" onclick="shOpenView(${r.id})">
      <td><b>${escHtml(r.ref_no||'—')}</b><div class="pc-note" style="margin:0">${SH_KIND[r.kind]||''}${r.container_type?' '+escHtml(r.container_type):''}</div></td>
      <td style="max-width:300px"><span class="sh-cat sh-cat-${r.category}">${SH_CAT[r.category]||''}</span> <b>${escHtml(r.title||'')}</b>
        <div class="pc-note" style="margin:2px 0 0">${items.slice(0,3).map(i=>escHtml(i.name)+(i.qty!=null?' — '+fmt(i.qty).toLocaleString()+' '+escHtml(i.unit||''):'')).join('; ')}${items.length>3?` … ещё ${items.length-3}`:''}</div></td>
      <td>${escHtml(r.sender||'—')}<div class="pc-note" style="margin:0">${escHtml(r.origin||'?')} → ${escHtml(r.destination||'?')}</div></td>
      <td data-sort="${SH_STEPS.indexOf(r.status)}"><span class="sh-badge" style="--c:${st[2]}">${st[1]}</span>
        ${stepIdx>=0?`<div class="sh-steps">${SH_STEPS.map((k,i)=>`<i class="${i<=stepIdx?'on':''}" style="${i<=stepIdx?'background:'+st[2]:''}"></i>`).join('')}</div>`:''}</td>
      <td data-sort="${d||'9999'}">${r.status==='delivered' ? `<span style="color:var(--brand)">${shRu(r.delivered_at||d)}</span><div class="pc-note" style="margin:0">доставлено</div>`
        : d ? `<b style="${dd<0?'color:var(--red)':dd<=3?'color:var(--amber)':''}">${shRu(d)}</b><div class="pc-note" style="margin:0;${dd<0?'color:var(--red)':''}">${dd<0?'просрочено '+(-dd)+' дн.':dd===0?'сегодня':'через '+dd+' дн.'}${r.eta_final&&r.eta&&r.eta!==r.eta_final?' · порт '+shRu(r.eta):''}</div>` : '<span class="pc-note">не указано</span>'}</td>
      <td style="font-size:12px;color:var(--text-2);max-width:220px">${ev?`${shRu(ev.at)} · ${escHtml(ev.note || shSt(ev.status)[1])}`:''}</td>
    </tr>`;
  }).join('');
}
function shSetFilter(f){ shFilter = f; shRender(); }

// ── модальные окна ──
function shModal(html, wide){
  let m = document.getElementById('shModal');
  if(!m){ m = document.createElement('div'); m.id = 'shModal'; document.body.appendChild(m);
    m.addEventListener('click', e=>{ if(e.target===m) shCloseModal(); }); }
  m.innerHTML = `<div class="sh-box${wide?' wide':''}">${html}</div>`;
  m.style.display = 'flex';
}
function shCloseModal(){ const m = document.getElementById('shModal'); if(m) m.style.display = 'none'; }

function shOpenView(id){
  const r = shRows.find(x=>x.id===id); if(!r) return;
  const st = shSt(r.status), items = shItems.filter(i=>i.shipment_id===id), ev = shEvents.filter(e=>e.shipment_id===id);
  const stepIdx = SH_STEPS.indexOf(r.status);
  const f = (l,v)=> v ? `<div><span>${l}</span><b>${v}</b></div>` : '';
  shModal(`
    <div class="sh-head"><div><div style="font-size:17px;font-weight:700">${escHtml(r.ref_no||'Без номера')} <span class="sh-badge" style="--c:${st[2]}">${st[1]}</span></div>
      <div class="pc-note" style="margin:2px 0 0">${SH_KIND[r.kind]||''}${r.container_type?' '+escHtml(r.container_type):''} · <span class="sh-cat sh-cat-${r.category}">${SH_CAT[r.category]}</span> ${escHtml(r.title||'')}</div></div>
      <button class="ss-x" style="font-size:16px" onclick="shCloseModal()">✕</button></div>
    <div class="sh-stepper">${SH_STEPS.map((k,i)=>{ const s2 = shSt(k); const done = stepIdx>=0 && i<=stepIdx;
      const e = [...ev].reverse().find(x=>x.status===k);
      return `<div class="${done?'done':''}" style="${done?'--c:'+st[2]:''}"><i></i><span>${s2[1]}</span><small>${e?shRu(e.at):''}</small></div>`; }).join('')}</div>
    ${r.status==='cancelled'?'<div class="pc-note" style="color:var(--red)">Отправка отменена</div>':''}
    <div class="sh-info">
      ${f('Отправитель', escHtml(r.sender))}${f('Маршрут', escHtml((r.origin||'?')+' → '+(r.destination||'?')))}
      ${f('Перевозчик / линия', escHtml(r.carrier))}${f('Судно / рейс', escHtml(r.vessel))}${f('Коносамент / CMR', escHtml(r.bl_no))}
      ${f('Дата заказа', r.order_date?shRu(r.order_date):'')}${f('Отправка (ETD)', r.etd?shRu(r.etd):'')}${f('Прибытие в порт (ETA)', r.eta?shRu(r.eta):'')}
      ${f('Доставка на склад', r.eta_final?shRu(r.eta_final):'')}${f('Доставлено', r.delivered_at?shRu(r.delivered_at):'')}
      ${f('Стоимость', r.value!=null?fmt(r.value).toLocaleString()+' '+escHtml(r.currency||''):'')}
    </div>
    ${r.notes?`<div class="sh-notes">${escHtml(r.notes)}</div>`:''}
    <div class="sh-sec">Состав (${items.length})</div>
    ${items.length?`<table class="sh-items"><thead><tr><th>Наименование</th><th>Кол-во</th><th>Примечание</th></tr></thead><tbody>
      ${items.map(i=>`<tr><td>${escHtml(i.name)}</td><td class="num" style="white-space:nowrap">${i.qty!=null?fmt(i.qty).toLocaleString()+' '+escHtml(i.unit||''):'—'}</td><td style="color:var(--text-2)">${escHtml(i.note||'')}</td></tr>`).join('')}</tbody></table>`:'<div class="pc-note">Позиции не указаны</div>'}
    <div class="sh-sec">История</div>
    <div class="sh-timeline">${ev.length ? [...ev].reverse().map(e=>`<div><b>${shRu(e.at)}</b>${e.status?` <span class="sh-badge" style="--c:${shSt(e.status)[2]}">${shSt(e.status)[1]}</span>`:''} ${escHtml(e.note||'')} <span class="pc-note" style="display:inline">· ${escHtml(e.user_name||'')}</span></div>`).join('') : '<div class="pc-note">Записей пока нет</div>'}</div>
    ${canEdit()?`<div class="sh-upd">
      <select id="shUpdStatus"><option value="">— статус без изменений —</option>${SH_STATUS.map(([k,l])=>`<option value="${k}" ${k===SH_STEPS[stepIdx+1]?'selected':''}>${l}</option>`).join('')}</select>
      <input type="date" id="shUpdDate" value="${todayISO()}">
      <input type="text" id="shUpdNote" placeholder="Заметка: «прибыл в Поти», «выпущен с таможни»…">
      <button class="btn btn-brand btn-sm" onclick="shAddEvent(${id})">Записать</button>
    </div>
    <div class="svc-btns" style="justify-content:space-between;margin-top:12px">
      <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="shDelete(${id})">🗑 Удалить</button>
      <button class="btn btn-ghost btn-sm" onclick="shOpenEdit(${id})">✎ Редактировать</button>
    </div>`:''}
  `, true);
}

async function shAddEvent(id){
  const r = shRows.find(x=>x.id===id); if(!r) return;
  const status = document.getElementById('shUpdStatus').value, at = document.getElementById('shUpdDate').value || todayISO(), note = document.getElementById('shUpdNote').value.trim();
  if(!status && !note){ toast('Выберите статус или напишите заметку', true); return; }
  const ins = await sb.from('shipment_events').insert({ shipment_id:id, at, status: status||null, note, user_name: myProfile?.full_name||'' }).select('id');
  if(ins.error || !ins.data?.length){ toast('Не сохранено: '+(ins.error?.message||'нет прав'), true); return; }
  if(status && status!==r.status){
    const patch = { status, updated_at:new Date().toISOString() };
    if(status==='delivered') patch.delivered_at = at;
    if(status==='shipped' && !r.etd) patch.etd = at;
    const up = await sb.from('shipments').update(patch).eq('id', id).select('id');
    if(up.error){ toast('Ошибка: '+up.error.message, true); return; }
  }
  toast('Записано ✓');
  await shLoad(true); shOpenView(id);
}

function shOpenEdit(id){
  const r = id ? shRows.find(x=>x.id===id) : { kind:'container', category:'equipment', status:'ordered', currency:'USD', order_date: todayISO() };
  const items = id ? shItems.filter(i=>i.shipment_id===id) : [];
  const v = k=> escHtml(r[k]??'');
  const opt = (obj, cur)=> Object.entries(obj).map(([k,l])=>`<option value="${k}" ${k===cur?'selected':''}>${l}</option>`).join('');
  shModal(`
    <div class="sh-head"><div style="font-size:16px;font-weight:700">${id?'Редактировать отправку':'Новая отправка'}</div><button class="ss-x" style="font-size:16px" onclick="${id?`shOpenView(${id})`:'shCloseModal()'}">✕</button></div>
    <div class="sh-form">
      <div class="form-row"><label>Номер контейнера / отправки</label><input id="shf-ref_no" value="${v('ref_no')}" placeholder="MSCU1234567"></div>
      <div class="form-row"><label>Вид</label><select id="shf-kind">${opt(SH_KIND, r.kind)}</select></div>
      <div class="form-row"><label>Тип контейнера</label><input id="shf-container_type" value="${v('container_type')}" placeholder="40'HC"></div>
      <div class="form-row"><label>Категория</label><select id="shf-category">${opt(SH_CAT, r.category)}</select></div>
      <div class="form-row sh-span2"><label>Что везём (коротко)</label><input id="shf-title" value="${v('title')}" placeholder="Линия для салфеток V-fold"></div>
      <div class="form-row"><label>Статус</label><select id="shf-status">${SH_STATUS.map(([k,l])=>`<option value="${k}" ${k===r.status?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="form-row sh-span2"><label>Отправитель / завод</label><input id="shf-sender" value="${v('sender')}"></div>
      <div class="form-row"><label>Откуда</label><input id="shf-origin" value="${v('origin')}" placeholder="Шанхай, Китай"></div>
      <div class="form-row"><label>Куда</label><input id="shf-destination" value="${v('destination')}" placeholder="Ереван, склад"></div>
      <div class="form-row"><label>Перевозчик / линия</label><input id="shf-carrier" value="${v('carrier')}" placeholder="MSC"></div>
      <div class="form-row"><label>Судно / рейс</label><input id="shf-vessel" value="${v('vessel')}"></div>
      <div class="form-row"><label>Коносамент / CMR / AWB</label><input id="shf-bl_no" value="${v('bl_no')}"></div>
      <div class="form-row"><label>Дата заказа</label><input type="date" id="shf-order_date" value="${v('order_date')}"></div>
      <div class="form-row"><label>Отправка (ETD)</label><input type="date" id="shf-etd" value="${v('etd')}"></div>
      <div class="form-row"><label>Прибытие в порт (ETA)</label><input type="date" id="shf-eta" value="${v('eta')}"></div>
      <div class="form-row"><label>Доставка на склад</label><input type="date" id="shf-eta_final" value="${v('eta_final')}"></div>
      <div class="form-row"><label>Стоимость</label><div style="display:flex;gap:6px"><input type="number" id="shf-value" value="${v('value')}" min="0" step="0.01"><select id="shf-currency" style="width:84px">${['USD','EUR','CNY','RUB','AMD'].map(c=>`<option ${c===r.currency?'selected':''}>${c}</option>`).join('')}</select></div></div>
      <div class="form-row sh-span3"><label>Заметки</label><textarea id="shf-notes" rows="2">${v('notes')}</textarea></div>
    </div>
    <div class="sh-sec">Состав</div>
    <div id="shItemsEd">${items.map(i=>shItemRow(i)).join('')}</div>
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('shItemsEd').insertAdjacentHTML('beforeend', shItemRow({unit:'шт'}))">＋ Позиция</button>
    <div class="auth-error" id="shfErr"></div>
    <div class="svc-btns" style="justify-content:flex-end;margin-top:12px">
      <button class="btn btn-ghost" onclick="${id?`shOpenView(${id})`:'shCloseModal()'}">Отмена</button>
      <button class="btn btn-brand" id="shfSave" onclick="shSave(${id||0})">💾 Сохранить</button>
    </div>`, true);
  if(!id) document.getElementById('shItemsEd').insertAdjacentHTML('beforeend', shItemRow({unit:'шт'}));
}
function shItemRow(i){
  const units = ['шт','комплект','паллет','коробка','рулон','кг','т','м³'];
  return `<div class="sh-item-ed" data-id="${i.id||''}">
    <input class="it-name" placeholder="Наименование" value="${escHtml(i.name||'')}">
    <input class="it-qty" type="number" min="0" step="any" placeholder="Кол-во" value="${i.qty??''}">
    <select class="it-unit">${units.map(u=>`<option ${u===(i.unit||'шт')?'selected':''}>${u}</option>`).join('')}${i.unit && !units.includes(i.unit)?`<option selected>${escHtml(i.unit)}</option>`:''}</select>
    <input class="it-note" placeholder="Примечание" value="${escHtml(i.note||'')}">
    <button class="ss-x" title="Убрать" onclick="this.parentElement.remove()">✕</button>
  </div>`;
}
async function shSave(id){
  const err = document.getElementById('shfErr'); err.textContent = '';
  const g = k=> document.getElementById('shf-'+k).value;
  const rec = {};
  ['ref_no','kind','container_type','category','title','status','sender','origin','destination','carrier','vessel','bl_no','currency','notes'].forEach(k=> rec[k] = g(k).trim());
  ['order_date','etd','eta','eta_final'].forEach(k=> rec[k] = g(k) || null);
  rec.value = g('value')==='' ? null : Number(g('value'));
  if(!rec.ref_no && !rec.title){ err.textContent = 'Укажите номер или что везём.'; return; }
  const items = [...document.querySelectorAll('#shItemsEd .sh-item-ed')].map(el=>({
    name: el.querySelector('.it-name').value.trim(), qty: el.querySelector('.it-qty').value===''?null:Number(el.querySelector('.it-qty').value),
    unit: el.querySelector('.it-unit').value, note: el.querySelector('.it-note').value.trim() })).filter(x=>x.name);
  const btn = document.getElementById('shfSave'); btn.disabled = true;
  try{
    const old = id ? shRows.find(x=>x.id===id) : null;
    rec.updated_at = new Date().toISOString();
    if(rec.status==='delivered' && !(old && old.delivered_at)) rec.delivered_at = todayISO();
    let sid = id;
    if(id){
      const r = await sb.from('shipments').update(rec).eq('id', id).select('id');
      if(r.error) throw r.error; if(!r.data?.length) throw new Error('нет прав на изменение');
      const d = await sb.from('shipment_items').delete().eq('shipment_id', id); if(d.error) throw d.error;
    } else {
      const r = await sb.from('shipments').insert(rec).select('id');
      if(r.error) throw r.error; if(!r.data?.length) throw new Error('нет прав');
      sid = r.data[0].id;
    }
    if(items.length){ const r = await sb.from('shipment_items').insert(items.map(x=>({ ...x, shipment_id:sid }))); if(r.error) throw r.error; }
    if(!id || (old && old.status!==rec.status))
      await sb.from('shipment_events').insert({ shipment_id:sid, at:todayISO(), status:rec.status, note: id?'статус изменён':'создано', user_name: myProfile?.full_name||'' });
    toast('Сохранено ✓');
    await shLoad(true); shOpenView(sid);
  }catch(e){ err.textContent = /shipments|shipment_/.test(e.message||'') && /exist/.test(e.message||'') ? 'Выполните в Supabase скрипт migration_shipments.sql.' : 'Ошибка: '+(e.message||e); }
  finally{ btn.disabled = false; }
}
async function shDelete(id){
  const r = shRows.find(x=>x.id===id);
  if(!confirm(`Удалить отправку «${r?.ref_no||r?.title||id}» вместе с составом и историей?`)) return;
  const d = await sb.from('shipments').delete().eq('id', id).select('id');
  if(d.error || !d.data?.length){ toast('Не удалено: '+(d.error?.message||'нет прав'), true); return; }
  toast('Удалено ✓'); shCloseModal(); shLoad(true);
}

function shPrint(){
  const rows = [...document.querySelectorAll('#shTable tbody tr[onclick]')].map(tr=> shRows.find(x=>x.id===Number(tr.getAttribute('onclick').match(/\d+/)[0]))).filter(Boolean);
  if(!rows.length){ toast('Нет строк для печати', true); return; }
  const flt = document.querySelector('#shStatusBar .pill.active')?.textContent || '';
  const today = new Date();
  const body = rows.map(r=>{ const items = shItems.filter(i=>i.shipment_id===r.id), d = shTargetDate(r);
    return `<tr><td><b>${escHtml(r.ref_no||'—')}</b><br><small>${SH_KIND[r.kind]||''} ${escHtml(r.container_type||'')}</small></td>
      <td><b>${escHtml(r.title||'')}</b><br><small>${SH_CAT[r.category]}</small>${items.length?'<ul>'+items.map(i=>`<li>${escHtml(i.name)}${i.qty!=null?' — '+fmt(i.qty).toLocaleString()+' '+escHtml(i.unit||''):''}</li>`).join('')+'</ul>':''}</td>
      <td>${escHtml(r.sender||'—')}<br><small>${escHtml(r.origin||'?')} → ${escHtml(r.destination||'?')}</small>${r.carrier||r.vessel?`<br><small>${escHtml([r.carrier,r.vessel].filter(Boolean).join(' · '))}</small>`:''}${r.bl_no?`<br><small>B/L ${escHtml(r.bl_no)}</small>`:''}</td>
      <td>${shSt(r.status)[1]}</td>
      <td class="${shIsLate(r)?'late':''}">${r.etd?'ETD '+shRu(r.etd)+'<br>':''}${r.eta?'ETA '+shRu(r.eta)+'<br>':''}${r.eta_final?'склад '+shRu(r.eta_final):''}${r.status==='delivered'?'<br>доставлено '+shRu(r.delivered_at):''}${shIsLate(r)?'<br><b>просрочено</b>':''}</td></tr>`; }).join('');
  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Контейнеры ${today.toLocaleDateString('ru-RU')}</title><style>
    @page{ size:A4 landscape; margin:12mm 10mm } body{ font-family:Arial,Helvetica,sans-serif; font-size:10pt; color:#111; margin:0 }
    .bar{ background:#0F6E56; color:#fff; padding:10px 16px; display:flex; justify-content:space-between; align-items:center } .bar button{ background:#fff; color:#0F6E56; border:0; border-radius:6px; padding:8px 14px; font-weight:700; cursor:pointer }
    .doc{ padding:14px 18px } h1{ font-size:16pt; margin:0 } .muted{ color:#555; font-size:9.5pt; margin-bottom:10px }
    table{ width:100%; border-collapse:collapse } th,td{ border:1px solid #999; padding:4px 6px; vertical-align:top; text-align:left } th{ background:#f2f2f2; font-size:9pt }
    small{ color:#555 } ul{ margin:3px 0 0 16px; padding:0 } .late{ color:#B42318 } tr{ break-inside:avoid } thead{ display:table-header-group }
    @media print{ .bar{ display:none } .doc{ padding:0 } th{ -webkit-print-color-adjust:exact; print-color-adjust:exact } }
  </style></head><body><div class="bar"><span>Для PDF выберите «Сохранить как PDF».</span><span><button onclick="window.print()">🖨 Печать / PDF</button> <button onclick="window.close()">Закрыть</button></span></div>
  <div class="doc"><h1>Контейнеры и отправки</h1><div class="muted">${escHtml(flt)} · ${rows.length} шт. · ${today.toLocaleString('ru-RU')} · ${escHtml(myProfile?.full_name||'')}</div>
  <table><thead><tr><th>Номер</th><th>Что везём</th><th>Отправитель / маршрут</th><th>Статус</th><th>Даты</th></tr></thead><tbody>${body}</tbody></table></div>
  <script>setTimeout(function(){ window.print(); }, 400);<\/script></body></html>`;
  const w = window.open('', '_blank');
  if(!w){ toast('Разрешите всплывающие окна для сайта', true); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

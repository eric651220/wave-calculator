const CONFIG = {
    ratios: {
        up: [0.236, 0.382, 0.5, 0.618, 1.0, 1.272, 1.382, 1.618, 2.0, 2.618, 4.236],
        down: [0.236, 0.382, 0.5, 0.618, 0.764, 1.0, 1.272, 1.618, 2.0, 2.618],
        nWave: [0.618, 1.0, 1.272, 1.618, 2.0, 2.618, 4.236]
    },
    labelsN: { 0.618: '小N', 1.000: '等浪N', 1.272: '擴展N', 1.618: '大N', 2.000: '雙倍N', 2.618: '巨N' },
    zones: { candidateTolerance: 0.0035, groupTolerance: 0.004 }
};

let waveHistory = [], forcedDirection = null, isBuyMode = true, walletBalance = 1000000;
let tradeState = { avgCost: 0, totalShares: 0, realizedPL: 0 }, tradeLog = [], chartOverlayInfo = null;
let isChartCollapsed = false, currentZones = [], chartMetrics = {}, activeZoneIdx = -1, isFilterActive = true;
let undoTimer = null, isLongPress = false;

function initDateInputs() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('saveEnd').value = today;
    document.getElementById('saveStart').value = today;
}

function openSaveModal() {
    if (waveHistory.length < 2) return alert("請至少輸入 P0 與 P1");
    triggerHaptic(); initDateInputs();
    document.getElementById('saveModal').style.display = 'flex';
}

function closeSaveModal() { document.getElementById('saveModal').style.display = 'none'; }

function saveRecord() {
    const symbol = document.getElementById('saveSymbol').value.trim() || "未命名";
    const record = { id: Date.now(), symbol: symbol.toUpperCase(), startDate: document.getElementById('saveStart').value, endDate: document.getElementById('saveEnd').value, data: [...waveHistory], p0: waveHistory[0], p1: waveHistory[1], lastPrice: waveHistory[waveHistory.length - 1], timestamp: new Date().toLocaleString() };
    let list = JSON.parse(localStorage.getItem('fib_history') || '[]');
    list.unshift(record); localStorage.setItem('fib_history', JSON.stringify(list));
    closeSaveModal(); renderHistoryList(); switchTab('ext');
}

function exportJSON() {
    const raw = localStorage.getItem('fib_history');
    if (!raw || raw === '[]') return alert("無紀錄");
    const blob = new Blob([raw], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `波浪戰情室_全備份_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
}

function triggerImport() { document.getElementById('importFile').click(); }
function handleImport(input) {
    const reader = new FileReader();
    reader.onload = (e) => {
        localStorage.setItem('fib_history', e.target.result);
        renderHistoryList(); alert("匯入成功");
    };
    reader.readAsText(input.files[0]);
}

function renderHistoryList() {
    const listEl = document.getElementById('historyList');
    const saved = JSON.parse(localStorage.getItem('fib_history') || '[]');
    listEl.innerHTML = saved.length ? saved.map(rec => `
        <div class="rec-card">
            <div style="display:flex; justify-content:space-between"><strong>${rec.symbol}</strong><small>${rec.startDate}</small></div>
            <div style="font-size:12px; color:gray">P0: ${rec.p0} | P1: ${rec.p1} | 現價: ${rec.lastPrice}</div>
            <div style="text-align:right">
                <button onclick="deleteRecord(${rec.id})" style="color:red">刪除</button>
                <button onclick="loadRecord(${rec.id})">載入</button>
            </div>
        </div>`).join('') : '<div style="text-align:center; padding:20px">尚未儲存</div>';
}

function deleteRecord(id) {
    let list = JSON.parse(localStorage.getItem('fib_history') || '[]');
    localStorage.setItem('fib_history', JSON.stringify(list.filter(r => r.id !== id)));
    renderHistoryList();
}

function loadRecord(id) {
    const rec = JSON.parse(localStorage.getItem('fib_history')).find(r => r.id === id);
    resetAll(true); waveHistory = [...rec.data];
    chartOverlayInfo = { symbol: rec.symbol, range: `${rec.startDate} ~ ${rec.endDate}` };
    updateUI(); updateDashboard(waveHistory[waveHistory.length-1]); drawChart(); switchTab('home');
}

function toggleMenu() {
    document.getElementById('navDrawer').classList.toggle('open');
    document.getElementById('drawerOverlay').classList.toggle('open');
}

function switchTab(tab) {
    document.getElementById('navDrawer').classList.remove('open');
    document.getElementById('drawerOverlay').classList.remove('open');
    document.querySelectorAll('.drawer-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`menu-${tab}`).classList.add('active');
    document.querySelectorAll('.workspace, .page-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    if (tab === 'home') drawChart(); else renderHistoryList();
}

function formatVal(v, d=2) { return (v===null || isNaN(v)) ? "---" : Number(v).toLocaleString('en-US',{minimumFractionDigits:d, maximumFractionDigits:d}); }
function triggerHaptic() { if(navigator.vibrate) navigator.vibrate(10); }
function toggleTheme() { document.body.classList.toggle('light-theme'); drawChart(); }

function toggleFilterMode() {
    isFilterActive = !isFilterActive;
    document.getElementById('btnFilter').classList.toggle('active');
    renderSmartList();
}

function toggleChartVisibility() {
    isChartCollapsed = !isChartCollapsed;
    document.getElementById('chart-container').classList.toggle('collapsed');
    if(!isChartCollapsed) setTimeout(drawChart, 300);
}

function toggleTradeMode() {
    isBuyMode = !isBuyMode;
    const btn = document.getElementById('tradeToggle');
    btn.className = isBuyMode ? 'tm-toggle is-buy' : 'tm-toggle is-sell';
    btn.innerText = isBuyMode ? '買' : '賣';
    updateEst();
}

function updateEst() {
    const shares = parseFloat(document.getElementById('vAmt').value);
    const price = parseFloat(document.getElementById('vNext').value) || waveHistory[waveHistory.length-1] || 0;
    document.getElementById('estAmount').innerText = (shares > 0 && price > 0) ? `${isBuyMode?'需':'回'} $${Math.round(shares*price).toLocaleString()}` : '';
}

function executeTrade(price) {
    const shares = Math.floor(parseFloat(document.getElementById('vAmt').value)) || 0;
    if (shares <= 0) return;
    tradeLog.push(JSON.parse(JSON.stringify({wallet: walletBalance, state: tradeState})));
    const cost = shares * price;
    if (isBuyMode) {
        if (cost > walletBalance) return alert("錢包不足");
        tradeState.avgCost = (tradeState.avgCost * tradeState.totalShares + cost) / (tradeState.totalShares + shares);
        tradeState.totalShares += shares; walletBalance -= cost;
    } else {
        const profit = (price - tradeState.avgCost) * Math.min(shares, tradeState.totalShares);
        tradeState.realizedPL += profit; tradeState.totalShares = Math.max(0, tradeState.totalShares - shares);
        walletBalance += shares * price;
    }
    document.getElementById('totalCap').value = Math.round(walletBalance);
    updateDashboard(price);
}

function updateDashboard(p) {
    document.getElementById('dispCost').innerText = formatVal(tradeState.avgCost);
    document.getElementById('dispShares').innerText = formatVal(tradeState.totalShares, 1);
    const rEl = document.getElementById('dispRealized');
    rEl.innerText = Math.round(tradeState.realizedPL).toLocaleString();
    rEl.className = 'ic-val ' + (tradeState.realizedPL>=0?'pl-win':'pl-loss');
    const pEl = document.getElementById('dispPL');
    const ur = tradeState.totalShares > 0 ? Math.round((p - tradeState.avgCost) * tradeState.totalShares) : 0;
    pEl.innerText = ur.toLocaleString(); pEl.className = 'ic-val ' + (ur>=0?'pl-win':'pl-loss');
}

function adjustVal(id, step) {
    const el = document.getElementById(id); if(el.disabled) return;
    let v = (parseFloat(el.value) || 0) + step;
    el.value = v.toFixed(v % 1 === 0 ? 0 : 2);
    if(id === 'vNext') onNextInput(); else checkInitState();
}

function checkInitState() {
    const p0 = parseFloat(document.getElementById('vRefA').value), p1 = parseFloat(document.getElementById('vRefB').value);
    if (!isNaN(p0) && !isNaN(p1)) {
        document.getElementById('btnLock').classList.remove('disabled');
        drawWaveChart([p0, p1]);
    }
}

function onNextInput() {
    const v = parseFloat(document.getElementById('vNext').value);
    if (!isNaN(v)) { document.getElementById('btnLock').classList.remove('disabled'); drawChart(v); updateDashboard(v); }
    updateEst();
}

function confirmNextWave() {
    if (waveHistory.length === 0) {
        const p0 = parseFloat(document.getElementById('vRefA').value), p1 = parseFloat(document.getElementById('vRefB').value);
        executeTrade(p1); waveHistory.push(p0, p1);
        document.getElementById('vRefA').disabled = document.getElementById('vRefB').disabled = true;
    } else {
        const v = parseFloat(document.getElementById('vNext').value);
        executeTrade(v); waveHistory.push(v); document.getElementById('vNext').value = '';
    }
    updateUI();
}

function resetAll(s=false) {
    if(!s && !confirm("確定重置？")) return;
    waveHistory = []; tradeLog = []; tradeState = {avgCost:0, totalShares:0, realizedPL:0};
    document.getElementById('vRefA').disabled = document.getElementById('vRefB').disabled = false;
    document.getElementById('vRefA').value = document.getElementById('vRefB').value = '';
    document.getElementById('vNext').disabled = true; updateUI(); drawChart();
}

function handleUndoPress(e) { e.preventDefault(); isLongPress = false; undoTimer = setTimeout(() => { isLongPress = true; showHistoryMenu(); }, 600); }
function handleUndoRelease(e) { e.preventDefault(); clearTimeout(undoTimer); if(!isLongPress) undoLast(); }
function undoLast() {
    if (waveHistory.length <= 2) return resetAll(true);
    const s = tradeLog.pop(); walletBalance = s.wallet; tradeState = s.state;
    waveHistory.pop(); updateUI(); drawChart();
}

function updateUI() {
    const len = waveHistory.length;
    if (len >= 2) {
        document.getElementById('vNext').disabled = false;
        document.getElementById('box-next').style.opacity = "1";
        renderSmartList();
    }
}

function renderSmartList() {
    const last = waveHistory[waveHistory.length-1], prev = waveHistory[waveHistory.length-2], diff = Math.abs(last-prev);
    const dir = forcedDirection || (last > prev ? 'down' : 'up');
    let cands = CONFIG.ratios[dir].map(r => ({ p: dir==='up'?last+diff*r:last-diff*r, desc: `${dir==='up'?'漲':'跌'}${r}`, type: dir==='up'?'up':'down' }));
    currentZones = generateZones(cands, CONFIG.zones.candidateTolerance);
    document.getElementById('smartHeader').style.display = 'flex';
    document.getElementById('headerTitle').innerText = dir==='up' ? '▲ 看漲' : '▼ 看跌';
    document.getElementById('list').innerHTML = currentZones.map((z, i) => `
        <div class="card ${z.score>2?'high-prob':''}" onclick="setNextVal(${z.center})">
            <div class="price-text">${formatVal(z.center)}</div>
            <div style="font-size:10px">${z.labels.join(', ')}</div>
        </div>`).join('');
    drawChart();
}

function generateZones(pts, tol) {
    pts.sort((a,b) => b.p - a.p);
    let zones = [], curr = [pts[0]];
    for(let i=1; i<pts.length; i++) {
        if(Math.abs(pts[i].p - curr[0].p)/curr[0].p <= tol) curr.push(pts[i]);
        else { zones.push(processCluster(curr)); curr = [pts[i]]; }
    }
    if(curr.length) zones.push(processCluster(curr));
    return zones;
}

function processCluster(c) {
    const mid = (Math.max(...c.map(x=>x.p)) + Math.min(...c.map(x=>x.p)))/2;
    return { center: mid, labels: c.map(x=>x.desc), score: c.length };
}

function setNextVal(v) { document.getElementById('vNext').value = v.toFixed(2); onNextInput(); }

function drawChart(ghost = null) {
    const svg = document.getElementById('waveChart'), w = svg.clientWidth, h = svg.clientHeight;
    let data = [...waveHistory]; if(ghost) data.push(ghost);
    if(data.length < 1) return;
    const min = Math.min(...data) * 0.95, max = Math.max(...data) * 1.05, range = max - min;
    const getY = (v) => h - ((v - min) / range * h);
    const getX = (i) => (i / (data.length - 1 || 1)) * w;
    const d = data.map((v, i) => `${i===0?'M':'L'} ${getX(i)} ${getY(v)}`).join(' ');
    document.getElementById('wavePath').setAttribute('d', d);
    document.getElementById('dotsGroup').innerHTML = data.map((v, i) => `<circle cx="${getX(i)}" cy="${getY(v)}" r="4" class="chart-dot"></circle>`).join('');
}

function setupChartEvents() {
    const container = document.getElementById('chart-container');
    container.addEventListener('mousemove', (e) => {
        if(!waveHistory.length) return;
        const rect = container.getBoundingClientRect(), y = e.clientY - rect.top;
        const min = Math.min(...waveHistory) * 0.95, max = Math.max(...waveHistory) * 1.05;
        const p = max - (y / rect.height) * (max - min);
        document.getElementById('crosshairGroup').style.display = 'block';
        document.getElementById('crosshairH').setAttribute('y1', y);
        document.getElementById('crosshairH').setAttribute('y2', y);
        document.getElementById('tooltipText').textContent = formatVal(p);
    });
}

setupChartEvents();
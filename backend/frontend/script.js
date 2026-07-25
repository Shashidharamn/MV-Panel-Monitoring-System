
// =====================================
// MV PANEL MONITORING SYSTEM
// script.js
// =====================================
 
const API_BASE = "http://127.0.0.1:8000";
 
// ================================
// Settings (persisted in localStorage — this is a real
// standalone site, not a sandboxed preview, so this is fine)
// ================================
 
const SETTINGS_KEY = "mvpanel_settings";
 
function loadSettings() {
    try {
        return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch {
        return {};
    }
}
 
function saveSettings(patch) {
    const current = loadSettings();
    const updated = { ...current, ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    return updated;
}
 
let settings = {
    refreshInterval: 5000,
    theme: "dark",
    thresholds: { vmin: 200, vmax: 260, imax: 100 },
    ...loadSettings()
};
 
// Apply theme immediately on load
document.documentElement.setAttribute("data-theme", settings.theme);
 
 
// ================================
// Live Clock
// ================================
 
function updateClock() {
    document.getElementById("clock").innerHTML = new Date().toLocaleString();
}
 
setInterval(updateClock, 1000);
updateClock();
 
 
// ================================
// Nav Bar / View Switching
// ================================
 
const navLinks = document.querySelectorAll(".nav-link");
const views = document.querySelectorAll(".view");
 
navLinks.forEach(link => {
    link.addEventListener("click", () => {
        navLinks.forEach(l => l.classList.remove("active"));
        views.forEach(v => v.classList.remove("active"));
 
        link.classList.add("active");
        document.getElementById(link.dataset.view).classList.add("active");
 
        if (link.dataset.view === "historical-view" && historyBuffer.length === 0) {
            setQuickRange("today");
        }
    });
});
 
 
// ================================
// Metric definitions (used by both charts)
// ================================
 
const METRICS = {
    voltage: [
        { key: "vr", label: "VR", color: "#00ffff" },
        { key: "vy", label: "VY", color: "#00ff99" },
        { key: "vb", label: "VB", color: "#ff9900" }
    ],
    current: [
        { key: "ir", label: "IR", color: "#00ffff" },
        { key: "iy", label: "IY", color: "#00ff99" }
    ],
    power: [
        { key: "power_r", label: "Power R", color: "#00ffff" },
        { key: "power_y", label: "Power Y", color: "#ff9900" }
    ],
    frequency: [
        { key: "frequency", label: "Frequency", color: "#00ffff" }
    ],
    pf: [
        { key: "pf_r", label: "PF R", color: "#00ffff" },
        { key: "pf_y", label: "PF Y", color: "#00ff99" },
        { key: "pf_b", label: "PF B", color: "#ff9900" },
        { key: "pf_total", label: "PF Total", color: "#ff5566" }
    ],
    earth_current: [] // no backend field yet
};
 
function buildDatasets(metricKey) {
    return (METRICS[metricKey] || []).map(m => ({
        label: m.label, data: [], borderColor: m.color,
        backgroundColor: m.color + "33", fill: false,
        tension: 0.35, borderWidth: 2, pointRadius: 2
    }));
}
 
function renderChart(chart, metricKey, buffer) {
    const defs = METRICS[metricKey] || [];
 
    chart.data.labels = buffer.map(r => r.time);
    chart.data.datasets = defs.map(m => ({
        label: m.label,
        data: buffer.map(r => r[m.key] ?? null),
        borderColor: m.color,
        backgroundColor: m.color + "33",
        fill: false,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 2
    }));
 
    chart.update();
}
 
 
// ================================
// Live Chart
// ================================
 
const liveChart = new Chart(document.getElementById("liveChart"), {
    type: "line",
    data: { labels: [], datasets: buildDatasets("voltage") },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: false } } }
});
 
let liveBuffer = [];
const LIVE_BUFFER_MAX = 40;
 
document.getElementById("live-param").addEventListener("change", (e) => {
    renderChart(liveChart, e.target.value, liveBuffer);
});
 
document.getElementById("download-live-graph").addEventListener("click", () => {
    downloadChartImage(liveChart, "live-trend");
});
 
// Live "Time Interval" controls how often we poll /latest
document.getElementById("live-interval").addEventListener("change", (e) => {
    restartPolling(parseInt(e.target.value, 10) * 1000);
});
 
 
// ================================
// Historical Chart
// ================================
 
const historyChart = new Chart(document.getElementById("historyChart"), {
    type: "line",
    data: { labels: [], datasets: buildDatasets("voltage") },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: false } } }
});
 
let historyBuffer = [];
 
document.getElementById("hist-param").addEventListener("change", (e) => {
    renderChart(historyChart, e.target.value, historyBuffer);
});
 
document.getElementById("download-history-graph").addEventListener("click", () => {
    downloadChartImage(historyChart, "historical-trend");
});
 
function downloadChartImage(chart, filename) {
    const link = document.createElement("a");
    link.href = chart.toBase64Image();
    link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
}
 
 
// ================================
// System Status Helpers
// ================================
 
function setStatus(dotId, textId, state, text) {
    const dot = document.getElementById(dotId);
    const label = document.getElementById(textId);
 
    dot.classList.remove("online", "offline", "warning");
    if (state) dot.classList.add(state);
 
    label.innerHTML = text;
}
 
 
// ================================
// Session Summary Tracking
// ================================
 
const session = {
    maxVoltage: -Infinity,
    maxCurrent: -Infinity,
    energyKwh: 0,
    lastSampleTime: null
};
 
function updateSummary(data) {
    const maxV = Math.max(data.vr, data.vy, data.vb);
    const maxI = Math.max(data.ir, data.iy);
 
    if (maxV > session.maxVoltage) session.maxVoltage = maxV;
    if (maxI > session.maxCurrent) session.maxCurrent = maxI;
 
    // Rough energy estimate: integrate (power_r + power_y) in kW over elapsed seconds
    const now = Date.now();
    if (session.lastSampleTime) {
        const hours = (now - session.lastSampleTime) / 3600000;
        const kw = (data.power_r || 0) + (data.power_y || 0);
        if (kw > 0) session.energyKwh += kw * hours;
    }
    session.lastSampleTime = now;
 
    document.getElementById("sum-max-voltage").innerHTML = session.maxVoltage.toFixed(2) + " V";
    document.getElementById("sum-max-current").innerHTML = session.maxCurrent.toFixed(2) + " A";
    document.getElementById("sum-energy").innerHTML = session.energyKwh.toFixed(2) + " kWh";
 
    const health = data.status === "OK" ? "Good" : data.status === "DEGRADED" ? "Warning" : "Critical";
    document.getElementById("sum-health").innerHTML = health;
}
 
 
// ================================
// Threshold-based Alarms (client-side, using Settings values)
// ================================
 
function checkThresholdAlarms(data) {
    const t = settings.thresholds;
    const alarms = [];
 
    [["VR", data.vr], ["VY", data.vy], ["VB", data.vb]].forEach(([label, v]) => {
        if (v > 0 && (v < t.vmin || v > t.vmax)) {
            alarms.push(`${label} out of range (${v.toFixed(1)} V, limits ${t.vmin}-${t.vmax} V)`);
        }
    });
 
    [["IR", data.ir], ["IY", data.iy]].forEach(([label, i]) => {
        if (i > t.imax) {
            alarms.push(`${label} overcurrent (${i.toFixed(1)} A, limit ${t.imax} A)`);
        }
    });
 
    return alarms;
}
 
 
// ================================
// Alarms
// ================================
 
function updateAlarms(data) {
    const grid = document.getElementById("alarm-grid");
    const alarms = [];
 
    if (data.status === "ERROR") {
        alarms.push(`Communication Error${data.error_message ? " — " + data.error_message : ""}`);
    } else if (data.status === "DEGRADED") {
        alarms.push(`Partial Communication Error${data.error_message ? " — " + data.error_message : ""}`);
    }
 
    alarms.push(...checkThresholdAlarms(data));
 
    const sumAlarm = document.getElementById("sum-alarm");
 
    if (alarms.length === 0) {
        grid.innerHTML = `<div class="alarm-card ok" id="alarm-none"><span class="alarm-icon">✔</span><span>No Active Alarm</span></div>`;
        sumAlarm.innerHTML = "None";
        return;
    }
 
    grid.innerHTML = alarms.map(a => `
        <div class="alarm-card active"><span class="alarm-icon">⚠</span><span>${a}</span></div>
    `).join("");
 
    sumAlarm.innerHTML = alarms.length === 1 ? alarms[0] : `${alarms.length} active`;
}
 
 
// ================================
// Load Latest Data (live view)
// ================================
 
async function loadLatestData() {
 
    let data;
 
    try {
        const response = await fetch(`${API_BASE}/latest`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
 
        setStatus("dot-backend", "status-backend", "online", "Online");
        setStatus("dot-db", "status-db", "online", "Reachable (via backend)");
 
    } catch (error) {
        console.log(error);
 
        setStatus("dot-backend", "status-backend", "offline", "Unreachable");
        setStatus("dot-db", "status-db", "offline", "Unknown");
        setStatus("dot-esp32", "status-esp32", "offline", "Unknown");
        setStatus("dot-relay", "status-relay", "offline", "Not connected");
        return;
    }
 
    const espState = data.status === "OK" ? "online" : data.status === "DEGRADED" ? "warning" : "offline";
    setStatus("dot-esp32", "status-esp32", espState, data.status || "Unknown");
    setStatus("dot-relay", "status-relay", null, "Not connected");
 
    document.getElementById("vr").innerHTML = Number(data.vr).toFixed(2) + " V";
    document.getElementById("vy").innerHTML = Number(data.vy).toFixed(2) + " V";
    document.getElementById("vb").innerHTML = Number(data.vb).toFixed(2) + " V";
 
    document.getElementById("ir").innerHTML = Number(data.ir).toFixed(2) + " A";
    document.getElementById("iy").innerHTML = Number(data.iy).toFixed(2) + " A";
    document.getElementById("ib").innerHTML = "Pending...";
 
    document.getElementById("frequency").innerHTML = Number(data.frequency).toFixed(2) + " Hz";
 
    document.getElementById("pf_r").innerHTML = Number(data.pf_r).toFixed(2);
    document.getElementById("pf_y").innerHTML = Number(data.pf_y).toFixed(2);
    document.getElementById("pf_b").innerHTML = Number(data.pf_b).toFixed(2);
    document.getElementById("pf_total").innerHTML = Number(data.pf_total).toFixed(2);
 
    document.getElementById("power_r").innerHTML = Number(data.power_r).toFixed(2) + " kW";
    document.getElementById("power_y").innerHTML = Number(data.power_y).toFixed(2) + " kW";
 
    // Relay fields — all pending until relay integration exists
    ["setting_group", "phase_pickup", "earth_pickup", "relay_datetime",
     "relay_event", "relay_opcount", "relay_thermal", "relay_negseq", "relay_comm"]
        .forEach(id => document.getElementById(id).innerHTML = "Pending...");
 
    document.getElementById("oc_r").innerHTML = "Normal";
    document.getElementById("oc_y").innerHTML = "Normal";
    document.getElementById("oc_b").innerHTML = "Normal";
    document.getElementById("earth_fault").innerHTML = "Normal";
 
    updateSummary(data);
    updateAlarms(data);
 
    const time = new Date().toLocaleTimeString();
    liveBuffer.push({
        time, vr: data.vr, vy: data.vy, vb: data.vb, ir: data.ir, iy: data.iy,
        power_r: data.power_r, power_y: data.power_y, frequency: data.frequency,
        pf_r: data.pf_r, pf_y: data.pf_y, pf_b: data.pf_b, pf_total: data.pf_total
    });
 
    if (liveBuffer.length > LIVE_BUFFER_MAX) liveBuffer.shift();
 
    renderChart(liveChart, document.getElementById("live-param").value, liveBuffer);
}
 
 
// ================================
// Polling control (Settings > Refresh Interval / Live > Time Interval)
// ================================
 
let pollTimer = null;
 
function restartPolling(intervalMs) {
    if (pollTimer) clearInterval(pollTimer);
    loadLatestData();
    pollTimer = setInterval(loadLatestData, intervalMs);
}
 
restartPolling(settings.refreshInterval);
 
 
// ================================
// Historical Data Filter
// ================================
 
function fmtDate(d) { return d.toISOString().slice(0, 10); }
 
function computeDateRange(rangeKey) {
    const today = new Date();
    let from, to;
 
    switch (rangeKey) {
        case "today": from = to = fmtDate(today); break;
        case "yesterday": {
            const y = new Date(today); y.setDate(y.getDate() - 1);
            from = to = fmtDate(y); break;
        }
        case "7d": {
            const s = new Date(today); s.setDate(s.getDate() - 6);
            from = fmtDate(s); to = fmtDate(today); break;
        }
        case "30d": {
            const s = new Date(today); s.setDate(s.getDate() - 29);
            from = fmtDate(s); to = fmtDate(today); break;
        }
        default:
            from = document.getElementById("from-date").value;
            to = document.getElementById("to-date").value;
    }
    return { from, to };
}
 
function setQuickRange(rangeKey) {
    const { from, to } = computeDateRange(rangeKey);
    document.getElementById("from-date").value = from;
    document.getElementById("to-date").value = to;
    applyHistoryFilter();
}
 
document.querySelectorAll(".btn-quick").forEach(btn => {
    btn.addEventListener("click", () => setQuickRange(btn.dataset.range));
});
 
function fmtNum(v) {
    return v === undefined || v === null || isNaN(v) ? "-" : Number(v).toFixed(2);
}
 
async function applyHistoryFilter() {
    const from = document.getElementById("from-date").value;
    const to = document.getElementById("to-date").value;
    const interval = document.getElementById("hist-interval").value;
 
    if (!from || !to) {
        alert("Please choose both a From and To date.");
        return;
    }
 
    const tbody = document.getElementById("history-table-body");
    tbody.innerHTML = `<tr><td colspan="12" class="empty-row">Loading...</td></tr>`;
 
    try {
        const response = await fetch(`${API_BASE}/history?from=${from}&to=${to}&interval=${interval}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
 
        const rows = await response.json();
 
        if (!Array.isArray(rows) || rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="12" class="empty-row">No records found for this range.</td></tr>`;
            historyBuffer = [];
            renderChart(historyChart, document.getElementById("hist-param").value, historyBuffer);
            return;
        }
 
        historyBuffer = rows.map(r => ({
            time: r.timestamp, vr: r.vr, vy: r.vy, vb: r.vb, ir: r.ir, iy: r.iy,
            power_r: r.power_r, power_y: r.power_y, frequency: r.frequency,
            pf_r: r.pf_r, pf_y: r.pf_y, pf_b: r.pf_b, pf_total: r.pf_total
        }));
 
        renderChart(historyChart, document.getElementById("hist-param").value, historyBuffer);
 
        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${r.timestamp ?? "-"}</td>
                <td>${fmtNum(r.vr)}</td>
                <td>${fmtNum(r.vy)}</td>
                <td>${fmtNum(r.vb)}</td>
                <td>${fmtNum(r.ir)}</td>
                <td>${fmtNum(r.iy)}</td>
                <td>${r.ib !== undefined ? fmtNum(r.ib) : "Pending"}</td>
                <td>${fmtNum(r.frequency)}</td>
                <td>${fmtNum(r.pf_total)}</td>
                <td>${fmtNum((r.power_r ?? 0) + (r.power_y ?? 0))}</td>
                <td>${r.earth_current !== undefined ? fmtNum(r.earth_current) : "Pending"}</td>
                <td>${r.alarm_status ?? (r.status && r.status !== "OK" ? r.status : "Normal")}</td>
            </tr>
        `).join("");
 
    } catch (error) {
        console.log(error);
        tbody.innerHTML = `<tr><td colspan="12" class="empty-row">Could not load history — the /history endpoint isn't available on the backend yet.</td></tr>`;
        historyBuffer = [];
        renderChart(historyChart, document.getElementById("hist-param").value, historyBuffer);
    }
}
 
document.getElementById("apply-filter").addEventListener("click", applyHistoryFilter);
document.getElementById("refresh-history").addEventListener("click", applyHistoryFilter);
 
document.getElementById("reset-filter").addEventListener("click", () => {
    document.getElementById("from-date").value = "";
    document.getElementById("to-date").value = "";
 
    historyBuffer = [];
    renderChart(historyChart, document.getElementById("hist-param").value, historyBuffer);
 
    document.getElementById("history-table-body").innerHTML =
        `<tr><td colspan="12" class="empty-row">No data loaded — choose a date range and click Apply Filter</td></tr>`;
});
 
 
// ================================
// Export CSV (history table)
// ================================
 
document.getElementById("export-csv").addEventListener("click", () => {
    const table = document.getElementById("history-table");
    const rows = Array.from(table.querySelectorAll("tr"));
 
    if (rows.length <= 1) {
        alert("No historical data to export yet — apply a filter first.");
        return;
    }
 
    const csv = rows.map(row =>
        Array.from(row.querySelectorAll("th, td"))
            .map(cell => `"${cell.textContent.trim().replace(/"/g, '""')}"`)
            .join(",")
    ).join("\n");
 
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mv-panel-history-${document.getElementById("from-date").value || "export"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
});
 
 
// ================================
// Reports (needs backend aggregation endpoint)
// ================================
 
document.getElementById("generate-report").addEventListener("click", async () => {
    const type = document.getElementById("report-type").value;
    const output = document.getElementById("report-output");
 
    output.innerHTML = "Loading...";
 
    try {
        const response = await fetch(`${API_BASE}/reports/${type}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const report = await response.json();
        output.innerHTML = `<pre>${JSON.stringify(report, null, 2)}</pre>`;
    } catch (error) {
        console.log(error);
        output.innerHTML = `This needs a backend endpoint at <code>/reports/${type}</code> that doesn't exist yet. Once it returns data, this panel will render it automatically.`;
    }
});
 
document.getElementById("report-export-csv").addEventListener("click", () => {
    alert("Export CSV for reports will work once /reports/<type> is returning data.");
});
 
document.getElementById("report-export-pdf").addEventListener("click", () => {
    // Simple, dependency-free approach: use the browser's print-to-PDF on the report output.
    window.print();
});
 
 
// ================================
// Settings
// ================================
 
const refreshSelect = document.getElementById("setting-refresh");
const themeSelect = document.getElementById("setting-theme");
 
refreshSelect.value = String(settings.refreshInterval);
themeSelect.value = settings.theme;
document.getElementById("th-vmin").value = settings.thresholds.vmin;
document.getElementById("th-vmax").value = settings.thresholds.vmax;
document.getElementById("th-imax").value = settings.thresholds.imax;
 
refreshSelect.addEventListener("change", (e) => {
    const ms = parseInt(e.target.value, 10);
    settings = saveSettings({ refreshInterval: ms });
    restartPolling(ms);
});
 
themeSelect.addEventListener("change", (e) => {
    settings = saveSettings({ theme: e.target.value });
    document.documentElement.setAttribute("data-theme", e.target.value);
});
 
document.getElementById("save-thresholds").addEventListener("click", () => {
    const thresholds = {
        vmin: parseFloat(document.getElementById("th-vmin").value) || 0,
        vmax: parseFloat(document.getElementById("th-vmax").value) || 0,
        imax: parseFloat(document.getElementById("th-imax").value) || 0
    };
    settings = saveSettings({ thresholds });
    alert("Alarm thresholds saved.");
});
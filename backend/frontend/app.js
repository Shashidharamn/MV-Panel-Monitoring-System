/* ==========================================================================
   Substation & Power Quality Live Dashboard - Script
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. CONFIGURATION & STATE MANAGEMENT
// --------------------------------------------------------------------------

const API_BASE_URL = "https://mv-panel-monitoring-system-qobz.onrender.com";
const LATEST_ENDPOINT = `${API_BASE_URL}/latest`;
const HISTORY_ENDPOINT = `${API_BASE_URL}/history`;

// Customer Accounts & Assigned Panels Configuration (Frontend Auth Demo)
const customerAccounts = {
  "CUST001": {
    panels: ["PANEL001", "PANEL002", "PANEL003"]
  },
  "CUST002": {
    panels: ["PANEL003"]
  }
};

let currentCustomer = null;   // Active logged-in customer ID (e.g. "CUST001")
let selectedPanelId = null;   // Active selected panel ID (e.g. "PANEL001")
let livePollingInterval = null;

// Telemetry & Chart State
let telemetryChartInstance = null;
let activeChartTab = "telemetry";
let chartHistoryData = [];
let currentHistoricalRecords = [];

// --------------------------------------------------------------------------
// 2. AUTHENTICATION & VIEW NAVIGATION
// --------------------------------------------------------------------------

function showView(viewId) {
  const views = ['loginView', 'panelSelectView', 'dashboardView'];
  views.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === viewId) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  });
}

function showLoginScreen() {
  stopLivePolling();
  const errorMsg = document.getElementById('loginErrorMessage');
  if (errorMsg) errorMsg.classList.add('hidden');
  showView('loginView');
}

function loginCustomer() {
  const custIdInput = document.getElementById('loginCustomerId');
  const errorMsg = document.getElementById('loginErrorMessage');
  const errorText = document.getElementById('loginErrorText');

  const custId = custIdInput ? custIdInput.value.trim().toUpperCase() : '';

  if (errorMsg) errorMsg.classList.add('hidden');

  if (!custId) {
    if (errorText) errorText.textContent = "Please enter a Customer ID";
    if (errorMsg) errorMsg.classList.remove('hidden');
    return;
  }

  const account = customerAccounts[custId];
  if (account) {
    // Login Successful
    currentCustomer = custId;
    localStorage.setItem('mv_customer_id', custId);
    showPanelSelection();
  } else {
    // Invalid Credentials
    if (errorText) errorText.textContent = "Invalid Customer ID";
    if (errorMsg) errorMsg.classList.remove('hidden');
  }
}

function showPanelSelection() {
  stopLivePolling();
  if (!currentCustomer || !customerAccounts[currentCustomer]) {
    showLoginScreen();
    return;
  }

  const selectCustDisplay = document.getElementById('selectCustomerDisplay');
  if (selectCustDisplay) selectCustDisplay.textContent = currentCustomer;

  const panelSelectList = document.getElementById('panelSelectList');
  if (panelSelectList) {
    panelSelectList.innerHTML = '';
    const assignedPanels = customerAccounts[currentCustomer].panels || [];

    assignedPanels.forEach(panelId => {
      const btn = document.createElement('div');
      btn.className = 'panel-card-btn';
      btn.onclick = () => selectPanel(panelId);
      btn.innerHTML = `
        <i class="fa-solid fa-microchip"></i>
        <span class="panel-card-name">${panelId}</span>
        <span class="panel-card-status"><i class="fa-solid fa-circle-check"></i> Select Panel</span>
      `;
      panelSelectList.appendChild(btn);
    });
  }

  showView('panelSelectView');
}

function selectPanel(panelId) {
  if (!currentCustomer || !customerAccounts[currentCustomer]) {
    showLoginScreen();
    return;
  }

  const assignedPanels = customerAccounts[currentCustomer].panels || [];
  if (!assignedPanels.includes(panelId)) {
    alert(`Access Denied: ${panelId} is not assigned to customer ${currentCustomer}`);
    return;
  }

  selectedPanelId = panelId;
  localStorage.setItem('mv_panel_id', panelId);

  // Update Header UI
  const headerCustomer = document.getElementById('headerCustomer');
  const headerPanel = document.getElementById('headerPanel');
  const histPanelBadge = document.getElementById('histPanelFilterBadge');

  if (headerCustomer) headerCustomer.textContent = currentCustomer;
  if (headerPanel) headerPanel.textContent = selectedPanelId;
  if (histPanelBadge) histPanelBadge.textContent = selectedPanelId;

  // Clear previous metrics & chart buffer
  chartHistoryData = [];
  clearDashboardMetrics();
  initTelemetryChart();

  showView('dashboardView');
  startLivePolling();
}

function changePanel() {
  stopLivePolling();
  showPanelSelection();
}

function logoutCustomer() {
  stopLivePolling();
  currentCustomer = null;
  selectedPanelId = null;
  localStorage.removeItem('mv_customer_id');
  localStorage.removeItem('mv_panel_id');
  showLoginScreen();
}

// --------------------------------------------------------------------------
// 3. LIVE POLLING & API REQUEST HANDLING
// --------------------------------------------------------------------------

function startLivePolling() {
  stopLivePolling();
  if (!selectedPanelId) return;

  fetchLatestData();
  livePollingInterval = setInterval(fetchLatestData, 2000);
}

function stopLivePolling() {
  if (livePollingInterval) {
    clearInterval(livePollingInterval);
    livePollingInterval = null;
  }
}

async function fetchLatestData() {
  if (!selectedPanelId) return;

  const url = `${LATEST_ENDPOINT}?panel_id=${encodeURIComponent(selectedPanelId)}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      updateConnectionStatus(false, "Offline");
      showNoDataAlert(selectedPanelId);
      clearDashboardMetrics();
      return;
    }

    const data = await response.json();

    // Verify if response contains valid telemetry object
    if (!data || Object.keys(data).length === 0 || data.detail) {
      updateConnectionStatus(true, "Online (No Data)");
      showNoDataAlert(selectedPanelId);
      clearDashboardMetrics();
      return;
    }

    // Valid data received
    hideNoDataAlert();
    updateConnectionStatus(true, "Online");
    processTelemetryData(data);

  } catch (error) {
    console.error("API Polling Error:", error);
    updateConnectionStatus(false, "Disconnected");
    showNoDataAlert(selectedPanelId);
    clearDashboardMetrics();
  }
}

function updateConnectionStatus(isOnline, textStatus) {
  const statusContainer = document.getElementById('connectionStatus');
  const statusText = document.getElementById('statusText');
  if (!statusContainer || !statusText) return;

  statusText.textContent = textStatus || (isOnline ? "Online" : "Disconnected");

  const dot = statusContainer.querySelector('.status-dot');
  if (dot) {
    dot.className = 'status-dot ' + (isOnline ? 'online' : 'offline');
  }
}

// --------------------------------------------------------------------------
// 4. NO DATA HANDLING & DASHBOARD CLEARING
// --------------------------------------------------------------------------

function showNoDataAlert(panelId) {
  const alertContainer = document.getElementById('alertContainer');
  if (!alertContainer) return;

  // Avoid duplicate no-data alert
  let alertBanner = document.getElementById('noDataAlertBanner');
  if (!alertBanner) {
    alertBanner = document.createElement('div');
    alertBanner.id = 'noDataAlertBanner';
    alertBanner.className = 'alert-banner no-data-alert';
    alertContainer.appendChild(alertBanner);
  }
  alertBanner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> No data available for ${panelId}`;
  alertBanner.classList.remove('hidden');
}

function hideNoDataAlert() {
  const alertBanner = document.getElementById('noDataAlertBanner');
  if (alertBanner) {
    alertBanner.classList.add('hidden');
  }
}

function clearDashboardMetrics() {
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  // Timestamp
  setText('lastUpdated', '--:--:--');

  // Summary Metrics
  setText('sumFreq', '--');
  setText('sumPower', '--');
  setText('sumPF', '--');
  setText('sumAvgV', '--');
  setText('sumTemp', '--');
  setText('sumHum', '--');

  // Relay Section
  setText('relaySG', 'SG1');
  setText('relayIPhasePickup', '-- A');
  setText('relayIEarthPickup', '-- A');
  setText('relayOpCounter', '--');
  setText('relayI1', '--');
  setText('relayI2', '--');
  setText('relayI3', '--');
  setText('relayI0', '--');
  setText('relayNegSeq', '-- A');
  setText('relayThermal', '-- %');

  const thermalBar = document.getElementById('thermalBar');
  if (thermalBar) thermalBar.style.width = '0%';

  setText('pillI1', 'Normal');
  setText('pillI2', 'Normal');
  setText('pillI3', 'Normal');
  setText('pillI0', 'Normal');

  // Fault Banner Reset
  const faultBanner = document.getElementById('faultSummaryBanner');
  const faultIcon = document.getElementById('faultIcon');
  const faultText = document.getElementById('faultSummaryText');
  if (faultBanner) faultBanner.className = 'fault-summary-banner healthy';
  if (faultIcon) faultIcon.className = 'fa-solid fa-circle-check';
  if (faultText) faultText.textContent = 'No Fault Detected';

  // Event Log
  setText('eventType', '--');
  setText('eventSubtype', '--');
  setText('eventTime', '--/--/-- --:--:--');
  setText('relayRtc', '--/--/20-- --:--:--');

  // EMS-01 Meter Section
  setText('meterVR', '-- V');
  setText('meterVY', '-- V');
  setText('meterVB', '-- V');
  setText('meterIR', '--');
  setText('meterIY', '--');
  setText('meterIB', '--');
  setText('meterPFR', '--');
  setText('meterPFY', '--');
  setText('meterPFB', '--');
  setText('meterPR', '--');
  setText('meterPY', '--');
  setText('meterPB', '--');
  setText('meterPFT', '--');
  setText('meterPT', '-- kW');
  setText('meterFreq', '-- Hz');

  // DHT22 Environmental Section
  setText('dhtTemp', '--');
  setText('dhtHum', '--');

  const tempBadge = document.getElementById('tempAlertBadge');
  const humBadge = document.getElementById('humAlertBadge');
  if (tempBadge) tempBadge.classList.add('hidden');
  if (humBadge) humBadge.classList.add('hidden');

  // Fault Record
  setText('frStageStart', 'I1: -- A | I2: -- A | I3: -- A | I0: -- A');
  setText('frStageTrip', 'I1: -- A | I2: -- A | I3: -- A | I0: -- A');
  setText('frStagePost80', 'I1: -- A | I2: -- A | I3: -- A | I0: -- A');
  setText('frStagePost200', 'I1: -- A | I2: -- A | I3: -- A | I0: -- A');
}

// --------------------------------------------------------------------------
// 5. TELEMETRY DATA PROCESSING & UI BINDING
// --------------------------------------------------------------------------

function processTelemetryData(data) {
  if (!data) return;

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = (val !== undefined && val !== null) ? val : '--';
  };

  const hasVal = (v) => (v !== undefined && v !== null);

  // Browser receipt timestamp
  const nowStr = new Date().toLocaleTimeString();
  setText('lastUpdated', nowStr);

  const relay = data.relay || {};
  const meter = data.meter || {};
  const dht = data.dht || {};

  // 1. RELAY PROTECTION (ABB REJ601)
  const sgActive = relay.sg_active;
  setText('relaySG', hasVal(sgActive) ? `SG${sgActive}` : 'SG1');

  const phasePickup = hasVal(relay.pickup_phase) ? Number(relay.pickup_phase) : 1;
  const earthPickup = hasVal(relay.pickup_earth) ? Number(relay.pickup_earth) : 15;

  setText('relayIPhasePickup', hasVal(relay.pickup_phase) ? `${relay.pickup_phase} A` : '-- A');
  setText('relayIEarthPickup', hasVal(relay.pickup_earth) ? `${relay.pickup_earth} A` : '-- A');
  setText('relayOpCounter', hasVal(relay.op_counter) ? relay.op_counter : '--');

  const i1 = hasVal(relay.i1) ? Number(relay.i1) : 0;
  const i2 = hasVal(relay.i2) ? Number(relay.i2) : 0;
  const i3 = hasVal(relay.i3) ? Number(relay.i3) : 0;
  const i0 = hasVal(relay.i0) ? Number(relay.i0) : 0;

  setText('relayI1', hasVal(relay.i1) ? i1.toFixed(2) : '--');
  setText('relayI2', hasVal(relay.i2) ? i2.toFixed(2) : '--');
  setText('relayI3', hasVal(relay.i3) ? i3.toFixed(2) : '--');
  setText('relayI0', hasVal(relay.i0) ? i0.toFixed(2) : '--');

  const negSeq = hasVal(relay.neg_seq) ? Number(relay.neg_seq) : 0;
  const thermalLevel = hasVal(relay.thermal_level) ? Number(relay.thermal_level) : 0;

  setText('relayNegSeq', hasVal(relay.neg_seq) ? `${negSeq.toFixed(2)} A` : '-- A');
  setText('relayThermal', hasVal(relay.thermal_level) ? `${thermalLevel.toFixed(1)} %` : '-- %');

  const thermalBar = document.getElementById('thermalBar');
  if (thermalBar) thermalBar.style.width = `${Math.min(thermalLevel, 100)}%`;

  // Fault Alarm Pills
  updatePill('pillI1', hasVal(relay.i1) && i1 > phasePickup);
  updatePill('pillI2', hasVal(relay.i2) && i2 > phasePickup);
  updatePill('pillI3', hasVal(relay.i3) && i3 > phasePickup);
  updatePill('pillI0', hasVal(relay.i0) && i0 > earthPickup);

  // Live Fault Status Banner (from data.relay.live_fault_status)
  const liveFaultStatus = relay.live_fault_status || "No Fault Detected";
  const faultBanner = document.getElementById('faultSummaryBanner');
  const faultIcon = document.getElementById('faultIcon');
  const faultText = document.getElementById('faultSummaryText');

  if (faultText) faultText.textContent = liveFaultStatus;
  const isFaulted = liveFaultStatus !== "No Fault Detected" && !liveFaultStatus.toLowerCase().includes("normal");

  if (faultBanner) {
    faultBanner.className = 'fault-summary-banner ' + (isFaulted ? 'faulted' : 'healthy');
  }
  if (faultIcon) {
    faultIcon.className = isFaulted ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-check';
  }

  // Event log & RTC
  const evt = relay.event || {};
  setText('eventType', hasVal(evt.type) ? evt.type : '--');
  setText('eventSubtype', hasVal(evt.subtype) ? evt.subtype : '--');
  setText('eventTime', evt.timestamp || '--/--/-- --:--:--');
  setText('relayRtc', relay.rtc || '--/--/20-- --:--:--');

  // 2. EMS-01 POWER QUALITY METER
  const vR = hasVal(meter.v_r) ? Number(meter.v_r) : 0;
  const vY = hasVal(meter.v_y) ? Number(meter.v_y) : 0;
  const vB = hasVal(meter.v_b) ? Number(meter.v_b) : 0;

  const iR = hasVal(meter.i_r) ? Number(meter.i_r) : 0;
  const iY = hasVal(meter.i_y) ? Number(meter.i_y) : 0;
  const iB = hasVal(meter.i_b) ? Number(meter.i_b) : 0;

  const pfR = hasVal(meter.pf_r) ? Number(meter.pf_r) : 1.0;
  const pfY = hasVal(meter.pf_y) ? Number(meter.pf_y) : 1.0;
  const pfB = hasVal(meter.pf_b) ? Number(meter.pf_b) : 1.0;
  const pfT = hasVal(meter.pf_t) ? Number(meter.pf_t) : 1.0;

  const pR = hasVal(meter.p_r) ? Number(meter.p_r) : 0;
  const pY = hasVal(meter.p_y) ? Number(meter.p_y) : 0;
  const pB = hasVal(meter.p_b) ? Number(meter.p_b) : 0;
  const pT = hasVal(meter.p_t) ? Number(meter.p_t) : 0;

  const freq = hasVal(meter.frequency) ? Number(meter.frequency) : 50.0;

  setText('meterVR', hasVal(meter.v_r) ? `${vR.toFixed(1)} V` : '-- V');
  setText('meterVY', hasVal(meter.v_y) ? `${vY.toFixed(1)} V` : '-- V');
  setText('meterVB', hasVal(meter.v_b) ? `${vB.toFixed(1)} V` : '-- V');

  setText('meterIR', hasVal(meter.i_r) ? iR.toFixed(2) : '--');
  setText('meterIY', hasVal(meter.i_y) ? iY.toFixed(2) : '--');
  setText('meterIB', hasVal(meter.i_b) ? iB.toFixed(2) : '--');

  setText('meterPFR', hasVal(meter.pf_r) ? pfR.toFixed(2) : '--');
  setText('meterPFY', hasVal(meter.pf_y) ? pfY.toFixed(2) : '--');
  setText('meterPFB', hasVal(meter.pf_b) ? pfB.toFixed(2) : '--');

  setText('meterPR', hasVal(meter.p_r) ? pR.toFixed(2) : '--');
  setText('meterPY', hasVal(meter.p_y) ? pY.toFixed(2) : '--');
  setText('meterPB', hasVal(meter.p_b) ? pB.toFixed(2) : '--');

  setText('meterPFT', hasVal(meter.pf_t) ? pfT.toFixed(2) : '--');
  setText('meterPT', hasVal(meter.p_t) ? `${pT.toFixed(2)} kW` : '-- kW');
  setText('meterFreq', hasVal(meter.frequency) ? `${freq.toFixed(2)} Hz` : '-- Hz');

  // 3. SYSTEM TELEMETRY SUMMARY CARDS
  const avgV = (hasVal(meter.v_r) && hasVal(meter.v_y) && hasVal(meter.v_b))
    ? (vR + vY + vB) / 3
    : null;

  setText('sumFreq', hasVal(meter.frequency) ? freq.toFixed(2) : '--');
  setText('sumPower', hasVal(meter.p_t) ? pT.toFixed(2) : '--');
  setText('sumPF', hasVal(meter.pf_t) ? pfT.toFixed(2) : '--');
  setText('sumAvgV', avgV !== null ? avgV.toFixed(1) : '--');

  // 4. DHT22 ENVIRONMENTAL DATA
  const temp = hasVal(dht.temperature) ? Number(dht.temperature) : 0;
  const hum = hasVal(dht.humidity) ? Number(dht.humidity) : 0;

  setText('dhtTemp', hasVal(dht.temperature) ? temp.toFixed(1) : '--');
  setText('dhtHum', hasVal(dht.humidity) ? hum.toFixed(1) : '--');

  setText('sumTemp', hasVal(dht.temperature) ? temp.toFixed(1) : '--');
  setText('sumHum', hasVal(dht.humidity) ? hum.toFixed(1) : '--');

  const tempBadge = document.getElementById('tempAlertBadge');
  const humBadge = document.getElementById('humAlertBadge');

  if (tempBadge) {
    if (hasVal(dht.temperature) && temp > 50.0) tempBadge.classList.remove('hidden');
    else tempBadge.classList.add('hidden');
  }
  if (humBadge) {
    if (hasVal(dht.humidity) && hum > 80.0) humBadge.classList.remove('hidden');
    else humBadge.classList.add('hidden');
  }

  // 5. HISTORICAL FAULT RECORD TIMELINE (data.relay.fault_record1)
  const fr = relay.fault_record1 || relay.fault_record_1;
  if (fr) {
    if (fr.at_start_time) setText('frStageStart_time', fr.at_start_time);
    if (fr.at_start) {
      setText('frStageStart', fr.at_start);
    } else if (fr.pre_start) {
      setText('frStageStart', fr.pre_start);
    }

    if (fr.at_trip_time) setText('frStageTrip_time', fr.at_trip_time);
    if (fr.at_trip) setText('frStageTrip', fr.at_trip);
  }

  // 6. UPDATE LIVE TELEMETRY TREND CHARTS
  pushChartPoint(nowStr, { i1, i2, i3, vR, vY, vB, temp, hum });
}

function updatePill(pillId, isAlarm) {
  const pill = document.getElementById(pillId);
  if (!pill) return;

  if (isAlarm) {
    pill.textContent = "ALARM";
    pill.className = "fault-status-pill alarm";
  } else {
    pill.textContent = "NORMAL";
    pill.className = "fault-status-pill";
  }
}

// --------------------------------------------------------------------------
// 6. REAL-TIME TELEMETRY CHARTS (CHART.JS)
// --------------------------------------------------------------------------

function initTelemetryChart() {
  const ctx = document.getElementById('telemetryChart');
  if (!ctx) return;

  if (telemetryChartInstance) {
    telemetryChartInstance.destroy();
  }

  telemetryChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'I1 (Phase 1)', data: [], borderColor: '#f43f5e', tension: 0.3, fill: false },
        { label: 'I2 (Phase 2)', data: [], borderColor: '#eab308', tension: 0.3, fill: false },
        { label: 'I3 (Phase 3)', data: [], borderColor: '#3b82f6', tension: 0.3, fill: false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
      },
      plugins: {
        legend: { labels: { color: '#f1f5f9' } }
      }
    }
  });
}

function pushChartPoint(timestamp, metrics) {
  chartHistoryData.push({ timestamp, ...metrics });
  if (chartHistoryData.length > 20) {
    chartHistoryData.shift();
  }
  renderChartData();
}

function switchChartTab(tabName) {
  activeChartTab = tabName;
  const tabs = ['telemetry', 'voltages', 'climate'];
  tabs.forEach(t => {
    const btn = document.getElementById(`chartTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) {
      if (t === tabName || (t === 'telemetry' && tabName === 'telemetry')) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });
  renderChartData();
}

function renderChartData() {
  if (!telemetryChartInstance) return;

  const labels = chartHistoryData.map(d => d.timestamp);

  if (activeChartTab === 'telemetry') {
    telemetryChartInstance.data.labels = labels;
    telemetryChartInstance.data.datasets = [
      { label: 'I1 Current (A)', data: chartHistoryData.map(d => d.i1), borderColor: '#f43f5e', tension: 0.3 },
      { label: 'I2 Current (A)', data: chartHistoryData.map(d => d.i2), borderColor: '#eab308', tension: 0.3 },
      { label: 'I3 Current (A)', data: chartHistoryData.map(d => d.i3), borderColor: '#3b82f6', tension: 0.3 }
    ];
  } else if (activeChartTab === 'voltages') {
    telemetryChartInstance.data.labels = labels;
    telemetryChartInstance.data.datasets = [
      { label: 'V_R Voltage (V)', data: chartHistoryData.map(d => d.vR), borderColor: '#f43f5e', tension: 0.3 },
      { label: 'V_Y Voltage (V)', data: chartHistoryData.map(d => d.vY), borderColor: '#eab308', tension: 0.3 },
      { label: 'V_B Voltage (V)', data: chartHistoryData.map(d => d.vB), borderColor: '#3b82f6', tension: 0.3 }
    ];
  } else if (activeChartTab === 'climate') {
    telemetryChartInstance.data.labels = labels;
    telemetryChartInstance.data.datasets = [
      { label: 'Temperature (°C)', data: chartHistoryData.map(d => d.temp), borderColor: '#f97316', tension: 0.3 },
      { label: 'Humidity (%)', data: chartHistoryData.map(d => d.hum), borderColor: '#8b5cf6', tension: 0.3 }
    ];
  }
  telemetryChartInstance.update();
}

// --------------------------------------------------------------------------
// 7. HISTORICAL DATA SEARCH, TABLE RENDERING & EXPORTS
// --------------------------------------------------------------------------

async function searchHistoricalData() {
  if (!selectedPanelId) {
    alert("Please select a panel first.");
    return;
  }

  const startDateInput = document.getElementById('histStartDate');
  const endDateInput = document.getElementById('histEndDate');

  const startDate = startDateInput ? startDateInput.value : '';
  const endDate = endDateInput ? endDateInput.value : '';

  let url = `${HISTORY_ENDPOINT}?panel_id=${encodeURIComponent(selectedPanelId)}`;
  if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`;
  if (endDate) url += `&end_date=${encodeURIComponent(endDate)}`;

  const tableBody = document.getElementById('histTableBody');
  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan="15" style="text-align: center; color: var(--text-muted); padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading panel records...</td></tr>`;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      renderHistoricalTable([]);
      return;
    }
    const data = await response.json();
    currentHistoricalRecords = Array.isArray(data) ? data : (data.records || []);

    // Enforce frontend panel isolation safety
    currentHistoricalRecords = currentHistoricalRecords.filter(r => !r.panel_id || r.panel_id === selectedPanelId);

    renderHistoricalTable(currentHistoricalRecords);
  } catch (error) {
    console.error("Error fetching historical data:", error);
    renderHistoricalTable([]);
  }
}

function renderHistoricalTable(records) {
  const tableBody = document.getElementById('histTableBody');
  const recordCountEl = document.getElementById('histRecordCount');
  if (!tableBody) return;

  if (recordCountEl) recordCountEl.textContent = records.length;

  if (!records || records.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="15" style="text-align: center; color: var(--text-dim); padding: 20px;">No historical records found for ${selectedPanelId}.</td></tr>`;
    return;
  }

  tableBody.innerHTML = '';
  records.forEach((rec, idx) => {
    const tr = document.createElement('tr');
    const faultStatus = rec.fault_status || 'No Fault Detected';
    const isFaulted = faultStatus !== 'No Fault Detected' && !faultStatus.toLowerCase().includes('normal');
    const badgeClass = isFaulted ? 'fault-badge fault-bad' : 'fault-badge fault-ok';

    tr.innerHTML = `
      <td>${rec.timestamp || rec.created_at || '--'}</td>
      <td><strong>${rec.panel_id || selectedPanelId}</strong></td>
      <td><span class="${badgeClass}">${faultStatus}</span></td>
      <td>${rec.i1 !== undefined ? rec.i1 : '--'}</td>
      <td>${rec.i2 !== undefined ? rec.i2 : '--'}</td>
      <td>${rec.i3 !== undefined ? rec.i3 : '--'}</td>
      <td>${rec.i0 !== undefined ? rec.i0 : '--'}</td>
      <td>${rec.vr !== undefined ? rec.vr : '--'}</td>
      <td>${rec.vy !== undefined ? rec.vy : '--'}</td>
      <td>${rec.vb !== undefined ? rec.vb : '--'}</td>
      <td>${rec.total_power_p_t !== undefined ? rec.total_power_p_t : '--'}</td>
      <td>${rec.total_power_factor !== undefined ? rec.total_power_factor : '--'}</td>
      <td>${rec.temperature !== undefined ? rec.temperature : '--'}</td>
      <td>${rec.humidity !== undefined ? rec.humidity : '--'}</td>
      <td>
        <button class="view-details-btn" onclick="openDetailsModal(${idx})">
          <i class="fa-solid fa-eye"></i> Details
        </button>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

function resetHistoricalFilter() {
  const startDateInput = document.getElementById('histStartDate');
  const endDateInput = document.getElementById('histEndDate');
  if (startDateInput) startDateInput.value = '';
  if (endDateInput) endDateInput.value = '';
  searchHistoricalData();
}

function clearHistoricalTable() {
  currentHistoricalRecords = [];
  renderHistoricalTable([]);
}

// --------------------------------------------------------------------------
// 8. VIEW DETAILS MODAL POPUP
// --------------------------------------------------------------------------

function openDetailsModal(index) {
  const rec = currentHistoricalRecords[index];
  if (!rec) return;

  const modalBody = document.getElementById('modalBody');
  const modal = document.getElementById('recordDetailsModal');
  if (!modalBody || !modal) return;

  modalBody.innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title"><i class="fa-solid fa-microchip"></i> Basic Information</div>
      <div class="detail-fields-grid">
        <div class="detail-field">
          <span class="detail-field-label">Panel ID</span>
          <span class="detail-field-value highlight-cyan">${rec.panel_id || selectedPanelId}</span>
        </div>
        <div class="detail-field">
          <span class="detail-field-label">Customer ID</span>
          <span class="detail-field-value">${currentCustomer || '--'}</span>
        </div>
        <div class="detail-field">
          <span class="detail-field-label">Timestamp</span>
          <span class="detail-field-value">${rec.timestamp || rec.created_at || '--'}</span>
        </div>
        <div class="detail-field">
          <span class="detail-field-label">Fault Status</span>
          <span class="detail-field-value highlight-yellow">${rec.fault_status || 'No Fault Detected'}</span>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title"><i class="fa-solid fa-shield-halved"></i> ABB REJ601 Relay Telemetry</div>
      <div class="detail-fields-grid">
        <div class="detail-field"><span class="detail-field-label">Phase I1</span><span class="detail-field-value">${rec.i1 || 0} A</span></div>
        <div class="detail-field"><span class="detail-field-label">Phase I2</span><span class="detail-field-value">${rec.i2 || 0} A</span></div>
        <div class="detail-field"><span class="detail-field-label">Phase I3</span><span class="detail-field-value">${rec.i3 || 0} A</span></div>
        <div class="detail-field"><span class="detail-field-label">Earth I0</span><span class="detail-field-value">${rec.i0 || 0} A</span></div>
        <div class="detail-field"><span class="detail-field-label">Negative Seq I2</span><span class="detail-field-value">${rec.negative_sequence_i2 || 0} A</span></div>
        <div class="detail-field"><span class="detail-field-label">Thermal Level</span><span class="detail-field-value">${rec.thermal_level || 0} %</span></div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title"><i class="fa-solid fa-gauge-high"></i> EMS-01 Power Quality Meter</div>
      <div class="detail-fields-grid">
        <div class="detail-field"><span class="detail-field-label">V_R Voltage</span><span class="detail-field-value">${rec.vr || 0} V</span></div>
        <div class="detail-field"><span class="detail-field-label">V_Y Voltage</span><span class="detail-field-value">${rec.vy || 0} V</span></div>
        <div class="detail-field"><span class="detail-field-label">V_B Voltage</span><span class="detail-field-value">${rec.vb || 0} V</span></div>
        <div class="detail-field"><span class="detail-field-label">Total Power</span><span class="detail-field-value highlight-green">${rec.total_power_p_t || 0} kW</span></div>
        <div class="detail-field"><span class="detail-field-label">Total PF</span><span class="detail-field-value">${rec.total_power_factor || 0}</span></div>
        <div class="detail-field"><span class="detail-field-label">Frequency</span><span class="detail-field-value">${rec.frequency || 50.0} Hz</span></div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title"><i class="fa-solid fa-temperature-half"></i> DHT22 Environmental Data</div>
      <div class="detail-fields-grid">
        <div class="detail-field"><span class="detail-field-label">Temperature</span><span class="detail-field-value highlight-orange">${rec.temperature || 0} °C</span></div>
        <div class="detail-field"><span class="detail-field-label">Humidity</span><span class="detail-field-value highlight-purple">${rec.humidity || 0} %</span></div>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

function closeDetailsModal() {
  const modal = document.getElementById('recordDetailsModal');
  if (modal) modal.classList.add('hidden');
}

// --------------------------------------------------------------------------
// 9. EXPORTS (EXCEL & PDF)
// --------------------------------------------------------------------------

function exportHistoricalExcel() {
  if (!currentHistoricalRecords || currentHistoricalRecords.length === 0) {
    alert("No records to export.");
    return;
  }

  const exportData = currentHistoricalRecords.map(r => ({
    "Timestamp": r.timestamp || r.created_at || "",
    "Customer ID": currentCustomer || "",
    "Panel ID": r.panel_id || selectedPanelId,
    "Fault Status": r.fault_status || "No Fault Detected",
    "I1 Current (A)": r.i1 !== undefined ? r.i1 : "",
    "I2 Current (A)": r.i2 !== undefined ? r.i2 : "",
    "I3 Current (A)": r.i3 !== undefined ? r.i3 : "",
    "I0 Earth (A)": r.i0 !== undefined ? r.i0 : "",
    "VR Voltage (V)": r.vr !== undefined ? r.vr : "",
    "VY Voltage (V)": r.vy !== undefined ? r.vy : "",
    "VB Voltage (V)": r.vb !== undefined ? r.vb : "",
    "Total Power (kW)": r.total_power_p_t !== undefined ? r.total_power_p_t : "",
    "Power Factor": r.total_power_factor !== undefined ? r.total_power_factor : "",
    "Temperature (°C)": r.temperature !== undefined ? r.temperature : "",
    "Humidity (%)": r.humidity !== undefined ? r.humidity : ""
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Telemetry Logs");

  XLSX.writeFile(workbook, `Telemetry_Report_${selectedPanelId}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function exportHistoricalPdf() {
  if (!currentHistoricalRecords || currentHistoricalRecords.length === 0) {
    alert("No records to export.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });

  doc.setFontSize(14);
  doc.text(`MV Substation Telemetry Report - ${selectedPanelId}`, 14, 15);
  doc.setFontSize(10);
  doc.text(`Customer: ${currentCustomer} | Export Date: ${new Date().toLocaleString()}`, 14, 22);

  const tableColumn = ["Timestamp", "Panel", "Fault Status", "I1(A)", "I2(A)", "I3(A)", "I0(A)", "VR(V)", "VY(V)", "VB(V)", "P_T(kW)", "PF", "Temp(°C)", "Hum(%)"];
  const tableRows = currentHistoricalRecords.map(r => [
    r.timestamp || r.created_at || "",
    r.panel_id || selectedPanelId,
    r.fault_status || "Normal",
    r.i1 !== undefined ? r.i1 : "",
    r.i2 !== undefined ? r.i2 : "",
    r.i3 !== undefined ? r.i3 : "",
    r.i0 !== undefined ? r.i0 : "",
    r.vr !== undefined ? r.vr : "",
    r.vy !== undefined ? r.vy : "",
    r.vb !== undefined ? r.vb : "",
    r.total_power_p_t !== undefined ? r.total_power_p_t : "",
    r.total_power_factor !== undefined ? r.total_power_factor : "",
    r.temperature !== undefined ? r.temperature : "",
    r.humidity !== undefined ? r.humidity : ""
  ]);

  doc.autoTable({
    head: [tableColumn],
    body: tableRows,
    startY: 28,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [6, 182, 212] }
  });

  doc.save(`Telemetry_Report_${selectedPanelId}_${new Date().toISOString().slice(0,10)}.pdf`);
}

// --------------------------------------------------------------------------
// 10. INITIALIZATION & SESSION RESTORATION
// --------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const savedCustomer = localStorage.getItem('mv_customer_id');
  const savedPanel = localStorage.getItem('mv_panel_id');

  if (savedCustomer && customerAccounts[savedCustomer]) {
    currentCustomer = savedCustomer;
    const assignedPanels = customerAccounts[savedCustomer].panels || [];

    if (savedPanel && assignedPanels.includes(savedPanel)) {
      selectPanel(savedPanel);
    } else {
      showPanelSelection();
    }
  } else {
    showLoginScreen();
  }
});
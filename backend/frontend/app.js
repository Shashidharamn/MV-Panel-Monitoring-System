/* ==========================================================================
   Substation & Power Quality Live Dashboard - Script
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. CONFIGURATION & STATE MANAGEMENT
// --------------------------------------------------------------------------

const API_BASE_URL = "https://mv-panel-monitoring-system-qobz.onrender.com";
const LATEST_ENDPOINT = `${API_BASE_URL}/latest`;
const HISTORY_ENDPOINT = `${API_BASE_URL}/history`;

// Customer Accounts & Assigned Panels Configuration (Frontend Auth)
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
let currentSelectedModalRecord = null;

// Live Fault Banner - trip latch state.
// The banner should only read "Fault Detected" right after a real TRIP
// (Op Counter increments, OR the relay logs a new at-trip fault record),
// not just because a current is momentarily above pickup (that's what
// the ALARM/NORMAL pills are for). Once a trip is seen, the fault text
// is latched on screen for TRIP_FAULT_DISPLAY_MS, then the banner falls
// back to reflecting the live currents.
//
// Two independent trip signals are checked (either one latches the
// banner): Op Counter incrementing, and the fault record's at-trip
// timestamp changing. Using both means the banner still works correctly
// even on a bench/test setup where Op Counter isn't reliably updating.
const TRIP_FAULT_DISPLAY_MS = 10000;
let lastSeenOpCounter = null;
let lastSeenAtTripTime = null;
let tripFaultBannerText = null;
let tripFaultBannerUntil = 0;

// --------------------------------------------------------------------------
// HELPER FUNCTIONS FOR STRICT DATA EXTRACT & FORMATTING (NO FAKE DEFAULTS)
// --------------------------------------------------------------------------

function hasValue(val) {
  return val !== undefined && val !== null && val !== "";
}

function getRecordField(rec, keys) {
  if (!rec) return undefined;
  for (const key of keys) {
    if (key.includes('.')) {
      const parts = key.split('.');
      let cur = rec;
      for (const p of parts) {
        if (cur !== undefined && cur !== null) {
          cur = cur[p];
        } else {
          cur = undefined;
          break;
        }
      }
      if (hasValue(cur)) return cur;
    } else if (hasValue(rec[key])) {
      return rec[key];
    }
  }
  return undefined;
}

function formatValue(val, decimals = null, unit = '') {
  if (!hasValue(val)) return '--';
  const num = Number(val);
  if (isNaN(num)) return String(val) + (unit ? ` ${unit}` : '');
  if (decimals !== null) {
    return num.toFixed(decimals) + (unit ? ` ${unit}` : '');
  }
  return String(num) + (unit ? ` ${unit}` : '');
}

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
  lastSeenOpCounter = null;
  lastSeenAtTripTime = null;
  tripFaultBannerText = null;
  tripFaultBannerUntil = 0;
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
    if (!data || Object.keys(data).length === 0 || data.detail || data.message === "No Data Available") {
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
  setText('frStagePreStart', 'I1=-- A | I2=-- A | I3=-- A | I0=-- A');
  setText('frStagePreStart_time', '--:--:--');
  setText('frStageStart', 'I1=-- A | I2=-- A | I3=-- A | I0=-- A');
  setText('frStageStart_time', '--:--:--');
  setText('frStageTrip', 'I1=-- A | I2=-- A | I3=-- A | I0=-- A');
  setText('frStageTrip_time', '--:--:--');
}

// --------------------------------------------------------------------------
// 5. TELEMETRY DATA PROCESSING & UI BINDING
// --------------------------------------------------------------------------

function processTelemetryData(data) {
  if (!data) return;

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = hasValue(val) ? val : '--';
  };

  // Browser receipt timestamp
  const nowStr = new Date().toLocaleTimeString();
  setText('lastUpdated', nowStr);

  const relay = data.relay || {};
  const meter = data.meter || {};
  const dht = data.dht || {};

  // 1. RELAY PROTECTION (ABB REJ601)
  const sgActive = relay.sg_active;
  setText('relaySG', hasValue(sgActive) ? `SG${sgActive}` : 'SG1');

  const phasePickupVal = getRecordField(relay, ['pickup_phase']);
  const earthPickupVal = getRecordField(relay, ['pickup_earth']);
  const phasePickup = hasValue(phasePickupVal) ? Number(phasePickupVal) : 1;
  const earthPickup = hasValue(earthPickupVal) ? Number(earthPickupVal) : 15;

  setText('relayIPhasePickup', formatValue(phasePickupVal, null, 'A'));
  setText('relayIEarthPickup', formatValue(earthPickupVal, null, 'A'));
  setText('relayOpCounter', formatValue(getRecordField(relay, ['op_counter'])));

  const i1Val = getRecordField(relay, ['i1']);
  const i2Val = getRecordField(relay, ['i2']);
  const i3Val = getRecordField(relay, ['i3']);
  const i0Val = getRecordField(relay, ['i0']);

  setText('relayI1', formatValue(i1Val, 2));
  setText('relayI2', formatValue(i2Val, 2));
  setText('relayI3', formatValue(i3Val, 2));
  setText('relayI0', formatValue(i0Val, 2));

  const negSeqVal = getRecordField(relay, ['neg_seq']);
  const thermalLevelVal = getRecordField(relay, ['thermal_level']);

  setText('relayNegSeq', formatValue(negSeqVal, 2, 'A'));
  setText('relayThermal', formatValue(thermalLevelVal, 1, '%'));

  const thermalBar = document.getElementById('thermalBar');
  if (thermalBar && hasValue(thermalLevelVal)) {
    thermalBar.style.width = `${Math.min(Number(thermalLevelVal), 100)}%`;
  }

  // Live Fault Alarm Pills (comparison against pickup values)
  updatePill('pillI1', hasValue(i1Val) && Number(i1Val) > phasePickup);
  updatePill('pillI2', hasValue(i2Val) && Number(i2Val) > phasePickup);
  updatePill('pillI3', hasValue(i3Val) && Number(i3Val) > phasePickup);
  updatePill('pillI0', hasValue(i0Val) && Number(i0Val) > earthPickup);

  // Live Fault Status Banner
  // Only latch "Fault Detected" when the relay actually TRIPS - signaled
  // by either the Op Counter incrementing, or the fault record logging a
  // new at-trip event (its timestamp changing). A current sitting above
  // pickup on its own is a pickup/alarm condition (already shown by the
  // ALARM/NORMAL pills above), not a confirmed fault - the relay's own
  // time-delay decides whether that pickup turns into a real trip. Once
  // a trip is seen, show the fault text for TRIP_FAULT_DISPLAY_MS, then
  // fall back to what the live currents actually say right now.
  const opCounterVal = getRecordField(relay, ['op_counter']);
  const opCounterNum = hasValue(opCounterVal) ? Number(opCounterVal) : null;
  const atTripTimeVal = relay.fault_record1 ? relay.fault_record1.at_trip_time : undefined;

  let tripDetected = false;

  if (opCounterNum !== null && !isNaN(opCounterNum)) {
    if (lastSeenOpCounter !== null && opCounterNum > lastSeenOpCounter) {
      tripDetected = true;
    }
    lastSeenOpCounter = opCounterNum;
  }

  if (hasValue(atTripTimeVal)) {
    if (lastSeenAtTripTime !== null && atTripTimeVal !== lastSeenAtTripTime) {
      tripDetected = true;
    }
    lastSeenAtTripTime = atTripTimeVal;
  }

  if (tripDetected) {
    tripFaultBannerText = relay.live_fault_status || "Fault Detected";
    tripFaultBannerUntil = Date.now() + TRIP_FAULT_DISPLAY_MS;
  }

  let liveFaultStatus;
  if (Date.now() < tripFaultBannerUntil) {
    // Still inside the post-trip display window.
    liveFaultStatus = tripFaultBannerText || "Fault Detected";
  } else {
    // No recent trip - a current sitting above pickup on its own is not
    // a confirmed fault (that's what the ALARM/NORMAL pills are for), so
    // the banner reads Normal until the next real trip.
    liveFaultStatus = "No Fault Detected";
  }

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
  setText('eventType', formatValue(evt.type));
  setText('eventSubtype', formatValue(evt.subtype));
  setText('eventTime', formatValue(evt.timestamp));
  setText('relayRtc', formatValue(relay.rtc));

  // 2. EMS-01 POWER QUALITY METER
  const vRVal = getRecordField(meter, ['v_r']);
  const vYVal = getRecordField(meter, ['v_y']);
  const vBVal = getRecordField(meter, ['v_b']);

  const iRVal = getRecordField(meter, ['i_r']);
  const iYVal = getRecordField(meter, ['i_y']);
  const iBVal = getRecordField(meter, ['i_b']);

  const pfRVal = getRecordField(meter, ['pf_r']);
  const pfYVal = getRecordField(meter, ['pf_y']);
  const pfBVal = getRecordField(meter, ['pf_b']);
  const pfTVal = getRecordField(meter, ['pf_t']);

  const pRVal = getRecordField(meter, ['p_r']);
  const pYVal = getRecordField(meter, ['p_y']);
  const pBVal = getRecordField(meter, ['p_b']);
  const pTVal = getRecordField(meter, ['p_t']);

  const freqVal = getRecordField(meter, ['frequency']);

  setText('meterVR', formatValue(vRVal, 1, 'V'));
  setText('meterVY', formatValue(vYVal, 1, 'V'));
  setText('meterVB', formatValue(vBVal, 1, 'V'));

  setText('meterIR', formatValue(iRVal, 2));
  setText('meterIY', formatValue(iYVal, 2));
  setText('meterIB', formatValue(iBVal, 2));

  setText('meterPFR', formatValue(pfRVal, 2));
  setText('meterPFY', formatValue(pfYVal, 2));
  setText('meterPFB', formatValue(pfBVal, 2));

  setText('meterPR', formatValue(pRVal, 2));
  setText('meterPY', formatValue(pYVal, 2));
  setText('meterPB', formatValue(pBVal, 2));

  setText('meterPFT', formatValue(pfTVal, 2));
  setText('meterPT', formatValue(pTVal, 2, 'kW'));
  setText('meterFreq', formatValue(freqVal, 2, 'Hz'));

  // 3. SYSTEM TELEMETRY SUMMARY CARDS
  const avgV = (hasValue(vRVal) && hasValue(vYVal) && hasValue(vBVal))
    ? (Number(vRVal) + Number(vYVal) + Number(vBVal)) / 3
    : null;

  setText('sumFreq', formatValue(freqVal, 2));
  setText('sumPower', formatValue(pTVal, 2));
  setText('sumPF', formatValue(pfTVal, 2));
  setText('sumAvgV', avgV !== null ? avgV.toFixed(1) : '--');

  // 4. DHT22 ENVIRONMENTAL DATA
  const tempVal = getRecordField(dht, ['temperature']);
  const humVal = getRecordField(dht, ['humidity']);

  setText('dhtTemp', formatValue(tempVal, 1));
  setText('dhtHum', formatValue(humVal, 1));

  setText('sumTemp', formatValue(tempVal, 1));
  setText('sumHum', formatValue(humVal, 1));

  const tempBadge = document.getElementById('tempAlertBadge');
  const humBadge = document.getElementById('humAlertBadge');

  if (tempBadge) {
    if (hasValue(tempVal) && Number(tempVal) > 50.0) tempBadge.classList.remove('hidden');
    else tempBadge.classList.add('hidden');
  }
  if (humBadge) {
    if (hasValue(humVal) && Number(humVal) > 80.0) humBadge.classList.remove('hidden');
    else humBadge.classList.add('hidden');
  }

  // 5. HISTORICAL FAULT RECORD TIMELINE (data.relay.fault_record1 - LAST STORED TRIP)
  const fr = relay.fault_record1 || relay.fault_record_1;
  if (fr) {
    if (fr.pre_start) setText('frStagePreStart', fr.pre_start);
    if (fr.at_start_time) setText('frStageStart_time', fr.at_start_time);
    if (fr.at_start) setText('frStageStart', fr.at_start);
    if (fr.at_trip_time) setText('frStageTrip_time', fr.at_trip_time);
    if (fr.at_trip) setText('frStageTrip', fr.at_trip);
  }

  // 6. UPDATE LIVE TELEMETRY TREND CHARTS
  pushChartPoint(nowStr, {
    i1: hasValue(i1Val) ? Number(i1Val) : null,
    i2: hasValue(i2Val) ? Number(i2Val) : null,
    i3: hasValue(i3Val) ? Number(i3Val) : null,
    vR: hasValue(vRVal) ? Number(vRVal) : null,
    vY: hasValue(vYVal) ? Number(vYVal) : null,
    vB: hasValue(vBVal) ? Number(vBVal) : null,
    temp: hasValue(tempVal) ? Number(tempVal) : null,
    hum: hasValue(humVal) ? Number(humVal) : null
  });
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
    tableBody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading panel records...</td></tr>`;
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
    tableBody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-dim); padding: 20px;">No historical records found for ${selectedPanelId}.</td></tr>`;
    return;
  }

  tableBody.innerHTML = '';
  records.forEach((rec, idx) => {
    const tr = document.createElement('tr');
    
    const timestamp = formatValue(getRecordField(rec, ['timestamp', 'created_at', 'event_timestamp']));
    const panelId = formatValue(getRecordField(rec, ['panel_id']), null) !== '--' ? getRecordField(rec, ['panel_id']) : selectedPanelId;

// Fault status for THIS database row only.
// Do NOT use historical_fault_status here because that can
// represent the previous/last trip and may remain populated
// even after the system returns to normal.

const overcurrentFault = rec.overcurrent_fault === true;
const earthFault = rec.earth_fault === true;

const isFaulted = overcurrentFault || earthFault;

let faultStatus;

if (earthFault) {
  faultStatus = 'Fault Detected - Earth Fault (E/F)';
} else if (overcurrentFault) {
  faultStatus = 'Fault Detected - Overcurrent (O/C)';
} else {
  faultStatus = 'No Fault Detected';
}

const badgeClass = isFaulted
  ? 'fault-badge fault-bad'
  : 'fault-badge fault-ok';


    // Historical Records must ALWAYS display the actual
// relay current values stored for THIS database record.
// Do NOT replace them with At-Trip fault-record values.

      const i1Val = getRecordField(rec, ['relay_i1', 'i1', 'relay.i1']);
      const i2Val = getRecordField(rec, ['relay_i2', 'i2', 'relay.i2']);
      const i3Val = getRecordField(rec, ['relay_i3', 'i3', 'relay.i3']);
      const i0Val = getRecordField(rec, ['relay_i0', 'i0', 'relay.i0']);

    // Voltages for this specific historical record
    let vrVal = getRecordField(rec, ['meter_v_r', 'vr', 'v_r', 'meter.v_r']);
    let vyVal = getRecordField(rec, ['meter_v_y', 'vy', 'v_y', 'meter.v_y']);
    let vbVal = getRecordField(rec, ['meter_v_b', 'vb', 'v_b', 'meter.v_b']);

    tr.innerHTML = `
      <td>${timestamp}</td>
      <td><strong>${panelId}</strong></td>
      <td><span class="${badgeClass}">${faultStatus}</span></td>
      <td>${formatValue(i1Val, 2)}</td>
      <td>${formatValue(i2Val, 2)}</td>
      <td>${formatValue(i3Val, 2)}</td>
      <td>${formatValue(i0Val, 2)}</td>
      <td>${formatValue(vrVal, 1)}</td>
      <td>${formatValue(vyVal, 1)}</td>
      <td>${formatValue(vbVal, 1)}</td>
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

  currentSelectedModalRecord = rec;

  const modalBody = document.getElementById('modalBody');
  const modal = document.getElementById('recordDetailsModal');
  if (!modalBody || !modal) return;

  const timestamp = formatValue(getRecordField(rec, ['timestamp', 'created_at']));
  const panelId = hasValue(getRecordField(rec, ['panel_id'])) ? getRecordField(rec, ['panel_id']) : selectedPanelId;
  const faultStatus = hasValue(getRecordField(rec, ['fault_status', 'historical_fault_status']))
    ? getRecordField(rec, ['fault_status', 'historical_fault_status'])
    : 'No Fault Detected';

  // Relay data
  const sg = formatValue(getRecordField(rec, ['setting_group', 'sg_active', 'relay.sg_active']));
  const phasePickup = formatValue(getRecordField(rec, ['pickup_phase', 'i_phase_pickup', 'relay.pickup_phase']), null, 'A');
  const earthPickup = formatValue(getRecordField(rec, ['pickup_earth', 'i_earth_pickup', 'relay.pickup_earth']), null, 'A');
  const opCounter = formatValue(getRecordField(rec, ['operation_counter', 'op_counter', 'relay.op_counter']));

  const i1 = formatValue(getRecordField(rec, ['relay_i1', 'i1', 'relay.i1']), 2, 'A');
  const i2 = formatValue(getRecordField(rec, ['relay_i2', 'i2', 'relay.i2']), 2, 'A');
  const i3 = formatValue(getRecordField(rec, ['relay_i3', 'i3', 'relay.i3']), 2, 'A');
  const i0 = formatValue(getRecordField(rec, ['relay_i0', 'i0', 'relay.i0']), 2, 'A');
  const negSeq = formatValue(getRecordField(rec, ['negative_sequence_current', 'neg_seq', 'negative_sequence_i2', 'relay.neg_seq']), 2, 'A');
  const thermalLevel = formatValue(getRecordField(rec, ['thermal_level', 'relay.thermal_level']), 1, '%');
  const relayRtc = formatValue(getRecordField(rec, ['relay_rtc', 'rtc', 'relay.rtc']));

  // Meter data
  const vr = formatValue(getRecordField(rec, ['meter_v_r', 'vr', 'v_r', 'meter.v_r']), 1, 'V');
  const vy = formatValue(getRecordField(rec, ['meter_v_y', 'vy', 'v_y', 'meter.v_y']), 1, 'V');
  const vb = formatValue(getRecordField(rec, ['meter_v_b', 'vb', 'v_b', 'meter.v_b']), 1, 'V');
  const pTotal = formatValue(getRecordField(rec, ['meter_p_t', 'total_power_p_t', 'p_t', 'meter.p_t']), 2, 'kW');
  const pfTotal = formatValue(getRecordField(rec, ['meter_pf_t', 'total_power_factor', 'pf_t', 'meter.pf_t']), 2);
  const freq = formatValue(getRecordField(rec, ['meter_frequency', 'frequency', 'meter.frequency']), 2, 'Hz');

  // DHT22 data
  const temp = formatValue(getRecordField(rec, ['temperature', 'dht.temperature']), 1, '°C');
  const hum = formatValue(getRecordField(rec, ['humidity', 'dht.humidity']), 1, '%');

  // Fault Record Details (ONLY if present on this specific historical record)
  const isTripRecord = faultStatus !== 'No Fault Detected' || hasValue(getRecordField(rec, ['fr_attrip_timestamp']));
  let faultDetailsHtml = '';

  if (isTripRecord) {
    const preI1 = formatValue(getRecordField(rec, ['fr_prestart_i1']), 2);
    const preI2 = formatValue(getRecordField(rec, ['fr_prestart_i2']), 2);
    const preI3 = formatValue(getRecordField(rec, ['fr_prestart_i3']), 2);
    const preI0 = formatValue(getRecordField(rec, ['fr_prestart_i0']), 2);

    const startI1 = formatValue(getRecordField(rec, ['fr_atstart_i1']), 2);
    const startI2 = formatValue(getRecordField(rec, ['fr_atstart_i2']), 2);
    const startI3 = formatValue(getRecordField(rec, ['fr_atstart_i3']), 2);
    const startI0 = formatValue(getRecordField(rec, ['fr_atstart_i0']), 2);
    const startTime = formatValue(getRecordField(rec, ['fr_atstart_timestamp']));

    const tripI1 = formatValue(getRecordField(rec, ['fr_attrip_i1']), 2);
    const tripI2 = formatValue(getRecordField(rec, ['fr_attrip_i2']), 2);
    const tripI3 = formatValue(getRecordField(rec, ['fr_attrip_i3']), 2);
    const tripI0 = formatValue(getRecordField(rec, ['fr_attrip_i0']), 2);
    const tripTime = formatValue(getRecordField(rec, ['fr_attrip_timestamp']));

    faultDetailsHtml = `
      <div class="detail-section">
        <div class="detail-section-title"><i class="fa-solid fa-triangle-exclamation"></i> Associated Fault Event Record</div>
        <div class="detail-fields-grid">
          <div class="detail-field"><span class="detail-field-label">Pre-Start Currents</span><span class="detail-field-value">I1=${preI1} A | I2=${preI2} A | I3=${preI3} A | I0=${preI0} A</span></div>
          <div class="detail-field"><span class="detail-field-label">At Start Currents</span><span class="detail-field-value">I1=${startI1} A | I2=${startI2} A | I3=${startI3} A | I0=${startI0} A</span></div>
          <div class="detail-field"><span class="detail-field-label">At Start Time</span><span class="detail-field-value">${startTime}</span></div>
          <div class="detail-field"><span class="detail-field-label">At Trip Currents</span><span class="detail-field-value highlight-orange">I1=${tripI1} A | I2=${tripI2} A | I3=${tripI3} A | I0=${tripI0} A</span></div>
          <div class="detail-field"><span class="detail-field-label">At Trip Time</span><span class="detail-field-value">${tripTime}</span></div>
          <div class="detail-field"><span class="detail-field-label">Trip Status</span><span class="detail-field-value highlight-yellow">${faultStatus}</span></div>
        </div>
      </div>
    `;
  }

  modalBody.innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title"><i class="fa-solid fa-microchip"></i> Basic Information</div>
      <div class="detail-fields-grid">
        <div class="detail-field">
          <span class="detail-field-label">Panel ID</span>
          <span class="detail-field-value highlight-cyan">${panelId}</span>
        </div>
        <div class="detail-field">
          <span class="detail-field-label">Customer ID</span>
          <span class="detail-field-value">${currentCustomer || '--'}</span>
        </div>
        <div class="detail-field">
          <span class="detail-field-label">Timestamp</span>
          <span class="detail-field-value">${timestamp}</span>
        </div>
        <div class="detail-field">
          <span class="detail-field-label">Fault Status</span>
          <span class="detail-field-value highlight-yellow">${faultStatus}</span>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title"><i class="fa-solid fa-shield-halved"></i> ABB REJ601 Relay Telemetry</div>
      <div class="detail-fields-grid">
        <div class="detail-field"><span class="detail-field-label">Setting Group</span><span class="detail-field-value">${sg}</span></div>
        <div class="detail-field"><span class="detail-field-label">Phase Pickup</span><span class="detail-field-value">${phasePickup}</span></div>
        <div class="detail-field"><span class="detail-field-label">Earth Pickup</span><span class="detail-field-value">${earthPickup}</span></div>
        <div class="detail-field"><span class="detail-field-label">Op Counter</span><span class="detail-field-value">${opCounter}</span></div>
        <div class="detail-field"><span class="detail-field-label">Phase I1</span><span class="detail-field-value">${i1}</span></div>
        <div class="detail-field"><span class="detail-field-label">Phase I2</span><span class="detail-field-value">${i2}</span></div>
        <div class="detail-field"><span class="detail-field-label">Phase I3</span><span class="detail-field-value">${i3}</span></div>
        <div class="detail-field"><span class="detail-field-label">Earth I0</span><span class="detail-field-value">${i0}</span></div>
        <div class="detail-field"><span class="detail-field-label">Negative Seq I2</span><span class="detail-field-value">${negSeq}</span></div>
        <div class="detail-field"><span class="detail-field-label">Thermal Level</span><span class="detail-field-value">${thermalLevel}</span></div>
        <div class="detail-field"><span class="detail-field-label">Relay RTC</span><span class="detail-field-value">${relayRtc}</span></div>
      </div>
    </div>

    ${faultDetailsHtml}

    <div class="detail-section">
      <div class="detail-section-title"><i class="fa-solid fa-gauge-high"></i> EMS-01 Power Quality Meter</div>
      <div class="detail-fields-grid">
        <div class="detail-field"><span class="detail-field-label">V_R Voltage</span><span class="detail-field-value">${vr}</span></div>
        <div class="detail-field"><span class="detail-field-label">V_Y Voltage</span><span class="detail-field-value">${vy}</span></div>
        <div class="detail-field"><span class="detail-field-label">V_B Voltage</span><span class="detail-field-value">${vb}</span></div>
        <div class="detail-field"><span class="detail-field-label">Total Power</span><span class="detail-field-value highlight-green">${pTotal}</span></div>
        <div class="detail-field"><span class="detail-field-label">Total PF</span><span class="detail-field-value">${pfTotal}</span></div>
        <div class="detail-field"><span class="detail-field-label">Frequency</span><span class="detail-field-value">${freq}</span></div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title"><i class="fa-solid fa-temperature-half"></i> DHT22 Environmental Data</div>
      <div class="detail-fields-grid">
        <div class="detail-field"><span class="detail-field-label">Temperature</span><span class="detail-field-value highlight-orange">${temp}</span></div>
        <div class="detail-field"><span class="detail-field-label">Humidity</span><span class="detail-field-value highlight-purple">${hum}</span></div>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

function exportSingleRecordPdf() {
  if (!currentSelectedModalRecord) {
    alert("No record selected.");
    return;
  }
  const rec = currentSelectedModalRecord;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const timestamp = formatValue(getRecordField(rec, ['timestamp', 'created_at']));
  const panelId = hasValue(getRecordField(rec, ['panel_id'])) ? getRecordField(rec, ['panel_id']) : selectedPanelId;
  const faultStatus = hasValue(getRecordField(rec, ['fault_status', 'historical_fault_status']))
    ? getRecordField(rec, ['fault_status', 'historical_fault_status'])
    : 'No Fault Detected';

  doc.setFontSize(14);
  doc.text(`MV Substation Telemetry Record Snapshot`, 14, 15);
  doc.setFontSize(10);
  doc.text(`Panel: ${panelId} | Timestamp: ${timestamp} | Customer: ${currentCustomer || '--'}`, 14, 22);

  const tableData = [
    ["Parameter", "Value"],
    ["Panel ID", panelId],
    ["Customer ID", currentCustomer || '--'],
    ["Timestamp", timestamp],
    ["Fault Status", faultStatus],
    ["Phase I1 Current", formatValue(getRecordField(rec, ['relay_i1', 'i1', 'relay.i1']), 2, 'A')],
    ["Phase I2 Current", formatValue(getRecordField(rec, ['relay_i2', 'i2', 'relay.i2']), 2, 'A')],
    ["Phase I3 Current", formatValue(getRecordField(rec, ['relay_i3', 'i3', 'relay.i3']), 2, 'A')],
    ["Earth I0 Current", formatValue(getRecordField(rec, ['relay_i0', 'i0', 'relay.i0']), 2, 'A')],
    ["Negative Sequence I2", formatValue(getRecordField(rec, ['negative_sequence_current', 'neg_seq', 'relay.neg_seq']), 2, 'A')],
    ["Thermal Level", formatValue(getRecordField(rec, ['thermal_level', 'relay.thermal_level']), 1, '%')],
    ["Setting Group", formatValue(getRecordField(rec, ['setting_group', 'sg_active', 'relay.sg_active']))],
    ["Phase Pickup", formatValue(getRecordField(rec, ['pickup_phase', 'i_phase_pickup', 'relay.pickup_phase']), null, 'A')],
    ["Earth Pickup", formatValue(getRecordField(rec, ['pickup_earth', 'i_earth_pickup', 'relay.pickup_earth']), null, 'A')],
    ["Op Counter", formatValue(getRecordField(rec, ['operation_counter', 'op_counter', 'relay.op_counter']))],
    ["V_R Voltage", formatValue(getRecordField(rec, ['meter_v_r', 'vr', 'v_r', 'meter.v_r']), 1, 'V')],
    ["V_Y Voltage", formatValue(getRecordField(rec, ['meter_v_y', 'vy', 'v_y', 'meter.v_y']), 1, 'V')],
    ["V_B Voltage", formatValue(getRecordField(rec, ['meter_v_b', 'vb', 'v_b', 'meter.v_b']), 1, 'V')],
    ["Frequency", formatValue(getRecordField(rec, ['meter_frequency', 'frequency', 'meter.frequency']), 2, 'Hz')],
    ["Total Power Factor", formatValue(getRecordField(rec, ['meter_pf_t', 'total_power_factor', 'pf_t', 'meter.pf_t']), 2)],
    ["Total Power (P_T)", formatValue(getRecordField(rec, ['meter_p_t', 'total_power_p_t', 'p_t', 'meter.p_t']), 2, 'kW')],
    ["Temperature", formatValue(getRecordField(rec, ['temperature', 'dht.temperature']), 1, '°C')],
    ["Humidity", formatValue(getRecordField(rec, ['humidity', 'dht.humidity']), 1, '%')]
  ];

  doc.autoTable({
    head: [tableData[0]],
    body: tableData.slice(1),
    startY: 28,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [6, 182, 212] }
  });

  const dateStr = String(timestamp || 'record').replace(/[/\\?%*:|"<>]/g, '_');
  doc.save(`Record_${panelId}_${dateStr}.pdf`);
}

function exportSingleRecordExcel() {
  if (!currentSelectedModalRecord) {
    alert("No record selected.");
    return;
  }
  const rec = currentSelectedModalRecord;
  const timestamp = formatValue(getRecordField(rec, ['timestamp', 'created_at']));
  const panelId = hasValue(getRecordField(rec, ['panel_id'])) ? getRecordField(rec, ['panel_id']) : selectedPanelId;
  const faultStatus = hasValue(getRecordField(rec, ['fault_status', 'historical_fault_status']))
    ? getRecordField(rec, ['fault_status', 'historical_fault_status'])
    : 'No Fault Detected';

  const exportData = [{
    "Timestamp": timestamp,
    "Panel ID": panelId,
    "Customer ID": currentCustomer || '--',
    "Fault Status": faultStatus,
    "I1 (A)": formatValue(getRecordField(rec, ['relay_i1', 'i1', 'relay.i1']), 2),
    "I2 (A)": formatValue(getRecordField(rec, ['relay_i2', 'i2', 'relay.i2']), 2),
    "I3 (A)": formatValue(getRecordField(rec, ['relay_i3', 'i3', 'relay.i3']), 2),
    "I0 (A)": formatValue(getRecordField(rec, ['relay_i0', 'i0', 'relay.i0']), 2),
    "Neg Seq I2 (A)": formatValue(getRecordField(rec, ['negative_sequence_current', 'neg_seq', 'relay.neg_seq']), 2),
    "Thermal Level (%)": formatValue(getRecordField(rec, ['thermal_level', 'relay.thermal_level']), 1),
    "Active SG": formatValue(getRecordField(rec, ['setting_group', 'sg_active', 'relay.sg_active'])),
    "Phase Pickup (A)": formatValue(getRecordField(rec, ['pickup_phase', 'i_phase_pickup', 'relay.pickup_phase'])),
    "Earth Pickup (A)": formatValue(getRecordField(rec, ['pickup_earth', 'i_earth_pickup', 'relay.pickup_earth'])),
    "Op Counter": formatValue(getRecordField(rec, ['operation_counter', 'op_counter', 'relay.op_counter'])),
    "V_R (V)": formatValue(getRecordField(rec, ['meter_v_r', 'vr', 'v_r', 'meter.v_r']), 1),
    "V_Y (V)": formatValue(getRecordField(rec, ['meter_v_y', 'vy', 'v_y', 'meter.v_y']), 1),
    "V_B (V)": formatValue(getRecordField(rec, ['meter_v_b', 'vb', 'v_b', 'meter.v_b']), 1),
    "Frequency (Hz)": formatValue(getRecordField(rec, ['meter_frequency', 'frequency', 'meter.frequency']), 2),
    "Total PF": formatValue(getRecordField(rec, ['meter_pf_t', 'total_power_factor', 'pf_t', 'meter.pf_t']), 2),
    "Total Power (kW)": formatValue(getRecordField(rec, ['meter_p_t', 'total_power_p_t', 'p_t', 'meter.p_t']), 2),
    "Temperature (°C)": formatValue(getRecordField(rec, ['temperature', 'dht.temperature']), 1),
    "Humidity (%)": formatValue(getRecordField(rec, ['humidity', 'dht.humidity']), 1)
  }];

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Record Snapshot");

  const dateStr = String(timestamp || 'record').replace(/[/\\?%*:|"<>]/g, '_');
  XLSX.writeFile(workbook, `Record_${panelId}_${dateStr}.xlsx`);
}

function closeDetailsModal() {
  const modal = document.getElementById('recordDetailsModal');
  if (modal) modal.classList.add('hidden');
}

// --------------------------------------------------------------------------
// 9. EXPORTS (EXCEL & PDF FOR HISTORICAL LOG SEARCH RESULTS)
// --------------------------------------------------------------------------

function exportHistoricalExcel() {
  if (!currentHistoricalRecords || currentHistoricalRecords.length === 0) {
    alert("No records to export.");
    return;
  }

  const exportData = currentHistoricalRecords.map(r => ({
    "Timestamp": formatValue(getRecordField(r, ['timestamp', 'created_at'])),
    "Customer ID": currentCustomer || "--",
    "Panel ID": hasValue(getRecordField(r, ['panel_id'])) ? getRecordField(r, ['panel_id']) : selectedPanelId,
    "Fault Status": hasValue(getRecordField(r, ['fault_status', 'historical_fault_status']))
      ? getRecordField(r, ['fault_status', 'historical_fault_status'])
      : 'No Fault Detected',
    "I1 Current (A)": formatValue(getRecordField(r, ['relay_i1', 'i1', 'relay.i1']), 2),
    "I2 Current (A)": formatValue(getRecordField(r, ['relay_i2', 'i2', 'relay.i2']), 2),
    "I3 Current (A)": formatValue(getRecordField(r, ['relay_i3', 'i3', 'relay.i3']), 2),
    "I0 Earth (A)": formatValue(getRecordField(r, ['relay_i0', 'i0', 'relay.i0']), 2),
    "VR Voltage (V)": formatValue(getRecordField(r, ['meter_v_r', 'vr', 'v_r', 'meter.v_r']), 1),
    "VY Voltage (V)": formatValue(getRecordField(r, ['meter_v_y', 'vy', 'v_y', 'meter.v_y']), 1),
    "VB Voltage (V)": formatValue(getRecordField(r, ['meter_v_b', 'vb', 'v_b', 'meter.v_b']), 1),
    "Total Power (kW)": formatValue(getRecordField(r, ['meter_p_t', 'total_power_p_t', 'p_t', 'meter.p_t']), 2),
    "Power Factor": formatValue(getRecordField(r, ['meter_pf_t', 'total_power_factor', 'pf_t', 'meter.pf_t']), 2),
    "Temperature (°C)": formatValue(getRecordField(r, ['temperature', 'dht.temperature']), 1),
    "Humidity (%)": formatValue(getRecordField(r, ['humidity', 'dht.humidity']), 1)
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

  const tableColumn = ["Timestamp", "Panel", "Fault Status", "I1(A)", "I2(A)", "I3(A)", "I0(A)", "VR(V)", "VY(V)", "VB(V)"];
  const tableRows = currentHistoricalRecords.map(r => [
    formatValue(getRecordField(r, ['timestamp', 'created_at'])),
    hasValue(getRecordField(r, ['panel_id'])) ? getRecordField(r, ['panel_id']) : selectedPanelId,
    hasValue(getRecordField(r, ['fault_status', 'historical_fault_status']))
      ? getRecordField(r, ['fault_status', 'historical_fault_status'])
      : 'No Fault Detected',
    formatValue(getRecordField(r, ['relay_i1', 'i1', 'relay.i1']), 2),
    formatValue(getRecordField(r, ['relay_i2', 'i2', 'relay.i2']), 2),
    formatValue(getRecordField(r, ['relay_i3', 'i3', 'relay.i3']), 2),
    formatValue(getRecordField(r, ['relay_i0', 'i0', 'relay.i0']), 2),
    formatValue(getRecordField(r, ['meter_v_r', 'vr', 'v_r', 'meter.v_r']), 1),
    formatValue(getRecordField(r, ['meter_v_y', 'vy', 'v_y', 'meter.v_y']), 1),
    formatValue(getRecordField(r, ['meter_v_b', 'vb', 'v_b', 'meter.v_b']), 1)
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
/* ==========================================================================
   Substation Live Dashboard - Real-time Application Logic
   Architecture: ESP32 -> FastAPI -> PostgreSQL -> Dashboard
   Live data source: FastAPI GET /latest (polled every 2s)
   Historical data source: FastAPI GET /history and DELETE /history
   ========================================================================== */

// ==========================================================================
// Backend API Configuration
// (Later this base URL will change to the deployed Render URL - nothing else
//  in this file needs to change when that happens)
// ==========================================================================
const API_BASE_URL = "https://mv-panel-monitoring-system.onrender.com";
const LATEST_ENDPOINT = `${API_BASE_URL}/latest`;
const HISTORY_ENDPOINT = `${API_BASE_URL}/history`;
const DELETE_HISTORY_ENDPOINT = `${API_BASE_URL}/history`;
const POLL_INTERVAL_MS = 2000;

let pollIntervalHandle = null;

let chartInstance = null;
let activeChartMode = 'currents'; // 'currents' | 'voltages' | 'environment'

// State for live vs historical charting
let isShowingHistorical = false;

// Holds only the records currently displayed in the historical table,
// used as the source for Excel/PDF export ("export only what's displayed")
// and also as the source for the "View Details" modal (Section: NEW FEATURE).
let currentHistoricalRecords = [];

// Helper function to check for null, undefined, or NaN safely
function isInvalid(val) {
  return val === null || val === undefined || isNaN(Number(val));
}

// Live chart telemetry buffer (last 20 samples)
const chartDataBuffer = {
  timestamps: [],
  i1: [], i2: [], i3: [], i0: [],
  vr: [], vy: [], vb: [],
  temp: [], hum: []
};

// ==========================================================================
// IndexedDB Setup - retained ONLY for temporary browser caching of live
// telemetry. It is no longer used as the source for historical records;
// all historical queries go through FastAPI -> PostgreSQL (GET/DELETE /history).
// ==========================================================================
const dbName = "SubstationTelemetryDB";
const storeName = "telemetry";
let db = null;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "timestamp" });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      console.log("IndexedDB initialized successfully (temporary local cache).");
      resolve(db);
    };
    request.onerror = (e) => {
      console.error("IndexedDB initialization error:", e.target.error);
      reject(e.target.error);
    };
  });
}

function saveTelemetryToDB(data) {
  if (!db) return;
  const transaction = db.transaction([storeName], "readwrite");
  const store = transaction.objectStore(storeName);

  const record = {
    timestamp: new Date().toISOString(),
    i1: isInvalid(data.relay?.i1) ? null : Number(data.relay.i1),
    i2: isInvalid(data.relay?.i2) ? null : Number(data.relay.i2),
    i3: isInvalid(data.relay?.i3) ? null : Number(data.relay.i3),
    i0: isInvalid(data.relay?.i0) ? null : Number(data.relay.i0),
    vr: isInvalid(data.meter?.v_r) ? null : Number(data.meter.v_r),
    vy: isInvalid(data.meter?.v_y) ? null : Number(data.meter.v_y),
    vb: isInvalid(data.meter?.v_b) ? null : Number(data.meter.v_b),
    freq: isInvalid(data.meter?.frequency) ? null : Number(data.meter.frequency),
    temp: isInvalid(data.dht?.temperature) ? null : Number(data.dht.temperature),
    hum: isInvalid(data.dht?.humidity) ? null : Number(data.dht.humidity),
    pf_t: isInvalid(data.meter?.pf_t) ? null : Number(data.meter.pf_t),
    p_t: isInvalid(data.meter?.p_t) ? null : Number(data.meter.p_t),
  };

  store.put(record);
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  updateTimestamp();

  // Initialize local cache DB, then start polling FastAPI for live telemetry
  initDB().then(() => {
    startLivePolling();
  }).catch(() => {
    // Even if IndexedDB fails, live polling should still work
    startLivePolling();
  });
});

// Update top header timestamp
function updateTimestamp() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0');
  document.getElementById('lastUpdated').innerText = timeStr;
}

function setConnectionState(state, text) {
  const dot = document.querySelector('.status-dot');
  const txt = document.getElementById('statusText');
  dot.className = `status-dot ${state}`;
  txt.innerText = text;
}

/* ==========================================================================
   LIVE MONITORING - FastAPI Data Fetching (Database -> FastAPI -> Dashboard)
   Do NOT modify this section's behavior.
   ========================================================================== */
function startLivePolling() {
  setConnectionState('offline', 'Connecting to FastAPI...');

  // Fetch immediately, then poll on an interval
  fetchLatestData();

  if (pollIntervalHandle) clearInterval(pollIntervalHandle);
  pollIntervalHandle = setInterval(fetchLatestData, POLL_INTERVAL_MS);
}

async function fetchLatestData() {
  try {
    const response = await fetch(LATEST_ENDPOINT);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    setConnectionState('online', 'Connected (FastAPI)');
    processTelemetryData(data);

  } catch (err) {
    console.error('Error fetching latest telemetry from FastAPI:', err);
    setConnectionState('offline', 'FastAPI Disconnected');
  }
}

/* ==========================================================================
   Telemetry Processing & UI Updates (Live Monitoring - unchanged)
   ========================================================================== */
function processTelemetryData(data) {
  updateTimestamp();

  const relay = data.relay || {};
  const meter = data.meter || {};
  const dht = data.dht || {};

  // Cache in Local IndexedDB (temporary browser cache only)
  saveTelemetryToDB(data);

  // 1. RELAY SECTION
  if (relay.sg_active !== undefined) document.getElementById('relaySG').innerText = `SG${relay.sg_active}`;
  if (relay.pickup_phase !== undefined) document.getElementById('relayIPhasePickup').innerText = `${Number(relay.pickup_phase).toFixed(2)} A`;
  if (relay.pickup_earth !== undefined) document.getElementById('relayIEarthPickup').innerText = `${Number(relay.pickup_earth).toFixed(2)} A`;
  if (relay.op_counter !== undefined) document.getElementById('relayOpCounter').innerText = relay.op_counter;

  const i1 = relay.i1;
  const i2 = relay.i2;
  const i3 = relay.i3;
  const i0 = relay.i0;
  const pickupIphase = isInvalid(relay.pickup_phase) ? 30.0 : Number(relay.pickup_phase);
  const pickupIearth = isInvalid(relay.pickup_earth) ? 15.0 : Number(relay.pickup_earth);

  document.getElementById('relayI1').innerText = isInvalid(i1) ? '--' : Number(i1).toFixed(2);
  document.getElementById('relayI2').innerText = isInvalid(i2) ? '--' : Number(i2).toFixed(2);
  document.getElementById('relayI3').innerText = isInvalid(i3) ? '--' : Number(i3).toFixed(2);
  document.getElementById('relayI0').innerText = isInvalid(i0) ? '--' : Number(i0).toFixed(2);

  // Evaluate Phase Overcurrent & Earth Fault alarms
  updatePhaseAlarm('pillI1', i1, pickupIphase);
  updatePhaseAlarm('pillI2', i2, pickupIphase);
  updatePhaseAlarm('pillI3', i3, pickupIphase);
  updatePhaseAlarm('pillI0', i0, pickupIearth);

  // Display Live Fault Status
  const liveFault = relay.live_fault_status || "No Fault Detected";
  const banner = document.getElementById('faultSummaryBanner');
  const icon = document.getElementById('faultIcon');
  const text = document.getElementById('faultSummaryText');
  text.innerText = liveFault;

  if (liveFault.includes("Fault Detected")) {
    banner.className = 'fault-summary-banner faulted';
    icon.className = 'fa-solid fa-triangle-exclamation';
  } else {
    banner.className = 'fault-summary-banner healthy';
    icon.className = 'fa-solid fa-circle-check';
  }

  document.getElementById('relayNegSeq').innerText = isInvalid(relay.neg_seq) ? '-- A' : `${Number(relay.neg_seq).toFixed(2)} A`;
  if (!isInvalid(relay.thermal_level)) {
    document.getElementById('relayThermal').innerText = `${relay.thermal_level}%`;
    document.getElementById('thermalBar').style.width = `${Math.min(relay.thermal_level, 100)}%`;
  }
  if (relay.rtc) document.getElementById('relayRtc').innerText = relay.rtc;

  // Latest Event
  if (relay.event) {
    document.getElementById('eventType').innerText = relay.event.type ?? '--';
    document.getElementById('eventSubtype').innerText = relay.event.subtype ?? '--';
    document.getElementById('eventTime').innerText = relay.event.timestamp ?? '--';
  }

  // Fault Record 1 (historical trip)
  if (relay.fault_record1) {
    const fr = relay.fault_record1;
    if (fr.pre_start) document.getElementById('recPreStart').innerText = fr.pre_start;
    if (fr.at_start) document.getElementById('recAtStart').innerText = fr.at_start;
    if (fr.at_start_time) document.getElementById('recAtStartTime').innerText = `@ ${fr.at_start_time}`;
    if (fr.at_trip) document.getElementById('recAtTrip').innerText = fr.at_trip;
    if (fr.at_trip_time) document.getElementById('recAtTripTime').innerText = `@ ${fr.at_trip_time}`;
    if (fr.p80) document.getElementById('recP80').innerText = fr.p80;
    if (fr.p200) document.getElementById('recP200').innerText = fr.p200;
    if (fr.at_trip_status) {
      document.getElementById('recAtTripStatus').innerText = `Last trip classification: ${fr.at_trip_status}`;
    }
  }

  // 2. METER SECTION
  document.getElementById('meterVR').innerHTML = formatVal(meter.v_r, 'V');
  document.getElementById('meterVY').innerHTML = formatVal(meter.v_y, 'V');
  document.getElementById('meterVB').innerHTML = formatVal(meter.v_b, 'V');

  document.getElementById('meterIR').innerHTML = formatVal(meter.i_r, 'A');
  document.getElementById('meterIY').innerHTML = formatVal(meter.i_y, 'A');
  document.getElementById('meterIB').innerHTML = formatVal(meter.i_b, 'A');

  document.getElementById('meterPFR').innerText = formatValRaw(meter.pf_r);
  document.getElementById('meterPFY').innerText = formatValRaw(meter.pf_y);
  document.getElementById('meterPFB').innerText = formatValRaw(meter.pf_b);
  document.getElementById('meterPFT').innerText = formatValRaw(meter.pf_t);

  document.getElementById('meterPR').innerText = formatValRaw(meter.p_r) + ' kW';
  document.getElementById('meterPY').innerText = formatValRaw(meter.p_y) + ' kW';
  document.getElementById('meterPB').innerText = formatValRaw(meter.p_b) + ' kW';
  document.getElementById('meterPT').innerText = formatValRaw(meter.p_t) + ' kW';

  document.getElementById('meterFreq').innerText = isInvalid(meter.frequency) ? '-- Hz' : `${Number(meter.frequency).toFixed(2)} Hz`;

  // 3. DHT22 SENSOR SECTION
  const temp = dht.temperature;
  const hum = dht.humidity;

  document.getElementById('dhtTemp').innerText = isInvalid(temp) ? '--' : Number(temp).toFixed(1);
  document.getElementById('dhtHum').innerText = isInvalid(hum) ? '--' : Number(hum).toFixed(1);

  // Check temperature & humidity alerts (>40°C, >80%)
  const tempAlert = document.getElementById('tempAlert');
  const humAlert = document.getElementById('humAlert');

  if (!isInvalid(temp) && Number(temp) > 40.0) {
    tempAlert.classList.remove('hidden');
    triggerAlertBanner('high-temp-banner', '⚠ HIGH TEMPERATURE ALERT! Panel Temp > 40.0 °C', 'high-temp');
  } else {
    tempAlert.classList.add('hidden');
    removeAlertBanner('high-temp-banner');
  }

  if (!isInvalid(hum) && Number(hum) > 80.0) {
    humAlert.classList.remove('hidden');
    triggerAlertBanner('high-hum-banner', '⚠ HIGH HUMIDITY ALERT! Panel Humidity > 80.0 %', 'high-hum');
  } else {
    humAlert.classList.add('hidden');
    removeAlertBanner('high-hum-banner');
  }

  // 4. SUMMARY METRICS HEADER
  document.getElementById('sumFreq').innerText = isInvalid(meter.frequency) ? '--' : Number(meter.frequency).toFixed(2);
  document.getElementById('sumPower').innerText = formatValRaw(meter.p_t);
  document.getElementById('sumPF').innerText = formatValRaw(meter.pf_t);

  let avgV = '--';
  if (!isInvalid(meter.v_r) && !isInvalid(meter.v_y) && !isInvalid(meter.v_b)) {
    avgV = ((Number(meter.v_r) + Number(meter.v_y) + Number(meter.v_b)) / 3.0).toFixed(1);
  }
  document.getElementById('sumAvgV').innerText = avgV;

  document.getElementById('sumTemp').innerText = isInvalid(temp) ? '--' : Number(temp).toFixed(1);
  document.getElementById('sumHum').innerText = isInvalid(hum) ? '--' : Number(hum).toFixed(1);

  // 5. UPDATE LIVE CHART TELEMETRY BUFFER (only if live chart is active)
  if (!isShowingHistorical) {
    pushChartBuffer(i1, i2, i3, i0, meter.v_r, meter.v_y, meter.v_b, temp, hum);
  }
}

// Helpers
function formatVal(val, unit) {
  if (isInvalid(val)) return `-- <span class="u">${unit}</span>`;
  return `${Number(val).toFixed(1)} <span class="u">${unit}</span>`;
}
function formatValRaw(val) {
  if (isInvalid(val)) return '--';
  return Number(val).toFixed(2);
}

function updatePhaseAlarm(elemId, val, threshold) {
  const pill = document.getElementById(elemId);
  if (!pill) return;
  if (!isInvalid(val) && Number(val) > threshold) {
    pill.innerText = 'ALARM';
    pill.className = 'fault-status-pill alarm';
  } else {
    pill.innerText = 'Normal';
    pill.className = 'fault-status-pill';
  }
}

/* Alert Banner Display */
function triggerAlertBanner(id, text, alertClass) {
  let banner = document.getElementById(id);
  const container = document.getElementById('alertContainer');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = id;
    banner.className = `alert-banner ${alertClass}`;
    banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${text}</span>`;
    container.appendChild(banner);
  }
}

function removeAlertBanner(id) {
  const banner = document.getElementById(id);
  if (banner) banner.remove();
}

/* ==========================================================================
   Chart.js Real-time / Historical Trend Graph (shared canvas)
   ========================================================================== */
function initChart() {
  const ctx = document.getElementById('telemetryChart').getContext('2d');

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.08)' },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 11 } }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#f1f5f9', font: { family: 'Plus Jakarta Sans', weight: '600' } }
        }
      }
    }
  });

  updateChartDatasets();
}

function switchChartMode(mode) {
  activeChartMode = mode;
  document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');

  if (isShowingHistorical) {
    updateHistoricalChart(currentHistoricalRecords);
  } else {
    updateChartDatasets();
  }
}

function updateChartDatasets() {
  if (!chartInstance) return;

  if (activeChartMode === 'currents') {
    chartInstance.data.datasets = [
      { label: 'Relay I1 (A)', data: chartDataBuffer.i1, borderColor: '#f43f5e', backgroundColor: 'rgba(244, 63, 94, 0.1)', tension: 0.3, borderWidth: 2 },
      { label: 'Relay I2 (A)', data: chartDataBuffer.i2, borderColor: '#eab308', backgroundColor: 'rgba(234, 179, 8, 0.1)', tension: 0.3, borderWidth: 2 },
      { label: 'Relay I3 (A)', data: chartDataBuffer.i3, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', tension: 0.3, borderWidth: 2 },
      { label: 'Relay I0 Earth (A)', data: chartDataBuffer.i0, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', tension: 0.3, borderWidth: 2, borderDash: [4, 4] }
    ];
  } else if (activeChartMode === 'voltages') {
    chartInstance.data.datasets = [
      { label: 'Meter V_R (V)', data: chartDataBuffer.vr, borderColor: '#f43f5e', tension: 0.3, borderWidth: 2 },
      { label: 'Meter V_Y (V)', data: chartDataBuffer.vy, borderColor: '#eab308', tension: 0.3, borderWidth: 2 },
      { label: 'Meter V_B (V)', data: chartDataBuffer.vb, borderColor: '#3b82f6', tension: 0.3, borderWidth: 2 }
    ];
  } else if (activeChartMode === 'environment') {
    chartInstance.data.datasets = [
      { label: 'Temp (°C)', data: chartDataBuffer.temp, borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.1)', tension: 0.3, borderWidth: 2 },
      { label: 'Humidity (%)', data: chartDataBuffer.hum, borderColor: '#06b6d4', backgroundColor: 'rgba(6, 182, 212, 0.1)', tension: 0.3, borderWidth: 2 }
    ];
  }

  chartInstance.update();
}

function pushChartBuffer(i1, i2, i3, i0, vr, vy, vb, temp, hum) {
  const maxSamples = 20;
  const timeLabel = new Date().toLocaleTimeString();

  chartDataBuffer.timestamps.push(timeLabel);
  chartDataBuffer.i1.push(isInvalid(i1) ? null : Number(i1));
  chartDataBuffer.i2.push(isInvalid(i2) ? null : Number(i2));
  chartDataBuffer.i3.push(isInvalid(i3) ? null : Number(i3));
  chartDataBuffer.i0.push(isInvalid(i0) ? null : Number(i0));

  chartDataBuffer.vr.push(isInvalid(vr) ? null : Number(vr));
  chartDataBuffer.vy.push(isInvalid(vy) ? null : Number(vy));
  chartDataBuffer.vb.push(isInvalid(vb) ? null : Number(vb));

  chartDataBuffer.temp.push(isInvalid(temp) ? null : Number(temp));
  chartDataBuffer.hum.push(isInvalid(hum) ? null : Number(hum));

  if (chartDataBuffer.timestamps.length > maxSamples) {
    chartDataBuffer.timestamps.shift();
    chartDataBuffer.i1.shift();
    chartDataBuffer.i2.shift();
    chartDataBuffer.i3.shift();
    chartDataBuffer.i0.shift();
    chartDataBuffer.vr.shift();
    chartDataBuffer.vy.shift();
    chartDataBuffer.vb.shift();
    chartDataBuffer.temp.shift();
    chartDataBuffer.hum.shift();
  }

  if (chartInstance) {
    chartInstance.data.labels = chartDataBuffer.timestamps;
    chartInstance.update('none');
  }
}

/* ==========================================================================
   HISTORICAL DATA MODULE
   Source of truth: PostgreSQL, accessed exclusively through FastAPI
   GET  /history  -> search/filter records
   DELETE /history -> remove records matching the selected filters
   ========================================================================== */

// Small numeric helpers used by table rendering, chart plotting and export
function numOrNull(v) {
  return isInvalid(v) ? null : Number(v);
}

function avgOf(a, b, c) {
  const vals = [a, b, c].filter(v => !isInvalid(v)).map(Number);
  if (vals.length === 0) return '--';
  return (vals.reduce((sum, v) => sum + v, 0) / vals.length).toFixed(1);
}

function showHistoryMessage(msg) {
  const msgEl = document.getElementById('historyMessage');
  const tableWrapper = document.getElementById('historyTableWrapper');
  if (msgEl) {
    msgEl.innerText = msg;
    msgEl.classList.remove('hidden');
  }
  if (tableWrapper) tableWrapper.classList.add('hidden');
}

function hideHistoryMessage() {
  const msgEl = document.getElementById('historyMessage');
  const tableWrapper = document.getElementById('historyTableWrapper');
  if (msgEl) msgEl.classList.add('hidden');
  if (tableWrapper) tableWrapper.classList.remove('hidden');
}

// Reads the current filter inputs (Start Date, End Date, Panel ID)
function getHistoryFilters() {
  const startDate = document.getElementById('histStart').value;
  const endDate = document.getElementById('histEnd').value;
  const panelId = document.getElementById('histPanelId').value.trim();
  return { startDate, endDate, panelId };
}

// Best-effort JSON parse of a fetch Response body. Returns null if the body
// isn't valid JSON (e.g. an empty body) instead of throwing.
async function safeReadJson(response) {
  try {
    return await response.json();
  } catch (_e) {
    return null;
  }
}

// GET /history?start_date=...&end_date=...&panel_id=...
async function fetchHistoricalData() {
  const { startDate, endDate, panelId } = getHistoryFilters();

  if (!startDate) {
    alert('Please select a Start Date.');
    return;
  }
  if (!endDate) {
    alert('Please select an End Date.');
    return;
  }

  if (new Date(startDate) > new Date(endDate)) {
    alert('Start date/time cannot be after End date/time.');
    return;
  }

  const params = new URLSearchParams();
  params.set('start_date', startDate);
  params.set('end_date', endDate);
  if (panelId) params.set('panel_id', panelId);

  showHistoryMessage('Loading historical records...');

  try {
    const response = await fetch(`${HISTORY_ENDPOINT}?${params.toString()}`);
    const payload = await safeReadJson(response);

    if (!response.ok) {
      // Surface the backend's actual validation/error message (e.g. a bad
      // date format) instead of a generic "unable to load" string.
      const detail = (payload && payload.detail) ? payload.detail : `Request failed (HTTP ${response.status}).`;
      throw new Error(detail);
    }

    const records = payload;

    if (!Array.isArray(records) || records.length === 0) {
      currentHistoricalRecords = [];
      renderHistoricalTable([]);
      showHistoryMessage('No historical records found.');
      return;
    }

    currentHistoricalRecords = records;
    isShowingHistorical = true;
    document.getElementById('resetLiveBtn').disabled = false;

    hideHistoryMessage();
    renderHistoricalTable(records);
    updateHistoricalChart(records);

  } catch (err) {
    console.error('Error fetching historical data from FastAPI:', err);
    currentHistoricalRecords = [];
    showHistoryMessage(err.message || 'Unable to load historical records. Please try again.');
  }
}

// Renders the Historical Records table using the fields returned by /history
// NOTE (View Details feature): an "Action" column is appended to every row.
// The summary table's original 10 columns are untouched.
function renderHistoricalTable(records) {
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!records || records.length === 0) {
    return;
  }

  records.forEach((r, index) => {
    const row = document.createElement('tr');

    const dt = r.timestamp ? new Date(r.timestamp) : null;
    const validDt = dt && !isNaN(dt.getTime());
    const dateStr = validDt ? dt.toLocaleDateString() : (r.timestamp ? String(r.timestamp).split(' ')[0] : '--');
    const timeStr = validDt ? dt.toLocaleTimeString() : (r.timestamp ? (String(r.timestamp).split(' ')[1] || '--') : '--');

    const relayStatus = r.current_relay_status ?? '--';
    const voltage = avgOf(r.meter_v_r, r.meter_v_y, r.meter_v_b);
    const current = avgOf(r.meter_i_r, r.meter_i_y, r.meter_i_b);
    const frequency = isInvalid(r.meter_frequency) ? '--' : Number(r.meter_frequency).toFixed(2);
    const temperature = isInvalid(r.temperature) ? '--' : Number(r.temperature).toFixed(1);
    const humidity = isInvalid(r.humidity) ? '--' : Number(r.humidity).toFixed(1);
    const faultStatus = r.live_fault_status || r.fault_status || '--';

    // index into currentHistoricalRecords is passed to the modal so no
    // second API call is needed - all fields are already in memory.
    row.innerHTML = `
      <td>${dateStr}</td>
      <td>${timeStr}</td>
      <td>${r.panel_id ?? '--'}</td>
      <td>${relayStatus}</td>
      <td>${voltage} V</td>
      <td>${current} A</td>
      <td>${frequency} Hz</td>
      <td>${temperature} °C</td>
      <td>${humidity} %</td>
      <td>${faultStatus}</td>
      <td class="action-col">
        <button class="view-details-btn" onclick="viewRecordDetails(${index})">
          <i class="fa-solid fa-eye"></i> View Details
        </button>
      </td>
    `;

    tbody.appendChild(row);
  });
}

// Plots the shared telemetry chart using historical records from /history
function updateHistoricalChart(records) {
  if (!chartInstance) return;

  if (!records || records.length === 0) {
    chartInstance.data.labels = [];
    chartInstance.data.datasets = [];
    chartInstance.update();
    return;
  }

  const timestamps = records.map(r => {
    const dt = new Date(r.timestamp);
    return !isNaN(dt.getTime()) ? `${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}` : String(r.timestamp);
  });

  if (activeChartMode === 'currents') {
    chartInstance.data.datasets = [
      { label: 'Relay I1 (A)', data: records.map(r => numOrNull(r.relay_i1)), borderColor: '#f43f5e', tension: 0.3, borderWidth: 2 },
      { label: 'Relay I2 (A)', data: records.map(r => numOrNull(r.relay_i2)), borderColor: '#eab308', tension: 0.3, borderWidth: 2 },
      { label: 'Relay I3 (A)', data: records.map(r => numOrNull(r.relay_i3)), borderColor: '#3b82f6', tension: 0.3, borderWidth: 2 },
      { label: 'Relay I0 Earth (A)', data: records.map(r => numOrNull(r.relay_i0)), borderColor: '#10b981', tension: 0.3, borderWidth: 2 }
    ];
  } else if (activeChartMode === 'voltages') {
    chartInstance.data.datasets = [
      { label: 'Meter V_R (V)', data: records.map(r => numOrNull(r.meter_v_r)), borderColor: '#f43f5e', tension: 0.3, borderWidth: 2 },
      { label: 'Meter V_Y (V)', data: records.map(r => numOrNull(r.meter_v_y)), borderColor: '#eab308', tension: 0.3, borderWidth: 2 },
      { label: 'Meter V_B (V)', data: records.map(r => numOrNull(r.meter_v_b)), borderColor: '#3b82f6', tension: 0.3, borderWidth: 2 }
    ];
  } else if (activeChartMode === 'environment') {
    chartInstance.data.datasets = [
      { label: 'Temp (°C)', data: records.map(r => numOrNull(r.temperature)), borderColor: '#f97316', tension: 0.3, borderWidth: 2 },
      { label: 'Humidity (%)', data: records.map(r => numOrNull(r.humidity)), borderColor: '#06b6d4', tension: 0.3, borderWidth: 2 }
    ];
  }

  chartInstance.data.labels = timestamps;
  chartInstance.update();
}

// "Show Live Chart" - return to live /latest polling on the shared chart
function resetToLiveChart() {
  isShowingHistorical = false;
  document.getElementById('resetLiveBtn').disabled = true;
  updateChartDatasets();
}

// Builds a flat, export-friendly row shape shared by Excel & PDF export
function buildExportRows(records) {
  return records.map(r => {
    const dt = r.timestamp ? new Date(r.timestamp) : null;
    const validDt = dt && !isNaN(dt.getTime());
    const dateStr = validDt ? dt.toLocaleDateString() : (r.timestamp ? String(r.timestamp).split(' ')[0] : '');
    const timeStr = validDt ? dt.toLocaleTimeString() : (r.timestamp ? (String(r.timestamp).split(' ')[1] || '') : '');

    return {
      Date: dateStr,
      Time: timeStr,
      'Panel ID': r.panel_id ?? '',
      'Relay Status': r.current_relay_status ?? '',
      'Voltage (V)': avgOf(r.meter_v_r, r.meter_v_y, r.meter_v_b),
      'Current (A)': avgOf(r.meter_i_r, r.meter_i_y, r.meter_i_b),
      'Frequency (Hz)': isInvalid(r.meter_frequency) ? '' : Number(r.meter_frequency).toFixed(2),
      'Temperature (C)': isInvalid(r.temperature) ? '' : Number(r.temperature).toFixed(1),
      'Humidity (%)': isInvalid(r.humidity) ? '' : Number(r.humidity).toFixed(1),
      'Fault Status': r.live_fault_status || r.fault_status || ''
    };
  });
}

// Export currently displayed records to an Excel (.xlsx) file
function exportExcel() {
  if (!currentHistoricalRecords || currentHistoricalRecords.length === 0) {
    alert('No historical records to export. Please search first.');
    return;
  }

  const rows = buildExportRows(currentHistoricalRecords);
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Historical Data');
  XLSX.writeFile(workbook, `historical_data_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Export currently displayed records to a PDF file
function exportPDF() {
  if (!currentHistoricalRecords || currentHistoricalRecords.length === 0) {
    alert('No historical records to export. Please search first.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(14);
  doc.text('Historical Data Export - MV Panel Monitoring System', 14, 15);

  const rows = buildExportRows(currentHistoricalRecords);
  const head = [Object.keys(rows[0])];
  const body = rows.map(r => Object.values(r));

  doc.autoTable({
    head,
    body,
    startY: 22,
    styles: { fontSize: 7 },
    headStyles: { fillColor: [6, 182, 212] }
  });

  doc.save(`historical_data_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// DELETE /history?start_date=...&end_date=...&panel_id=...
async function clearHistoricalData() {
  const { startDate, endDate, panelId } = getHistoryFilters();

  if (!startDate || !endDate) {
    alert('Please select Start Date and End Date before clearing data.');
    return;
  }

  if (new Date(startDate) > new Date(endDate)) {
    alert('Start date/time cannot be after End date/time.');
    return;
  }

  const confirmMsg = panelId
    ? `Delete all historical records for Panel "${panelId}" between the selected dates? This action is permanent!`
    : `Delete ALL historical records between the selected dates? This action is permanent!`;

  if (!confirm(confirmMsg)) {
    return;
  }

  const params = new URLSearchParams();
  params.set('start_date', startDate);
  params.set('end_date', endDate);
  if (panelId) params.set('panel_id', panelId);

  try {
    const response = await fetch(`${DELETE_HISTORY_ENDPOINT}?${params.toString()}`, {
      method: 'DELETE'
    });

    const payload = await safeReadJson(response);

    if (!response.ok) {
      const detail = (payload && payload.detail) ? payload.detail : `Request failed (HTTP ${response.status}).`;
      throw new Error(detail);
    }

    // Show the backend's real message/count rather than a hardcoded string.
    const message = (payload && payload.message)
      ? payload.message
      : 'Historical records deleted successfully.';
    alert(message);

    // Refresh the table and graph with whatever remains for this filter
    await fetchHistoricalData();

  } catch (err) {
    console.error('Error deleting historical data via FastAPI:', err);
    alert(err.message || 'Error deleting historical records. Please try again.');
  }
}

/* ==========================================================================
   NEW FEATURE: VIEW DETAILS MODAL
   ==========================================================================
   Opens a popup showing every field returned by GET /history for one
   selected record. No new API call is made - the record already lives in
   `currentHistoricalRecords` (the same array the table and export use).

   FIELD NAME NOTE:
   The summary table only reads fields it already knows the exact PostgreSQL
   column names for (panel_id, timestamp, meter_v_r, meter_frequency, etc.).
   The extra detail fields requested for this popup (relay pickups, PF/Power
   per phase, event info, fault record stages, etc.) were not previously
   consumed anywhere in this codebase, so their exact column names in your
   `/history` response are not yet confirmed here.

   To stay safe, `pick()` below tries a short list of the most likely column
   name variants for each field (e.g. "relay_pickup_phase" or "pickup_phase")
   and falls back to "--" if none match. If your actual API uses different
   column names, just add them to the relevant candidate array - no other
   code needs to change.
   ========================================================================== */

// Tries each candidate key (in order) against a record and returns the
// first defined, non-null value found. Returns null if none match.
function pick(record, candidates) {
  for (const key of candidates) {
    const val = record?.[key];
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return null;
}

// Formats a raw value for display inside the modal: numbers get fixed
// decimals when a unit is supplied, everything else is shown as-is.
function fmtDetail(val, unit = '', decimals = null) {
  if (val === null || val === undefined || val === '') return '--';
  if (decimals !== null && !isInvalid(val)) {
    return `${Number(val).toFixed(decimals)}${unit ? ' ' + unit : ''}`;
  }
  return `${val}${unit ? ' ' + unit : ''}`;
}

// Builds one label/value "detail-field" box
function detailFieldHTML(label, value) {
  return `
    <div class="detail-field">
      <span class="detail-field-label">${label}</span>
      <span class="detail-field-value">${value}</span>
    </div>
  `;
}

// Builds a full section card: title + icon + a grid of detail fields
function detailSectionHTML(icon, title, fieldsHTML) {
  return `
    <div class="detail-section">
      <div class="detail-section-title"><i class="${icon}"></i> ${title}</div>
      <div class="detail-fields-grid">
        ${fieldsHTML}
      </div>
    </div>
  `;
}

// Opens the modal for the record at the given index within
// currentHistoricalRecords (index comes from the "View Details" button).
function viewRecordDetails(index) {
  const record = currentHistoricalRecords[index];
  if (!record) {
    alert('Unable to load this record. Please search again.');
    return;
  }

  renderRecordDetailsModal(record);

  document.getElementById('recordDetailsOverlay').classList.remove('hidden');
  // Track which record is open so the export buttons know what to export.
  document.getElementById('recordDetailsOverlay').dataset.recordIndex = index;
}

function closeRecordDetails() {
  document.getElementById('recordDetailsOverlay').classList.add('hidden');
}

// Close the modal when clicking the dark overlay background (not the box itself)
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('recordDetailsOverlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeRecordDetails();
    });
  }
  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const ov = document.getElementById('recordDetailsOverlay');
      if (ov && !ov.classList.contains('hidden')) closeRecordDetails();
    }
  });
});

// Builds and injects all 7 section cards for the given record
function renderRecordDetailsModal(r) {
  const modalBody = document.getElementById('modalBody');
  if (!modalBody) return;

  const dt = r.timestamp ? new Date(r.timestamp) : null;
  const validDt = dt && !isNaN(dt.getTime());
  const fullTimestamp = validDt ? `${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}` : (r.timestamp || '--');

  document.getElementById('modalTitle').innerText = `Record Details - Panel ${r.panel_id ?? '--'}`;

  let html = '';

  // -------------------- SECTION 1: GENERAL INFORMATION --------------------
  html += detailSectionHTML('fa-solid fa-circle-info', 'General Information',
    detailFieldHTML('Panel ID', fmtDetail(r.panel_id)) +
    detailFieldHTML('Timestamp', fmtDetail(fullTimestamp)) +
    detailFieldHTML('Relay Status', fmtDetail(pick(r, ['current_relay_status', 'relay_status'])))
  );

  // -------------------- SECTION 2: RELAY INFORMATION --------------------
  html += detailSectionHTML('fa-solid fa-shield-halved', 'Relay Information',
    detailFieldHTML('Relay I1', fmtDetail(pick(r, ['relay_i1']), 'A', 2)) +
    detailFieldHTML('Relay I2', fmtDetail(pick(r, ['relay_i2']), 'A', 2)) +
    detailFieldHTML('Relay I3', fmtDetail(pick(r, ['relay_i3']), 'A', 2)) +
    detailFieldHTML('Relay I0', fmtDetail(pick(r, ['relay_i0']), 'A', 2)) +
    detailFieldHTML('Pickup Phase', fmtDetail(pick(r, ['relay_pickup_phase', 'pickup_phase']), 'A', 2)) +
    detailFieldHTML('Pickup Earth', fmtDetail(pick(r, ['relay_pickup_earth', 'pickup_earth']), 'A', 2)) +
    detailFieldHTML('Operation Counter', fmtDetail(pick(r, ['relay_op_counter', 'op_counter']))) +
    detailFieldHTML('Negative Sequence Current', fmtDetail(pick(r, ['relay_neg_seq', 'neg_seq']), 'A', 2)) +
    detailFieldHTML('Thermal Level', fmtDetail(pick(r, ['relay_thermal_level', 'thermal_level']), '%')) +
    detailFieldHTML('Relay RTC', fmtDetail(pick(r, ['relay_rtc', 'rtc'])))
  );

  // -------------------- SECTION 3: POWER QUALITY METER --------------------
  html += detailSectionHTML('fa-solid fa-gauge-high', 'Power Quality Meter',
    detailFieldHTML('Voltage R', fmtDetail(r.meter_v_r, 'V', 1)) +
    detailFieldHTML('Voltage Y', fmtDetail(r.meter_v_y, 'V', 1)) +
    detailFieldHTML('Voltage B', fmtDetail(r.meter_v_b, 'V', 1)) +
    detailFieldHTML('Current R', fmtDetail(pick(r, ['meter_i_r']), 'A', 1)) +
    detailFieldHTML('Current Y', fmtDetail(pick(r, ['meter_i_y']), 'A', 1)) +
    detailFieldHTML('Current B', fmtDetail(pick(r, ['meter_i_b']), 'A', 1)) +
    detailFieldHTML('Frequency', fmtDetail(r.meter_frequency, 'Hz', 2)) +
    detailFieldHTML('PF - R', fmtDetail(pick(r, ['meter_pf_r']), '', 2)) +
    detailFieldHTML('PF - Y', fmtDetail(pick(r, ['meter_pf_y']), '', 2)) +
    detailFieldHTML('PF - B', fmtDetail(pick(r, ['meter_pf_b']), '', 2)) +
    detailFieldHTML('Total PF', fmtDetail(pick(r, ['meter_pf_t']), '', 2)) +
    detailFieldHTML('Power R', fmtDetail(pick(r, ['meter_p_r']), 'kW', 2)) +
    detailFieldHTML('Power Y', fmtDetail(pick(r, ['meter_p_y']), 'kW', 2)) +
    detailFieldHTML('Power B', fmtDetail(pick(r, ['meter_p_b']), 'kW', 2)) +
    detailFieldHTML('Total Power', fmtDetail(pick(r, ['meter_p_t']), 'kW', 2))
  );

  // -------------------- SECTION 4: ENVIRONMENT --------------------
  html += detailSectionHTML('fa-solid fa-cloud-sun-rain', 'Environment',
    detailFieldHTML('Temperature', fmtDetail(r.temperature, '°C', 1)) +
    detailFieldHTML('Humidity', fmtDetail(r.humidity, '%', 1))
  );

  // -------------------- SECTION 5: EVENT INFORMATION --------------------
  html += detailSectionHTML('fa-solid fa-list-check', 'Event Information',
    detailFieldHTML('Event Type', fmtDetail(pick(r, ['event_type']))) +
    detailFieldHTML('Event Subtype', fmtDetail(pick(r, ['event_subtype']))) +
    detailFieldHTML('Event Timestamp', fmtDetail(pick(r, ['event_timestamp'])))
  );

  // -------------------- SECTION 6: FAULT INFORMATION --------------------
  html += detailSectionHTML('fa-solid fa-triangle-exclamation', 'Fault Information',
    detailFieldHTML('Current Fault Status', fmtDetail(pick(r, ['current_fault_status', 'current_relay_status']))) +
    detailFieldHTML('Live Fault Status', fmtDetail(pick(r, ['live_fault_status']))) +
    detailFieldHTML('Historical Fault Status', fmtDetail(pick(r, ['historical_fault_status', 'fault_status'])))
  );

  // -------------------- SECTION 7: FAULT RECORD --------------------
  const preStartFields =
    detailFieldHTML('I1', fmtDetail(pick(r, ['fr_pre_start_i1', 'pre_start_i1']), 'A', 2)) +
    detailFieldHTML('I2', fmtDetail(pick(r, ['fr_pre_start_i2', 'pre_start_i2']), 'A', 2)) +
    detailFieldHTML('I3', fmtDetail(pick(r, ['fr_pre_start_i3', 'pre_start_i3']), 'A', 2)) +
    detailFieldHTML('I0', fmtDetail(pick(r, ['fr_pre_start_i0', 'pre_start_i0']), 'A', 2));

  const atStartFields =
    detailFieldHTML('I1', fmtDetail(pick(r, ['fr_at_start_i1', 'at_start_i1']), 'A', 2)) +
    detailFieldHTML('I2', fmtDetail(pick(r, ['fr_at_start_i2', 'at_start_i2']), 'A', 2)) +
    detailFieldHTML('I3', fmtDetail(pick(r, ['fr_at_start_i3', 'at_start_i3']), 'A', 2)) +
    detailFieldHTML('I0', fmtDetail(pick(r, ['fr_at_start_i0', 'at_start_i0']), 'A', 2)) +
    detailFieldHTML('Start Timestamp', fmtDetail(pick(r, ['fr_at_start_time', 'at_start_time'])));

  const atTripFields =
    detailFieldHTML('I1', fmtDetail(pick(r, ['fr_at_trip_i1', 'at_trip_i1']), 'A', 2)) +
    detailFieldHTML('I2', fmtDetail(pick(r, ['fr_at_trip_i2', 'at_trip_i2']), 'A', 2)) +
    detailFieldHTML('I3', fmtDetail(pick(r, ['fr_at_trip_i3', 'at_trip_i3']), 'A', 2)) +
    detailFieldHTML('I0', fmtDetail(pick(r, ['fr_at_trip_i0', 'at_trip_i0']), 'A', 2)) +
    detailFieldHTML('Trip Timestamp', fmtDetail(pick(r, ['fr_at_trip_time', 'at_trip_time'])));

  const faultRecordFields = `
    <div class="detail-subgroup">
      <div class="detail-subgroup-title">Pre Start</div>
      <div class="detail-fields-grid">${preStartFields}</div>
    </div>
    <div class="detail-subgroup">
      <div class="detail-subgroup-title">At Start</div>
      <div class="detail-fields-grid">${atStartFields}</div>
    </div>
    <div class="detail-subgroup trip-subgroup">
      <div class="detail-subgroup-title">At Trip</div>
      <div class="detail-fields-grid">${atTripFields}</div>
    </div>
  `;

  html += `
    <div class="detail-section">
      <div class="detail-section-title"><i class="fa-solid fa-clock-rotate-left"></i> Fault Record</div>
      ${faultRecordFields}
    </div>
  `;

  modalBody.innerHTML = html;
}

// -------------------- Single-record export: Excel --------------------
function exportRecordExcel() {
  const overlay = document.getElementById('recordDetailsOverlay');
  const index = Number(overlay.dataset.recordIndex);
  const record = currentHistoricalRecords[index];
  if (!record) {
    alert('No record selected to export.');
    return;
  }

  const rows = buildFullExportRow(record);
  const worksheet = XLSX.utils.json_to_sheet([rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Record Detail');
  XLSX.writeFile(workbook, `record_${record.panel_id ?? 'panel'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// -------------------- Single-record export: PDF --------------------
function exportRecordPDF() {
  const overlay = document.getElementById('recordDetailsOverlay');
  const index = Number(overlay.dataset.recordIndex);
  const record = currentHistoricalRecords[index];
  if (!record) {
    alert('No record selected to export.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(14);
  doc.text(`Historical Record Detail - Panel ${record.panel_id ?? '--'}`, 14, 15);

  const rowObj = buildFullExportRow(record);
  const body = Object.entries(rowObj).map(([label, value]) => [label, String(value)]);

  doc.autoTable({
    head: [['Field', 'Value']],
    body,
    startY: 22,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [6, 182, 212] }
  });

  doc.save(`record_${record.panel_id ?? 'panel'}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// Flattens every field shown in the modal into one label -> value object,
// reused by both single-record export functions above.
function buildFullExportRow(r) {
  const dt = r.timestamp ? new Date(r.timestamp) : null;
  const validDt = dt && !isNaN(dt.getTime());
  const fullTimestamp = validDt ? `${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}` : (r.timestamp || '');

  return {
    'Panel ID': r.panel_id ?? '',
    'Timestamp': fullTimestamp,
    'Relay Status': pick(r, ['current_relay_status', 'relay_status']) ?? '',

    'Relay I1 (A)': pick(r, ['relay_i1']) ?? '',
    'Relay I2 (A)': pick(r, ['relay_i2']) ?? '',
    'Relay I3 (A)': pick(r, ['relay_i3']) ?? '',
    'Relay I0 (A)': pick(r, ['relay_i0']) ?? '',
    'Pickup Phase (A)': pick(r, ['relay_pickup_phase', 'pickup_phase']) ?? '',
    'Pickup Earth (A)': pick(r, ['relay_pickup_earth', 'pickup_earth']) ?? '',
    'Operation Counter': pick(r, ['relay_op_counter', 'op_counter']) ?? '',
    'Negative Sequence Current (A)': pick(r, ['relay_neg_seq', 'neg_seq']) ?? '',
    'Thermal Level (%)': pick(r, ['relay_thermal_level', 'thermal_level']) ?? '',
    'Relay RTC': pick(r, ['relay_rtc', 'rtc']) ?? '',

    'Voltage R (V)': r.meter_v_r ?? '',
    'Voltage Y (V)': r.meter_v_y ?? '',
    'Voltage B (V)': r.meter_v_b ?? '',
    'Current R (A)': pick(r, ['meter_i_r']) ?? '',
    'Current Y (A)': pick(r, ['meter_i_y']) ?? '',
    'Current B (A)': pick(r, ['meter_i_b']) ?? '',
    'Frequency (Hz)': r.meter_frequency ?? '',
    'PF-R': pick(r, ['meter_pf_r']) ?? '',
    'PF-Y': pick(r, ['meter_pf_y']) ?? '',
    'PF-B': pick(r, ['meter_pf_b']) ?? '',
    'Total PF': pick(r, ['meter_pf_t']) ?? '',
    'Power R (kW)': pick(r, ['meter_p_r']) ?? '',
    'Power Y (kW)': pick(r, ['meter_p_y']) ?? '',
    'Power B (kW)': pick(r, ['meter_p_b']) ?? '',
    'Total Power (kW)': pick(r, ['meter_p_t']) ?? '',

    'Temperature (C)': r.temperature ?? '',
    'Humidity (%)': r.humidity ?? '',

    'Event Type': pick(r, ['event_type']) ?? '',
    'Event Subtype': pick(r, ['event_subtype']) ?? '',
    'Event Timestamp': pick(r, ['event_timestamp']) ?? '',

    'Current Fault Status': pick(r, ['current_fault_status', 'current_relay_status']) ?? '',
    'Live Fault Status': pick(r, ['live_fault_status']) ?? '',
    'Historical Fault Status': pick(r, ['historical_fault_status', 'fault_status']) ?? '',

    'Fault Record Pre-Start I1 (A)': pick(r, ['fr_pre_start_i1', 'pre_start_i1']) ?? '',
    'Fault Record Pre-Start I2 (A)': pick(r, ['fr_pre_start_i2', 'pre_start_i2']) ?? '',
    'Fault Record Pre-Start I3 (A)': pick(r, ['fr_pre_start_i3', 'pre_start_i3']) ?? '',
    'Fault Record Pre-Start I0 (A)': pick(r, ['fr_pre_start_i0', 'pre_start_i0']) ?? '',

    'Fault Record At-Start I1 (A)': pick(r, ['fr_at_start_i1', 'at_start_i1']) ?? '',
    'Fault Record At-Start I2 (A)': pick(r, ['fr_at_start_i2', 'at_start_i2']) ?? '',
    'Fault Record At-Start I3 (A)': pick(r, ['fr_at_start_i3', 'at_start_i3']) ?? '',
    'Fault Record At-Start I0 (A)': pick(r, ['fr_at_start_i0', 'at_start_i0']) ?? '',
    'Fault Record Start Timestamp': pick(r, ['fr_at_start_time', 'at_start_time']) ?? '',

    'Fault Record At-Trip I1 (A)': pick(r, ['fr_at_trip_i1', 'at_trip_i1']) ?? '',
    'Fault Record At-Trip I2 (A)': pick(r, ['fr_at_trip_i2', 'at_trip_i2']) ?? '',
    'Fault Record At-Trip I3 (A)': pick(r, ['fr_at_trip_i3', 'at_trip_i3']) ?? '',
    'Fault Record At-Trip I0 (A)': pick(r, ['fr_at_trip_i0', 'at_trip_i0']) ?? '',
    'Fault Record Trip Timestamp': pick(r, ['fr_at_trip_time', 'at_trip_time']) ?? ''
  };
}
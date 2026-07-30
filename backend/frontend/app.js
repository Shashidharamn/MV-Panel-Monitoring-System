/* ==========================================================================
   Substation Live Dashboard - Real-time Application Logic (MQTT Cloud Support)
   ========================================================================== */

let ws = null;
let mqttClient = null;

const API_URL = "https://mv-panel-monitoring-system.onrender.com/latest";

let isSimulating = false;
let simInterval = null;

let chartInstance = null;
let activeChartMode = 'currents'; // 'currents' | 'voltages' | 'environment'
let currentMode = 'mqtt'; // 'mqtt' | 'ws'

// Helper function to check for null, undefined, or NaN safely
function isInvalid(val) {
  return val === null || val === undefined || isNaN(Number(val));
}

// Historical chart telemetry buffer (last 20 samples)
const chartDataBuffer = {
  timestamps: [],
  i1: [], i2: [], i3: [], i0: [],
  vr: [], vy: [], vb: [],
  temp: [], hum: []
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initChart();
    updateTimestamp();

    // Load data immediately
    fetchLatestData();

    // Refresh every 3 seconds
    setInterval(fetchLatestData, 3000);
});


// Switch connection mode UI controls
function switchConnMode() {
  const mode = document.getElementById('connMode').value;
  currentMode = mode;
  const mqttGroup = document.getElementById('mqttTopicGroup');
  const wsGroup = document.getElementById('wsIpGroup');

  if (mode === 'ws') {
    mqttGroup.classList.add('hidden');
    wsGroup.classList.remove('hidden');
  } else {
    mqttGroup.classList.remove('hidden');
    wsGroup.classList.add('hidden');
    toggleMqttConnection();
  }
}

// Update top header timestamp
function updateTimestamp() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0');
  document.getElementById('lastUpdated').innerText = timeStr;
}

/* ==========================================================================
   MQTT Cloud Connection Handling (HiveMQ / EMQX / Mosquitto via WebSockets)
   ========================================================================== */
function toggleMqttConnection() {
  if (isSimulating) {
    toggleSimulation(false);
  }

  if (mqttClient && mqttClient.connected) {
    mqttClient.end();
    setConnectionState('offline', 'Cloud Disconnected');
    document.getElementById('mqttConnectBtn').innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Connect Cloud';
    return;
  }

  const topic = document.getElementById('mqttTopic').value.trim() || 'substation/telemetry/rej601_ems01';
  const mode = document.getElementById('connMode').value;

  let brokerUrl = 'wss://broker.hivemq.com:8884/mqtt'; // Default ultra-fast mobile broker
  if (mode === 'emqx') {
    brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
  } else if (mode === 'mosquitto') {
    brokerUrl = 'wss://test.mosquitto.org:8081/mqtt';
  }

  setConnectionState('offline', 'Connecting Cloud MQTT...');
  document.getElementById('mqttConnectBtn').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting...';

  try {
    mqttClient = mqtt.connect(brokerUrl, {
      clientId: 'dashboard_mobile_' + Math.random().toString(16).substring(2, 10),
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 3000
    });

    mqttClient.on('connect', () => {
      setConnectionState('online', `Cloud Connected (${topic})`);
      document.getElementById('mqttConnectBtn').innerHTML = '<i class="fa-solid fa-cloud-xmark"></i> Disconnect';

      mqttClient.subscribe(topic, { qos: 0 }, (err) => {
        if (err) console.error('Subscription error:', err);
        else console.log('Subscribed successfully to topic:', topic);
      });
    });

    mqttClient.on('message', (receivedTopic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        processTelemetryData(payload);
      } catch (err) {
        console.error('Error parsing MQTT JSON payload:', err);
      }
    });

    mqttClient.on('error', (err) => {
      console.error('MQTT Error:', err);
      setConnectionState('offline', 'Cloud Error');
    });

    mqttClient.on('close', () => {
      setConnectionState('offline', 'Cloud Disconnected');
      document.getElementById('mqttConnectBtn').innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Connect Cloud';
    });

  } catch (ex) {
    console.error('Failed to create MQTT client:', ex);
    setConnectionState('offline', 'MQTT Failed');
    document.getElementById('mqttConnectBtn').innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Connect Cloud';
  }
}

/* ==========================================================================
   Direct WebSocket Connection Handling
   ========================================================================== */
function toggleConnection() {
  if (isSimulating) {
    toggleSimulation(false);
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close();
    setConnectionState('offline', 'Disconnected');
    document.getElementById('connectBtn').innerHTML = '<i class="fa-solid fa-plug"></i> Connect WS';
    return;
  }

  const ip = document.getElementById('wsIp').value.trim();
  if (!ip) {
    alert('Please enter a valid ESP32 IP address.');
    return;
  }

  const wsUrl = `ws://${ip}/ws`;
  setConnectionState('offline', 'Connecting WS...');
  document.getElementById('connectBtn').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting';

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setConnectionState('online', `Connected WS (${ip})`);
      document.getElementById('connectBtn').innerHTML = '<i class="fa-solid fa-plug-circle-xmark"></i> Disconnect';
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        processTelemetryData(payload);
      } catch (err) {
        console.error('Error parsing JSON from WebSocket:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
      setConnectionState('offline', 'WS Error');
    };

    ws.onclose = () => {
      setConnectionState('offline', 'Disconnected');
      document.getElementById('connectBtn').innerHTML = '<i class="fa-solid fa-plug"></i> Connect WS';
    };

  } catch (ex) {
    console.error('Failed to create WebSocket:', ex);
    setConnectionState('offline', 'Connection Failed');
    document.getElementById('connectBtn').innerHTML = '<i class="fa-solid fa-plug"></i> Connect WS';
  }
}

function setConnectionState(state, text) {
  const dot = document.querySelector('.status-dot');
  const txt = document.getElementById('statusText');
  dot.className = `status-dot ${state}`;
  txt.innerText = text;
}

/* ==========================================================================
   Simulation Mode (Offline Preview)
   ========================================================================== */
function toggleSimulation(forceState) {
  if (forceState !== undefined) {
    isSimulating = !forceState;
  }

  if (!isSimulating) {
    if (ws) ws.close();
    if (mqttClient) mqttClient.end();
    isSimulating = true;
    document.getElementById('simText').innerText = 'Disable Demo Mode';
    document.getElementById('simBtn').style.background = 'linear-gradient(135deg, #10b981, #047857)';
    setConnectionState('simulating', 'Demo Mode (Simulated Data)');
    
    // Generate simulated telemetry every 3 seconds (matching POLL_INTERVAL_MS)
    generateSimulatedData();
    simInterval = setInterval(generateSimulatedData, 3000);
  } else {
    isSimulating = false;
    clearInterval(simInterval);
    document.getElementById('simText').innerText = 'Enable Demo Mode';
    document.getElementById('simBtn').style.background = 'linear-gradient(135deg, #d97706, #b45309)';
    setConnectionState('offline', 'Disconnected');
  }
}

function generateSimulatedData() {
  const baseI = 15.0 + (Math.random() * 4.0 - 2.0);
  const baseV = 230.0 + (Math.random() * 6.0 - 3.0);

  const mockPayload = {
    relay: {
      sg_active: 1,
      pickup_phase: 30.0,
      pickup_earth: 15.0,
      op_counter: 14,
      i1: +(baseI + (Math.random() * 0.8)).toFixed(2),
      i2: +(baseI + (Math.random() * 0.8)).toFixed(2),
      i3: +(baseI + (Math.random() * 0.8)).toFixed(2),
      i0: +(Math.random() * 0.4).toFixed(2),
      neg_seq: +(Math.random() * 0.5).toFixed(2),
      thermal_level: Math.floor(25 + Math.random() * 10),
      rtc: `${new Date().getDate().toString().padStart(2,'0')}/${(new Date().getMonth()+1).toString().padStart(2,'0')}/2026 ${new Date().toLocaleTimeString()}.000`,
      event: {
        type: 3,
        subtype: 12,
        timestamp: "25/07/26 14:30:15.120"
      },
      fault_record1: {
        pre_start: "I1=0.00A I2=0.00A I3=0.00A I0=0.00A",
        at_start: "I1=28.50A I2=29.10A I3=28.80A I0=0.20A",
        at_start_time: "25/07/26 14:28:10.050",
        at_trip: "I1=35.20A I2=34.90A I3=36.10A I0=0.40A",
        at_trip_time: "25/07/26 14:28:10.150",
        p80: "I1=0.00A I2=0.00A I3=0.00A I0=0.00A",
        p200: "I1=0.00A I2=0.00A I3=0.00A I0=0.00A"
      }
    },
    meter: {
      v_r: +(baseV + (Math.random() * 2)).toFixed(1),
      v_y: +(baseV + (Math.random() * 2)).toFixed(1),
      v_b: +(baseV + (Math.random() * 2)).toFixed(1),
      i_r: +(baseI + (Math.random() * 0.5)).toFixed(2),
      i_y: +(baseI + (Math.random() * 0.5)).toFixed(2),
      i_b: +(baseI + (Math.random() * 0.5)).toFixed(2),
      frequency: +(50.0 + (Math.random() * 0.1 - 0.05)).toFixed(2),
      pf_r: 0.98,
      pf_y: 0.97,
      pf_b: 0.98,
      pf_t: 0.98,
      p_r: 3.45,
      p_y: 3.42,
      p_b: 3.48,
      p_t: 10.35
    },
    dht: {
      temperature: +(28.5 + (Math.random() * 3.0)).toFixed(1),
      humidity: +(62.0 + (Math.random() * 5.0)).toFixed(1)
    }
  };

  if (Math.random() < 0.25) {
    mockPayload.dht.temperature = 42.5; // > 40°C threshold
  }

  processTelemetryData(mockPayload);
}

/* ==========================================================================
   Telemetry Processing & UI Updates
   ========================================================================== */
function processTelemetryData(data) {
  updateTimestamp();

  const relay = data.relay || {};
  const meter = data.meter || {};
  const dht = data.dht || {};

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

  // Evaluate Phase Overcurrent & Earth Fault pills
  updatePhasePill('pillI1', i1, pickupIphase);
  updatePhasePill('pillI2', i2, pickupIphase);
  updatePhasePill('pillI3', i3, pickupIphase);
  updatePhasePill('pillI0', i0, pickupIearth);

  // Evaluate Combined Fault Diagnosis Banner
  evaluateFaultDiagnosis(i1, i2, i3, i0, pickupIphase, pickupIearth);

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

  // 5. UPDATE CHART TELEMETRY BUFFER
  pushChartBuffer(i1, i2, i3, i0, meter.v_r, meter.v_y, meter.v_b, temp, hum);
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

function updatePhasePill(elemId, val, threshold) {
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

function evaluateFaultDiagnosis(i1, i2, i3, i0, pickupPhase, pickupEarth) {
  const banner = document.getElementById('faultSummaryBanner');
  const icon = document.getElementById('faultIcon');
  const text = document.getElementById('faultSummaryText');

  const p1 = !isInvalid(i1) && Number(i1) > pickupPhase;
  const p2 = !isInvalid(i2) && Number(i2) > pickupPhase;
  const p3 = !isInvalid(i3) && Number(i3) > pickupPhase;
  const gnd = !isInvalid(i0) && Number(i0) > pickupEarth;
  const phaseCount = (p1 ? 1 : 0) + (p2 ? 1 : 0) + (p3 ? 1 : 0);

  const multiPhaseOC = (phaseCount >= 2);
  const singlePhaseOCNoGround = (phaseCount === 1 && !gnd);

  if (!multiPhaseOC && !singlePhaseOCNoGround && !gnd) {
    banner.className = 'fault-summary-banner healthy';
    icon.className = 'fa-solid fa-circle-check';
    text.innerText = 'No Fault Detected (System Normal)';
  } else {
    banner.className = 'fault-summary-banner faulted';
    icon.className = 'fa-solid fa-triangle-exclamation';

    let faultDesc = 'Fault Detected: ';
    const parts = [];
    if (multiPhaseOC) parts.push('O/C (Phase-to-Phase Overcurrent)');
    else if (singlePhaseOCNoGround) parts.push('O/C (Single-Phase Overcurrent)');

    if (gnd) parts.push('E/F (Earth Fault Current)');

    text.innerText = faultDesc + parts.join(' + ');
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

// Remove alert banner helper
function removeAlertBanner(id) {
  const banner = document.getElementById(id);
  if (banner) banner.remove();
}

/* ==========================================================================
   Chart.js Real-time Trend Graphs
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
  updateChartDatasets();
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
// ===============================
// Fetch latest data from FastAPI
// ===============================
async function fetchLatestData() {
    console.log("fetchLatestData called");
    try {
        const response = await fetch(API_URL);

        if (!response.ok) {
            throw new Error("Failed to fetch data");
        }

        const data = await response.json();

        console.log("Latest Data:", data);

        processTelemetryData({
            meter: {
                v_r: data.vr,
                v_y: data.vy,
                v_b: data.vb,
                i_r: data.ir,
                i_y: data.iy,
                i_b: data.ib,
                frequency: data.frequency,
                pf_r: data.pf_r,
                pf_y: data.pf_y,
                pf_b: data.pf_b,
                pf_t: data.pf_total,
                p_r: data.power_r,
                p_y: data.power_y,
                p_b: data.power_b,
                p_t: data.power_total
            },
            relay: {},
            dht: {}
        });

    } catch (err) {
        console.error("API Error:", err);
    }
}
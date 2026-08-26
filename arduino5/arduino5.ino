#include <ModbusMaster.h>
#include <string.h>
#include <DHT.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

// ---------------- Shared bus / transceiver pins ----------------
#define RXD2            16
#define TXD2            17
#define MAX485_DE_RE    4

// ---------------- Relay (ABB REJ601/REF601) config ----------------
#define RELAY_SLAVE_ID     1
#define RELAY_BAUD         19200
#define IPN_PRIMARY_CT     30
#define SETTINGS_REFRESH_EVERY_N_POLLS  20

// ---------------- Meter (EMS-01) config ----------------
#define METER_SLAVE_ID     3
#define METER_BAUD         19200

// Minimum plausible magnitude for a Voltage/Current/Frequency reading.
#define METER_MIN_VALID_MAG  1.0

// Set to 1 to print the raw register words for meter float decoding
#define DEBUG_METER_RAW 1

// ---------------- DHT22 config ----------------
#define DHTPIN          14
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

const float HIGH_TEMP = 40.0;   // High temperature threshold (C)
const float HIGH_HUM  = 80.0;   // High humidity threshold (%)

float dht_temperature = NAN;
float dht_humidity    = NAN;

#define DHT_POLL_INTERVAL_MS 3000
unsigned long lastDhtPollMs = 0;

// ---------------- Wi-Fi / Render backend ----------------
// Fill in your actual Wi-Fi credentials before uploading.
const char* WIFI_SSID     = "BSNL FTTH";
const char* WIFI_PASSWORD = "8162000164";
const char* SERVER_URL    = "https://mv-panel-monitoring-system-qobz.onrender.com/sensor";
const char* PANEL_ID      = "PANEL001";

const char* NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET_SEC = 19800;       // IST = UTC+5:30
const int DAYLIGHT_OFFSET_SEC = 0;

#define WIFI_RECONNECT_INTERVAL_MS 10000
unsigned long lastWiFiAttemptMs = 0;
#define HTTP_POST_INTERVAL_MS 3000
unsigned long lastHttpPostMs = 0;

// ---------------- Shared poll timing ----------------
#define POLL_INTERVAL_MS   3000
unsigned long lastPollMs = 0;

ModbusMaster node;
volatile uint32_t deReDelayUs = 500;

void preTransmission() {
  digitalWrite(MAX485_DE_RE, HIGH);
  delayMicroseconds(deReDelayUs);
}
void postTransmission() {
  delayMicroseconds(deReDelayUs);
  digitalWrite(MAX485_DE_RE, LOW);
}

// Re-point the shared UART/ModbusMaster instance at the relay.
void configureForRelay() {
  Serial2.begin(RELAY_BAUD, SERIAL_8N2, RXD2, TXD2); // 8 data, no parity, 2 stop bits
  deReDelayUs = 50;
  node.begin(RELAY_SLAVE_ID, Serial2);
}

// Re-point the shared UART/ModbusMaster instance at the meter.
void configureForMeter() {
  Serial2.begin(METER_BAUD, SERIAL_8N1, RXD2, TXD2);
  deReDelayUs = 500;
  node.begin(METER_SLAVE_ID, Serial2);
}

// =====================================================================
// ---------------------------- RELAY CODE ----------------------------
// =====================================================================

float pickupIphase = 16;     // Amps, from I> setting
float pickupIearth = 15;   // Amps, from I0> setting

uint16_t pollCount      = 0;
uint16_t activeSettingGroup = 1;
float relay_I1 = NAN, relay_I2 = NAN, relay_I3 = NAN, relay_I0 = NAN;
float relay_negSeq = NAN;
uint16_t relay_thermalLevel = 0;

char iedStatusStr[40] = "Unknown";
uint16_t lastIedStatusRaw = 0xFFFF; // sentinel = "not read yet"
bool haveIedBaseline = false;
char liveFaultStatus[96] = "No Fault Detected";

// Latest stored fault record values (sent to backend).
float fr_prestart_i1 = 0, fr_prestart_i2 = 0, fr_prestart_i3 = 0, fr_prestart_i0 = 0;
float fr_atstart_i1 = 0, fr_atstart_i2 = 0, fr_atstart_i3 = 0, fr_atstart_i0 = 0;
float fr_attrip_i1 = 0, fr_attrip_i2 = 0, fr_attrip_i3 = 0, fr_attrip_i0 = 0;
float fr_p80_i1 = 0, fr_p80_i2 = 0, fr_p80_i3 = 0, fr_p80_i0 = 0;
float fr_p200_i1 = 0, fr_p200_i2 = 0, fr_p200_i3 = 0, fr_p200_i0 = 0;
String relayRtc = "N/A";
String fr_atstart_timestamp = "N/A";
String fr_attrip_timestamp = "N/A";

String formatTimestamp(uint16_t ddmm, uint16_t yyhh, uint16_t mmss, uint16_t msec) {
  uint8_t dd = ddmm >> 8, mm = ddmm & 0xFF;
  uint8_t yy = yyhh >> 8, hh = yyhh & 0xFF;
  uint8_t mi = mmss >> 8, ss = mmss & 0xFF;
  char buf[40];
  snprintf(buf, sizeof(buf), "20%02u-%02u-%02u %02u:%02u:%02u.%03u",
           yy, mm, dd, hh, mi, ss, msec);
  return String(buf);
}

void printTimestamp(uint16_t ddmm, uint16_t yyhh, uint16_t mmss, uint16_t msec) {
  Serial.print(formatTimestamp(ddmm, yyhh, mmss, msec));
}

void printModbusError(uint8_t result) {
  Serial.print("  -> Error: ");
  switch (result) {
    case node.ku8MBIllegalFunction:     Serial.println("Illegal Function"); break;
    case node.ku8MBIllegalDataAddress:  Serial.println("Illegal Data Address"); break;
    case node.ku8MBIllegalDataValue:    Serial.println("Illegal Data Value"); break;
    case node.ku8MBSlaveDeviceFailure:  Serial.println("Slave Device Failure"); break;
    case node.ku8MBInvalidSlaveID:      Serial.println("Invalid Slave ID (mismatch)"); break;
    case node.ku8MBInvalidFunction:     Serial.println("Invalid Function (mismatch)"); break;
    case node.ku8MBResponseTimedOut:    Serial.println("Timeout - check wiring/parity/baud/address"); break;
    case node.ku8MBInvalidCRC:          Serial.println("CRC Error - check baud/parity/noise"); break;
    default:                            Serial.printf("Unknown (0x%02X)\n", result); break;
  }
}

// Per manual Section 2.5.1: Actual Current = (RegisterValue * Ipn) / 1000
//
// NOTE ON SCALING BUG: live currents (register 512+, see readCurrents())
// use IPN_PRIMARY_CT=30 and produce correct values (e.g. 7.05A matches
// expected). Fault record currents (register 0+, this function) use the
// SAME constant but come out ~10x too low (1.4A instead of ~14.5A
// expected). That points to the fault record registers using a
// DIFFERENT reference/scale than the live registers - most likely the
// relay's configured "Ipn" (rated primary current) setting is not the
// same number as your physical CT ratio (IPN_PRIMARY_CT=30).
//
// FIX: use a separate, adjustable constant for fault records so the
// two paths can be tuned independently instead of sharing one constant
// that only worked for one of them. Start by trying x10, since the
// observed error is close to exactly 10x - if that's not exactly right,
// adjust FAULT_RECORD_SCALE_FACTOR until a known fault matches expected.
#define FAULT_RECORD_SCALE_FACTOR   (IPN_PRIMARY_CT * 10.0)

float faultRegToAmps(uint16_t raw) {
  return (raw / 1000.0) * FAULT_RECORD_SCALE_FACTOR;
}

void readProtectionPickups() {
  uint16_t sgActive = 1;
  uint8_t r = node.readHoldingRegisters(4119, 1); // Setting Group Activation
  if (r == node.ku8MBSuccess) {
    sgActive = node.getResponseBuffer(0);
    activeSettingGroup = sgActive;
  } else {
    Serial.println("  (Could not read active Setting Group, assuming SG1)");
  }

  uint16_t iSetAddr  = (sgActive == 2) ? 7938 : 4098;
  uint16_t i0SetAddr = (sgActive == 2) ? 7946 : 4106;

  r = node.readHoldingRegisters(iSetAddr, 1);
  if (r == node.ku8MBSuccess) {
    pickupIphase = (node.getResponseBuffer(0) / 1000.0) * (float)IPN_PRIMARY_CT;
  } else {
    Serial.print("  I> read failed: "); printModbusError(r);
  }

  r = node.readHoldingRegisters(i0SetAddr, 1);
  if (r == node.ku8MBSuccess) {
    pickupIearth = (node.getResponseBuffer(0) / 1000.0) * (float)IPN_PRIMARY_CT;
  } else {
    Serial.print("  I0> read failed: "); printModbusError(r);
  }

  Serial.printf("Active SG: %u | I> pickup: %.2fA | I0> pickup: %.2fA\n",
                sgActive, pickupIphase, pickupIearth);
}
void printFaultConditions(float i1, float i2, float i3, float i0,
                           float phaseThreshold, float earthThreshold,
                           char* outStatus, size_t outStatusSize) {
  bool oc  = (i1 > phaseThreshold) || (i2 > phaseThreshold) || (i3 > phaseThreshold);
  bool ef  = (i0 > earthThreshold);

  Serial.printf("  I1: %.2fA | I2: %.2fA | I3: %.2fA  (pickup %.2fA)\n", i1, i2, i3, phaseThreshold);
  Serial.printf("  I0: %.2fA  (pickup %.2fA)\n", i0, earthThreshold);

  char statusBuf[96];

  Serial.print(" FAULTS: ");
  if (!oc && !ef) {
    Serial.println("No Fault Detected");
    snprintf(statusBuf, sizeof(statusBuf), "No Fault Detected");
  } else if (oc && ef) {
    Serial.println("O/C & E/F TRIP");
    snprintf(statusBuf, sizeof(statusBuf), "O/C & E/F TRIP");
  } else if (oc) {
    Serial.println("O/C TRIP");
    snprintf(statusBuf, sizeof(statusBuf), "O/C TRIP");
  } else {
    Serial.println("E/F TRIP");
    snprintf(statusBuf, sizeof(statusBuf), "E/F TRIP");
  }

  if (outStatus != nullptr && outStatusSize > 0) {
    strncpy(outStatus, statusBuf, outStatusSize - 1);
    outStatus[outStatusSize - 1] = '\0';
  }
}

bool readCurrents() {
  Serial.println("---- Currents ----");
  uint8_t result = node.readInputRegisters(512, 7);
  if (result != node.ku8MBSuccess) { printModbusError(result); return false; }

  uint16_t i1_raw = node.getResponseBuffer(0);
  uint16_t i2_raw = node.getResponseBuffer(1);
  uint16_t i3_raw = node.getResponseBuffer(2);
  uint16_t i0_raw = node.getResponseBuffer(3);
  uint16_t negSeqRaw    = node.getResponseBuffer(5);
  uint16_t thermalLevel = node.getResponseBuffer(6);

  relay_I1 = (i1_raw * (float)IPN_PRIMARY_CT) / 1000.0;
  relay_I2 = (i2_raw * (float)IPN_PRIMARY_CT) / 1000.0;
  relay_I3 = (i3_raw * (float)IPN_PRIMARY_CT) / 1000.0;
  relay_I0 = (i0_raw * (float)IPN_PRIMARY_CT) / 1000.0;
  relay_negSeq = (negSeqRaw * (float)IPN_PRIMARY_CT) / 1000.0;
  relay_thermalLevel = thermalLevel;

  Serial.printf("I1: %.2f A | I2: %.2f A | I3: %.2f A | I0: %.2f A\n",
                relay_I1, relay_I2, relay_I3, relay_I0);
  Serial.printf("Neg. seq: %.2f A | Thermal level: %u%%\n",
                relay_negSeq, relay_thermalLevel);

  Serial.println("Live condition:");
  printFaultConditions(relay_I1, relay_I2, relay_I3, relay_I0, pickupIphase, pickupIearth,
                       liveFaultStatus, sizeof(liveFaultStatus));

  return true;
}

void readRtc() {
  Serial.println("---- Relay Date/Time ----");
  uint8_t result = node.readHoldingRegisters(4877, 7);
  if (result != node.ku8MBSuccess) { printModbusError(result); return; }

  uint16_t dd = node.getResponseBuffer(0);
  uint16_t mm = node.getResponseBuffer(1);
  uint16_t yy = node.getResponseBuffer(2);
  uint16_t hh = node.getResponseBuffer(3);
  uint16_t mi = node.getResponseBuffer(4);
  uint16_t ss = node.getResponseBuffer(5);
  uint16_t ms = node.getResponseBuffer(6);

  uint16_t ddmm = (uint16_t)((dd << 8) | mm);
  uint16_t yyhh = (uint16_t)((yy << 8) | hh);
  uint16_t mmss = (uint16_t)((mi << 8) | ss);
  relayRtc = formatTimestamp(ddmm, yyhh, mmss, ms);
  Serial.println(relayRtc);
}

bool readIedStatus() {
  Serial.println("---- IED Status (register 288) ----");
  uint8_t result = node.readInputRegisters(288, 1);
  if (result != node.ku8MBSuccess) { printModbusError(result); return false; }

  uint16_t status = node.getResponseBuffer(0);
  switch (status) {
    case 0x0000: snprintf(iedStatusStr, sizeof(iedStatusStr), "Internal Relay Fault"); break;
    case 0x0004: snprintf(iedStatusStr, sizeof(iedStatusStr), "Unit Ready - No Trip"); break;
    case 0x0005: snprintf(iedStatusStr, sizeof(iedStatusStr), "Unit Ready - Phase Trip"); break;
    case 0x0006: snprintf(iedStatusStr, sizeof(iedStatusStr), "Unit Ready - Earth Trip"); break;
    default:     snprintf(iedStatusStr, sizeof(iedStatusStr), "Unknown (0x%04X)", status); break;
  }
  Serial.printf("IED Status: %s\n", iedStatusStr);

  bool changed = false;
  if (haveIedBaseline && status != lastIedStatusRaw) {
    changed = true;
  }
  lastIedStatusRaw = status;
  haveIedBaseline = true;
  return changed;
}

void readFaultRecord1() {
  Serial.println("---- Fault Record 1 (LAST STORED TRIP - historical, NOT live) ----");
  uint8_t result = node.readInputRegisters(0, 28);
  if (result != node.ku8MBSuccess) { printModbusError(result); return; }

  uint16_t b[28];
  for (int i = 0; i < 28; i++) b[i] = node.getResponseBuffer(i);

  float ps_i1 = faultRegToAmps(b[0]),  ps_i2 = faultRegToAmps(b[1]);
  float ps_i3 = faultRegToAmps(b[2]),  ps_i0 = faultRegToAmps(b[3]);
  float as_i1 = faultRegToAmps(b[4]),  as_i2 = faultRegToAmps(b[5]);
  float as_i3 = faultRegToAmps(b[6]),  as_i0 = faultRegToAmps(b[7]);
  float at_i1 = faultRegToAmps(b[12]), at_i2 = faultRegToAmps(b[13]);
  float at_i3 = faultRegToAmps(b[14]), at_i0 = faultRegToAmps(b[15]);
  float p80_i1 = faultRegToAmps(b[20]), p80_i2 = faultRegToAmps(b[21]);
  float p80_i3 = faultRegToAmps(b[22]), p80_i0 = faultRegToAmps(b[23]);
  float p200_i1 = faultRegToAmps(b[24]), p200_i2 = faultRegToAmps(b[25]);
  float p200_i3 = faultRegToAmps(b[26]), p200_i0 = faultRegToAmps(b[27]);

  fr_prestart_i1 = ps_i1; fr_prestart_i2 = ps_i2; fr_prestart_i3 = ps_i3; fr_prestart_i0 = ps_i0;
  fr_atstart_i1 = as_i1; fr_atstart_i2 = as_i2; fr_atstart_i3 = as_i3; fr_atstart_i0 = as_i0;
  fr_attrip_i1 = at_i1; fr_attrip_i2 = at_i2; fr_attrip_i3 = at_i3; fr_attrip_i0 = at_i0;
  fr_p80_i1 = p80_i1; fr_p80_i2 = p80_i2; fr_p80_i3 = p80_i3; fr_p80_i0 = p80_i0;
  fr_p200_i1 = p200_i1; fr_p200_i2 = p200_i2; fr_p200_i3 = p200_i3; fr_p200_i0 = p200_i0;
  fr_atstart_timestamp = formatTimestamp(b[8], b[9], b[10], b[11]);
  fr_attrip_timestamp = formatTimestamp(b[16], b[17], b[18], b[19]);

  Serial.printf("Pre-start:  I1=%.2fA I2=%.2fA I3=%.2fA I0=%.2fA\n",
                ps_i1, ps_i2, ps_i3, ps_i0);

  Serial.printf("At start:   I1=%.2fA I2=%.2fA I3=%.2fA I0=%.2fA  @ ",
                as_i1, as_i2, as_i3, as_i0);
  printTimestamp(b[8], b[9], b[10], b[11]); Serial.println();

  Serial.printf("At trip:    I1=%.2fA I2=%.2fA I3=%.2fA I0=%.2fA  @ ",
                at_i1, at_i2, at_i3, at_i0);
  printTimestamp(b[16], b[17], b[18], b[19]); Serial.println();

  Serial.printf("+80ms:      I1=%.2fA I2=%.2fA I3=%.2fA I0=%.2fA\n",
                p80_i1, p80_i2, p80_i3, p80_i0);
  Serial.printf("+200ms:     I1=%.2fA I2=%.2fA I3=%.2fA I0=%.2fA\n",
                p200_i1, p200_i2, p200_i3, p200_i0);

  Serial.printf("At-trip cause (from relay registers): %s\n", iedStatusStr);
}

void pollRelay() {
  configureForRelay();

  if (pollCount % SETTINGS_REFRESH_EVERY_N_POLLS == 0) {
    readProtectionPickups();
  }
  pollCount++;

  readCurrents();
  delay(100);

  readRtc();
  delay(100);

  bool newTrip = readIedStatus();
  delay(100);

  readFaultRecord1();

  if (newTrip) {
    Serial.println("\n*** NEW TRIP DETECTED (IED Status changed) ***");
    delay(300);
    readIedStatus();
    delay(100);
    readFaultRecord1();
  }
}

// =====================================================================
// ---------------------------- METER CODE ----------------------------
// =====================================================================
//
// Register map (from meter datasheet, MODBUS ADDRESS column minus 40001
// to get the 0-based ModbusMaster offset used by readHoldingRegisters):
//
//   40001 Frequency               -> offset 0
//   40003 Voltage Phase R         -> offset 2
//   40005 Voltage Phase Y         -> offset 4
//   40007 Voltage Phase B         -> offset 6
//   40015 Current Phase R         -> offset 14
//   40017 Current Phase Y         -> offset 16
//   40019 Current Phase B         -> offset 18
//   40021 Power Factor R          -> offset 20
//   40023 Power Factor Y          -> offset 22
//   40025 Power Factor B          -> offset 24
//   40027 Total Power Factor      -> offset 26
//   40029 Active Power R      (W) -> offset 28
//   40031 Active Power Y      (W) -> offset 30
//   40033 Active Power B      (W) -> offset 32
//   40035 Total Active Power  (W) -> offset 34
//
// IMPORTANT FIX: Active Power is read DIRECTLY from the meter's own
// registers (40029-40035) instead of being computed locally as
// V*I*PF. The meter computes power internally (and may use a
// different PF convention - note the datasheet's odd 0.5..-0.86
// scaling range for PF), so a locally computed V*I*PF value can
// drift from what the meter itself displays. Reading the meter's
// own Active Power registers guarantees the Serial Monitor output
// matches the meter's display.

// Decode a 32-bit IEEE-754 float from two 16-bit Modbus registers.
float readFloatGeneric(uint16_t reg, bool allowNegative, bool allowZero, bool &commOk) {
  commOk = false;

  for (int attempt = 0; attempt < 5; attempt++) {

    uint8_t result = node.readHoldingRegisters(reg, 2);

    if (result == node.ku8MBSuccess) {
      commOk = true;

      uint16_t w0 = node.getResponseBuffer(0);
      uint16_t w1 = node.getResponseBuffer(1);

      float f;
      uint32_t raw = ((uint32_t)w1 << 16) | w0;
      memcpy(&f, &raw, 4);

      float minMagnitude = allowZero ? 0.0 : METER_MIN_VALID_MAG;
      bool ok = !isnan(f) && !isinf(f) && (allowNegative || f >= 0)
                && fabs(f) >= minMagnitude && fabs(f) < 10000;

      if (ok) return f;
    }

    delay(20);
  }

  Serial.print("Read Fail Reg: ");
  Serial.println(reg);

  return NAN;
}

// Voltage / Frequency: filter out if negative or near-zero.
float readFloat(uint16_t reg, bool &commOk) {
  return readFloatGeneric(reg, false, false, commOk);
}

// Current: allow zero, just not negative.
float readCurrentFloat(uint16_t reg, bool &commOk) {
  return readFloatGeneric(reg, false, true, commOk);
}

// Power Factor / Active Power: allow negative (export / leading) and zero.
float readFloatSigned(uint16_t reg, bool &commOk) {
  return readFloatGeneric(reg, true, true, commOk);
}

// NOTE: Active Power register values are in Watts and can be large
// (max scaling column shows up to "32G"), so the readFloatGeneric()
// magnitude cap of < 10000 would incorrectly reject legitimate high
// power readings. Use this dedicated, larger-range reader for power.
float readPowerFloat(uint16_t reg, bool &commOk) {
  commOk = false;

  for (int attempt = 0; attempt < 5; attempt++) {
    uint8_t result = node.readHoldingRegisters(reg, 2);

    if (result == node.ku8MBSuccess) {
      commOk = true;

      uint16_t w0 = node.getResponseBuffer(0);
      uint16_t w1 = node.getResponseBuffer(1);

      float f;
      uint32_t raw = ((uint32_t)w1 << 16) | w0;
      memcpy(&f, &raw, 4);

      bool ok = !isnan(f) && !isinf(f);
      if (ok) return f;
    }

    delay(20);
  }

  Serial.print("Read Fail Reg: ");
  Serial.println(reg);

  return NAN;
}

// ===== SAFE PRINT =====
void printValue(const char* name, float value, const char* unit) {
  Serial.print(name);
  Serial.print(": ");

  if (!isnan(value)) {
    Serial.print(value, 2);
    Serial.print(" ");
    Serial.println(unit);
  } else {
    Serial.println("---");
  }
}

// Latest GOOD meter values.
float meter_V_R = NAN, meter_V_Y = NAN, meter_V_B = NAN;
float meter_I_R = NAN, meter_I_Y = NAN, meter_I_B = NAN;
float meter_Frequency = NAN;
float meter_PF_R = NAN, meter_PF_Y = NAN, meter_PF_B = NAN, meter_PF_T = NAN;
float meter_P_R = NAN, meter_P_Y = NAN, meter_P_B = NAN, meter_P_T = NAN;

// Only overwrite the held value if the new reading is actually valid.
void updateIfValid(float &held, float newValue) {
  if (!isnan(newValue)) {
    held = newValue;
  }
}

void pollMeter() {
  configureForMeter();

  bool ok;
  bool meterResponding = false;

  float V_R = readFloat(2, ok); meterResponding |= ok; delay(60);
  float V_Y = readFloat(4, ok); meterResponding |= ok; delay(60);
  float V_B = readFloat(6, ok); meterResponding |= ok; delay(60);

  float I_R = readCurrentFloat(14, ok); meterResponding |= ok; delay(60);
  float I_Y = readCurrentFloat(16, ok); meterResponding |= ok; delay(60);
  float I_B = readCurrentFloat(18, ok); meterResponding |= ok; delay(60);

  float Frequency = readFloat(0, ok); meterResponding |= ok; delay(20);

  float PF_R = readFloatSigned(20, ok); meterResponding |= ok; delay(60);
  float PF_Y = readFloatSigned(22, ok); meterResponding |= ok; delay(60);
  float PF_B = readFloatSigned(24, ok); meterResponding |= ok; delay(60);
  float PF_T = readFloatSigned(26, ok); meterResponding |= ok; delay(60);

  // ---- FIX: read Active Power directly from meter registers ----
  // (was previously computed locally as V*I*PF/1000, which drifted
  // from the meter's own displayed value)
  float P_R = readPowerFloat(28, ok); meterResponding |= ok; delay(60);
  float P_Y = readPowerFloat(30, ok); meterResponding |= ok; delay(60);
  float P_B = readPowerFloat(32, ok); meterResponding |= ok; delay(60);
  float P_T = readPowerFloat(34, ok); meterResponding |= ok; delay(60);

  // Convert W -> kW for display, keeping NAN as NAN.
  if (!isnan(P_R)) P_R /= 1000.0;
  if (!isnan(P_Y)) P_Y /= 1000.0;
  if (!isnan(P_B)) P_B /= 1000.0;
  if (!isnan(P_T)) P_T /= 1000.0;

  if (!meterResponding) {
    Serial.println("Meter not responding at all (no power/connection) - showing 0, not last reading.");
    meter_V_R = meter_V_Y = meter_V_B = 0;
    meter_I_R = meter_I_Y = meter_I_B = 0;
    meter_Frequency = 0;
    meter_PF_R = meter_PF_Y = meter_PF_B = meter_PF_T = 0;
    meter_P_R = meter_P_Y = meter_P_B = meter_P_T = 0;
  } else {
    updateIfValid(meter_V_R, V_R);
    updateIfValid(meter_V_Y, V_Y);
    updateIfValid(meter_V_B, V_B);

    updateIfValid(meter_I_R, I_R);
    updateIfValid(meter_I_Y, I_Y);
    updateIfValid(meter_I_B, I_B);
    updateIfValid(meter_Frequency, Frequency);
    updateIfValid(meter_PF_R, PF_R);
    updateIfValid(meter_PF_Y, PF_Y);
    updateIfValid(meter_PF_B, PF_B);
    updateIfValid(meter_PF_T, PF_T);
    updateIfValid(meter_P_R, P_R);
    updateIfValid(meter_P_Y, P_Y);
    updateIfValid(meter_P_B, P_B);
    updateIfValid(meter_P_T, P_T);
  }

  Serial.println("\n===== METER TOTAL PARAMETERS =====");

  printValue(" V_R", meter_V_R, "V");
  printValue(" V_Y", meter_V_Y, "V");
  printValue(" V_B", meter_V_B, "V");

  printValue(" I_R", meter_I_R, "A");
  printValue(" I_Y", meter_I_Y, "A");
  printValue(" I_B", meter_I_B, "A");

  printValue("Frequency", meter_Frequency, "Hz");

  printValue("PF_R", meter_PF_R, "");
  printValue("PF_Y", meter_PF_Y, "");
  printValue("PF_B", meter_PF_B, "");
  printValue("PF_T", meter_PF_T, "");

  printValue("P_R", meter_P_R, "kW");
  printValue("P_Y", meter_P_Y, "kW");
  printValue("P_B", meter_P_B, "kW");
  printValue("P_T", meter_P_T, "kW");

  Serial.println("================================");
}

// =====================================================================
// ----------------------- NETWORK / JSON CODE -------------------------
// =====================================================================

float finiteOrZero(float v) {
  return (isnan(v) || isinf(v)) ? 0.0f : v;
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWiFiAttemptMs < WIFI_RECONNECT_INTERVAL_MS) return;
  lastWiFiAttemptMs = now;

  Serial.printf("Connecting to Wi-Fi: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 8000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected. IP: ");
    Serial.println(WiFi.localIP());
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
  } else {
    Serial.println("Wi-Fi connection failed. ESP will continue Modbus polling and retry later.");
  }
}

String currentNtpTimestamp() {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 1000)) {
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
    return String(buf);
  }
  return "2000-01-01 00:00:00";
}

bool validTimestampString(const String &s) {
  if (s.length() < 19) return false;
  if (s == "N/A") return false;
  if (s.length() >= 10 && s.charAt(4) == '-' && s.charAt(7) == '-') return true;
  return false;
}

void buildEventFields(uint8_t &type, uint8_t &subtype, String &timestamp) {
  bool oc = (finiteOrZero(relay_I1) > pickupIphase) ||
            (finiteOrZero(relay_I2) > pickupIphase) ||
            (finiteOrZero(relay_I3) > pickupIphase);
  bool ef = finiteOrZero(relay_I0) > pickupIearth;

  if (oc && ef) {
    type = 1;
    subtype = 3;       // O/C + E/F
  } else if (oc) {
    type = 1;
    subtype = 1;       // O/C
  } else if (ef) {
    type = 1;
    subtype = 2;       // E/F
  } else {
    type = 0;
    subtype = 0;       // No event
  }

  // Use the relay RTC for a real relay event.
  if (type != 0 && validTimestampString(fr_attrip_timestamp)) {
    timestamp = fr_attrip_timestamp;
  } else if (validTimestampString(relayRtc)) {
    timestamp = relayRtc;
  } else {
    // Always send a PostgreSQL-valid timestamp; never send "N/A".
    timestamp = currentNtpTimestamp();
  }
}

void sendSensorData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("HTTP upload skipped: Wi-Fi not connected.");
    return;
  }

  StaticJsonDocument<6144> doc;

  doc["panel_id"] = PANEL_ID;

  // Relay live data
  doc["relay_i1"] = finiteOrZero(relay_I1);
  doc["relay_i2"] = finiteOrZero(relay_I2);
  doc["relay_i3"] = finiteOrZero(relay_I3);
  doc["relay_i0"] = finiteOrZero(relay_I0);
  doc["pickup_phase"] = finiteOrZero(pickupIphase);
  doc["pickup_earth"] = finiteOrZero(pickupIearth);

  bool oc = (finiteOrZero(relay_I1) > pickupIphase) ||
            (finiteOrZero(relay_I2) > pickupIphase) ||
            (finiteOrZero(relay_I3) > pickupIphase);
  bool ef = finiteOrZero(relay_I0) > pickupIearth;
  doc["overcurrent_fault"] = oc;
  doc["earth_fault"] = ef;

  // Meter data
  doc["meter_v_r"] = finiteOrZero(meter_V_R);
  doc["meter_v_y"] = finiteOrZero(meter_V_Y);
  doc["meter_v_b"] = finiteOrZero(meter_V_B);
  doc["meter_i_r"] = finiteOrZero(meter_I_R);
  doc["meter_i_y"] = finiteOrZero(meter_I_Y);
  doc["meter_i_b"] = finiteOrZero(meter_I_B);
  doc["meter_frequency"] = finiteOrZero(meter_Frequency);
  doc["meter_pf_r"] = finiteOrZero(meter_PF_R);
  doc["meter_pf_y"] = finiteOrZero(meter_PF_Y);
  doc["meter_pf_b"] = finiteOrZero(meter_PF_B);
  doc["meter_pf_t"] = finiteOrZero(meter_PF_T);
  doc["meter_p_r"] = finiteOrZero(meter_P_R);
  doc["meter_p_y"] = finiteOrZero(meter_P_Y);
  doc["meter_p_b"] = finiteOrZero(meter_P_B);
  doc["meter_p_t"] = finiteOrZero(meter_P_T);

  // Environment
  doc["temperature"] = finiteOrZero(dht_temperature);
  doc["humidity"] = finiteOrZero(dht_humidity);

  // New ESP relay status. Keep existing backend field names.
  doc["relay_rtc"] = relayRtc.length() ? relayRtc : "N/A";
  doc["active_setting_group"] = activeSettingGroup;
  doc["current_relay_status"] = iedStatusStr;
  doc["live_fault_status"] = liveFaultStatus;
  doc["historical_fault_status"] = iedStatusStr;
  doc["fault_status"] = liveFaultStatus;
  doc["negative_sequence_current"] = finiteOrZero(relay_negSeq);
  doc["thermal_level"] = relay_thermalLevel;

  // Latest stored fault record
  doc["fr_prestart_i1"] = finiteOrZero(fr_prestart_i1);
  doc["fr_prestart_i2"] = finiteOrZero(fr_prestart_i2);
  doc["fr_prestart_i3"] = finiteOrZero(fr_prestart_i3);
  doc["fr_prestart_i0"] = finiteOrZero(fr_prestart_i0);

  doc["fr_atstart_i1"] = finiteOrZero(fr_atstart_i1);
  doc["fr_atstart_i2"] = finiteOrZero(fr_atstart_i2);
  doc["fr_atstart_i3"] = finiteOrZero(fr_atstart_i3);
  doc["fr_atstart_i0"] = finiteOrZero(fr_atstart_i0);
  doc["fr_atstart_timestamp"] = fr_atstart_timestamp;

  doc["fr_attrip_i1"] = finiteOrZero(fr_attrip_i1);
  doc["fr_attrip_i2"] = finiteOrZero(fr_attrip_i2);
  doc["fr_attrip_i3"] = finiteOrZero(fr_attrip_i3);
  doc["fr_attrip_i0"] = finiteOrZero(fr_attrip_i0);
  doc["fr_attrip_timestamp"] = fr_attrip_timestamp;

  doc["fr_p80_i1"] = finiteOrZero(fr_p80_i1);
  doc["fr_p80_i2"] = finiteOrZero(fr_p80_i2);
  doc["fr_p80_i3"] = finiteOrZero(fr_p80_i3);
  doc["fr_p80_i0"] = finiteOrZero(fr_p80_i0);

  doc["fr_p200_i1"] = finiteOrZero(fr_p200_i1);
  doc["fr_p200_i2"] = finiteOrZero(fr_p200_i2);
  doc["fr_p200_i3"] = finiteOrZero(fr_p200_i3);
  doc["fr_p200_i0"] = finiteOrZero(fr_p200_i0);

// Backend/database currently expects these four fields.
// operation_counter is kept as 0 because this firmware does not read
// a dedicated operation-counter register.
uint8_t uploadEventType = 0;
uint8_t uploadEventSubtype = 0;
String uploadEventTimestamp;
buildEventFields(uploadEventType, uploadEventSubtype, uploadEventTimestamp);

doc["operation_counter"] = 0;
doc["event_type"] = uploadEventType;
doc["event_subtype"] = uploadEventSubtype;
doc["event_timestamp"] = uploadEventTimestamp;

  String payload;
  serializeJson(doc, payload);

  Serial.println("\n--- HTTP POST /sensor ---");
  Serial.printf("Payload size: %u bytes\n", payload.length());

  WiFiClientSecure client;
  client.setInsecure();  // Render HTTPS; use certificate validation for production.

  HTTPClient http;
  http.setTimeout(8000);

  if (!http.begin(client, SERVER_URL)) {
    Serial.println("HTTP begin failed.");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    Serial.printf("HTTP response: %d\n", httpCode);
    String response = http.getString();
    Serial.println(response);
  } else {
    Serial.printf("HTTP POST failed: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

void pollAndUpload() {
  pollDht();
  sendSensorData();
}

// =====================================================================
// ---------------------------- DHT22 CODE -----------------------------
// =====================================================================

void pollDht() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (isnan(t) || isnan(h)) {
    Serial.println("DHT22 sensor read failed! (showing last known good reading)");
  } else {
    dht_temperature = t;
    dht_humidity = h;
  }

  Serial.print("Temperature: ");
  printValue("", dht_temperature, "C");

  Serial.print("Humidity: ");
  printValue("", dht_humidity, "%");

  if (!isnan(dht_temperature) && dht_temperature > HIGH_TEMP) {
    Serial.println("[WARNING] HIGH TEMPERATURE ALERT!");
  }
  if (!isnan(dht_humidity) && dht_humidity > HIGH_HUM) {
    Serial.println("[WARNING] HIGH HUMIDITY ALERT!");
  }
  Serial.println("----------------------");
}

void printCombinedSummary() {
  Serial.println("\n========== COMBINED SUMMARY (Relay + Meter + DHT) ==========");
  Serial.println("-- Relay (protection) --");
  Serial.printf("  I1: %.2f A | I2: %.2f A | I3: %.2f A | I0: %.2f A\n",
                relay_I1, relay_I2, relay_I3, relay_I0);
  Serial.printf("  Pickups -> I>: %.2f A | I0>: %.2f A\n", pickupIphase, pickupIearth);
  Serial.printf("  Live status: %s\n", liveFaultStatus);
  Serial.printf("  Last trip status: %s\n", iedStatusStr);

  Serial.println("-- Meter (power quality, last known good) --");
  printValue("  V_R", meter_V_R, "V");
  printValue("  V_Y", meter_V_Y, "V");
  printValue("  V_B", meter_V_B, "V");
  printValue("  I_R", meter_I_R, "A");
  printValue("  I_Y", meter_I_Y, "A");
  printValue("  I_B", meter_I_B, "A");
  printValue("  Frequency", meter_Frequency, "Hz");
  printValue("  PF_T", meter_PF_T, "");
  printValue("  P_T", meter_P_T, "kW");

  Serial.println("-- Panel environment (DHT22) --");
  printValue("  Temperature", dht_temperature, "C");
  printValue("  Humidity", dht_humidity, "%");

  Serial.println("========================================================");
}

// =====================================================================
// ---------------------- setup() / loop() ------------------------------
// =====================================================================
//
// NOTE: setup() and loop() were not included in the source file you
// uploaded (it cut off right after printCombinedSummary()). Below is
// a reasonable reconstruction based on the timing constants, polling
// functions, and DE/RE pin already defined above. If your actual
// setup()/loop() differs, please paste it and I will merge your real
// version in instead of this placeholder.

void setup() {
  Serial.begin(115200);
  pinMode(MAX485_DE_RE, OUTPUT);
  digitalWrite(MAX485_DE_RE, LOW);

  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);

  dht.begin();

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  connectWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
    Serial.println("NTP time synchronization requested.");
  }

  Serial.println("System starting...");
}

void loop() {
  unsigned long now = millis();

  connectWiFi();

  if (now - lastPollMs >= POLL_INTERVAL_MS) {
    lastPollMs = now;
    pollRelay();
    pollMeter();
    printCombinedSummary();
  }

  if (now - lastDhtPollMs >= DHT_POLL_INTERVAL_MS) {
    lastDhtPollMs = now;
    pollDht();
  }

  if (now - lastHttpPostMs >= HTTP_POST_INTERVAL_MS) {
    lastHttpPostMs = now;
    sendSensorData();
  }
}
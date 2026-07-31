from db import get_connection

conn = get_connection()
cursor = conn.cursor()

cursor.execute("""
CREATE TABLE IF NOT EXISTS sensor_data (

    id SERIAL PRIMARY KEY,

    panel_id VARCHAR(20) NOT NULL,

    relay_i1 REAL,
    relay_i2 REAL,
    relay_i3 REAL,
    relay_i0 REAL,

    pickup_phase REAL,
    pickup_earth REAL,

    overcurrent_fault BOOLEAN,
    earth_fault BOOLEAN,

    meter_v_r REAL,
    meter_v_y REAL,
    meter_v_b REAL,

    meter_i_r REAL,
    meter_i_y REAL,
    meter_i_b REAL,

    meter_frequency REAL,

    meter_pf_r REAL,
    meter_pf_y REAL,
    meter_pf_b REAL,
    meter_pf_t REAL,

    meter_p_r REAL,
    meter_p_y REAL,
    meter_p_b REAL,
    meter_p_t REAL,

    temperature REAL,
    humidity REAL,

    relay_rtc TEXT,

    event_type INTEGER,
    event_subtype INTEGER,
    event_timestamp TEXT,

    fault_status TEXT,
    live_fault_status TEXT,
    historical_fault_status TEXT,

    operation_counter INTEGER,
    negative_sequence_current REAL,
    thermal_level INTEGER,

    current_relay_status TEXT,

    fr_prestart_i1 REAL,
    fr_prestart_i2 REAL,
    fr_prestart_i3 REAL,
    fr_prestart_i0 REAL,

    fr_atstart_i1 REAL,
    fr_atstart_i2 REAL,
    fr_atstart_i3 REAL,
    fr_atstart_i0 REAL,
    fr_atstart_timestamp TEXT,

    fr_attrip_i1 REAL,
    fr_attrip_i2 REAL,
    fr_attrip_i3 REAL,
    fr_attrip_i0 REAL,
    fr_attrip_timestamp TEXT,

    fr_p80_i1 REAL,
    fr_p80_i2 REAL,
    fr_p80_i3 REAL,
    fr_p80_i0 REAL,

    fr_p200_i1 REAL,
    fr_p200_i2 REAL,
    fr_p200_i3 REAL,
    fr_p200_i0 REAL,

    timestamp TIMESTAMP DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
);
""")

conn.commit()

print("✅ sensor_data table created successfully!")

cursor.close()
conn.close()
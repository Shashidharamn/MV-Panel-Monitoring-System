from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from db import get_connection

app = FastAPI()

# -----------------------------
# Enable CORS
# -----------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# Data Model
# -----------------------------
class SensorData(BaseModel):
    panel_id: str

    relay_i1: float
    relay_i2: float
    relay_i3: float
    relay_i0: float

    pickup_phase: float
    pickup_earth: float

    overcurrent_fault: bool
    earth_fault: bool

    meter_v_r: float
    meter_v_y: float
    meter_v_b: float

    meter_i_r: float
    meter_i_y: float
    meter_i_b: float

    meter_frequency: float

    meter_pf_r: float
    meter_pf_y: float
    meter_pf_b: float
    meter_pf_t: float

    meter_p_r: float
    meter_p_y: float
    meter_p_b: float
    meter_p_t: float

    temperature: float
    humidity: float


# -----------------------------
# Home API
# -----------------------------
@app.get("/")
def home():
    return {"message": "Welcome to NIEL MV Panel Monitoring System"}


# -----------------------------
# Receive Sensor Data
# -----------------------------
@app.post("/sensor")
def receive_data(data: SensorData):

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO sensor_data
(
    panel_id,

    relay_i1,
    relay_i2,
    relay_i3,
    relay_i0,

    pickup_phase,
    pickup_earth,

    overcurrent_fault,
    earth_fault,

    meter_v_r,
    meter_v_y,
    meter_v_b,

    meter_i_r,
    meter_i_y,
    meter_i_b,

    meter_frequency,

    meter_pf_r,
    meter_pf_y,
    meter_pf_b,
    meter_pf_t,

    meter_p_r,
    meter_p_y,
    meter_p_b,
    meter_p_t,

    temperature,
    humidity,
    timestamp
)
VALUES
(
    %s,%s,%s,%s,%s,
    %s,%s,
    %s,%s,
    %s,%s,%s,
    %s,%s,%s,
    %s,
    %s,%s,%s,%s,
    %s,%s,%s,%s,
    %s,%s,
    CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'
)
    """, (
    data.panel_id,

    data.relay_i1,
    data.relay_i2,
    data.relay_i3,
    data.relay_i0,

    data.pickup_phase,
    data.pickup_earth,

    data.overcurrent_fault,
    data.earth_fault,

    data.meter_v_r,
    data.meter_v_y,
    data.meter_v_b,

    data.meter_i_r,
    data.meter_i_y,
    data.meter_i_b,

    data.meter_frequency,

    data.meter_pf_r,
    data.meter_pf_y,
    data.meter_pf_b,
    data.meter_pf_t,

    data.meter_p_r,
    data.meter_p_y,
    data.meter_p_b,
    data.meter_p_t,

    data.temperature,
    data.humidity
))

    conn.commit()

    cursor.close()
    conn.close()

    return {
        "status": "Data Stored Successfully",
        "received_data": data
    }


# -----------------------------
# Get Latest Sensor Data
# -----------------------------
@app.get("/latest")
def latest_data():

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
    id,
    panel_id,

    relay_i1,
    relay_i2,
    relay_i3,
    relay_i0,

    pickup_phase,
    pickup_earth,

    overcurrent_fault,
    earth_fault,

    meter_v_r,
    meter_v_y,
    meter_v_b,

    meter_i_r,
    meter_i_y,
    meter_i_b,

    meter_frequency,

    meter_pf_r,
    meter_pf_y,
    meter_pf_b,
    meter_pf_t,

    meter_p_r,
    meter_p_y,
    meter_p_b,
    meter_p_t,

    temperature,
    humidity,

    timestamp

FROM sensor_data
ORDER BY id DESC
LIMIT 1;
    """)

    row = cursor.fetchone()

    cursor.close()
    conn.close()

    if row is None:
        return {"message": "No Data Available"}

    return {
    "id": row[0],
    "panel_id": row[1],

    "relay_i1": row[2],
    "relay_i2": row[3],
    "relay_i3": row[4],
    "relay_i0": row[5],

    "pickup_phase": row[6],
    "pickup_earth": row[7],

    "overcurrent_fault": row[8],
    "earth_fault": row[9],

    "meter_v_r": row[10],
    "meter_v_y": row[11],
    "meter_v_b": row[12],

    "meter_i_r": row[13],
    "meter_i_y": row[14],
    "meter_i_b": row[15],

    "meter_frequency": row[16],

    "meter_pf_r": row[17],
    "meter_pf_y": row[18],
    "meter_pf_b": row[19],
    "meter_pf_t": row[20],

    "meter_p_r": row[21],
    "meter_p_y": row[22],
    "meter_p_b": row[23],
    "meter_p_t": row[24],

    "temperature": row[25],
    "humidity": row[26],

    "timestamp": row[27]
}



@app.get("/history")
def get_history(
    from_date: str = Query(None, alias="from"),
    to_date: str = Query(None, alias="to")
 
):
    conn = get_connection()
    cursor = conn.cursor()

    if from_date and to_date:
        cursor.execute("""
            SELECT *
            FROM sensor_data
            WHERE DATE(timestamp) BETWEEN %s AND %s
            ORDER BY timestamp ASC
        """, (from_date, to_date))
    else:
                cursor.execute("""
            SELECT *
            FROM sensor_data
            ORDER BY timestamp ASC
        """)

    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    history = []

    for row in rows:
        history.append({
    "id": row[0],
    "panel_id": row[1],

    "relay_i1": row[2],
    "relay_i2": row[3],
    "relay_i3": row[4],
    "relay_i0": row[5],

    "pickup_phase": row[6],
    "pickup_earth": row[7],

    "overcurrent_fault": row[8],
    "earth_fault": row[9],

    "meter_v_r": row[10],
    "meter_v_y": row[11],
    "meter_v_b": row[12],

    "meter_i_r": row[13],
    "meter_i_y": row[14],
    "meter_i_b": row[15],

    "meter_frequency": row[16],

    "meter_pf_r": row[17],
    "meter_pf_y": row[18],
    "meter_pf_b": row[19],
    "meter_pf_t": row[20],

    "meter_p_r": row[21],
    "meter_p_y": row[22],
    "meter_p_b": row[23],
    "meter_p_t": row[24],

    "temperature": row[25],
    "humidity": row[26],

    "timestamp": row[27].strftime("%Y-%m-%d %H:%M:%S")
})

    return history
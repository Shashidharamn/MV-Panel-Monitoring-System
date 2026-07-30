from fastapi import FastAPI
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
            vr,
            vy,
            vb,
            ir,
            iy,
            frequency,
            pf_r,
            pf_y,
            pf_b,
            pf_total,
            power_r,
            power_y,
            status,
            error_message,
            created_at
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
        "vr": row[1],
        "vy": row[2],
        "vb": row[3],
        "ir": row[4],
        "iy": row[5],
        "frequency": row[6],
        "pf_r": row[7],
        "pf_y": row[8],
        "pf_b": row[9],
        "pf_total": row[10],
        "power_r": row[11],
        "power_y": row[12],
        "status": row[13],
        "error_message": row[14],
        "created_at": row[15]
    }
from fastapi import Query

@app.get("/history")
def get_history(
    from_date: str = Query(None, alias="from"),
    to_date: str = Query(None, alias="to"),
    interval: int = Query(60)
):
    conn = get_connection()
    cursor = conn.cursor()

    if from_date and to_date:
        cursor.execute("""
            SELECT *
            FROM sensor_data
            WHERE DATE(created_at) BETWEEN %s AND %s
            ORDER BY created_at ASC
        """, (from_date, to_date))
    else:
        cursor.execute("""
            SELECT *
            FROM sensor_data
            ORDER BY created_at ASC
        """)

    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    history = []

    for row in rows:
        history.append({
            "id": row[0],
            "vr": row[1],
            "vy": row[2],
            "vb": row[3],
            "ir": row[4],
            "iy": row[5],
            "frequency": row[6],
            "pf_r": row[7],
            "pf_y": row[8],
            "pf_b": row[9],
            "pf_total": row[10],
            "power_r": row[11],
            "power_y": row[12],
            "status": row[13],
            "error_message": row[14],
            "timestamp": row[15].strftime("%Y-%m-%d %H:%M:%S")
        })

    return history
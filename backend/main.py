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

    vr: float
    vy: float
    vb: float

    ir: float
    iy: float

    frequency: float

    pf_r: float
    pf_y: float
    pf_b: float
    pf_total: float

    power_r: float
    power_y: float

    status: str
    error_message: str


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
        )
        VALUES
        (
            %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
            CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'
        )
    """, (
        data.vr,
        data.vy,
        data.vb,
        data.ir,
        data.iy,
        data.frequency,
        data.pf_r,
        data.pf_y,
        data.pf_b,
        data.pf_total,
        data.power_r,
        data.power_y,
        data.status,
        data.error_message
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
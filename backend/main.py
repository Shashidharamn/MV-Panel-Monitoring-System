from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Tuple, List
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
# Global fallback exception handler
# Ensures the API never leaks FastAPI/Starlette's default plain-text
# "Internal Server Error" page. Any exception that isn't already an
# HTTPException (i.e. wasn't handled/classified by an endpoint) is
# converted into a clean JSON 500 response.
# -----------------------------
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Unexpected server error: {str(exc)}"},
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
    # NEW: additional relay telemetry fields sent by the updated ESP32
    # firmware. All fields above this point are unchanged.
    # -----------------------------

    relay_rtc: str

    event_type: int
    event_subtype: int
    event_timestamp: str

    fault_status: str
    live_fault_status: str
    historical_fault_status: str

    operation_counter: int
    negative_sequence_current: float
    thermal_level: int

    current_relay_status: str

    # Fault Record 1 - Pre-start
    fr_prestart_i1: float
    fr_prestart_i2: float
    fr_prestart_i3: float
    fr_prestart_i0: float

    # Fault Record 1 - At Start
    fr_atstart_i1: float
    fr_atstart_i2: float
    fr_atstart_i3: float
    fr_atstart_i0: float
    fr_atstart_timestamp: str

    # Fault Record 1 - At Trip
    fr_attrip_i1: float
    fr_attrip_i2: float
    fr_attrip_i3: float
    fr_attrip_i0: float
    fr_attrip_timestamp: str

    # Fault Record 1 - +80%
    fr_p80_i1: float
    fr_p80_i2: float
    fr_p80_i3: float
    fr_p80_i0: float

    # Fault Record 1 - +200%
    fr_p200_i1: float
    fr_p200_i2: float
    fr_p200_i3: float
    fr_p200_i0: float


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

    relay_rtc,

    event_type,
    event_subtype,
    event_timestamp,

    fault_status,
    live_fault_status,
    historical_fault_status,

    operation_counter,
    negative_sequence_current,
    thermal_level,

    current_relay_status,

    fr_prestart_i1,
    fr_prestart_i2,
    fr_prestart_i3,
    fr_prestart_i0,

    fr_atstart_i1,
    fr_atstart_i2,
    fr_atstart_i3,
    fr_atstart_i0,
    fr_atstart_timestamp,

    fr_attrip_i1,
    fr_attrip_i2,
    fr_attrip_i3,
    fr_attrip_i0,
    fr_attrip_timestamp,

    fr_p80_i1,
    fr_p80_i2,
    fr_p80_i3,
    fr_p80_i0,

    fr_p200_i1,
    fr_p200_i2,
    fr_p200_i3,
    fr_p200_i0,

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

    %s,

    %s,%s,%s,

    %s,%s,%s,

    %s,%s,%s,

    %s,

    %s,%s,%s,%s,

    %s,%s,%s,%s,%s,

    %s,%s,%s,%s,%s,

    %s,%s,%s,%s,

    %s,%s,%s,%s,

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
    data.humidity,

    data.relay_rtc,

    data.event_type,
    data.event_subtype,
    data.event_timestamp,

    data.fault_status,
    data.live_fault_status,
    data.historical_fault_status,

    data.operation_counter,
    data.negative_sequence_current,
    data.thermal_level,

    data.current_relay_status,

    data.fr_prestart_i1,
    data.fr_prestart_i2,
    data.fr_prestart_i3,
    data.fr_prestart_i0,

    data.fr_atstart_i1,
    data.fr_atstart_i2,
    data.fr_atstart_i3,
    data.fr_atstart_i0,
    data.fr_atstart_timestamp,

    data.fr_attrip_i1,
    data.fr_attrip_i2,
    data.fr_attrip_i3,
    data.fr_attrip_i0,
    data.fr_attrip_timestamp,

    data.fr_p80_i1,
    data.fr_p80_i2,
    data.fr_p80_i3,
    data.fr_p80_i0,

    data.fr_p200_i1,
    data.fr_p200_i2,
    data.fr_p200_i3,
    data.fr_p200_i0,
))

    conn.commit()

    cursor.close()
    conn.close()

    return {
        "status": "Data Stored Successfully",
        "received_data": data
    }


# -----------------------------
# Shared column list used by /latest and /history so both endpoints stay
# in sync and the row-index -> field mapping below (row_to_dict) always
# lines up. The first 28 columns are in EXACTLY the same order as the
# original query, so nothing that depended on that ordering changes.
# All new columns are appended after "timestamp".
# -----------------------------
SENSOR_COLUMNS = """
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

    timestamp,

    relay_rtc,

    event_type,
    event_subtype,
    event_timestamp,

    fault_status,
    live_fault_status,
    historical_fault_status,

    operation_counter,
    negative_sequence_current,
    thermal_level,

    current_relay_status,

    fr_prestart_i1,
    fr_prestart_i2,
    fr_prestart_i3,
    fr_prestart_i0,

    fr_atstart_i1,
    fr_atstart_i2,
    fr_atstart_i3,
    fr_atstart_i0,
    fr_atstart_timestamp,

    fr_attrip_i1,
    fr_attrip_i2,
    fr_attrip_i3,
    fr_attrip_i0,
    fr_attrip_timestamp,

    fr_p80_i1,
    fr_p80_i2,
    fr_p80_i3,
    fr_p80_i0,

    fr_p200_i1,
    fr_p200_i2,
    fr_p200_i3,
    fr_p200_i0
"""


def row_to_dict(row, timestamp_as_string=False):
    """
    Maps a row (matching SENSOR_COLUMNS order above) to the response
    dict. All the original /latest and /history fields and their names
    are preserved exactly; new fields are appended after "timestamp",
    exactly like the new DB columns.
    """
    ts = row[27].strftime("%Y-%m-%d %H:%M:%S") if timestamp_as_string else row[27]

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

        "timestamp": ts,

        # ---------------- NEW fields ----------------
        "relay_rtc": row[28],

        "event_type": row[29],
        "event_subtype": row[30],
        "event_timestamp": row[31],

        "fault_status": row[32],
        "live_fault_status": row[33],
        "historical_fault_status": row[34],

        "operation_counter": row[35],
        "negative_sequence_current": row[36],
        "thermal_level": row[37],

        "current_relay_status": row[38],

        "fr_prestart_i1": row[39],
        "fr_prestart_i2": row[40],
        "fr_prestart_i3": row[41],
        "fr_prestart_i0": row[42],

        "fr_atstart_i1": row[43],
        "fr_atstart_i2": row[44],
        "fr_atstart_i3": row[45],
        "fr_atstart_i0": row[46],
        "fr_atstart_timestamp": row[47],

        "fr_attrip_i1": row[48],
        "fr_attrip_i2": row[49],
        "fr_attrip_i3": row[50],
        "fr_attrip_i0": row[51],
        "fr_attrip_timestamp": row[52],

        "fr_p80_i1": row[53],
        "fr_p80_i2": row[54],
        "fr_p80_i3": row[55],
        "fr_p80_i0": row[56],

        "fr_p200_i1": row[57],
        "fr_p200_i2": row[58],
        "fr_p200_i3": row[59],
        "fr_p200_i0": row[60],
    }


# -----------------------------
# Get Latest Sensor Data
# -----------------------------
@app.get("/latest")
def latest_data():

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(f"""
        SELECT
{SENSOR_COLUMNS}
FROM sensor_data
ORDER BY id DESC
LIMIT 1;
    """)

    row = cursor.fetchone()

    cursor.close()
    conn.close()

    if row is None:
        return {"message": "No Data Available"}

    flat = row_to_dict(row, timestamp_as_string=False)

    def _phase_string(i1, i2, i3, i0):
        return f"I1={i1} I2={i2} I3={i3} I0={i0}"

    return {
        "relay": {
            "sg_active": 1,
            "pickup_phase": flat["pickup_phase"],
            "pickup_earth": flat["pickup_earth"],
            "i1": flat["relay_i1"],
            "i2": flat["relay_i2"],
            "i3": flat["relay_i3"],
            "i0": flat["relay_i0"],
            "op_counter": flat["operation_counter"],
            "neg_seq": flat["negative_sequence_current"],
            "thermal_level": flat["thermal_level"],
            "rtc": flat["relay_rtc"],
            "live_fault_status": flat["live_fault_status"],
            "event": {
                "type": flat["event_type"],
                "subtype": flat["event_subtype"],
                "timestamp": flat["event_timestamp"],
            },
            "fault_record1": {
                "pre_start": _phase_string(
                    flat["fr_prestart_i1"],
                    flat["fr_prestart_i2"],
                    flat["fr_prestart_i3"],
                    flat["fr_prestart_i0"],
                ),
                "at_start": _phase_string(
                    flat["fr_atstart_i1"],
                    flat["fr_atstart_i2"],
                    flat["fr_atstart_i3"],
                    flat["fr_atstart_i0"],
                ),
                "at_start_time": flat["fr_atstart_timestamp"],
                "at_trip": _phase_string(
                    flat["fr_attrip_i1"],
                    flat["fr_attrip_i2"],
                    flat["fr_attrip_i3"],
                    flat["fr_attrip_i0"],
                ),
                "at_trip_time": flat["fr_attrip_timestamp"],
            },
        },
        "meter": {
            "v_r": flat["meter_v_r"],
            "v_y": flat["meter_v_y"],
            "v_b": flat["meter_v_b"],
            "i_r": flat["meter_i_r"],
            "i_y": flat["meter_i_y"],
            "i_b": flat["meter_i_b"],
            "frequency": flat["meter_frequency"],
            "pf_r": flat["meter_pf_r"],
            "pf_y": flat["meter_pf_y"],
            "pf_b": flat["meter_pf_b"],
            "pf_t": flat["meter_pf_t"],
            "p_r": flat["meter_p_r"],
            "p_y": flat["meter_p_y"],
            "p_b": flat["meter_p_b"],
            "p_t": flat["meter_p_t"],
        },
        "dht": {
            "temperature": flat["temperature"],
            "humidity": flat["humidity"],
        },
    }


# =============================================================================
# HISTORICAL DATA MODULE HELPERS
#
# These two functions are shared by GET /history and DELETE /history so the
# validation and WHERE-clause logic can never drift apart between the two
# endpoints. Both raise HTTPException(400) directly on bad input, so callers
# should invoke them *outside* any try/except that translates errors to 500 -
# that's exactly how get_history/delete_history below are structured.
# =============================================================================

# Accepted input formats. HTML <input type="datetime-local"> sends
# "YYYY-MM-DDTHH:MM" (no seconds, 'T' separator) - that's normalized to a
# space before matching, so it's covered by the "%Y-%m-%d %H:%M" format.
_DATETIME_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
)


def _parse_datetime(value: Optional[str], field_name: str) -> datetime:
    """
    Parses a date/time string into a datetime object.

    Accepts:
      - "YYYY-MM-DD"
      - "YYYY-MM-DD HH:MM:SS"
      - "YYYY-MM-DD HH:MM"
      - "YYYY-MM-DDTHH:MM" / "YYYY-MM-DDTHH:MM:SS" (datetime-local input)

    Raises HTTPException(400) with a clear, field-specific message on any
    invalid or missing value. Never raises anything else, so it never
    surfaces as a 500.
    """
    if value is None or not str(value).strip():
        raise HTTPException(status_code=400, detail=f"{field_name} is required.")

    cleaned = str(value).strip().replace("T", " ")

    for fmt in _DATETIME_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue

    raise HTTPException(
        status_code=400,
        detail=(
            f"Invalid {field_name} '{value}'. "
            "Expected format 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS'."
        ),
    )


def build_history_filter(
    start_date: str,
    end_date: str,
    panel_id: Optional[str],
) -> Tuple[str, List]:
    """
    Validates start_date/end_date/panel_id and builds the shared SQL WHERE
    clause + parameter list used by both GET /history and DELETE /history.

    Uses `timestamp BETWEEN %s AND %s` (never DATE(timestamp)) so the
    filter respects the exact time range requested, not just the day.
    """
    start_dt = _parse_datetime(start_date, "start_date")
    end_dt = _parse_datetime(end_date, "end_date")

    if start_dt > end_dt:
        raise HTTPException(
            status_code=400,
            detail="start_date cannot be later than end_date.",
        )

    where_clause = "timestamp BETWEEN %s AND %s"
    params: List = [start_dt, end_dt]

    if panel_id is not None and panel_id.strip():
        where_clause += " AND panel_id = %s"
        params.append(panel_id.strip())

    return where_clause, params


# -----------------------------
# GET /history - search/filter historical records
# -----------------------------
@app.get("/history")
def get_history(
    start_date: str = Query(..., alias="start_date"),
    end_date: str = Query(..., alias="end_date"),
    panel_id: Optional[str] = Query(None, alias="panel_id"),
):
    # Validation happens first and outside the DB try/except below, so any
    # bad input surfaces as a clean 400 - it never gets wrapped as a 500.
    where_clause, params = build_history_filter(start_date, end_date, panel_id)

    conn = None
    cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute(f"""
            SELECT
{SENSOR_COLUMNS}
            FROM sensor_data
            WHERE {where_clause}
            ORDER BY timestamp ASC
        """, params)

        rows = cursor.fetchall()

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Database error while fetching history: {str(exc)}"
        )
    finally:
        if cursor is not None:
            cursor.close()
        if conn is not None:
            conn.close()

    if not rows:
        return []

    history = [row_to_dict(row, timestamp_as_string=True) for row in rows]

    return history


# -----------------------------
# DELETE /history - delete only records matching the given filters
# -----------------------------
@app.delete("/history")
def delete_history(
    start_date: str = Query(..., alias="start_date"),
    end_date: str = Query(..., alias="end_date"),
    panel_id: Optional[str] = Query(None, alias="panel_id"),
):
    # Same shared validation as GET /history - guarantees DELETE can never
    # run without a valid, bounded WHERE clause (i.e. can never wipe the
    # whole table).
    where_clause, params = build_history_filter(start_date, end_date, panel_id)

    conn = None
    cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute(f"""
            DELETE FROM sensor_data
            WHERE {where_clause}
        """, params)

        deleted_count = cursor.rowcount
        conn.commit()

    except HTTPException:
        raise
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Database error while deleting history: {str(exc)}"
        )
    finally:
        if cursor is not None:
            cursor.close()
        if conn is not None:
            conn.close()

    if deleted_count == 0:
        return JSONResponse(
            status_code=200,
            content={
                "status": "No Data Deleted",
                "number_of_deleted_rows": 0,
                "message": "No records found matching the given filters."
            }
        )

    return {
        "status": "success",
        "number_of_deleted_rows": deleted_count,
        "message": f"{deleted_count} historical records deleted successfully."
    }
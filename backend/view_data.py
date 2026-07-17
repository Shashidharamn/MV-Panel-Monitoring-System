from db import get_connection

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
    created_at
FROM sensor_data
ORDER BY id DESC;
""")

rows = cursor.fetchall()

print("\n========== SENSOR DATA ==========\n")

for row in rows:
    print(row)

cursor.close()
conn.close()
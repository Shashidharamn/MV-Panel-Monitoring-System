from db import get_connection

conn = get_connection()
cursor = conn.cursor()

cursor.execute("""
CREATE TABLE sensor_data (
    id SERIAL PRIMARY KEY,

    voltage FLOAT,

    vr FLOAT,
    vy FLOAT,
    vb FLOAT,

    current FLOAT,

    ir FLOAT,
    iy FLOAT,

    frequency FLOAT,

    pf_r FLOAT,
    pf_y FLOAT,
    pf_b FLOAT,
    pf_total FLOAT,

    power_r FLOAT,
    power_y FLOAT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
""")

conn.commit()

print("✅ New table created successfully!")

cursor.close()
conn.close()
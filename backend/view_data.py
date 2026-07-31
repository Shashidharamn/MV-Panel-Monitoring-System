from db import get_connection

conn = get_connection()
cursor = conn.cursor()

cursor.execute("""
SELECT *
FROM sensor_data
ORDER BY id DESC;
""")

rows = cursor.fetchall()

# Column names
column_names = [desc[0] for desc in cursor.description]

print("\n========== SENSOR DATA ==========\n")

for row in rows:
    print("-" * 80)
    for col, value in zip(column_names, row):
        print(f"{col}: {value}")
    print("-" * 80)

cursor.close()
conn.close()
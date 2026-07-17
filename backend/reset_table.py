from db import get_connection

conn = get_connection()
cursor = conn.cursor()

cursor.execute("DROP TABLE IF EXISTS sensor_data;")

conn.commit()

print("✅ Old table deleted successfully!")

cursor.close()
conn.close()
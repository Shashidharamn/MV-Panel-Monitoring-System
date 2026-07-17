import psycopg2

DATABASE_URL = "postgresql://mvpanel_user:t7co7eZr3yoBjqhd1aNyKVXtA8dCHbc8@dpg-d95or0po3t8c73cct070-a.virginia-postgres.render.com/mvpanel"

def get_connection():
    return psycopg2.connect(DATABASE_URL)

try:
    conn = get_connection()
    print("✅ Connected to PostgreSQL successfully!")
    conn.close()
except Exception as e:
    print("❌ Connection failed")
    print(e)
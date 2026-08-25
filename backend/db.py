import os
import psycopg2

DATABASE_URL = os.getenv("DATABASE_URL")

def get_connection():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is NOT SET")

    return psycopg2.connect(
        DATABASE_URL,
        sslmode="require"
    )
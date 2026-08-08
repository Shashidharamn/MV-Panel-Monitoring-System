from db import get_connection

conn = get_connection()
cursor = conn.cursor()

# ==========================================
# 1. CUSTOMER TABLE
# ==========================================
cursor.execute("""
CREATE TABLE IF NOT EXISTS customers (
    customer_id VARCHAR(50) PRIMARY KEY
);
""")

# ==========================================
# 2. CUSTOMER-PANEL MAPPING TABLE
# ==========================================
cursor.execute("""
CREATE TABLE IF NOT EXISTS customer_panels (
    customer_id VARCHAR(50) NOT NULL,
    panel_id VARCHAR(50) NOT NULL,

    PRIMARY KEY (customer_id, panel_id),

    FOREIGN KEY (customer_id)
        REFERENCES customers(customer_id)
        ON DELETE CASCADE
);
""")

# ==========================================
# 3. DEMO CUSTOMER
# ==========================================
cursor.execute("""
INSERT INTO customers (customer_id)
VALUES ('CUST001')
ON CONFLICT (customer_id) DO NOTHING;
""")

# ==========================================
# 4. DEMO PANELS
# ==========================================
cursor.execute("""
INSERT INTO customer_panels (customer_id, panel_id)
VALUES
    ('CUST001', 'PANEL001'),
    ('CUST001', 'PANEL002'),
    ('CUST001', 'PANEL003')
ON CONFLICT (customer_id, panel_id) DO NOTHING;
""")

conn.commit()

print("✅ Customer tables created successfully!")
print("✅ Demo customer: CUST001")
print("✅ Assigned panels: PANEL001, PANEL002, PANEL003")

cursor.close()
conn.close()
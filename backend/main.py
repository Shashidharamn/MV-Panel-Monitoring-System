from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

# Data model
class SensorData(BaseModel):
    voltage: float
    current: float
    power_factor: float

@app.get("/")
def home():
    return {"message": "Welcome to NIEL MV Panel Monitoring System"}

@app.post("/sensor")
def receive_data(data: SensorData):
    print(data)
    return {
        "status": "Data Received Successfully",
        "received_data": data
    }
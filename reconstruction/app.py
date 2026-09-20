from fastapi import FastAPI
from reconstruct import prepare_dataset

app = FastAPI(title="Closette foot reconstruction worker")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/reconstruct")
def reconstruct(payload: dict) -> dict:
    return prepare_dataset(payload)
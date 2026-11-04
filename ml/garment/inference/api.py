"""Local inference API. The mobile app calls this and does not load the model."""

from __future__ import annotations

import logging

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from inference.contract import error_body
from inference.pipeline import GarmentPipeline, ModelError, build_default_pipeline
from inference.validate import MAX_IMAGE_BYTES, InvalidImage, load_image
from taxonomy import MODEL_VERSION, load_taxonomy

logger = logging.getLogger("closette.garment")

HTTP_STATUS = {
    "too_large": 413,
    "unsupported_format": 415,
    "corrupt": 400,
    "empty": 400,
    "too_small": 400,
}


def create_app(pipeline: GarmentPipeline | None = None) -> FastAPI:
    app = FastAPI(title="Closette garment classifier", version=MODEL_VERSION)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.pipeline = pipeline

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
        body = exc.detail if isinstance(exc.detail, dict) else error_body("error", str(exc.detail))
        return JSONResponse(status_code=exc.status_code, content=body)

    @app.get("/health")
    def health() -> dict:
        return {"ok": True, "model_version": MODEL_VERSION}

    @app.get("/v1/garments/taxonomy")
    def taxonomy() -> dict:
        data = load_taxonomy()
        return {
            "version": data["version"],
            "task": data["task"],
            "groups": data["groups"],
            "labels": data["labels"],
            "policy": data["policy"],
        }

    @app.post("/v1/garments/classify")
    async def classify(
        image: UploadFile = File(...),
        include_embedding: bool = Query(False),
        include_mask: bool = Query(True),
    ) -> dict:
        payload = await image.read(MAX_IMAGE_BYTES + 1)
        try:
            photo = load_image(payload)
        except InvalidImage as exc:
            raise HTTPException(
                status_code=HTTP_STATUS.get(exc.code, 400),
                detail=error_body(exc.code, exc.message),
            ) from exc
        try:
            result = _pipeline(app).predict_image(
                photo,
                include_embedding=include_embedding,
                include_mask=include_mask,
            )
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail=error_body("model_unavailable", str(exc)),
            ) from exc
        except ModelError as exc:
            logger.exception("classify failed")
            raise HTTPException(
                status_code=500,
                detail=error_body("model_error", str(exc)),
            ) from exc
        logger.info(
            "classify status=%s subcategory=%s latency_ms=%s",
            result["status"],
            result["subcategory"],
            result["latency_ms"],
        )
        return result

    @app.post("/v1/garments/corrections")
    def corrections(body: dict) -> dict:
        from feedback import CorrectionError, store_correction

        try:
            return store_correction(body)
        except CorrectionError as exc:
            raise HTTPException(
                status_code=400,
                detail=error_body("invalid_correction", str(exc)),
            ) from exc

    return app


def _pipeline(app: FastAPI) -> GarmentPipeline:
    if app.state.pipeline is None:
        try:
            app.state.pipeline = build_default_pipeline()
        except (ImportError, FileNotFoundError) as exc:
            raise ImportError(str(exc)) from exc
    return app.state.pipeline


app = create_app()

"""FastAPI application — REST API for the analyzer."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from analyzer.engine import AnalysisEngine
from analyzer.models import AnalysisResult, ProfileData

app = FastAPI(
    title="Facebook Profile Authenticity Analyzer",
    version="1.0.0",
    description="9-signal weighted scoring engine for detecting fake Facebook profiles",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = AnalysisEngine()

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"


@app.post("/api/analyze", response_model=AnalysisResult)
def analyze_profile(profile: ProfileData) -> AnalysisResult:
    """Analyze a Facebook profile and return the full authenticity assessment."""
    return engine.analyze(profile)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "version": "1.0.0"}


# Serve frontend
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/")
    def serve_frontend() -> FileResponse:
        return FileResponse(str(FRONTEND_DIR / "index.html"))

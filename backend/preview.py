"""Local single-port acceptance UI. Build both frontends, then uvicorn preview:app.

Uses the normal application/auth/database; it does not reset or seed test workspaces.
For local preview only. Production continues to use the existing nginx deployment.
"""
from pathlib import Path

from app.core.config import settings
from app.core.staticfiles import SPAFiles
from main import app

if settings.APP_ENV == "production":
    raise RuntimeError("preview.py is for local acceptance only")


root = Path(__file__).resolve().parent.parent
for folder in ("frontend", "admin-frontend"):
    if not (root / folder / "dist/index.html").exists():
        raise RuntimeError(f"Build {folder} before starting local preview")

# The API's root information endpoint otherwise shadows the student's index page.
app.router.routes = [route for route in app.router.routes if getattr(route, "path", None) != "/"]
app.mount("/admin", SPAFiles(directory=root / "admin-frontend/dist", html=True))
app.mount("/", SPAFiles(directory=root / "frontend/dist", html=True))

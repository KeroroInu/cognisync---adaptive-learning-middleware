"""Cache policy for public preview files only; never used for authenticated APIs."""
from pathlib import Path
import re

from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles


HASHED_ASSET = re.compile(r"^assets/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$")


class SPAFiles(StaticFiles):
    async def get_response(self, path, scope):
        try:
            response = await super().get_response(path, scope)
        except HTTPException as error:
            if error.status_code != 404 or Path(path).suffix:
                raise
            path = "index.html"
            response = await super().get_response(path, scope)
        # Pyodide currently has an unversioned URL: revalidate instead of serving
        # an old runtime for a month. Conditional requests still reuse the body.
        response.headers["Cache-Control"] = (
            "public, max-age=31536000, immutable"
            if HASHED_ASSET.fullmatch(path)
            else "no-cache"
        )
        return response

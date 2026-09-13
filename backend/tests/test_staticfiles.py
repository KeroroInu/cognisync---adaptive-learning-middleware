"""Public assets may be cached; unversioned runtime and HTML must revalidate."""
from httpx import ASGITransport, AsyncClient
import pytest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from app.core.staticfiles import SPAFiles


@pytest.fixture
def static_app(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "pyodide").mkdir()
    (tmp_path / "index.html").write_text("<p>classroom</p>")
    (tmp_path / "assets/index-abcD1234.js").write_text("export default 1")
    (tmp_path / "pyodide/pyodide.asm.wasm").write_bytes(b"\x00asm\x01\x00\x00\x00")
    (tmp_path / "pyodide/pyodide.js").write_text("/* runtime */")

    async def private_api(request):
        return JSONResponse({"answer": "private"}, headers={"Cache-Control": "no-store"})

    return Starlette(routes=[
        Route("/api/answers", private_api),
        Mount("/", SPAFiles(directory=tmp_path, html=True)),
    ])


@pytest.mark.parametrize("path", ["/", "/research/project", "/pyodide/pyodide.js", "/pyodide/pyodide.asm.wasm"])
async def test_unversioned_resources_revalidate(static_app, path):
    async with AsyncClient(transport=ASGITransport(app=static_app), base_url="http://test") as client:
        response = await client.get(path)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-cache"
        cached = await client.get(path, headers={"If-None-Match": response.headers["etag"]})
        assert cached.status_code == 304
        assert cached.content == b""
        assert cached.headers["cache-control"] == "no-cache"
        if path.endswith(".wasm"):
            assert response.headers["content-type"] == "application/wasm"


async def test_only_hashed_public_assets_are_immutable(static_app):
    async with AsyncClient(transport=ASGITransport(app=static_app), base_url="http://test") as client:
        response = await client.get("/assets/index-abcD1234.js")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
        private = await client.get("/api/answers")
        assert private.headers["cache-control"] == "no-store"


async def test_missing_runtime_is_not_spa_html(static_app):
    async with AsyncClient(transport=ASGITransport(app=static_app), base_url="http://test") as client:
        missing = await client.get("/pyodide/missing.wasm")
        assert missing.status_code == 404
        assert "classroom" not in missing.text

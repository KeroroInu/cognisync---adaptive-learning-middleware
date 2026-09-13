"""Opt-in real nginx test: TEST_NGINX_PROXY=1 pytest tests/test_deployment_static_proxy.py.

Uses the already installed nginx:alpine image without pulling, host ports, network,
or database volumes. Validate the public proxy path, not only the inner server.
"""
import gzip
import os
from pathlib import Path
import subprocess
import time
import zipfile

import pytest


pytestmark = pytest.mark.skipif(
    os.getenv("TEST_NGINX_PROXY") != "1",
    reason="Opt-in nginx container verification; no Docker required for ordinary unit tests",
)


def docker(*args):
    return subprocess.run(["docker", *args], check=True, capture_output=True, timeout=30)


@pytest.fixture(scope="module")
def proxy_container(tmp_path_factory):
    root = Path(__file__).resolve().parents[2]
    fixture = tmp_path_factory.mktemp("nginx-proxy")
    public = fixture / "public"
    (public / "pyodide").mkdir(parents=True)
    (public / "assets").mkdir()
    (public / "index.html").write_text("<p>classroom</p>")
    (public / "assets/index-abcd1234.js").write_text("/* public script */\n" * 100)
    (public / "pyodide/pyodide.asm.wasm").write_bytes(b"\x00asm" + b"example" * 1000)
    for asset in public.rglob("*"):
        if asset.is_file():
            asset.with_name(asset.name + ".gz").write_bytes(gzip.compress(asset.read_bytes()))
    with zipfile.ZipFile(public / "pyodide/python_stdlib.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("example.py", "print('public standard library')")

    config = fixture / "conf"
    config.mkdir()
    # Different loopback IPs preserve the real upstream names/ports and alias
    # behavior while all three servers remain in one isolated container.
    for name, listen_ip in (("frontend", "127.0.0.2"), ("admin-frontend", "127.0.0.3")):
        source = (root / name / "nginx.conf").read_text()
        (config / f"{name}.conf").write_text(source.replace("listen 80;", f"listen {listen_ip}:80;"))
    (config / "proxy.conf").write_text((root / "nginx-proxy/nginx.conf").read_text())
    container = docker("run", "-d", "--rm", "--pull=never", "--network", "none",
        "--add-host", "frontend:127.0.0.2", "--add-host", "admin-frontend:127.0.0.3",
        "--add-host", "backend:127.0.0.1",
        "--mount", f"type=bind,src={public},dst=/usr/share/nginx/html,readonly",
        "--mount", f"type=bind,src={config},dst=/etc/nginx/conf.d,readonly",
        "--entrypoint", "nginx", "nginx:alpine", "-g", "daemon off;").stdout.decode().strip()
    try:
        for _ in range(30):
            ready = subprocess.run(["docker", "exec", container, "wget", "-q", "-O", "/dev/null",
                                    "http://127.0.0.1:8003/"], capture_output=True, timeout=5)
            if ready.returncode == 0:
                break
            time.sleep(0.1)
        else:
            pytest.fail("Temporary nginx proxy did not start")
        yield container
    finally:
        # Exact container id returned above, never a teaching container/name.
        docker("stop", "--time", "1", container)


def response(container, path, encoding):
    result = docker("exec", container, "wget", "-S", "-O", "-",
                    f"--header=Accept-Encoding: {encoding}", f"http://127.0.0.1:8003{path}")
    headers = {}
    for line in result.stderr.decode().splitlines():
        if line.startswith("  ") and ": " in line:
            key, value = line.strip().split(": ", 1)
            headers[key.lower()] = headers.get(key.lower(), "") + value
    return headers, result.stdout


def test_wasm_compressed_through_real_proxy_with_identity_fallback(proxy_container):
    packed, compressed = response(proxy_container, "/pyodide/pyodide.asm.wasm", "gzip")
    plain, original = response(proxy_container, "/pyodide/pyodide.asm.wasm", "identity")
    assert packed["content-type"] == plain["content-type"] == "application/wasm"
    assert packed["content-encoding"] == "gzip"
    assert "content-encoding" not in plain
    assert "Accept-Encoding" in packed["vary"]
    assert packed["cache-control"] == plain["cache-control"] == "no-cache"
    assert gzip.decompress(compressed) == original
    assert len(compressed) < len(original)
    zip_headers, _ = response(proxy_container, "/pyodide/python_stdlib.zip", "gzip")
    assert zip_headers["content-type"] == "application/zip"
    assert "content-encoding" not in zip_headers


@pytest.mark.parametrize("prefix", ["", "/admin"])
def test_spa_and_hashed_asset_headers_survive_proxy(proxy_container, prefix):
    html, body = response(proxy_container, prefix + "/classroom", "gzip")
    assert html["cache-control"] == "no-cache"
    assert html["content-type"].startswith("text/html")
    assert gzip.decompress(body) == b"<p>classroom</p>"
    asset, packed = response(proxy_container, prefix + "/assets/index-abcd1234.js", "gzip")
    assert "immutable" in asset["cache-control"]
    assert "max-age=31536000" in asset["cache-control"]
    assert "Accept-Encoding" in asset["vary"]
    assert asset["content-encoding"] == "gzip"
    assert gzip.decompress(packed).startswith(b"/* public script */")

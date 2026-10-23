"""Bounded inspection only: uploaded archives are never extracted or executed."""
import io
import json
from pathlib import PurePosixPath
import re
import stat
import zipfile

from fastapi import HTTPException, Request

MAX_FILE = 10 * 1024 * 1024
SECRET_NAMES = {".env", "auth.json", "credentials.json", "task-access.json", "id_rsa", "id_ed25519", ".npmrc"}


def safe_name(name):
    if not name or len(name) > 180 or name != PurePosixPath(name).name or any(c in name for c in "\\\r\n\x00"):
        raise HTTPException(422, "文件名无效")
    if name.lower() in SECRET_NAMES:
        raise HTTPException(422, "不要上传密钥文件")
    return name


async def read_upload(request: Request):
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_FILE:
            raise HTTPException(413, "单个文件最多 10 MiB；作品包不要包含环境或依赖")
    if not data:
        raise HTTPException(422, "文件为空")
    return bytes(data)


def inspect_zip(data, expected=None):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 500 or sum(i.file_size for i in entries) > 30 * 1024 * 1024:
                raise ValueError("压缩包展开后过大或文件太多")
            names = set()
            for item in entries:
                name = item.filename
                path = PurePosixPath(name)
                if (name in names or path.is_absolute() or ".." in path.parts or ":" in name
                        or "\\" in name or "\x00" in name or item.flag_bits & 1
                        or stat.S_ISLNK(item.external_attr >> 16)):
                    raise ValueError("压缩包含不安全路径、链接、重复或加密文件")
                names.add(name)
                if expected and name != 'manifest.json' and path.parts[0] not in ('project', 'evidence'):
                    raise ValueError('作品包只接收 project、evidence 和 manifest.json')
                if any(p.lower() in SECRET_NAMES for p in path.parts):
                    raise ValueError("压缩包不能包含密钥文件")
                if not item.is_dir():
                    content = archive.read(item)  # Validate CRC without extraction.
                    if re.search(rb"(?:sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)", content):
                        raise ValueError("文件似乎包含密钥，请移除后重新打包")
            if expected is None:
                return {"files": len(entries)}
            if archive.getinfo('manifest.json').file_size > 100000:
                raise ValueError('作品清单过大')
            manifest = json.loads(archive.read("manifest.json"))
            if not isinstance(manifest, dict):
                raise ValueError('作品清单格式错误')
            if any(manifest.get(k) != v for k, v in expected.items()):
                raise ValueError("这份作品不属于当前学生或任务，请使用自己下载的文件夹")
            return {"files": len(entries), "client_manifest": {k: manifest.get(k) for k in ('schema', 'material_id', 'user_id', 'download_id', 'pi_version', 'platform')}, "source": "unverified_local_report"}
    except (ValueError, KeyError, zipfile.BadZipFile, RuntimeError, NotImplementedError, UnicodeError) as error:
        raise HTTPException(422, f"压缩包未接收：{error}") from error

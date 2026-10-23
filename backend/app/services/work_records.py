"""Read-only, bounded projections of student artifacts; never execute content."""
import io
import zipfile


def readme_preview(data: bytes):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        info = next((item for item in archive.infolist() if item.filename == 'project/README.md'), None)
        if info is None:
            return {'text': None, 'message': '这份提交中没有 project/README.md，原始作品包已保留。'}
        if info.file_size > 65536:
            return {'text': None, 'message': 'README 超过预览大小，请在本地查看；原件未改动。'}
        try:
            value = archive.read(info).decode('utf-8-sig')
        except UnicodeError:
            return {'text': None, 'message': 'README 不是 UTF-8 文本，暂不能预览；原件未改动。'}
        return {'text': value, 'message': ''}

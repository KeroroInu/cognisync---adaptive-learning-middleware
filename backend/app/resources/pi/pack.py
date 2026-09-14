"""Package only declared project/evidence files, never runtimes or credentials."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
ALLOWED = {'.py', '.md', '.txt', '.json', '.jsonl', '.csv', '.png', '.jpg', '.svg', '.html', '.css', '.js', '.wav'}


def pack():
    files = []
    for folder in ('project', 'evidence'):
        for file in sorted((ROOT / folder).rglob('*')):
            relative = file.relative_to(ROOT)
            if (file.is_symlink() or any((ROOT / Path(*relative.parts[:i])).is_symlink() for i in range(1, len(relative.parts)))
                    or not file.is_file() or any(p.startswith('.') or p in ('node_modules', '__pycache__') for p in relative.parts)):
                continue
            if file.name.lower() in ('auth.json', 'credentials.json') or file.suffix.lower() not in ALLOWED:
                continue
            files.append(file)
    if len(files) > 495 or sum(f.stat().st_size for f in files) > 29 * 1024 * 1024:
        raise ValueError('作品超过限制，请联系老师，不要删除对话记录。')
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf8'))
    manifest['files'] = [{'path': f.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(f.read_bytes()).hexdigest()} for f in files]
    target = ROOT / 'submission.zip'
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False))
        for file in files:
            archive.write(file, file.relative_to(ROOT).as_posix())
    print('已生成 submission.zip。先检查没有个人隐私或密钥，再回到网页上传。')


if __name__ == '__main__':
    pack()

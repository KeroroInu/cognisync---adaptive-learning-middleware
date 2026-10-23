#!/usr/bin/env python3
"""Bootstrap one teacher through loopback. Credentials never printed to logs."""
import json
import os
from pathlib import Path
import secrets
from urllib.request import Request, urlopen

os.umask(0o077)
destination = Path('/etc/sfls/teacher-login.json')
if destination.exists():
    raise SystemExit('Teacher credential file already exists; refusing to reset account.')
config = dict(line.split('=', 1) for line in Path('/etc/sfls/backend.env').read_text().splitlines() if '=' in line)
credentials = {'student_id': 'teacher', 'name': '李老师', 'password': secrets.token_urlsafe(18)}
with destination.open('x') as stream:
    json.dump(credentials, stream, ensure_ascii=False, indent=2)
request = Request('http://127.0.0.1:8003/api/admin/auth/create-admin',
                  data=json.dumps(credentials).encode(), headers={'Content-Type': 'application/json', 'X-ADMIN-KEY': config['ADMIN_KEY']})
with urlopen(request, timeout=30) as response:
    assert response.status == 200
print('Teacher created. Credentials saved privately to /etc/sfls/teacher-login.json.')

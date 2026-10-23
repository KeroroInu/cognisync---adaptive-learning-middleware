#!/usr/bin/env python3
"""Private PostgreSQL backup and restore rehearsal (Docker Compose deployment).

Includes database-resident uploads/history; excludes Neo4j, .env and external files.
Backups contain personal data and password hashes: encrypt off-host copies.
Restore only creates a NEW *_restore_test database, never replaces any database.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]


def compose(script, *, stdin=None, stdout=None, args=()):
    return subprocess.run(['docker', 'compose', 'exec', '-T', 'postgres', 'sh', '-ec', script, 'backup', *args],
                          cwd=ROOT, stdin=stdin, stdout=stdout, check=True)


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def backup(parent):
    if not parent.is_dir():
        raise ValueError('Choose an existing private backup directory outside the web-served folders.')
    if ROOT == parent or ROOT in parent.parents:
        raise ValueError('Backup destination must be outside the source/web-served repository.')
    folder = parent / ('cognisync-sql-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
    folder.mkdir(mode=0o700)
    archive = folder / 'database.dump'
    try:
        with archive.open('xb') as output:
            compose(': "${POSTGRES_USER:?}" "${POSTGRES_DB:?}"; exec pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"', stdout=output)
        os.chmod(archive, 0o600)
        with archive.open('rb') as source:
            compose('exec pg_restore --list', stdin=source, stdout=subprocess.DEVNULL)
        with (folder / 'manifest.json').open('x', encoding='utf-8') as stream:
            json.dump({'version': 1, 'created_at_utc': datetime.now(timezone.utc).isoformat(),
                       'bytes': archive.stat().st_size, 'sha256': checksum(archive),
                       'scope': 'PostgreSQL including database-resident uploaded files; NOT Neo4j/configuration',
                       'privacy': 'Contains identities, answers and password hashes. Encrypt external copies.'}, stream, indent=2)
    except Exception:
        print(f'Backup failed; incomplete files retained at {folder}. Do not use them.', file=sys.stderr)
        raise
    print(f'Backup verified: {folder}\nCopy encrypted backup off-host; this is not a Neo4j backup.')


def restore(folder, target, confirmed):
    if not re.fullmatch(r'[a-z][a-z0-9_]{0,42}_restore_test', target) or not confirmed:
        raise ValueError('Use a NEW name ending _restore_test and --confirm-new-database. No production restore is supported.')
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    archive = folder / 'database.dump'
    if manifest.get('version') != 1 or archive.stat().st_size != manifest['bytes'] or checksum(archive) != manifest['sha256']:
        raise ValueError('Backup checksum/format mismatch; restore refused.')
    # createdb fails when the target already exists. No DROP, --clean or reuse.
    compose('test "$1" != "$POSTGRES_DB"; exec createdb -U "$POSTGRES_USER" --template=template0 "$1"', args=(target,))
    try:
        with archive.open('rb') as source:
            compose('exec pg_restore --exit-on-error --single-transaction --no-owner --no-acl -U "$POSTGRES_USER" -d "$1"',
                    stdin=source, args=(target,))
        compose('exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -c "SELECT count(*) AS public_tables FROM information_schema.tables WHERE table_schema = \'public\';"', args=(target,))
    except Exception:
        print(f'Rehearsal failed. New database {target} is retained for inspection; no existing database was overwritten.', file=sys.stderr)
        raise
    print(f'Restored into isolated {target}. Verify key row counts and original-file hashes before approving backup readiness. Database retained; application configuration unchanged.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    save = sub.add_parser('backup'); save.add_argument('directory', type=Path)
    load = sub.add_parser('restore-test'); load.add_argument('backup_directory', type=Path)
    load.add_argument('--database', required=True); load.add_argument('--confirm-new-database', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == 'backup':
        backup(args.directory.resolve())
    else:
        restore(args.backup_directory.resolve(), args.database, args.confirm_new_database)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))

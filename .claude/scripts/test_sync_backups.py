#!/usr/bin/env python3
"""Check sync backup collisions using only disposable files."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '.agents/skills/sync-llm/scripts/sync-llm.sh'

with tempfile.TemporaryDirectory(prefix='sync-backups-') as folder:
    work = Path(folder)
    backup = work / 'backup'
    one = work / 'codex/config.toml'
    two = work / 'herdr/config.toml'
    for path, text in [(one, 'codex original'), (two, 'herdr original')]:
        path.parent.mkdir()
        path.write_text(text)
    source = SOURCE.read_text()
    function = source[source.index('backup_existing() {'):source.index('\nlink_path() {')]
    command = 'set -eu\nensure_dir() { mkdir -p "$1"; }\ninfo() { :; }\n' + function
    command += '\nBACKUP_DIR="$1"\nbackup_existing "$2"\nbackup_existing "$3"\n'
    subprocess.run(['bash', '-c', command, 'backup-test', str(backup), str(one), str(two)], check=True)
    assert not one.exists() and not two.exists()
    assert sorted(p.read_text() for p in backup.rglob('config.toml')) == ['codex original', 'herdr original']
    one.write_text('codex next run')
    two.write_text('herdr next run')
    subprocess.run(['bash', '-c', command, 'backup-test', str(backup), str(one), str(two)], check=True)
    assert sorted(p.read_text() for p in backup.rglob('config.toml')) == [
        'codex next run', 'codex original', 'herdr next run', 'herdr original']
    link = one.parent / 'existing-link'
    link.symlink_to('missing-target')
    link_command = command.rsplit('\nbackup_existing "$3"', 1)[0]
    subprocess.run(['bash', '-c', link_command, 'backup-test', str(backup), str(link)], check=True)
    assert not link.is_symlink()
    saved = backup / str(link).lstrip('/')
    assert saved.is_symlink() and saved.readlink() == Path('missing-target')
print('PASS: same-name files, repeated backup destinations and dangling symlinks preserved')

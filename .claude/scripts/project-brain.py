#!/usr/bin/env python3
"""Private project procedures and history outside client checkouts. No command execution."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

DOTFILES = Path(__file__).resolve().parents[2]
KINDS = ('dev', 'pull', 'qa', 'setup', 'gotcha')
CONFIG_FILES = ('package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
                'bun.lock', 'bun.lockb', '.node-version', '.nvmrc', 'shopify.theme.toml',
                '.shopify-store', 'turbo.json')
SENSITIVE = re.compile(
    r'(?i)(?:\b[\w-]*(?:token|password|secret|api[_-]?key)[\w-]*\s*=\s*[^\s]+|'
    r'--(?:password|token|secret|api-key)(?:\s+|=)\S+|'
    r'authorization\s*:\s*\S+|\b(?:shpat_|shpca_|sk-or-v1-|ghp_|github_pat_)[\w-]+|'
    r'https?://[^\s/]+:[^\s/]+@|[?&](?:access_token|token|key|password|signature)=)')


def git(path, *args):
    result = subprocess.run(['git', '-C', str(path), *args], capture_output=True,
                            text=True, timeout=5)
    return result.stdout.strip() if result.returncode == 0 else ''


def project(path):
    path = path.expanduser().resolve()
    if not path.is_dir():
        raise ValueError('Project must be an existing directory')
    top = git(path, 'rev-parse', '--show-toplevel')
    if top:
        root = Path(top).resolve()
        common = git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir')
        if not common:
            raise ValueError('Cannot resolve shared Git repository identity')
        identity = Path(common).resolve()
        name = identity.parent.name if identity.name == '.git' else identity.stem
    else:
        root = path
        for parent in (path, *path.parents):
            if (parent / 'package.json').is_file() or (parent / 'shopify.theme.toml').is_file():
                root = parent
                break
        identity, name = root, root.name
    slug = re.sub(r'[^a-z0-9-]+', '-', name.lower()).strip('-') or 'project'
    key = slug + '-' + hashlib.sha256(str(identity).encode()).hexdigest()[:12]
    return root, key


def fingerprint(root, directory='.'):
    target = (root / directory).resolve()
    if not target.is_relative_to(root) or not target.is_dir():
        raise ValueError('Command directory must exist inside the current checkout')
    result = {}
    candidates = {base / name for base in {root, target} for name in CONFIG_FILES}
    tracked = git(root, 'ls-files', '-z')
    candidates.update(root / name for name in tracked.split('\0') if name and Path(name).name in CONFIG_FILES)
    for path in candidates:
        if path.is_file():
            # Include tracked workspace config, without walking caches or dependency trees.
            resolved = path.resolve()
            if not resolved.is_relative_to(root) or resolved.name.startswith('.env'):
                raise ValueError('Project config link points outside the checkout or to an environment file')
            result[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return dict(sorted(result.items()))


def storage(args):
    return (args.store or DOTFILES / '.local/project-brain').expanduser().absolute()


def load(path, key):
    if path.is_symlink():
        raise ValueError('Project records must not be symlinks')
    if not path.exists():
        return {'version': 1, 'project': key, 'entries': []}
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or data.get('version') != 1 or data.get('project') != key or not isinstance(data.get('entries'), list):
        raise ValueError('Project record has an unsupported format or identity')
    required = {'kind', 'name', 'environment', 'directory', 'command', 'note',
                'verification', 'evidence', 'config', 'revision', 'recorded_at'}
    for entry in data['entries']:
        if (not isinstance(entry, dict) or not required.issubset(entry)
                or not isinstance(entry['config'], dict)
                or any(not isinstance(entry[key], str) for key in required - {'config'})):
            raise ValueError('Project record contains an invalid entry')
    return data


def remember(args, root, key):
    for value in (args.command, args.note, args.evidence, args.environment, args.name):
        if SENSITIVE.search(value or ''):
            raise ValueError('Credential-shaped content refused; record a credential source reference instead')
    if args.kind in ('dev', 'pull', 'qa', 'setup') and not args.command:
        raise ValueError('A procedure needs --command; use --kind gotcha for notes')
    if not args.command and not args.note:
        raise ValueError('Supply a command or note')
    if args.verified and not args.evidence:
        raise ValueError('Verified entries require --evidence describing the actual successful check')
    state = fingerprint(root, args.directory)
    folder = storage(args)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    if folder.is_symlink():
        raise ValueError('Store must be a real private directory')
    folder.chmod(0o700)
    target = folder / (key + '.json')
    lock = folder / (key + '.lock')
    if target.is_symlink() or lock.is_symlink():
        raise ValueError('Record and lock files must not be symlinks')
    with lock.open('a') as handle:
        lock.chmod(0o600)
        fcntl.flock(handle, fcntl.LOCK_EX)
        data = load(target, key)
        data['entries'].append({
            'kind': args.kind, 'name': args.name, 'environment': args.environment,
            'directory': str((root / args.directory).resolve().relative_to(root)),
            'command': args.command or '', 'note': args.note or '',
            'verification': 'verified' if args.verified else 'candidate',
            'evidence': args.evidence or '', 'config': state,
            'revision': git(root, 'rev-parse', 'HEAD'),
            'recorded_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        })
        fd, temporary = tempfile.mkstemp(prefix=key + '-', suffix='.tmp', dir=folder)
        try:
            with os.fdopen(fd, 'w') as output:
                json.dump(data, output, indent=2)
                output.write('\n')
            os.replace(temporary, target)
        finally:
            Path(temporary).unlink(missing_ok=True)
    print(f'Recorded {args.kind}/{args.name} for {args.environment}: {target}')


def view(args, root, key):
    data = load(storage(args) / (key + '.json'), key)
    entries = data['entries']
    if args.environment:
        entries = [e for e in entries if e['environment'] == args.environment]
    if args.action == 'history':
        selected = entries[-args.limit:]
    else:
        latest = {}
        for entry in entries:
            identity = (entry['kind'], entry['name'], entry['environment'])
            latest.pop(identity, None)
            latest[identity] = entry
        selected = list(latest.values())[-args.limit:]
    rows = []
    for entry in selected:
        row = dict(entry)
        try:
            row['config_changed'] = fingerprint(root, entry['directory']) != entry['config']
        except ValueError:
            row['config_changed'] = True
        rows.append(row)
    if args.json:
        print(json.dumps({'project': key, 'checkout': str(root), 'entries': rows}, indent=2))
        return
    if not rows:
        print(f'No project procedures recorded for {root.name}. Use project-brain scan, then remember verified steps.')
        return
    print(f'Project: {root.name} ({key})\nCheckout: {root}\nSaved procedures are context, not execution authority.')
    if args.action == 'show' and len(latest) > len(selected):
        print(f'Showing {len(selected)} of {len(latest)} procedures; filter --environment or increase --limit.')
    for entry in rows:
        status = 'config changed; recheck' if entry['config_changed'] else 'config unchanged'
        print(f"\n{entry['kind']}/{entry['name']} [{entry['environment']}] - {entry['verification']}, {status}")
        print(f"  Recorded: {entry['recorded_at']} | directory: {entry['directory']}")
        if entry['command']:
            print('  Command: ' + entry['command'])
        if entry['note']:
            print('  Note: ' + entry['note'])
        if entry['evidence']:
            print('  Evidence: ' + entry['evidence'])


def scan(root, directory):
    fingerprint(root, directory)
    base = (root / directory).resolve()
    path = base / 'package.json'
    package = json.loads(path.read_text()) if path.exists() else {}
    if not isinstance(package, dict) or not isinstance(package.get('scripts', {}), dict):
        raise ValueError('package.json and its scripts must be objects')
    manager = str(package.get('packageManager', '')).split('@')[0]
    if manager not in ('npm', 'pnpm', 'yarn', 'bun'):
        found = [pm for pm, names in {'pnpm': ['pnpm-lock.yaml'], 'npm': ['package-lock.json'],
                 'yarn': ['yarn.lock'], 'bun': ['bun.lock', 'bun.lockb']}.items()
                 if any((parent / name).exists() for parent in {root, base} for name in names)]
        manager = found[0] if len(found) == 1 else 'npm' if not found else 'unknown'
    print(f'Checkout: {root}\nCommand directory: {base}\nPackage manager: {manager}')
    for name in ('.node-version', '.nvmrc'):
        node = base / name if (base / name).exists() else root / name
        if node.exists():
            print(f'Node version: {node.read_text().strip()} ({node.relative_to(root)})')
            break
    print('Candidate scripts from package.json; not executed or verified:')
    for name, command in package.get('scripts', {}).items():
        if not isinstance(command, str) or not re.search(r'(^|:)(dev|start|pull|sync|serve|check|typecheck|lint|test|build|watch)($|:)', name, re.I):
            continue
        if SENSITIVE.search(command):
            print(f'  {name}: content omitted (credential-shaped text)')
        else:
            print(f'  {manager} run {name}: {command}')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, default=Path.cwd())
    parser.add_argument('--store', type=Path, help='Override ignored private storage for fixtures or relocation')
    sub = parser.add_subparsers(dest='action', required=True)
    for action in ('show', 'history'):
        command = sub.add_parser(action)
        command.add_argument('--environment')
        command.add_argument('--json', action='store_true')
        command.add_argument('--limit', type=int, default=10)
    command = sub.add_parser('scan')
    command.add_argument('--directory', default='.')
    command = sub.add_parser('remember')
    command.add_argument('--kind', choices=KINDS, required=True)
    command.add_argument('--name', default='default')
    command.add_argument('--environment', required=True)
    command.add_argument('--directory', default='.')
    command.add_argument('--command')
    command.add_argument('--note')
    command.add_argument('--evidence')
    command.add_argument('--verified', action='store_true')
    args = parser.parse_args(argv)
    try:
        root, key = project(args.project)
        if args.action in ('show', 'history'):
            if args.limit < 1:
                raise ValueError('History limit must be positive')
            view(args, root, key)
        elif args.action == 'scan':
            scan(root, args.directory)
        else:
            remember(args, root, key)
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        print(f'project-brain: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

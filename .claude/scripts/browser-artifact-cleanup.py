#!/usr/bin/env python3
"""Prune finished, inactive browser QA artifacts from temporary roots only."""

import argparse
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time


KINDS = ("herdr-browser-benchmark", "browser-use-benchmark", "apple-browser-qa")
MARKER = ".browser-qa-owner.json"


def process_snapshot():
    try:
        result = subprocess.run(
            ["ps", "-axww", "-o", "pid=,command="], check=True,
            capture_output=True, text=True, timeout=10,
        )
        lines = result.stdout.splitlines()
        if result.stderr or not lines:
            return None
        for line in lines:
            pid, command = line.strip().split(None, 1)
            if not pid.isdecimal() or int(pid) <= 0 or not command.strip():
                return None
        return result.stdout
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def owner_gone(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except (OSError, OverflowError):
        pass
    return False


def old_readable_tree(path, cutoff):
    pending = [path]
    while pending:
        item = pending.pop()
        info = item.lstat()
        if info.st_mtime >= cutoff or not info.st_mode & 0o444:
            return False
        if stat.S_ISDIR(info.st_mode):
            if not info.st_mode & 0o111:
                return False
            with os.scandir(item) as entries:
                pending.extend(Path(entry.path) for entry in entries)
        elif stat.S_ISREG(info.st_mode):
            with item.open("rb") as stream:
                stream.read(1)
        else:
            return False  # Includes symlinks and special files; never follow them.
    return True


def eligible(path, kind, cutoff, processes):
    try:
        if not stat.S_ISDIR(path.lstat().st_mode):
            return False
        marker = path / MARKER
        if not stat.S_ISREG(marker.lstat().st_mode):
            return False
        owner = json.loads(marker.read_text())
        if not isinstance(owner, dict) or not (
            type(owner.get("version")) is int and owner["version"] == 1
            and owner.get("kind") == kind
            and type(owner.get("pid")) is int and owner["pid"] > 0
            and isinstance(owner.get("startedAt"), str) and owner["startedAt"].strip()
            and isinstance(owner.get("finishedAt"), str) and owner["finishedAt"].strip()
        ):
            return False
        if not owner_gone(owner["pid"]):
            return False
        references = {str(path.absolute()), str(path.resolve())}
        if path.parent.resolve() == Path("/tmp").resolve():
            references.add(str(Path("/tmp") / path.name))
        if any(reference in processes for reference in references):
            return False
        return old_readable_tree(path, cutoff)
    except (OSError, ValueError, UnicodeError, RecursionError):
        return False


def cleanup(roots, days=14, dry_run=False):
    # ponytail: one process snapshot, not a lock; use per-run locks if directories are reused.
    processes = process_snapshot()
    if processes is None:
        raise RuntimeError("Process snapshot unavailable; browser artifacts retained")
    # Integer arithmetic also handles arbitrarily large positive --days values.
    cutoff = int(time.time()) - days * 86400
    for root in roots:
        try:
            children = list(root.iterdir())
        except OSError as error:
            print(f"Retained browser artifacts in {root}: {error}", file=sys.stderr)
            continue
        for path in children:
            kind = next((kind for kind in KINDS if path.name.startswith(kind + "-")), None)
            if kind and eligible(path, kind, cutoff, processes):
                if dry_run:
                    print(f"would remove: {path}")
                else:
                    try:
                        shutil.rmtree(path)
                        print(f"removed: {path}")
                    except OSError as error:
                        print(f"Could not remove {path}: {error}", file=sys.stderr)


def positive_days(value):
    try:
        days = int(value)
        if days > 0:
            return days
    except ValueError:
        pass
    raise argparse.ArgumentTypeError("days must be a positive integer")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=positive_days, default=14)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--root", type=Path, help="Override temporary roots for isolated tests")
    args = parser.parse_args(argv)
    try:
        roots = list({root.resolve(strict=True): root.absolute() for root in
                      ([args.root] if args.root else [Path(tempfile.gettempdir()), Path("/tmp")])}.values())
        if any(not root.is_dir() for root in roots):
            parser.error("root must be a readable directory")
        cleanup(roots, args.days, args.dry_run)
    except (OSError, RuntimeError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

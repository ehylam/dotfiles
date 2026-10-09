#!/usr/bin/env python3
"""Verify pane targeting and shared wrapper against an isolated tmux stub."""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='breadcrumb-check-') as directory:
    home = Path(directory)
    (home / '.dotfiles').symlink_to(ROOT, target_is_directory=True)
    binary = home / 'bin'
    binary.mkdir()
    tmux = binary / 'tmux'
    tmux.write_text('#!/bin/sh\ncase "$*" in *"-t %77"*) echo owned-session;; *) echo focused-other-session;; esac\n')
    tmux.chmod(0o755)
    env = {**os.environ, 'HOME': str(home), 'PATH': str(binary) + ':' + os.environ['PATH'], 'TMUX': 'fixture', 'TMUX_PANE': '%77'}
    for runtime in ('claude', 'codex'):
        script = ROOT / ('.' + runtime) / 'scripts/agent-breadcrumb.sh'
        target = home / ('.' + runtime) / 'state/agent-breadcrumbs/owned-session'
        for action in ('done', 'needs-input'):
            subprocess.run(['bash', str(script), 'write', action], env=env, check=True)
            assert target.read_text() == action
        assert not target.with_name('focused-other-session').exists()
        subprocess.run(['bash', str(script), 'clear'], env=env, check=True)
        assert not target.exists()
        outside = {k: v for k, v in env.items() if k != 'TMUX_PANE'}
        subprocess.run(['bash', str(script), 'write', 'done'], env=outside, check=True)
        assert not target.exists()
print('PASS: Claude/Codex breadcrumbs use owned pane, clear independently and remain silent without pane context')

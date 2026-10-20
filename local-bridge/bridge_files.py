#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""The installer, health report and local sync share the same runtime module list."""
import hashlib
import pathlib


def runtime_sources(root):
    root = pathlib.Path(root)
    paths = sorted(root.glob('study_*.py'))
    helper = root / 'bridge_files.py'
    if helper.is_file():
        paths.append(helper)
    return {path.name: path.read_bytes() for path in paths if path.is_file() and not path.is_symlink()}


def hashes(files):
    return {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}

#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""The installer, health report and local sync share the same runtime module list."""
import hashlib
import pathlib


def is_runtime_source(relative):
    """A module in the bridge root, never a development fixture in a subfolder."""
    return '/' not in relative and (relative == 'bridge_files.py' or
                                     (relative.startswith('study_') and relative.endswith('.py')))


def runtime_sources(root):
    return {p.name: p.read_bytes() for p in sorted(pathlib.Path(root).glob('*'))
            if is_runtime_source(p.name) and p.is_file() and not p.is_symlink()}


def hashes(files):
    return {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}

#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Sync source bytes to the daily extension and active bridge, never release packages."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'local-bridge'))
from bridge_files import hashes, runtime_sources

EXTENSION = pathlib.Path('/Users/apple/backup/english-study-extensions/yomitan')
RUNTIME = pathlib.Path.home() / 'Library/Application Support/EnglishStudyTranslator'
FROZEN = (pathlib.Path('/Users/apple/backup/english-study-extensions/local-bridge'),
          pathlib.Path('/Users/apple/backup/english-study-extensions/asbplayer'))
MANIFEST = pathlib.Path('ext/js/study/bridge-manifest.json')


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def generate_manifest(repo=REPO):
    path = pathlib.Path(repo) / MANIFEST
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(hashes(runtime_sources(pathlib.Path(repo) / 'local-bridge')), ensure_ascii=False, indent=4) + '\n')


def tracked(repo, ref, directory):
    return git(repo, 'ls-tree', '-r', '--name-only', ref, '--', directory).decode().splitlines()


def atomic_bytes(path, data, default_mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = path.stat().st_mode & 0o777 if path.exists() else default_mode
    fd, name = tempfile.mkstemp(prefix='.sync-local-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        os.chmod(name, mode)
        os.replace(name, path)
        if path.read_bytes() != data:
            raise ValueError('同步后字节读回不一致：' + str(path))
    finally:
        if os.path.exists(name):
            os.unlink(name)


def sync(repo=REPO, base='HEAD^', dry_run=False):
    repo = pathlib.Path(repo)
    for root in (EXTENSION, RUNTIME):
        if root.is_symlink() or any(root.resolve().is_relative_to(frozen.resolve()) for frozen in FROZEN):
            raise ValueError('拒绝写入发行包或重定向的安装目录。')
    modules = runtime_sources(repo / 'local-bridge')
    expected = hashes(modules)
    if json.loads((repo / MANIFEST).read_text()) != expected:
        raise ValueError('bridge-manifest 已过期，请先运行 --manifest-only 并提交。')
    baseline = {pathlib.Path(path).name: git(repo, 'show', base + ':' + path)
                for path in tracked(repo, base, 'local-bridge')
                if (pathlib.Path(path).name.startswith('study_') and path.endswith('.py')) or pathlib.Path(path).name == 'bridge_files.py'}
    installed = runtime_sources(RUNTIME)
    for name in set(baseline) | set(installed):
        if name not in baseline or installed.get(name) != baseline[name]:
            raise ValueError('运行中的桥不等于上一个提交，未覆盖：' + name)
    writes = []
    for name, data in modules.items():
        destination = RUNTIME / name
        if destination.is_symlink():
            raise ValueError('桥模块含符号链接，未覆盖：' + name)
        if not destination.exists() or destination.read_bytes() != data:
            writes.append((destination, data, 0o600))
    old_ext = {path.removeprefix('ext/'): path for path in tracked(repo, base, 'ext')}
    changed_ext = set(git(repo, 'diff', '--name-only', base, '--', 'ext').decode().splitlines())
    # Sync this batch's Git-owned files, leaving unrelated local UI changes and Chrome storage alone.
    for relative in git(repo, 'ls-files', '--', 'ext').decode().splitlines():
        if relative not in changed_ext and relative.removeprefix('ext/') in old_ext:
            continue
        source = repo / relative
        if not source.is_file() or source.is_symlink():
            continue
        short = relative.removeprefix('ext/')
        destination = EXTENSION / short
        if destination.is_symlink():
            raise ValueError('扩展文件含符号链接，未覆盖：' + short)
        data = source.read_bytes()
        if destination.is_file() and destination.read_bytes() == data:
            continue
        if destination.exists():
            old = git(repo, 'show', base + ':' + old_ext[short]) if short in old_ext else None
            if destination.read_bytes() != old:
                raise ValueError('日常扩展有非上一个提交的改动，未覆盖：' + short)
        writes.append((destination, data, 0o644))
    if dry_run:
        return [str(path) for path, _data, _mode in writes]
    # All comparisons above finish before either destination is changed.
    for path, data, mode in writes:
        atomic_bytes(path, data, mode)
    marker = RUNTIME / 'install-metadata.json'
    try:
        metadata = json.loads(marker.read_text())
    except (OSError, ValueError):
        metadata = {}
    files = metadata.setdefault('files', {})
    files.update({str(RUNTIME / name): value for name, value in expected.items()})
    binary = RUNTIME / 'apple-translate'
    if binary.is_file():
        files[str(binary)] = hashlib.sha256(binary.read_bytes()).hexdigest()
    metadata['sourceCommit'] = git(repo, 'rev-parse', 'HEAD').decode().strip()
    atomic_bytes(marker, (json.dumps(metadata, ensure_ascii=False, indent=2) + '\n').encode(), 0o600)
    return [str(path) for path, _data, _mode in writes]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest-only', action='store_true', help='只更新源码中的桥哈希清单，不写安装目录')
    parser.add_argument('--dry-run', action='store_true', help='只检查并列出拟同步文件')
    args = parser.parse_args()
    if args.manifest_only:
        generate_manifest()
        print('bridge-manifest.json 已更新；请随代码提交。')
    else:
        paths = sync(dry_run=args.dry_run)
        print(('拟同步' if args.dry_run else '已按字节同步并读回') + f' {len(paths)} 个文件；未触碰配置、学习数据和冻结发行包。')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)

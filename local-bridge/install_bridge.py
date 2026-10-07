#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Install only our native host. Never edit Chrome preferences, extensions or databases."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys
from study_translator import HOST_NAME, ORIGIN


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def install(home, codex, python):
    home = pathlib.Path(home)
    codex = pathlib.Path(codex).resolve()
    if not codex.is_file() or not os.access(codex, os.X_OK):
        raise ValueError('找不到 Codex CLI；安装 ChatGPT 桌面版或指定 --codex。')
    result = subprocess.run([str(codex), '--version'], capture_output=True, text=True, timeout=15)
    match = re.search(r'codex-cli (\d+)\.(\d+)\.', result.stdout)
    if not match or tuple(map(int, match.groups())) < (0, 162):
        raise ValueError('需要支持 environments 隔离协议的 Codex CLI 0.162 或更高版本。')
    runtime = home / 'Library/Application Support/EnglishStudyTranslator'
    registry = home / 'Library/Application Support/Google/Chrome/NativeMessagingHosts' / (HOST_NAME + '.json')
    marker = runtime / 'install-metadata.json'
    previous = json.loads(marker.read_text()) if marker.exists() else {'files': {}}
    content = {
        runtime / 'study_translator.py': (pathlib.Path(__file__).parent / 'study_translator.py').read_bytes(),
        runtime / 'bridge-config.json': (json.dumps({'codex': str(codex)}, indent=2) + '\n').encode(),
        runtime / 'launch-host': ('#!/bin/sh\nexec ' + shlex.quote(str(python)) + ' ' + shlex.quote(str(runtime / 'study_translator.py')) + ' "$@"\n').encode(),
        registry: (json.dumps({'name': HOST_NAME, 'description': '点击式英语翻译（本机 Codex）',
                              'path': str(runtime / 'launch-host'), 'type': 'stdio',
                              'allowed_origins': [ORIGIN]}, ensure_ascii=False, indent=2) + '\n').encode(),
    }
    for path in content:
        if path.exists() and previous.get('files', {}).get(str(path)) != digest(path):
            raise ValueError('存在未知或已手动修改的本机桥文件，停止覆盖：' + str(path))
    codex_home = runtime / 'codex-home'
    auth = codex_home / 'auth.json'
    source_home = pathlib.Path(os.environ.get('CODEX_HOME', home / '.codex'))
    source_auth = source_home / 'auth.json'
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    runtime.chmod(0o700)
    codex_home.mkdir(exist_ok=True, mode=0o700)
    codex_home.chmod(0o700)
    clean_config = codex_home / 'config.toml'
    expected_config = 'cli_auth_credentials_store = "file"\n'
    if clean_config.exists() and clean_config.read_text() != expected_config:
        raise ValueError('受限 profile 配置已被修改，停止覆盖。')
    clean_config.write_text(expected_config)
    clean_config.chmod(0o600)
    if not auth.exists() and not auth.is_symlink() and source_auth.is_file():
        auth.symlink_to(source_auth.resolve())
    if auth.is_symlink() and auth.resolve() != source_auth.resolve():
        raise ValueError('已有认证链接指向不同账号；停止替换。')
    for path, data in content.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + '.install-tmp')
        with temporary.open('xb') as file:
            file.write(data)
        temporary.chmod(0o700 if path.name == 'launch-host' else 0o600)
        temporary.replace(path)
    marker.write_text(json.dumps({'files': {str(p): digest(p) for p in content}}, indent=2) + '\n')
    marker.chmod(0o600)
    return runtime, auth.exists()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--codex')
    args = parser.parse_args()
    candidates = [args.codex, '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', shutil.which('codex')]
    codex = next((p for p in candidates if p and pathlib.Path(p).is_file()), None)
    if codex is None:
        raise ValueError('未找到 Codex CLI；不会自动下载安装或登录。')
    runtime, auth = install(pathlib.Path.home(), codex, pathlib.Path(sys.executable).resolve())
    print('本机翻译桥已安装。Chrome 中重新加载 Yomitan；点击翻译时同意本机通信权限。')
    print('本机认证可用（是否有效尚未调用模型验证）。' if auth else '尚未找到本机文件认证；需为受限 profile 登录：')
    if not auth:
        print('CODEX_HOME=' + shlex.quote(str(runtime / 'codex-home')) + ' ' + shlex.quote(codex) + ' login')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('安装未完成：' + str(error), file=sys.stderr)
        raise SystemExit(1)

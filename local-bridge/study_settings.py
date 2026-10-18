#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Yomitan-only destinations. Records stay in their original Vault; no second index."""
import fcntl
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile

from study_library import ID_RE, RELATIVE, StudyLibrary, anki_call, entry_id, normalize_entry, normalize_request, text

FIELDS = ['Word', 'Sentence', 'Definition', 'Source', 'URL', 'Audio', 'Image']
EDITABLE = {'ankiEnabled', 'vault', 'directory', 'deck', 'model'}
SETTINGS_ACTIONS = {'librarySettingsGet', 'librarySettingsSave', 'librarySettingsCheck',
                    'librarySettingsPrepare', 'librarySettingsOpen', 'libraryTargetResolve',
                    'librarySettingsDetect', 'librarySettingsPick'}


def normalize_settings_request(p):
    action = p.get('action')
    # Reuse the already-loaded extension's folder action transport; no extension reload is needed.
    if action == 'librarySettingsOpen' and 'folderAction' in p:
        actions = {'detect': 'librarySettingsDetect', 'pick': 'librarySettingsPick'}
        if p['folderAction'] not in actions:
            raise ValueError('未知的文件夹操作。')
        return normalize_settings_request({**{k: v for k, v in p.items() if k != 'folderAction'}, 'action': actions[p['folderAction']]})
    if action in ('librarySettingsGet', 'librarySettingsCheck', 'librarySettingsOpen') and set(p) == {'action'}:
        return p
    if action in ('librarySettingsDetect', 'librarySettingsPick') and set(p) == {'action', 'kind', 'vault', 'directory'}:
        if p['kind'] not in ('vault', 'directory'):
            raise ValueError('请选择 Vault 或语境目录。')
        return {**p, 'vault': text(p['vault'], 4000), 'directory': text(p['directory'], 2000)}
    if action == 'librarySettingsSave' and set(p) == {'action', 'settings'}:
        s = p['settings']
        if not isinstance(s, dict) or not EDITABLE <= set(s) or set(s) - EDITABLE - {'targetId', 'deckByKind'} or type(s['ankiEnabled']) is not bool:
            raise ValueError('保存设置字段不完整。')
        target_fields(s)
        return p
    if action == 'librarySettingsPrepare' and set(p) == {'action', 'createDeck', 'createModel'} and all(type(p[k]) is bool for k in ('createDeck', 'createModel')):
        return p
    if action == 'libraryTargetResolve' and set(p) == {'action', 'entry'}:
        return {**p, 'entry': normalize_entry(p['entry'])}
    raise ValueError('保存设置请求无效。')


def target_fields(s, allow_empty_vault=False):
    raw_vault = text(s.get('vault', ''), 4000, not allow_empty_vault)
    vault = pathlib.Path(raw_vault)
    directory = pathlib.Path(text(s.get('directory'), 2000, True))
    if (raw_vault or not allow_empty_vault) and (not vault.is_absolute() or '..' in vault.parts):
        raise ValueError('Vault 必须是绝对路径。')
    if directory.is_absolute():
        try:
            directory = directory.relative_to(vault)
        except ValueError:
            raise ValueError('记录目录必须位于所选 Vault 内。') from None
    if '..' in directory.parts:
        raise ValueError('记录目录不能包含上级路径。')
    result = {'vault': str(vault) if raw_vault else '', 'directory': str(directory),
              'deck': text(s.get('deck'), 300, True), 'model': text(s.get('model'), 300, True)}
    deck_by_kind = s.get('deckByKind', {})
    if not isinstance(deck_by_kind, dict) or len(deck_by_kind) > 20 or any(not isinstance(k, str) or not __import__('re').fullmatch(r'[a-zA-Z0-9_-]{1,40}', k) for k in deck_by_kind):
        raise ValueError('卡片牌组映射无效。')
    routes = {k: text(v, 300) for k, v in deck_by_kind.items()}
    routes = {k: v for k, v in routes.items() if v}
    if routes:
        result['deckByKind'] = routes
    result['targetId'] = hashlib.sha256(json.dumps(result, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:32]
    return result


class YomitanLibrary:
    def __init__(self, config_path, anki=anki_call, cache_dir=None):
        self.config_path = pathlib.Path(config_path)
        self.anki = anki
        self.cache_dir = cache_dir
        self.reload()

    def reload(self):
        self.config = json.loads(self.config_path.read_text())
        legacy = target_fields({'vault': self.config.get('vault', ''), 'directory': str(RELATIVE),
                                'deck': '外语::英语语境', 'model': '外语语境卡'}, allow_empty_vault=True)
        settings = self.config.get('yomitanStudy', {})
        targets = settings.get('targets', [legacy])
        self.targets = {}
        for target in targets:
            normalized = target_fields(target, allow_empty_vault=target.get('targetId') == legacy['targetId'])
            if normalized['targetId'] != target.get('targetId'):
                raise ValueError('历史目的地身份与配置不同；未重定向旧记录。')
            self.targets[normalized['targetId']] = normalized
        self.targets.setdefault(legacy['targetId'], legacy)
        self.legacy_id = settings.get('legacyTargetId', legacy['targetId'])
        self.active_id = settings.get('activeTargetId', self.legacy_id)
        self.anki_enabled = settings.get('ankiEnabled', True)
        if self.active_id not in self.targets or self.legacy_id not in self.targets or type(self.anki_enabled) is not bool:
            raise ValueError('Yomitan 保存设置无效，请重新保存目的地。')

    def settings(self, ident=None):
        return {**self.targets[ident or self.active_id], 'ankiEnabled': self.anki_enabled}

    def save_settings(self, settings):
        # Native hosts are short lived; serialize edits and atomically replace only this namespace.
        with self.config_path.with_name('.yomitan-settings.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.reload()
            target = target_fields(settings)
            vault = pathlib.Path(target['vault'])
            if not vault.is_absolute() or not vault.is_dir():
                raise ValueError('请选择已存在的 Vault 文件夹；记录子目录可在保存时新建。')
            self.targets[target['targetId']] = target
            self.active_id = target['targetId']
            self.anki_enabled = settings['ankiEnabled']
            self.config['yomitanStudy'] = {'ankiEnabled': self.anki_enabled, 'activeTargetId': self.active_id,
                                          'legacyTargetId': self.legacy_id, 'targets': list(self.targets.values())}
            fd, name = tempfile.mkstemp(prefix='.yomitan-settings-', dir=self.config_path.parent)
            try:
                with os.fdopen(fd, 'w') as stream:
                    json.dump(self.config, stream, ensure_ascii=False, indent=2)
                    stream.write('\n')
                os.chmod(name, 0o600)
                os.replace(name, self.config_path)
            finally:
                if os.path.exists(name): os.unlink(name)
        return self.settings()

    def library_for(self, ident):
        if ident not in self.targets:
            raise ValueError('保存目的地已失效；未改投当前目录。')
        return StudyLibrary(self.targets[ident]['vault'], self.anki, cache_dir=self.cache_dir,
                            target=self.settings(ident), group_words=True)

    def locate(self, ident):
        found = []
        seen = set()
        # Same folder may have several historical deck/model choices: metadata decides.
        for target_id, target in self.targets.items():
            folder = (target['vault'], target['directory'])
            if folder in seen or not pathlib.Path(target['vault']).is_absolute() or not pathlib.Path(target['vault']).is_dir(): continue
            seen.add(folder)
            lib = self.library_for(target_id)
            path = lib.path(ident)
            if path.is_file():
                record = lib.read(ident)[0]
                original = record.get('targetId', self.legacy_id)
                if original not in self.targets:
                    raise ValueError('记录的原保存目的地已失效，未改投当前目录。')
                original_lib = self.library_for(original)
                saved = record.get('savedTarget')
                if (str(original_lib.vault), str(original_lib.relative)) != folder or (saved and any(saved.get(k) != self.targets[original][k] for k in ('targetId', 'vault', 'directory', 'deck', 'model'))):
                    raise ValueError('记录原目的地与历史设置不同，未重定向。')
                found.append(original_lib)
        if len(found) > 1:
            raise ValueError('不同目录有相同学习编号，请先人工确认；没有自动覆盖。')
        return found[0] if found else None

    def check(self):
        result = self.settings()
        vault = pathlib.Path(result['vault'])
        status = {'vaultExists': vault.is_absolute() and vault.is_dir(), 'directoryExists': vault.is_absolute() and (vault / result['directory']).is_dir(),
                  'ankiConnected': False, 'deckExists': False, 'modelExists': False, 'modelCompatible': False}
        status.update({'saveAvailable': False, 'saveMessage': ''})
        try:
            lib = self.library_for(self.active_id)
            lib.check_path(lib.records)
            parent = lib.records
            while not parent.exists():
                parent = parent.parent
            if not parent.is_dir() or not os.access(parent, os.W_OK | os.X_OK):
                raise ValueError('记录路径已有同名文件，或所在文件夹不可写。')
            status['saveAvailable'] = True
            status['saveMessage'] = '可以保存；不存在的记录子目录在实际保存时创建。'
        except (ValueError, OSError):
            status['saveMessage'] = 'Vault 或记录路径不可写、不是文件夹，或含符号链接；没有试写文件。'
        result.update({'decks': [], 'models': [], 'status': status})
        try:
            result['decks'] = self.anki('deckNames', {})
            result['models'] = self.anki('modelNames', {})
            if not isinstance(result['decks'], list) or not isinstance(result['models'], list):
                raise ValueError('Anki 返回的牌组/类型列表无效。')
            status.update({'ankiConnected': True, 'deckExists': result['deck'] in result['decks'],
                           'modelExists': result['model'] in result['models']})
            if status['modelExists']:
                status['modelCompatible'] = self.anki('modelFieldNames', {'modelName': result['model']}) == FIELDS
        except Exception:
            result['error'] = 'Anki 未连接或未能读取设置；没有创建牌组、类型或卡片。'
        status['missing'] = [k for k in ('vaultExists', 'directoryExists', 'deckExists', 'modelExists') if not status[k]]
        if status['modelExists'] and not status['modelCompatible']: status['missing'].append('modelCompatible')
        return result

    def prepare(self, p):
        checked = self.check()
        s = checked['status']
        if not s['ankiConnected']:
            raise ValueError(checked['error'])
        if s['modelExists'] and not s['modelCompatible']:
            raise ValueError('已有同名笔记类型不是英语七字段，未覆盖；请选择兼容类型或新名称。')
        if p['createModel'] and not s['modelExists']:
            self.anki('createModel', {'modelName': checked['model'], 'inOrderFields': FIELDS,
                      'css': '.card {font:22px sans-serif;text-align:left;line-height:1.6;padding:20px;} img{max-width:100%;}',
                      'cardTemplates': [{'Name': '语境理解', 'Front': '{{Word}}<hr>{{Sentence}}{{Audio}}{{Image}}',
                                         'Back': '{{FrontSide}}<hr id="answer">{{Definition}}<div>{{Source}}</div>'}]})
            if self.anki('modelFieldNames', {'modelName': checked['model']}) != FIELDS:
                raise ValueError('新笔记类型字段读回不同，未继续准备牌组。')
        selected = set(filter(None, [checked['deck'], *checked.get('deckByKind', {}).values()]))
        if p['createDeck']:
            for deck in sorted(selected - set(checked['decks'])):
                self.anki('createDeck', {'deck': deck})
        result = self.check()
        result['prepared'] = selected.issubset(set(result['decks'])) and result['status']['modelCompatible']
        return result

    def folder_root(self, value):
        folder = pathlib.Path(value)
        if not folder.is_absolute() or not folder.is_dir() or folder.is_symlink():
            raise ValueError('请先选择已存在的 Vault 文件夹。')
        return folder

    def detect_folders(self, p):
        candidates = []
        if p['kind'] == 'vault':
            candidates = [p['vault']] + [t['vault'] for t in self.targets.values()]
            registry = pathlib.Path.home() / 'Library/Application Support/obsidian/obsidian.json'
            try:
                registered = json.loads(registry.read_text()).get('vaults', {})
                candidates += [v.get('path', '') for v in registered.values() if isinstance(v, dict)]
            except (OSError, ValueError, AttributeError):
                pass
            items = [{'path': value, 'label': pathlib.Path(value).name + ' · ' + value}
                     for value in dict.fromkeys(c for c in candidates if isinstance(c, str)) if value and
                     pathlib.Path(value).is_absolute() and pathlib.Path(value).is_dir() and not pathlib.Path(value).is_symlink()]
            return {'items': items, 'message': '只读取本机已登记和已配置的 Vault；其他位置可点选择文件夹。'}
        vault = self.folder_root(p['vault'])
        candidates = [p['directory']] + [t['directory'] for t in self.targets.values() if t['vault'] == str(vault)]
        candidates += [str(child.relative_to(vault)) for child in sorted(vault.iterdir(), key=lambda x: x.name.casefold())
                       if not child.name.startswith('.') and child.is_dir() and not child.is_symlink()][:100]
        items = []
        for value in dict.fromkeys(candidates):
            folder = vault / value
            if not value or not folder.is_dir() or folder.is_symlink(): continue
            try:
                relative = folder.resolve().relative_to(vault.resolve())
            except ValueError:
                continue
            items.append({'path': str(relative), 'label': str(relative)})
        return {'items': items, 'message': '列出已有保存位置和库内一级文件夹；更深的目录可点选择文件夹，不扫描笔记正文。'}

    def pick_folder(self, p):
        vault = self.folder_root(p['vault']) if p['kind'] == 'directory' else None
        default = vault / p['directory'] if vault else pathlib.Path(p['vault'])
        if not default.is_absolute() or not default.is_dir(): default = vault or pathlib.Path.home()
        prompt = '选择 Obsidian Vault 文件夹' if vault is None else '选择 Vault 内的语境根目录（笔记存入其下的记录文件夹）'
        script = ('on run argv\n'
                  'set picked to choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv))\n'
                  'return POSIX path of picked\nend run')
        try:
            result = subprocess.run(['/usr/bin/osascript', '-e', script, '--', prompt, str(default)],
                                    capture_output=True, text=True, timeout=90)
        except subprocess.TimeoutExpired:
            raise ValueError('选择文件夹已超时；原设置没有改变，可重新选择。') from None
        if result.returncode:
            if '-128' in result.stderr: return {'cancelled': True}
            raise ValueError('系统文件夹选择器未完成；原设置没有改变。')
        chosen = self.folder_root(result.stdout.strip())
        if vault:
            try:
                chosen = chosen.resolve().relative_to(vault.resolve())
            except ValueError:
                raise ValueError('语境目录必须位于当前选定的 Vault 内；原设置未改变。') from None
        return {'path': str(chosen), 'cancelled': False}

    def handle(self, payload):
        p = normalize_request(payload)
        self.reload()
        action = p['action']
        if action in SETTINGS_ACTIONS:
            if action in ('librarySettingsDetect', 'librarySettingsPick'):
                result = self.detect_folders(p) if action == 'librarySettingsDetect' else self.pick_folder(p)
                self.reload()
                return {**self.settings(), **result}
            if action == 'librarySettingsGet': return self.settings()
            if action == 'librarySettingsSave': return self.save_settings(p['settings'])
            if action == 'librarySettingsCheck': return self.check()
            if action == 'librarySettingsPrepare': return self.prepare(p)
            if action == 'librarySettingsOpen':
                target = self.settings()
                folder = pathlib.Path(target['vault']) / target['directory']
                if not folder.is_dir(): raise ValueError('记录文件夹尚不存在；保存第一条记录后可打开。')
                subprocess.run(['/usr/bin/open', str(folder)], check=True, timeout=10)
                return {**target, 'opened': True}
            if p['entry'].get('language', 'en') != 'en':
                raise ValueError('此设置只用于 Yomitan 英语学习。')
            lib = self.locate(entry_id(p['entry']))
            return self.settings(lib.target_id if lib else self.active_id)
        lang = p.get('language', p.get('entry', {}).get('language', 'en'))
        if lang != 'en':
            return StudyLibrary(self.config['vault'], self.anki, lang, self.cache_dir).handle(p)
        if action == 'librarySave':
            lib = self.locate(entry_id(p['entry'])) or self.library_for(p.get('targetId', self.legacy_id))
            return lib.handle(p)
        if action == 'libraryFavorite' and p.get('entry'):
            ident = entry_id(p['entry'])
            lib = self.locate(ident) or self.library_for(p.get('targetId', self.active_id))
            return lib.handle(p)
        if action == 'libraryList':
            rows = []
            seen = set()
            for target_id, target in self.targets.items():
                folder = (target['vault'], target['directory'])
                if folder in seen or not pathlib.Path(target['vault']).is_absolute() or not pathlib.Path(target['vault']).is_dir(): continue
                seen.add(folder)
                lib = self.library_for(target_id)
                if not lib.records.is_dir(): continue
                for file, ident in lib.record_files():
                    row = self.locate(ident).result(ident)
                    e = row['entry']
                    match = True if p.get('scope') == 'all' else (row['ankiState'] == 'pending' if p.get('scope') == 'pending' else e['url'] == p['url'] and (p['url'] or e['title'] == p['title']))
                    if match:
                        rows.append(row)
            rows.sort(key=lambda row: row['created'], reverse=True)
            offset = p.get('offset', 0)
            return {'items': rows[offset:offset + 10], 'total': len(rows), 'ankiEnabled': self.anki_enabled, 'target': self.settings()}
        ids = p.get('ids', []) or [r['id'] for r in p.get('items', [])] or ([p['id']] if p.get('id') else [])
        if ids and action in ('libraryRead','librarySync','libraryCards','libraryDraftSave','libraryDraftDiscard','libraryDraftCommit','libraryEnrich','libraryMedia','libraryCardsAdd','libraryUpdate','libraryReconcile','libraryFavorite'):
            # Split mixed destinations while preserving caller ordering and per-record versions.
            rows = []
            for ident in ids:
                lib = self.locate(ident)
                if lib is None: raise ValueError('没有找到原学习记录；未改投当前目录。')
                if action == 'libraryCardsAdd':
                    lib.new_card_defaults = self.settings()
                request = {**p}
                if 'ids' in p: request['ids'] = [ident]
                if 'items' in p: request['items'] = [r for r in p['items'] if r['id'] == ident]
                if p.get('targetId') and lib.target_id != p['targetId']:
                    raise ValueError('记录目标与请求目标不同；未改投。')
                result = lib.handle(request)
                if 'items' not in result: return result
                rows.extend(result['items'])
            return {'items': rows, 'ankiEnabled': self.anki_enabled}
        return self.library_for(self.active_id).handle(p)

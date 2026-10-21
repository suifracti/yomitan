# SPDX-License-Identifier: GPL-3.0-or-later
"""Caption translation with Apple's on-device Translation framework.

The compiled helper (apple-translate/main.swift) runs locally; no text leaves the Mac.
"""
import json
import pathlib
import subprocess

LANGUAGES = {'en': 'en', 'ja': 'ja', 'zh': 'zh-Hans'}
TARGET = 'zh-Hans'
MESSAGES = {
    'download': 'Apple 翻译还没有英文→简体中文语言包：请在“系统设置 > 通用 > 语言与地区 > 翻译语言”中下载后重试。',
    'unsupported': 'Apple 翻译不支持这组语言。',
    'input': 'Apple 翻译请求无效。',
}


def normalize_request(value):
    if not isinstance(value, dict) or set(value) - {'action', 'items', 'language', 'target'} or value.get('action') != 'appleTranslate':
        raise ValueError('Apple 翻译参数无效。')
    language = value.get('language', 'en')
    if language not in LANGUAGES:
        raise ValueError('Apple 翻译支持英文、日文和中文原文。')
    items = value.get('items')
    if not isinstance(items, list) or not 1 <= len(items) <= 8:
        raise ValueError('每批 1–8 句。')
    result = []
    total = 0
    for item in items:
        if not isinstance(item, dict) or set(item) != {'id', 'text'} or not isinstance(item['id'], str) or not isinstance(item['text'], str):
            raise ValueError('字幕行格式无效。')
        text = item['text'].strip()
        if not text or len(text) > 2400 or not 1 <= len(item['id']) <= 128:
            raise ValueError('字幕行为空或过长。')
        total += len(text)
        result.append({'id': item['id'], 'text': text})
    if total > 6000:
        raise ValueError('每批最多 6000 字。')
    if len({item['id'] for item in result}) != len(result):
        raise ValueError('字幕行编号重复。')
    if value.get('target', 'zh') not in ('zh', 'en'):
        raise ValueError('翻译目标只支持中文或英文。')
    return {'action': 'appleTranslate', 'items': result, 'language': language, **({'target': 'en'} if value.get('target') == 'en' else {})}


def translate(payload, binary):
    binary = pathlib.Path(binary)
    if not binary.is_file():
        raise ValueError('本机还没有编译 Apple 翻译工具：请重新运行“安装本机翻译桥”。')
    request = {'source': LANGUAGES[payload['language']], 'target': 'en' if payload.get('target') == 'en' else TARGET, 'texts': [item['text'] for item in payload['items']]}
    try:
        done = subprocess.run([str(binary)], input=json.dumps(request).encode(), capture_output=True, timeout=60)
    except subprocess.TimeoutExpired:
        raise ValueError('Apple 翻译超时，请稍后重试。')
    try:
        output = json.loads(done.stdout.decode() or '{}')
    except ValueError:
        output = {}
    translations = output.get('translations')
    if done.returncode != 0 or not isinstance(translations, list) or len(translations) != len(payload['items']):
        raise ValueError(MESSAGES.get(output.get('code'), 'Apple 翻译未完成：' + str(output.get('error') or done.returncode)))
    if any(not isinstance(t, str) or not t.strip() for t in translations):
        raise ValueError('Apple 翻译有空白结果，原文已保留。')
    return {'items': [{'id': item['id'], 'translation': text.strip()} for item, text in zip(payload['items'], translations)]}

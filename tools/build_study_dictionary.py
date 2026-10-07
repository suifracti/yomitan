#!/usr/bin/env python3
"""Reproducible ECDICT -> Yomitan v3 conversion (data license: MIT).
Only source fields are rendered; no generated examples, meanings or CEFR levels.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import zipfile

SOURCE_SHA256 = '1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf'
TITLE = 'ECDICT 英语学习词典'
TAGS = {'zk': '中考', 'gk': '高考', 'cet4': '四级', 'cet6': '六级', 'ky': '考研', 'toefl': 'TOEFL', 'ielts': 'IELTS', 'gre': 'GRE'}
FORMS = {'p': '过去式', 'd': '过去分词', 'i': '现在分词', '3': '第三人称', 'r': '比较级', 't': '最高级', 's': '复数', '0': '原形'}

def clean(value):
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', value or '').strip()

def lines(value):
    return [s.strip() for s in clean(value).replace('\\n', '\n').splitlines() if s.strip()]

def node(tag, content, role=None, **extra):
    return {'tag': tag, 'content': content, **({'data': {'studyRole': role}} if role else {}), **extra}

def paragraphs(value):
    return [node('div', s) for s in lines(value)]

def convert(row, sequence):
    word = clean(row.get('word'))
    if not word:
        return None
    parts = []
    phonetic = clean(row.get('phonetic'))
    if phonetic:
        parts.append(node('div', f'/{phonetic}/', 'phonetic'))
    zh = lines(row.get('translation'))
    if zh:
        parts.append(node('div', [node('div', '中文释义', 'label'), *[node('div', s) for s in zh[:3]]], 'meaning'))
        if len(zh) > 3:
            parts.append(node('details', [node('summary', '展开其余中文释义'), *[node('div', s) for s in zh[3:]]], 'more'))
    english = clean(row.get('definition'))
    if english:
        parts.append(node('details', [node('summary', '英文解释'), *paragraphs(english)], 'english', lang='en'))
    forms = []
    for item in clean(row.get('exchange')).split('/'):
        key, sep, value = item.partition(':')
        if sep and key in FORMS and value:
            forms.append(node('div', [node('span', FORMS[key] + '：', 'label'), value]))
    if forms:
        parts.append(node('details', [node('summary', '词形变化'), *forms], 'forms'))
    tags = [TAGS[t] for t in clean(row.get('tag')).split() if t in TAGS]
    if tags:
        parts.append(node('div', [node('span', t, 'chip') for t in tags], 'tags'))
    frequency = []
    for key, label in [('bnc', 'BNC'), ('frq', 'COCA')]:
        value = clean(row.get(key))
        if value.isdigit() and int(value) > 0:
            frequency.append(f'{label} 排名 {value}')
    if frequency:
        parts.append(node('details', [node('summary', '词频资料'), node('div', ' · '.join(frequency)), node('div', '原数据语料排名，不代表难度或掌握程度。')], 'frequency'))
    content = node('div', parts, 'card')
    return [word, '', '', '', 0, [{'type': 'structured-content', 'content': content}], sequence, '']

def build(source, output, license_path):
    checksum = hashlib.sha256(source.read_bytes()).hexdigest()
    if checksum != SOURCE_SHA256:
        raise ValueError(f'Source checksum mismatch: {checksum}; review a new source before updating the pin')
    index = dict(title=TITLE, revision='ECDICT-study-2026-10-07.2', format=3, sequenced=True,
                 author='skywind3000 / ECDICT contributors', url='https://github.com/skywind3000/ECDICT',
                 description='ECDICT 原数据：中文简释、英文解释、音标、词形、考试标签和语料排名。释义可能陈旧或不完整；不包含虚构例句或学习状态。', sourceLanguage='en', targetLanguage='zh')
    count = 0
    def write(z, name, value):
        info = zipfile.ZipInfo(name, (2026, 10, 7, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, value, compresslevel=9)
    with zipfile.ZipFile(output, 'w') as z, source.open(newline='') as f:
        write(z, 'index.json', json.dumps(index, ensure_ascii=False))
        bank, number = [], 1
        for row in csv.DictReader(f):
            term = convert(row, count + 1)
            if term is None:
                continue
            count += 1
            bank.append(term)
            if len(bank) == 10000:
                write(z, f'term_bank_{number}.json', json.dumps(bank, ensure_ascii=False, separators=(',', ':')))
                bank, number = [], number + 1
        if bank:
            write(z, f'term_bank_{number}.json', json.dumps(bank, ensure_ascii=False, separators=(',', ':')))
        write(z, 'LICENSE.txt', license_path.read_bytes())
        write(z, 'SOURCE.txt', f'https://github.com/skywind3000/ECDICT/blob/master/ecdict.csv\nGit blob: c4ade63ea08cf39d9c3475e96929036d64d94c94\nSHA256: {checksum}\nData license: MIT; original attribution in LICENSE.txt.\nConverted by tools/build_study_dictionary.py; no generated examples.\n')
    print(f'{count} entries; {output.stat().st_size} bytes; sha256 {hashlib.sha256(output.read_bytes()).hexdigest()}')

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--license', type=Path, required=True)
    args = p.parse_args()
    build(args.source, args.output, args.license)

#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""One explicitly chosen grouped note: move metadata behind prose, never migrate a Vault.
Default is read-only; --apply requires the displayed original SHA256. IDs, text,
Anki note IDs and state are preserved. No model or Anki requests are made.
"""
import argparse, hashlib, json, os, pathlib, re, sys, tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'local-bridge'))
from study_library import StudyLibrary

def inspect(vault,relative):
    vault=pathlib.Path(vault).expanduser();relative=pathlib.Path(relative)
    if not vault.is_absolute() or not vault.is_dir() or relative.is_absolute() or '..' in relative.parts:
        raise ValueError('只接受既有 Vault 和 Vault 内的相对文件路径。')
    file=vault/relative
    if file.parent.name!='记录' or not re.search(r'--w[a-f0-9]{32}\.md$',file.name):
        raise ValueError('只整理明确选中的单词文档，不扫描或修改其他笔记。')
    lib=StudyLibrary(vault,group_words=True)
    lib.relative=relative.parent.parent;lib.base=vault/lib.relative;lib.records=file.parent
    lib.check_path(file)
    before=lib.file_content(file)
    contexts=lib.word_contexts(before)
    after=before
    for _,(record,body,version,(start,end)) in sorted(contexts.items(),key=lambda item:item[1][3][0],reverse=True):
        after=after[:start]+lib.context_block(record,body)+after[end:]
    # Same records and same complete prose after changing marker placement.
    verified=lib.word_contexts(after)
    if set(verified)!=set(contexts) or any(verified[k][:2]!=contexts[k][:2] for k in contexts):
        raise ValueError('整理前后内容不一致，停止。')
    return lib,file,before,after

def apply(vault,relative,expected):
    lib,file,before,after=inspect(vault,relative)
    with lib.locked():
        current=file.read_text()
        if hashlib.sha256(current.encode()).hexdigest()!=expected or current!=before:
            raise ValueError('笔记已修改，未覆盖；请重新只读检查。')
        if before==after:return {'changed':False,'message':'已经是可读格式'}
        backup=lib.base/'.study-view-backups';backup.mkdir(exist_ok=True)
        lib.check_path(backup)
        saved=backup/(file.name+'.'+expected[:16]+'.txt')
        if saved.exists():
            lib.check_path(saved)
            if saved.read_text()!=before:raise ValueError('已有备份内容不同，停止。')
        else:
            with os.fdopen(os.open(saved,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'w') as stream:stream.write(before)
        fd,name=tempfile.mkstemp(prefix='.study-view-',dir=file.parent)
        try:
            with os.fdopen(fd,'w') as stream:
                stream.write(after);stream.flush();os.fsync(stream.fileno())
            if file.read_text()!=before:raise ValueError('笔记在整理期间变化，未覆盖。')
            os.replace(name,file)
        finally:
            if os.path.exists(name):os.unlink(name)
        if file.read_text()!=after:raise ValueError('整理后读回不一致，原文已备份。')
    return {'changed':True,'backup':str(saved),'sha256':hashlib.sha256(after.encode()).hexdigest()}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--vault',required=True);parser.add_argument('--file',required=True);parser.add_argument('--apply',action='store_true');parser.add_argument('--expected')
    args=parser.parse_args()
    if args.apply:
        if not args.expected:parser.error('--apply requires --expected from a read-only check')
        result=apply(args.vault,args.file,args.expected)
    else:
        lib,file,before,after=inspect(args.vault,args.file)
        result={'mode':'read-only','contexts':len(lib.word_contexts(before)),'changed':before!=after,'sha256':hashlib.sha256(before.encode()).hexdigest()}
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':
    try:main()
    except Exception as error:print('未完成：'+str(error),file=sys.stderr);raise SystemExit(1)

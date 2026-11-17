#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Check/install the seven-field study card VIEW, never notes or schedules.

Default is read-only. --apply requires the exact fingerprint from a prior check.
Templates and CSS are backed up locally before any explicit view update.
--restore uses that backup only for the same profile and note type.
"""
import argparse, datetime, hashlib, json, os, pathlib, sys, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'local-bridge'))
from study_cards import REVIEW_FIELDS as FIELDS, read_review_view, review_view_state
from study_review_view import FRONT, BACK, CSS
ASSETS=ROOT/'assets'/'study-review'

def request(action,params):
    data=json.dumps({'action':action,'version':6,'params':params}).encode()
    req=urllib.request.Request('http://127.0.0.1:8766',data=data,headers={'Content-Type':'application/json'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=8) as res:
        payload=json.loads(res.read(2000000))
    if not isinstance(payload,dict) or payload.get('error') or 'result' not in payload:
        raise ValueError('Anki 未接受模板请求：'+str(payload.get('error')))
    return payload['result']

def fingerprint(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def inspect(model,api=request):
    fields=api('modelFieldNames',{'modelName':model})
    if fields!=FIELDS:raise ValueError('该类型不是原英语七字段；停止，不改变字段或卡片。')
    return {'model':model,'fields':fields,**read_review_view(api,model)}

def model_identity(model,api):
    try:
        profile=api('getActiveProfile',{})
        ident=api('modelNamesAndIds',{})[model]
    except (KeyError,TypeError,ValueError,OSError):
        return None  # Older AnkiConnect: keep the manual backup usable.
    return fingerprint([profile,ident]) if isinstance(profile,str) and profile and isinstance(ident,int) else None

def write_view(model,current,target,api):
    if current['templates']!=target['templates']:
        api('updateModelTemplates',{'model':{'name':model,'templates':target['templates']}})
    if current['styling']!=target['styling']:
        api('updateModelStyling',{'model':{'name':model,'css':target['styling']['css']}})
    new=inspect(model,api)
    if any(new[key]!=target[key] for key in ('templates','styling')):
        raise ValueError('Anki 读回的题面和样式与选择的不同。')
    return new

def apply_view(model,template,expected,backup_dir,api=request):
    old=inspect(model,api)
    if fingerprint(old)!=expected:raise ValueError('模板已变化，请重新只读检查；没有覆盖。')
    # CSS is shared by all cards in a note type. Do not restyle unrelated templates.
    if len(old['templates'])!=1:raise ValueError('该类型有多个卡模板，共享样式可能影响其他卡型；停止，不自动修改。')
    if not template:
        template=next(iter(old['templates']))
    if template not in old['templates']:raise ValueError('指定卡模板不存在；不创建新卡型。')
    state=review_view_state(old)
    if state=='unknown':raise ValueError('没能读全原题面和样式；未作修改。')
    if state=='current':return {'updatedViewOnly':False,'model':model,'template':template,'fingerprint':expected}
    backup_dir=pathlib.Path(backup_dir).expanduser()
    if any(p.is_symlink() for p in [backup_dir,*backup_dir.parents]):raise ValueError('备份位置不能是符号链接。')
    backup_dir.mkdir(parents=True,exist_ok=True)
    name='study-card-view-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.json'
    backup=backup_dir/name
    target={'templates':{template:{'Front':FRONT,'Back':BACK}},'styling':{'css':CSS}}
    undo={'target':model_identity(model,api),**{key:fingerprint(value) for key,value in target.items()}}
    with os.fdopen(os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as stream:
        json.dump({**old,'undo':undo},stream,ensure_ascii=False,indent=2)
    try:
        new=write_view(model,old,target,api)
    except (ValueError,OSError) as e:
        raise ValueError(f'更换没有确认完成；先不要重复更换。原题面备份在 {backup}。') from e
    return {'updatedViewOnly':True,'model':model,'template':template,'backup':str(backup),
            'canAutoRestore':bool(undo['target']),'fingerprint':fingerprint(new)}

def restore_view(model,backup,api=request):
    old=json.loads(pathlib.Path(backup).expanduser().read_text())
    undo=old.get('undo',{})
    if not undo.get('target'):
        raise ValueError('这份备份没有记下原来的账户和笔记类型，不能自动还原。可在 Anki 里手动取回 Front、Back 和 css。')
    if model!=old['model'] or old['fields']!=FIELDS or model_identity(model,api)!=undo['target']:
        raise ValueError('不是更换时的 Anki 账户或笔记类型。没有改动，请打开原来的账户。')
    current=inspect(model,api)
    if len(old['templates'])!=1 or current['templates'].keys()!=old['templates'].keys():
        raise ValueError('模板名称或数量改过，未还原。')
    changed=[key for key in ('templates','styling') if current[key]!=old[key]]
    if any(fingerprint(current[key])!=undo[key] for key in changed):
        raise ValueError('更换后又改过题面或样式，已保留你的修改。可从备份手动取回需要的部分。')
    if changed:
        try:
            write_view(model,current,old,api)
        except (ValueError,OSError) as e:
            raise ValueError('还原没有确认完成；备份仍在。请打开原来的 Anki 账户，检查后再运行同一条还原命令。') from e
    return {'restoredViewOnly':bool(changed),'model':model}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',default='外语语境卡');parser.add_argument('--template')
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--apply',action='store_true');mode.add_argument('--restore',metavar='BACKUP')
    parser.add_argument('--expected')
    parser.add_argument('--backup-dir',default=str(pathlib.Path.home()/'Library/Application Support/EnglishStudyTranslator/template-backups'))
    args=parser.parse_args()
    if args.apply:
        if not args.expected:parser.error('--apply requires --expected from the read-only check')
        result=apply_view(args.model,args.template,args.expected,args.backup_dir)
    elif args.restore:
        result=restore_view(args.model,args.restore)
    else:
        state=inspect(args.model)
        result={'mode':'read-only','model':args.model,'reviewView':review_view_state(state),'templates':list(state['templates']),'fingerprint':fingerprint(state),
                'next':'仅检查，未改动。决定更换已有卡的题面时才加 --apply --expected <fingerprint>。'}
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':
    try:main()
    except Exception as e:
        print('未完成：'+str(e),file=sys.stderr);raise SystemExit(1)

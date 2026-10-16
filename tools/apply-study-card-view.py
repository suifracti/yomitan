#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Check/install the seven-field study card VIEW, never notes or schedules.

Default is read-only. --apply requires the exact fingerprint from a prior check.
Templates and CSS are backed up locally before any explicit view update.
"""
import argparse, datetime, hashlib, json, os, pathlib, sys, urllib.request
FIELDS=['Word','Sentence','Definition','Source','URL','Audio','Image']
ASSETS=pathlib.Path(__file__).resolve().parents[1]/'assets'/'study-review'

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
    return {'model':model,'fields':fields,'templates':api('modelTemplates',{'modelName':model}),
            'styling':api('modelStyling',{'modelName':model})}

def apply_view(model,template,expected,backup_dir,api=request):
    old=inspect(model,api)
    if fingerprint(old)!=expected:raise ValueError('模板已变化，请重新只读检查；没有覆盖。')
    # CSS is shared by all cards in a note type. Do not restyle unrelated templates.
    if len(old['templates'])!=1:raise ValueError('该类型有多个卡模板，共享样式可能影响其他卡型；停止，不自动修改。')
    if not template:
        template=next(iter(old['templates']))
    if template not in old['templates']:raise ValueError('指定卡模板不存在；不创建新卡型。')
    backup_dir=pathlib.Path(backup_dir).expanduser()
    if any(p.is_symlink() for p in [backup_dir,*backup_dir.parents]):raise ValueError('备份位置不能是符号链接。')
    backup_dir.mkdir(parents=True,exist_ok=True)
    name='study-card-view-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.json'
    backup=backup_dir/name
    with os.fdopen(os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as stream:
        json.dump(old,stream,ensure_ascii=False,indent=2)
    front=(ASSETS/'front.html').read_text();back=(ASSETS/'back.html').read_text();css=(ASSETS/'card.css').read_text()
    # No addNote/updateNoteFields/deleteNotes/answerCards calls are used.
    api('updateModelTemplates',{'model':{'name':model,'templates':{template:{'Front':front,'Back':back}}}})
    api('updateModelStyling',{'model':{'name':model,'css':css}})
    new=inspect(model,api)
    if new['templates'][template]!= {'Front':front,'Back':back} or new['styling'].get('css')!=css:
        raise ValueError('模板读回未一致；备份在 '+str(backup)+'。不要反复应用，先核对当前状态。')
    return {'updatedViewOnly':True,'model':model,'template':template,'backup':str(backup),'fingerprint':fingerprint(new)}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',default='外语语境卡');parser.add_argument('--template')
    parser.add_argument('--apply',action='store_true');parser.add_argument('--expected')
    parser.add_argument('--backup-dir',default=str(pathlib.Path.home()/'Library/Application Support/EnglishStudyTranslator/template-backups'))
    args=parser.parse_args()
    if args.apply:
        if not args.expected:parser.error('--apply requires --expected from the read-only check')
        result=apply_view(args.model,args.template,args.expected,args.backup_dir)
    else:
        state=inspect(args.model)
        result={'mode':'read-only','model':args.model,'templates':list(state['templates']),'fingerprint':fingerprint(state),
                'next':'Use --apply --expected <fingerprint> only after explicitly deciding to update this existing template.'}
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':
    try:main()
    except Exception as e:
        print('未完成：'+str(e),file=sys.stderr);raise SystemExit(1)

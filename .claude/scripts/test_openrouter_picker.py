#!/usr/bin/env python3
"""Exercise the picker with fake CLIs; never start a model or contact a live pane."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PICKER = ROOT / '.config/herdr/openrouter-picker.sh'

with tempfile.TemporaryDirectory(prefix='herdr-model-picker-') as td:
    tmp = Path(td)
    project = tmp / "a project ' $(touch unsafe)"
    project.mkdir()
    fake = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root=Path(os.environ['CHECK_DIR']); tool=Path(sys.argv[0]).name; args=sys.argv[1:]
with (root/'calls').open('a') as f: f.write(json.dumps([tool,*args])+'\\n')
stage = tool if tool!='herdr' else ' '.join(args[:2])
if os.environ.get('FAIL')==stage:
    print('fixture failure: '+stage,file=sys.stderr); sys.exit(2)
if tool=='opencode':
    print(os.environ.get('CATALOG', 'openrouter/a\\nopenrouter/b\\nopenrouter/c\\nopenrouter/d'))
elif tool=='fzf':
    sys.stdin.read(); print(os.environ.get('SELECT', 'openrouter/a'))
    sys.exit(int(os.environ.get('FZF_EXIT','0')))
elif args[:2]==['pane','current']:
    print(os.environ.get('CONTEXT',json.dumps({'result':{'pane':{'pane_id':'w1:p1','workspace_id':'w1','cwd':os.environ['PROJECT']}}})))
elif args[:2]==['agent','list']:
    agents=json.loads(os.environ.get('AGENTS','[]'))
    if (root/'started').exists(): agents+=json.loads((root/'started').read_text())
    print(os.environ.get('AGENT_RESPONSE',json.dumps({'result':{'agents':agents}})))
elif args[:2]==['tab','create']:
    n=int((root/'tabs').read_text())+1 if (root/'tabs').exists() else 1
    (root/'tabs').write_text(str(n))
    print(os.environ.get('TAB_RESPONSE',json.dumps({'result':{'root_pane':{'pane_id':f'w1:p{n+1}'}}})))
elif args[:2]==['agent','start']:
    prior=json.loads((root/'started').read_text()) if (root/'started').exists() else []
    prior.append({'name':args[2],'pane_id':args[args.index('--pane')+1],'agent_status':os.environ.get('START_STATE','working')})
    (root/'started').write_text(json.dumps(prior))
else: print('unexpected command',file=sys.stderr); sys.exit(3)
'''
    for name in ('herdr','opencode','fzf'):
        path=tmp/name; path.write_text(fake); path.chmod(0o755)
    env=dict(os.environ,PATH=f'{tmp}:{os.environ["PATH"]}',HERDR_ENV='1',CHECK_DIR=td,PROJECT=str(project))
    for key in ('HERDR_PANE_ID','HK_PANE'): env.pop(key,None)

    def run(*args, picker=PICKER, **extra):
        for name in ('calls','tabs','started'):
            (tmp/name).unlink(missing_ok=True)
        result=subprocess.run(['/bin/bash',str(picker),*(args or ('all',))],env=dict(env,**extra),capture_output=True,text=True,timeout=5)
        calls=[json.loads(s) for s in (tmp/'calls').read_text().splitlines()] if (tmp/'calls').exists() else []
        return result,calls

    def starts(calls): return [c for c in calls if c[:3]==['herdr','agent','start']]
    def creates(calls): return [c for c in calls if c[:3]==['herdr','tab','create']]

    shortlist=json.loads((ROOT/'.config/herdr/openrouter-models.json').read_text())['allowlist']
    paid=['openrouter/'+model for model in shortlist if model!='openrouter/free']
    catalog='\n'.join([*paid,'openrouter/anthropic/claude-opus-5.5','openrouter/free'])
    for model in paid:
        result,calls=run('openrouter',CATALOG=catalog,SELECT=model)
        assert result.returncode==0 and len(starts(calls))==1,(model,result.stderr)
    linked_picker=tmp/'linked-picker.sh'
    linked_picker.symlink_to(PICKER)
    result,calls=run('openrouter',picker=linked_picker,CATALOG=catalog,SELECT=paid[0])
    assert result.returncode==0 and len(starts(calls))==1,result.stderr
    for model in ('openrouter/anthropic/claude-opus-5.5','openrouter/free'):
        result,calls=run('openrouter',CATALOG=catalog,SELECT=model)
        assert result.returncode!=0 and not creates(calls)
    result,calls=run('openrouter',CATALOG='openrouter/unlisted')
    assert result.returncode!=0 and not creates(calls)

    # Literal model IDs and project paths travel as native argv, including shell syntax.
    model="openrouter/~vendor/a'$(touch unsafe);b"
    result,calls=run(CATALOG=model,SELECT=model)
    assert result.returncode==0,(result.stdout,result.stderr)
    assert calls[0]==['herdr','pane','current']
    start=starts(calls)[0]; assert start[start.index('--')+1:]==['--model',model,str(project)]
    tab=creates(calls)[0]; assert tab[tab.index('--workspace')+1]=='w1' and tab[tab.index('--cwd')+1]==str(project) and '--no-focus' in tab
    assert not (ROOT/'unsafe').exists()
    for context,expected in [({'HK_PANE':'w8:p4'},['--pane','w8:p4']),({'HERDR_PANE_ID':'w1:p1'},['--current'])]:
        result,calls=run(**context); assert result.returncode==0 and calls[0][3:]==expected
    # Provider filters and explicit cap overrides are launch choices only.
    result,calls=run('anthropic','1',CATALOG='anthropic/a\nanthropic/b',SELECT='anthropic/a\nanthropic/b')
    assert result.returncode==0 and ['opencode','models','anthropic'] in calls and len(starts(calls))==1
    result,calls=run('all','4',SELECT='openrouter/a\nopenrouter/b\nopenrouter/c\nopenrouter/d')
    assert result.returncode==0 and ['opencode','models'] in calls and len(starts(calls))==4
    # New launches must not be double-counted when Herdr immediately reports working.
    result,calls=run(SELECT='openrouter/a\nopenrouter/b\nopenrouter/c\nopenrouter/d')
    assert result.returncode==0 and len(starts(calls))==3 and 'deferred openrouter/d' in result.stderr
    result,calls=run(START_STATE='idle',SELECT='openrouter/a\nopenrouter/b\nopenrouter/c\nopenrouter/d')
    assert result.returncode==0 and len(starts(calls))==3
    # Unknown, blocked and working workers count; the caller and settled agents do not.
    existing=[{'pane_id':'w1:p1','name':'coordinator','agent_status':'working'},
              {'pane_id':'w9:p1','name':'different-model','agent_status':'blocked'},
              {'pane_id':'w9:p2','name':'unnamed','agent_status':'unknown'},
              {'pane_id':'w9:p3','name':'finished','agent_status':'done'},
              {'pane_id':'w9:p4','name':'ready','agent_status':'idle'}]
    result,calls=run(AGENTS=json.dumps(existing),SELECT='openrouter/a\nopenrouter/b')
    assert result.returncode==0 and len(starts(calls))==1
    existing.append({'pane_id':'w9:p5','name':'other','agent_status':'working'})
    result,calls=run(AGENTS=json.dumps(existing)); assert result.returncode==0 and not creates(calls)
    result,calls=run(SELECT='openrouter/a\nopenrouter/a'); assert result.returncode==0 and len(starts(calls))==1
    # Cancellation/empty selection is clean; source/selection/JSON/start errors propagate.
    for extra in ({'FZF_EXIT':'130'},{'FZF_EXIT':'1'},{'SELECT':''}):
        result,calls=run(**extra); assert result.returncode==0 and not creates(calls)
    for extra in ({'HERDR_ENV':'0'},{'CATALOG':''},{'FAIL':'opencode'},{'FAIL':'fzf'},
                  {'CONTEXT':'{}'},{'CONTEXT':'{broken'},{'SELECT':'openrouter/unlisted'},
                  {'AGENT_RESPONSE':'{}'},{'AGENT_RESPONSE':'{"result":{"agents":[{}]}}'},
                  {'FAIL':'agent list'},{'FAIL':'tab create'},{'TAB_RESPONSE':'{}'},{'FAIL':'agent start'}):
        result,calls=run(**extra); assert result.returncode!=0,(extra,result.stdout,result.stderr)
        assert not any(c[:3] in (['herdr','tab','close'],['herdr','pane','run']) for c in calls)
        if extra.get('FAIL')!='agent start' and 'TAB_RESPONSE' not in extra:
            assert not starts(calls),(extra,calls)
    result,calls=run('openrouter','0'); assert result.returncode!=0 and not calls
    result,calls=run(FAIL='agent start',SELECT='openrouter/a\nopenrouter/b')
    assert result.returncode!=0 and len(creates(calls))==1 and len(starts(calls))==1
print('PASS: native model argv, original context, provider choices, active cap, cancellation and fail-closed errors')

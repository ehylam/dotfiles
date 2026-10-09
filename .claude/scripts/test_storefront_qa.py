#!/usr/bin/env python3
"""Run parser, read-only rollout preflight and isolated rendered-browser checks."""
import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading

SCRIPTS = Path(__file__).resolve().parent


def run(argv, **kwargs):
    return subprocess.run(argv, text=True, capture_output=True, timeout=60, **kwargs)


parser = run(['node', '--input-type=module', '-e', '''
import assert from 'node:assert/strict';
import { inspectSchema } from ''' + json.dumps((SCRIPTS / 'schema-probe.mjs').as_uri()) + ''';
const doc = blocks => ({querySelectorAll: () => blocks.map(textContent => ({textContent}))});
const graph = JSON.stringify({'@context':'https://schema.org','@graph':[
  {'@type':['Product','https://schema.org/Thing'],offers:{'@type':'Offer'}},
  {'@type':'BreadcrumbList'}]});
let result = inspectSchema(doc([graph]), ['Product', 'Offer']);
assert.equal(result.valid, true);
assert.deepEqual(result.types, ['BreadcrumbList','Offer','Product','Thing']);
assert.equal(inspectSchema(doc(['[{"@type":"Product"}]']), ['Product']).valid, true);
for (const blocks of [[], ['{broken'], ['null'], ['{}'], ['{"@type":4}'], ['{"@type":[]}']]) {
  assert.equal(inspectSchema(doc(blocks)).valid, false);
}
result = inspectSchema(doc([graph, '{broken']), ['Organization']);
assert.equal(result.valid, false);
assert.deepEqual(result.missingTypes, ['Organization']);
assert.equal(result.blocks[1].parsed, false);
console.log('schema parser passed');
'''])
assert parser.returncode == 0, parser.stderr

inspect_logic = run(['node', '--input-type=module', '-e', '''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
const source = readFileSync(''' + json.dumps(str(SCRIPTS / 'inspect.mjs')) + ''', 'utf8')
  .replace(/^#!.*$/m, '').replace(/^import .*$/gm, '').split('\\nmain().catch(')[0];
const proc = { argv: [], stdout: { write() {} }, exitCode: 0, env: {} };
const context = vm.createContext({ Buffer, process: proc, path, os,
  fs: { async mkdir() {}, async writeFile() {} } });
vm.runInContext(source, context);
for (const result of [{error:'missing'}, {checks:[{error:'missing'}]}, {valid:false},
  {pass:false}, {initError:'failed'}, {initErrorA:'failed'}, {initErrorB:'failed'}]) {
  assert.equal(context.failedResult(result), true);
}
assert.equal(context.failedResult({checks:[{styles:{display:'flex'}}]}), false);
const baseArgs = ['styles','--url','http://localhost','--a','h1'];
let options = context.parseArgs(baseArgs);
assert.equal(options.hideOverlays, false);
assert.equal(options.reduceMotion, false);
options = context.parseArgs([...baseArgs,'--hide-overlays','--reduce-motion']);
assert.equal(options.hideOverlays, true);
assert.equal(options.reduceMotion, true);
options = context.parseArgs([...baseArgs,'--hide-overlays','--reduce-motion',
  '--no-hide-overlays','--no-reduce-motion']);
assert.equal(options.hideOverlays, false);
assert.equal(options.reduceMotion, false);
options = context.parseArgs([...baseArgs,'--viewports','desktop','--viewport-size','1440x1000']);
assert.equal(options.viewportSize.width, 1440);
assert.equal(options.viewportSize.height, 1000);
for (const size of ['0x1000', '1440x0', '-1x1000', '1440.5x1000', '1440', '20000x1000']) {
  assert.throws(() => context.parseArgs([...baseArgs,'--viewports','desktop','--viewport-size',size]), /viewport-size/);
}
assert.throws(() => context.parseArgs([...baseArgs,'--viewport-size','1440x1000']), /exactly one/);
class PNG {
  constructor({width,height}) { this.width = width; this.height = height; this.data = Buffer.alloc(width*height*4); }
  static sync = { read: value => value, write: value => value.data };
}
let mismatched = 0;
context.loadImageDiffDeps = async () => ({PNG, pixelmatch: () => mismatched});
let shots, capturedViewport;
context.captureDiffSide = async (_, viewport, ___, side) => {
  capturedViewport = viewport;
  if (shots[side] instanceof Error) throw shots[side];
  return {buffer:shots[side], source:side};
};
context.launchChrome = async () => ({cdp:null, close:async () => {}});
async function check(a, b, gate, expected, size = null) {
  shots = {a,b};
  proc.argv = ['node','inspect.mjs','diff','--image-a','a.png','--image-b','b.png',
    '--viewports','desktop', ...(gate === null ? [] : ['--max-diff-pct',String(gate)]),
    ...(size ? ['--viewport-size',size] : [])];
  proc.exitCode = 0;
  let report;
  proc.stdout.write = output => { report = JSON.parse(output); };
  await context.main();
  assert.equal(proc.exitCode, expected);
  assert.equal(report.browserEngine, null);
  return report.viewports.desktop;
}
const png = (width,height) => new PNG({width,height});
assert.equal((await check(png(2,2),png(2,2),0,0)).pass, true);
await check(png(2,2),png(2,2),0,0,'1440x1000');
assert.equal(capturedViewport.width, 1440);
assert.equal(capturedViewport.height, 1000);
const resized = await check(png(2,2),png(3,2),100,1);
assert.equal(resized.mismatchPercent, 0);
assert.equal(resized.dimensionMismatch, true);
assert.equal(resized.pass, false);
assert.match(context.formatDiff({viewports:{desktop:resized}}), /FAIL \\(dimension mismatch\\)/);
await check(png(2,2),png(3,2),null,0);
mismatched = 1;
assert.equal((await check(png(2,2),png(2,2),25,0)).pass, true);
assert.equal((await check(png(2,2),png(2,2),24,1)).pass, false);
assert.match((await check(new Error('element not found'),png(2,2),null,1)).error, /not found/);
const orchestrator = readFileSync(''' + json.dumps(str(SCRIPTS / 'figma-qa.mjs')) + ''', 'utf8');
const runner = orchestrator.slice(orchestrator.indexOf('function runInspect('),
  orchestrator.indexOf('function absoluteUrl('));
let stdout, code;
const runnerContext = vm.createContext({process, INSPECT_PATH:'inspect.mjs', spawn: () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => { child.stdout.emit('data',stdout); child.emit('exit',code); });
  return child;
}});
vm.runInContext(runner, runnerContext);
code = 1;
stdout = JSON.stringify({viewports:{desktop:{pass:false,files:{diff:'/tmp/diff.png'}}}});
let preserved = await runnerContext.runInspect([]);
assert.equal(preserved.viewports.desktop.pass, false);
assert.equal(preserved.viewports.desktop.files.diff, '/tmp/diff.png');
stdout = JSON.stringify({targets:[{viewports:{desktop:{checks:[{error:'missing'}]}}}]});
preserved = await runnerContext.runInspect([]);
assert.equal(preserved.targets[0].viewports.desktop.checks[0].error, 'missing');
for (const invalid of ['not JSON','{}']) {
  stdout = invalid;
  await assert.rejects(runnerContext.runInspect([]), /JSON parse failed/);
}
code = 2;
stdout = JSON.stringify({viewports:{desktop:{pass:true}}});
await assert.rejects(runnerContext.runInspect([]), /exited 2/);
const qa = vm.createContext({path, URL, os, process: proc, fs: {
  async mkdtemp() { return '/tmp/figma-qa-test'; }, async writeFile() {}, async rm() {}
}});
vm.runInContext(orchestrator.slice(orchestrator.indexOf('function parseArgs('))
  .split('\\nmain().catch(')[0], qa);
const qaArgs = {baseUrl:'https://preview.example',viewports:['desktop'],visualMaxDiffPct:null};
const qaTarget = {id:'hero',url:'/'};
const qaBase = ['--input','mapping.json','--viewports','desktop'];
assert.equal(qa.parseArgs([...qaBase,'--viewport-size','1440x1000']).viewportSize, '1440x1000');
for (const size of ['0x1000','1440x0','-1x1000','1440.5x1000','1440','20000x1000']) {
  assert.throws(() => qa.parseArgs([...qaBase,'--viewport-size',size]), /viewport-size/);
}
for (const presets of [[],['--viewports','mobile,desktop'],['--viewports','unknown']]) {
  assert.throws(() => qa.parseArgs(['--input','mapping.json',...presets,'--viewport-size','1440x1000']), /exactly one/);
}
const geometryArgs = {...qaArgs,viewportSize:'1440x1000'};
qa.runInspect = async (argv) => {
  assert.equal(argv[argv.indexOf('--viewport-size')+1], '1440x1000');
  assert.equal(argv[argv.indexOf('--viewports')+1], 'desktop');
  return {viewports:{desktop:{pass:true}}};
};
await qa.runChecksBatch('https://preview.example',[{selector:'.hero',subcommand:'box'}],geometryArgs,['desktop']);
await qa.runVisualCheck(qaTarget,{id:'visual',selector:'.hero',figmaScreenshot:'reference.png'},geometryArgs,['desktop']);
const overrideTarget = {...qaTarget,visualChecks:[{
  id:'visual',selector:'.hero',figmaScreenshot:'reference.png',viewports:['mobile']
}]};
assert.equal((await qa.processTarget({},overrideTarget,geometryArgs)).visualChecks[0].summary, 'pass');
qa.runChecksBatch = async () => { throw new Error('fixture batch failure'); };
const erroredOverride = await qa.processTarget({}, {...overrideTarget,checks:[{
  id:'box',selector:'.hero',subcommand:'box',intent:{height:'32px'}
}]}, geometryArgs);
assert.equal(erroredOverride.checks[0].summary, 'fail');
assert.equal(erroredOverride.visualChecks[0].summary, 'pass');
assert.match(qa.renderReport({},[],null,null,'1440x1000'), /Viewport override: 1440x1000/);
const template = JSON.parse(readFileSync(''' + json.dumps(str(SCRIPTS / 'qa/component/mapping.template.json')) + ''', 'utf8'));
assert.ok(qa.validateMapping(template,{strictMapping:true}).errors.length > 0);
for (const measured of [{pass:false}, {initErrorA:'reference setup failed'},
  {initErrorB:'target setup failed'}, {dimensionMismatch:true,mismatchPercent:0}]) {
  qa.runInspect = async () => ({viewports:{desktop:measured}});
  const visual = await qa.runVisualCheck(qaTarget, {id:'visual',selector:'.hero'},
    {...qaArgs,referenceBaseUrl:'https://live.example'}, ['desktop']);
  assert.equal(visual.summary, measured.dimensionMismatch ? 'partial' : 'fail');
}
const mapping = {viewports:['desktop']};
const distanceCheck = {id:'gap',selector:'.hero h1',selectorB:'.hero p',subcommand:'distance',properties:'vertical'};
for (const [reference, measured, expected] of [[{vertical:24},{vertical:80},'partial'],
  [{vertical:24},{vertical:24},'pass'], [{},{vertical:24},'fail']]) {
  qa.runChecksBatch = async (_, checks, ___, ____, mode) => ({targets:[{viewports:{desktop:{
    checks:[{id:checks[0].id,distance:mode === 'reference' ? reference : measured}]
  }}}]});
  const checked = await qa.processTarget(mapping,{...qaTarget,checks:[distanceCheck]},
    {...qaArgs,referenceBaseUrl:'https://live.example'});
  const result = checked.checks[0];
  assert.equal(result.summary, expected === 'partial' ? 'fail' : expected);
  if (!Object.keys(reference).length) assert.match(result.viewports.desktop.error, /no comparable/);
  else assert.equal(result.viewports.desktop.drift.length, expected === 'pass' ? 0 : 1);
}
qa.runChecksBatch = async () => ({targets:[{viewports:{desktop:{checks:[{id:'empty',styles:{}}]}}}]});
const empty = await qa.processTarget(mapping,{...qaTarget,checks:[{id:'empty',selector:'.hero',intent:{tolerance:{}}}]},qaArgs);
assert.match(empty.checks[0].viewports.desktop.error, /no comparable/);
const withCheck = {...qaTarget,checks:[{id:'heading',selector:'.hero',subcommand:'styles',intent:{fontSize:'32px'}}]};
for (const level of ['page','check','reference']) {
  qa.runChecksBatch = async (_, __, ___, ____, mode) => ({targets:[{viewports:{desktop:{
    ...(level === 'page' ? {initError:'page setup failed'} : {}),
    checks:[{id:'heading',styles:{fontSize:'32px'},
      ...(level === 'check' || (level === 'reference' && mode === 'reference')
        ? {initError:'check setup failed'} : {})}]
  }}}]});
  const checked = await qa.processTarget(mapping, withCheck,
    {...qaArgs,...(level === 'reference' ? {referenceBaseUrl:'https://live.example'} : {})});
  assert.equal(checked.checks[0].summary, 'fail');
  assert.match(checked.checks[0].viewports.desktop.error, /setup failed/);
}
console.log('inspect failure and pixel gate checks passed');
'''])
assert inspect_logic.returncode == 0, inspect_logic.stderr
print(inspect_logic.stdout.strip())

with tempfile.TemporaryDirectory(prefix='storefront-qa-') as directory:
    root = Path(directory)
    binaries = root / 'bin'
    binaries.mkdir()
    stubs = {
        'git': '#!/usr/bin/env bash\nexit 1\n',
        'lsof': '#!/usr/bin/env bash\nexit 1\n',
        'timeout': '#!/usr/bin/env bash\nshift\nexec "$@"\n',
        'shopify': '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
Path(os.environ['QA_ARGV_LOG']).write_text(json.dumps({
  'args':sys.argv[1:], 'token':os.environ.get('SHOPIFY_CLI_THEME_TOKEN'),
  'store':os.environ.get('SHOPIFY_FLAG_STORE'), 'role':os.environ.get('SHOPIFY_FLAG_ROLE')}))
print(os.environ['QA_INVENTORY'])
sys.exit(int(os.environ.get('QA_STATUS', '0')))
''',
    }
    for name, content in stubs.items():
        binary = binaries / name
        binary.write_text(content)
        binary.chmod(0o755)
    env = dict(os.environ, PATH=str(binaries) + os.pathsep + os.environ['PATH'],
               SHOPIFY_FLAG_STORE='inherited.myshopify.com', SHOPIFY_CLI_THEME_TOKEN='test-sentinel',
               SHOPIFY_FLAG_ROLE='main', QA_ARGV_LOG=str(root / 'argv.json'),
               QA_INVENTORY=json.dumps([{'id': i} for i in range(20)]))
    status = ['bash', str(SCRIPTS / 'theme-status.sh')]
    full = run(status + ['--store', 'target.myshopify.com', '--theme-limit', '20'], env=env, cwd=root)
    assert full.returncode == 2 and 'FULL (20/20)' in full.stdout, full
    args = json.loads((root / 'argv.json').read_text())
    assert args == {'args':['theme','list','--store','target.myshopify.com','--json'],
                    'token':None,'store':None,'role':None}, args
    unknown = run(status + ['--store'], env=env, cwd=root)
    assert unknown.returncode == 0 and 'capacity: UNKNOWN' in unknown.stdout, unknown
    assert json.loads((root / 'argv.json').read_text())['token'] == 'test-sentinel'
    env['QA_INVENTORY'] = '[]'
    empty = run(status + ['--store', '--theme-limit', '20'], env=env, cwd=root)
    assert empty.returncode == 0 and '20 remaining (0/20)' in empty.stdout, empty
    for inventory, code in [('not JSON', '0'), ('[]', '1')]:
        env.update(QA_INVENTORY=inventory, QA_STATUS=code)
        failed = run(status + ['--store'], env=env, cwd=root)
        assert failed.returncode == 2 and 'UNAVAILABLE' in failed.stdout, failed
    invalid = run(status + ['--theme-limit', 'nope'], env=env, cwd=root)
    assert invalid.returncode == 2, invalid
    print('read-only rollout preflight passed')

    if '--offline' in sys.argv:
        raise SystemExit(0)

    (root / 'index.html').write_text('''<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<style>.hero{display:flex;flex-direction:column;gap:20px}h1,p{margin:0}h1{font-size:clamp(16px,4vw,32px)}</style>
<section class="hero"><h1>Product</h1><p>Description</p></section>
<div class="cookie-recipe">Cookie recipe content</div><div id="locale"></div><div id="motion"></div>
<script>
document.querySelector('#locale').textContent = [
  new Intl.NumberFormat('de-DE').format(1234.5),
  new Intl.DateTimeFormat('de-DE', {month:'long', timeZone:'UTC'}).format(new Date('2026-01-01')),
  Intl.NumberFormat.supportedLocalesOf(['de-DE'])[0],
  Intl.DateTimeFormat.supportedLocalesOf(['de-DE'])[0]
].join('|');
document.querySelector('#motion').textContent = matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product"}]}</script>''')
    checks = root / 'checks.json'
    checks.write_text(json.dumps({'checks':[
        {'id':'heading','subcommand':'typography','selector':'.hero h1'},
        {'id':'parent','subcommand':'layout','selector':'.hero'},
        {'id':'gap','subcommand':'distance','selector':'.hero h1','selectorB':'.hero p'},
        {'id':'jsonld','subcommand':'schema','requiredTypes':['Product']},
        {'id':'overlay','subcommand':'styles','selector':'.cookie-recipe','properties':['display','visibility']},
        {'id':'locale','subcommand':'typography','selector':'#locale'},
        {'id':'motion','subcommand':'typography','selector':'#motion'},
    ]}))
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=root))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f'http://127.0.0.1:{server.server_port}/'
        inspected = run(['node', str(SCRIPTS / 'inspect.mjs'), 'batch', '--url', url,
                         '--batch-file', str(checks), '--wait-ms', '0'])
        assert inspected.returncode == 0, inspected.stderr
        output = json.loads(inspected.stdout)
        assert output['browserEngine'] == 'Chromium', output
        assert output['pagePreparation']['hideOverlays'] is False, output
        assert output['pagePreparation']['reduceMotion'] is False, output
        assert output['pagePreparation']['localeOverride'] is False, output
        report = output['targets'][0]['viewports']
        for viewport, width in [('mobile',375), ('tablet',768), ('desktop',1280)]:
            result = report[viewport]
            assert result['resolvedUrl'] == url, result
            assert result['viewport']['width'] == width, result
            assert not result['pageExceptions'], result
            by_id = {check['id']:check for check in result['checks']}
            assert by_id['jsonld']['valid'], by_id
            assert by_id['gap']['distance']['vertical'] == 20, by_id['gap']
            assert by_id['overlay']['styles'] == {'display':'block','visibility':'visible'}, by_id
            assert by_id['locale']['text'] == '1.234,5|Januar|de-DE|de-DE', by_id
            assert by_id['motion']['text'] == 'false', by_id
            size = float(by_id['heading']['styles']['fontSize'].replace('px',''))
            assert abs(size - max(16, min(width * .04, 32))) < .1, size
        custom = run(['node', str(SCRIPTS / 'inspect.mjs'), 'batch', '--url', url,
                      '--batch-file', str(checks), '--viewports', 'desktop',
                      '--viewport-size', '1440x1000', '--wait-ms', '0'])
        assert custom.returncode == 0, custom.stderr
        geometry = json.loads(custom.stdout)['targets'][0]['viewports']['desktop']['viewport']
        assert geometry['width'] == 1440 and geometry['height'] == 1000, geometry
        assert geometry['devicePixelRatio'] == 1, geometry
        qa_mapping = root / 'mapping.json'
        qa_mapping.write_text(json.dumps({
            'baseUrl': url, 'referenceBaseUrl': url, 'viewports':['desktop'],
            'targets':[{'id':'fixture','url':'','checks':[
                {'id':'heading','selector':'.hero h1','subcommand':'styles',
                 'properties':'font-size','referenceSameLocator':True},
                {'id':'parent','selector':'.hero','subcommand':'layout',
                 'properties':'display,width,gap','referenceSameLocator':True}
            ],'visualChecks':[{'id':'pixels','selector':'.hero','referenceSameLocator':True,
                              'viewports':['mobile'],'maxDiffPct':0,'waitMs':1}]}]
        }))
        qa_json = root / 'drift-report.json'
        qa_md = root / 'drift-report.md'
        audited = run(['node', str(SCRIPTS.parent.parent / '.codex/scripts/figma-qa.mjs'),
                       '--input', str(qa_mapping), '--strict-mapping', '--skip-conformance',
                       '--viewports','desktop','--viewport-size','1440x1000','--fail-on','any',
                       '--visual-diff-out',str(root / 'pixels'),
                       '--report',str(qa_md),'--json-report',str(qa_json)])
        assert audited.returncode == 0, audited.stderr
        audited_report = json.loads(qa_json.read_text())
        assert audited_report['mapping']['viewportSize'] == '1440x1000', audited_report
        assert 'Viewport override: 1440x1000' in qa_md.read_text()
        target = audited_report['results'][0]
        assert all(check['summary'] == 'pass' for check in target['checks']), target
        parent = next(check for check in target['checks'] if check['id'] == 'parent')
        assert parent['viewports']['desktop']['rect']['width'] == 1424, parent
        visual = target['visualChecks'][0]
        assert list(visual['viewports']) == ['desktop'], visual
        assert visual['viewports']['desktop']['dimensionsA']['width'] == 1424, visual
        assert visual['viewports']['desktop']['dimensionsB']['width'] == 1424, visual
        assert visual['viewports']['desktop']['pass'] is True, visual
        assert Path(visual['viewports']['desktop']['files']['diff']).is_file(), visual
        print('generic runner: exact geometry, numeric/pixel reports and viewport override passed')
        altered = run(['node', str(SCRIPTS / 'inspect.mjs'), 'batch', '--url', url,
                       '--batch-file', str(checks), '--viewports', 'desktop', '--wait-ms', '0',
                       '--hide-overlays', '--reduce-motion'])
        assert altered.returncode == 0, altered
        altered_report = json.loads(altered.stdout)
        assert altered_report['pagePreparation']['hideOverlays'] is True, altered_report
        assert altered_report['pagePreparation']['reduceMotion'] is True, altered_report
        by_id = {check['id']:check for check in altered_report['targets'][0]['viewports']['desktop']['checks']}
        assert by_id['overlay']['styles']['display'] == 'none', by_id
        assert by_id['motion']['text'] == 'true', by_id
        assert by_id['locale']['text'] == '1.234,5|Januar|de-DE|de-DE', by_id
        init_failed = run(['node', str(SCRIPTS / 'inspect.mjs'), 'styles', '--url', url,
                           '--a', '.hero', '--viewports', 'desktop', '--wait-ms', '0',
                           '--init-script', 'throw new Error("fixture init failed")'])
        assert init_failed.returncode == 1, init_failed
        assert 'fixture init failed' in json.loads(init_failed.stdout)['targets'][0]['viewports']['desktop']['initError']
        missing = run(['node', str(SCRIPTS / 'inspect.mjs'), 'styles', '--url', url,
                       '--a', '.missing', '--viewports', 'desktop', '--wait-ms', '0'])
        assert missing.returncode == 1, missing
        assert json.loads(missing.stdout)['targets'][0]['viewports']['desktop']['error'] == 'A not found'
        checks.write_text(json.dumps({'checks':[{'id':'missing','selector':'.missing'}]}))
        missing_batch = run(['node', str(SCRIPTS / 'inspect.mjs'), 'batch', '--url', url,
                             '--batch-file', str(checks), '--viewports', 'desktop', '--wait-ms', '0'])
        assert missing_batch.returncode == 1, missing_batch
        assert json.loads(missing_batch.stdout)['targets'][0]['viewports']['desktop']['checks'][0]['error'] == 'A not found'
        (root / 'index.html').write_text('<script type="application/ld+json">{broken</script>')
        failed = run(['node', str(SCRIPTS / 'inspect.mjs'), 'schema', '--url', url,
                      '--viewports', 'desktop', '--wait-ms', '0', '--required-types', 'Product'])
        assert failed.returncode == 1, failed
        result = json.loads(failed.stdout)['targets'][0]['viewports']['desktop']
        assert not result['valid'] and result['missingTypes'] == ['Product'], result
        print('isolated browser measurements, missing selectors, locale, page state and schema checks passed')
    finally:
        server.shutdown()
        server.server_close()

import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const mode = process.argv[2];
assert.ok(['ios', 'desktop'].includes(mode), 'Explicit ios or desktop mode required; each owns and cleans its native session');
const existingState = process.argv[3] === 'existing-state';
const timeoutScenario = process.argv[3] === 'timeout';
assert.ok(!existingState || mode === 'ios', 'Existing-state regression uses the native iOS manifest');
assert.ok(!timeoutScenario || mode === 'desktop', 'Timeout regression uses the owned desktop dialog');
const out = await mkdtemp(join(tmpdir(), `apple-overlays-${mode}-`));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overlay fixture</title>
<style>body{margin:0;font:16px Arial}main{padding:24px;display:flex;flex-direction:column;gap:16px;align-items:flex-start;justify-content:flex-start}button{padding:12px}footer{margin-top:1700px}store-overlay{position:fixed;inset:0;background:#fff;z-index:10}</style>
<main id="parent"><h1 id="target">Overlay fixture ready</h1><button id="open" onclick="openDialog()">Open newsletter</button><p id="delayed">Loading fixture</p><footer><button>Offscreen optional</button><p>Footer marker</p><button onclick="document.getElementById('result').textContent='Footer changed state'">Footer action</button><p id="result"></p></footer></main>
<script>setTimeout(()=>document.getElementById('delayed').textContent='Delayed ready',600);function openDialog(){const host=document.createElement('store-overlay');const shadow=${mode==='ios'?'host':"host.attachShadow({mode:'open'})"};shadow.innerHTML='<style>div{position:fixed;inset:40px;background:white;padding:32px}button{padding:12px}</style><div data-klaviyo-modal role="${mode==='ios'?'group':'dialog'}" aria-label="Newsletter fixture dialog"><p>Newsletter offer</p><button aria-label="Close">Close</button></div>';shadow.querySelector('button').onclick=()=>host.remove();document.body.append(host)}</script></html>`;
const server = createServer((_req,res) => res.writeHead(200, {'content-type':'text/html'}).end(html));
await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const url = `http://127.0.0.1:${server.address().port}/`;
const manifest = {version:1,steps:[
  {action:'waitFor',label:'Open newsletter',kind:'button',timeoutMs:10000},
  {action:'tap',label:'Open newsletter',kind:'button',expectText:'Newsletter offer',timeoutMs:10000},
  {action:'dismissOverlay',overlay:'klaviyo',scopeLabel:'Newsletter fixture dialog',timeoutMs:10000},
  {action:'assertText',text:'Overlay fixture ready'},
  {action:'tap',label:'Absent optional',kind:'button',optional:true,timeoutMs:300},
  {action:'tap',label:'Offscreen optional',kind:'button',optional:true,timeoutMs:300},
  {action:'waitFor',text:'Delayed ready',timeoutMs:3000},
  {action:'scrollTo',label:'Footer marker',kind:'text',maxSwipes:8,timeoutMs:30000},
  {action:'assertText',text:'Footer marker'},
  {action:'tap',label:'Footer action',kind:'button',expectText:'Footer changed state',timeoutMs:10000},
]};
if(existingState)manifest.steps=[{action:'tap',label:'Open newsletter',kind:'button',allowToolbarCovered:true,expectText:'Overlay fixture ready',timeoutMs:5000}];
const journey = join(out,mode==='ios'?'steps.json':'journey.mjs');
if(mode==='ios')await writeFile(journey,JSON.stringify(manifest));
if(mode==='desktop')await writeFile(journey,`import assert from 'node:assert/strict';export default async function({script,click,deepQuery,dismissOverlay}){
  assert.equal((await deepQuery('#open')).length,1);await click('#open');assert.equal((await deepQuery('[data-klaviyo-modal]')).length,1);
  assert.equal(await script('return document.querySelector("store-overlay").shadowRoot.querySelector("[role=dialog]").offsetParent'),null);
  ${timeoutScenario?`const until=Date.now()+200;while(Date.now()<until){await script('return document.querySelector("#result").textContent');await new Promise(r=>setTimeout(r,50));}throw new Error('Fixture wait timed out');`:`
  await script('const cover=document.createElement("div");cover.id="cover";cover.style.cssText="position:fixed;inset:0;z-index:20;background:white";document.body.append(cover);return true');
  assert.equal(await script('const r=document.querySelector("store-overlay").shadowRoot.querySelector("button").getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).id'),'cover');
  await assert.rejects(dismissOverlay('klaviyo'),/Native MCP evaluate_javascript failed/);
  await assert.rejects(click('button[aria-label="Close"]'),/Native MCP evaluate_javascript failed/);
  await script('document.querySelector("#cover").remove();return true');
  const result=await dismissOverlay('klaviyo');assert.equal(result.status,'dismissed');
  for(const name of ['bounce-exchange','geolocation','shopify-preview-bar'])assert.equal((await dismissOverlay(name)).status,'skipped');
  return {openShadowDismissal:true,absentOptionalSkipped:true,unrelatedLightDomCoverRejected:true};`}
}`);
await writeFile(join(out,'fixture.html'),html);
const wrapper = fileURLToPath(new URL('./apple-qa.sh',import.meta.url));
const child=spawn('/bin/bash',[wrapper,mode,'--url',url,'--out',join(out,'qa'),...(mode==='ios'?['--ios-journey',journey,'--boot-timeout','120']:['--journey',journey])],{stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
let timer;
try {
  const result=await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Native fixture exceeded 240s; owned cleanup requested'));},240000);
    child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));
  });
  await writeFile(join(out,'stdout.txt'),stdout);await writeFile(join(out,'stderr.txt'),stderr);
  const report=JSON.parse(await readFile(join(out,'qa','report.json'),'utf8'));
  if(existingState){
    assert.equal(result.code,1);assert.equal(report.passed,false);
    assert.match(report.nativeJourney.steps[0].error,/already present before tap/);
    assert.equal(report.nativeJourney.steps[0].input,undefined,'Existing expected text must fail before input');
    assert.equal(report.cleanup.ownedSimulatorDeleted,true);assert.equal(report.cleanup.initialDevicesPreserved,true);
    console.log(`PASS: existing-state false pass rejected before native coordinate input\nEvidence: ${out}`);
  }else if(timeoutScenario){
    assert.equal(result.code,1);assert.equal(report.passed,false);assert.equal(report.error,'Fixture wait timed out');
    assert.ok(report.dialogDiagnostics.dialogs.some(dialog=>dialog.tag==='div'&&dialog.text.includes('Newsletter offer')));
    assert.equal(report.cleanup.appsExited,true);assert.equal(report.cleanup.initialAppsPreserved,true);
    console.log(`PASS: desktop timeout retains visible open-shadow dialog diagnostics and original error; owned apps exited\nEvidence: ${out}`);
  }else{
  assert.equal(result.code,0,report.error||report.attachmentError||stderr);
  assert.equal(report.passed,true);
  if(mode==='ios'){
    assert.equal(report.nativeJourney.steps[4].status,'skipped');assert.equal(report.nativeJourney.steps[5].status,'skipped');
    assert.equal(report.cleanup.ownedSimulatorDeleted,true);assert.equal(report.cleanup.initialDevicesPreserved,true);
  }else{assert.equal(report.cleanup.appsExited,true);assert.equal(report.cleanup.initialAppsPreserved,true);}
  console.log(`PASS: ${mode} owned native storefront-overlay fixture\nEvidence: ${out}`);
  }
}finally{
  clearTimeout(timer);
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>{const cap=setTimeout(resolve,30000);child.once('exit',()=>{clearTimeout(cap);resolve();});});}
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}

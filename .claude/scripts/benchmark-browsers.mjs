#!/usr/bin/env node
// Isolated transport benchmark. No real stores, auth or user browser state.
// Setup: npm install --prefix /tmp/herdr-browser-benchmark-deps --package-lock=false agent-browser@0.38.1 @playwright/mcp@0.0.76 @playwright/cli@0.1.22 @modelcontextprotocol/sdk@1.25.2 node@24.9.0
// Run: /tmp/herdr-browser-benchmark-deps/node_modules/node/bin/node .claude/scripts/benchmark-browsers.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir, arch} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
const deps=process.env.BENCHMARK_DEPS || '/tmp/herdr-browser-benchmark-deps';
const req=createRequire(join(deps,'package.json'));
const {Client}=await import(req.resolve('@modelcontextprotocol/sdk/client/index.js'));
const {StdioClientTransport}=await import(req.resolve('@modelcontextprotocol/sdk/client/stdio.js'));
const mcp=process.env.BENCHMARK_MCP || join(deps,'node_modules/@playwright/mcp');
const chrome=process.env.BENCHMARK_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=join(deps,`node_modules/agent-browser/bin/agent-browser-darwin-${arch()}`);
const node=join(deps,'node_modules/node/bin/node');
const cli=join(deps,'node_modules/@playwright/cli/playwright-cli.js');
const kinds=['playwright-mcp-default','agent-browser','playwright-mcp-scoped','playwright-cli'];
assert.equal(JSON.parse(await readFile(join(deps,'node_modules/@playwright/cli/package.json'))).version,'0.1.22');
assert.equal(JSON.parse(await readFile(join(mcp,'package.json'))).version,'0.0.76');
assert.equal(JSON.parse(await readFile(join(deps,'node_modules/agent-browser/package.json'))).version,'0.38.1');
const artifacts=await mkdtemp(join(tmpdir(),'herdr-browser-benchmark-'));
const owner={version:1,kind:'herdr-browser-benchmark',pid:process.pid,startedAt:new Date().toISOString()};
await writeFile(join(artifacts,'.browser-qa-owner.json'),JSON.stringify(owner));
const home=join(artifacts,'agent-home');await mkdir(home);
await mkdir(join(artifacts,'.playwright'));
const cliConfig=join(artifacts,'.playwright/cli.config.json');
const exec=promisify(execFile);
import {page} from './benchmark-browser-fixture.mjs';
const requests=[];
const server=http.createServer(async (r,s)=>{if(r.url==='/cart/add.js'){let body='';for await(const c of r)body+=c;const d=JSON.parse(body);requests.push(d);s.writeHead(200,{'Content-Type':'application/json'});s.end(JSON.stringify(d));}else if(r.url==='/api/diagnostic-failure'){s.writeHead(503,{'Content-Type':'text/plain'});s.end('intentional diagnostic failure');}else{s.writeHead(200,{'Content-Type':'text/html'});s.end(page);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
let evidenceBytes=0;
async function evidence(r){let text=resultText(r);for(const match of text.matchAll(/\[(?:Snapshot|Console|Requests|Network)[^\]]*\]\(([^)]+)\)/g)){const path=match[1].startsWith('/')?match[1]:join(artifacts,match[1]);const body=await readFile(path,'utf8');evidenceBytes+=Buffer.byteLength(body);text+='\n'+body;}return text;}
const evaluation=`({market:document.querySelector('#market').value,quantity:document.querySelector('#quantity').value,price:document.querySelector('#price').textContent,details:document.querySelector('#details').getAttribute('aria-expanded'),cart:document.querySelector('#cart').textContent,cartVisible:!document.querySelector('#cart').hidden,descriptionVisible:!document.querySelector('#description').hidden,description:document.querySelector('#description').textContent,overflow:document.documentElement.scrollWidth>innerWidth})`;
const samples=[];const observations=[];const capabilities=[];
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
function resultText(r){return typeof r==='string'?r:r.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');}
function checkState(text){assert.match(text,/NZ/);assert.match(text,/NZD 45/);assert.match(text,/2 × Everyday tee/);assert.match(text,/90 NZD/);assert.match(text,/"details"\s*:\s*"true"/);assert.match(text,/"cartVisible"\s*:\s*true/);assert.match(text,/"descriptionVisible"\s*:\s*true/);assert.match(text,/Soft cotton/);assert.match(text,/"overflow"\s*:\s*false/);}
function ref(text,label,agent){const line=text.split('\n').find(x=>x.includes(`"${label}"`)&&/ref=/.test(x));assert.ok(line,`No snapshot ref for ${label}`);return (agent?'@':'')+line.match(/ref=([^\]\s]+)/)[1];}
async function journey(kind,width,iteration,call){let snapshot;const start=performance.now();const shot=`${kind}-${width}-${iteration}.png`;
 if(kind==='agent-browser'){
  await call(['set','viewport',String(width),'800']);await call(['open',url]);snapshot=resultText(await call(['snapshot','-c','-s','#product']));
  await call(['select',ref(snapshot,'Market',true),'NZ']);await call(['fill',ref(snapshot,'Quantity',true),'2']);await call(['click',ref(snapshot,'Product details',true)]);await call(['wait','--text','Soft cotton']);snapshot=resultText(await call(['snapshot','-c','-s','#product']));if(!snapshot.includes('Soft cotton')){snapshot=resultText(await call(['snapshot','-s','#product']));observations.push({kind,width,iteration,issue:'Compact accessibility snapshot omitted newly revealed description',noncompactRecovered:snapshot.includes('Soft cotton'),domVerificationRequired:!snapshot.includes('Soft cotton')});}
  await call(['click',ref(snapshot,'Add to cart',true)]);await call(['wait','--text','2 × Everyday tee']);snapshot=resultText(await call(['snapshot','-c','-s','#product']));await call(['click',ref(snapshot,'Run diagnostic probe',true)]);await call(['wait','--fn','window.benchmarkDiagnosticComplete === true']);
  checkState(resultText(await call(['eval',evaluation])));await call(['screenshot',join(artifacts,shot)]);
  assert.match(resultText(await call(['console'])),/benchmark intentional console error/);assert.match(resultText(await call(['network','requests'])),/503/);
 }else if(kind==='playwright-cli'){
  if(iteration==='cold')await call(['open',url,`--config=${cliConfig}`]);else await call(['goto',url]);
  snapshot=await evidence(await call(['snapshot','#product']));
  await call(['select',ref(snapshot,'Market',false),'NZ']);await call(['fill',ref(snapshot,'Quantity',false),'2']);
  await call(['click',ref(snapshot,'Product details',false)]);snapshot=await evidence(await call(['snapshot','#product']));assert.match(snapshot,/Soft cotton/);
  await call(['click',ref(snapshot,'Add to cart',false)]);
  await call(['run-code',`async page => { await page.getByText('2 × Everyday tee', {exact:false}).waitFor(); }`]);
  snapshot=await evidence(await call(['snapshot','#product']));
  await call(['click',ref(snapshot,'Run diagnostic probe',false)]);
  await call(['eval','async () => { await window.benchmarkDiagnosticPromise; return true; }']);
  checkState(await call(['eval',`() => ${evaluation}`]));await call(['screenshot',`--filename=${shot}`]);
  assert.match(await evidence(await call(['console','error'])),/benchmark intentional console error/);
  assert.match(await evidence(await call(['requests'])),/503/);
 }else{
  await call('browser_resize',{width,height:800});snapshot=await evidence(await call('browser_navigate',{url}));
  if(kind==='playwright-mcp-scoped')snapshot=await evidence(await call('browser_snapshot',{target:'#product'}));
  await call('browser_select_option',{target:ref(snapshot,'Market',false),values:['NZ']});await call('browser_type',{target:ref(snapshot,'Quantity',false),text:'2'});
  snapshot=await evidence(await call('browser_click',{target:ref(snapshot,'Product details',false)}));if(kind==='playwright-mcp-scoped')snapshot=await evidence(await call('browser_snapshot',{target:'#product'}));assert.match(snapshot,/Soft cotton/);
  snapshot=await evidence(await call('browser_click',{target:ref(snapshot,'Add to cart',false)}));await call('browser_wait_for',{text:'2 × Everyday tee'});
  if(kind==='playwright-mcp-scoped')snapshot=await evidence(await call('browser_snapshot',{target:'#product'}));
  await call('browser_click',{target:ref(snapshot,'Run diagnostic probe',false)});await call('browser_evaluate',{function:'async () => { await window.benchmarkDiagnosticPromise; return true; }'});
  checkState(resultText(await call('browser_evaluate',{function:`() => ${evaluation}`})));await call('browser_take_screenshot',{filename:shot,type:'png'});
  assert.match(await evidence(await call('browser_console_messages',{level:'error'})),/benchmark intentional console error/);assert.match(await evidence(await call('browser_network_requests',{static:false,filter:'cart/add|diagnostic-failure'})),/503/);
 }
 const image=await readFile(join(artifacts,shot));assert.equal(image.subarray(1,4).toString(),'PNG');assert.equal(image.readUInt32BE(16),width);assert.equal(image.readUInt32BE(20),800);
 assert.deepEqual(requests.at(-1),{market:'NZ',quantity:2});return performance.now()-start;
}
try {
 for(const width of [375,768,1280])for(const kind of kinds){
  let client,transport;const session=`bench-${process.pid}-${width}`;const rows=[];let calls=0,textBytes=0;const init=performance.now();
  let call;
  if(kind==='playwright-cli'){
   await writeFile(cliConfig,JSON.stringify({browser:{browserName:'chromium',isolated:true,launchOptions:{executablePath:chrome,headless:true},contextOptions:{viewport:{width,height:800}}},outputDir:artifacts,outputMode:'file',codegen:'none'}));
   call=async args=>{const t=performance.now();const r=await exec(node,[cli,`-s=${session}`,...args],{cwd:artifacts,env:{...process.env,NO_UPDATE_NOTIFIER:'1',PATH:`${join(deps,'node_modules/node/bin')}:${process.env.PATH}`},timeout:30000,maxBuffer:4*1024*1024});calls++;textBytes+=Buffer.byteLength(r.stdout);rows.push({args,ms:performance.now()-t,stdout:r.stdout,stderr:r.stderr});return r.stdout;};
  }else if(kind==='agent-browser')call=async args=>{const t=performance.now();const r=await exec(browser,['--session',session,'--executable-path',chrome,...args],{env:{...process.env,PATH:`${join(deps,'node_modules/node/bin')}:${process.env.PATH}`,AGENT_BROWSER_HOME:home,AGENT_BROWSER_NAMESPACE:`benchmark-${process.pid}`,AGENT_BROWSER_IDLE_TIMEOUT_MS:'60000'},timeout:30000,maxBuffer:4*1024*1024});calls++;textBytes+=Buffer.byteLength(r.stdout);rows.push({args,ms:performance.now()-t,stdout:r.stdout,stderr:r.stderr});return r.stdout;};
  else {transport=new StdioClientTransport({command:node,cwd:artifacts,args:[join(mcp,'cli.js'),'--headless','--isolated','--executable-path',chrome,'--output-dir',artifacts,'--image-responses','omit','--codegen','none',...(kind==='playwright-mcp-scoped'?['--snapshot-mode','none']:[])]});client=new Client({name:'benchmark',version:'1'});try{await client.connect(transport);}catch(error){await client.close().catch(()=>{});await transport.close().catch(()=>{});throw error;}call=async(name,args={})=>{const t=performance.now();const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,resultText(r));calls++;textBytes+=Buffer.byteLength(resultText(r));rows.push({name,args,ms:performance.now()-t,result:r});return r;};}
  const setupMs=performance.now()-init;
  try {
   for(const iteration of ['cold','warm']){const c0=calls,b0=textBytes,e0=evidenceBytes;const elapsedMs=await journey(kind,width,iteration,call);samples.push({kind,width,iteration,elapsedMs:Math.round(elapsedMs),setupMs:iteration==='cold'?Math.round(setupMs):0,calls:calls-c0,protocolTextBytes:textBytes-b0,fileEvidenceBytes:evidenceBytes-e0,textBytes:textBytes-b0+evidenceBytes-e0,passed:true});}
   if(kind==='playwright-cli'){
    await call(['tracing-start']);await call(['goto',url]);await call(['click','#diagnostics']);
    await call(['eval','async () => { await window.benchmarkDiagnosticPromise; return true; }']);
    const output=await call(['tracing-stop']);
    const trace=output.match(/\[Trace\]\(([^)]+)\)/)?.[1];assert.ok(trace,'CLI trace artifact missing');
    const tracePath=join(artifacts,trace);
    const events=(await readFile(tracePath,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.ok(events.some(x=>x.type==='before'),'CLI trace has no actions');
    const network=output.match(/\[Network log\]\(([^)]+)\)/)?.[1];assert.ok(network,'CLI network trace missing');
    assert.match(await readFile(join(artifacts,network),'utf8'),/diagnostic-failure/);
    capabilities.push({kind,width,trace:tracePath,actionsAndNetwork:true});
   }
  }
  finally {
   try{
    if(client){try{await call('browser_close');}finally{await client.close();}}
    else{
     await call(['close']);
     if(kind==='playwright-cli'){const state=JSON.parse(await call(['list','--json']));assert.ok(!state.browsers.some(x=>x.name===session),'Owned CLI browser still open');}
    }
   }finally{await writeFile(join(artifacts,`${kind}-${width}-raw.json`),JSON.stringify(rows,null,2));}
  }
 }
 const summary={date:new Date().toISOString(),versions:{playwrightCli:'0.1.22',cliPlaywright:req('playwright/package.json').version,mcpPlaywright:createRequire(join(mcp,'package.json'))('playwright/package.json').version,agentBrowser:'0.38.1',playwrightMcp:'0.0.76',node:process.version},chrome:(await exec(chrome,['--version'])).stdout.trim(),fixture:'isolated localhost product/cart, 24 recommendation cards, AU/NZ pricing, asynchronous cart POST, intentional console error and HTTP 503',samples,observations,capabilities,medians:Object.fromEntries(kinds.map(kind=>[kind,Object.fromEntries(['cold','warm'].map(iteration=>{const s=samples.filter(x=>x.kind===kind&&x.iteration===iteration);return [iteration,{elapsedMs:median(s.map(x=>x.elapsedMs)),withSetupMs:median(s.map(x=>x.elapsedMs+x.setupMs)),protocolTextBytes:median(s.map(x=>x.protocolTextBytes)),fileEvidenceBytes:median(s.map(x=>x.fileEvidenceBytes)),calls:median(s.map(x=>x.calls)),textBytes:median(s.map(x=>x.textBytes))}];}))])),artifacts,correctness:{functionalJourneysPassed:samples.filter(x=>x.passed).length,functionalJourneysTotal:kinds.length*6,screenshots:samples.length},limitations:['Transport timings, not model deliberation or end-to-end assistant latency.','Text bytes include returned protocol text plus required snapshot/log file contents actually read, and exclude image bytes and tool schema/prompt token overhead; not measured token consumption.','Three widths, one cold and warm journey per width; small local sample, filesystem/OS caches remain warm.','Synthetic storefront only; no Shopify preview auth, market routing, checkout or Figma validation.','Installed MCP 0.0.76 defaults to file output despite help advertising stdout; file snapshots used for references count as evidence bytes.','Scoped MCP suppresses automatic snapshots and takes three explicit product snapshots; default MCP emits full page snapshots.','CLI uses a different Playwright build from the pinned MCP; compare transport and build together, not protocol overhead alone.','CLI navigation emits a full snapshot file; only three scoped snapshots and console/network files needed for proof count as file evidence.','Playwright CLI trace support is probed outside measured journeys.'],sources:['https://github.com/microsoft/playwright-cli','https://github.com/vercel-labs/agent-browser','https://github.com/microsoft/playwright-mcp']};
 await writeFile(join(artifacts,'results.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
 await writeFile(join(artifacts,'.browser-qa-owner.json'),JSON.stringify({...owner,finishedAt:new Date().toISOString()}));
} finally {await new Promise(resolve=>server.close(resolve));}

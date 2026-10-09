#!/usr/bin/env node
// Run with the existing benchmark dependencies. Artifacts stay outside Git.
// node .claude/scripts/benchmark-browser-use.mjs [--local-only]
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {page as fixture} from './benchmark-browser-fixture.mjs';

const req=createRequire(join(process.env.BENCHMARK_DEPS || '/tmp/herdr-browser-benchmark-deps','package.json'));
const {chromium}=req('playwright');
const localOnly=process.argv.includes('--local-only');
const key=localOnly ? '' : process.env.BROWSER_USE_API_KEY?.trim();
assert.ok(localOnly || key,'BROWSER_USE_API_KEY must be available to this process');
const artifacts=await mkdtemp(join(tmpdir(),'browser-use-benchmark-'));
const owner={version:1,kind:'browser-use-benchmark',pid:process.pid,startedAt:new Date().toISOString()};
await writeFile(join(artifacts,'.browser-qa-owner.json'),JSON.stringify(owner));
const exec=promisify(execFile);
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const secrets=[key].filter(Boolean);
const safeError=error=>secrets.reduce((s,secret)=>s.replaceAll(secret,'[redacted]'),String(error.message || error))
  .replace(/wss?:\/\/[^\s)]+/g,'[redacted WebSocket endpoint]');
const report={date:new Date().toISOString(),playwright:req('playwright/package.json').version,artifacts,backends:[],
  limitations:['Synthetic fixture uses local request interception for identical content without deploying or tunnelling.',
    'Cloud interception adds CDP round trips; the public-page check separately tests real network navigation.',
    'One browser per backend, six sequential journeys. First/repeat labels are not independent cold-browser samples.',
    'Normal journeys capture screenshots and diagnostics; trace compatibility is probed separately to avoid continuous recording overhead.',
    'Process-tree RSS includes the Node controller and owned Chrome children; shared pages can be counted twice. It is not physical RAM.',
    'RSS samples run every 500 ms and can miss short spikes. Remote server memory is not visible.',
    'Direct Playwright library calls exclude MCP overhead, model deliberation, Safari/iOS and real Shopify auth/checkout.'],
  sources:['https://docs.browser-use.com/cloud/browser/quickstart',
    'https://docs.browser-use.com/cloud/api-v4/browsers/create-browser-session',
    'https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp']};

async function bounded(label,operation,timeoutMs=20000){
  let timer;
  try{return await Promise.race([operation,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(`${label} timed out after ${timeoutMs}ms`)),timeoutMs);
  })]);}finally{clearTimeout(timer);}
}

async function api(method,path,body){
  const response=await fetch('https://api.browser-use.com/api/v4'+path,{method,
    headers:{'X-Browser-Use-API-Key':key,'Content-Type':'application/json'},
    ...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error(`Browser Use ${method} ${path}: HTTP ${response.status}`);
  return response.json();
}

async function memory(){
  const {stdout}=await exec('ps',['-axo','pid=,ppid=,rss=,comm='],{timeout:5000});
  const rows=stdout.trim().split('\n').map(line=>{
    const match=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return match && {pid:Number(match[1]),parent:Number(match[2]),rssKiB:Number(match[3]),command:match[4]};
  }).filter(Boolean);
  const owned=new Set([process.pid]);
  for(let previous=-1;previous!==owned.size;){
    previous=owned.size;
    for(const row of rows) if(owned.has(row.parent)) owned.add(row.pid);
  }
  const selected=rows.filter(row=>owned.has(row.pid) && !/(^|\/)ps$/.test(row.command));
  return {at:performance.now(),rssMiB:selected.reduce((sum,row)=>sum+row.rssKiB,0)/1024,
    processes:selected.length,chromeProcesses:selected.filter(row=>/Chrome|Chromium/i.test(row.command)).length};
}

async function journey(browserPage,kind,width,iteration,waitForConsole=true){
  const started=performance.now(),steps=[];
  const step=async(name,fn)=>{const t=performance.now();const result=await fn();steps.push({name,ms:Math.round(performance.now()-t)});return result;};
  const consoleErrors=[],responses=[];
  const onConsole=message=>{if(message.type()==='error') consoleErrors.push(message.text());};
  const onResponse=response=>responses.push({url:response.url(),status:response.status()});
  browserPage.on('console',onConsole);browserPage.on('response',onResponse);
  try {
    await step('viewport',()=>browserPage.setViewportSize({width,height:800}));
    await step('navigate',()=>browserPage.goto('https://benchmark.invalid/',{waitUntil:'load'}));
    await step('market',()=>browserPage.getByLabel('Market',{exact:true}).selectOption('NZ'));
    await step('quantity',()=>browserPage.getByLabel('Quantity',{exact:true}).fill('2'));
    await step('details',()=>browserPage.getByRole('button',{name:'Product details',exact:true}).click());
    await browserPage.locator('#description').waitFor({state:'visible'});
    assert.match(await browserPage.locator('#description').innerText(),/Soft cotton/);
    await step('cart',()=>browserPage.getByRole('button',{name:'Add to cart',exact:true}).click());
    await browserPage.waitForFunction(()=>document.querySelector('#cart').textContent.includes('2 × Everyday tee'));
    assert.equal(await browserPage.locator('#price').innerText(),'NZD 45');
    assert.match(await browserPage.locator('#cart').innerText(),/NZ.*90 NZD/);
    await step('diagnostics',async()=>{
      const response=browserPage.waitForResponse(r=>r.url().endsWith('/api/diagnostic-failure'));
      const message=waitForConsole ? browserPage.waitForEvent('console',{predicate:m=>m.type()==='error' && m.text()==='benchmark intentional console error',timeout:5000}).catch(()=>null) : Promise.resolve(null);
      await browserPage.getByRole('button',{name:'Run diagnostic probe',exact:true}).click();
      const [received]=await Promise.all([response,message]);
      assert.equal(received.status(),503);
    });
    const overflow=await browserPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false);
    const image=await step('screenshot',()=>browserPage.screenshot({path:join(artifacts,`${kind}-${width}-${iteration}.png`)}));
    assert.equal(image.subarray(1,4).toString(),'PNG');
    assert.equal(image.readUInt32BE(16),width);assert.equal(image.readUInt32BE(20),800);
    const consoleCaptured=consoleErrors.includes('benchmark intentional console error');
    return {width,iteration,passed:consoleCaptured,functionalPassed:true,...(!consoleCaptured ? {error:'Intentional console error event was not received; the first journey explicitly waited 5 seconds'} : {}),
      elapsedMs:Math.round(performance.now()-started),steps,consoleErrorCaptured:consoleCaptured,
      http503Captured:responses.some(r=>r.status===503)};
  } catch(error){return {width,iteration,passed:false,error:safeError(error),elapsedMs:Math.round(performance.now()-started),steps,
    consoleErrorCaptured:consoleErrors.includes('benchmark intentional console error'),http503Captured:responses.some(r=>r.status===503)};
  } finally {browserPage.off('console',onConsole);browserPage.off('response',onResponse);}
}

async function runBackend(kind){
  const result={kind,samples:[],memory:[],cleanup:{},capabilities:{}};
  report.backends.push(result);
  let browser,server,context,session,timer,inFlight=Promise.resolve(),samplingError;
  const setup=performance.now();
  try {
    if(kind==='local-playwright'){
      server=await chromium.launchServer({headless:true,
        executablePath:process.env.BENCHMARK_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
      browser=await chromium.connect(server.wsEndpoint());
    }
    else {
      console.log(`${kind}: creating session`);
      session=await api('POST','/browsers',{timeout:10,proxyCountryCode:null,allowResizing:true,
        enableRecording:false,solveCaptchas:false,metadata:{purpose:'dotfiles-browser-benchmark'}});
      assert.ok(session.id,'Cloud browser ID missing');
      result.sessionId=session.id;
      await writeFile(join(artifacts,'results.json'),JSON.stringify(report,null,2));
      assert.ok(session.cdpUrl,'Cloud browser CDP endpoint missing');
      secrets.push(session.cdpUrl);
      console.log(`${kind}: connecting CDP`);
      browser=await chromium.connectOverCDP(session.cdpUrl,{timeout:30000});
    }
    result.setupMs=Math.round(performance.now()-setup);result.browserVersion=browser.version();
    context=kind==='local-playwright' ? await browser.newContext() : browser.contexts()[0];
    assert.ok(context,'Managed browser context missing');context.setDefaultTimeout(15000);
    const payloads=[];
    await context.route('https://benchmark.invalid/**',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/cart/add.js'){
        const data=route.request().postDataJSON();payloads.push(data);
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
      }else if(url.pathname==='/api/diagnostic-failure') await route.fulfill({status:503,body:'intentional diagnostic failure'});
      else await route.fulfill({status:200,contentType:'text/html',body:fixture});
    });
    result.capabilities.requestInterception=true;
    console.log(`${kind}: opening test page`);
    const browserPage=await bounded('New page',context.newPage());
    const sample=()=>{inFlight=inFlight.then(async()=>{
      try{result.memory.push(await memory());}catch(error){samplingError=safeError(error);}
    });};
    sample();timer=setInterval(sample,500);
    for(const width of [375,768,1280]) for(const iteration of ['first','repeat']){
      try {
        const before=await memory();
        const row=await journey(browserPage,kind,width,iteration,result.capabilities.consoleEvents!==false);
        const after=await memory();
        const measured=[before,after,...result.memory.filter(s=>s.at>=before.at && s.at<=after.at)];
        row.peakLocalRssMiB=Math.round(Math.max(...measured.map(s=>s.rssMiB)));
        assert.deepEqual(payloads.at(-1),{market:'NZ',quantity:2});
        result.samples.push(row);console.log(`${kind}: ${width}px ${iteration} ${row.passed ? 'passed' : 'failed'} (${row.elapsedMs}ms)`);
        if(row.consoleErrorCaptured || row.http503Captured) result.capabilities.consoleEvents=row.consoleErrorCaptured;
        if(!row.consoleErrorCaptured && row.http503Captured){
          result.diagnosticConsole={eventCaptured:row.consoleErrorCaptured,http503Captured:row.http503Captured};
        }
      }catch(error){result.samples.push({width,iteration,passed:false,error:safeError(error)});}
      sample();await inFlight;
    }
    const publicStart=performance.now();
    try {
      await browserPage.setViewportSize({width:1280,height:800});
      await browserPage.goto('https://playwright.dev/',{waitUntil:'domcontentloaded',timeout:30000});
      assert.match(await browserPage.title(),/Playwright/);
      await browserPage.getByRole('link',{name:'Docs',exact:true}).first().click();
      await browserPage.waitForURL('**/docs/intro');
      assert.ok(await browserPage.getByRole('heading',{name:'Installation',exact:true}).isVisible());
      result.publicNavigation={passed:true,elapsedMs:Math.round(performance.now()-publicStart)};
    }catch(error){result.publicNavigation={passed:false,error:safeError(error)};}
    try{
      await bounded('Trace start',context.tracing.start({screenshots:true,snapshots:true}));
      await browserPage.goto('https://benchmark.invalid/',{waitUntil:'load'});
      await browserPage.getByRole('button',{name:'Product details',exact:true}).click();
      await bounded('Trace stop',context.tracing.stop({path:join(artifacts,`${kind}-trace.zip`)}));
      result.capabilities.trace=true;
    }catch(error){result.capabilities.trace=false;result.traceError=safeError(error);}
  }catch(error){result.error=safeError(error);}
  finally {
    clearInterval(timer);await inFlight;
    if(samplingError) result.memoryError=samplingError;
    if(browser){try{await bounded('Browser disconnect',browser.close());result.cleanup.disconnected=true;}catch(error){result.cleanup.disconnectError=safeError(error);}}
    if(server){
      try{await bounded('Local browser termination',server.close());}
      catch(error){
        result.cleanup.localCloseError=safeError(error);
        try{await bounded('Owned local browser kill',server.kill());}catch(error){result.cleanup.localKillError=safeError(error);}
      }
      const owned=server.process();
      result.cleanup.localTerminated=owned.exitCode!==null || owned.signalCode!==null;
    }
    if(session?.id){
      for(let attempt=0;attempt<3;attempt++){
        try{
          await api('PATCH',`/browsers/${session.id}`,{action:'stop'});
          const state=await api('GET',`/browsers/${session.id}`);
          assert.equal(state.status,'stopped');
          result.cleanup.cloudStopped=true;result.cleanup.browserCostUsd=state.browserCost;
          result.cleanup.proxyCostUsd=state.proxyCost;break;
        }catch(error){result.cleanup.stopError=safeError(error);}
      }
      if(result.cleanup.cloudStopped) delete result.cleanup.stopError;
    }
    result.summary={passed:result.samples.filter(s=>s.passed).length,total:result.samples.length,
      functionalPassed:result.samples.filter(s=>s.functionalPassed).length,
      medianJourneyMs:result.samples.some(s=>s.passed) ? median(result.samples.filter(s=>s.passed).map(s=>s.elapsedMs)) : null,
      medianFunctionalJourneyMs:result.samples.some(s=>s.functionalPassed) ? median(result.samples.filter(s=>s.functionalPassed).map(s=>s.elapsedMs)) : null,
      peakLocalRssMiB:result.memory.length ? Math.round(Math.max(...result.memory.map(s=>s.rssMiB),
        ...result.samples.map(s=>s.peakLocalRssMiB || 0))) : null,
      maxLocalChromeProcesses:result.memory.length ? Math.max(...result.memory.map(s=>s.chromeProcesses)) : null};
    await writeFile(join(artifacts,'results.json'),JSON.stringify(report,null,2));
  }
}

await runBackend('local-playwright');
if(!localOnly && report.backends[0].cleanup.localTerminated) await runBackend('browser-use-cloud');
else if(!localOnly) report.cloudSkipped='Owned local browser termination was not confirmed';
if(report.backends.every(r=>!r.cleanup.disconnectError &&
  (r.kind==='local-playwright' ? r.cleanup.localTerminated===true : r.cleanup.cloudStopped===true))){
  owner.finishedAt=new Date().toISOString();
  await writeFile(join(artifacts,'.browser-qa-owner.json'),JSON.stringify(owner));
}
console.log(JSON.stringify({artifacts,backends:report.backends.map(({kind,summary,setupMs,publicNavigation,cleanup,error})=>
  ({kind,summary,setupMs,publicNavigation,cleanup,error}))},null,2));
if(report.cloudSkipped || report.backends.some(r=>r.error || r.summary.total!==6 || r.summary.passed!==6 || !r.publicNavigation?.passed || !r.capabilities.trace || r.memoryError || r.cleanup.disconnectError ||
  (r.kind==='local-playwright' && !r.cleanup.localTerminated) ||
  (r.kind==='browser-use-cloud' && !r.cleanup.cloudStopped))) process.exitCode=1;

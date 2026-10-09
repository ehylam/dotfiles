#!/usr/bin/env python3
"""Isolated OpenCode comparison. Preparation and self-checks make no paid calls."""
import json
import os
import pathlib
import tempfile

MODELS = {
    "anthropic/claude-sonnet-5.5": (2, 10),
    "google/gemini-3.8-flash": (.75, 3.75),
    "z-ai/glm-5.3": (1.4, 4.4),
    "stepfun/step-3.7-flash": (.2, 1.15),
}
COMMON = "Use the supplied synthetic facts. Verify claims, preserve design intent, write plain Australian English without filler or em dashes. Work only in this task folder. Do not delegate, access credentials, install tools, publish or contact external services. State any incomplete check."
CART = """export async function addToCart(button, fetcher) {
  button.disabled = true;
  const response = await fetcher();
  if (!response.ok) throw new Error('Cart request failed');
  const result = await response.json();
  button.disabled = false;
  return result;
}
"""
TEST = """import assert from 'node:assert/strict';
import {addToCart} from './cart.mjs';
const success = {disabled: false};
assert.deepEqual(await addToCart(success, async () => ({ok:true,json:async()=>({id:1})})), {id:1});
assert.equal(success.disabled, false);
for (const fetcher of [async()=>{throw new Error('Network failure')}, async()=>({ok:false}), async()=>({ok:true,json:async()=>{throw new Error('Invalid JSON')}})]) {
  const button = {disabled:false};
  await assert.rejects(addToCart(button, fetcher));
  assert.equal(button.disabled, false);
}
console.log('PASS: success, network rejection, HTTP failure and invalid JSON restore the control');
"""
CASES = {
 "theme-js": {
   "brief.md": "Fix cart.mjs: a failed request leaves its button disabled. Preserve successful return values and rejection behaviour. Edit only cart.mjs. Run node test.mjs and report the result.\n",
   "cart.mjs": CART, "test.mjs": TEST,
 },
 "css-intent": {
   "brief.md": "Investigate the reported logo/content misalignment using design.md, measurements.json and header.css. Explain the cause and propose the smallest correction. Do not edit files.\n",
   "design.md": "The approved logo is capped at 240px on desktop, scales down on narrow screens, and aligns with the main content's left edge. The 240px cap is intentional.\n",
   "header.css": ".header { display:flex; gap:24px; padding:24px 40px; align-items:center; justify-content:space-between; }\n.logo { width:clamp(160px,30vw,240px); }\n.main { padding:24px; }\n",
   "measurements.json": json.dumps({"viewport":1280,"logo":{"x":40,"width":240,"computedWidth":"240px"},"header":{"x":0,"width":1280,"display":"flex","gap":24,"paddingLeft":40,"alignItems":"center","justifyContent":"space-between"},"main":{"x":0,"width":1280,"paddingLeft":24},"measuredLogoToNavigationGap":664,"logoToContentLeftOffset":16}, indent=2),
 },
 "client-reply": {
   "brief.md": "Read evidence.json and write one client reply in reply.md explaining the card placement change and verification status. Use plain Australian English and enough explanation to be useful. Keep any internal notes outside the draft.\n",
   "evidence.json": json.dumps({"change":"The SMS sign-up card now appears immediately after the benefits section.","AU":{"theme":"synthetic preview","customer":"guest","viewports":[375,768,1280],"placement":"verified after benefits","status":"passed"},"US":{"status":"not checked","placement":"unknown"}}, indent=2),
 },
 "browser-qa": {
   "brief.md": "Use the configured Playwright MCP on the local fixture URL supplied in the launch prompt. At widths 375, 768 and 1280 (height 800), choose NZ, set quantity 2, open Product details and verify its text, add to cart and verify market/quantity/total. Trigger Run diagnostic probe and inspect console and HTTP failures. Check horizontal overflow. Save concise evidence in qa.md. Close the owned browser. This run provides Chromium only; distinguish it from unrun native Safari/iOS. Do not modify the fixture or claim a real storefront was tested.\n",
 },
}

def configuration(model, workspace, api_key="{file:/private/tmp/herdr-benchmark-openrouter.key}", base_url="https://openrouter.ai/api/v1"):
    price = MODELS[model]
    permissions = {"*":"deny", "read":"allow", "glob":"allow", "grep":"allow", "external_directory":"deny", "edit":("deny" if workspace.name=="css-intent" else {"*":"deny",("cart.mjs" if workspace.name=="theme-js" else "reply.md" if workspace.name=="client-reply" else "qa.md"):"allow"}), "bash":{"*":"deny", "node test.mjs":"allow"}, "playwright_*":"allow"}
    return {
      "$schema":"https://opencode.ai/config.json", "enabled_providers":["openrouter"],
      "model":"openrouter/"+model, "small_model":"openrouter/"+model,
      "default_agent":"benchmark", "share":"disabled", "autoupdate":False,
      "snapshot":False, "lsp":False, "formatter":False,
      "compaction":{"auto":False,"prune":False},
      "provider":{"openrouter":{"npm":"@openrouter/ai-sdk-provider", "options":{"apiKey":api_key,"baseURL":base_url},"models":{model:{"name":model,"reasoning":True,"tool_call":True,"limit":{"context":65536,"output":4096},"cost":{"input":price[0],"output":price[1]},"variants":{"medium":{"reasoning":{"effort":"high" if model == "z-ai/glm-5.3" else "medium"}}},"options":{"provider":{"require_parameters":True,"allow_fallbacks":False,"max_price":{"prompt":4,"completion":20,"request":0}}}}}}},
      "agent":{"benchmark":{"mode":"primary","prompt":COMMON,"steps":8,"permission":permissions}},
      "mcp":({"playwright":{"type":"local","enabled":True,"command":["/tmp/herdr-browser-benchmark-deps/node_modules/node/bin/node","/tmp/herdr-browser-benchmark-deps/node_modules/@playwright/mcp/cli.js","--isolated","--headless","--executable-path","/Applications/Google Chrome.app/Contents/MacOS/Google Chrome","--output-dir",str(workspace/"browser-artifacts")]}} if workspace.name=="browser-qa" else {}),
    }

def prepare(key_file):
    import subprocess
    root = pathlib.Path(tempfile.mkdtemp(prefix="herdr-model-comparison-")).resolve()
    os.chmod(root, 0o700)
    for model in MODELS:
        for case, files in CASES.items():
            workspace = root/model.replace("/", "_")/case
            workspace.mkdir(parents=True)
            # Native edit permissions match paths relative to the detected Git worktree.
            subprocess.run(["git","-c","init.templateDir=","init","--quiet",str(workspace)],check=True,capture_output=True)
            for name, contents in files.items():
                (workspace/name).write_text(contents)
            (workspace/"AGENTS.md").write_text(COMMON+"\n")
            (workspace/"opencode.json").write_text(json.dumps(configuration(model, workspace, "{file:"+str(key_file)+"}"), indent=2))
    write_report(root, {"models":list(MODELS),"cases":list(CASES),"effort":"medium","output_limit":4096,"agent_steps":8,"paid_calls_started":False,"runs":[]})
    return root


def write_report(root, report):
    target = root/"report.json"
    pending = root/"report.tmp"
    pending.write_text(json.dumps(report, indent=2)+"\n")
    pending.replace(target)


def number(value):
    from decimal import Decimal
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ValueError("Budget metadata must contain numbers")
    result = Decimal(str(value))
    if not result.is_finite() or result < 0:
        raise ValueError("Budget metadata must be finite and nonnegative")
    return result


def check_budget(data, fresh=False, allow_byok_outside_cap=False, maximum=5):
    limit = number(data.get("limit"))
    remaining = number(data.get("limit_remaining"))
    usage = number(data.get("usage"))
    byok = number(data.get("byok_usage"))
    if not 0 < limit <= number(maximum) or remaining > limit or usage > limit or abs(limit-remaining-usage) > number(.000001) or data.get("limit_reset", "missing") is not None:
        raise ValueError("Use a key within the approved maximum with no periodic reset")
    if data.get("include_byok_in_limit") is not True and not (allow_byok_outside_cap and data.get("include_byok_in_limit") is False):
        raise ValueError("Include BYOK usage in the key limit, even if you currently use no BYOK provider")
    if byok != 0:
        raise ValueError("Unexpected BYOK billing; stop and reconcile the upstream charge separately")
    if fresh and (usage != 0 or remaining != limit):
        raise ValueError("This comparison requires a fresh, exclusively used key")
    return remaining, usage


def read_key(path):
    import stat
    if path.name.startswith(".env"):
        raise ValueError("Do not supply an .env file")
    details = path.lstat()
    if not stat.S_ISREG(details.st_mode) or details.st_uid != os.getuid() or details.st_mode & 0o077:
        raise ValueError("The key must be your regular file with permissions 600 or stricter")
    key = path.read_text().strip()
    if not key.startswith("sk-or-") or any(c.isspace() for c in key):
        raise ValueError("The file must contain only the isolated OpenRouter key")
    return key


def budget_metadata(key):
    import urllib.request
    request = urllib.request.Request("https://openrouter.ai/api/v1/key", headers={"Authorization":"Bearer "+key})
    with urllib.request.urlopen(request, timeout=20) as response:
        data = json.load(response)["data"]
    return {name:data[name] for name in ("limit","limit_remaining","limit_reset","usage","byok_usage","include_byok_in_limit") if name in data}


def native_environment(folder, config):
    env = {k:v for k,v in os.environ.items() if k in ("PATH","HOME","TMPDIR","LANG")}
    for part in ("CONFIG","DATA","CACHE","STATE"):
        env["XDG_"+part+"_HOME"] = str(folder/part.lower())
    env.update(OPENCODE_CONFIG=str(config),OPENCODE_DISABLE_PROJECT_CONFIG="1",OPENCODE_DISABLE_CLAUDE_CODE="1",OPENCODE_DISABLE_EXTERNAL_SKILLS="1",OPENCODE_DISABLE_AUTOCOMPACT="1",OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX="4096")
    return env


def terminate_owned(process):
    import signal
    import subprocess
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def run_comparison(key_file):
    import selectors
    import subprocess
    import time
    key = read_key(key_file)
    before = budget_metadata(key)
    check_budget(before, fresh=True)
    deps = pathlib.Path("/tmp/herdr-browser-benchmark-deps/node_modules")
    for path in (deps/"node/bin/node",deps/"@playwright/mcp/cli.js",pathlib.Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")):
        if not path.is_file():
            raise ValueError("Missing existing browser benchmark prerequisite: "+str(path))
    version = subprocess.check_output(["opencode","--version"], text=True).strip()
    root = prepare(key_file)
    report = json.loads((root/"report.json").read_text())
    report.update(opencode=version,budget_before=before,status="running",billing="OpenRouter key usage delta; native step costs are estimates",limitations=["Synthetic tasks, one attempt per model/task; manual factual and style review remains required.","4096 output tokens and eight tool-loop steps per generation/session; reasoning consumes output.","Isolated native OpenCode with external plugins and unrelated MCPs disabled; not a test of global herdr integration.","Sequential sessions; stop at US$3.50 observed usage to leave a US$1.50 margin. Provider key limit controls further requests.","Chromium browser fixture only; no native Safari/iOS or real merchant validation."])
    fixture = pathlib.Path(__file__).with_name("benchmark-browser-fixture.mjs").resolve()
    source = "import http from 'node:http';import {page} from "+json.dumps(fixture.as_uri())+";const server=http.createServer(async(r,s)=>{try{if(r.url==='/cart/add.js'){let body='';for await(const c of r)body+=c;s.setHeader('Content-Type','application/json');s.end(JSON.stringify(JSON.parse(body)));}else if(r.url==='/api/diagnostic-failure'){s.writeHead(503);s.end('intentional diagnostic failure');}else{s.setHeader('Content-Type','text/html');s.end(page);}}catch{s.writeHead(400);s.end('invalid fixture request');}});server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));"
    server = subprocess.Popen([str(deps/"node/bin/node"),"--input-type=module","-e",source],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
    active = None
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(server.stdout,selectors.EVENT_READ)
            if not selector.select(timeout=10):
                raise ValueError("Fixture server failed to become ready")
            url = server.stdout.readline().strip()
        if not url.startswith("http://127.0.0.1:"):
            raise ValueError("Invalid fixture address")
        # ponytail: sequential case-major runs keep billing attributable and favour equal coverage before the cap.
        for case in CASES:
            for model in MODELS:
                metadata = budget_metadata(key)
                remaining, usage = check_budget(metadata)
                if usage >= number(3.5) or remaining < number(1.5):
                    report["status"] = "stopped_for_budget_margin"
                    return root
                workspace = root/model.replace("/","_")/case
                prompt = "Read brief.md, perform the task and report only verified results."
                if case == "browser-qa":
                    prompt += " Local fixture: "+url
                started = time.monotonic()
                report["paid_calls_started"] = True
                write_report(root, report)
                active = subprocess.Popen(["opencode","run","--pure","--dir",str(workspace),"--agent","benchmark","--model","openrouter/"+model,"--variant","medium","--title","synthetic-"+case,"--format","json",prompt],env=native_environment(workspace/"host",workspace/"opencode.json"),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
                try:
                    stdout, stderr = active.communicate(timeout=240)
                except subprocess.TimeoutExpired:
                    terminate_owned(active)
                    stdout, stderr = active.communicate()
                    (workspace/"events.jsonl").write_text(stdout.replace(key,"[redacted]"))
                    (workspace/"stderr.txt").write_text(stderr.replace(key,"[redacted]"))
                    report["status"] = "stopped_after_timeout_billing_unsettled"
                    raise ValueError("Native task timed out; stop before any further paid run")
                (workspace/"events.jsonl").write_text(stdout.replace(key,"[redacted]"))
                (workspace/"stderr.txt").write_text(stderr.replace(key,"[redacted]"))
                events = [json.loads(line) for line in stdout.splitlines() if line.startswith("{")]
                after = budget_metadata(key)
                _, paid = check_budget(after)
                tools = [e["part"] for e in events if e.get("type")=="tool_use"]
                row = {"model":model,"case":case,"seconds":round(time.monotonic()-started,2),"exit_code":active.returncode,"provider_account_usage_delta":str(paid-usage),"budget_after":after,"host_step_estimates":[e["part"] for e in events if e.get("type")=="step_finish"],"tools":[{"tool":t.get("tool"),"status":t.get("state",{}).get("status")} for t in tools],"review":"required","artifacts":str(workspace)}
                if case == "theme-js":
                    immutable = (workspace/"test.mjs").read_text() == TEST
                    verified = subprocess.run(["node","test.mjs"],cwd=workspace,capture_output=True,text=True,timeout=15)
                    row["independent_cart_check"] = immutable and verified.returncode == 0
                    (workspace/"independent-check.txt").write_text(verified.stdout+verified.stderr)
                report["runs"].append(row)
                write_report(root,report)
                print(model+" / "+case+": recorded, account charge US$"+str(paid-usage),flush=True)
                terminate_owned(active)
                if paid < usage or (paid == usage and any(e.get("type")=="step_finish" for e in events)):
                    raise ValueError("Provider billing has not settled; stop before another paid run")
                if any(e.get("type")=="error" for e in events) or active.returncode:
                    raise ValueError("Native host/provider error; inspect artifacts before another paid run")
        report["status"] = "runs_complete_review_required"
        return root
    except Exception as error:
        report.update(status="stopped",error=str(error).replace(key,"[redacted]"))
        raise
    finally:
        if active:
            terminate_owned(active)
        terminate_owned(server)
        write_report(root,report)
        print("Artifacts: "+str(root),flush=True)


def self_check():
    import shutil
    import subprocess
    root = prepare(pathlib.Path("/private/tmp/no-self-check-key"))
    try:
        assert root == root.resolve(), "Native tool permissions require canonical workspace paths"
        case = root/next(iter(MODELS)).replace("/","_")/"theme-js"
        detected = subprocess.check_output(["git","rev-parse","--show-toplevel"],cwd=case,text=True).strip()
        assert pathlib.Path(detected).resolve() == case, "Each native session needs its own worktree boundary"
    finally:
        shutil.rmtree(root)
    base = {"limit":5,"limit_remaining":5,"limit_reset":None,"usage":0,"byok_usage":0,"include_byok_in_limit":True}
    assert check_budget(base, fresh=True)[0] == 5
    for change in ({"limit":80},{"limit":True},{"limit_reset":"monthly"},{"usage":float("nan")},{"usage":float("inf")},{"limit_remaining":6},{"usage":.01},{"usage":6},{"include_byok_in_limit":False},{"byok_usage":.01}):
        try:
            check_budget({**base,**change},fresh=True)
        except ValueError:
            continue
        raise AssertionError("Unsafe metadata accepted: "+str(change))
    for field in base:
        try:
            check_budget({k:v for k,v in base.items() if k!=field},fresh=True)
        except ValueError:
            continue
        raise AssertionError("Missing field accepted: "+field)
    import io
    from unittest.mock import patch
    for field in base:
        response = io.StringIO(json.dumps({"data": {k:v for k,v in base.items() if k!=field}}))
        with patch("urllib.request.urlopen", return_value=response):
            projected = budget_metadata("synthetic-only")
        assert field not in projected
        try:
            check_budget(projected, fresh=True)
        except ValueError:
            continue
        raise AssertionError("Missing response field accepted: "+field)
    print("PASS: capped-key checks reject uncapped, resettable, used, BYOK-excluded and malformed metadata")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command",choices=["prepare","check-key","run","self-check"])
    parser.add_argument("--key-file",type=pathlib.Path,default=pathlib.Path("/private/tmp/herdr-benchmark-openrouter.key"))
    args = parser.parse_args()
    try:
        if args.command == "prepare": print(prepare(args.key_file.absolute()))
        elif args.command == "self-check": self_check()
        elif args.command == "check-key":
            metadata = budget_metadata(read_key(args.key_file))
            check_budget(metadata,fresh=True)
            print(json.dumps(metadata,indent=2))
        else: run_comparison(args.key_file.absolute())
    except (ValueError, OSError) as error:
        parser.exit(1,str(error)+"\n")

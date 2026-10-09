# Native Safari and iOS browser QA

Production desktop Safari's WebDriver path remains BLOCKED because app ownership
and exit cannot be verified. Native desktop Technology Preview has a verified MCP
route with app-exit observation. Native Mobile Safari has an XCTest route on a fresh
owned simulator; WebDriver discovery remains blocked on the tested iOS27 runtime.
Installed versions alone are not test availability.

If macOS refuses to open Technology Preview as incompatible, use Apple's
[OS-specific downloads](https://developer.apple.com/safari/resources/).
The macOS 26 and 27 packages can both report Safari version 27.0; the app version
alone does not identify its supported OS build. On macOS 27, the installed
`21626.1.8.19.2` build was rejected; Apple's macOS 27 Release 253 package carries
`22626.1.8.19.2` and explicitly checks macOS 27.x. Keep desktop QA blocked until
the matching package is installed and native launch/input/cleanup is reverified.
Read-only driver version/preflight checks do not establish app launchability.
After installing that matching package on 3 October 2026, the native MCP fixture
passed navigation, disclosure, market selection, native quantity input and cart
POST checks on macOS 27.0.1. The owned browser, driver and observer exited;
pre-existing apps were preserved. This verifies the tooling fixture, not client
acceptance flows or production Safari WebDriver.

For everyday work, the short helper chooses the documented transports:

```sh
bash ~/.claude/scripts/apple-qa.sh preflight
bash ~/.claude/scripts/apple-qa.sh desktop
bash ~/.claude/scripts/apple-qa.sh ios
```

`desktop` is Technology Preview MCP; `ios` is Mobile Safari XCTest and selects
the newest available installed runtime unless `--runtime` is passed. The helper
forwards URL/expect/journey options and native test failures without replacing
their diagnostics. It sets a 900-second iOS boot limit, overridable with
`--boot-timeout`. Run checks serially. No URL means synthetic fixture; a URL is
a smoke check unless task-specific assertions are supplied. Project XCTest
interaction suites remain separate from this URL helper. The Herdr QA menu
calls these short routes. See [Support Workflow](SUPPORT-WORKFLOW.md).

## Foreground and Native Touch Checks

For desktop fade, autoplay, animation or screenshot acceptance, add `--visible`
to the MCP command. It selects the owned tab, attempts activation of only a newly
observed Technology Preview app, and checks `document.visibilityState` plus
`document.hidden` before the journey, each native input and screenshots. Existing
user apps are never activation targets. Journey modules receive `requireVisible`
for assertions during an animation, not just at the journey's boundaries.
It does not override page visibility, force CSS opacity or change automation settings.

On the 3 October macOS 27.0.1 probe, tab switching and owned-app activation did
not make the MCP page visible. `--visible` correctly returned BLOCKED with clean
resource exit. A neutral Tab probe also stayed hidden. Native control interactions
in the full fixture later produced a visible final state, so availability is
state-dependent; never infer foreground coverage from tool success alone.
A hidden page's opacity result neither proves a fade bug nor a
working fade. Use a genuinely visible Safari window/manual check when this
transport cannot provide one. DOM/input checks without `--visible` retain the
visibility state and explicitly exclude foreground animation/visual acceptance.

For a real Mobile Safari journey, `--ios-journey /private/path/steps.json` accepts
a bounded JSON manifest instead of arbitrary JavaScript. It uses XCTest native
taps and coordinate drags inside the webview; it does not provide DOM/CSS access.
Save new project-specific manifests under the ignored private notebook directory,
or reuse existing project tests. A small manifest:

```json
{
  "version": 1,
  "steps": [
    {"action": "assertText", "text": "Slide one"},
    {"action": "swipe", "from": [0.8, 0.5], "to": [0.2, 0.5]},
    {"action": "assertText", "text": "Slide two"},
    {"action": "screenshot", "name": "After swipe"}
  ]
}
```

Adapt the text and coordinates to the actual target. `tap` takes `kind`
(`button`, `link` or `text`) and an exact `label`; ambiguous or unhittable taps
fail. `assertText` defaults to an exact, hittable text element; `visible: false`
explicitly weakens that step to accessibility-tree existence. Swipe points are
webview-relative pairs between 0.05 and 0.95, not CSS pixels or browser chrome.
Manifests allow up to 40 steps/32 KiB and require at least one text assertion.
Put a changed-state assertion after each interaction to prove its intended effect.

The manifest also supports these explicit actions and options:

- `waitFor`: exactly one `text`, or `label` plus `kind`, with `timeoutMs` from
  1 to 30000 (default 15000). It requires one exact accessibility match and waits
  until hittable. `visible: false` requests existence only. An optional exact
  `scopeLabel` limits label queries to a named accessibility container.
- `tap`: `optional: true` skips an absent or unhittable target and records the
  reason in `report.json`; duplicate labels fail. `scopeLabel` is exact and must
  identify one container. `expectText` requires that exact text to be absent
  before input and hittable afterwards, providing changed-state proof.
- `scrollTo`: exact `label` and `kind`, optional `scopeLabel`, `direction`
  (`down` by default, or `up`), `maxSwipes` from 1 to 10 (default 6), and
  `timeoutMs`. It uses native drags inside the webview and succeeds only when
  the unique target becomes hittable.
- `tap` with `allowToolbarCovered: true`: an explicit coordinate fallback for
  a target that intersects an observed Safari toolbar. `expectText` is required;
  this cannot be combined with `optional`. It chooses the exposed portion of
  the target within the webview, Safari window and screen, subtracts toolbar
  rectangles and records the native point. Fully covered/offscreen targets fail.
  No generic force tap is available. XCTest cannot prove why a target is covered;
  changed-state assertions and native screenshot review remain required.
- `dismissOverlay`: an `overlay` name from `bounce-exchange`, `klaviyo`,
  `geolocation`, or `shopify-preview-bar`, plus an exact `scopeLabel` obtained
  from the target's accessibility tree. It taps one hittable dismiss button
  inside that container using the shared label vocabulary, then asserts the
  container no longer exists. Absent/unhittable optional overlays are recorded
  as skipped. Ambiguous scopes/buttons or unsuccessful dismissal fail. Native
  iOS does not expose vendor DOM IDs; do not guess a container from a generic
  Close label. A missing accessibility scope requires a reviewed project journey.
  If a keyboard is up (for example a focused signup field), it is dismissed
  first and recorded as `keyboard: dismissed`.
- `navigate`: a same-origin absolute `path` (such as `/products/x?view=qa`)
  resolved against `--url`, plus a required `expectText` that must become
  hittable. Prefer it over edge swipes for history and persistence checks: a
  reload proves cookie/storage state without depending on gestures that page
  content can intercept.
- `back`: dismisses any keyboard, taps Safari's own toolbar Back button and
  requires `expectText`. A collapsed or hidden toolbar fails the step; use
  `navigate` instead.
- `dismissKeyboard`: taps the single keyboard Done control and waits for the
  keyboard to disappear. Recorded as skipped when no keyboard is shown;
  ambiguous Done controls fail.

Every step retains a screenshot and status (`completed`, `skipped`, `failed`).
Skipped optional actions do not establish that an interaction occurred. Native
step evidence is exported from the executed test/device, checked against the
manifest, and included in `report.json`. A journey still needs a text assertion;
an optional action or screenshot alone cannot establish acceptance.

These actions use Apple's [hittability](https://developer.apple.com/documentation/xcuiautomation/xcuielement/ishittable),
[existence waits](https://developer.apple.com/documentation/xcuiautomation/xcuielement/waitforexistence(timeout:)),
 [non-existence waits](https://developer.apple.com/documentation/xcuiautomation/xcuielement/waitfornonexistence(timeout:)),
and [element-relative coordinates](https://developer.apple.com/documentation/xcuiautomation/xcuielement/coordinate(withnormalizedoffset:)).
Step polling and swipe counts are bounded; individual XCTest accessibility
snapshots/native input can add synchronization time. The owned test process has
its own outer execution deadline.

```sh
bash ~/.claude/scripts/apple-qa.sh ios \
  --url 'https://preview.example.com/' --ios-journey /private/path/steps.json
```

Every completed step and final state retains a native screenshot. Exported files,
PNG geometry, device identity and per-step names are checked before a pass;
failed runs also export available attachments. The report records the exact
manifest/hash, assertion scope, Xcode/runtime and owned-device cleanup.
Screenshots need visual review against the intended crop; neither touch success
nor image text proves exact `object-position`. Keep CSS measurements from inspect
and native iOS screenshot/touch evidence separate. A seven-step loopback journey
passed native tap, horizontal swipe, vertical scroll and hittable-result checks
on iOS 27; this is tooling evidence, not client preview acceptance.

## Storefront Overlay Helpers

Desktop MCP journey modules receive `dismissOverlay(name, {timeoutMs})` and
`deepQuery(selector)`. `deepQuery` returns tag/ID/rect descriptors from the DOM
and recursively open shadow roots, capped at 5000 elements. The existing native
`click(selector)` also resolves open roots and requires exactly one match.
It checks rendered ancestors and the hit at each open-shadow boundary, starting
from the document, so an unrelated covering element blocks native input.
Closed shadow roots and cross-origin iframe contents remain inaccessible; their
controls require another reviewed native input path. Do not invent selectors.

`dismissOverlay` uses the same four vendor names as iOS. It finds one rendered
vendor container and one scoped dismiss control, checks the control's hit point,
uses real native input, and waits for the container to stop rendering. Its total
deadline defaults to 3000ms and may be 1 to 10000ms. A missing optional overlay
returns `status: "skipped"`; a successful removal returns `"dismissed"` with the
state assertion. It never hides CSS or invokes DOM `.click()`. Profiles live in
`storefront-overlays.mjs`; a different integration needs reviewed selectors.
An unrelated page Close button is never a fallback. Use the helper only on the
reviewed target and retain its results in the journey evidence.

Fixed modals commonly have `offsetParent === null`. That does not make them
hidden: inspect their viewport rect and computed display/visibility/opacity,
including ancestors. The shared helper uses that visibility rule and checks
hit-testing before native input. `deepQuery` itself returns all matched elements,
so callers must make their own rendered-state assertions.

Timeout reports include `dialogDiagnostics` without replacing the original
failure. Desktop descriptors contain tag, viewport rect, display and up to
200 characters of redacted text for at most 12 visible dialogs. Queries are
capped at 5000 elements and diagnostics at 3s. They read no input values and
redact emails and keyed credential text. An unavailable page or closed root is
reported as a diagnostic limit/error, not an empty successful check.

iOS exports equivalent accessibility type/label/screen-frame descriptors,
explicitly marks CSS display/DOM tags unavailable, samples at most 80 elements
and 12 descriptors with a 2s sampling budget, and omits input values/full tree
dumps. XCTest snapshot synchronization can exceed that sampling budget. The
attachment export is bounded at 10s; unavailable attachments are reported
separately from the original error. Native screenshots may contain visible page
content and stay in the private evidence directory.

Focused checks: `node ~/.claude/scripts/test_apple_storefront_overlays.mjs` and
`node ~/.claude/scripts/test_apple_ios_xctest_qa.mjs`. Explicit tooling fixtures:
`node ~/.claude/scripts/test_apple_storefront_native.mjs desktop` or `ios`, run
serially. They use only loopback content and owned app/device cleanup; these
fixtures do not establish client storefront acceptance.

The 5 October overlay fixture passed native iOS waits, scoped dismissal, optional
skips, scrolling and changed-state taps with owned-device deletion. Desktop
interactions passed, but one run failed automatic Technology Preview app exit;
its exact owned automation process required separately verified recovery. A
separate timeout regression retained the visible fixed/open-shadow dialog and
original error with automatic app/driver/observer exit. Continue checking cleanup
on every run. Positive partly toolbar-covered coordinate input remains unverified.

Use this path on demand when a task explicitly needs installed Safari or native
Mobile Safari. It uses the installed `safaridriver` through W3C WebDriver or, for
desktop Technology Preview, Apple's native MCP transport. No Selenium, Appium,
global dependency or persistent MCP server is needed.

```sh
node ~/.dotfiles/.claude/scripts/apple-browser-qa.mjs preflight
node ~/.dotfiles/.claude/scripts/apple-browser-qa.mjs test --browser safari \
  --driver technology-preview --transport mcp
node ~/.dotfiles/.claude/scripts/apple-browser-qa.mjs test --browser ios \
  --transport xctest --runtime com.apple.CoreSimulator.SimRuntime.iOS-27-0
```

Preflight reads native versions, simulator inventory and existing SafariDriver
processes. It does not launch a browser or change automation preferences. Simulator
inventory may require execution outside a filesystem sandbox to access CoreSimulator.
Select an available runtime from preflight rather than assuming the example exists.
The driver defaults to production Safari. To investigate an installed Technology
Preview driver explicitly, use `--driver technology-preview` with either command:

```sh
node ~/.dotfiles/.claude/scripts/apple-browser-qa.mjs preflight --driver technology-preview
node ~/.dotfiles/.claude/scripts/apple-browser-qa.mjs test --browser ios \
  --driver technology-preview --runtime com.apple.CoreSimulator.SimRuntime.iOS-27-0
```

The selector accepts only `safari` and `technology-preview`, mapped to Apple's
standard executable locations. It does not execute arbitrary paths, fall back to
another driver, enable Remote Automation, or select a user simulator. Preflight
records the selected executable and its own version separately from production
Safari's version. A test checks the selected driver before creating its simulator
and records the executable and version in `report.json`. Missing drivers or failed
version probes fail the run. Selecting Technology Preview alone does not unblock
desktop WebDriver; the verified desktop route requires `--transport mcp` explicitly.
It does not establish compatibility with a simulator; only a native journey can do that.
`--device-type` accepts an explicit simctl device type; the default is iPhone 16.
For slow first-boot data migration, add `--boot-timeout 900` to allow 15 minutes.
The normal limit is 300 seconds; values must be integers from 1 to 3600.

Test without a URL serves the existing synthetic benchmark fixture on a temporary
localhost port. It checks a details disclosure, NZ market change, native quantity
input, asynchronous cart POST and rendered cart result. Outputs are a screenshot
and JSON report under a fresh OS temporary directory, or `--out <directory>`.

For a real target, the URL mode performs a limited navigation/element smoke check
and screenshot. It does not claim to cover the fixture's cart journey on that site.

```sh
node ~/.dotfiles/.claude/scripts/apple-browser-qa.mjs test --browser safari \
  --driver technology-preview --transport mcp \
  --url https://preview.example.com/products/item \
  --selector '.product-title' --expect 'Expected product name'
```

The actual page viewport, user agent and returned WebDriver capabilities are
recorded. Desktop WebDriver requests a 1280×1000 browser window but remains guarded;
MCP uses its native default window and records actual geometry. Safari chrome and
minimum window sizes affect the page viewport. Native iOS uses the selected simulator's
device geometry. Neither is described as an exact 375px Chromium emulation.

For task-specific input assertions, URL mode accepts `--journey /absolute/path/journey.mjs`.
Use only trusted, reviewed local Node code, never execute an unreviewed model reply.
For WebDriver, its default function (which may be async) receives `{call, script, element, click, out, signal}`. `call`
uses session-relative W3C WebDriver routes; throw on failed assertions and return
JSON-serializable evidence (or no result). Circular references and BigInt fail the
journey before evidence is attached, so the failure report remains writable.
The normal helper still owns session/driver/simulator cleanup. Module loading and
assertions have a fixed 120-second asynchronous deadline; interruption or expiry
aborts WebDriver calls and enters cleanup even if a promise never settles. Modules
must honour `signal` and stop their own timers/resources: this does not cancel
arbitrary JavaScript. Synchronous loops, `process.exit`, detached work or an OS kill
can still prevent cleanup; do not use this hook for untrusted code.
The report retains the entry-file hash and result, not hashes for imported dependencies.
This is arbitrary local Node execution, not a sandbox. It is never loaded by
preflight or without that explicit option. Assertions and coverage remain the
journey author's responsibility; a completed callback is not all-browser acceptance.

The `--transport xctest` Mobile Safari path builds the bundled small UI-test target
with the selected Xcode into the output directory. It opens Safari using
`XCUIApplication.open(URL)` and uses native accessibility queries, taps, selection
and keyboard entry, not JavaScript clicks or WebDriver. It requires compatible
Xcode/runtime versions. No Appium, signing credentials or dependency installation
is needed. Fixture mode checks the same disclosure, market, quantity and cart
journey, including the actual server payload. It retains the native test result
bundle with screenshot and accessibility-tree attachments.
The helper also checks native result summary and test identifiers: one intended
passed test, no failures/skips, and the exact owned device are required.

For a real URL without `--ios-journey`, XCTest requires `--expect 'page text'` and verifies matching
native static text exists in the accessibility tree, including offscreen text.
It does not establish viewport visibility. This is a navigation smoke check only. CSS selectors, Node
journeys and WebDriver diagnostics are rejected rather than silently ignored.
Broader storefront interaction assertions use reviewed `--ios-journey` steps or
project-owned XCTest suites. The manifest route still has no computed-style access.

```sh
node ~/.dotfiles/.claude/scripts/apple-browser-qa.mjs test --browser ios \
  --transport xctest --runtime com.apple.CoreSimulator.SimRuntime.iOS-27-0 \
  --url https://preview.example.com/products/item --expect 'Expected product name'
```

MCP journeys receive `{tool, script, click, requireVisible, out, signal}` instead. `tool(name, args)`
uses native Safari MCP tools, `script(expression)` returns native JS evaluation,
and `click(selector)` activates the measured centre through native mouse input.
This is a different API from WebDriver, not an interchangeable journey module.
MCP records tool calls/results, screenshots, actual viewport and lifecycle events.
Module loading and assertions share the same 120-second asynchronous deadline and
trusted-code limitations described above. A script evaluation is not native input;
use native tools and assert the page/server result to establish interaction success.

Native activation prerequisites:

- On the Mac, Safari Settings > Developer > Allow remote automation must be enabled.
  Apple also supports `/usr/bin/safaridriver --enable`. The installed manual says
  this applies configuration changes and requires password authentication; Apple's
  guide notes `sudo` may be needed after upgrading macOS. The script changes neither.
- Native iOS requires a compatible Xcode/runtime and Safari automation support.
  Compare the selected developer directory and macOS/Xcode versions from preflight
  with Apple's compatibility table. Apple's physical-device guide additionally
  requires Web Inspector and Remote Automation in Safari Advanced settings;
  Web Inspector is always enabled for simulators. This script does not attach to
  a physical device or modify device settings.

Resource ownership:

- The script refuses to run if another SafariDriver process already exists.
  This is a process snapshot, not an atomic lock. Run native Safari automation
  serially on this Mac; use separate Chromium contexts for parallel browser QA.
- Desktop Safari WebDriver `test` is currently blocked before any driver, browser, server or
  output directory is created. Session deletion and driver termination left separate
  Safari automation apps running during earlier tests. Do not resume these tests or
  bypass the guard until app ownership and exit are reliably verified. A new process
  appearing in a snapshot does not prove it belongs to the session; no inferred PID
  termination is used. `preflight` remains available. Earlier driver/session cleanup
  results do not prove Safari app cleanup, and desktop Safari QA is BLOCKED.
  A 3 October test of a fresh, directly owned AppKit Safari instance confirmed
  its safe instance-directed exit, but SafariDriver launched a second app instead
  of reusing it. Prelaunch is not a cleanup solution. Do not add PID-delta kills
  or bypass the guard based on that native launch API alone.
- Desktop MCP uses Technology Preview's built-in app launch/teardown. Client EOF
  lets the driver close its own app; owned driver signals are bounded fallbacks.
  A passive AppKit observer retains original and newly launched application objects
  and confirms app exit and preservation of existing instances. It never kills an
  app inferred from a process snapshot. Failed observation or exit fails the run.
  The original production Safari remains untouched. Run serially; observer launch
  events are verification, not independent authority to terminate other apps.
- iOS tests create a uniquely named fresh simulator and constrain SafariDriver to
  its exact UDID. Existing booted or shutdown user simulators are never selected.
  If another simulator is already booted, the helper stops before creating a device
  so QA does not add a second simulator to the Mac's workload. This is an inventory
  snapshot; keep simulator launches serial. It does not shut down the user's device.
  The helper boots that target, waits for boot completion and launches Safari before
  creating its WebDriver session. Cleanup shuts down/deletes only the created UDID
  and checks that initially booted devices remain booted.
  Boot readiness has a five-minute limit for a newly installed runtime's cold start;
  timeout reports retain the final boot output for diagnosis.
- XCTest likewise creates a fresh exact UDID and refuses an existing booted device.
  It builds before creating a simulator, rechecks occupancy after the build, and
  disables parallel testing/cloned destinations. The native test terminates Safari;
  final cleanup deletes only the owned device and verifies original device states.
  Active build/test commands have timeouts and an abort signal targeting their
  owned child process. Failure, cancellation or cleanup errors prevent a pass.
  Verbose failure sysdiagnoses are disabled; the native test bundle still retains
  its screenshot, accessibility tree and test logs.
- No `shutdown all`, simulator erasure, process-name kill or browser-wide cleanup
  is used. SIGINT/SIGTERM abort WebDriver requests and enter owned cleanup.
- A failed cleanup produces a failing exit status and records its error. An OS
  kill or machine failure can prevent cleanup; the report's owned UUID/PID identifies
  the intended resource. A session-creation timeout can leave uncertain Safari
  state before a session ID is returned, so it is not reported as a deleted session.
  Driver cleanup waits up to three seconds after SIGTERM, then up to three seconds
  after SIGKILL. A signal error or missing exit is recorded as `cleanup.driverError`;
  simulator cleanup and report persistence still run. Incomplete cleanup leaves
  temporary ownership evidence unfinished so the artifact hook retains it.
  If the driver survives, its parent-side process and stderr references are
  unreferenced so the helper can exit with its failing report. This does not
  terminate that driver or establish Safari app cleanup; the recorded PID and
  unfinished evidence remain available for investigation.
- The shared session hook prunes finished, explicitly marked temporary QA
  artifacts only. It never kills discovered processes or deletes saved browser
  profiles. Close the owned browser through its session API and verify closure
  before finishing QA; failed closure remains a blocker, not hook-cleanup proof.
- Cleanup attempts shutdown/delete for a known owned UUID even if inventory fails.
  A failed create is recovered only by its exact recorded name/runtime, excluding
  every device present initially. Failed recovery or verification is reported.

Use `--diagnose` for one failed-session investigation after prerequisites are met.
SafariDriver writes PID/timestamp-specific diagnostics under
`~/Library/Logs/com.apple.WebDriver/`; the report records its owned driver PID.
Read only that run's logs. Diagnostic logging is off by default.

Labels matter. Playwright's WebKit build is an engine compatibility check. It is
not installed desktop Safari, native Mobile Safari, or a physical iPhone check.
Native simulator results still do not cover physical-device performance, hardware,
Apple Pay, or every touch gesture. This small harness does not capture native
Safari console/network logs or supply a general storefront acceptance suite.
Use the repository's existing journey tests for broader coverage.

Observed on 1 October 2026:

- Safari 26.3.1 and Xcode 16.2 are installed; iOS 18.3.1 runtime is available.
- Existing temporary benchmark tooling contains Playwright
  `1.61.0-alpha-1781023400000` and agent-browser `0.38.1`. Its matching WebKit binary
  is missing. Appium is absent and unnecessary for this native path.
- Script syntax and native read-only preflight passed.
- After the user enabled host Remote Automation, native desktop Safari passed
  all five fixture checks and saved a screenshot. Its session and driver closed.
- Native iOS still timed out locating/launching remote Safari, with no page checks.
  The fresh simulator and driver were removed; the original user simulator remained
  booted. A separate inventory cold-start timeout led to a bounded 60-second simctl
  timeout and explicit error diagnostics, not an iOS success claim.
- macOS 26.3.1 with Xcode 16.2 is outside Apple's supported host range. The exact
  retry's WebDriver service also logged an inability to discover simulator runtimes.
  This is a prerequisite and discovery failure to resolve, not proof of one cause.
  Select a compatible Xcode, then retry once with `--diagnose` and an available runtime.
  Xcode 26.3 is one version whose published host range includes macOS 26.x.
- No Xcode/runtime was installed and no automation preference changed by the script.
  These fixture results do not establish live Shopify or client acceptance coverage.

Observed on 2 October 2026:

- The user installed and selected Xcode 26.6 (17F113); first-launch checks passed.
- With the existing iOS 18.3.1 runtime, automatic Safari launch still timed out.
  Waiting for simulator boot alone did not resolve it. Explicitly launching Safari
  on the owned simulator created a native session, so the helper now does this.
- That session timed out during fixture navigation. Its diagnostic log reported
  an unsupported `Automation.resolveBrowsingContext` command before the timeout.
  Session creation is proven; the iOS fixture journey remains unverified.
- All three investigations removed their owned simulators and drivers. The run
  that created a session also deleted it. No user simulator was selected.
- Apple's matching iOS 26.5 runtime was installed. The two-minute and five-minute
  boot readiness limits expired before Safari started; cleanup passed. The longer
  run's captured output identified `com.apple.StocksMigrator` data migration.
- With `--boot-timeout 900`, the owned device completed boot in about seven minutes,
  then Safari launch hit its 60-second limit. A user simulator was also booted;
  system load was very high. The helper now defers when another simulator is booted.
  This run created no WebDriver session and performed no page checks. Cleanup
  deleted its owned device and kept the user's device booted.
- The redundant download export was removed; the installed runtime and original
  simulators were retained. Native iOS fixture acceptance remains unverified.
- The occupied-simulator guard passed both its isolated regression check and a
  real invocation: it refused before creating a simulator or SafariDriver.
- With only the owned simulator booted, native Safari 26.5 loaded the fixture and
  passed navigation and element reads. The first Details click returned success
  from WebDriver but did not open the disclosure, so the fixture still failed.
- Separate ten-second event probes observed no page input events after either
  Element Click or a 100ms W3C touch with no explicit Simulator display selection.
  Selecting the owned device through Simulator's native launch arguments produced
  trusted pointer-down and touch-start events, but no release/click before the
  ten-second limit. Display selection affected this observation; it has not been
  established as the complete cause or a working fix.
- Each completed probe deleted its own session, driver and simulator. The existing
  user Simulator app was preserved. These results establish native navigation,
  not successful touch interaction or live storefront acceptance.
- A temporary Appium 3.8.0/XCUITest 12.13.3 install passed required prerequisite
  checks. Agent-browser 0.38.1 ignored `AGENT_BROWSER_IOS_UDID` and attempted its
  default unavailable simulator instead. That boot failed before an Appium session
  was created; its QA device and loopback-only server were removed.
- An offline routing check then reproduced the wrong selection for `--device`,
  `AGENT_BROWSER_IOS_DEVICE` and `AGENT_BROWSER_IOS_UDID`. Its fake `xcrun` refuses
  every boot, so it cannot touch a real device. Do not use this version's iOS mode
  where exact device ownership matters. Recheck a candidate upgrade first:

  ```sh
  python3 ~/.dotfiles/.claude/scripts/check-agent-browser-ios.py /path/to/agent-browser
  ```

- Inspection of that release's source also found that `snapshot` and `select`
  require its Chromium backend, and iOS `tap @ref` does not resolve the reference.
  These are source findings, not successful native session tests. The advertised
  desktop workflow cannot be assumed to work unchanged on iOS.

Earlier on 3 October 2026, before native transport alternatives:

- Fresh read-only discovery found macOS 26.6.1, Safari 26.6, Xcode 27.0 and
  an available iOS 27.0 runtime. All eleven existing devices were shut down.
- One explicitly owned iPhone 17 / iOS 27.0 diagnostic completed boot and
  launched Mobile Safari. Production SafariDriver could not create a session:
  no session host matched the exact simulator capabilities. No page or input
  check ran. This is a discovery failure, not successful native interaction.
- The owned driver exited and the created simulator was deleted. Follow-up
  inventory retained all eleven original devices shut down, with no driver
  or Simulator app and the original desktop Safari PID still present.
- Desktop tests remain blocked. Driver exit and owned simulator cleanup do
  not establish desktop Safari app ownership or failed-session app exit.
  No Technology Preview session or automation-preference change ran in this
  diagnostic. Report: `/private/tmp/dc-outstanding-20261003/mobile-safari/report.json`.
- The helper now supports explicit `--driver technology-preview` selection.
  One current run used installed Technology Preview Release 253 (bundle version
  27.0), Xcode 27.0 and a newly created iPhone 17 / iOS 27.0 simulator. Safari
  launched, but New Session still found no host matching the exact owned UDID.
  No page or input check ran. Follow-up inventory preserved all eleven original
  shutdown devices and only original desktop Safari PID 4558; the owned driver
  and simulator were gone. Desktop remains blocked. This is a reproducible
  selection and cleanup check, not a compatibility fix: the earlier temporary
  Technology Preview diagnostic also used Release 253. Report:
  `/private/tmp/dc-apple-driver-selection-20261003/native/report.json`.

Resolution on 3 October 2026:

- Production Safari 26.6 lacks the inspected requested-process attachment support.
  A directly owned app plus explicit STP 253 process attachment also failed in native
  probes, so production desktop WebDriver remains guarded. No PID-delta termination
  or automation preference changes were used.
- STP 253's native MCP mode passed all five fixture checks and produced a verified
  PNG. Client teardown closed its launched app. A retained AppKit observation
  confirmed app exit and the original Safari instance remained alive. Native
  journey-failure and SIGINT probes also passed owned cleanup. The helper now
  exposes this route explicitly rather than claiming production Safari coverage.
- iOS 27 WebDriver still found no matching host after bounded retries, explicitly
  starting owned webinspectord, and selecting an owned Device Hub instance. Those
  probes all cleaned up. Inspector readiness/metadata remained incomplete; the
  precise Apple-side failure is not established. Earlier touch hangs resemble
  an open WebKit report, but that is a lead, not a proven diagnosis.
- Native XCTest bypassed that discovery path and passed navigation, disclosure,
  market selection, native quantity input and the exact rendered/server cart result
  on a fresh iPhone 16/iOS 27 simulator. The first input probe produced 21 because
  delete ran at the initial caret; native Select All plus `typeText("2")` corrected it,
  with an exact value assertion before submission. Created simulators were removed
  and all eleven original shutdown devices preserved.
- These are synthetic fixture workflow results, not completed NPFG storefront
  QA, Figma parity, production desktop Safari or physical-iPhone acceptance.

The isolated cleanup failure check does not launch a browser:

```sh
node ~/.dotfiles/.claude/scripts/test_apple_browser_qa.mjs
node ~/.dotfiles/.claude/scripts/test_apple_safari_mcp_qa.mjs
node ~/.dotfiles/.claude/scripts/test_apple_ios_xctest_qa.mjs
```

Primary references:

- [Apple Safari WebDriver](https://developer.apple.com/documentation/safari-developer-tools/webdriver)
- [Apple's production and Technology Preview driver locations](https://developer.apple.com/documentation/webkit/testing-with-webdriver-in-safari)
- [Enable WebDriver on macOS](https://developer.apple.com/documentation/safari-developer-tools/macos-enabling-webdriver)
- [Enable WebDriver on iOS and iPadOS](https://developer.apple.com/documentation/safari-developer-tools/ios-enabling-webdriver)
- [Apple Xcode system requirements](https://developer.apple.com/xcode/system-requirements/)
- [Inspecting iOS, including simulator Web Inspector](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)
- Installed `man safaridriver`: simulator capabilities, exact device UDID selection,
  on-demand boot and automation prerequisites.
- [W3C WebDriver](https://www.w3.org/TR/webdriver/)
- [Apple's native Safari MCP server](https://webkit.org/blog/18136/introducing-the-safari-mcp-server-for-web-developers/)
- [Apple native XCUIApplication API](https://developer.apple.com/documentation/xcuiautomation/xcuiapplication)
- [Related unresolved WebKit touch-interaction report](https://bugs.webkit.org/show_bug.cgi?id=322937)
- [Playwright browser support](https://playwright.dev/docs/browsers#webkit)

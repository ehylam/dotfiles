import assert from 'node:assert/strict';
import {validateXctestResults, validateIosJourney, validateIosAttachments, readIosJourneyEvidence, testXctest} from './apple-ios-xctest-qa.mjs';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const journey = {version: 1, steps: [
  {action: 'assertText', text: 'Slide one'},
  {action: 'tap', kind: 'button', label: 'Next'},
  {action: 'swipe', from: [0.8, 0.5], to: [0.2, 0.5]},
  {action: 'screenshot', name: 'After swipe'},
  {action: 'assertText', text: 'Slide three', visible: false},
]};
assert.equal(validateIosJourney(journey), journey);
const extended = {version: 1, steps: [
  {action: 'waitFor', text: 'Loaded', timeoutMs: 2000},
  {action: 'waitFor', label: 'Next', kind: 'button', visible: true},
  {action: 'tap', kind: 'button', label: 'Close popup', optional: true, scopeLabel: 'Newsletter dialog', timeoutMs: 500},
  {action: 'scrollTo', label: 'Footer', kind: 'text', maxSwipes: 3, direction: 'down', timeoutMs: 10000},
  {action: 'tap', label: 'Next', kind: 'button', allowToolbarCovered: true, expectText: 'Changed state'},
  {action: 'dismissOverlay', overlay: 'klaviyo', scopeLabel: 'Newsletter dialog'},
  {action: 'assertText', text: 'Changed state'},
]};
assert.equal(validateIosJourney(extended), extended);
const history = {version: 1, steps: [
  {action: 'tap', kind: 'link', label: 'Womens'},
  {action: 'dismissKeyboard', timeoutMs: 2000},
  {action: 'back', expectText: 'Matelot tee'},
  {action: 'navigate', path: '/products/matelot-tee?view=qa#top', expectText: 'Matelot tee', timeoutMs: 20000},
]};
// navigate and back carry their own changed-state assertion.
assert.equal(validateIosJourney(history), history);
for (const step of [
  {action: 'navigate', path: 'https://other.example/', expectText: 'Text'},
  {action: 'navigate', path: '//other.example/', expectText: 'Text'},
  {action: 'navigate', path: 'products/x', expectText: 'Text'},
  {action: 'navigate', path: '/a b', expectText: 'Text'},
  {action: 'navigate', path: '/\\other.example', expectText: 'Text'},
  {action: 'navigate', path: '/products/x'},
  {action: 'navigate', url: 'https://example.com/', expectText: 'Text'},
  {action: 'back'},
  {action: 'back', expectText: 'Text', label: 'Back'},
  {action: 'dismissKeyboard', label: 'Done'},
  {action: 'dismissKeyboard', timeoutMs: 0},
]) assert.throws(() => validateIosJourney({version: 1, steps: [step, {action: 'assertText', text: 'Final'}]}));
assert.throws(() => validateIosJourney({version: 1, steps: [{action: 'dismissKeyboard'}]}), /native text assertion/);
assert.throws(() => validateIosJourney({version: 1, steps: [
  {action: 'tap', kind: 'button', label: 'Absent optional', optional: true, expectText: 'Never asserted'},
  {action: 'screenshot', name: 'No assertion'},
]}), /native text assertion/);
for (const step of [
  {action: 'waitFor', text: 'Text', label: 'Label'}, {action: 'waitFor', label: 'Label'},
  {action: 'waitFor', text: 'Text', kind: 'button'}, {action: 'waitFor', text: 'Text', timeoutMs: 30001},
  {action: 'waitFor', text: 'Text', timeoutMs: 0}, {action: 'waitFor', text: 'Text', timeoutMs: 1.5},
  {action: 'tap', label: 'Close', kind: 'button', optional: 'yes'},
  {action: 'tap', label: 'Next', kind: 'button', allowToolbarCovered: true},
  {action: 'tap', label: 'Next', kind: 'button', allowToolbarCovered: true, expectText: 'Changed', optional: true},
  {action: 'scrollTo', label: 'Footer', kind: 'text', maxSwipes: 11},
  {action: 'scrollTo', label: 'Footer', kind: 'text', direction: 'left'},
  {action: 'dismissOverlay', overlay: 'generic-close', scopeLabel: 'Anything'},
  {action: 'dismissOverlay', overlay: 'klaviyo'},
]) assert.throws(() => validateIosJourney({version: 1, steps: [step, {action: 'assertText', text: 'Final'}]}));
for (const invalid of [null, {}, {...journey, version: 2}, {...journey, code: 'execute'},
  {version: 1, steps: []}, {version: 1, steps: Array(41).fill(journey.steps[0])},
  ...[{action: 'evaluate', script: 'alert(1)'}, {action: 'screenshot', name: 'Only pixels'},
    {action: 'tap', kind: 'any', label: 'Next'}, {action: 'assertText', text: ''},
    {action: 'assertText', text: 'Text', visible: 'yes'}, {action: 'assertText', text: 'Text', timeout: 0},
    {action: 'swipe', from: [0, 0.5], to: [0.8, 0.5]},
    {action: 'swipe', from: [0.5, 0.5], to: [0.5, 0.5]},
    {action: 'swipe', from: [0.5, NaN], to: [0.8, 0.5]},
  ].map(step => ({version: 1, steps: [step]})),
]) assert.throws(() => validateIosJourney(invalid));

const folder = await mkdtemp(join(tmpdir(), 'native-attachment-test-'));
try {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGQAAAAASUVORK5CYII=', 'base64');
  const item = {deviceId: 'OWNED', exportedFileName: 'shot.png', suggestedHumanReadableName: 'Safari final state_0.png'};
  const save = async attachments => writeFile(join(folder, 'manifest.json'), JSON.stringify([{testIdentifier: 'SafariTests/testNativeJourney()', attachments}]));
  await writeFile(join(folder, 'shot.png'), png);
  await save([item]);
  assert.equal((await validateIosAttachments(folder, 'OWNED')).length, 1);
  await assert.rejects(validateIosAttachments(folder, 'OWNED', 1), /Step 1/);
  await save([item, {...item, suggestedHumanReadableName: 'Step 1 tap_0.png'}]);
  assert.equal((await validateIosAttachments(folder, 'OWNED', 1)).length, 2);
  for (const invalid of [[], [{...item, deviceId: 'OTHER'}], [{...item, exportedFileName: '../shot.png'}]]) {
    await save(invalid); await assert.rejects(validateIosAttachments(folder, 'OWNED'));
  }
  await save([item]); await writeFile(join(folder, 'shot.png'), png.subarray(0, 24));
  await assert.rejects(validateIosAttachments(folder, 'OWNED'), /complete PNG/);
  const diagnostic = {deviceId: 'OWNED', exportedFileName: 'evidence.txt', suggestedHumanReadableName: 'Safari journey evidence_0.txt'};
  await writeFile(join(folder, 'evidence.txt'), JSON.stringify({steps: [{status: 'skipped'}], dialogs: [], scope: 'accessibility only'}));
  await save([diagnostic]);
  assert.equal((await readIosJourneyEvidence(folder, 'OWNED')).steps[0].status, 'skipped');
  await assert.rejects(readIosJourneyEvidence(folder, 'OTHER'), /another simulator/);
  await save([diagnostic, diagnostic]);
  await assert.rejects(readIosJourneyEvidence(folder, 'OWNED'), /ambiguous/);
  await save([{...diagnostic, exportedFileName: '../outside.txt'}]);
  await assert.rejects(readIosJourneyEvidence(folder, 'OWNED'), /escapes/);
  await save([diagnostic]);
  await writeFile(join(folder, 'evidence.txt'), JSON.stringify({steps: [{status: 'pretend-pass'}], dialogs: []}));
  await assert.rejects(readIosJourneyEvidence(folder, 'OWNED'), /Unknown native step status/);
} finally { await rm(folder, {recursive: true, force: true}); }

const device = 'OWNED-DEVICE';
const summary = {result: 'Passed', totalTestCount: 1, passedTests: 1, failedTests: 0,
  skippedTests: 0, expectedFailures: 0, devicesAndConfigurations: [{device: {deviceId: device}}]};
const tests = {testNodes: [{nodeType: 'Test Plan', children: [{nodeType: 'Test Case',
  nodeIdentifier: 'SafariTests/testNativeJourney()', result: 'Passed'}]}]};
validateXctestResults(summary, tests, device);
for (const change of [{totalTestCount: 0}, {passedTests: 0}, {failedTests: 1}, {skippedTests: 1}, {expectedFailures: 1}, {result: 'Failed'}]) {
  assert.throws(() => validateXctestResults({...summary, ...change}, tests, device));
}
assert.throws(() => validateXctestResults(summary, tests, 'OTHER-DEVICE'));
assert.throws(() => validateXctestResults(summary, {testNodes: []}, device));
assert.throws(() => validateXctestResults(summary, {testNodes: [{nodeType: 'Test Case', nodeIdentifier: 'Wrong/test()', result: 'Passed'}]}, device));
assert.throws(() => validateXctestResults(summary, {testNodes: [{...tests.testNodes[0].children[0], result: 'Skipped'}]}, device));

if (process.platform === 'darwin') {
  const options = {browser: 'ios', runtime: 'runtime', selector: 'h1', url: 'http://127.0.0.1/', expect: 'Text'};
  let touched = false;
  const dependencies = {command: () => { touched = true; throw new Error('Native execution forbidden'); },
    inventory: async () => ({runtimes: [{identifier: 'runtime'}], devices: [{state: 'Booted'}]}),
    driverProcesses: async () => [], fixtureServer: () => { touched = true; }};
  await assert.rejects(testXctest({...dependencies, options}), /Existing booted simulator/);
  await assert.rejects(testXctest({...dependencies, options: {...options, expect: undefined}}), /requires --expect/);
  await assert.rejects(testXctest({...dependencies, options: {...options, selector: '.title'}}), /does not use CSS/);
  await assert.rejects(testXctest({...dependencies, options: {...options, journey: '/unreviewed.mjs'}}), /does not use CSS/);
  await assert.rejects(testXctest({...dependencies, options: {...options, diagnose: true}}), /does not use CSS/);
  assert.equal(touched, false);
}
console.log('PASS: exact executed XCTest/device, empty/skipped/failed/wrong tests rejected, occupied simulator and unsupported options; no native apps launched');

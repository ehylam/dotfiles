import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./figma-qa.mjs', import.meta.url), 'utf8');
const comparison = source.slice(source.indexOf('function normaliseColor('),
  source.indexOf('function hexToRgb('));
const colorProperties = source.slice(source.indexOf('const COLOR_PROPERTIES ='),
  source.indexOf('\n', source.indexOf('const COLOR_PROPERTIES =')));
const heatmap = source.slice(source.indexOf('function computeDriftHeatmap('),
  source.indexOf('// ---------- Baseline comparison'));
const sarif = source.slice(source.indexOf('function xmlEscape('), source.lastIndexOf('\nmain().catch'));
const api = vm.runInNewContext(colorProperties + comparison + heatmap + sarif +
  '\n({computeDriftHeatmap, renderSarif, renderJUnit, compareProperty, intentFromReference, diffIntentAgainstRendered})');
const distanceIntent = api.intentFromReference({subcommand: 'distance', properties: 'vertical'},
  {distance: {vertical: 24, horizontal: 0}});
assert.equal(distanceIntent.vertical, 24);
assert.equal(api.diffIntentAgainstRendered(distanceIntent, {distance: {vertical: 80}})[0].property, 'vertical');
assert.equal(api.diffIntentAgainstRendered(distanceIntent, {distance: {vertical: 25}},
  {tolerances: {vertical: 1}}).length, 0);
assert.equal(api.diffIntentAgainstRendered(distanceIntent, {distance: {}})[0].status, 'missing');
assert.equal(api.diffIntentAgainstRendered({vertical: '24px'}, {distance: {vertical: 24}}).length, 0);
assert.equal(Object.keys(api.intentFromReference({subcommand: 'distance'},
  {distance: {vertical: 24, horizontal: 0, centreToCentreVertical: 40, centreToCentreHorizontal: 0}})).length, 4);
for (const rendered of [{text: ''}, {}, {text: '   '}]) {
  assert.equal(api.diffIntentAgainstRendered({text: 'Buy now'}, rendered)[0].status, 'content');
}
assert.equal(api.diffIntentAgainstRendered({text: ''}, {text: 'Buy now'}).length, 1);
assert.equal(api.diffIntentAgainstRendered({text: 'Buy now'}, {text: ' Buy  now '}).length, 0);
for (const property of ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor',
  'borderBottomColor', 'borderLeftColor', 'textDecorationColor']) {
  assert.equal(api.compareProperty(property, '#EDE7D9', 'rgb(237, 231, 217)').equal, true);
  assert.equal(api.compareProperty(property, '#EDE7D9', 'rgb(61, 57, 57)').equal, false);
}
const results = [{id: 'fixture', url: '/fixture', checks: [{id: 'layout', selector: '.fixture',
  viewports: {desktop: {drift: [{property: 'gap', design: '24px', rendered: '20px'}]}}}],
  visualChecks: [
    {id: 'different-pixels', selector: '.fixture', summary: 'partial',
      viewports: {desktop: {mismatchPercent: 12, mismatchedPixels: 12, totalPixels: 100}}},
    {id: 'missing-reference', aText: 'fixture', summary: 'fail',
      viewports: {desktop: {error: 'Missing reference PNG'}}},
    {id: 'matched', selector: '.fixture', summary: 'pass', viewports: {desktop: {mismatchPercent: 0}}}
  ]}];
const map = JSON.parse(JSON.stringify(api.computeDriftHeatmap(results)));
assert.deepEqual(map, [{property: 'gap', count: 1,
  examples: [{target: 'fixture', check: 'layout', viewport: 'desktop', design: '24px', rendered: '20px'}]}]);
const report = JSON.parse(api.renderSarif({baseUrl: 'https://example.invalid'}, results));
const findings = report.runs[0].results;
assert.equal(findings.length, 3);
assert.equal(findings[0].ruleId, 'figma-qa/drift/gap');
assert.equal(findings[1].ruleId, 'figma-qa/visual-drift');
assert.match(findings[1].message.text, /12% pixel mismatch/);
assert.match(findings[2].message.text, /Missing reference PNG/);
assert.equal(findings[2].locations[0].logicalLocations[0].kind, 'text-locator');
for (const finding of findings) {
  assert.equal('logicalLocations' in finding.locations[0].physicalLocation, false);
}
const fallback = JSON.parse(api.renderSarif({baseUrl: 'https://example.invalid'},
  [{...results[0], url: undefined}]));
assert.equal(fallback.runs[0].results[1].locations[0].physicalLocation.artifactLocation.uri,
  'https://example.invalid');
assert.deepEqual(JSON.parse(JSON.stringify(api.computeDriftHeatmap([]))), []);
const mixed = [{id: 'mixed', visualChecks: [{id: 'pixels', summary: 'fail', viewports: {
  mobile: {pass: false, mismatchPercent: 12}, desktop: {pass: true, mismatchPercent: 0},
  tablet: {mismatchPercent: 0}
}}]}];
assert.match(api.renderJUnit({}, mixed), /tests="3" failures="1"/);
const mixedFindings = JSON.parse(api.renderSarif({baseUrl: 'https://example.invalid'}, mixed)).runs[0].results;
assert.equal(mixedFindings.length, 1);
assert.equal(mixedFindings[0].properties.viewport, 'mobile');
const emptyComparison = [{id: 'empty', checks: [{id: 'gap', selector: '.gap', viewports: {
  desktop: {error: 'no comparable properties or text in intent', drift: []}
}}]}];
assert.match(api.renderJUnit({}, emptyComparison), /failures="1"/);
assert.equal(JSON.parse(api.renderSarif({baseUrl: 'https://example.invalid'}, emptyComparison))
  .runs[0].results[0].ruleId, 'figma-qa/inspection-error');
console.log('PASS: property heatmap and visual SARIF drift, errors, matched-state omission and URL fallback');

import assert from 'node:assert/strict';
import {guardModel, guardProvider} from './openrouter-stream-guard.mjs';

const reasoning = {type: 'reasoning-end', id: 'r', providerMetadata: {
  openrouter: {reasoning_details: [{signature: 'synthetic-signature'}]}}};
const finish = {type: 'finish', finishReason: {unified: 'tool-calls', raw: 'tool_calls'},
  usage: {inputTokens: {total: 10}}, providerMetadata: reasoning.providerMetadata};
const tool = {type: 'tool-call', toolCallId: 'fixture', toolName: 'read', input: '{}'};
const stream = parts => new ReadableStream({start(c) {parts.forEach(p => c.enqueue(p)); c.close();}});
const collect = async result => Array.fromAsync(result.stream);
let calls = 0;
const model = {specificationVersion: 'v3', doStream({valid}) {
  assert.equal(this, model);
  calls++;
  return {stream: stream(valid ? [reasoning, tool, finish] : [reasoning, finish]), request: 'unchanged'};
}};
const wrapped = guardModel(model);
const [healthy, malformed] = await Promise.all([
  wrapped.doStream({valid: true}).then(collect), wrapped.doStream({valid: false}).then(collect)
]);
assert.equal(healthy[0], reasoning);
assert.equal(healthy[1], tool);
assert.equal(healthy[2], finish);
assert.equal(malformed[0], reasoning);
assert.equal(malformed[1].type, 'error');
assert.equal(malformed[1].error.name, 'OpenRouterMissingToolCallError');
assert.equal(malformed[2].finishReason.unified, 'error');
assert.equal(malformed[2].finishReason.raw, 'tool_calls');
assert.equal(malformed[2].providerMetadata, finish.providerMetadata);
assert.equal(malformed[2].usage, finish.usage);
assert.equal(finish.finishReason.unified, 'tool-calls');
assert.equal(calls, 2);
assert.equal((await wrapped.doStream({valid: true})).request, 'unchanged');

function provider() {assert.equal(this, provider); return model;}
provider.languageModel = provider;
const other = {specificationVersion: 'v3', doGenerate() {}};
provider.imageModel = () => other;
const guarded = guardProvider(provider);
for (const candidate of [guarded(), guarded.languageModel(), guarded.call(null), guarded.bind(null)()]) {
  assert.equal((await collect(await candidate.doStream({valid: false}))).at(-1).finishReason.unified, 'error');
}
assert.equal(guarded.imageModel(), other);
const error = new Error('synthetic producer failure');
const failing = guardModel({specificationVersion: 'v3', doStream: () => ({
  stream: new ReadableStream({start(c) {c.error(error);}})
})});
await assert.rejects(collect(await failing.doStream({})), e => e === error);
let cancelled;
const cancellable = guardModel({specificationVersion: 'v3', doStream: () => ({
  stream: new ReadableStream({cancel(reason) {cancelled = reason;}})
})});
const result = await cancellable.doStream({});
await result.stream.cancel('consumer stopped');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(cancelled, 'consumer stopped');
assert.equal(guardModel(other), other);
console.log('PASS: fail-closed malformed stream, unchanged signed/tool events, concurrent state, receiver binding, no retry and cancellation');

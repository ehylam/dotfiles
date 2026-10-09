export function guardModel(model) {
  if (model?.specificationVersion !== 'v3' || typeof model.doStream !== 'function') return model;
  return new Proxy(model, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key !== 'doStream') return typeof value === 'function' ? value.bind(target) : value;
      return async (...args) => {
        const result = await Reflect.apply(value, target, args);
        let sawToolCall = false;
        return { ...result, stream: result.stream.pipeThrough(new TransformStream({
          transform(part, controller) {
            if (part.type === 'tool-call') sawToolCall = true;
            if (part.type === 'finish' && part.finishReason.unified === 'tool-calls' && !sawToolCall) {
              const error = Object.assign(new Error('OpenRouter stream finished with tool_calls but contained no tool call.'), {
                name: 'OpenRouterMissingToolCallError', data: { finishReason: part.finishReason.raw }
              });
              controller.enqueue({ type: 'error', error });
              controller.enqueue({ ...part, finishReason: { ...part.finishReason, unified: 'error' } });
            } else {
              controller.enqueue(part);
            }
          }
        })) };
      };
    }
  });
}

export function guardProvider(provider) {
  return new Proxy(provider, {
    apply(target, _receiver, args) {
      return guardModel(Reflect.apply(target, target, args));
    },
    get(target, key, receiver) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (['bind', 'call', 'apply'].includes(key)) return value.bind(receiver);
      return (...args) => guardModel(Reflect.apply(value, target, args));
    }
  });
}

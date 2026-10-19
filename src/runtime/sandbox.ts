import { z } from 'zod';
import {
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
} from 'quickjs-emscripten-core';
import { quickJS } from './quickjs.js';
import type { JsonValue } from '../contracts/workflow.js';
import { assertPayloadBound } from '../contracts/schema.js';
import { asError } from './scheduler.js';
import type { CallKind } from './types.js';

type Hooks = {
  call: (kind: CallKind, payload: JsonValue) => Promise<JsonValue>;
  sync: (kind: 'phase' | 'log', payload: JsonValue) => JsonValue;
  done: (value: JsonValue) => void;
  failed: (error: Error) => void;
};
const prelude = `
  globalThis.Date = undefined;
  Object.defineProperty(Math, 'random', {value: undefined});
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const agent = spec => __call('agent', JSON.stringify(spec)).then(JSON.parse);
  const lead = spec => __call('lead', JSON.stringify(spec)).then(JSON.parse);
  const phase = label => freeze(JSON.parse(__sync('phase', JSON.stringify(label))));
  const log = message => { __sync('log', JSON.stringify(message)); };
  const parallel = factories => Promise.all(factories.map(factory => factory()));
  const pipeline = (items, fn) => Promise.all(items.map((item, index) => fn(item, index)));
`;
const preludeV2 = prelude
  .replace(
    "const agent = spec => __call('agent', JSON.stringify(spec)).then(JSON.parse);",
    "const agent = (prompt, options) => __call('agent', JSON.stringify({prompt, options})).then(JSON.parse);",
  )
  .replace(
    "const lead = spec => __call('lead', JSON.stringify(spec)).then(JSON.parse);",
    "const lead = (objective, evidence) => __call('lead', JSON.stringify({objective, evidence})).then(JSON.parse);",
  )
  .replace(
    'const pipeline = (items, fn) => Promise.all(items.map((item, index) => fn(item, index)));',
    'const pipeline = (items, ...stages) => Promise.all(items.map(async (item, index) => { let value = item; for (const stage of stages) { if (value === null) return null; value = await stage(value, index); } return value; }));',
  );

export class ScriptMachine {
  private readonly deferred = new Set<QuickJSDeferredPromise>();
  private result: QuickJSHandle | undefined;
  private stopped = false;
  private deadline = 0;
  private fuel = 100_000;
  private version: 1 | 2 = 1;
  private constructor(
    private readonly vm: QuickJSContext,
    private readonly hooks: Hooks,
  ) {
    vm.runtime.setMemoryLimit(32 * 1024 * 1024);
    vm.runtime.setMaxStackSize(512 * 1024);
    vm.runtime.setInterruptHandler(() => --this.fuel <= 0 || performance.now() > this.deadline);
    vm.newFunction('__call', (kind, payload) =>
      this.host(() => this.bridge(vm.getString(kind) as CallKind, vm.getString(payload))),
    ).consume((handle) => vm.setProp(vm.global, '__call', handle));
    vm.newFunction('__sync', (kind, payload) =>
      this.host(() => {
        const method = vm.getString(kind) as 'phase' | 'log';
        const serialized = vm.getString(payload);
        const value =
          method === 'log' && this.version === 2
            ? serialized.slice(0, 32_768)
            : this.parse(serialized);
        const result = hooks.sync(method, value);
        return vm.newString(JSON.stringify(result));
      }),
    ).consume((handle) => vm.setProp(vm.global, '__sync', handle));
  }
  static async create(hooks: Hooks): Promise<ScriptMachine> {
    return new ScriptMachine((await quickJS()).newContext(), hooks);
  }
  private host<T>(action: () => T): T {
    const start = performance.now();
    try {
      return action();
    } finally {
      this.deadline += performance.now() - start;
    }
  }
  start(script: string, args: JsonValue, version: 1 | 2 = 1): void {
    if (this.stopped) return;
    try {
      this.version = version;
      this.deadline = performance.now() + 100;
      this.result = this.vm.unwrapResult(
        this.vm.evalCode(`(async () => { 'use strict';
        ${version === 2 ? preludeV2 : prelude}
        const args = freeze(JSON.parse(${JSON.stringify(JSON.stringify(args))}));
        return await (async () => { ${script}\n })();
      })()`),
      );
      this.pump();
    } catch (error) {
      this.fail(error);
    }
  }
  private parse(serialized: string): JsonValue {
    if (Buffer.byteLength(serialized) > 1_048_576) throw new Error('Payload exceeds one MiB');
    const value = JSON.parse(serialized) as JsonValue;
    assertPayloadBound(value);
    return value;
  }
  private bridge(kind: CallKind, serialized: string): QuickJSHandle {
    const value = this.parse(serialized);
    const promise = this.vm.newPromise();
    this.deferred.add(promise);
    void this.hooks.call(kind, value).then(
      (result) => this.settle(promise, result),
      (error: unknown) => this.settle(promise, null, asError(error)),
    );
    return promise.handle;
  }
  private settle(promise: QuickJSDeferredPromise, value: JsonValue, error?: Error): void {
    if (this.stopped) return;
    try {
      assertPayloadBound(value);
      const handle = error
        ? this.vm.newError(error.message)
        : this.vm.newString(JSON.stringify(value));
      if (error) promise.reject(handle);
      else promise.resolve(handle);
      handle.dispose();
      promise.dispose();
      this.deferred.delete(promise);
      this.pump();
    } catch (failure) {
      this.fail(failure);
    }
  }
  private pump(): void {
    if (!this.result || this.stopped) return;
    this.deadline = performance.now() + 100;
    const jobs = this.vm.runtime.executePendingJobs();
    if (jobs.error) {
      const error = this.vm.dump(jobs.error) as unknown;
      jobs.error.dispose();
      this.fail(error);
      return;
    }
    const state = this.vm.getPromiseState(this.result);
    if (state.type === 'pending') return;
    try {
      if (state.type === 'rejected') throw new Error(JSON.stringify(this.vm.dump(state.error)));
      const value = this.vm.dump(state.value) as JsonValue | undefined;
      assertPayloadBound(value ?? null);
      this.hooks.done(z.json().parse(value ?? null));
    } catch (error) {
      this.hooks.failed(asError(error));
    } finally {
      if (state.type === 'fulfilled') state.value.dispose();
      else state.error.dispose();
      this.close();
    }
  }
  private fail(error: unknown): void {
    this.hooks.failed(asError(error));
    this.close();
  }
  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const promise of this.deferred) promise.dispose();
    this.deferred.clear();
    this.result?.dispose();
    this.vm.dispose();
  }
}

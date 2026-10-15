import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';

let modulePromise: Promise<QuickJSWASMModule> | undefined;
export function quickJS(): Promise<QuickJSWASMModule> {
  modulePromise ??= newQuickJSWASMModuleFromVariant(
    newVariant(RELEASE_SYNC, {
      wasmBinary: async () => {
        const packaged = new URL('./quickjs.wasm', import.meta.url);
        const path = existsSync(packaged)
          ? packaged
          : createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm');
        return Uint8Array.from(readFileSync(path)).buffer;
      },
    }),
  );
  return modulePromise;
}

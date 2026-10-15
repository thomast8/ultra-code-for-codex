import type { Socket } from 'node:net';
import { z } from 'zod';
import { assertPayloadBound } from '../contracts/schema.js';

const frameLimit = 1_048_576;
// Bound reassembly memory; larger reads must select a run or task.
const readLimit = 64 * frameLimit;
const pageSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  bytes: z.number().int().min(1).max(readLimit),
  data: z.string().min(1).max(65_536),
});

export async function sendReply(socket: Socket, id: string, result: unknown) {
  const reply = { id, result };
  const serialized = JSON.stringify(reply);
  if (Buffer.byteLength(serialized) <= frameLimit) {
    assertPayloadBound(reply);
    socket.end(`${serialized}\n`);
    return;
  }
  const bytes = Buffer.byteLength(serialized);
  if (bytes > readLimit) throw new Error('Read exceeds 64 MiB; select a run or task result');
  for (let offset = 0, index = 0; offset < serialized.length; offset += 65_536, index += 1) {
    const frame = {
      id,
      page: { index, bytes, data: serialized.slice(offset, offset + 65_536) },
    };
    assertPayloadBound(frame);
    await new Promise<void>((resolve, reject) => {
      socket.write(`${JSON.stringify(frame)}\n`, (error) => (error ? reject(error) : resolve()));
    });
  }
  socket.end(`${JSON.stringify({ id, end: true })}\n`);
}

export class ReplyReader {
  private buffer = '';
  private pages: string[] = [];
  private bytes = 0;
  private characters = 0;

  constructor(private id: string) {}

  accept(chunk: string): { result: unknown } | null {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (Buffer.byteLength(line) > frameLimit) throw new Error('Runtime response exceeds one MiB');
      const frame = JSON.parse(line) as Record<string, unknown>;
      if (frame.id !== this.id)
        throw new Error(
          typeof frame.error === 'string' ? frame.error : 'Runtime response identity mismatch',
        );
      const result = this.frame(frame);
      if (result) return result;
    }
    if (Buffer.byteLength(this.buffer) > frameLimit)
      throw new Error('Runtime response exceeds one MiB');
    return null;
  }

  private frame(frame: Record<string, unknown>): { result: unknown } | null {
    if (typeof frame.error === 'string') throw new Error(frame.error);
    if (frame.page !== undefined) return this.page(frame.page);
    if (!this.pages.length) {
      if (!Object.hasOwn(frame, 'result')) throw new Error('Invalid Ultra Code runtime response');
      return { result: frame.result };
    }
    if (frame.end !== true) throw new Error('Incomplete paged runtime response');
    const serialized = this.pages.join('');
    if (Buffer.byteLength(serialized) !== this.bytes)
      throw new Error('Incomplete paged runtime response');
    const reply = JSON.parse(serialized) as Record<string, unknown>;
    if (reply.id !== this.id || !Object.hasOwn(reply, 'result'))
      throw new Error('Invalid paged runtime response');
    return { result: reply.result };
  }

  private page(value: unknown): null {
    const parsed = pageSchema.safeParse(value);
    if (!parsed.success) throw new Error('Invalid paged runtime response');
    const page = parsed.data;
    if (page.index !== this.pages.length || (this.pages.length > 0 && this.bytes !== page.bytes))
      throw new Error('Invalid paged runtime response');
    this.bytes = Number(page.bytes);
    this.characters += page.data.length;
    if (this.characters > this.bytes)
      throw new Error('Paged runtime response exceeds declared size');
    this.pages.push(page.data);
    return null;
  }
}

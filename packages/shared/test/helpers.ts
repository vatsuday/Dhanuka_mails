import { Writable } from 'node:stream';

/** An in-memory log destination: collects each JSON line pino writes. */
export function memoryStream(): { stream: Writable; lines: () => Record<string, unknown>[]; raw: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const raw = (): string => chunks.join('');
  const lines = (): Record<string, unknown>[] =>
    raw()
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { stream, lines, raw };
}

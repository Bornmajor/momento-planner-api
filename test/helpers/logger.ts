import { Writable } from 'node:stream';
import { createLogger } from '../../src/lib/logger.js';

/** A logger that writes JSON lines into memory, so tests can inspect what was logged. */
export function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({ level: 'debug', destination });
  return { logger, lines, text: () => lines.join('') };
}

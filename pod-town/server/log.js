/** Console logging that redacts secrets before anything reaches the terminal. */
import { redact } from './config.js';

const stamp = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (msg) => console.log(`[${stamp()}] ${redact(String(msg))}`),
  warn: (msg) => console.warn(`[${stamp()}] ! ${redact(String(msg))}`),
  error: (msg) => console.error(`[${stamp()}] X ${redact(String(msg))}`),
};

// Build-time entry: bundling a CommonJS package into one ESM file lets DSH's
// SSR module loader execute it without its CJS interop.
export { Client } from 'ssh2';

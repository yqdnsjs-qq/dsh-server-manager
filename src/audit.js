import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Append-only JSONL audit trail for mutating remote actions.
 *
 * Writes are synchronous on purpose: an audit line must be on disk before the
 * tool answers, and remote operations are infrequent enough that the cost is
 * irrelevant. Failures are swallowed — auditing must never break an operation.
 */
export class AuditLog {
  constructor({ file, maxBytes = 5 * 1024 * 1024, enabled = true }) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.enabled = enabled;
    this.broken = false;
  }

  rotateIfNeeded() {
    try {
      if (!existsSync(this.file)) return;
      if (statSync(this.file).size < this.maxBytes) return;
      renameSync(this.file, `${this.file}.1`);
    } catch {
      /* ignore */
    }
  }

  /**
   * @param {object} entry JSON-serializable audit record.
   */
  record(entry) {
    if (!this.enabled || this.broken) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      this.rotateIfNeeded();
      appendFileSync(this.file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
    } catch {
      this.broken = true;
    }
  }
}

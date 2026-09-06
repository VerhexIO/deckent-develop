import type { MemoryReadLabelsV1 } from './memory-read-contract.js';

/** Presentation adapter: the read service has no dependency on a host catalog. */
export function buildMemoryReadLabels(
  getMessage: (key: string, language: string) => string,
  language = 'en',
): Readonly<MemoryReadLabelsV1> {
  const message = (key: string) => getMessage(`memory_read.${key}`, language);
  return Object.freeze({
    id: message('id'),
    revision: message('revision'),
    scope: message('scope'),
    source: message('source'),
    status: message('status'),
    sprint: message('sprint'),
    updatedAt: message('updated_at'),
    deferred: message('deferred'),
    detail: message('detail'),
    continuation: message('continuation'),
  });
}

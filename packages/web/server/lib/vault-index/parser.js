/**
 * Vault parser — frontmatter + body chunking for the Agents Vault → semantic
 * index (Tier 2).
 *
 * Reads a Markdown note the way the vault actually writes it: an optional
 * `---`-fenced YAML frontmatter block followed by a body. The frontmatter is
 * parsed line-wise over the flat `key: value` shape the vault uses (scalars,
 * inline lists), not full YAML; anything that is not a flat key/value is left
 * as-is rather than guessed at.
 *
 * [DECISION_RECORD] Chunking is a rolling character window with overlap,
 *   preferring a paragraph break, then a sentence break, before a hard cut.
 */

import { createHash } from 'node:crypto';

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

export const DEFAULT_CHUNK_SIZE = 1000;
export const DEFAULT_CHUNK_OVERLAP = 150;

const parseScalar = (raw) => {
  const value = raw.trim();
  if (value === '' || value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return value;
};

const parseFrontmatter = (block) => {
  const meta = {};
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('#')) continue;
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) continue; // a continuation line, not a key: value
    const key = line.slice(0, colonIndex).trim();
    if (key) meta[key] = parseScalar(line.slice(colonIndex + 1));
  }
  return meta;
};

export const chunkText = (text, { chunkSize = DEFAULT_CHUNK_SIZE, chunkOverlap = DEFAULT_CHUNK_OVERLAP } = {}) => {
  if (!text) return [];
  const chunks = [];
  let start = 0;
  const textLength = text.length;

  while (start < textLength) {
    let end = Math.min(start + chunkSize, textLength);
    if (end < textLength) {
      let boundary = text.lastIndexOf('\n\n', end);
      if (boundary === -1 || boundary <= start) {
        boundary = text.lastIndexOf('. ', end);
      }
      if (boundary > start) end = boundary + 1;
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= textLength) break;
    start = Math.max(start + 1, end - chunkOverlap);
  }

  return chunks;
};

const sanitizeIdPart = (value) => String(value).replace(/[^a-zA-Z0-9._-]/g, '_');

/**
 * A deterministic, store-safe id for one chunk: the vault-relative path, its
 * index, and a hash of the content. Re-indexing an unchanged file yields
 * byte-identical ids, which is what makes evict-before-upsert idempotent.
 */
export const chunkIdFor = (relativePath, index, chunk) => {
  const hash = createHash('sha256')
    .update(relativePath)
    .update(String(index))
    .update(chunk)
    .digest('hex')
    .slice(0, 12);
  return `${sanitizeIdPart(relativePath)}_${index}_${hash}`;
};

export const parseFile = (text, { relativePath = '', chunkSize, chunkOverlap } = {}) => {
  const metadata = {};
  let body = text;

  const match = FRONTMATTER_RE.exec(text);
  if (match) {
    Object.assign(metadata, parseFrontmatter(match[1]));
    body = text.slice(match[0].length);
  }

  const chunks = chunkText(body, { chunkSize, chunkOverlap });
  return { metadata, chunks, relativePath };
};

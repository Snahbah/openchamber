/**
 * BERT WordPiece tokenizer for BGE, implemented directly (no native modules).
 *
 * BGE models use the standard BERT tokenizer: lowercase, strip accents,
 * whitespace-tokenize, separate CJK and punctuation, then WordPiece
 * (greedy longest-match subword segmentation). Special tokens are read from
 * the vocab rather than hardcoded, with BERT's standard values as fallback.
 *
 * [DECISION_RECORD] This is a from-scratch tokenizer because `transformers.js`
 *   and `@huggingface/tokenizers` both depend on native modules that fail under
 *   Bun. It is pure and deterministic.
 */

const STANDARD_SPECIAL_TOKENS = {
  '[PAD]': 0,
  '[UNK]': 100,
  '[CLS]': 101,
  '[SEP]': 102,
  '[MASK]': 103,
};

const isCjk = (char) => {
  const cp = char.codePointAt(0);
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0xf900 && cp <= 0xfaff)
  );
};

export const basicTokenize = (text) => {
  const normalized = String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const tokens = [];
  for (const raw of normalized.split(/\s+/)) {
    if (!raw) continue;
    let buffer = '';
    for (const char of raw) {
      if (/[a-z0-9]/.test(char)) {
        buffer += char;
      } else {
        if (buffer) {
          tokens.push(buffer);
          buffer = '';
        }
        if (isCjk(char)) tokens.push(char);
        else tokens.push(char);
      }
    }
    if (buffer) tokens.push(buffer);
  }
  return tokens;
};

export const wordpiece = (token, vocab) => {
  if (vocab.has(token)) return [token];

  const sub = [];
  let remaining = token;
  while (remaining.length > 0) {
    const isFirst = sub.length === 0;
    let prefixLen = remaining.length;
    let found = null;
    while (prefixLen > 0) {
      const candidate = isFirst
        ? remaining.slice(0, prefixLen)
        : `##${remaining.slice(0, prefixLen)}`;
      if (vocab.has(candidate)) {
        found = candidate;
        break;
      }
      prefixLen -= 1;
    }
    if (found === null) return ['[UNK]'];
    sub.push(found);
    remaining = remaining.slice(prefixLen);
  }
  return sub;
};

export const createTokenizer = ({ vocab, maxLength = 512 }) => {
  const idOf = (token) => {
    if (vocab.has(token)) return vocab.get(token);
    return STANDARD_SPECIAL_TOKENS[token];
  };

  const tokenize = (text) => {
    const ids = [idOf('[CLS]')];
    const limit = maxLength - 1; // reserve one slot for [SEP]

    for (const token of basicTokenize(text)) {
      for (const piece of wordpiece(token, vocab)) {
        ids.push(idOf(piece) ?? idOf('[UNK]'));
        if (ids.length >= limit) break;
      }
      if (ids.length >= limit) break;
    }

    ids.push(idOf('[SEP]'));

    // Pad to maxLength; attention mask is 1 for real tokens, 0 for padding.
    const inputIds = new BigInt64Array(maxLength);
    const attentionMask = new BigInt64Array(maxLength);
    const tokenTypeIds = new BigInt64Array(maxLength);
    for (let i = 0; i < maxLength; i += 1) {
      if (i < ids.length) {
        inputIds[i] = BigInt(ids[i]);
        attentionMask[i] = 1n;
        tokenTypeIds[i] = 0n;
      } else {
        inputIds[i] = 0n; // [PAD]
        attentionMask[i] = 0n;
        tokenTypeIds[i] = 0n;
      }
    }

    return { inputIds, attentionMask, tokenTypeIds, length: ids.length };
  };

  return { tokenize };
};

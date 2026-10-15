/**
 * In-process text embedder (Tier 2) — onnxruntime-web directly, no native
 * modules.
 *
 * [DECISION_RECORD] `onnxruntime-web` is pure WASM and loads under Bun, where
 *   `onnxruntime-node` and `sharp` (pulled in by transformers.js) do not.
 * [DECISION_RECORD] Pooling is CLS (first token), BGE's documented sentence
 *   embedding, then L2-normalised so cosine similarity is a dot product.
 * [DECISION_RECORD] The tokenizer is the from-scratch WordPiece in
 *   `tokenizer.js`; the model and vocab are local files under a cache dir.
 */

import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createTokenizer } from './tokenizer.js';

const require = createRequire(import.meta.url);

const loadVocab = async (filePath) => {
  const text = await fs.readFile(filePath, 'utf8');
  const map = new Map();
  text.split('\n').forEach((token, index) => {
    const trimmed = token.trim();
    if (trimmed) map.set(trimmed, index);
  });
  return map;
};

export const createEmbedder = async ({ modelPath, vocabPath, maxLength = 512 } = {}) => {
  if (!modelPath || !vocabPath) throw new Error('modelPath and vocabPath are required');

  // Loaded lazily so the server does not import onnxruntime-web at boot; the
  // WASM runtime files live beside its entry (…/dist/ort.node.min.mjs).
  const ort = await import('onnxruntime-web');
  const ortEntry = require.resolve('onnxruntime-web');
  // onnxruntime-web loads its .wasm/.mjs files by URL; Node's ESM loader
  // rejects a bare Windows path, so it must be a file:// URL. Bun accepts
  // either, so the file:// form is the portable choice.
  ort.env.wasm.wasmPaths = `${pathToFileURL(dirname(ortEntry)).href}/`;

  const [vocab, modelBuffer] = await Promise.all([
    loadVocab(vocabPath),
    fs.readFile(modelPath),
  ]);

  const session = await ort.InferenceSession.create(modelBuffer);
  const tokenizer = createTokenizer({ vocab, maxLength });

  const embed = async (documents) => {
    const vectors = [];
    for (const document of documents) {
      const { inputIds, attentionMask, tokenTypeIds } = tokenizer.tokenize(document);
      const feeds = {
        input_ids: new ort.Tensor('int64', inputIds, [1, maxLength]),
        attention_mask: new ort.Tensor('int64', attentionMask, [1, maxLength]),
        token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, maxLength]),
      };
      const results = await session.run(feeds);

      const hidden = results.last_hidden_state;
      const dim = hidden.dims[2];
      const data = hidden.data; // Float32Array [1, seq, dim]

      // CLS pooling: the first token's hidden state.
      const vec = [];
      for (let i = 0; i < dim; i += 1) vec.push(data[i]);

      const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0)) || 1;
      vectors.push(vec.map((x) => x / norm));

      // Yield back to the event loop so background server I/O is not starved
      await new Promise((resolve) => setImmediate(resolve));
    }
    return vectors;
  };

  return { embed };
};

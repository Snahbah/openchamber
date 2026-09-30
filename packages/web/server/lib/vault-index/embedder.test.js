import { describe, test, expect } from 'bun:test';

import os from 'node:os';
import path from 'node:path';

import { createEmbedder } from './embedder.js';

const MODEL_DIR = path.join(os.homedir(), '.cache', 'openchamber', 'embedder', 'bge-base-en-v1.5');

describe('embedder (onnxruntime-web, in-process)', () => {
  test('produces a normalized 768-d vector per document', async () => {
    const { embed } = await createEmbedder({
      modelPath: path.join(MODEL_DIR, 'onnx', 'model.onnx'),
      vocabPath: path.join(MODEL_DIR, 'vocab.txt'),
    });

    const vectors = await embed(['hello world', 'sovereign memory']);

    expect(vectors.length).toBe(2);
    expect(vectors[0].length).toBe(768);
    expect(vectors[1].length).toBe(768);

    const norm = Math.sqrt(vectors[0].reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 3);
  }, 120000);
});

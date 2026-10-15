import { describe, expect, test } from 'bun:test';

import { basicTokenize, wordpiece, createTokenizer } from './tokenizer.js';

const vocab = new Map([
  ['[PAD]', 0],
  ['[UNK]', 100],
  ['[CLS]', 101],
  ['[SEP]', 102],
  ['[MASK]', 103],
  ['hello', 2000],
  ['world', 2001],
  ['##s', 2002],
  ['sovereign', 2003],
  ['memory', 2004],
]);

describe('tokenizer', () => {
  test('basic tokenization lowercases and splits punctuation', () => {
    expect(basicTokenize('Hello, World!')).toEqual(['hello', ',', 'world', '!']);
  });

  test('wordpiece segments an unknown word into known subwords', () => {
    expect(wordpiece('hellos', vocab)).toEqual(['hello', '##s']);
  });

  test('wordpiece returns [UNK] for an unsegmentable word', () => {
    expect(wordpiece('zzz', vocab)).toEqual(['[UNK]']);
  });

  test('tokenize wraps with CLS/SEP and pads to maxLength', () => {
    const { tokenize } = createTokenizer({ vocab, maxLength: 8 });
    const { inputIds, attentionMask, length } = tokenize('hello world');

    expect(length).toBe(4); // [CLS] hello world [SEP]
    expect(Number(inputIds[0])).toBe(101); // [CLS]
    expect(Number(inputIds[1])).toBe(2000); // hello
    expect(Number(inputIds[2])).toBe(2001); // world
    expect(Number(inputIds[3])).toBe(102); // [SEP]
    // padding
    expect(Number(inputIds[4])).toBe(0);
    expect(attentionMask[4]).toBe(0n);
    expect(attentionMask[1]).toBe(1n);
  });
});

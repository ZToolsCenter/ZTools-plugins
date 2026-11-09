import { describe, expect, it } from 'vitest';
import { encodePortableTextV2, V2ProtocolError } from '../src/v2';
import { hash, abcSha256 } from './portable-projection-fixture';

const limits = { maxInputBytes: 1024, maxOutputBytes: 1024 };
const bytes = (hex: string) => Buffer.from(hex, 'hex');
describe('public Unicode portable codec; fixed independent byte expectations', () => {
  for (const [name, input, expected] of [
    ['ASCII', '616263', '616263'], ['BOM retained', 'efbbbf616263', 'efbbbf616263'],
    ['CRLF retained', '610d0a620a', '610d0a620a'], ['CJK and astral', 'e6b189f09f9880', 'e6b189f09f9880'],
    ['combining mark not normalized', '65cc81', '65cc81'], ['empty UTF8', '', ''],
  ] as const) it(`UTF8 ${name}`, () => expect(Buffer.from(encodePortableTextV2(bytes(input), 'utf8', limits)).toString('hex')).toBe(expected));
  it('fixed ABC digest is independently known, not generated from codec output', () => {
    expect(hash(bytes('616263'))).toBe(abcSha256);
    expect(hash(encodePortableTextV2(bytes('6100620063000000'), 'cf-unicode-text', limits))).toBe(abcSha256);
  });
  for (const input of ['80', 'c0af', 'e282', 'eda080', 'f4908080', 'ff', '610062']) {
    it(`rejects malformed UTF8 or NUL ${input}`, () => expect(() => encodePortableTextV2(bytes(input), 'utf8', limits)).toThrowError(V2ProtocolError));
  }
  for (const [input, expected] of [['6100620063000000', '616263'], ['fffe61000000', 'efbbbf61'],
    ['61000d000a000000', '610d0a'], ['3dd800de0000', 'f09f9880'], ['0000', '']] as const) {
    it(`strict CF_UNICODETEXT ${input}`, () => expect(Buffer.from(encodePortableTextV2(bytes(input), 'cf-unicode-text', limits)).toString('hex')).toBe(expected));
  }
  for (const input of ['', '61', '6100', '610000000000', '6100000062000000', '00d80000', '00dc0000', '00d861000000']) {
    it(`rejects malformed CF_UNICODETEXT ${input || 'empty'}`, () => expect(() => encodePortableTextV2(bytes(input), 'cf-unicode-text', limits)).toThrowError(V2ProtocolError));
  }
  it('honors exact input/output byte limits without truncating multibyte output', () => {
    expect(Buffer.from(encodePortableTextV2(bytes('ac200000'), 'cf-unicode-text', { maxInputBytes: 4, maxOutputBytes: 3 })).toString('hex')).toBe('e282ac');
    expect(() => encodePortableTextV2(bytes('ac200000'), 'cf-unicode-text', { maxInputBytes: 3, maxOutputBytes: 3 })).toThrowError(expect.objectContaining({ code: 'over-limit' }));
    expect(() => encodePortableTextV2(bytes('ac200000'), 'cf-unicode-text', { maxInputBytes: 4, maxOutputBytes: 2 })).toThrowError(expect.objectContaining({ code: 'over-limit' }));
  });
  for (const invalid of [0, -1, 1.5, NaN, Infinity]) it(`invalid byte budget ${invalid}`, () => {
    expect(() => encodePortableTextV2(bytes('61'), 'utf8', { ...limits, maxInputBytes: invalid })).toThrowError(V2ProtocolError);
    expect(() => encodePortableTextV2(bytes('61'), 'utf8', { ...limits, maxOutputBytes: invalid })).toThrowError(V2ProtocolError);
  });
  it('returns owned output and rejects shared/detached input', () => {
    const input = bytes('616263'), output = encodePortableTextV2(input, 'utf8', limits);
    output[0] = 0x7a; expect(input.toString('hex')).toBe('616263');
    expect(() => encodePortableTextV2(new Uint8Array(new SharedArrayBuffer(4)), 'utf8', limits)).toThrowError(V2ProtocolError);
    const detached = new Uint8Array(3); structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(() => encodePortableTextV2(detached, 'utf8', limits)).toThrowError(V2ProtocolError);
  });
});

const pathEncode = encodeURIComponent;

function query(token) {
  return `?safe=one&safe=two&${token}%ZZ=ignored#fragment-${token}`;
}

export function pathRedactionHar() {
  const queryToken = `github_pat_${'Q'.repeat(24)}`;
  const invalidAfterToken = `ghp_${'I'.repeat(36)}`;
  const nestedMethod = 'METHOD_PREFIX-----BEGIN PRIVATE KEY-----OUTER_METHOD_BODY-----BEGIN PRIVATE KEY-----INNER_METHOD_BODY-----END PRIVATE KEY-----METHOD_OUTER_TAIL_SECRET-----END PRIVATE KEY-----VISIBLE_METHOD_NESTED';
  const mismatchedMethod = '-----BEGIN RSA PRIVATE KEY-----METHOD_RSA_BODY-----END PRIVATE KEY-----METHOD_MISMATCH_TAIL-----END RSA PRIVATE KEY-----VISIBLE_METHOD_MATCHED';
  const unicodeUnclosedMethod = `${'ß'.repeat(52)}-----END PRIVATE KEY-----METHOD_STRAY_VISIBLE-----BEGIN PRIVATE KEY-----METHOD_UNICODE_UNCLOSED_BODY`;
  const unicodeCompleteMethod = '-----BEGIN PRIVATE KEY-----METHOD_UNICODE_ß_BODY-----END PRIVATE KEY-----VISIBLE_METHOD_UNICODE';
  const sequentialMethod = '-----BEGIN EC PRIVATE KEY-----METHOD_FIRST_BODY-----END EC PRIVATE KEY-----VISIBLE_METHOD_FIRST-----BEGIN DSA PRIVATE KEY-----METHOD_SECOND_BODY-----END DSA PRIVATE KEY-----VISIBLE_METHOD_SECOND';
  const invalidComplete = `not a url/safe%2Fboundary/${pathEncode('-----BEGIN PRIVATE KEY-----INVALID_COMPLETE_BODY')}/INVALID_COMPLETE_TAIL_A/INVALID_COMPLETE_TAIL_B/${pathEncode(`-----END PRIVATE KEY-----VISIBLE_INVALID_${invalidAfterToken}`)}${query(queryToken)}`;
  const invalidTruncated = `not a url/safe%2Fboundary/${pathEncode('-----BEGIN RSA PRIVATE KEY-----INVALID_TRUNCATED_BODY')}/INVALID_TRUNCATED_TAIL_A/INVALID_TRUNCATED_TAIL_B${query(queryToken)}`;
  const unicodeUnclosed = `https://safe.test/safe%2Fboundary/${pathEncode(`${'ß'.repeat(52)}-----END PRIVATE KEY-----STRAY_VISIBLE-----BEGIN PRIVATE KEY-----UNICODE_UNCLOSED_BODY`)}/UNICODE_UNCLOSED_TAIL${query(queryToken)}`;
  const unicodeComplete = `https://safe.test/safe%2Fboundary/${pathEncode('-----BEGIN PRIVATE KEY-----UNICODE_ß_BODY')}/${pathEncode('-----END PRIVATE KEY-----VISIBLE_UNICODE')}${query(queryToken)}`;
  const malformedSame = `https://safe.test/safe%2Fboundary/${pathEncode('-----BEGIN PRIVATE KEY-----')}%ZZMALFORMED_SAME_SECRET/MALFORMED_SAME_AFTER${query(queryToken)}`;
  const malformedCross = `https://safe.test/safe%2Fboundary/${pathEncode('-----BEGIN PRIVATE KEY-----VALID_PREFIX')}/%ZZMALFORMED_CROSS_SECRET/MALFORMED_CROSS_AFTER${query(queryToken)}`;
  const mismatchedEnd = `https://safe.test/safe%2Fboundary/${pathEncode('-----BEGIN RSA PRIVATE KEY-----MISMATCH_BODY_ß')}/${pathEncode('-----END PRIVATE KEY-----MISMATCH_AFTER_WRONG')}/MISMATCH_STILL_PRIVATE/${pathEncode('-----END RSA PRIVATE KEY-----VISIBLE_MATCHED')}${query(queryToken)}`;
  const nestedSameLabel = `https://safe.test/safe%2Fboundary/${pathEncode('-----BEGIN PRIVATE KEY-----OUTER_BODY')}/${pathEncode('-----BEGIN PRIVATE KEY-----INNER_BODY')}/${pathEncode('-----END PRIVATE KEY-----NESTED_OUTER_TAIL')}/OUTER_STILL_PRIVATE/${pathEncode('-----END PRIVATE KEY-----VISIBLE_NESTED')}${query(queryToken)}`;
  const sequential = `https://safe.test/safe%2Fboundary/${pathEncode('-----BEGIN EC PRIVATE KEY-----FIRST_BODY')}/${pathEncode('-----END EC PRIVATE KEY-----VISIBLE_FIRST')}/${pathEncode('-----BEGIN DSA PRIVATE KEY-----SECOND_BODY')}/${pathEncode('-----END DSA PRIVATE KEY-----VISIBLE_SECOND')}${query(queryToken)}`;
  const surrogate = `not a url/safe%2Fboundary/\uD800/SURROGATE_VISIBLE?safe=one&safe=two&${queryToken}%ZZ=ignored&\uD800=ignored#fragment-${queryToken}`;
  const cases = [
    { name: 'invalid-complete', url: invalidComplete, method: nestedMethod, valid: false, visible: [] },
    { name: 'invalid-truncated', url: invalidTruncated, method: mismatchedMethod, valid: false, visible: [] },
    { name: 'unicode-unclosed', url: unicodeUnclosed, method: unicodeUnclosedMethod, valid: true, visible: ['STRAY_VISIBLE'] },
    { name: 'unicode-complete', url: unicodeComplete, method: unicodeCompleteMethod, valid: true, visible: ['VISIBLE_UNICODE'] },
    { name: 'malformed-same', url: malformedSame, valid: true, visible: [] },
    { name: 'malformed-cross', url: malformedCross, valid: true, visible: [] },
    { name: 'mismatched-end', url: mismatchedEnd, valid: true, visible: ['VISIBLE_MATCHED'] },
    { name: 'nested-same-label', url: nestedSameLabel, valid: true, visible: ['VISIBLE_NESTED'] },
    { name: 'sequential', url: sequential, method: sequentialMethod, valid: true, visible: ['VISIBLE_FIRST', 'VISIBLE_SECOND'] },
    { name: 'surrogate', url: surrogate, valid: false, visible: [] }
  ];
  const forbidden = [
    queryToken,
    invalidAfterToken,
    '-----BEGIN',
    '-----END',
    'INVALID_COMPLETE_BODY',
    'INVALID_COMPLETE_TAIL_A',
    'INVALID_COMPLETE_TAIL_B',
    'INVALID_TRUNCATED_BODY',
    'INVALID_TRUNCATED_TAIL_A',
    'INVALID_TRUNCATED_TAIL_B',
    'UNICODE_UNCLOSED_BODY',
    'UNICODE_UNCLOSED_TAIL',
    'UNICODE_ß_BODY',
    'MALFORMED_SAME_SECRET',
    'MALFORMED_SAME_AFTER',
    'MALFORMED_CROSS_SECRET',
    'MALFORMED_CROSS_AFTER',
    'MISMATCH_BODY_ß',
    'MISMATCH_AFTER_WRONG',
    'MISMATCH_STILL_PRIVATE',
    'OUTER_BODY',
    'INNER_BODY',
    'NESTED_OUTER_TAIL',
    'OUTER_STILL_PRIVATE',
    'FIRST_BODY',
    'SECOND_BODY',
    'OUTER_METHOD_BODY',
    'INNER_METHOD_BODY',
    'METHOD_OUTER_TAIL_SECRET',
    'METHOD_RSA_BODY',
    'METHOD_MISMATCH_TAIL',
    'METHOD_UNICODE_UNCLOSED_BODY',
    'METHOD_UNICODE_ß_BODY',
    'METHOD_FIRST_BODY',
    'METHOD_SECOND_BODY',
    '\uD800',
    '\\ud800'
  ];
  const value = {
    log: {
      entries: cases.map(({ url, method }, index) => ({
        time: 1800 + index,
        request: { url, method: method || 'GET', headers: [] },
        response: { status: 500, bodySize: 10, headers: [], content: { mimeType: 'application/json' } }
      }))
    }
  };
  return { value, cases, forbidden, queryToken };
}

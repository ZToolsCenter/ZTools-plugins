/**
 * Elasticsearch _search request body JSON Schema (draft-07 style).
 * Covers common query / aggs / sort / highlight / knn shapes for editor
 * completion and validation. Not a full ES OpenAPI dump.
 */

export const SEARCH_BODY_SCHEMA_ID = 'es://_search/body'

const queryClause: Record<string, unknown> = {
  type: 'object',
  minProperties: 1,
  maxProperties: 1,
  additionalProperties: true,
  properties: {
    match_all: {
      type: 'object',
      properties: { boost: { type: 'number' } },
      additionalProperties: false,
    },
    match_none: { type: 'object', additionalProperties: false },
    match: { type: 'object', additionalProperties: true },
    match_phrase: { type: 'object', additionalProperties: true },
    match_phrase_prefix: { type: 'object', additionalProperties: true },
    multi_match: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        fields: { type: 'array', items: { type: 'string' } },
        type: {
          type: 'string',
          enum: [
            'best_fields',
            'most_fields',
            'cross_fields',
            'phrase',
            'phrase_prefix',
            'bool_prefix',
          ],
        },
        operator: { type: 'string', enum: ['and', 'or'] },
        fuzziness: {},
        boost: { type: 'number' },
      },
      additionalProperties: true,
    },
    term: { type: 'object', additionalProperties: true },
    terms: { type: 'object', additionalProperties: true },
    range: { type: 'object', additionalProperties: true },
    exists: {
      type: 'object',
      required: ['field'],
      properties: { field: { type: 'string' } },
      additionalProperties: false,
    },
    prefix: { type: 'object', additionalProperties: true },
    wildcard: { type: 'object', additionalProperties: true },
    regexp: { type: 'object', additionalProperties: true },
    fuzzy: { type: 'object', additionalProperties: true },
    ids: {
      type: 'object',
      properties: { values: { type: 'array', items: { type: 'string' } } },
      additionalProperties: true,
    },
    bool: {
      type: 'object',
      properties: {
        must: {
          oneOf: [{ $ref: '#/$defs/queryClause' }, { type: 'array', items: { $ref: '#/$defs/queryClause' } }],
        },
        filter: {
          oneOf: [{ $ref: '#/$defs/queryClause' }, { type: 'array', items: { $ref: '#/$defs/queryClause' } }],
        },
        should: {
          oneOf: [{ $ref: '#/$defs/queryClause' }, { type: 'array', items: { $ref: '#/$defs/queryClause' } }],
        },
        must_not: {
          oneOf: [{ $ref: '#/$defs/queryClause' }, { type: 'array', items: { $ref: '#/$defs/queryClause' } }],
        },
        minimum_should_match: { oneOf: [{ type: 'number' }, { type: 'string' }] },
        boost: { type: 'number' },
      },
      additionalProperties: true,
    },
    nested: {
      type: 'object',
      required: ['path', 'query'],
      properties: {
        path: { type: 'string' },
        query: { $ref: '#/$defs/queryClause' },
        score_mode: { type: 'string', enum: ['avg', 'sum', 'min', 'max', 'none'] },
        ignore_unmapped: { type: 'boolean' },
      },
      additionalProperties: true,
    },
    constant_score: {
      type: 'object',
      required: ['filter'],
      properties: {
        filter: { $ref: '#/$defs/queryClause' },
        boost: { type: 'number' },
      },
      additionalProperties: true,
    },
    dis_max: {
      type: 'object',
      properties: {
        queries: { type: 'array', items: { $ref: '#/$defs/queryClause' } },
        tie_breaker: { type: 'number' },
      },
      additionalProperties: true,
    },
    function_score: { type: 'object', additionalProperties: true },
    script: { type: 'object', additionalProperties: true },
    script_score: { type: 'object', additionalProperties: true },
    query_string: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        default_field: { type: 'string' },
        fields: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: true,
    },
    simple_query_string: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        fields: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: true,
    },
    geo_distance: { type: 'object', additionalProperties: true },
    geo_bounding_box: { type: 'object', additionalProperties: true },
    more_like_this: { type: 'object', additionalProperties: true },
    percolate: { type: 'object', additionalProperties: true },
    wrapper: { type: 'object', additionalProperties: true },
  },
}

const aggregation: Record<string, unknown> = {
  type: 'object',
  additionalProperties: {
    type: 'object',
    properties: {
      terms: { type: 'object', additionalProperties: true },
      date_histogram: { type: 'object', additionalProperties: true },
      histogram: { type: 'object', additionalProperties: true },
      range: { type: 'object', additionalProperties: true },
      filter: { $ref: '#/$defs/queryClause' },
      filters: { type: 'object', additionalProperties: true },
      nested: { type: 'object', additionalProperties: true },
      reverse_nested: { type: 'object', additionalProperties: true },
      avg: { type: 'object', additionalProperties: true },
      sum: { type: 'object', additionalProperties: true },
      min: { type: 'object', additionalProperties: true },
      max: { type: 'object', additionalProperties: true },
      cardinality: { type: 'object', additionalProperties: true },
      stats: { type: 'object', additionalProperties: true },
      extended_stats: { type: 'object', additionalProperties: true },
      value_count: { type: 'object', additionalProperties: true },
      top_hits: { type: 'object', additionalProperties: true },
      significant_terms: { type: 'object', additionalProperties: true },
      composite: { type: 'object', additionalProperties: true },
      aggs: { $ref: '#/$defs/aggregation' },
      aggregations: { $ref: '#/$defs/aggregation' },
    },
    additionalProperties: true,
  },
}

export const SEARCH_BODY_SCHEMA: Record<string, unknown> = {
  $id: SEARCH_BODY_SCHEMA_ID,
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Elasticsearch _search body',
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { $ref: '#/$defs/queryClause' },
    aggs: { $ref: '#/$defs/aggregation' },
    aggregations: { $ref: '#/$defs/aggregation' },
    sort: {
      oneOf: [
        { type: 'string' },
        { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] } },
        { type: 'object', additionalProperties: true },
      ],
    },
    size: { type: 'integer', minimum: 0 },
    from: { type: 'integer', minimum: 0 },
    _source: {
      oneOf: [
        { type: 'boolean' },
        { type: 'string' },
        { type: 'array', items: { type: 'string' } },
        {
          type: 'object',
          properties: {
            includes: { type: 'array', items: { type: 'string' } },
            excludes: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
      ],
    },
    highlight: {
      type: 'object',
      properties: {
        fields: { type: 'object', additionalProperties: true },
        pre_tags: { type: 'array', items: { type: 'string' } },
        post_tags: { type: 'array', items: { type: 'string' } },
        fragment_size: { type: 'integer' },
        number_of_fragments: { type: 'integer' },
      },
      additionalProperties: true,
    },
    post_filter: { $ref: '#/$defs/queryClause' },
    suggest: { type: 'object', additionalProperties: true },
    collapse: {
      type: 'object',
      required: ['field'],
      properties: {
        field: { type: 'string' },
        inner_hits: { type: 'object', additionalProperties: true },
        max_concurrent_group_searches: { type: 'integer' },
      },
      additionalProperties: true,
    },
    pit: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        keep_alive: { type: 'string' },
      },
      additionalProperties: true,
    },
    runtime_mappings: { type: 'object', additionalProperties: true },
    timeout: { type: 'string' },
    track_total_hits: { oneOf: [{ type: 'boolean' }, { type: 'integer' }] },
    version: { type: 'boolean' },
    seq_no_primary_term: { type: 'boolean' },
    stored_fields: {
      oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    },
    script_fields: { type: 'object', additionalProperties: true },
    docvalue_fields: {
      type: 'array',
      items: {
        oneOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: { field: { type: 'string' }, format: { type: 'string' } },
            additionalProperties: true,
          },
        ],
      },
    },
    fields: {
      type: 'array',
      items: {
        oneOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: { field: { type: 'string' }, format: { type: 'string' } },
            additionalProperties: true,
          },
        ],
      },
    },
    indices_boost: {
      oneOf: [
        { type: 'array', items: { type: 'object', additionalProperties: { type: 'number' } } },
        { type: 'object', additionalProperties: { type: 'number' } },
      ],
    },
    min_score: { type: 'number' },
    explain: { type: 'boolean' },
    profile: { type: 'boolean' },
    stats: { type: 'array', items: { type: 'string' } },
    search_after: { type: 'array' },
    slice: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        max: { type: 'integer' },
        field: { type: 'string' },
      },
      additionalProperties: true,
    },
    rescore: {
      oneOf: [
        { type: 'object', additionalProperties: true },
        { type: 'array', items: { type: 'object', additionalProperties: true } },
      ],
    },
    knn: {
      oneOf: [
        {
          type: 'object',
          required: ['field', 'query_vector', 'k', 'num_candidates'],
          properties: {
            field: { type: 'string' },
            query_vector: { type: 'array', items: { type: 'number' } },
            k: { type: 'integer' },
            num_candidates: { type: 'integer' },
            filter: { $ref: '#/$defs/queryClause' },
            boost: { type: 'number' },
          },
          additionalProperties: true,
        },
        {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
      ],
    },
    rank: { type: 'object', additionalProperties: true },
  },
  $defs: {
    queryClause,
    aggregation,
  },
}

/** Top-level property names for quick completion. */
export const SEARCH_BODY_TOP_KEYS = Object.keys(
  (SEARCH_BODY_SCHEMA.properties as Record<string, unknown>) || {},
)

/** Common query clause keys for completion. */
export const SEARCH_QUERY_KEYS = Object.keys(
  ((queryClause.properties as Record<string, unknown>) || {}),
)

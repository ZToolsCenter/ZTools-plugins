import type { AiApiType, AiServiceConfig } from '../types';
import { DEFAULT_AI_TIMEOUT_MS, fetchWithTimeout } from './network';

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RequestAiTextOptions {
  apiKey: string;
  apiType?: AiApiType;
  baseUrl: string;
  maxTokens?: number;
  messages: AiChatMessage[];
  model: string;
  signal?: AbortSignal;
  stream?: boolean;
  temperature?: number;
  timeoutMs?: number;
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function normalizeAiApiType(value?: string): AiApiType {
  return value === 'responses' ? 'responses' : 'chat_completions';
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = trimTrailingSlash(baseUrl);
  return /\/chat\/completions$/i.test(normalized)
    ? normalized
    : `${normalized}/chat/completions`;
}

export function buildResponsesUrl(baseUrl: string): string {
  const normalized = trimTrailingSlash(baseUrl);
  return /\/responses$/i.test(normalized)
    ? normalized
    : `${normalized}/responses`;
}

export function isAiServiceConfigured(service?: Partial<AiServiceConfig> | null): service is AiServiceConfig {
  return Boolean(
    service?.baseUrl?.trim()
    && service?.apiKey?.trim()
    && service?.model?.trim()
  );
}

function isJsonContentType(contentType: string): boolean {
  return /\bapplication\/([a-z0-9.+-]+\+)?json\b/i.test(contentType);
}

function truncate(value: string, maxLength = 240): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof value === 'object' && value !== null && 'getReader' in value;
}

async function readResponsePreview(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return truncate(text.replace(/\s+/g, ' ').trim());
}

function extractTextFromContentPart(part: unknown): string {
  if (typeof part === 'string') {
    return part;
  }
  if (!part || typeof part !== 'object') {
    return '';
  }

  const record = part as Record<string, unknown>;
  if (typeof record.text === 'string') {
    return record.text;
  }

  return '';
}

function extractChatCompletionText(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const choices = (data as { choices?: unknown[] }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }

  const firstChoice = choices[0] as Record<string, unknown>;
  const message = firstChoice.message as Record<string, unknown> | undefined;
  const content = message?.content ?? firstChoice.text;

  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map(extractTextFromContentPart)
      .join('')
      .trim();
  }

  return '';
}

function extractResponsesText(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const record = data as Record<string, unknown>;
  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text.trim();
  }

  const output = record.output;
  if (!Array.isArray(output)) {
    return '';
  }

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const message = item as Record<string, unknown>;
    if (message.type !== 'message' || !Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const partRecord = part as Record<string, unknown>;
      if (partRecord.type === 'output_text' && typeof partRecord.text === 'string') {
        chunks.push(partRecord.text);
      }
    }
  }

  return chunks.join('').trim();
}

function listObjectKeys(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }
  return Object.keys(value as Record<string, unknown>).slice(0, 8).join(', ');
}

function getContentPartTypes(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map(part => {
      if (!part || typeof part !== 'object') {
        return typeof part;
      }
      const record = part as Record<string, unknown>;
      return typeof record.type === 'string' ? record.type : 'object';
    })
    .filter((type): type is string => Boolean(type));
}

function diagnoseEmptyChatCompletion(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return 'The response body is not an object.';
  }

  const record = data as Record<string, unknown>;

  if (typeof record.output_text === 'string' || Array.isArray(record.output)) {
    return 'The response looks like the OpenAI Responses API format, not Chat Completions.';
  }

  const choices = record.choices;
  if (Array.isArray(choices)) {
    if (choices.length === 0) {
      return 'The service returned an empty choices array.';
    }

    const firstChoice = choices[0] as Record<string, unknown>;
    const message = firstChoice.message as Record<string, unknown> | undefined;
    const contentTypes = getContentPartTypes(message?.content);

    if (message?.tool_calls) {
      return 'The model returned tool calls instead of plain text.';
    }

    if (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()) {
      return 'The model returned reasoning_content without visible message content.';
    }

    if (typeof message?.refusal === 'string' && message.refusal.trim()) {
      return `The model returned a refusal: ${truncate(message.refusal.trim())}`;
    }

    if (contentTypes.length > 0) {
      return `The model returned non-text content parts: ${contentTypes.join(', ')}.`;
    }

    const finishReason = firstChoice.finish_reason;
    if (typeof finishReason === 'string' && finishReason.trim()) {
      return `The first choice finished with reason: ${finishReason.trim()}.`;
    }

    const choiceKeys = listObjectKeys(firstChoice);
    if (choiceKeys) {
      return `The first choice has keys: ${choiceKeys}.`;
    }
  }

  const topLevelKeys = listObjectKeys(record);
  return topLevelKeys
    ? `Top-level response keys: ${topLevelKeys}.`
    : 'The response shape is not recognized.';
}

function diagnoseEmptyResponses(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return 'The response body is not an object.';
  }

  const record = data as Record<string, unknown>;
  if (Array.isArray(record.output) && record.output.length === 0) {
    return 'The response output array is empty.';
  }

  if (Array.isArray(record.output)) {
    const firstItem = record.output[0];
    if (firstItem && typeof firstItem === 'object') {
      const keys = listObjectKeys(firstItem);
      if (keys) {
        return `The first output item has keys: ${keys}.`;
      }
    }
  }

  const topLevelKeys = listObjectKeys(record);
  return topLevelKeys
    ? `Top-level response keys: ${topLevelKeys}.`
    : 'The response shape is not recognized.';
}

async function readSseStream(
  response: Response,
  onEvent: (payload: unknown) => void,
): Promise<void> {
  if (!isReadableStream(response.body)) {
    throw new Error('Streaming response body is not readable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';

    for (const frame of frames) {
      const lines = frame
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim());

      for (const line of lines) {
        if (!line || line === '[DONE]') {
          continue;
        }

        try {
          onEvent(JSON.parse(line));
        } catch {
          // Ignore malformed intermediary events from non-standard proxies.
        }
      }
    }
  }
}

async function collectChatCompletionStream(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const preview = await readResponsePreview(response);
    throw new Error(
      `AI API stream request failed (${response.status} ${response.statusText})${preview ? `: ${preview}` : ''}`
    );
  }
  if (!/text\/event-stream/i.test(contentType)) {
    const preview = await readResponsePreview(response);
    throw new Error(
      `Unexpected AI stream response type: ${contentType || 'unknown'}.${preview ? ` Response preview: ${preview}` : ''}`
    );
  }

  const chunks: string[] = [];
  await readSseStream(response, (payload) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const record = payload as { choices?: Array<{ delta?: { content?: unknown } }> };
    const deltaContent = record.choices?.[0]?.delta?.content;

    if (typeof deltaContent === 'string') {
      chunks.push(deltaContent);
      return;
    }

    if (Array.isArray(deltaContent)) {
      for (const part of deltaContent) {
        if (part && typeof part === 'object') {
          const text = (part as Record<string, unknown>).text;
          if (typeof text === 'string') {
            chunks.push(text);
          }
        }
      }
    }
  });

  return chunks.join('').trim();
}

async function collectResponsesStream(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const preview = await readResponsePreview(response);
    throw new Error(
      `AI API stream request failed (${response.status} ${response.statusText})${preview ? `: ${preview}` : ''}`
    );
  }
  if (!/text\/event-stream/i.test(contentType)) {
    const preview = await readResponsePreview(response);
    throw new Error(
      `Unexpected AI stream response type: ${contentType || 'unknown'}.${preview ? ` Response preview: ${preview}` : ''}`
    );
  }

  const chunks: string[] = [];
  await readSseStream(response, (payload) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const record = payload as { type?: string; delta?: unknown; text?: unknown };
    if (record.type === 'response.output_text.delta' && typeof record.delta === 'string') {
      chunks.push(record.delta);
      return;
    }
    if (record.type === 'response.content_part.done' && typeof record.text === 'string') {
      chunks.push(record.text);
    }
  });

  return chunks.join('').trim();
}

async function parseJsonResponse(response: Response, expectedKind: 'Chat Completions' | 'Responses'): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    const preview = await readResponsePreview(response);
    throw new Error(
      `AI API request failed (${response.status} ${response.statusText})${preview ? `: ${preview}` : ''}`
    );
  }

  if (!isJsonContentType(contentType)) {
    const preview = await readResponsePreview(response);
    throw new Error(
      `Unexpected AI response type: ${contentType || 'unknown'}. Expected JSON from the ${expectedKind} API.${preview ? ` Response preview: ${preview}` : ''}`
    );
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`Invalid JSON response from AI API. Check the API base URL or reverse proxy configuration for the ${expectedKind} endpoint.`);
  }
}

function throwApiErrorIfPresent(data: unknown): void {
  const apiError =
    typeof data === 'object' && data
      ? (data as { error?: { message?: unknown }; message?: unknown })
      : undefined;

  if (typeof apiError?.error?.message === 'string' && apiError.error.message.trim()) {
    throw new Error(apiError.error.message.trim());
  }
  if (typeof apiError?.message === 'string' && apiError.message.trim()) {
    throw new Error(apiError.message.trim());
  }
}

export async function parseAiChatCompletionResponse(response: Response): Promise<string> {
  const data = await parseJsonResponse(response, 'Chat Completions');
  const content = extractChatCompletionText(data);
  if (content) {
    return content;
  }

  throwApiErrorIfPresent(data);
  throw new Error(
    `AI API returned no message content. ${diagnoseEmptyChatCompletion(data)} Check whether the selected URL and model support the OpenAI Chat Completions API.`
  );
}

export async function parseAiResponsesResponse(response: Response): Promise<string> {
  const data = await parseJsonResponse(response, 'Responses');
  const content = extractResponsesText(data);
  if (content) {
    return content;
  }

  throwApiErrorIfPresent(data);
  throw new Error(
    `AI API returned no visible output text. ${diagnoseEmptyResponses(data)} Check whether the selected URL and model support the Responses API.`
  );
}

export async function requestAiChatCompletion(options: RequestAiTextOptions): Promise<string> {
  const url = buildChatCompletionsUrl(options.baseUrl);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${options.apiKey}`,
  };
  const baseBody = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens,
    temperature: options.temperature,
  };
  if (options.stream ?? true) {
    const streamResponse = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...baseBody,
        stream: true,
      }),
      signal: options.signal,
    }, {
      timeoutMs: options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
    });
    const streamed = await collectChatCompletionStream(streamResponse);
    if (streamed) {
      return streamed;
    }
    throw new Error('AI API stream returned no message content.');
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(baseBody),
    signal: options.signal,
  }, {
    timeoutMs: options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
  });

  return await parseAiChatCompletionResponse(response);
}

export async function requestAiResponses(options: RequestAiTextOptions): Promise<string> {
  const instructions = options.messages
    .filter(message => message.role === 'system')
    .map(message => message.content.trim())
    .filter(Boolean)
    .join('\n\n');

  const input = options.messages
    .filter(message => message.role !== 'system')
    .map(message => ({
      role: message.role,
      content: [
        {
          type: 'input_text',
          text: message.content,
        },
      ],
    }));

  const url = buildResponsesUrl(options.baseUrl);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${options.apiKey}`,
  };
  const baseBody = {
    model: options.model,
    instructions: instructions || undefined,
    input,
    max_output_tokens: options.maxTokens,
    temperature: options.temperature,
  };
  if (options.stream ?? true) {
    const streamResponse = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...baseBody,
        stream: true,
      }),
      signal: options.signal,
    }, {
      timeoutMs: options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
    });
    const streamed = await collectResponsesStream(streamResponse);
    if (streamed) {
      return streamed;
    }
    throw new Error('AI API stream returned no visible output text.');
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(baseBody),
    signal: options.signal,
  }, {
    timeoutMs: options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
  });

  return await parseAiResponsesResponse(response);
}

export async function requestAiText(options: RequestAiTextOptions): Promise<string> {
  const apiType = normalizeAiApiType(options.apiType);
  if (apiType === 'responses') {
    return requestAiResponses(options);
  }
  return requestAiChatCompletion(options);
}

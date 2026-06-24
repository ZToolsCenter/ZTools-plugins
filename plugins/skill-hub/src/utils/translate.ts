import type { ModelConfig } from '../types'
import { chatCompletion } from './ai'

export type TranslationMode = 'immersive' | 'full'

function getTargetLang(): string {
  const lang = navigator.language || 'zh-CN'
  if (lang.startsWith('zh')) return '中文'
  if (lang.startsWith('ja')) return '日本語'
  if (lang.startsWith('ko')) return '한국어'
  return 'English'
}

const IMMERSIVE_SYSTEM_PROMPT = `You are a professional translator working on complete SKILL.md documents.

Return a valid SKILL.md document in {targetLang}.

Rules:
1. The input may begin with YAML frontmatter between --- delimiters. Preserve the delimiters, key order, and valid YAML syntax.
2. In frontmatter, do NOT insert <t>...</t> lines. Keep YAML keys unchanged. Translate only human-readable text values such as description when appropriate. Leave identifiers, slug-like names, versions, URLs, file paths, and code-like values unchanged.
3. After the frontmatter, translate the markdown body in immersive mode: for each heading, paragraph, or list block, output the original block first, then output the translated block wrapped in <t>...</t>.
4. Do NOT translate fenced code blocks, inline code, command names, file paths, URLs, or YAML keys.
5. Preserve markdown structure. Output only the final SKILL.md document with no commentary.

Example input:
---
name: write
description: Help users write better.
---

## Overview
This skill helps you write tests.

Example output:
---
name: write
description: 帮助用户更好地写作。
---

## Overview
<t>## 概述</t>
This skill helps you write tests.
<t>此技能帮助你编写测试。</t>`

const FULL_SYSTEM_PROMPT = `You are a professional translator working on complete SKILL.md documents.

Return a valid translated SKILL.md document in {targetLang}.

Rules:
1. Preserve YAML frontmatter delimiters, key order, and valid YAML syntax.
2. Keep YAML keys unchanged. Translate human-readable text values such as description when appropriate, but leave identifiers, slug-like names, versions, URLs, file paths, and code-like values unchanged.
3. Translate the markdown body fully while preserving markdown structure.
4. Do NOT translate fenced code blocks, inline code, command names, file paths, URLs, or YAML keys.
5. Output only the translated SKILL.md document with no commentary.`

const DESCRIPTION_SYSTEM_PROMPT = `You are a professional translator for skill descriptions.

Your task: Translate the description to {targetLang}, BUT only if it's written in a foreign language.

Rules:
1. If the text is already in {targetLang} or contains significant {targetLang} content (mixed language), return it EXACTLY as-is without any translation.
2. Only translate pure foreign language text (e.g., pure English text when target is Chinese).
3. Keep technical terms, code snippets, identifiers, URLs, and file paths unchanged.
4. Return ONLY the translated text or original text, no explanations.
5. If unsure whether to translate, return the original text as-is.`

export interface ImmersiveSegment {
  type: 'original' | 'translation'
  text: string
}

export function stripFrontmatter(content: string): string {
  const trimmed = content.trim()
  if (!trimmed.startsWith('---')) return trimmed
  const endIdx = trimmed.indexOf('---', 3)
  if (endIdx === -1) return trimmed
  return trimmed.slice(endIdx + 3).trim()
}

export function renderImmersiveSegments(content: string): ImmersiveSegment[] {
  const segments: ImmersiveSegment[] = []
  const regex = /<t>([\s\S]*?)<\/t>/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'original', text: content.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'translation', text: match[1] })
    lastIndex = regex.lastIndex
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'original', text: content.slice(lastIndex) })
  }

  if (!segments.length) {
    segments.push({ type: 'original', text: content })
  }

  return segments
}

export async function translateContent(
  content: string,
  model: ModelConfig,
  mode: TranslationMode,
  targetLang?: string,
): Promise<string> {
  const lang = targetLang || getTargetLang()
  const systemPrompt = (mode === 'immersive' ? IMMERSIVE_SYSTEM_PROMPT : FULL_SYSTEM_PROMPT).replace('{targetLang}', lang)

  const result = await chatCompletion(
    model,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
    { temperature: 0.3, maxTokens: 8192 },
  )

  return result.content
}

export async function translateDescription(
  description: string,
  model: ModelConfig,
  targetLang?: string,
): Promise<string> {
  const lang = targetLang || getTargetLang()
  const systemPrompt = DESCRIPTION_SYSTEM_PROMPT.replace(/{targetLang}/g, lang)

  const result = await chatCompletion(
    model,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: description },
    ],
    { temperature: 0.3, maxTokens: 1024 },
  )

  return result.content
}

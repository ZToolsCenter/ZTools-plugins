import type { Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export function editorHighlightExtension(dark: boolean): Extension {
  return syntaxHighlighting(HighlightStyle.define([
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: dark ? '#c792ea' : '#7c3aed' },
    { tag: [tags.string, tags.regexp], color: dark ? '#a5d6a7' : '#0f766e' },
    { tag: tags.number, color: dark ? '#f78c6c' : '#c2410c' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: dark ? '#7f8c98' : '#64748b', fontStyle: 'italic' },
    { tag: [tags.typeName, tags.className], color: dark ? '#82aaff' : '#1d4ed8' },
    { tag: [tags.propertyName, tags.labelName], color: dark ? '#f0c674' : '#a16207' },
    { tag: tags.variableName, color: dark ? '#d7dee8' : '#263241' },
    { tag: [tags.operator, tags.punctuation], color: dark ? '#89ddff' : '#0369a1' },
    { tag: [tags.bool, tags.atom, tags.meta], color: dark ? '#ffcb6b' : '#b45309' },
    { tag: tags.invalid, color: dark ? '#ff5370' : '#dc2626' },
  ]), { fallback: true });
}

import {
  BUILTIN_PERSONAS,
  DEFAULT_PERSONA,
} from "./builtins";
import type { AgentPersona } from "./types";

export type { AgentPersona } from "./types";
export type { Persona } from "./builtins";
export {
  BUILTIN_PERSONAS,
  DEFAULT_PERSONA,
  DEFAULT_PERSONA_ID,
  getBuiltinPersona,
  listBuiltinPersonas,
} from "./builtins";

/**
 * 按选中 id 解析角色：先自定义再内置；未知回落默认。
 */
export function resolvePersona(
  selectedId: string | null | undefined,
  customPersonas: readonly AgentPersona[] = [],
): AgentPersona {
  const id = selectedId?.trim();
  if (id) {
    const custom = customPersonas.find((p) => p.id === id);
    if (custom) return custom;
    const builtin = BUILTIN_PERSONAS.find((p) => p.id === id);
    if (builtin) return builtin;
  }
  return DEFAULT_PERSONA;
}

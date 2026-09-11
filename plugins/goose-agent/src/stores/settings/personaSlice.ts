import {
  BUILTIN_PERSONAS,
  DEFAULT_PERSONA_ID,
  type AgentPersona,
} from "@/lib/agent/persona";

// re-export for callers that import from slice
export type { AgentPersona };

export interface PersonaSettings {
  selectedPersonaId: string;
  customPersonas: AgentPersona[];
}

export interface PersonaSliceState {
  persona: PersonaSettings;
}

export interface PersonaSliceActions {
  setSelectedPersonaId: (id: string) => void;
  addCustomPersona: (persona: Omit<AgentPersona, "id" | "isBuiltin">) => string;
  updateCustomPersona: (
    id: string,
    patch: Partial<Pick<AgentPersona, "name" | "systemSnippet">>,
  ) => void;
  removeCustomPersona: (id: string) => void;
}

export type PersonaSlice = PersonaSliceState & PersonaSliceActions;

export const PERSONA_INITIAL_STATE: PersonaSliceState = {
  persona: {
    selectedPersonaId: DEFAULT_PERSONA_ID,
    customPersonas: [],
  },
};

function newCustomId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeCustomPersonas(
  list: AgentPersona[] | undefined,
): AgentPersona[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (p): p is AgentPersona =>
        Boolean(p && typeof p === "object") &&
        typeof p.id === "string" &&
        p.id.trim().length > 0 &&
        typeof p.name === "string" &&
        typeof p.systemSnippet === "string" &&
        p.isBuiltin !== true,
    )
    .map((p) => ({
      id: p.id.trim(),
      name: p.name.trim() || "未命名角色",
      isBuiltin: false,
      systemSnippet: p.systemSnippet,
    }));
}

export function normalizePersonaSettings(
  raw: Partial<PersonaSettings> | undefined,
): PersonaSettings {
  const customPersonas = normalizeCustomPersonas(raw?.customPersonas);
  const selected =
    typeof raw?.selectedPersonaId === "string" && raw.selectedPersonaId.trim()
      ? raw.selectedPersonaId.trim()
      : DEFAULT_PERSONA_ID;
  const known =
    BUILTIN_PERSONAS.some((p) => p.id === selected) ||
    customPersonas.some((p) => p.id === selected);
  return {
    selectedPersonaId: known ? selected : DEFAULT_PERSONA_ID,
    customPersonas,
  };
}

type SetFn = (
  updater:
    | Partial<PersonaSlice>
    | ((state: PersonaSlice) => Partial<PersonaSlice>),
) => void;

export function createPersonaSlice(set: SetFn): PersonaSlice {
  return {
    ...PERSONA_INITIAL_STATE,
    setSelectedPersonaId: (id) =>
      set((state) => {
        const known =
          BUILTIN_PERSONAS.some((p) => p.id === id) ||
          state.persona.customPersonas.some((p) => p.id === id);
        if (!known) return {};
        return {
          persona: { ...state.persona, selectedPersonaId: id },
        };
      }),
    addCustomPersona: ({ name, systemSnippet }) => {
      const id = newCustomId();
      const persona: AgentPersona = {
        id,
        name: name.trim() || "未命名角色",
        isBuiltin: false,
        systemSnippet: systemSnippet ?? "",
      };
      set((state) => ({
        persona: {
          ...state.persona,
          customPersonas: [...state.persona.customPersonas, persona],
          selectedPersonaId: id,
        },
      }));
      return id;
    },
    updateCustomPersona: (id, patch) =>
      set((state) => {
        const customPersonas = state.persona.customPersonas.map((p) => {
          if (p.id !== id || p.isBuiltin) return p;
          return {
            ...p,
            name:
              typeof patch.name === "string"
                ? patch.name.trim() || p.name
                : p.name,
            systemSnippet:
              typeof patch.systemSnippet === "string"
                ? patch.systemSnippet
                : p.systemSnippet,
          };
        });
        return { persona: { ...state.persona, customPersonas } };
      }),
    removeCustomPersona: (id) =>
      set((state) => {
        const customPersonas = state.persona.customPersonas.filter(
          (p) => p.id !== id,
        );
        const selectedPersonaId =
          state.persona.selectedPersonaId === id
            ? DEFAULT_PERSONA_ID
            : state.persona.selectedPersonaId;
        return {
          persona: { ...state.persona, customPersonas, selectedPersonaId },
        };
      }),
  };
}

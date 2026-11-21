import { useCallback, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AiEditProposal } from "../../types/aiEditing";
import type { MarkdownAiChunk } from "./markdownChunker";

interface FailureArtifacts {
  timer: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  buffer: MutableRefObject<string>;
  protection: MutableRefObject<MarkdownAiChunk | undefined>;
  setStreaming: Dispatch<SetStateAction<string>>;
  setResult: Dispatch<SetStateAction<string>>;
  setProposal: Dispatch<SetStateAction<AiEditProposal | null>>;
  setNotice: Dispatch<SetStateAction<string>>;
}

export const useAiFailureState = (artifacts: FailureArtifacts) => {
  const [error, setError] = useState("");
  const artifactsRef = useRef(artifacts);
  artifactsRef.current = artifacts;
  const clearError = useCallback(() => setError(""), []);
  const fail = useCallback((message: string) => {
    const current = artifactsRef.current;
    if (current.timer.current) clearTimeout(current.timer.current);
    current.timer.current = null;
    current.buffer.current = "";
    current.protection.current = undefined;
    current.setStreaming("");
    current.setResult("");
    current.setProposal(null);
    current.setNotice("");
    setError(message);
  }, []);
  return { error, fail, clearError };
};

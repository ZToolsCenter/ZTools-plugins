export type CommitMessageByProject = Record<string, string>;

/***********************AI 提交信息目标写回*********************/

export function applyGeneratedCommitMessage(
  commitMessages: CommitMessageByProject,
  targetProjectId: string,
  generatedMessage: string,
): boolean {
  if (!generatedMessage.trim()) {
    return false;
  }

  commitMessages[targetProjectId] = generatedMessage;
  return true;
}

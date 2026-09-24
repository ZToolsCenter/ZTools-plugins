export interface GitImageRequestIdentity {
  projectId: string;
  projectPath: string;
  source: string;
  staged: boolean;
  file: string;
  oldPath: string;
}

/** A result may update the view only while both request id and selection match. */
export function isCurrentGitImageRequest(
  requestId: number,
  activeRequestId: number,
  expected: GitImageRequestIdentity,
  current: GitImageRequestIdentity,
): boolean {
  return requestId === activeRequestId
    && expected.projectId === current.projectId
    && expected.projectPath === current.projectPath
    && expected.source === current.source
    && expected.staged === current.staged
    && expected.file === current.file
    && expected.oldPath === current.oldPath;
}

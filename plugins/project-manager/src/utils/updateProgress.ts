export type UpdateDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

export type UpdateProgressPhase = 'downloading' | 'verifying' | 'installing';

export interface UpdateProgressState {
  downloaded: number;
  total?: number;
  percentage: number;
  indeterminate: boolean;
  phase: UpdateProgressPhase;
}

export const INITIAL_UPDATE_PROGRESS: UpdateProgressState = {
  downloaded: 0,
  percentage: 0,
  indeterminate: false,
  phase: 'downloading',
};

export function reduceUpdateProgress(
  state: UpdateProgressState,
  event: UpdateDownloadEvent,
): UpdateProgressState {
  if (event.event === 'Started') {
    const total = event.data.contentLength;
    return {
      downloaded: 0,
      total,
      percentage: 0,
      indeterminate: !total,
      phase: 'downloading',
    };
  }

  if (event.event === 'Progress') {
    const downloaded = state.downloaded + event.data.chunkLength;
    const percentage = state.total
      ? Math.min(99, Math.floor((downloaded / state.total) * 100))
      : state.percentage;

    return {
      ...state,
      downloaded,
      percentage,
    };
  }

  return {
    ...state,
    percentage: 100,
    indeterminate: false,
    phase: 'verifying',
  };
}

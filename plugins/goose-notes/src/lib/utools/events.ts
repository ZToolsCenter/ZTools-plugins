export const EVENTS = {
  PLUGIN_ENTER: "goose-note:plugin-enter",
  PLUGIN_OUT: "goose-note:plugin-out",
  SUBLIST_ENTER: "goose-note:sublist-enter",
  OPEN_PAGE: "goose-note:open-page",
  OPEN_SEARCH: "goose-note:open-search",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

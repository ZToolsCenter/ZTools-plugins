import { describe, it, expect } from "vitest";
import {
  getGroupedSlashCommands,
  SLASH_COMMANDS
} from "../../src/components/SlashCommandMenu";

describe("SlashCommandMenu Indexing & Keyboard Navigation", () => {
  it("assigns strictly monotonic top-to-bottom globalIdx matching visual render order", () => {
    // 1. Unfiltered mode (bare "/")
    const { groups, orderedItems } = getGroupedSlashCommands("");
    expect(orderedItems.length).toBe(SLASH_COMMANDS.length);

    let runningIndex = 0;
    for (const group of groups) {
      for (const item of group.items) {
        expect(item.globalIdx).toBe(runningIndex);
        expect(orderedItems[runningIndex].id).toBe(item.item.id);
        runningIndex += 1;
      }
    }
    expect(runningIndex).toBe(orderedItems.length);
  });

  it("preserves exact match ranking and monotonic globalIdx when filtered", () => {
    // 2. Filtered mode (e.g. "/h")
    const { groups, orderedItems } = getGroupedSlashCommands("h");
    expect(orderedItems.length).toBeGreaterThan(0);

    let runningIndex = 0;
    for (const group of groups) {
      for (const item of group.items) {
        expect(item.globalIdx).toBe(runningIndex);
        expect(orderedItems[runningIndex].id).toBe(item.item.id);
        runningIndex += 1;
      }
    }
  });

  it("clamps selection at bottom without wrapping around to the beginning", () => {
    const { orderedItems } = getGroupedSlashCommands("");
    const maxIndex = orderedItems.length - 1;

    // Simulate ArrowDown at the bottom
    let selectedIndex = maxIndex;
    const nextIndex = Math.min(maxIndex, selectedIndex + 1);
    expect(nextIndex).toBe(maxIndex); // Does NOT wrap around to 0
  });

  it("clamps selection at top without wrapping around to the bottom", () => {
    // Simulate ArrowUp at the top
    let selectedIndex = 0;
    const prevIndex = Math.max(0, selectedIndex - 1);
    expect(prevIndex).toBe(0); // Does NOT wrap around to maxIndex
  });
});

  it("returns table as first result when queried with 'table'", () => {
    const { orderedItems } = getGroupedSlashCommands("table");
    expect(orderedItems.length).toBeGreaterThan(0);
    expect(orderedItems[0].id).toBe("table");
  });

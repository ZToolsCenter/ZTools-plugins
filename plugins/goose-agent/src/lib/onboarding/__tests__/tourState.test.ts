/**
 * 真实 tourState 路径：localStorage ga:tour ↔ phase / auto-start / reset
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getTourPhase,
  markTourFinished,
  resetOnboardingTour,
  setTourPhase,
  shouldAutoStartTour,
  TOUR_STORAGE_KEY,
} from "../tourState";
import { STORAGE_PREFIX } from "@/lib/storage";

const PHYSICAL = `${STORAGE_PREFIX}${TOUR_STORAGE_KEY}`;

describe("tourState (shipped helpers)", () => {
  beforeEach(() => {
    localStorage.removeItem(PHYSICAL);
  });

  afterEach(() => {
    localStorage.removeItem(PHYSICAL);
  });

  it("defaults to pending and allows auto-start", () => {
    expect(getTourPhase()).toBe("pending");
    expect(shouldAutoStartTour()).toBe(true);
  });

  it("mark finished (done) disables auto-start", () => {
    markTourFinished({ completed: true });
    expect(getTourPhase()).toBe("done");
    expect(shouldAutoStartTour()).toBe(false);
    expect(localStorage.getItem(PHYSICAL)).toContain("done");
  });

  it("mark finished (skipped) disables auto-start", () => {
    markTourFinished({ completed: false });
    expect(getTourPhase()).toBe("skipped");
    expect(shouldAutoStartTour()).toBe(false);
  });

  it("resetOnboardingTour restores pending + auto-start after done", () => {
    setTourPhase("done");
    expect(shouldAutoStartTour()).toBe(false);

    resetOnboardingTour();

    expect(getTourPhase()).toBe("pending");
    expect(shouldAutoStartTour()).toBe(true);
    const raw = localStorage.getItem(PHYSICAL);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).phase).toBe("pending");
  });

  it("resetOnboardingTour restores after skipped", () => {
    markTourFinished({ completed: false });
    resetOnboardingTour();
    expect(getTourPhase()).toBe("pending");
    expect(shouldAutoStartTour()).toBe(true);
  });
});

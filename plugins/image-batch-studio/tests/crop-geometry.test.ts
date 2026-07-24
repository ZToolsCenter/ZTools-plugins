import { describe, expect, it } from "vitest";
import {
  containedImageRect,
  cropBoxStyle,
  cropFromDragPoints,
  pointToImageCoordinates
} from "../src/ui/crop-geometry";

describe("manual crop geometry", () => {
  it("maps pointer coordinates through the actual contained image area", () => {
    const imageRect = containedImageRect(
      { left: 0, top: 0, width: 400, height: 400 },
      { width: 800, height: 200 }
    );

    expect(imageRect).toEqual({ left: 0, top: 150, width: 400, height: 100 });
    expect(pointToImageCoordinates({ x: 200, y: 200 }, imageRect, { width: 800, height: 200 })).toEqual({
      x: 400,
      y: 100
    });
    expect(pointToImageCoordinates({ x: 200, y: 120 }, imageRect, { width: 800, height: 200 })).toEqual({
      x: 400,
      y: 0
    });
  });

  it("positions crop overlay on the rendered bitmap instead of the stage frame", () => {
    const stageRect = { left: 40, top: 20, width: 400, height: 400 };
    const imageRect = containedImageRect(stageRect, { width: 800, height: 200 });

    expect(cropBoxStyle({ left: 0, top: 0, width: 800, height: 200 }, stageRect, imageRect, { width: 800, height: 200 })).toEqual({
      left: "0px",
      top: "150px",
      width: "400px",
      height: "100px"
    });
  });

  it("keeps tiny drags inside image bounds", () => {
    expect(cropFromDragPoints({ x: 640, y: 480 }, { x: 640, y: 480 }, { width: 640, height: 480 })).toEqual({
      left: 639,
      top: 479,
      width: 1,
      height: 1
    });
  });
});

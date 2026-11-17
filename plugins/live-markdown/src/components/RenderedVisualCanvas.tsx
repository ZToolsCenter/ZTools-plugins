import { useLayoutEffect, useRef } from "react";
import { RenderedVisual } from "./renderedVisualSnapshot";

export function RenderedVisualCanvas({ visual, scale }: { visual: RenderedVisual; scale: number }) {
  const mount = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = mount.current!;
    element.replaceChildren(visual.node);
    return () => element.replaceChildren();
  }, [visual]);
  return <div className="ty-rendered-visual-frame" style={{ width: visual.width * scale, height: visual.height * scale, background: visual.background }}>
    <div ref={mount} className="ty-rendered-visual-content" aria-hidden="true"
      style={{ width: visual.width, height: visual.height, transform: `scale(${scale})` }} />
  </div>;
}

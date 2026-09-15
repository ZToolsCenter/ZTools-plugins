import { useId, type SVGProps } from "react";
import { cn } from "@/lib/utils";
import type { AiActivityPhase } from "@/stores/useAiStatus";

interface AiGradientIconProps extends SVGProps<SVGSVGElement> {
  state?: AiActivityPhase;
}

export function AiGradientIcon({
  className,
  state = "idle",
  ...props
}: AiGradientIconProps) {
  const gradientId = useId();
  const accentGradientId = useId();
  const flashGradientId = useId();
  const streaming = state === "streaming";
  const done = state === "done";

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 ai-icon", className)}
      data-ai-state={state}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="4"
          y1="3"
          x2="20"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#95F3D8">
            {streaming && (
              <animate
                attributeName="stop-color"
                values="#95F3D8;#63D7FF;#9F86FF;#FFD66E;#95F3D8"
                dur="2.6s"
                repeatCount="indefinite"
              />
            )}
          </stop>
          <stop offset="48%" stopColor="#63D7FF">
            {streaming && (
              <animate
                attributeName="stop-color"
                values="#63D7FF;#9F86FF;#FFD66E;#95F3D8;#63D7FF"
                dur="2.6s"
                repeatCount="indefinite"
              />
            )}
          </stop>
          <stop offset="100%" stopColor="#FFD66E">
            {streaming && (
              <animate
                attributeName="stop-color"
                values="#FFD66E;#95F3D8;#63D7FF;#9F86FF;#FFD66E"
                dur="2.6s"
                repeatCount="indefinite"
              />
            )}
          </stop>
        </linearGradient>
        <linearGradient
          id={accentGradientId}
          x1="18"
          y1="2"
          x2="6"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FFF2B8">
            {streaming && (
              <animate
                attributeName="stop-color"
                values="#FFF2B8;#6BE8FF;#FFB3DA;#FFF2B8"
                dur="1.9s"
                repeatCount="indefinite"
              />
            )}
          </stop>
          <stop offset="100%" stopColor="#6BE8FF">
            {streaming && (
              <animate
                attributeName="stop-color"
                values="#6BE8FF;#FFB3DA;#FFF2B8;#6BE8FF"
                dur="1.9s"
                repeatCount="indefinite"
              />
            )}
          </stop>
        </linearGradient>
        <radialGradient id={flashGradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#FFE9A8" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#9DE8FF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {done && (
        <circle
          className="ai-icon-flash"
          cx="12"
          cy="12"
          r="11"
          fill={`url(#${flashGradientId})`}
        />
      )}

      <g className="ai-icon-glyph">
        <path
          d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"
          stroke={`url(#${gradientId})`}
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M20 2v4"
          stroke={`url(#${accentGradientId})`}
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <path
          d="M22 4h-4"
          stroke={`url(#${accentGradientId})`}
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <circle
          cx="4"
          cy="20"
          r="1.9"
          stroke={`url(#${accentGradientId})`}
          strokeWidth="1.6"
        />
      </g>
    </svg>
  );
}

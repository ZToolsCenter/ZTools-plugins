import * as THREE from "three";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, RoundedBox, ContactShadows } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Board, Move, Player, BLACK, idx } from "@/lib/gomoku/types";
import type { ViewMode } from "@/hooks/useViewMode";

const SPACING = 1;
const HALF = (15 - 1) / 2; // 7
const PLANE = 16;
const STONE_RADIUS = 0.42;
const STONE_FLAT = 0.45;
/** Resting centre height of a placed stone (fx-spec §0.4). */
const REST_Y = STONE_RADIUS * STONE_FLAT; // 0.189

const BLACK_COLOR = "#16161a";
const WHITE_COLOR = "#f4f4f5";
const BOARD_COLOR = "#e9cfa3";
const GUIDE_COLOR = "#f97316";
/** fx-spec §0.3: wood-toned dust ripple, darker than the board. */
const DUST_COLOR = "#b78a54";
const STAR_POINTS: ReadonlyArray<[number, number]> = [
  [3, 3],
  [3, 11],
  [11, 3],
  [11, 11],
  [7, 7],
];

/** fx-spec §5.3: victory / draw dim targets, pre-parsed once. */
const C_BASE_BLACK = new THREE.Color(BLACK_COLOR);
const C_BASE_WHITE = new THREE.Color(WHITE_COLOR);
const C_DIM_BLACK = new THREE.Color("#0b0b0d");
const C_DIM_WHITE = new THREE.Color("#a8a29e");

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// fx-spec §0.1 easing library (module-level pure functions)
// ---------------------------------------------------------------------------

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
/** Overshoot rebound; larger c1 = higher overshoot. */
const easeOutBack = (t: number, c1: number) => {
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------------
// fx-spec §0.2: single reduced-motion entry point for the whole scene.
// Module-level constant — every effect below reads this one flag.
// ---------------------------------------------------------------------------

const REDUCED =
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function gridToWorld(x: number, y: number): [number, number, number] {
  return [(x - HALF) * SPACING, 0, (y - HALF) * SPACING];
}

function worldToGrid(p: THREE.Vector3): Move | null {
  const gx = Math.round(p.x / SPACING + HALF);
  const gy = Math.round(p.z / SPACING + HALF);
  if (gx < 0 || gx > 14 || gy < 0 || gy > 14) return null;
  const [wx, , wz] = gridToWorld(gx, gy);
  if (Math.hypot(p.x - wx, p.z - wz) > 0.5) return null;
  return { x: gx, y: gy };
}

function stoneColor(player: Player): string {
  return player === BLACK ? BLACK_COLOR : WHITE_COLOR;
}

/**
 * fx-spec §1.3 touch-down squash, applied to the Y scale only (3D view).
 * 120–170ms: 1.0 → 0.84; 170ms → D: 0.84 → 1.0; flat 1.0 elsewhere.
 */
function squashFactor(tSec: number, dSec: number): number {
  const tms = tSec * 1000;
  if (tms < 120) return 1;
  if (tms < 170) return 1 - 0.16 * easeOutQuad((tms - 120) / 50);
  const dms = dSec * 1000;
  if (tms < dms) return 0.84 + 0.16 * easeOutQuad((tms - 170) / (dms - 170));
  return 1;
}

/**
 * A single stone.
 *
 * fx-spec §1 (drop / bounce entrance), §5.1 (win-line travelling shimmer),
 * §5.2 (win-line hop, or XZ pulse in 2D) and §5.3 (dimming) all share this one
 * `useFrame` callback. When nothing is animating the callback early-returns
 * (§1.1 perf guard) so a full 225-stone board costs nothing per frame.
 */
function Stone({
  x,
  y,
  player,
  highlight,
  entrance,
  viewMode,
  winIndex,
  dimK,
  dimMs,
}: {
  x: number;
  y: number;
  player: Player;
  highlight?: boolean;
  /** "bounce" = the freshly played stone; "pop" = bulk (re)mount. */
  entrance: "bounce" | "pop";
  viewMode: ViewMode;
  /** 0–4 position along the winning line; undefined = not a winning stone. */
  winIndex?: number;
  /** Target dim amount: 0 none, 0.5 draw, 1 victory (non-winning stones). */
  dimK: number;
  dimMs: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const t = useRef(0);
  const settled = useRef(false);
  const dimP = useRef(0);
  const igniteAt = useRef<number | null>(null);
  // Frozen at mount: a later lastMove change must not restart / swap the
  // entrance animation of an already-placed stone.
  const mode = useRef<"bounce" | "pop">(
    entrance === "bounce" && !REDUCED ? "bounce" : "pop"
  ).current;

  const [wx, , wz] = gridToWorld(x, y);
  const color = stoneColor(player);
  const baseColor = player === BLACK ? C_BASE_BLACK : C_BASE_WHITE;
  const dimColor = player === BLACK ? C_DIM_BLACK : C_DIM_WHITE;
  // §1.2 black is heavier / slower, white lighter / snappier.
  const dur = player === BLACK ? 0.28 : 0.23;
  const c1 = player === BLACK ? 1.4 : 1.95;

  useFrame(({ clock }, delta) => {
    const mesh = ref.current;
    if (!mesh) return;

    const wi = winIndex;
    const waveOn = wi !== undefined && !REDUCED;
    const dimOn = dimK > 0 && dimP.current < 1;
    const entranceOn = !settled.current;
    // §1.1 performance guard: fully settled, non-winning, non-dimming stones
    // do zero work per frame.
    if (!waveOn && !dimOn && !entranceOn) return;

    if (entranceOn) {
      t.current += delta;
      if (mode === "pop") {
        // §1.5 / §8.3-1 degraded + bulk-mount path: 160ms easeOutCubic.
        const p = Math.min(1, t.current / 0.16);
        const e = easeOutCubic(p);
        mesh.scale.set(e, e * STONE_FLAT, e);
        mesh.position.y = REST_Y;
        if (p >= 1) {
          mesh.scale.set(1, STONE_FLAT, 1);
          settled.current = true;
        }
      } else {
        const p = Math.min(1, t.current / dur);
        const s = easeOutBack(p, c1);
        // §8.4-1: the Y drop and the touch-down squash are invisible from the
        // locked top-down camera, so 2D runs the XZ overshoot only.
        const is3d = viewMode === "3d";
        const sq = is3d ? squashFactor(t.current, dur) : 1;
        mesh.scale.set(s, s * STONE_FLAT * sq, s);
        mesh.position.y = is3d
          ? REST_Y + 0.55 * (1 - easeOutCubic(Math.min(1, (t.current * 1000) / 120)))
          : REST_Y;
        if (p >= 1) {
          mesh.scale.set(1, STONE_FLAT, 1);
          mesh.position.y = REST_Y;
          settled.current = true;
        }
      }
    }

    if (dimOn) {
      // §5.3 stock-based interpolation (never accumulate frame-rate dependent
      // lerps). §8.3-5c: reduced motion applies the same end state instantly.
      dimP.current = REDUCED
        ? 1
        : Math.min(1, dimP.current + (delta * 1000) / dimMs);
      const m = matRef.current;
      if (m) m.color.lerpColors(baseColor, dimColor, dimK * easeOutQuad(dimP.current));
    }

    if (waveOn && wi !== undefined) {
      const tms = clock.elapsedTime * 1000;
      if (igniteAt.current === null) igniteAt.current = tms;
      // §5.1 one-shot ignition order: stone i only lights up after i*120ms.
      const w =
        tms - igniteAt.current >= wi * 120
          ? Math.max(0, Math.sin((TAU * (tms - wi * 216)) / 1800))
          : 0;
      const m = matRef.current;
      if (m) m.emissiveIntensity = 0.25 + 0.85 * w * w * w;
      // Transform is only taken over once the entrance finished, so the two
      // animations never fight over scale/position.
      if (settled.current) {
        if (viewMode === "3d") {
          // §5.2 3D: hop.
          mesh.position.y = REST_Y + 0.35 * w * w;
          mesh.scale.set(1, STONE_FLAT, 1);
        } else {
          // §5.2 / §8.4-5b 2D substitute: in-phase XZ scale pulse to 112%.
          const s = 1 + 0.12 * w * w;
          mesh.position.y = REST_Y;
          mesh.scale.set(s, STONE_FLAT, s);
        }
      }
    }
  });

  const isWinStone = winIndex !== undefined;

  return (
    <mesh
      ref={ref}
      position={[wx, REST_Y, wz]}
      castShadow
      receiveShadow
      scale={[0, 0, 0]}
    >
      <sphereGeometry args={[STONE_RADIUS, 40, 28]} />
      <meshStandardMaterial
        ref={matRef}
        color={color}
        roughness={player === BLACK ? 0.32 : 0.45}
        metalness={0.15}
        emissive={isWinStone || highlight ? GUIDE_COLOR : "#000000"}
        emissiveIntensity={
          // §8.3-5a: reduced motion holds the winning five at a static 0.6.
          isWinStone ? (REDUCED ? 0.6 : 0.25) : highlight ? 0.35 : 0
        }
      />
    </mesh>
  );
}

function GridLines() {
  const lines = useMemo(() => {
    const arr: { pos: [number, number, number]; size: [number, number, number] }[] =
      [];
    for (let g = 0; g < 15; g++) {
      const w = (g - HALF) * SPACING;
      // vertical
      arr.push({ pos: [w, 0.012, 0], size: [0.025, 0.02, PLANE - 2] });
      // horizontal
      arr.push({ pos: [0, 0.012, w], size: [PLANE - 2, 0.02, 0.025] });
    }
    return arr;
  }, []);

  return (
    <group>
      {lines.map((l, i) => (
        <mesh key={i} position={l.pos}>
          <boxGeometry args={l.size} />
          <meshStandardMaterial color="#5b4632" roughness={0.8} />
        </mesh>
      ))}
      {STAR_POINTS.map(([x, y]) => {
        const [wx, , wz] = gridToWorld(x, y);
        return (
          <mesh key={`sp-${x}-${y}`} position={[wx, 0.02, wz]}>
            <cylinderGeometry args={[0.08, 0.08, 0.03, 16]} />
            <meshStandardMaterial color="#3f2f1d" roughness={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * fx-spec §2: dust ripple kicked up at the landing point.
 * Mounted keyed by move, self-unmounts once both rings finished so R3F
 * disposes the JSX-declared materials automatically (no manual pooling).
 */
function ImpactRipple({ move }: { move: Move }) {
  const r1 = useRef<THREE.Mesh>(null);
  const r2 = useRef<THREE.Mesh>(null);
  const t = useRef(0);
  const doneRef = useRef(false);
  const [done, setDone] = useState(false);
  const [wx, , wz] = gridToWorld(move.x, move.y);
  // Both rings share one geometry; only the materials animate independently.
  const geo = useMemo(() => new THREE.RingGeometry(0.3, 0.4, 40), []);
  useEffect(() => () => geo.dispose(), [geo]);

  useFrame((_, delta) => {
    if (doneRef.current) return;
    t.current += delta;
    const tms = t.current * 1000;

    if (r1.current) {
      const p = Math.min(1, tms / 450);
      const s = 1 + easeOutCubic(p) * 1.2; // 1.0 → 2.2
      r1.current.scale.set(s, s, 1);
      (r1.current.material as THREE.MeshBasicMaterial).opacity =
        0.5 * Math.pow(1 - p, 1.5);
    }
    if (r2.current) {
      const p = Math.min(1, Math.max(0, (tms - 90) / 380));
      const s = 0.8 + easeOutCubic(p) * 0.9; // 0.8 → 1.7
      r2.current.scale.set(s, s, 1);
      (r2.current.material as THREE.MeshBasicMaterial).opacity =
        tms < 90 ? 0 : 0.32 * Math.pow(1 - p, 1.5);
    }
    if (tms >= 470) {
      // Fires exactly once — guarded by a ref, never a setState loop.
      doneRef.current = true;
      setDone(true);
    }
  });

  if (done) return null;

  return (
    <group>
      <mesh
        ref={r1}
        geometry={geo}
        position={[wx, 0.055, wz]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={2}
      >
        <meshBasicMaterial
          color={DUST_COLOR}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
      <mesh
        ref={r2}
        geometry={geo}
        position={[wx, 0.052, wz]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={2}
        scale={[0.8, 0.8, 1]}
      >
        <meshBasicMaterial
          color={DUST_COLOR}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Outer shell: keeps the `!hover` early-return so nothing renders (and no
 * per-frame work happens) when the pointer is off the board. All hooks live in
 * `HoverPreviewInner`, which is only mounted when `hover` is non-null —
 * see fx-spec §3.1.
 */
function HoverPreview({
  hover,
  player,
  valid,
  interactive,
}: {
  hover: Move | null;
  player: Player;
  valid: boolean;
  interactive: boolean;
}) {
  if (!hover) return null;
  return (
    <HoverPreviewInner
      hover={hover}
      player={player}
      valid={valid}
      interactive={interactive}
    />
  );
}

function HoverPreviewInner({
  hover,
  player,
  valid,
  interactive,
}: {
  hover: Move;
  player: Player;
  valid: boolean;
  interactive: boolean;
}) {
  const ghost = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const [wx, , wz] = gridToWorld(hover.x, hover.y);
  const color = stoneColor(player);

  useFrame(({ clock }) => {
    const mat = matRef.current;
    const g = ghost.current;
    if (!mat || !g) return;
    let opacity: number;
    let s = 1;
    if (REDUCED) {
      // §8.3-3: static, current behaviour.
      opacity = valid ? 0.45 : 0.18;
    } else if (!interactive) {
      // §3.4: visible position, unmistakably "not your turn".
      opacity = 0.12;
    } else if (!valid) {
      opacity = 0.18;
    } else {
      // §3.2: 0.9 Hz opacity breathing on an absolute clock phase (no jump
      // when the preview hops between intersections).
      const ph = Math.sin(TAU * 0.9 * clock.elapsedTime);
      opacity = 0.38 + 0.1 * ph;
      s = 1 + 0.015 * ph;
    }
    mat.opacity = opacity;
    g.scale.set(s, STONE_FLAT, s);
  });

  // §3.4: the full-width crosshair is hidden while it is not the player's turn.
  const showCross = REDUCED || interactive;

  return (
    <group>
      {/* ghost stone */}
      <mesh ref={ghost} position={[wx, REST_Y, wz]} scale={[1, STONE_FLAT, 1]}>
        <sphereGeometry args={[STONE_RADIUS, 32, 24]} />
        <meshStandardMaterial
          ref={matRef}
          color={color}
          transparent
          opacity={valid ? 0.45 : 0.18}
          roughness={0.4}
        />
      </mesh>
      {/* guide crosshair through the hovered intersection (§3.3: static) */}
      {showCross && (
        <>
          <mesh position={[0, 0.03, wz]}>
            <boxGeometry args={[PLANE - 2, 0.04, 0.06]} />
            <meshStandardMaterial
              color={GUIDE_COLOR}
              emissive={GUIDE_COLOR}
              emissiveIntensity={0.6}
              transparent
              opacity={0.7}
            />
          </mesh>
          <mesh position={[wx, 0.03, 0]}>
            <boxGeometry args={[0.06, 0.04, PLANE - 2]} />
            <meshStandardMaterial
              color={GUIDE_COLOR}
              emissive={GUIDE_COLOR}
              emissiveIntensity={0.6}
              transparent
              opacity={0.7}
            />
          </mesh>
        </>
      )}
    </group>
  );
}

/**
 * fx-spec §5.1: the bar is demoted to a backing layer (slow 0.5 Hz, narrower
 * band) now that the per-stone travelling shimmer carries the victory read.
 * Callers must guarantee `line.length >= 2`.
 *
 * `animated` is deliberately NOT "did the human win" — highlighting the five
 * decisive stones is information, not celebration, so it runs for either side.
 */
function WinLine({ line, animated }: { line: Move[]; animated?: boolean }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const a = gridToWorld(line[0].x, line[0].y);
  const b = gridToWorld(line[line.length - 1].x, line[line.length - 1].y);
  const mid: [number, number, number] = [
    (a[0] + b[0]) / 2,
    0.5,
    (a[2] + b[2]) / 2,
  ];
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]) + STONE_RADIUS;
  const angle = Math.atan2(b[2] - a[2], b[0] - a[0]);

  useFrame(({ clock }) => {
    if (!matRef.current) return;
    if (animated && !REDUCED) {
      const t = (Math.sin(TAU * 0.5 * clock.elapsedTime) + 1) / 2; // 0..1
      matRef.current.emissiveIntensity = 0.55 + t * 0.35; // 0.55..0.90
    } else {
      matRef.current.emissiveIntensity = 0.9;
    }
  });

  return (
    <mesh position={mid} rotation={[0, -angle, 0]}>
      <boxGeometry args={[len, 0.08, 0.08]} />
      <meshStandardMaterial
        ref={matRef}
        color={GUIDE_COLOR}
        emissive={GUIDE_COLOR}
        emissiveIntensity={0.9}
      />
    </mesh>
  );
}

/** A soft, pulsing radial glow used during the victory celebration. */
function CelebrationGlow() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = REDUCED ? 0 : (Math.sin(clock.elapsedTime * 2) + 1) / 2; // 0..1
    const s = 1 + t * 0.08;
    ref.current.scale.set(s, s, s);
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = (REDUCED ? 0.12 : 0.1) + t * 0.06;
  });
  return (
    <mesh ref={ref} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[9, 48]} />
      <meshBasicMaterial
        color="#ff8a3d"
        transparent
        opacity={0.12}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * fx-spec §4: last-move marker — an expanding outer ring plus a new static
 * breathing inner ring. `fading` (§7.2 draw) runs a 400ms linear fade and then
 * unmounts the whole group.
 */
function LastMovePulse({ move, fading }: { move: Move; fading?: boolean }) {
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  const fade = useRef(1);
  const goneRef = useRef(false);
  const [gone, setGone] = useState(false);
  const [wx, , wz] = gridToWorld(move.x, move.y);

  useFrame(({ clock }, delta) => {
    if (goneRef.current) return;
    if (fading) {
      // §8.3-7b: reduced motion drops it instantly.
      fade.current = REDUCED ? 0 : Math.max(0, fade.current - delta / 0.4);
      if (fade.current <= 0) {
        goneRef.current = true;
        setGone(true);
        return;
      }
    }
    const f = fade.current;
    if (inner.current) {
      (inner.current.material as THREE.MeshBasicMaterial).opacity = REDUCED
        ? // §8.3-4: static inner ring only.
          0.4 * f
        : (0.35 + 0.15 * Math.sin(TAU * 0.7 * clock.elapsedTime)) * f;
    }
    if (!REDUCED && outer.current) {
      const t = (clock.elapsedTime % 1.6) / 1.6;
      const s = 0.75 + easeOutQuad(t) * 0.95; // 0.75 → 1.70
      outer.current.scale.set(s, s, 1);
      (outer.current.material as THREE.MeshBasicMaterial).opacity =
        0.5 * (1 - t) * f;
    }
  });

  if (gone) return null;

  return (
    <group>
      {!REDUCED && (
        <mesh
          ref={outer}
          position={[wx, 0.219, wz]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.42, 0.54, 40]} />
          <meshBasicMaterial
            color={GUIDE_COLOR}
            transparent
            opacity={0.5}
            depthWrite={false}
          />
        </mesh>
      )}
      <mesh
        ref={inner}
        position={[wx, 0.216, wz]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.46, 0.52, 40]} />
        <meshBasicMaterial
          color={GUIDE_COLOR}
          transparent
          opacity={0.4}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/**
 * fx-spec §6: a very quiet breathing frame around the board rim while the AI
 * thinks. Four thin bars share a single material (their opacity is always in
 * sync). Calls `onFadedOut` when the 450ms exit envelope reaches zero so the
 * parent can unmount it and release the four draw calls.
 */
function ThinkingFrame({
  thinking,
  onFadedOut,
}: {
  thinking: boolean;
  onFadedOut: () => void;
}) {
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: GUIDE_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    []
  );
  useEffect(() => () => mat.dispose(), [mat]);
  const lin = useRef(REDUCED && thinking ? 1 : 0);
  const releasedRef = useRef(false);

  useFrame(({ clock }, delta) => {
    if (thinking) {
      // A new AI turn starting before the exit envelope finished re-arms the
      // one-shot release guard instead of leaving the frame permanently dead.
      releasedRef.current = false;
      // §8.3-6: reduced motion enters / leaves instantly.
      lin.current = REDUCED ? 1 : Math.min(1, lin.current + delta / 0.3);
    } else if (releasedRef.current) {
      return;
    } else {
      lin.current = REDUCED ? 0 : Math.max(0, lin.current - delta / 0.45);
      if (lin.current <= 0) {
        mat.opacity = 0;
        releasedRef.current = true;
        onFadedOut();
        return;
      }
    }
    const env = thinking
      ? easeOutQuad(lin.current)
      : 1 - easeOutQuad(1 - lin.current);
    mat.opacity = REDUCED
      ? env * 0.14
      : env * (0.12 + 0.12 * (Math.sin((TAU * clock.elapsedTime) / 2.4) + 1) / 2);
  });

  return (
    <group>
      {[-7.6, 7.6].map((z) => (
        <mesh key={`h${z}`} position={[0, 0.026, z]} material={mat}>
          <boxGeometry args={[15.2, 0.02, 0.08]} />
        </mesh>
      ))}
      {[-7.6, 7.6].map((x) => (
        <mesh key={`v${x}`} position={[x, 0.026, 0]} material={mat}>
          <boxGeometry args={[0.08, 0.02, 15.2]} />
        </mesh>
      ))}
    </group>
  );
}

function InteractionPlane({
  interactive,
  onHover,
  onPlace,
}: {
  interactive: boolean;
  onHover: (m: Move | null) => void;
  onPlace: (m: Move) => void;
}) {
  const handle = (e: ThreeEvent<PointerEvent>) => {
    const g = worldToGrid(e.point);
    onHover(g);
    return g;
  };
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.005, 0]}
      onPointerMove={(e) => {
        e.stopPropagation();
        handle(e);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        const g = worldToGrid(e.point);
        if (g && interactive) onPlace(g);
      }}
    >
      <planeGeometry args={[PLANE, PLANE]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Camera rig: tweens between the 3D orbit view and the locked 2D top-down view.
// ---------------------------------------------------------------------------

const CAM_3D = new THREE.Vector3(0, 16, 15);
/** Tiny z offset avoids a degenerate lookAt (camera exactly on the up axis). */
const CAM_2D = new THREE.Vector3(0, 22, 0.0001);
const TWEEN_DURATION = 0.6; // seconds
const POLAR_MIN_3D = 0.15;
const POLAR_MAX_3D = Math.PI / 2.6;

/**
 * Apply per-mode OrbitControls constraints imperatively (the JSX props keep
 * the 3D defaults; R3F only re-applies props when they change, so these
 * imperative overrides are never clobbered by re-renders).
 * - 2D: rotation hard-locked (enableRotate=false AND polar clamped to ~0,
 *   Spherical.makeSafe keeps phi at EPS so there is no gimbal lock). Zoom kept.
 * - 3D: full original freedom restored.
 */
function applyModeConstraints(controls: OrbitControlsImpl, mode: ViewMode): void {
  controls.enableRotate = mode === "3d";
  controls.minPolarAngle = mode === "2d" ? 0 : POLAR_MIN_3D;
  controls.maxPolarAngle = mode === "2d" ? 0 : POLAR_MAX_3D;
}

/**
 * Drives the camera when `viewMode` changes: a 600ms easeInOutCubic position
 * tween (instant when prefers-reduced-motion). During the tween the controls
 * are disabled so drei's per-frame `controls.update()` cannot fight the tween
 * (drei gates update() on `controls.enabled`). The Canvas is never remounted,
 * so all scene/game state survives mode switches.
 */
function CameraRig({
  viewMode,
  onTweeningChange,
}: {
  viewMode: ViewMode;
  onTweeningChange: (tweening: boolean) => void;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const tween = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number } | null>(
    null
  );
  const appliedMode = useRef<ViewMode | null>(null);

  useEffect(() => {
    const to = viewMode === "2d" ? CAM_2D : CAM_3D;

    const snap = () => {
      tween.current = null;
      camera.position.copy(to);
      camera.lookAt(0, 0, 0);
      if (controls) {
        applyModeConstraints(controls, viewMode);
        controls.target.set(0, 0, 0);
        controls.enabled = true;
        controls.update();
      }
      onTweeningChange(false);
    };

    if (appliedMode.current === viewMode) {
      // Same mode re-run (e.g. controls instance arrived after mount):
      // just (re)apply constraints, never tween.
      if (controls) {
        applyModeConstraints(controls, viewMode);
        controls.target.set(0, 0, 0);
        controls.update();
      }
      return;
    }

    const isFirst = appliedMode.current === null;
    appliedMode.current = viewMode;

    if (isFirst || REDUCED) {
      // Initial placement (persisted mode) or reduced motion: no animation.
      snap();
      return;
    }

    // Animated transition: freeze controls, tween from wherever the camera
    // currently is (covers "user rotated in 3D, must return to exact top-down").
    if (controls) controls.enabled = false;
    tween.current = { from: camera.position.clone(), to: to.clone(), t: 0 };
    onTweeningChange(true);
  }, [viewMode, camera, controls, onTweeningChange]);

  useFrame((_, delta) => {
    const tw = tween.current;
    if (!tw) return;
    tw.t = Math.min(1, tw.t + delta / TWEEN_DURATION);
    camera.position.lerpVectors(tw.from, tw.to, easeInOutCubic(tw.t));
    camera.lookAt(0, 0, 0);
    if (tw.t >= 1) {
      tween.current = null;
      if (controls) {
        applyModeConstraints(controls, viewMode);
        controls.target.set(0, 0, 0);
        controls.enabled = true;
        controls.update();
      }
      onTweeningChange(false);
    }
  });

  return null;
}

export interface GameBoardProps {
  board: Board;
  currentPlayer: Player;
  interactive: boolean;
  lastMove: Move | null;
  winLine: Move[] | null;
  onHover: (m: Move | null) => void;
  onPlace: (m: Move) => void;
  /**
   * The *human* won — purely celebratory extras (the ground glow) only.
   * Win-line highlighting is informational and keys off `winLine` instead, so
   * it still plays when the AI wins.
   */
  celebrate?: boolean;
  /** "3d" = free orbit (default), "2d" = locked top-down, zoom only. */
  viewMode?: ViewMode;
  /** True while the AI is computing its move (drives the §6 thinking frame). */
  thinking?: boolean;
  /** Explicit draw signal from the App layer (`status === "draw"`). */
  drawn?: boolean;
}

function Scene({
  board,
  currentPlayer,
  interactive,
  lastMove,
  winLine,
  onHover,
  onPlace,
  celebrate,
  viewMode = "3d",
  thinking,
  drawn,
}: GameBoardProps) {
  const [hover, setHover] = useState<Move | null>(null);
  // Explicit interaction policy while the camera tween runs: hover preview
  // stays live (harmless), but placement is blocked to prevent mis-clicks on
  // a moving camera. setCamTweening is a stable setState fn (safe effect dep).
  const [camTweening, setCamTweening] = useState(false);
  // The thinking frame outlives `thinking` by its 450ms exit envelope.
  const [frameAlive, setFrameAlive] = useState(false);
  // Frozen at first render: OrbitControls JSX props match the persisted mode
  // so there is no 1-frame polar-clamp flicker at mount. All later mode
  // changes are applied imperatively by CameraRig (R3F never re-applies
  // unchanged JSX props, so the two never fight).
  const initialMode = useRef(viewMode).current;
  const hoverValid =
    hover !== null && board[idx(hover.x, hover.y)] === 0;

  const stones = useMemo(() => {
    const list: { x: number; y: number; p: Player }[] = [];
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 15; x++) {
        const s = board[idx(x, y)];
        if (s !== 0) list.push({ x, y, p: s as Player });
      }
    }
    return list;
  }, [board]);

  // §5.1: winning-line order, resolved once per win instead of per stone.
  // Gated on `winLine`, NOT on `celebrate`: the shimmer / hop / dimming answer
  // "which five stones decided this game", which the loser needs to see just
  // as much as the winner. Only confetti and the ground glow are celebratory.
  const winIndexMap = useMemo(() => {
    if (!winLine) return null;
    const m = new Map<string, number>();
    winLine.forEach((mv, i) => m.set(`${mv.x}-${mv.y}`, i));
    return m;
  }, [winLine]);

  useEffect(() => {
    if (thinking) setFrameAlive(true);
  }, [thinking]);
  const releaseFrame = useCallback(() => setFrameAlive(false), []);

  const hoverOnLastMove =
    !!hover && !!lastMove && hover.x === lastMove.x && hover.y === lastMove.y;

  return (
    <>
      <ambientLight intensity={0.7} />
      <hemisphereLight args={["#fff7ed", "#7c5c3e", 0.45]} />
      <directionalLight
        position={[6, 12, 8]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <directionalLight position={[-8, 6, -4]} intensity={0.3} />

      <CameraRig viewMode={viewMode} onTweeningChange={setCamTweening} />

      <InteractionPlane
        interactive={interactive && !camTweening}
        onHover={(m) => {
          setHover(m);
          onHover(m);
        }}
        onPlace={onPlace}
      />

      {/* board base */}
      <RoundedBox
        args={[PLANE, 0.8, PLANE]}
        radius={0.35}
        smoothness={4}
        position={[0, -0.4, 0]}
        receiveShadow
      >
        <meshStandardMaterial color={BOARD_COLOR} roughness={0.7} />
      </RoundedBox>

      {/* soft grounding shadow under the floating board */}
      <ContactShadows
        position={[0, -0.86, 0]}
        opacity={0.4}
        scale={26}
        blur={3}
        far={3}
        color="#3f2f1d"
      />

      <GridLines />

      {frameAlive && (
        <ThinkingFrame thinking={!!thinking} onFadedOut={releaseFrame} />
      )}

      {stones.map((s) => {
        const key = `${s.x}-${s.y}`;
        const isLast = !!lastMove && lastMove.x === s.x && lastMove.y === s.y;
        const wi = winIndexMap?.get(key);
        return (
          <Stone
            key={key}
            x={s.x}
            y={s.y}
            player={s.p}
            highlight={isLast}
            entrance={isLast ? "bounce" : "pop"}
            viewMode={viewMode}
            winIndex={wi}
            // §5.3 / §7.2: dim the non-decisive stones whenever the game ended
            // with a line (either side), or half as much on a draw.
            dimK={winLine ? (wi === undefined ? 1 : 0) : drawn ? 0.5 : 0}
            dimMs={winLine ? 500 : 600}
          />
        );
      })}

      {/* §2: replays on every new lastMove (keyed), self-unmounts after 470ms */}
      {lastMove && !REDUCED && (
        <ImpactRipple key={`${lastMove.x}-${lastMove.y}`} move={lastMove} />
      )}

      {/* §4.2 avoidance: never shown under a win, never fought with a same-cell hover */}
      {lastMove && !winLine && !hoverOnLastMove && (
        <LastMovePulse move={lastMove} fading={drawn} />
      )}

      <HoverPreview
        hover={hover}
        player={currentPlayer}
        valid={hoverValid}
        interactive={interactive}
      />

      {winLine && winLine.length >= 2 && (
        <WinLine line={winLine} animated />
      )}

      {celebrate && !REDUCED && <CelebrationGlow />}

      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom
        enableRotate={initialMode === "3d"}
        minDistance={14}
        maxDistance={30}
        minPolarAngle={initialMode === "2d" ? 0 : 0.15}
        maxPolarAngle={initialMode === "2d" ? 0 : Math.PI / 2.6}
        target={[0, 0, 0]}
      />
    </>
  );
}

export default function GameBoard(props: GameBoardProps) {
  // Canvas `camera` is only read at creation; freeze the initial position so
  // a persisted "2d" mode starts top-down without a first-frame 3D flash.
  // Mode switches afterwards are handled by CameraRig — the Canvas itself is
  // NEVER remounted, so the ongoing game / scene state is fully preserved.
  const initialPos = useRef<[number, number, number]>(
    (props.viewMode ?? "3d") === "2d"
      ? [CAM_2D.x, CAM_2D.y, CAM_2D.z]
      : [CAM_3D.x, CAM_3D.y, CAM_3D.z]
  ).current;
  return (
    <div className="absolute inset-0 overflow-hidden rounded-xl" data-gomoku-board>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: initialPos, fov: 42 }}
        className="h-full w-full rounded-xl"
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <color attach="background" args={["#f6efe6"]} />
        <Scene {...props} />
      </Canvas>
    </div>
  );
}

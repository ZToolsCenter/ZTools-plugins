import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/components/editor/utils/cn";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

type GooseVideoPlayerProps = {
  src: string;
  className?: string;
  /** 在播放器获得键盘焦点时按 Enter：通知外层在块下方插空行 */
  onEnterBelow?: () => void;
};

export function GooseVideoPlayer({
  src,
  className,
  onEnterBelow,
}: GooseVideoPlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimerRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [seeking, setSeeking] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setReady(false);
    setLoadError(false);
    setCurrent(0);
    setDuration(0);
  }, [src]);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (!playing) return;
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 2200);
  }, [clearHideTimer, playing]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    return () => clearHideTimer();
  }, [clearHideTimer]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      setControlsVisible(true);
      clearHideTimer();
    };
    const onTime = () => {
      if (!seeking) setCurrent(video.currentTime);
    };
    const onMeta = () => {
      setDuration(video.duration || 0);
      setReady(true);
      setLoadError(false);
    };
    const onVolume = () => {
      setMuted(video.muted);
      setVolume(video.volume);
    };
    const onEnded = () => {
      setPlaying(false);
      setControlsVisible(true);
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("ended", onEnded);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("ended", onEnded);
    };
  }, [clearHideTimer, seeking, src]);

  useEffect(() => {
    const onFsChange = () => {
      const el = rootRef.current;
      setIsFullscreen(Boolean(el && document.fullscreenElement === el));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    revealControls();
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch {
      // 自动播放策略等：忽略
    }
  }, [revealControls]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) {
      video.volume = 0.9;
    }
    revealControls();
  }, [revealControls]);

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    try {
      if (document.fullscreenElement === root) {
        await document.exitFullscreen();
      } else {
        await root.requestFullscreen();
      }
    } catch {
      // 宿主环境可能禁用全屏
    }
    revealControls();
  }, [revealControls]);

  const seekToClientX = useCallback(
    (clientX: number, target: HTMLElement) => {
      const video = videoRef.current;
      if (!video || !duration) return;
      const rect = target.getBoundingClientRect();
      const ratio = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / rect.width),
      );
      const next = ratio * duration;
      video.currentTime = next;
      setCurrent(next);
    },
    [duration],
  );

  const onProgressPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const track = event.currentTarget;
      setSeeking(true);
      seekToClientX(event.clientX, track);
      track.setPointerCapture(event.pointerId);

      const onMove = (e: PointerEvent) => seekToClientX(e.clientX, track);
      const onUp = (e: PointerEvent) => {
        setSeeking(false);
        seekToClientX(e.clientX, track);
        track.releasePointerCapture(e.pointerId);
        track.removeEventListener("pointermove", onMove);
        track.removeEventListener("pointerup", onUp);
        track.removeEventListener("pointercancel", onUp);
        revealControls();
      };
      track.addEventListener("pointermove", onMove);
      track.addEventListener("pointerup", onUp);
      track.addEventListener("pointercancel", onUp);
    },
    [revealControls, seekToClientX],
  );

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div
      ref={rootRef}
      className={cn("goose-video-player", className)}
      data-playing={playing ? "true" : "false"}
      data-controls={controlsVisible ? "visible" : "hidden"}
      data-ready={ready ? "true" : "false"}
      data-error={loadError ? "true" : "false"}
      onMouseMove={revealControls}
      onMouseLeave={() => {
        if (playing) setControlsVisible(false);
      }}
      onFocus={revealControls}
      tabIndex={0}
      role="group"
      aria-label="视频播放器"
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "k" || e.key === "K") {
          e.preventDefault();
          e.stopPropagation();
          void togglePlay();
          return;
        }
        if (e.key === "m" || e.key === "M") {
          e.preventDefault();
          e.stopPropagation();
          toggleMute();
          return;
        }
        if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          e.stopPropagation();
          void toggleFullscreen();
          return;
        }
        if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          onEnterBelow?.();
          return;
        }
        if (e.key === "Escape" && isFullscreen) {
          e.preventDefault();
          e.stopPropagation();
          void document.exitFullscreen().catch(() => {});
        }
      }}
    >
      <video
        ref={videoRef}
        src={src}
        className="goose-video-player__video"
        playsInline
        preload="metadata"
        onError={() => {
          setLoadError(true);
          setReady(false);
          setPlaying(false);
        }}
        // 不使用原生 controls；避免抢焦点与丑陋默认条
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          void togglePlay();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          void toggleFullscreen();
        }}
      />

      {loadError && (
        <div className="goose-video-player__error" role="status">
          <VideoOff aria-hidden="true" />
          <span>视频无法读取，请从上方工具栏更换</span>
        </div>
      )}

      {/* 中央大播放钮：暂停态常显，播放态随控件淡出 */}
      {!loadError && (
        <button
          type="button"
          className="goose-video-player__center-play"
          aria-label={playing ? "暂停" : "播放"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            void togglePlay();
          }}
        >
          {playing ? (
            <Pause
              className="goose-video-player__center-icon"
              strokeWidth={1.75}
            />
          ) : (
            <Play
              className="goose-video-player__center-icon goose-video-player__center-icon--play"
              strokeWidth={1.75}
            />
          )}
        </button>
      )}

      <div className="goose-video-player__chrome">
        <div className="goose-video-player__gradient" aria-hidden="true" />

        <div
          className="goose-video-player__progress"
          role="slider"
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={Math.floor(duration) || 0}
          aria-valuenow={Math.floor(current)}
          aria-valuetext={`${formatTime(current)} / ${formatTime(duration)}`}
          tabIndex={0}
          onPointerDown={onProgressPointerDown}
          onKeyDown={(e) => {
            const video = videoRef.current;
            if (!video || !duration) return;
            const step = e.shiftKey ? 10 : 5;
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              video.currentTime = Math.max(0, video.currentTime - step);
              setCurrent(video.currentTime);
              revealControls();
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              video.currentTime = Math.min(duration, video.currentTime + step);
              setCurrent(video.currentTime);
              revealControls();
            }
          }}
        >
          <div className="goose-video-player__progress-track">
            <div
              className="goose-video-player__progress-fill"
              style={{ width: `${progress}%` }}
            />
            <div
              className="goose-video-player__progress-thumb"
              style={{ left: `${progress}%` }}
            />
          </div>
        </div>

        <div className="goose-video-player__bar">
          <div className="goose-video-player__bar-left">
            <button
              type="button"
              className="goose-video-player__btn"
              aria-label={playing ? "暂停" : "播放"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                void togglePlay();
              }}
            >
              {playing ? (
                <Pause size={16} strokeWidth={1.75} />
              ) : (
                <Play
                  size={16}
                  strokeWidth={1.75}
                  className="goose-video-player__icon-play"
                />
              )}
            </button>

            <button
              type="button"
              className="goose-video-player__btn"
              aria-label={muted || volume === 0 ? "取消静音" : "静音"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                toggleMute();
              }}
            >
              {muted || volume === 0 ? (
                <VolumeX size={16} strokeWidth={1.75} />
              ) : (
                <Volume2 size={16} strokeWidth={1.75} />
              )}
            </button>

            <span className="goose-video-player__time">
              {formatTime(current)}
              <span className="goose-video-player__time-sep">/</span>
              {formatTime(duration)}
            </span>
          </div>

          <div className="goose-video-player__bar-right">
            <button
              type="button"
              className="goose-video-player__btn"
              aria-label={isFullscreen ? "退出全屏" : "全屏"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                void toggleFullscreen();
              }}
            >
              {isFullscreen ? (
                <Minimize2 size={16} strokeWidth={1.75} />
              ) : (
                <Maximize2 size={16} strokeWidth={1.75} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

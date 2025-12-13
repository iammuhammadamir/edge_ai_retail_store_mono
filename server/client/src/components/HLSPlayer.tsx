import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";

interface HLSPlayerProps {
  src: string;
  className?: string;
  onError?: (error: string) => void;
  onPlaying?: () => void;
}

export function HLSPlayer({
  src,
  className = "",
  onError,
  onPlaying,
}: HLSPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Jump to live edge and play
  const jumpToLive = useCallback(() => {
    const video = videoRef.current;
    const hls = hlsRef.current;
    if (!video || !hls) return;

    // Seek to live edge
    if (hls.liveSyncPosition) {
      video.currentTime = hls.liveSyncPosition;
    }
    video.play().catch(() => {});
    setIsPaused(false);
  }, []);

  // Toggle pause/play - always resume at live edge
  const togglePause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      jumpToLive();
    } else {
      video.pause();
      setIsPaused(true);
    }
  }, [jumpToLive]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setIsLoading(true);
    setError(null);
    setIsPaused(false);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 5,             // Minimal back buffer (5 seconds)
        maxBufferLength: 8,              // Small buffer ahead
        maxMaxBufferLength: 15,          // Absolute max
        liveSyncDurationCount: 1,        // Stay 1 segment behind live edge
        liveMaxLatencyDurationCount: 3,  // Auto-seek if >3 segments behind
        liveDurationInfinity: true,
        highBufferWatchdogPeriod: 1,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 3,
        levelLoadingTimeOut: 10000,
        fragLoadingTimeOut: 20000,
      });

      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        video.play().catch(() => {});
      });

      // Auto-recover on errors
      hls.on(Hls.Events.ERROR, (_, data) => {
        console.warn("HLS error:", data.type, data.details);
        
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log("Network error, retrying...");
              setTimeout(() => hls.startLoad(), 1000);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log("Media error, recovering...");
              hls.recoverMediaError();
              break;
            default:
              setError("Stream unavailable");
              onError?.("Stream unavailable");
              break;
          }
        }
      });

      // Keep synced to live edge
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (video.paused) return;
        
        // If we fall too far behind, jump to live
        const liveEdge = hls.liveSyncPosition || 0;
        const behind = liveEdge - video.currentTime;
        if (behind > 10) {
          console.log(`Behind by ${behind.toFixed(1)}s, jumping to live`);
          video.currentTime = liveEdge;
        }
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener("loadedmetadata", () => {
        setIsLoading(false);
        video.play().catch(() => {});
      });
      video.addEventListener("error", () => {
        setError("Failed to load stream");
        onError?.("Failed to load stream");
      });
    } else {
      setError("HLS not supported");
      onError?.("HLS not supported");
    }
  }, [src, onError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlaying = () => {
      setIsLoading(false);
      setIsPaused(false);
      onPlaying?.();
    };
    const handlePause = () => setIsPaused(true);
    const handleWaiting = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);

    video.addEventListener("playing", handlePlaying);
    video.addEventListener("pause", handlePause);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("canplay", handleCanPlay);
    
    return () => {
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("canplay", handleCanPlay);
    };
  }, [onPlaying]);

  return (
    <div className={`relative ${className}`}>
      {/* Video element - no controls */}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted
        playsInline
      />

      {/* Simple pause/play overlay button */}
      <button
        onClick={togglePause}
        className="absolute bottom-4 left-4 bg-black/60 hover:bg-black/80 text-white rounded-full p-3 transition-colors"
        title={isPaused ? "Play (jumps to live)" : "Pause"}
      >
        {isPaused ? (
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        )}
      </button>

      {/* LIVE indicator */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${isPaused ? 'bg-gray-400' : 'bg-red-500 animate-pulse'}`} />
        <span className="text-white text-xs font-medium bg-black/60 px-2 py-1 rounded">
          {isPaused ? 'PAUSED' : 'LIVE'}
        </span>
      </div>

      {/* Loading overlay */}
      {isLoading && !error && !isPaused && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-2 text-white">
            <div className="h-8 w-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Connecting...</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="flex flex-col items-center gap-3 text-white text-center p-4">
            <svg className="h-10 w-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm">{error}</span>
            <button
              onClick={() => window.location.reload()}
              className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded"
            >
              Reload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

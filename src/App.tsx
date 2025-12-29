import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const DEFAULT_YT_URL = "https://www.youtube.com/watch?v=YkADj0TPrJA&list=RDYkADj0TPrJA&start_radio=1";

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function formatHMS(totalMs: number) {
  const totalSec = Math.max(0, Math.floor(totalMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function formatTime(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function nextLocalMidnight(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
}

function parseMmSs(minStr: string, secStr: string) {
  const m = Math.max(0, parseInt(minStr || "0", 10) || 0);
  const s = Math.max(0, parseInt(secStr || "0", 10) || 0);
  return (m * 60 + s) * 1000;
}

function extractYouTubeVideoId(input: string): string | null {
  try {
    // Support: youtu.be/ID, youtube.com/watch?v=ID, youtube.com/shorts/ID, embed/ID
    const url = new URL(input);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }
    if (url.hostname.includes("youtube.com")) {
      if (url.pathname.startsWith("/watch")) {
        return url.searchParams.get("v");
      }
      const parts = url.pathname.split("/").filter(Boolean);
      const shortsIdx = parts.indexOf("shorts");
      if (shortsIdx >= 0 && parts[shortsIdx + 1]) return parts[shortsIdx + 1];
      const embedIdx = parts.indexOf("embed");
      if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1];
    }
    return null;
  } catch {
    // If it's already an ID-like string, accept basic pattern
    if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) return input.trim();
    return null;
  }
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

async function loadYouTubeIframeApi(): Promise<void> {
  if (window.YT?.Player) return;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-yt-iframe-api="1"]') as HTMLScriptElement | null;
    if (existing) {
      // If script exists but YT not ready yet, wait
      const check = window.setInterval(() => {
        if (window.YT?.Player) {
          window.clearInterval(check);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        window.clearInterval(check);
        if (window.YT?.Player) resolve();
        else reject(new Error("YouTube API load timeout"));
      }, 8000);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.dataset.ytIframeApi = "1";
    script.onerror = () => reject(new Error("Failed to load YouTube IFrame API"));
    document.body.appendChild(script);

    window.onYouTubeIframeAPIReady = () => resolve();
  });
}

export default function App() {
  const [now, setNow] = useState(() => new Date());
  const [showHelp, setShowHelp] = useState(false);


  // YouTube UI state
  const [ytInput, setYtInput] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [dropMin, setDropMin] = useState("0");
  const [dropSec, setDropSec] = useState("0");
  const [nudgeMs, setNudgeMs] = useState("0");
  const [status, setStatus] = useState<string>("Not armed");
  const [scheduledStartAt, setScheduledStartAt] = useState<string>("");

  const playerRef = useRef<any>(null);
  const timeoutRef = useRef<number | null>(null);

  // Clock tick
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 250);
    return () => window.clearInterval(id);
  }, []);

  const midnight = useMemo(() => nextLocalMidnight(now), [now]);
  const msLeft = midnight.getTime() - now.getTime();

  // Mouse → CSS vars (keep your existing behavior)
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--mx", "0.5");
    root.style.setProperty("--my", "0.45");

    let raf: number | null = null;
    let last: { x: number; y: number } | null = null;

    const apply = () => {
      raf = null;
      if (!last) return;
      root.style.setProperty("--mx", String(last.x));
      root.style.setProperty("--my", String(last.y));
    };

    const onMove = (e: MouseEvent) => {
      last = {
        x: Math.min(1, Math.max(0, e.clientX / window.innerWidth)),
        y: Math.min(1, Math.max(0, e.clientY / window.innerHeight)),
      };
      if (raf == null) raf = requestAnimationFrame(apply);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  async function armYouTube(urlOverride?: string) {
    const raw = (urlOverride ?? ytInput).trim();
    const id = extractYouTubeVideoId(raw);
    if (!id) {
      setStatus("Paste a valid YouTube link (or 11-char video id).");
      return;
    }
    setVideoId(id);

    setStatus("Loading YouTube player…");
    await loadYouTubeIframeApi();

    // Destroy old player if any
    if (playerRef.current?.destroy) {
      playerRef.current.destroy();
      playerRef.current = null;
    }

    playerRef.current = new window.YT.Player("yt-player", {
      videoId: id,
      height: "315",
      width: "560",
      playerVars: {
        controls: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
      },
      events: {
        onReady: () => {
          // Load video but keep it paused at 0 so it's buffered
          try {
            playerRef.current.cueVideoById({ videoId: id, startSeconds: 0 });
          } catch {}
          setStatus("Armed ✓ (ready to schedule)");
        },
        onError: () => setStatus("YouTube player error (try another link)."),
      },
    });
  }

  async function scheduleYouTubePlay() {
    if (!playerRef.current) {
      setStatus("Arm YouTube first.");
      return;
    }
    if (!videoId) {
      setStatus("No video selected.");
      return;
    }

    // Clear previous schedule
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const dropMs = parseMmSs(dropMin, dropSec);
    const nudge = parseInt(nudgeMs || "0", 10) || 0;

    const startAt = midnight.getTime() - dropMs - nudge;
    const delay = startAt - Date.now();

    setScheduledStartAt(new Date(startAt).toLocaleTimeString());
    setStatus(delay <= 0 ? "Starting now…" : "Scheduled ✓");

    const run = () => {
      try {
        // Make sure we start from the beginning
        playerRef.current.seekTo(0, true);
        playerRef.current.playVideo();
        setStatus("Playing ▶");
      } catch {
        setStatus("Failed to start playback (click play in the embed).");
      }
    };

    if (delay <= 0) {
      run();
      return;
    }

    timeoutRef.current = window.setTimeout(run, delay);
  }

  async function applyDefaults() {
    setYtInput(DEFAULT_YT_URL);
    setDropMin("3");
    setDropSec("19");

    // auto-arm immediately
    await armYouTube(DEFAULT_YT_URL);
  }


  return (
    <div className="page">
      <div className="bg" aria-hidden />
      <div className="brand">
        <div className="brandName">MidnightDrop</div>
        <div className="brandTagline">Sync your song’s drop to midnight.</div>
      </div>

      {/* Center stack: countdown + YouTube widget */}
      <div className="centerStack">
        <div className="heroInner">
          <div className="label">Countdown to midnight</div>
          <div className="countdown">{formatHMS(msLeft)}</div>

          <button className="helpBtn" onClick={() => setShowHelp(true)}>
            How to use
          </button>

          {/* YouTube widget BETWEEN countdown and current time */}
          <div className="ytPanel">
            <div className="ytRow">
              <input
                className="input"
                placeholder="Paste YouTube link (or video id)…"
                value={ytInput}
                onChange={(e) => setYtInput(e.target.value)}
              />
              <button className="btn" onClick={() => armYouTube().catch((e) => setStatus(String(e)))}>
                Arm YouTube
              </button>
            </div>

            <div className="ytRow">
              <div className="dropGroup">
                <span className="smallLabel">Hit midnight at</span>
                <input className="miniInput" value={dropMin} onChange={(e) => setDropMin(e.target.value)} />
                <span>:</span>
                <input className="miniInput" value={dropSec} onChange={(e) => setDropSec(e.target.value)} />
                <span className="smallLabel">mm:ss</span>
              </div>

              <div className="dropGroup">
                <span className="smallLabel">Nudge</span>
                <input className="miniInput" value={nudgeMs} onChange={(e) => setNudgeMs(e.target.value)} />
                <span className="smallLabel">ms</span>
              </div>

              <button className="btn" onClick={() => scheduleYouTubePlay().catch((e) => setStatus(String(e)))}>
                Schedule
              </button>
            </div>

            <div className="ytStatus">
              {status}
              {scheduledStartAt ? (
                <>
                  {" "}
                  · Scheduled start: <b>{scheduledStartAt}</b>
                </>
              ) : null}
            </div>

            {/* Player mounts here after arming */}
            <div className="ytFrameWrap">
              <div className="ytFrame">
                <div id="yt-player" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom cluster (current time + footer) */}
      <div className="bottom">
        <div className="card">
          <div className="smallLabel">Current local time</div>
          <div className="time">{formatTime(now)}</div>
        </div>

        <div className="footerHint">Tip: keep this tab visible on the party screen for the smoothest timing.</div>
      </div>
      {showHelp && (
        <div className="overlay" role="dialog" aria-modal="true" onClick={() => setShowHelp(false)}>
          <div className="overlayCard">
            <div className="overlayTitle">SETUP</div>
            <ol className="overlayList">
              <li>Open YouTube and find the song/video you want</li>
              <li>Copy the video link</li>
              <li>Paste it into the field on this page</li>
              <li>Click <b>Arm YouTube</b> (this enables playback in most browsers)</li>
              <li>Enter the <b>mm:ss</b> where the "drop" happens in the video</li>
              <li>Click <b>Schedule</b>. Keep this tab visible until midnight</li>
              <li>If autoplay is blocked, click play in the video when prompted</li>
            </ol>
            <div className="overlayButtons">
            <button className="btnSecondary" onClick={() => applyDefaults().catch(() => {})}>
              Use defaults
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

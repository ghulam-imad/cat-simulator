import { useEffect, useState } from "react";

/** "12:05" for a span in ms (never negative). Shows hours when needed: "1:02:05". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** "2 mnt 05 dtk" style for review tables. */
export function formatSeconds(seconds: number): string {
  const s = Math.round(seconds);
  return s < 60 ? `${s} dtk` : `${Math.floor(s / 60)} mnt ${String(s % 60).padStart(2, "0")} dtk`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * The server's current time, ticking locally. `serverNow` is the time from the latest server reply;
 * the offset from this device's clock is kept so a wrong tablet clock doesn't matter.
 */
export function useServerClock(serverNow: number | undefined, tickMs = 250): number {
  const [offset, setOffset] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (serverNow !== undefined) setOffset(serverNow - Date.now());
  }, [serverNow]);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return Date.now() + offset;
}

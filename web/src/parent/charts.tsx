import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Difficulty, ReviewedResponse } from "../shared/api";
import { formatSeconds } from "../shared/time";

/** Tracks an element's width so charts draw at real pixel size (text stays readable on phones). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function Tooltip({ tip }: { tip: Tip | undefined }) {
  if (!tip) return null;
  return (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.content}
    </div>
  );
}

const LEVELS: Difficulty[] = ["low", "medium", "high"];
const LEVEL_LABEL: Record<Difficulty, string> = { high: "Sulit", medium: "Sedang", low: "Mudah" };

/**
 * The Difficulty Path: which Difficulty each Question was, in order.
 * One series (the line); correct vs wrong is carried by marker *shape* (dot vs ✗), not colour alone.
 */
export function DifficultyPathChart({ responses }: { responses: ReviewedResponse[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>();
  const height = 150;
  const margin = { top: 14, right: 16, bottom: 30, left: 64 };
  const plotW = Math.max(40, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const n = responses.length;
  const x = (i: number) => margin.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (d: Difficulty) => margin.top + plotH - (LEVELS.indexOf(d) / 2) * plotH;

  if (n === 0) return <p className="muted small">Belum ada soal yang dijawab.</p>;

  const path = responses.map((r, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(r.question.difficulty)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 28))));

  const show = (i: number) => {
    const r = responses[i]!;
    setTip({
      x: x(i),
      y: y(r.question.difficulty),
      content: (
        <>
          <strong>
            {r.correct ? "✓ Benar" : "✗ Salah"} · {r.points} poin
          </strong>
          <span className="secondary">
            Soal {i + 1} · {LEVEL_LABEL[r.question.difficulty]} · {formatSeconds(r.secondsSpent)}
          </span>
        </>
      ),
    });
  };

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Jalur kesulitan: tingkat kesulitan setiap soal secara berurutan">
        {LEVELS.map((d) => (
          <g key={d}>
            <line x1={margin.left} x2={margin.left + plotW} y1={y(d)} y2={y(d)} stroke="var(--grid)" strokeWidth={1} />
            <text x={margin.left - 10} y={y(d)} dy="0.35em" textAnchor="end" fontSize={12} fill="var(--ink-muted)">
              {LEVEL_LABEL[d]}
            </text>
          </g>
        ))}
        {responses.map((_, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={12} fill="var(--ink-muted)" className="num">
              {i + 1}
            </text>
          ) : null,
        )}
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {responses.map((r, i) => {
          const cx = x(i);
          const cy = y(r.question.difficulty);
          return (
            <g key={i}>
              {r.correct ? (
                <circle cx={cx} cy={cy} r={5} fill="var(--good)" stroke="var(--surface)" strokeWidth={2} />
              ) : (
                <g stroke="var(--critical)" strokeWidth={2.5} strokeLinecap="round">
                  <circle cx={cx} cy={cy} r={7} fill="var(--surface)" stroke="none" />
                  <line x1={cx - 4.5} y1={cy - 4.5} x2={cx + 4.5} y2={cy + 4.5} />
                  <line x1={cx - 4.5} y1={cy + 4.5} x2={cx + 4.5} y2={cy - 4.5} />
                </g>
              )}
              <circle
                cx={cx}
                cy={cy}
                r={12}
                fill="transparent"
                tabIndex={0}
                aria-label={`Soal ${i + 1}, ${LEVEL_LABEL[r.question.difficulty]}, ${r.correct ? "benar" : "salah"}`}
                onPointerEnter={() => show(i)}
                onPointerLeave={() => setTip(undefined)}
                onFocus={() => show(i)}
                onBlur={() => setTip(undefined)}
              />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
      <div className="chart-key" aria-hidden="true">
        <span>
          <svg width="12" height="12">
            <circle cx="6" cy="6" r="5" fill="var(--good)" />
          </svg>
          Benar
        </span>
        <span>
          <svg width="12" height="12" stroke="var(--critical)" strokeWidth="2.5" strokeLinecap="round">
            <line x1="2" y1="2" x2="10" y2="10" />
            <line x1="2" y1="10" x2="10" y2="2" />
          </svg>
          Salah
        </span>
      </div>
    </div>
  );
}

export interface ProgressPoint {
  label: string;
  sublabel: string;
  value: number;
  detail: string;
}

/** Clean y-axis ticks from 0 up to at least `max`. */
function ticks(max: number): number[] {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100];
  const step = steps.find((s) => max / s <= 5) ?? 100;
  const top = Math.max(step, Math.ceil(max / step) * step);
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

/** One Subject's Score across Attempts. Single series: the title names it, no legend. Crosshair snaps to the nearest Attempt. */
export function ProgressChart({ points, title }: { points: ProgressPoint[]; title: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number>();
  const height = 180;
  const margin = { top: 12, right: 20, bottom: 30, left: 40 };
  const plotW = Math.max(40, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const yTicks = ticks(Math.max(1, ...points.map((p) => p.value)));
  const yMax = yTicks.at(-1)!;
  const n = points.length;
  const x = (i: number) => margin.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => margin.top + plotH - (v / yMax) * plotH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 70))));

  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const px = clientX - svg.getBoundingClientRect().left;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    return best;
  };

  const point = active !== undefined ? points[active] : undefined;

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${title}: skor per pengerjaan`}
        tabIndex={0}
        onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget))}
        onPointerLeave={() => setActive(undefined)}
        onFocus={() => setActive(n - 1)}
        onBlur={() => setActive(undefined)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n - 1) - 1));
          if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? 0) + 1));
        }}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={margin.left}
              x2={margin.left + plotW}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--baseline)" : "var(--grid)"}
              strokeWidth={1}
            />
            <text x={margin.left - 8} y={y(t)} dy="0.35em" textAnchor="end" fontSize={12} fill="var(--ink-muted)" className="num">
              {t}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={12} fill="var(--ink-muted)">
              {p.label}
            </text>
          ) : null,
        )}
        {active !== undefined && (
          <line x1={x(active)} x2={x(active)} y1={margin.top} y2={margin.top + plotH} stroke="var(--baseline)" strokeWidth={1} />
        )}
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.value)}
            r={active === i ? 6 : 4.5}
            fill="var(--series-1)"
            stroke="var(--surface)"
            strokeWidth={2}
          />
        ))}
        {n > 0 && (
          <text x={x(n - 1)} y={y(points[n - 1]!.value) - 12} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--ink)" className="num">
            {points[n - 1]!.value}
          </text>
        )}
      </svg>
      {point && active !== undefined && (
        <Tooltip
          tip={{
            x: x(active),
            y: y(point.value),
            content: (
              <>
                <strong className="num">{point.value} poin</strong>
                <span className="secondary">
                  {point.sublabel} · {point.detail}
                </span>
              </>
            ),
          }}
        />
      )}
    </div>
  );
}

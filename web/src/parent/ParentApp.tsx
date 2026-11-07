import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type AttemptDetail, type AttemptListItem, type ReviewedResponse } from "../shared/api";
import { Markdown } from "../shared/Markdown";
import { formatClock, formatDateTime, formatSeconds } from "../shared/time";
import { DifficultyPathChart, ProgressChart } from "./charts";

const PIN_KEY = "cat-simulator.parent-pin";

function readPin(): string | undefined {
  try {
    return sessionStorage.getItem(PIN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function writePin(pin: string | undefined) {
  try {
    if (pin) sessionStorage.setItem(PIN_KEY, pin);
    else sessionStorage.removeItem(PIN_KEY);
  } catch {
    // Without storage the PIN is asked again on reload.
  }
}

/** Routes inside the Parent area, kept in the URL hash so Back works. */
type Route = { name: "attempts" } | { name: "progress" } | { name: "attempt"; id: string };
function parseHash(): Route {
  const match = /^#\/attempt\/(\w+)/.exec(location.hash);
  if (match) return { name: "attempt", id: match[1]! };
  return location.hash === "#/progress" ? { name: "progress" } : { name: "attempts" };
}

export function ParentApp() {
  const [pin, setPin] = useState(readPin);
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const call = useCallback(
    async <T,>(method: string, path: string): Promise<T> => {
      try {
        return await api<T>(method, path, undefined, { "x-parent-pin": pin ?? "" });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          writePin(undefined);
          setPin(undefined);
        }
        throw err;
      }
    },
    [pin],
  );

  if (!pin) {
    return (
      <PinScreen
        onPin={(p) => {
          writePin(p);
          setPin(p);
        }}
      />
    );
  }

  return (
    <main className="page wide">
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Tinjauan Orang Tua</h1>
        <span className="spacer" />
        <button
          className="link"
          onClick={() => {
            writePin(undefined);
            setPin(undefined);
          }}
        >
          Kunci
        </button>
      </div>
      {route.name !== "attempt" && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={route.name === "attempts"} onClick={() => (location.hash = "#/")}>
            Pengerjaan
          </button>
          <button role="tab" aria-selected={route.name === "progress"} onClick={() => (location.hash = "#/progress")}>
            Perkembangan
          </button>
        </div>
      )}
      {route.name === "attempts" && <AttemptList call={call} />}
      {route.name === "progress" && <Progress call={call} />}
      {route.name === "attempt" && <AttemptView id={route.id} call={call} />}
    </main>
  );
}

type Call = <T>(method: string, path: string) => Promise<T>;

function PinScreen({ onPin }: { onPin: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string>();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("GET", "/api/parent/attempts", undefined, { "x-parent-pin": pin });
      onPin(pin);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "PIN salah." : `Terjadi kesalahan: ${(err as Error).message}`);
    }
  };
  return (
    <main className="page">
      <form className="card stack" onSubmit={submit} style={{ maxWidth: 420, margin: "40px auto" }}>
        <h1>Tinjauan Orang Tua</h1>
        <label className="field">
          <span>PIN</span>
          <input type="password" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit" disabled={!pin}>
          Buka
        </button>
      </form>
    </main>
  );
}

function useAttempts(call: Call) {
  const [attempts, setAttempts] = useState<AttemptListItem[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    call<{ attempts: AttemptListItem[] }>("GET", "/api/parent/attempts")
      .then((r) => setAttempts(r.attempts))
      .catch((e: Error) => setError(e.message));
  }, [call]);
  return { attempts, error };
}

function StatusPill({ status }: { status: AttemptListItem["status"] }) {
  return status === "finished" ? (
    <span className="pill">✓ Selesai</span>
  ) : (
    <span className="pill warn">◷ Sedang berjalan</span>
  );
}

function AttemptList({ call }: { call: Call }) {
  const { attempts, error } = useAttempts(call);
  const [student, setStudent] = useState("");
  if (error) return <div className="error">{error}</div>;
  if (!attempts) return <p className="muted">Memuat…</p>;
  if (attempts.length === 0) return <p className="secondary">Belum ada pengerjaan.</p>;
  const students = [...new Set(attempts.map((a) => a.student))];
  const shown = attempts.filter((a) => !student || a.student === student);

  return (
    <div className="stack">
      {students.length > 1 && (
        <label className="field" style={{ maxWidth: 260 }}>
          <span>Siswa</span>
          <select value={student} onChange={(e) => setStudent(e.target.value)}>
            <option value="">Semua</option>
            {students.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      <div className="card table-scroll" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Dimulai</th>
              <th>Siswa</th>
              <th className="num">Paket</th>
              <th>Status</th>
              <th className="num">Skor</th>
              <th>Per subtes</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.attemptId} className="clickable" onClick={() => (location.hash = `#/attempt/${a.attemptId}`)}>
                <td>
                  <a href={`#/attempt/${a.attemptId}`} onClick={(e) => e.stopPropagation()}>
                    {formatDateTime(a.startedAt)}
                  </a>
                </td>
                <td>{a.student}</td>
                <td className="num">{a.setNumber}</td>
                <td>
                  <StatusPill status={a.status} />
                </td>
                <td className="num">
                  <strong>{a.score}</strong>
                </td>
                <td className="small secondary">
                  {a.subjects.map((s) => `${s.subject} ${s.score} (${s.correct} ✓)`).join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AttemptView({ id, call }: { id: string; call: Call }) {
  const [detail, setDetail] = useState<AttemptDetail>();
  const [summary, setSummary] = useState<AttemptListItem>();
  const [error, setError] = useState<string>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    call<AttemptDetail>("GET", `/api/parent/attempts/${id}`)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
    call<{ attempts: AttemptListItem[] }>("GET", "/api/parent/attempts")
      .then((r) => setSummary(r.attempts.find((a) => a.attemptId === id)))
      .catch(() => undefined);
  }, [id, call]);

  const discard = async () => {
    try {
      await call("DELETE", `/api/parent/attempts/${id}`);
      location.hash = "#/";
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="stack">
      <a href="#/">← Semua pengerjaan</a>
      {error && <div className="error">{error}</div>}
      {!detail ? (
        !error && <p className="muted">Memuat…</p>
      ) : (
        <>
          <div className="card">
            <div className="row">
              <div>
                <h2 style={{ marginBottom: 4 }}>
                  {detail.student} · Paket soal {detail.setNumber}
                </h2>
                <div className="secondary small">Dimulai {formatDateTime(detail.startedAt)}</div>
              </div>
              <span className="spacer" />
              {summary && (
                <div className="center">
                  <div className="big-number" style={{ fontSize: "2.4rem" }}>
                    {summary.score}
                  </div>
                  <div className="small secondary">poin</div>
                </div>
              )}
            </div>
            {summary?.status === "in progress" && (
              <div className="row" style={{ marginTop: 12 }}>
                <StatusPill status="in progress" />
                <span className="spacer" />
                {confirmDiscard ? (
                  <>
                    <span className="small">Buang pengerjaan ini?</span>
                    <button onClick={() => setConfirmDiscard(false)}>Batal</button>
                    <button className="danger" onClick={discard}>
                      Buang
                    </button>
                  </>
                ) : (
                  <button className="danger" onClick={() => setConfirmDiscard(true)}>
                    Buang pengerjaan…
                  </button>
                )}
              </div>
            )}
          </div>

          {detail.interruptions.length > 0 && (
            <div className="card">
              <h3>Halaman ditutup saat mengerjakan</h3>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {detail.interruptions.map((it) => (
                  <li key={it.from}>
                    Tidak aktif {formatClock(it.from)} – {formatClock(it.to)} ({formatSeconds((it.to - it.from) / 1000)})
                    {it.subject && (
                      <span className="secondary">
                        {" "}
                        saat {it.subject}
                        {it.questionNumber ? `, soal ${it.questionNumber}` : " (menunggu subtes dibuka)"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {detail.subjects.map((s) => (
            <SubjectReview key={s.subject} subject={s} setNumber={detail.setNumber} />
          ))}
        </>
      )}
    </div>
  );
}

function SubjectReview({ subject, setNumber }: { subject: AttemptDetail["subjects"][number]; setNumber: string }) {
  const score = subject.responses.reduce((sum, r) => sum + r.points, 0);
  const correct = subject.responses.filter((r) => r.correct).length;
  const lagCount = subject.responses.filter((r) => r.inLag).length;
  const time = subject.responses.reduce((sum, r) => sum + r.secondsSpent, 0);

  return (
    <section className="card stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>{subject.subject}</h2>
        <span className="spacer" />
        <span className="num">
          <strong>{score} poin</strong> · {correct}/{subject.responses.length} benar · {formatSeconds(time)}
        </span>
      </div>
      <div className="row">
        {subject.timedOut && <span className="pill warn">◷ Waktu habis: belum semua soal dijawab</span>}
        {lagCount > 0 && <span className="pill warn">⏱ {lagCount} dijawab di waktu tambahan</span>}
      </div>
      <div>
        <h3 className="secondary">Jalur kesulitan</h3>
        <DifficultyPathChart responses={subject.responses} />
      </div>
      <div>
        {subject.responses.map((r, i) => (
          <ResponseReview key={r.question.id} n={i + 1} response={r} setNumber={setNumber} />
        ))}
      </div>
    </section>
  );
}

const DIFFICULTY_LABEL = { high: "Sulit · 3 poin", medium: "Sedang · 2 poin", low: "Mudah · 1 poin" } as const;
const letter = (i: number) => "ABCD"[i] ?? "?";

function ResponseReview({ n, response: r, setNumber }: { n: number; response: ReviewedResponse; setNumber: string }) {
  const [open, setOpen] = useState(!r.correct);
  return (
    <div style={{ borderTop: "1px solid var(--grid)", padding: "12px 0" }}>
      <button
        className="link"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ width: "100%", textAlign: "left", color: "var(--ink)" }}
      >
        <span className="row" style={{ gap: 10 }}>
          <strong className="num">Soal {n}</strong>
          <span className={r.correct ? "result-good" : "result-bad"} style={{ fontWeight: 600 }}>
            {r.correct ? "✓ Benar" : "✗ Salah"}
          </span>
          <span className="secondary small">{DIFFICULTY_LABEL[r.question.difficulty]}</span>
          <span className="spacer" />
          {r.inLag && <span className="pill warn">⏱ Waktu tambahan</span>}
          <span className="small num secondary">
            {r.points} poin · {formatSeconds(r.secondsSpent)}
          </span>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <Markdown text={r.question.text} setNumber={setNumber} />
          <ul className="review-options">
            {r.question.options.map((option, i) => {
              const picked = r.selected.includes(i);
              const right = r.question.correctOptions.includes(i);
              return (
                <li key={i} className={picked ? "picked" : ""}>
                  <span className={`mark ${right ? "result-good" : picked ? "result-bad" : "muted"}`}>
                    {picked && right && "✓ Dipilih, benar"}
                    {picked && !right && "✗ Dipilih, salah"}
                    {!picked && right && "✓ Jawaban benar"}
                  </span>
                  <strong>{letter(i)}</strong>
                  <span>
                    <Markdown text={option} setNumber={setNumber} inline />
                  </span>
                </li>
              );
            })}
          </ul>
          {r.selectionChanges.length > 1 && (
            <p className="small secondary" style={{ marginTop: 8 }}>
              Ganti jawaban:{" "}
              {r.selectionChanges
                .map((c) => `${c.selected.map(letter).join("+") || "kosong"} (${formatClock(c.at)})`)
                .join(" → ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Progress({ call }: { call: Call }) {
  const { attempts, error } = useAttempts(call);
  const students = useMemo(() => [...new Set((attempts ?? []).map((a) => a.student))], [attempts]);
  const [student, setStudent] = useState("");
  const current = student || students[0] || "";

  if (error) return <div className="error">{error}</div>;
  if (!attempts) return <p className="muted">Memuat…</p>;

  const finished = attempts.filter((a) => a.student === current && a.status === "finished").reverse(); // oldest first
  if (finished.length === 0) return <p className="secondary">Belum ada pengerjaan yang selesai.</p>;

  const subjectNames = [...new Set(finished.flatMap((a) => a.subjects.map((s) => s.subject)))];
  const shortDate = (ms: number) => new Date(ms).toLocaleDateString("id-ID", { day: "numeric", month: "short" });

  return (
    <div className="stack">
      {students.length > 1 && (
        <label className="field" style={{ maxWidth: 260 }}>
          <span>Siswa</span>
          <select value={current} onChange={(e) => setStudent(e.target.value)}>
            {students.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      <div className="grid-2">
        {subjectNames.map((name) => (
          <section className="card" key={name}>
            <h3>{name}: poin per pengerjaan</h3>
            <ProgressChart
              title={name}
              points={finished.flatMap((a) => {
                const s = a.subjects.find((x) => x.subject === name);
                return s
                  ? [
                      {
                        label: shortDate(a.startedAt),
                        sublabel: `Paket ${a.setNumber}, ${formatDateTime(a.startedAt)}`,
                        value: s.score,
                        detail: `${s.correct} benar`,
                      },
                    ]
                  : [];
              })}
            />
          </section>
        ))}
      </div>
      <div className="card table-scroll" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th className="num">Paket</th>
              {subjectNames.map((n) => (
                <th key={n} className="num">
                  {n}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {finished.map((a) => (
              <tr key={a.attemptId} className="clickable" onClick={() => (location.hash = `#/attempt/${a.attemptId}`)}>
                <td>{formatDateTime(a.startedAt)}</td>
                <td className="num">{a.setNumber}</td>
                {subjectNames.map((n) => {
                  const s = a.subjects.find((x) => x.subject === n);
                  return (
                    <td key={n} className="num">
                      {s ? `${s.score} (${s.correct} ✓)` : "–"}
                    </td>
                  );
                })}
                <td className="num">
                  <strong>{a.score}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

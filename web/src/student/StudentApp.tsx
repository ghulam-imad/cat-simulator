import { useEffect, useRef, useState } from "react";
import { api, ApiError, type SetSummary, type StudentReply, type StudentView } from "../shared/api";
import { Markdown } from "../shared/Markdown";
import { formatDuration, useServerClock } from "../shared/time";

/** Remembered in this browser so closing and reopening the tab goes straight back to the Attempt. */
interface Session {
  student: string;
  setNumber: string;
}
const SESSION_KEY = "cat-simulator.session";

function loadSession(): Session | undefined {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : undefined;
  } catch {
    return undefined;
  }
}
function saveSession(session: Session | undefined) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked: resuming then needs logging in again, which the server also supports.
  }
}

/** Indonesian text for the server's login errors (the server's own messages are English). */
function loginErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "Paket soal tidak ditemukan.";
    if (err.status === 400) return "Nama ini tidak ada di daftar siswa.";
    if (err.status === 422) return "Paket soal ini belum bisa dipakai.";
    return `Terjadi kesalahan: ${err.message}`;
  }
  return "Tidak bisa terhubung ke CAT Simulator. Apakah servernya menyala?";
}

type Screen =
  | { name: "loading" }
  | { name: "login"; student?: string }
  | { name: "start"; session: Session; summary: SetSummary }
  | { name: "exam"; session: Session; reply: StudentReply };

export function StudentApp() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });

  // On opening the page: resume an Attempt still in progress, otherwise show the login.
  useEffect(() => {
    const session = loadSession();
    if (!session) return setScreen({ name: "login" });
    (async () => {
      try {
        const summary = await api<SetSummary>("GET", setPath(session));
        if (!summary.inProgress) {
          saveSession(undefined);
          return setScreen({ name: "login", student: session.student });
        }
        const reply = await api<StudentReply>("POST", "/api/attempts", session);
        setScreen({ name: "exam", session, reply });
      } catch {
        saveSession(undefined);
        setScreen({ name: "login", student: session.student });
      }
    })();
  }, []);

  switch (screen.name) {
    case "loading":
      return <div className="page muted">Memuat…</div>;
    case "login":
      return (
        <Login
          initialStudent={screen.student}
          onReady={(session, summary) => setScreen({ name: "start", session, summary })}
        />
      );
    case "start":
      return (
        <Start
          session={screen.session}
          summary={screen.summary}
          onBack={() => setScreen({ name: "login", student: screen.session.student })}
          onStarted={(reply) => {
            saveSession(screen.session);
            setScreen({ name: "exam", session: screen.session, reply });
          }}
        />
      );
    case "exam":
      return (
        <Exam
          session={screen.session}
          initial={screen.reply}
          onDone={() => {
            saveSession(undefined);
            setScreen({ name: "login", student: screen.session.student });
          }}
        />
      );
  }
}

const setPath = (s: Session) =>
  `/api/sets/${encodeURIComponent(s.setNumber)}?student=${encodeURIComponent(s.student)}`;

function Login({
  initialStudent,
  onReady,
}: {
  initialStudent?: string;
  onReady: (session: Session, summary: SetSummary) => void;
}) {
  const [students, setStudents] = useState<string[]>();
  const [sets, setSets] = useState<{ name: string; ready: boolean }[]>();
  const [student, setStudent] = useState(initialStudent ?? "");
  const [setNumber, setSetNumber] = useState("");
  const [error, setError] = useState<{ message: string; problems?: string[] }>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ students: string[] }>("GET", "/api/students"),
      api<{ sets: { name: string; ready: boolean }[] }>("GET", "/api/sets"),
    ])
      .then(([s, p]) => {
        setStudents(s.students);
        setSets(p.sets);
      })
      .catch((err) => setError({ message: loginErrorText(err) }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const session = { student, setNumber };
    try {
      onReady(session, await api<SetSummary>("GET", setPath(session)));
    } catch (err) {
      const problems = err instanceof ApiError ? (err.body.problems as string[] | undefined) : undefined;
      setError({ message: loginErrorText(err), problems });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <form className="card stack" onSubmit={submit}>
        <h1>Latihan CAT</h1>
        <div>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>Siapa kamu?</p>
          <div className="names" role="group" aria-label="Siswa">
            {students?.map((name) => (
              <button type="button" key={name} aria-pressed={name === student} onClick={() => setStudent(name)}>
                {name}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Paket soal</span>
          <select value={setNumber} onChange={(e) => setSetNumber(e.target.value)} disabled={!sets}>
            <option value="" disabled>
              {sets?.length === 0 ? "Belum ada paket soal" : "Pilih paket soal…"}
            </option>
            {sets?.map((s) => (
              <option key={s.name} value={s.name}>
                {s.ready ? s.name : `${s.name} (perlu diperbaiki)`}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <div className="error" role="alert">
            {error.message}
            {error.problems && (
              <>
                <div className="small" style={{ marginTop: 6 }}>
                  Minta orang tua memperbaiki hal berikut di paket soal:
                </div>
                <ul className="small">
                  {error.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <button className="primary" type="submit" disabled={!student || !setNumber || busy}>
          Lanjut
        </button>
      </form>
    </main>
  );
}

function Start({
  session,
  summary,
  onBack,
  onStarted,
}: {
  session: Session;
  summary: SetSummary;
  onBack: () => void;
  onStarted: (reply: StudentReply) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [choosing, setChoosing] = useState(false);
  // An Attempt in progress keeps the Subjects it started with; otherwise every Subject is picked until unticked.
  const [picked, setPicked] = useState<string[]>(() => summary.inProgress?.subjects ?? summary.subjects.map((s) => s.name));
  const resuming = summary.inProgress !== null;
  const shown = resuming ? summary.subjects.filter((s) => picked.includes(s.name)) : summary.subjects;
  const runs = shown.filter((s) => picked.includes(s.name));
  const totalMinutes = runs.reduce((sum, s) => sum + s.workMinutes, 0);
  const partial = runs.length < summary.subjects.length;

  const toggle = (name: string) =>
    setPicked((now) => (now.includes(name) ? now.filter((n) => n !== name) : [...now, name]));

  const start = async () => {
    setBusy(true);
    try {
      const body = !resuming && partial ? { ...session, subjects: picked } : session;
      onStarted(await api<StudentReply>("POST", "/api/attempts", body));
    } catch (err) {
      setError(loginErrorText(err));
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <div className="card stack">
        <h1>
          Halo, {session.student}! Paket soal {summary.setNumber}
        </h1>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {choosing && (
                  <th className="pick">
                    <span className="visually-hidden">Kerjakan</span>
                  </th>
                )}
                <th>Subtes</th>
                <th className="num">Soal</th>
                <th className="num">Waktu</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const on = picked.includes(s.name);
                return (
                  <tr key={s.name} className={on ? undefined : "skipped"}>
                    {choosing && (
                      <td className="pick">
                        <input
                          type="checkbox"
                          id={`pick-${s.name}`}
                          checked={on}
                          onChange={() => toggle(s.name)}
                          disabled={busy}
                        />
                      </td>
                    )}
                    <td>
                      {choosing ? <label htmlFor={`pick-${s.name}`}>{s.name}</label> : s.name}
                      {!on && <span className="muted small"> · dilewati</span>}
                    </td>
                    <td className="num">{s.questionCount}</td>
                    <td className="num">{s.workMinutes} menit</td>
                  </tr>
                );
              })}
              <tr>
                {choosing && <td />}
                <td>
                  <strong>Total</strong>
                </td>
                <td />
                <td className="num">
                  <strong>{totalMinutes} menit</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {resuming ? (
          <>
            {partial && <p className="muted small">Kamu hanya mengerjakan subtes yang dipilih.</p>}
            <p>Kamu sudah mulai mengerjakan paket ini dan waktunya tetap berjalan. Tekan Lanjutkan untuk kembali.</p>
          </>
        ) : (
          <>
            <div className="advanced">
              <button
                type="button"
                className="link"
                aria-expanded={choosing}
                onClick={() => setChoosing((open) => !open)}
                disabled={busy}
              >
                {choosing ? "▾" : "▸"} Opsi lanjutan: pilih subtes
              </button>
              {choosing && (
                <p className="muted small">
                  Hapus centang subtes yang tidak ingin dikerjakan. Urutan, waktu, dan skor tetap mengikuti paket soal.
                </p>
              )}
              {runs.length === 0 && <div className="error">Pilih paling sedikit satu subtes.</div>}
            </div>
            <ul className="secondary">
              <li>Setelah kamu menekan Mulai, waktu berjalan untuk semua subtes{partial ? " yang dipilih" : ""}.</li>
              <li>Jawab setiap soal, lalu tekan Lanjut. Kamu tidak bisa kembali ke soal sebelumnya.</li>
              <li>Jika ada tulisan "Pilih semua jawaban yang benar", centang semua jawaban yang benar.</li>
            </ul>
          </>
        )}
        {error && <div className="error">{error}</div>}
        <div className="row">
          <button onClick={onBack} disabled={busy}>
            Kembali
          </button>
          <span className="spacer" />
          <button className="primary" onClick={start} disabled={busy || runs.length === 0}>
            {resuming ? "Lanjutkan" : "Mulai"}
          </button>
        </div>
      </div>
    </main>
  );
}

const HEARTBEAT_MS = 10_000;

function Exam({ session, initial, onDone }: { session: Session; initial: StudentReply; onDone: () => void }) {
  const [reply, setReply] = useState(initial);
  const attemptId = useRef(initial.attemptId!).current;
  const now = useServerClock(reply.now);
  const refreshing = useRef(false);

  const refresh = async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      setReply(await api<StudentReply>("POST", `/api/attempts/${attemptId}/heartbeat`));
    } catch {
      // Network blip: the next heartbeat tries again.
    } finally {
      refreshing.current = false;
    }
  };

  // Tell the server the page is open (gaps become Interruptions in the Parent review).
  useEffect(() => {
    const id = setInterval(refresh, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, []);

  // When a countdown reaches zero, ask the server what comes next.
  const view = reply.view;
  const boundary =
    view.kind === "question" ? view.closesAt : view.kind === "waiting" ? view.opensAt : undefined;
  useEffect(() => {
    if (boundary !== undefined && now >= boundary) void refresh();
  }, [boundary !== undefined && now >= boundary]);

  const act = async (path: "selection" | "responses", selected: number[]) => {
    try {
      const next = await api<StudentReply>("POST", `/api/attempts/${attemptId}/${path}`, { selected });
      if (path === "responses" || next.view.kind !== "question") setReply(next);
    } catch (err) {
      if (err instanceof ApiError && err.body.view) setReply(err.body as unknown as StudentReply);
    }
  };

  return (
    <>
      {view.kind === "question" && (
        <QuestionScreen
          key={`${view.subject}-${view.questionNumber}`}
          view={view}
          now={now}
          endsAt={reply.endsAt}
          setNumber={session.setNumber}
          onSelect={(selected) => act("selection", selected)}
          onSubmit={(selected) => act("responses", selected)}
        />
      )}
      {view.kind === "waiting" && <Waiting view={view} now={now} />}
      {view.kind === "finished" && <Finished view={view} student={session.student} onDone={onDone} />}
    </>
  );
}

function QuestionScreen({
  view,
  now,
  endsAt,
  setNumber,
  onSelect,
  onSubmit,
}: {
  view: Extract<StudentView, { kind: "question" }>;
  now: number;
  endsAt: number;
  setNumber: string;
  onSelect: (selected: number[]) => void;
  onSubmit: (selected: number[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<number[]>(view.selected);
  const [busy, setBusy] = useState(false);
  const multi = view.question.multiAnswer;
  const inLag = now >= view.workEndsAt;

  const toggle = (i: number) => {
    const next = multi
      ? selected.includes(i)
        ? selected.filter((x) => x !== i)
        : [...selected, i].sort((a, b) => a - b)
      : [i];
    setSelected(next);
    onSelect(next);
  };

  const submit = async () => {
    setBusy(true);
    await onSubmit(selected);
    setBusy(false);
  };

  return (
    <>
      <header className="exam-bar">
        <div className="inner">
          <div>
            <strong>{view.subject}</strong>
            <div className="small muted">
              Soal {view.questionNumber} dari {view.questionCount}
            </div>
          </div>
          <span className="spacer" />
          <div className="small muted num" title="Sisa waktu untuk seluruh paket soal">
            Sisa waktu total {formatDuration(endsAt - now)}
          </div>
          <div className={`timer ${inLag ? "lag" : ""}`} aria-live="off">
            <span className="timer-label">{inLag ? "Waktu tambahan" : "Sisa waktu"}</span>
            {formatDuration((inLag ? view.closesAt : view.workEndsAt) - now)}
          </div>
        </div>
        <div className="progress-track" aria-hidden="true">
          <div
            className="progress-fill"
            style={{ width: `${((view.questionNumber - 1) / view.questionCount) * 100}%` }}
          />
        </div>
        {inLag && (
          <div className="lag-banner" role="status">
            Kamu sedang memakai waktu tambahan. Waktu ini diambil dari subtes berikutnya.
          </div>
        )}
      </header>
      <main className="page stack">
        <div className="card question-text">
          <Markdown text={view.question.text} setNumber={setNumber} />
        </div>
        {multi && (
          <p>
            <strong>Pilih semua jawaban yang benar.</strong>
          </p>
        )}
        <div className="options" role={multi ? "group" : "radiogroup"} aria-label="Pilihan jawaban">
          {view.question.options.map((option, i) => (
            <label key={i} className={`option ${selected.includes(i) ? "checked" : ""}`}>
              <input
                type={multi ? "checkbox" : "radio"}
                name="answer"
                checked={selected.includes(i)}
                onChange={() => toggle(i)}
              />
              <span className="option-letter">{"ABCD"[i]}</span>
              <span className="option-body">
                <Markdown text={option} setNumber={setNumber} inline />
              </span>
            </label>
          ))}
        </div>
        <div className="row">
          <span className="spacer" />
          <button className="primary" onClick={submit} disabled={selected.length === 0 || busy}>
            {view.questionNumber === view.questionCount ? "Selesaikan subtes" : "Lanjut"}
          </button>
        </div>
      </main>
    </>
  );
}

function Waiting({ view, now }: { view: Extract<StudentView, { kind: "waiting" }>; now: number }) {
  return (
    <main className="page">
      <div className="card center stack">
        <h1>Bagus! Istirahat sebentar, ya.</h1>
        <p className="secondary">{view.nextSubject} dimulai dalam</p>
        <div className="big-number">{formatDuration(view.opensAt - now)}</div>
        <p className="muted small">Subtes akan dimulai otomatis. Tetap di halaman ini.</p>
      </div>
    </main>
  );
}

function Finished({
  view,
  student,
  onDone,
}: {
  view: Extract<StudentView, { kind: "finished" }>;
  student: string;
  onDone: () => void;
}) {
  const total = view.subjects.reduce((sum, s) => sum + s.score, 0);
  return (
    <main className="page">
      <div className="card stack">
        <h1>Selesai, {student}!</h1>
        <div className="center">
          <div className="big-number">{total}</div>
          <div className="secondary">poin</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Subtes</th>
              <th className="num">Poin</th>
              <th className="num">Benar</th>
            </tr>
          </thead>
          <tbody>
            {view.subjects.map((s) => (
              <tr key={s.subject}>
                <td>{s.subject}</td>
                <td className="num">{s.score}</td>
                <td className="num">
                  {s.correct} / {s.questions}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="secondary">Bahas jawabanmu bersama orang tua, ya.</p>
        <div className="row">
          <span className="spacer" />
          <button className="primary" onClick={onDone}>
            Selesai
          </button>
        </div>
      </div>
    </main>
  );
}

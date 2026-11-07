import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type Context, Hono } from "hono";
import { loadExerciseSet, setName } from "../content/load-exercise-set.js";
import { type Attempt, changeSelection, reviewAt, startAttempt, submitResponse, type View, viewAt } from "../engine/attempt.js";
import type { ExerciseSet } from "../engine/exercise-set.js";
import { selectSubjects } from "../engine/select-subjects.js";
import { type AttemptRow, AttemptStore } from "./attempt-store.js";

export interface AppOptions {
  db: DatabaseSync;
  /** Folder holding one sub-folder per Exercise Set, e.g. `sets/007`. */
  setsDir: string;
  students: string[];
  parentPin: string;
  now?: () => number;
  random?: () => number;
}

export function createApp(opts: AppOptions) {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const store = new AttemptStore(opts.db);
  const app = new Hono();

  const loadSet = (setNumber: string): ExerciseSet => {
    const loaded = loadExerciseSet(findSetFolder(opts.setsDir, setNumber)!);
    if (!loaded.ok) throw new Error(loaded.problems.join("\n"));
    return loaded.set;
  };

  /** The Exercise Set as this Attempt runs it: only its Selected Subjects, if it picked some. */
  const setFor = (row: AttemptRow): ExerciseSet => {
    const set = loadSet(row.setNumber);
    return row.subjects ? selectSubjects(set, row.subjects) : set;
  };

  /** The Exercise Set's Subjects this Attempt left out, in the set's order. */
  const skippedSubjects = (row: AttemptRow): string[] =>
    row.subjects ? loadSet(row.setNumber).subjects.map((s) => s.name).filter((name) => !row.subjects!.includes(name)) : [];

  /**
   * Rebuilds an Attempt by replaying its saved events through the engine.
   * Saved random numbers are reused first; any new ones drawn are saved for the next replay.
   */
  const rebuild = (row: AttemptRow) => {
    const values = [...row.randomValues];
    let next = 0;
    const replayingRandom = () => {
      if (next === values.length) values.push(random());
      return values[next++]!;
    };
    let attempt = startAttempt(setFor(row), {
      student: row.student,
      startedAt: row.startedAt,
      random: replayingRandom,
    });
    const interruptions: Interruption[] = [];
    let lastActivity = row.startedAt;
    for (const event of store.events(row.id)) {
      if (event.at - lastActivity > INTERRUPTION_GAP_MS) {
        interruptions.push({ from: lastActivity, to: event.at, ...whereAt(attempt, lastActivity) });
      }
      lastActivity = event.at;
      if (event.kind === "response") attempt = submitResponse(attempt, event.selected, event.at);
      if (event.kind === "selection") attempt = changeSelection(attempt, event.selected, event.at);
    }
    // Closed and never reopened before the Exercise Set ran out (finishing every Question ends it sooner, with no gap).
    const endsAt = setEndsAt(attempt);
    if (attempt.cursor !== "finished" && now() >= endsAt && endsAt - lastActivity > INTERRUPTION_GAP_MS) {
      interruptions.push({ from: lastActivity, to: endsAt, ...whereAt(attempt, lastActivity) });
    }
    const saveDraws = () => {
      if (values.length > row.randomValues.length) store.saveRandomValues(row.id, values);
    };
    return { attempt, saveDraws, interruptions };
  };

  /** What the Student's page receives: the View (answers removed), the server's time, and when the Exercise Set ends. */
  const studentReply = (attempt: Attempt) => {
    const at = now();
    return { now: at, endsAt: setEndsAt(attempt), view: forStudent(viewAt(attempt, at)) };
  };

  app.get("/api/students", (c) => c.json({ students: opts.students }));

  /** Checks a Student and Exercise Set number at login; returns the set, or the error to reply with. */
  const checkLogin = (student: string, setNumber: string) => {
    if (!opts.students.includes(student)) {
      return { error: { error: `${student} is not on the Student list.` }, status: 400 as const };
    }
    const folder = findSetFolder(opts.setsDir, setNumber);
    if (!folder) return { error: { error: `There is no Exercise Set ${setNumber}.` }, status: 404 as const };
    const loaded = loadExerciseSet(folder);
    if (!loaded.ok) {
      return {
        error: { error: `Exercise Set ${setNumber} can't be used yet.`, problems: loaded.problems },
        status: 422 as const,
      };
    }
    return { set: loaded.set };
  };

  /** The Student's Attempt at this Exercise Set that hasn't finished yet, if any. */
  const inProgressAttempt = (student: string, setNumber: string) => {
    const latest = store.latest(student, setNumber);
    if (!latest) return undefined;
    const { attempt } = rebuild(latest);
    return viewAt(attempt, now()).kind === "finished" ? undefined : { row: latest, attempt };
  };

  app.get("/api/sets", (c) => {
    const sets = readdirSync(opts.setsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: setName(entry.name), ready: loadExerciseSet(join(opts.setsDir, entry.name)).ok }))
      .sort((a, b) => {
        const [x, y] = [Number(a.name), Number(b.name)];
        if (Number.isInteger(x) && Number.isInteger(y)) return x - y;
        if (Number.isInteger(x) !== Number.isInteger(y)) return Number.isInteger(x) ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    return c.json({ sets });
  });

  app.get("/api/sets/:number", (c) => {
    const setNumber = c.req.param("number");
    const student = c.req.query("student") ?? "";
    const checked = checkLogin(student, setNumber);
    if (!checked.set) return c.json(checked.error, checked.status);
    const subjects = checked.set.subjects.map((s) => ({
      name: s.name,
      workMinutes: s.workMinutes,
      leadMinutes: s.leadMinutes,
      lagMinutes: s.lagMinutes,
      questionCount: s.questions.filter((q) => q.difficulty === "medium").length,
    }));
    return c.json({
      setNumber: checked.set.number,
      totalMinutes: subjects.reduce((sum, s) => sum + s.workMinutes, 0),
      subjects,
      inProgress: (() => {
        const open = inProgressAttempt(student, checked.set.number);
        return open ? { subjects: open.attempt.set.subjects.map((s) => s.name) } : null;
      })(),
    });
  });

  app.get("/api/sets/:number/files/*", (c) => {
    const setNumber = c.req.param("number");
    const folder = findSetFolder(opts.setsDir, setNumber);
    const prefix = `/api/sets/${setNumber}/files/`;
    const rawPath = new URL(c.req.url).pathname;
    const file = folder && rawPath.startsWith(prefix) ? imageInFolder(folder, rawPath.slice(prefix.length)) : undefined;
    if (!file) return c.json({ error: "No such picture." }, 404);
    return c.body(readFileSync(file.path), 200, { "content-type": file.type });
  });

  app.post("/api/attempts", async (c) => {
    const { student, setNumber, subjects } = await c.req.json<{ student: string; setNumber: string; subjects?: string[] }>();
    const checked = checkLogin(student, setNumber);
    if (!checked.set) return c.json(checked.error, checked.status);
    if (subjects !== undefined) {
      try {
        if (!Array.isArray(subjects)) throw new Error("Subjects must be a list of Subject names.");
        selectSubjects(checked.set, subjects);
      } catch (refusal) {
        return c.json({ error: (refusal as Error).message }, 400);
      }
    }
    // Saved under the set's own name, so "007"/"7" or "Labsky-001"/"labsky-001" resume the same Attempt.
    const open = inProgressAttempt(student, checked.set.number);
    if (open) {
      store.append(open.row.id, { kind: "heartbeat", at: now() });
      return c.json({ attemptId: open.row.id, ...studentReply(open.attempt) });
    }
    // An Attempt that picked every Subject is saved as an ordinary one.
    const picked = subjects && checked.set.subjects.some((s) => !subjects.includes(s.name)) ? subjects : undefined;
    const attemptId = store.create(student, checked.set.number, now(), picked);
    const { attempt, saveDraws } = rebuild(store.get(attemptId)!);
    saveDraws();
    return c.json({ attemptId, ...studentReply(attempt) });
  });

  /** Applies one Student action to the Attempt and saves it. */
  const act = (kind: "response" | "selection") => async (c: Context) => {
    const id = c.req.param("id")!;
    const { selected } = await c.req.json<{ selected: number[] }>();
    const { attempt, saveDraws } = rebuild(store.get(id)!);
    const at = now();
    let updated: Attempt;
    try {
      updated = kind === "response" ? submitResponse(attempt, selected, at) : changeSelection(attempt, selected, at);
    } catch (refusal) {
      return c.json({ error: (refusal as Error).message, ...studentReply(attempt) }, 409);
    }
    store.append(id, { kind, selected, at });
    saveDraws();
    return c.json(studentReply(updated));
  };

  app.post("/api/attempts/:id/heartbeat", (c) => {
    const id = c.req.param("id");
    store.append(id, { kind: "heartbeat", at: now() });
    return c.json(studentReply(rebuild(store.get(id)!).attempt));
  });

  app.post("/api/attempts/:id/responses", act("response"));
  app.post("/api/attempts/:id/selection", act("selection"));

  app.use("/api/parent/*", async (c, next) => {
    if (c.req.header("x-parent-pin") !== opts.parentPin) return c.json({ error: "Wrong PIN." }, 401);
    await next();
  });

  app.get("/api/parent/attempts", (c) =>
    c.json({
      attempts: store.all().map((row) => {
        const { attempt } = rebuild(row);
        const subjects = reviewAt(attempt, now()).subjects.map((s) => ({
          subject: s.subject,
          score: s.responses.reduce((sum, r) => sum + r.points, 0),
          correct: s.responses.filter((r) => r.correct).length,
        }));
        return {
          attemptId: row.id,
          student: row.student,
          setNumber: row.setNumber,
          startedAt: row.startedAt,
          status: viewAt(attempt, now()).kind === "finished" ? "finished" : "in progress",
          score: subjects.reduce((sum, s) => sum + s.score, 0),
          skippedSubjects: skippedSubjects(row),
          subjects,
        };
      }),
    }),
  );

  app.get("/api/parent/attempts/:id", (c) => {
    const row = store.get(c.req.param("id"));
    if (!row) return c.json({ error: "No such Attempt." }, 404);
    const { attempt, interruptions } = rebuild(row);
    return c.json({
      interruptions,
      attemptId: row.id,
      student: row.student,
      setNumber: row.setNumber,
      startedAt: row.startedAt,
      skippedSubjects: skippedSubjects(row),
      ...reviewAt(attempt, now()),
    });
  });

  app.delete("/api/parent/attempts/:id", (c) => {
    const row = store.get(c.req.param("id"));
    if (!row) return c.json({ error: "No such Attempt." }, 404);
    if (viewAt(rebuild(row).attempt, now()).kind === "finished") {
      return c.json({ error: "Only an Attempt still in progress can be discarded." }, 409);
    }
    store.discard(row.id, now());
    return c.json({ discarded: row.id });
  });

  return app;
}

/** When the whole Exercise Set ends: Start plus the sum of the Work Times. */
function setEndsAt(attempt: Attempt): number {
  return attempt.startedAt + attempt.set.subjects.reduce((sum, s) => sum + s.workMinutes, 0) * 60_000;
}

/** A gap in the Student's activity longer than this means their page was closed. */
const INTERRUPTION_GAP_MS = 30_000;

interface Interruption {
  from: number;
  to: number;
  subject: string;
  /** Which Question of the Subject was on screen; absent if the Student was waiting for the Subject to open. */
  questionNumber?: number;
}

/** The Subject and Question number the Student was on at time `at`. */
function whereAt(attempt: Attempt, at: number): { subject: string; questionNumber?: number } {
  const view = viewAt(attempt, at);
  if (view.kind === "waiting") return { subject: view.nextSubject };
  if (view.kind === "finished") return { subject: "" };
  const subjectIndex = attempt.set.subjects.findIndex((s) => s.name === view.subject);
  return {
    subject: view.subject,
    questionNumber: attempt.responses.filter((r) => r.subjectIndex === subjectIndex).length + 1,
  };
}

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * Resolves an encoded relative path to an image file inside `folder`.
 * Anything that isn't an image (notably the Subject .md files, which hold the answers)
 * or that lands outside the folder, including via symlinks, is refused.
 */
function imageInFolder(folder: string, encodedPath: string): { path: string; type: string } | undefined {
  let relative: string;
  try {
    relative = decodeURIComponent(encodedPath);
  } catch {
    return undefined;
  }
  const type = IMAGE_TYPES[extname(relative).toLowerCase()];
  const candidate = resolve(folder, relative);
  if (!type || !existsSync(candidate)) return undefined;
  const root = realpathSync(folder);
  const real = realpathSync(candidate);
  if (!real.startsWith(root + sep) || !statSync(real).isFile()) return undefined;
  return { path: real, type };
}

/** `7` finds `sets/007` or `sets/7`; `Labsky-001` finds `sets/labsky-001` (case doesn't matter). */
function findSetFolder(setsDir: string, setNumber: string): string | undefined {
  const wanted = setName(setNumber.trim()).toLowerCase();
  const name = readdirSync(setsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .find((entry) => setName(entry).toLowerCase() === wanted);
  return name === undefined ? undefined : join(setsDir, name);
}

/** The View as the Student's page may see it: no Correct Options, no Difficulty. */
function forStudent(view: View) {
  if (view.kind !== "question") return view;
  const { question } = view;
  return {
    ...view,
    question: { text: question.text, options: question.options, multiAnswer: question.correctOptions.length > 1 },
  };
}

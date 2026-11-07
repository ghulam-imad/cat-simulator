import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type Context, Hono } from "hono";
import { loadExerciseSet } from "../content/load-exercise-set.js";
import { type Attempt, changeSelection, reviewAt, startAttempt, submitResponse, type View, viewAt } from "../engine/attempt.js";
import type { ExerciseSet } from "../engine/exercise-set.js";
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
    let attempt = startAttempt(loadSet(row.setNumber), {
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
    const setEndsAt = row.startedAt + attempt.set.subjects.reduce((sum, s) => sum + s.workMinutes, 0) * 60_000;
    if (attempt.cursor !== "finished" && now() >= setEndsAt && setEndsAt - lastActivity > INTERRUPTION_GAP_MS) {
      interruptions.push({ from: lastActivity, to: setEndsAt, ...whereAt(attempt, lastActivity) });
    }
    const saveDraws = () => {
      if (values.length > row.randomValues.length) store.saveRandomValues(row.id, values);
    };
    return { attempt, saveDraws, interruptions };
  };

  const studentView = (attempt: Attempt) => forStudent(viewAt(attempt, now()));

  app.get("/api/students", (c) => c.json({ students: opts.students }));

  app.post("/api/attempts", async (c) => {
    const { student, setNumber } = await c.req.json<{ student: string; setNumber: string }>();
    if (!opts.students.includes(student)) return c.json({ error: `${student} is not on the Student list.` }, 400);
    const folder = findSetFolder(opts.setsDir, setNumber);
    if (!folder) return c.json({ error: `There is no Exercise Set ${setNumber}.` }, 404);
    const loaded = loadExerciseSet(folder);
    if (!loaded.ok) {
      return c.json({ error: `Exercise Set ${setNumber} can't be used yet.`, problems: loaded.problems }, 422);
    }
    const latest = store.latest(student, setNumber);
    if (latest) {
      const { attempt } = rebuild(latest);
      if (viewAt(attempt, now()).kind !== "finished") {
        store.append(latest.id, { kind: "heartbeat", at: now() });
        return c.json({ attemptId: latest.id, view: studentView(attempt) });
      }
    }
    const attemptId = store.create(student, setNumber, now());
    const { attempt, saveDraws } = rebuild(store.get(attemptId)!);
    saveDraws();
    return c.json({ attemptId, view: studentView(attempt) });
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
      return c.json({ error: (refusal as Error).message, view: studentView(attempt) }, 409);
    }
    store.append(id, { kind, selected, at });
    saveDraws();
    return c.json({ view: studentView(updated) });
  };

  app.post("/api/attempts/:id/heartbeat", (c) => {
    const id = c.req.param("id");
    store.append(id, { kind: "heartbeat", at: now() });
    return c.json({ view: studentView(rebuild(store.get(id)!).attempt) });
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

/** `7` finds `sets/007` or `sets/7`. */
function findSetFolder(setsDir: string, setNumber: string): string | undefined {
  const name = readdirSync(setsDir).find((entry) => Number(entry) === Number(setNumber));
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

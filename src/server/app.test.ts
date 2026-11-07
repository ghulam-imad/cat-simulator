import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { createApp } from "./app.js";

const T0 = Date.UTC(2026, 10, 7, 9, 0, 0);
const minute = (m: number) => T0 + m * 60_000;

/** Math (work 20, lag 5) then English (lead 5, work 10); 2 Questions per Pool; Option "a" is always correct. */
function setsDirWithSet7(): string {
  const setsDir = mkdtempSync(join(tmpdir(), "cat-sets-"));
  const folder = join(setsDir, "007");
  mkdirSync(folder);
  const subjectFile = (name: string, times: string) => {
    const blocks = ["high", "high", "medium", "medium", "low", "low"].map(
      (d, i) => `## difficulty: ${d}\n${name} question ${i + 1} (${d})\n\n- [x] a\n- [ ] b\n- [ ] c\n- [ ] d\n`,
    );
    return `# ${name}\n${times}\n\n${blocks.join("\n")}`;
  };
  writeFileSync(join(folder, "1-math.md"), subjectFile("Math", "work: 20 min\nlag: 5 min"));
  writeFileSync(join(folder, "2-english.md"), subjectFile("English", "work: 10 min\nlead: 5 min"));
  return setsDir;
}

/** A running app plus a hand-controlled clock. `restart()` builds a fresh app on the same database file. */
function harness(opts: { random?: () => number } = {}) {
  const setsDir = setsDirWithSet7();
  const dbPath = join(mkdtempSync(join(tmpdir(), "cat-db-")), "cat.sqlite");
  const clock = { now: T0 };
  const build = (random = opts.random ?? (() => 0)) =>
    createApp({
      db: new DatabaseSync(dbPath),
      setsDir,
      students: ["Aisha", "Omar"],
      parentPin: "4321",
      now: () => clock.now,
      random,
    });
  let app = build();
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return {
    setsDir,
    clock,
    call,
    restart: (random?: () => number) => {
      app = build(random);
    },
  };
}

describe("Student", () => {
  test("starting an Attempt shows the first Question without revealing its answer", async () => {
    const { call } = harness();

    const res = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    expect(res.status).toBe(200);
    expect(res.body.view).toEqual({
      kind: "question",
      subject: "Math",
      question: {
        text: "Math question 3 (medium)",
        options: ["a", "b", "c", "d"],
        multiAnswer: false,
      },
      selected: [],
    });
  });

  test("submitting a Response moves on to the next Question", async () => {
    const { call, clock } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    clock.now = minute(1);
    const res = await call("POST", `/api/attempts/${body.attemptId}/responses`, { selected: [0] });

    expect(res.body.view).toMatchObject({ kind: "question", question: { text: "Math question 1 (high)" } });
  });

  test("after a restart, logging in again resumes the same Attempt at the same Question", async () => {
    const { call, clock, restart } = harness({ random: () => 0.99 }); // draws the last Question in each Pool
    const started = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(1);
    await call("POST", `/api/attempts/${started.body.attemptId}/responses`, { selected: [0] });

    restart(() => 0); // would draw different Questions if the saved draws weren't replayed
    clock.now = minute(2);
    const resumed = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    expect(resumed.body.attemptId).toBe(started.body.attemptId);
    expect(resumed.body.view).toMatchObject({ question: { text: "Math question 2 (high)" } });
  });

  test("ticked Options are kept, so reopening shows them still ticked", async () => {
    const { call, clock } = harness();
    const started = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    clock.now = minute(1);
    await call("POST", `/api/attempts/${started.body.attemptId}/selection`, { selected: [2] });
    const resumed = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    expect(resumed.body.view).toMatchObject({ kind: "question", selected: [2] });
  });

  test("logging in with an Exercise Set number that doesn't exist says so", async () => {
    const { call } = harness();

    const res = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "12" });

    expect(res).toEqual({ status: 404, body: { error: "There is no Exercise Set 12." } });
  });

  test("only Students on the list can log in", async () => {
    const { call } = harness();

    const res = await call("POST", "/api/attempts", { student: "Zed", setNumber: "7" });

    expect(res).toEqual({ status: 400, body: { error: "Zed is not on the Student list." } });
  });

  test("logging in to a broken Exercise Set lists what needs fixing", async () => {
    const { call, setsDir } = harness();
    mkdirSync(join(setsDir, "008"));
    writeFileSync(join(setsDir, "008", "1-math.md"), "# Math\nwork: 20 min\n");

    const res = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "8" });

    expect(res).toEqual({
      status: 422,
      body: { error: "Exercise Set 8 can't be used yet.", problems: ["1-math.md: has no Questions."] },
    });
  });

  test("a Response sent while waiting for the next Subject is refused, not saved", async () => {
    const { call, clock } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(1);
    await call("POST", `/api/attempts/${body.attemptId}/responses`, { selected: [0] });
    await call("POST", `/api/attempts/${body.attemptId}/responses`, { selected: [0] }); // Math done; English opens at 15

    const refused = await call("POST", `/api/attempts/${body.attemptId}/responses`, { selected: [0] });
    clock.now = minute(15);
    const english = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    expect(refused.status).toBe(409);
    expect(english.body.view).toMatchObject({ kind: "question", subject: "English" });
  });

  test("the login screen can list the Students", async () => {
    const { call } = harness();

    expect(await call("GET", "/api/students")).toEqual({ status: 200, body: { students: ["Aisha", "Omar"] } });
  });

  test("logging in after an Attempt has finished starts a new Attempt", async () => {
    const { call, clock } = harness();
    const first = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    clock.now = minute(31); // the Exercise Set ended at 30
    const second = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    expect(second.body.attemptId).not.toBe(first.body.attemptId);
    expect(second.body.view).toMatchObject({ kind: "question", subject: "Math" });
  });
});

describe("Parent", () => {
  const PIN = { "x-parent-pin": "4321" };

  test("Parent pages need the right PIN", async () => {
    const { call } = harness();

    expect((await call("GET", "/api/parent/attempts")).status).toBe(401);
    expect((await call("GET", "/api/parent/attempts", undefined, { "x-parent-pin": "0000" })).status).toBe(401);
    expect((await call("GET", "/api/parent/attempts", undefined, PIN)).status).toBe(200);
  });

  test("lists every Attempt, newest first, with its status and Scores", async () => {
    const { call, clock } = harness();
    const aisha = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(1);
    await call("POST", `/api/attempts/${aisha.body.attemptId}/responses`, { selected: [0] }); // Medium, right: 2
    clock.now = minute(2);
    const omar = await call("POST", "/api/attempts", { student: "Omar", setNumber: "7" });

    clock.now = minute(31); // Aisha's Attempt ended at 30; Omar's runs until 32
    const res = await call("GET", "/api/parent/attempts", undefined, PIN);

    expect(res.body.attempts).toEqual([
      {
        attemptId: omar.body.attemptId,
        student: "Omar",
        setNumber: "7",
        startedAt: minute(2),
        status: "in progress",
        score: 0,
        subjects: [
          { subject: "Math", score: 0, correct: 0 },
          { subject: "English", score: 0, correct: 0 },
        ],
      },
      {
        attemptId: aisha.body.attemptId,
        student: "Aisha",
        setNumber: "7",
        startedAt: T0,
        status: "finished",
        score: 2,
        subjects: [
          { subject: "Math", score: 2, correct: 1 },
          { subject: "English", score: 0, correct: 0 },
        ],
      },
    ]);
  });

  test("opening an Attempt shows every Response in detail, with the Correct Options", async () => {
    const { call, clock } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(1);
    await call("POST", `/api/attempts/${body.attemptId}/selection`, { selected: [1] });
    clock.now = minute(2);
    await call("POST", `/api/attempts/${body.attemptId}/responses`, { selected: [1] }); // Medium, wrong

    const res = await call("GET", `/api/parent/attempts/${body.attemptId}`, undefined, PIN);

    expect(res.body.student).toBe("Aisha");
    expect(res.body.subjects[0]).toMatchObject({
      subject: "Math",
      timedOut: false,
      difficultyPath: ["medium"],
      responses: [
        {
          question: { text: "Math question 3 (medium)", options: ["a", "b", "c", "d"], correctOptions: [0] },
          selected: [1],
          correct: false,
          points: 0,
          secondsSpent: 120,
          inLag: false,
          selectionChanges: [{ selected: [1], at: minute(1) }],
        },
      ],
    });
  });

  test("shows when the Student's page was closed, and where they were", async () => {
    const { call, clock } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    const seconds = (s: number) => T0 + s * 1000;
    clock.now = seconds(10);
    await call("POST", `/api/attempts/${body.attemptId}/heartbeat`);
    clock.now = seconds(20);
    await call("POST", `/api/attempts/${body.attemptId}/heartbeat`);
    // the tab is closed for almost 5 minutes
    clock.now = minute(5);
    await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(5) + 10_000;
    await call("POST", `/api/attempts/${body.attemptId}/heartbeat`);

    const res = await call("GET", `/api/parent/attempts/${body.attemptId}`, undefined, PIN);

    expect(res.body.interruptions).toEqual([{ from: seconds(20), to: minute(5), subject: "Math", questionNumber: 1 }]);
  });

  test("a page closed and never reopened is an Interruption until the Exercise Set ended", async () => {
    const { call, clock } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = T0 + 10_000;
    await call("POST", `/api/attempts/${body.attemptId}/heartbeat`);

    clock.now = minute(45);
    const res = await call("GET", `/api/parent/attempts/${body.attemptId}`, undefined, PIN);

    expect(res.body.interruptions).toEqual([{ from: T0 + 10_000, to: minute(30), subject: "Math", questionNumber: 1 }]);
  });

  test("discarding an in-progress Attempt removes it, and the Student's next login starts fresh", async () => {
    const { call, clock } = harness();
    const first = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    clock.now = minute(3);
    const discarded = await call("DELETE", `/api/parent/attempts/${first.body.attemptId}`, undefined, PIN);
    const second = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    const list = await call("GET", "/api/parent/attempts", undefined, PIN);

    expect(discarded.status).toBe(200);
    expect(second.body.attemptId).not.toBe(first.body.attemptId);
    expect(list.body.attempts.map((a: { attemptId: string }) => a.attemptId)).toEqual([second.body.attemptId]);
  });

  test("a finished Attempt can't be discarded", async () => {
    const { call, clock } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    clock.now = minute(31);
    const res = await call("DELETE", `/api/parent/attempts/${body.attemptId}`, undefined, PIN);

    expect(res).toEqual({ status: 409, body: { error: "Only an Attempt still in progress can be discarded." } });
  });
});

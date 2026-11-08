import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  /** Where Option `text` is on the Student's screen right now (the Options are shuffled). */
  const positionOf = async (attemptId: string, text: string) => {
    const { body } = await call("POST", `/api/attempts/${attemptId}/heartbeat`);
    return body.view.kind === "question" ? (body.view.question.options as string[]).indexOf(text) : 0;
  };
  return {
    setsDir,
    clock,
    call,
    /** Submits Option `text` as the Response. In these sets "a" is always right and "b" wrong. */
    answer: async (attemptId: string, text: string) =>
      call("POST", `/api/attempts/${attemptId}/responses`, { selected: [await positionOf(attemptId, text)] }),
    /** Ticks just Option `text`. */
    select: async (attemptId: string, text: string) =>
      call("POST", `/api/attempts/${attemptId}/selection`, { selected: [await positionOf(attemptId, text)] }),
    /** A plain GET, for non-JSON replies such as images. */
    get: (path: string) => app.request(path),
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
        text: "Math question 5 (low)",
        options: expect.any(Array),
        multiAnswer: false,
      },
      selected: [],
      questionNumber: 1,
      questionCount: 2,
      workEndsAt: minute(20),
      closesAt: minute(25),
    });
    expect([...res.body.view.question.options].sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("the Options are shuffled, and the Student answers by where an Option is on screen", async () => {
    const { call, answer } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    const shown: string[][] = [];
    let reply = body;
    while (reply.view.kind === "question") {
      shown.push(reply.view.question.options);
      reply = (await answer(body.attemptId, "a")).body; // "a" is right wherever it was shown
    }

    expect(shown).toHaveLength(2);
    expect(shown.some((options) => options.join("") !== "abcd")).toBe(true);
    const review = await call("GET", `/api/parent/attempts/${body.attemptId}`, undefined, { "x-parent-pin": "4321" });
    expect(review.body.subjects[0].responses.map((r: { correct: boolean }) => r.correct)).toEqual([true, true]);
  });

  test("submitting a Response moves on to the next Question", async () => {
    const { call, clock, answer } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    clock.now = minute(1);
    const res = await answer(body.attemptId, "a");

    expect(res.body.view).toMatchObject({ kind: "question", question: { text: "Math question 3 (medium)" } });
  });

  test("after a restart, logging in again resumes the same Attempt at the same Question", async () => {
    const { call, clock, restart, answer } = harness({ random: () => 0.99 }); // draws the last Question in each Pool
    const started = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(1);
    await answer(started.body.attemptId, "a");

    restart(() => 0); // would draw different Questions if the saved draws weren't replayed
    clock.now = minute(2);
    const resumed = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    expect(resumed.body.attemptId).toBe(started.body.attemptId);
    expect(resumed.body.view).toMatchObject({ question: { text: "Math question 4 (medium)" } });
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
    const { call, clock, answer } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(1);
    await answer(body.attemptId, "a");
    await answer(body.attemptId, "a"); // Math done; English opens at 15

    const refused = await answer(body.attemptId, "a");
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

describe("choosing an Exercise Set", () => {
  test("lists every Exercise Set, numbers first then names, marking ones that need fixing", async () => {
    const { call, setsDir } = harness();
    for (const name of ["labsky-002", "labsky-001"]) {
      mkdirSync(join(setsDir, name));
      writeFileSync(join(setsDir, name, "1-math.md"), readFileSync(join(setsDir, "007", "1-math.md"), "utf8").replace("lag: 5 min", ""));
    }
    mkdirSync(join(setsDir, "012"));
    writeFileSync(join(setsDir, "012", "1-math.md"), "# Math\nwork: 20 min\n");
    writeFileSync(join(setsDir, "notes.txt"), "not a set");

    const res = await call("GET", "/api/sets");

    expect(res.body.sets).toEqual([
      { name: "7", ready: true },
      { name: "12", ready: false },
      { name: "labsky-001", ready: true },
      { name: "labsky-002", ready: true },
    ]);
  });
});

describe("Exercise Set names", () => {
  test("a named set is found whatever the case, and every spelling resumes the same Attempt", async () => {
    const { call, setsDir } = harness();
    mkdirSync(join(setsDir, "labsky-001"));
    for (const f of ["1-math.md", "2-english.md"]) {
      writeFileSync(join(setsDir, "labsky-001", f), readFileSync(join(setsDir, "007", f), "utf8"));
    }

    const first = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "labsky-001" });
    const again = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "Labsky-001" });
    const summary = await call("GET", "/api/sets/LABSKY-001?student=Aisha");

    expect(again.body.attemptId).toBe(first.body.attemptId);
    expect(summary.body).toMatchObject({ setNumber: "labsky-001", inProgress: { subjects: ["Math", "English"] } });
  });

  test("a numbered set resumes the same Attempt whether typed as 007 or 7", async () => {
    const { call } = harness();

    const first = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "007" });
    const again = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    expect(again.body.attemptId).toBe(first.body.attemptId);
  });
});

describe("Start screen", () => {
  test("shows the Exercise Set's Subjects and times, and whether the Student has an Attempt in progress", async () => {
    const { call } = harness();
    const before = await call("GET", "/api/sets/7?student=Aisha");
    await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    const after = await call("GET", "/api/sets/7?student=Aisha");

    expect(before.body).toEqual({
      setNumber: "7",
      totalMinutes: 30,
      subjects: [
        { name: "Math", workMinutes: 20, leadMinutes: 0, lagMinutes: 5, questionCount: 2 },
        { name: "English", workMinutes: 10, leadMinutes: 5, lagMinutes: 0, questionCount: 2 },
      ],
      inProgress: null,
    });
    expect(after.body.inProgress).toEqual({ subjects: ["Math", "English"] });
  });

  test("shows how many Questions each Subject asks, even when its Pools hold more", async () => {
    const { call, setsDir } = harness();
    const folder = join(setsDir, "bank");
    mkdirSync(folder);
    const pool = (d: string) => [1, 2, 3].map((i) => `## difficulty: ${d}\nQ${i}\n\n- [x] a\n- [ ] b\n- [ ] c\n- [ ] d\n`).join("\n");
    writeFileSync(join(folder, "1-math.md"), `# Math\nwork: 10 min\nquestions: 2\n\n${pool("high")}\n${pool("medium")}\n${pool("low")}`);

    const res = await call("GET", "/api/sets/bank?student=Aisha");

    expect(res.body.subjects).toEqual([{ name: "Math", workMinutes: 10, leadMinutes: 0, lagMinutes: 0, questionCount: 2 }]);
  });

  test("an unknown Exercise Set number is reported before starting", async () => {
    const { call } = harness();

    expect(await call("GET", "/api/sets/12?student=Aisha")).toEqual({
      status: 404,
      body: { error: "There is no Exercise Set 12." },
    });
  });
});

describe("pictures in Questions", () => {
  test("an image in the Exercise Set's folder is served with its type", async () => {
    const { get, setsDir } = harness();
    mkdirSync(join(setsDir, "007", "images"));
    writeFileSync(join(setsDir, "007", "images", "triangle.png"), "PNGDATA");

    const res = await get("/api/sets/7/files/images/triangle.png");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("PNGDATA");
  });

  test("the Subject files are never served, because they contain the answers", async () => {
    const { get } = harness();

    expect((await get("/api/sets/7/files/1-math.md")).status).toBe(404);
  });

  test("a path that climbs out of the Exercise Set's folder is refused", async () => {
    const { get, setsDir } = harness();
    writeFileSync(join(setsDir, "secret.png"), "SECRET");

    expect((await get("/api/sets/7/files/..%2Fsecret.png")).status).toBe(404);
    expect((await get("/api/sets/7/files/images%2F..%2F..%2Fsecret.png")).status).toBe(404);
  });
});

describe("Student's clock", () => {
  test("every reply carries the server's time, so the page's countdown doesn't depend on the tablet's clock", async () => {
    const { call, clock } = harness();
    const started = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(1);
    const heartbeat = await call("POST", `/api/attempts/${started.body.attemptId}/heartbeat`);
    clock.now = minute(2);
    const selection = await call("POST", `/api/attempts/${started.body.attemptId}/selection`, { selected: [1] });

    expect([started.body.now, heartbeat.body.now, selection.body.now]).toEqual([T0, minute(1), minute(2)]);
  });

  test("replies say when the whole Exercise Set ends, for the total time left", async () => {
    const { call } = harness();

    const started = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });

    expect(started.body.endsAt).toBe(minute(30));
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
    const { call, clock, answer } = harness();
    const aisha = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(1);
    await answer(aisha.body.attemptId, "a"); // Low, right: 1
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
        skippedSubjects: [],
        focusLosses: { count: 0, seconds: 0 },
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
        score: 1,
        skippedSubjects: [],
        focusLosses: { count: 0, seconds: 0 },
        subjects: [
          { subject: "Math", score: 1, correct: 1 },
          { subject: "English", score: 0, correct: 0 },
        ],
      },
    ]);
  });

  test("opening an Attempt shows every Response in detail, with the Correct Options", async () => {
    const { call, clock, answer, select } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(1);
    await select(body.attemptId, "b");
    clock.now = minute(2);
    await answer(body.attemptId, "b"); // Low, wrong

    const res = await call("GET", `/api/parent/attempts/${body.attemptId}`, undefined, PIN);

    expect(res.body.student).toBe("Aisha");
    expect(res.body.subjects[0]).toMatchObject({
      subject: "Math",
      timedOut: false,
      difficultyPath: ["low"],
      responses: [
        {
          question: { text: "Math question 5 (low)", options: ["a", "b", "c", "d"], correctOptions: [0] },
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

/** Adds Exercise Set 8: Math (work 20, lag 5), Science (lead 5, work 10, lag 5), English (lead 5, work 10). Option "a" is right. */
function addSet8(setsDir: string) {
  const folder = join(setsDir, "008");
  mkdirSync(folder);
  const subjectFile = (name: string, times: string) => {
    const blocks = ["high", "high", "medium", "medium", "low", "low"].map(
      (d, i) => `## difficulty: ${d}\n${name} question ${i + 1} (${d})\n\n- [x] a\n- [ ] b\n- [ ] c\n- [ ] d\n`,
    );
    return `# ${name}\n${times}\n\n${blocks.join("\n")}`;
  };
  writeFileSync(join(folder, "1-math.md"), subjectFile("Math", "work: 20 min\nlag: 5 min"));
  writeFileSync(join(folder, "2-science.md"), subjectFile("Science", "work: 10 min\nlead: 5 min\nlag: 5 min"));
  writeFileSync(join(folder, "3-english.md"), subjectFile("English", "work: 10 min\nlead: 5 min"));
}

describe("Focus Losses", () => {
  const PIN = { "x-parent-pin": "4321" };
  const seconds = (s: number) => T0 + s * 1000;

  test("the Parent sees when the page lost focus, for how long, how, and on which Question", async () => {
    const { call, clock, answer } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(1);
    await answer(body.attemptId, "a"); // now on Math, Question 2
    clock.now = minute(3);
    const report = await call("POST", `/api/attempts/${body.attemptId}/focus-losses`, { awayMs: 45_000, how: "hidden" });
    clock.now = minute(4);
    await call("POST", `/api/attempts/${body.attemptId}/focus-losses`, { awayMs: 5_000, how: "blurred" });

    const detail = await call("GET", `/api/parent/attempts/${body.attemptId}`, undefined, PIN);
    const list = await call("GET", "/api/parent/attempts", undefined, PIN);

    expect(report.status).toBe(200);
    expect(report.body.view.kind).toBe("question");
    expect(detail.body.focusLosses).toEqual([
      { from: minute(3) - 45_000, to: minute(3), how: "hidden", subject: "Math", questionNumber: 2 },
      { from: minute(4) - 5_000, to: minute(4), how: "blurred", subject: "Math", questionNumber: 2 },
    ]);
    expect(list.body.attempts[0].focusLosses).toEqual({ count: 2, seconds: 50 });
  });

  test("gaps in the heartbeat while the page was out of focus are not Interruptions", async () => {
    const { call, clock } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    const beat = async (s: number) => {
      clock.now = seconds(s);
      await call("POST", `/api/attempts/${body.attemptId}/heartbeat`);
    };
    // Out of focus 15s-200s: the browser slows the page's heartbeat to once a minute.
    await beat(10);
    await beat(75);
    await beat(135);
    clock.now = seconds(200);
    await call("POST", `/api/attempts/${body.attemptId}/focus-losses`, { awayMs: 185_000, how: "hidden" });
    // Out of focus 400s-600s: the browser froze the page, so no heartbeat at all.
    for (let s = 210; s <= 390; s += 10) await beat(s);
    await beat(395);
    clock.now = seconds(600);
    await call("POST", `/api/attempts/${body.attemptId}/focus-losses`, { awayMs: 200_000, how: "hidden" });
    // Then the page is really closed.
    await beat(605);
    await beat(900);

    const res = await call("GET", `/api/parent/attempts/${body.attemptId}`, undefined, PIN);

    expect(res.body.focusLosses.map((f: any) => [f.from, f.to])).toEqual([
      [seconds(15), seconds(200)],
      [seconds(400), seconds(600)],
    ]);
    expect(res.body.interruptions).toEqual([{ from: seconds(605), to: seconds(900), subject: "Math", questionNumber: 1 }]);
  });

  test("a Focus Loss never starts before the Attempt, and nonsense reports are refused", async () => {
    const { call, clock } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(1);
    const path = `/api/attempts/${body.attemptId}/focus-losses`;

    await call("POST", path, { awayMs: 10 * 60_000, how: "blurred" });
    const refused = await Promise.all([
      call("POST", path, { awayMs: -5, how: "hidden" }),
      call("POST", path, { awayMs: "a while", how: "hidden" }),
      call("POST", path, { awayMs: 5_000, how: "asleep" }),
    ]);
    const res = await call("GET", `/api/parent/attempts/${body.attemptId}`, undefined, PIN);

    expect(refused.map((r) => r.status)).toEqual([400, 400, 400]);
    expect(res.body.focusLosses).toEqual([{ from: T0, to: minute(1), how: "blurred", subject: "Math", questionNumber: 1 }]);
  });

  test("a report after the Attempt has finished is not kept", async () => {
    const { call, clock } = harness();
    const { body } = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "7" });
    clock.now = minute(40); // the Exercise Set ended at 30

    await call("POST", `/api/attempts/${body.attemptId}/focus-losses`, { awayMs: 60_000, how: "hidden" });
    const res = await call("GET", `/api/parent/attempts/${body.attemptId}`, undefined, PIN);

    expect(res.body.focusLosses).toEqual([]);
  });
});

describe("Selected Subjects", () => {
  const PIN = { "x-parent-pin": "4321" };

  test("an Attempt can run only some Subjects, in the set's order, on a clock of just their Work Times", async () => {
    const { call, clock, setsDir, answer } = harness();
    addSet8(setsDir);

    const started = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "8", subjects: ["English", "Math"] });
    expect(started.body).toMatchObject({
      endsAt: minute(30),
      view: { kind: "question", subject: "Math", workEndsAt: minute(20), closesAt: minute(25) },
    });

    clock.now = minute(1);
    await answer(started.body.attemptId, "a");
    const afterMath = await answer(started.body.attemptId, "a");
    expect(afterMath.body.view).toEqual({ kind: "waiting", nextSubject: "English", opensAt: minute(15) });
  });

  test("Subjects that aren't in the Exercise Set, or none at all, are refused", async () => {
    const { call, setsDir } = harness();
    addSet8(setsDir);

    expect(await call("POST", "/api/attempts", { student: "Aisha", setNumber: "8", subjects: ["Math", "Art"] })).toEqual({
      status: 400,
      body: { error: "Exercise Set 8 has no Subject Art." },
    });
    expect((await call("POST", "/api/attempts", { student: "Aisha", setNumber: "8", subjects: [] })).status).toBe(400);
  });

  test("logging in again resumes the Attempt with the Subjects it started with", async () => {
    const { call, setsDir, clock } = harness();
    addSet8(setsDir);
    const started = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "8", subjects: ["Science"] });

    clock.now = minute(1);
    const summary = await call("GET", "/api/sets/8?student=Aisha");
    const resumed = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "8" });

    expect(summary.body.inProgress).toEqual({ subjects: ["Science"] });
    expect(resumed.body.attemptId).toBe(started.body.attemptId);
    expect(resumed.body).toMatchObject({ endsAt: minute(10), view: { subject: "Science" } });
  });

  test("the Parent sees which Subjects an Attempt skipped, and Scores for only the ones it ran", async () => {
    const { call, setsDir, clock, answer } = harness();
    addSet8(setsDir);
    const partial = await call("POST", "/api/attempts", { student: "Aisha", setNumber: "8", subjects: ["Math", "English"] });
    clock.now = minute(1);
    await answer(partial.body.attemptId, "a");
    const whole = await call("POST", "/api/attempts", { student: "Omar", setNumber: "8", subjects: ["Math", "Science", "English"] });

    const list = await call("GET", "/api/parent/attempts", undefined, PIN);
    const detail = await call("GET", `/api/parent/attempts/${partial.body.attemptId}`, undefined, PIN);

    expect(list.body.attempts).toMatchObject([
      { attemptId: whole.body.attemptId, skippedSubjects: [] },
      {
        attemptId: partial.body.attemptId,
        skippedSubjects: ["Science"],
        score: 1,
        subjects: [
          { subject: "Math", score: 1, correct: 1 },
          { subject: "English", score: 0, correct: 0 },
        ],
      },
    ]);
    expect(detail.body.skippedSubjects).toEqual(["Science"]);
    expect(detail.body.subjects.map((s: { subject: string }) => s.subject)).toEqual(["Math", "English"]);
  });

  test("Attempts saved before Subjects could be picked still open, as runs of every Subject", async () => {
    const setsDir = setsDirWithSet7();
    const dbPath = join(mkdtempSync(join(tmpdir(), "cat-db-")), "cat.sqlite");
    const old = new DatabaseSync(dbPath);
    old.exec(`
      CREATE TABLE attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student TEXT NOT NULL, set_number TEXT NOT NULL,
        started_at INTEGER NOT NULL, random_values TEXT NOT NULL DEFAULT '[]', discarded_at INTEGER
      );
      INSERT INTO attempts (student, set_number, started_at) VALUES ('Aisha', '7', ${T0});
    `);
    old.close();

    const app = createApp({ db: new DatabaseSync(dbPath), setsDir, students: ["Aisha"], parentPin: "4321", now: () => minute(1) });
    const res = await app.request("/api/parent/attempts", { headers: PIN });

    expect(((await res.json()) as any).attempts).toMatchObject([
      { student: "Aisha", skippedSubjects: [], subjects: [{ subject: "Math" }, { subject: "English" }] },
    ]);
  });
});

describe("Attempts from before the Options were shuffled", () => {
  test("keep the Questions they were given, with the Options in the order they were written", async () => {
    const setsDir = setsDirWithSet7();
    const dbPath = join(mkdtempSync(join(tmpdir(), "cat-db-")), "cat.sqlite");
    const old = new DatabaseSync(dbPath);
    // The database as it was: no option_seed column. The saved draws picked the last Low Question of each Subject.
    old.exec(`
      CREATE TABLE attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student TEXT NOT NULL, set_number TEXT NOT NULL,
        started_at INTEGER NOT NULL, random_values TEXT NOT NULL DEFAULT '[]', discarded_at INTEGER, subjects TEXT
      );
      CREATE TABLE attempt_events (
        attempt_id INTEGER NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, selected TEXT, at INTEGER NOT NULL,
        PRIMARY KEY (attempt_id, seq)
      );
      INSERT INTO attempts (student, set_number, started_at, random_values) VALUES ('Aisha', '7', ${T0}, '[0.99, 0.99, 0.99]');
      INSERT INTO attempt_events VALUES (1, 0, 'response', '[1]', ${minute(1)});
    `);
    old.close();
    const app = createApp({ db: new DatabaseSync(dbPath), setsDir, students: ["Aisha"], parentPin: "4321", now: () => minute(2) });

    const review = (await (await app.request("/api/parent/attempts/1", { headers: { "x-parent-pin": "4321" } })).json()) as any;
    const resumed = (await (
      await app.request("/api/attempts", { method: "POST", body: JSON.stringify({ student: "Aisha", setNumber: "7" }) })
    ).json()) as any;

    expect(review.subjects[0].responses[0]).toMatchObject({
      question: { text: "Math question 6 (low)" },
      optionOrder: [0, 1, 2, 3],
      selected: [1],
    });
    // A wrong answer at Low stays Low: the other Low Question, its Options in written order.
    expect(resumed.view.question).toMatchObject({ text: "Math question 5 (low)", options: ["a", "b", "c", "d"] });
  });
});

# CAT Simulator

A small practice tool for a child preparing for a Computerized Adaptive Test (CAT).
The Parent writes Exercise Sets as Markdown files. The Student logs in with their name and an Exercise Set number and works through timed, adaptive multiple-choice Subjects. Every answer, tick, timing and interruption is logged so Parent and Student can review the Attempt together afterwards.

Everything runs on one home computer and is reachable only from devices on the home Wi-Fi. There's no cloud and no accounts.

> **Status:** the Attempt engine, the Exercise Set loader and the server API are built and tested, and `npm start` runs the server.
> Still to come: the Student and Parent screens, and an example Exercise Set. Until then, the server only answers API requests.

The words used here (Exercise Set, Subject, Pool, Lead, Lag, Attempt…) are defined in [GLOSSARY.md](GLOSSARY.md).

## Getting started

Requires Node 24 or later.

```sh
npm install
cp cat-simulator.config.example.json cat-simulator.config.json
# edit cat-simulator.config.json: your child's name(s) and a Parent PIN
npm start
```

At start-up it prints the addresses to open, for example:

```
CAT Simulator running
  On this computer: http://localhost:3000
  On the home Wi-Fi: http://10.10.50.12:3000  (wlp0s20f3)
  Allowed devices: this computer, 10.10.50.0/24
```

On the Student's tablet or your laptop, open the "home Wi-Fi" address. The address can change if the router hands out a new one, so check the start-up output if it stops working.

**Who can connect:** only this computer and devices whose address is in `allowedNetworks`. Anything else, such as a VPN or another network, gets "Not allowed". Anyone on the home Wi-Fi can open the Student pages. The Parent review needs the PIN. This is built for a trusted home network, not the internet: there's no HTTPS and no Student passwords.

If another device can't connect even though it's on the Wi-Fi, this computer's firewall may be blocking the port. For example, with `ufw`: `sudo ufw allow from 10.10.50.0/24 to any port 3000 proto tcp`.

`cat-simulator.config.json` (kept out of git because it holds the PIN):

| Setting | Meaning | Default |
|---|---|---|
| `students` | Names the Student can pick at login | (required) |
| `parentPin` | PIN for the Parent review | (required) |
| `setsDir` | Folder holding the Exercise Sets | `sets` |
| `dbPath` | SQLite file where every Attempt is logged | `cat.sqlite` |
| `port` | Port to serve on | `3000` |
| `host` | `0.0.0.0` accepts other devices; `127.0.0.1` accepts this computer only | `0.0.0.0` |
| `allowedNetworks` | Networks other devices may connect from, e.g. `["10.10.50.0/24"]` for every `10.10.50.x` address. This computer is always allowed. | `[]` (this computer only) |

## How a practice run works

1. The Student picks their name, enters the Exercise Set number (e.g. `7`) and presses **Start** once.
2. Subjects run one after another on **one shared clock**. Each Subject has a **Work Time**, plus an optional **Lead** (it may open early) and **Lag** (it may run late).
3. **Adaptive Selection:** each Subject starts with a Medium Question. A correct Response moves the next Question up one Difficulty and a wrong one moves it down. Questions are never repeated.
4. There's no going back and no skipping. A Subject ends when every Question is answered or its Window closes. Unanswered Questions are **Timed Out**.
5. The Student sees no right/wrong feedback until the end. Then a short summary shows points and number correct for each Subject.
6. Closing the tab doesn't pause the clock. Reopening brings back the same Question with the same ticks.

### Timing example

Math has `work: 20 min` and `lag: 5 min`. English has `lead: 5 min` and `work: 10 min`:

```
min:      0    5    10   15   20   25   30
Math      [==========work=========][lag]
English                      [lead][==work==]
                                            ▲ Exercise Set ends at 30 (sum of Work Times)
```

- If the Student finishes Math at minute 5, they wait until English opens at 15.
- If Math runs late until minute 25, English has only 25–30 left. Lag time comes out of the next Subject.
- The Exercise Set always ends at the sum of the Work Times.

### Scoring

| Difficulty | Points if correct |
|---|---|
| High | 3 |
| Medium | 2 |
| Low | 1 |

Wrong or unanswered Responses score 0, and there's no negative marking.
A **Multi-answer Question** (more than one `[x]`) only scores if the Student picks *every* Correct Option and no wrong ones.

## Writing an Exercise Set

Each Exercise Set is a folder under `sets/`, named by its number. Each Subject is one Markdown file, and the number at the front of the file name sets the order:

```
sets/
  007/                ← Exercise Set 7
    1-math.md
    2-english.md
    images/triangle.png
```

A Subject file:

```markdown
# Mathematics
work: 20 min
lag: 5 min

## difficulty: high
What is ¾ of 24?

- [ ] 16
- [x] 18
- [ ] 20
- [ ] 24

## difficulty: low
Which are even numbers?

![](images/numbers.png)

- [x] 4
- [ ] 7
- [x] 10
- [ ] 13
```

Rules. The app refuses to load a set that breaks them and lists each problem with its file and Question number:

- Every Question has exactly **4 Options** and at least one marked `[x]`.
- `difficulty:` is `high`, `medium` or `low`.
- A Subject's three Pools (High, Medium, Low) hold the **same number** of Questions. That number is how many Questions the Student sees. For example, 18 per Pool means 18 Questions shown and 54 written.
- Every Subject has a `work:` line. The first Subject has no `lead:` and the last has no `lag:`.
- A Lead can't be longer than the previous Subject's Work Time, and a Lag can't be longer than the next Subject's.

Question text is Markdown, so images and `$LaTeX$` formulas are allowed.
Once an Exercise Set has been attempted, fix typos only. Changing Questions or answers means making a new Exercise Set, so past reviews stay accurate.

## Reviewing an Attempt (Parent)

Behind a Parent PIN, the review shows:

- **All Attempts**, newest first, with status, total Score and the Score for each Subject.
- **One Attempt in detail:** for every Response, the Question, what was picked, the Correct Options, points, time spent, whether it was given during Lag, and how the ticks changed before submitting. Each Subject also shows its Difficulty Path and whether it Timed Out. **Interruptions** (when the page was closed) are listed with the Subject and Question number.
- **Discard**: an in-progress Attempt can be thrown away.

## Development

Requires Node 24 or later (it uses the built-in `node:sqlite`).

```sh
npm start         # run the server (see Getting started)
npm test          # Vitest
npm run typecheck # tsc --noEmit
```

| Path | What it is |
|---|---|
| `src/engine/` | The Attempt engine: pure logic for Adaptive Selection, the shared clock, Score and review data. Time and randomness are passed in. |
| `src/content/` | `loadExerciseSet(folder)`: reads and validates the Markdown files. |
| `src/server/` | The Hono HTTP API over SQLite. Attempts are stored as events plus the random draws used, and rebuilt by replaying them through the engine. `main.ts` is the `npm start` entry point. |
| `sets/` | Your Exercise Sets, one numbered folder each. |
| `GLOSSARY.md` | The domain language. |
| `docs/agents/` | Notes for coding agents: issue tracker, triage labels, domain docs. |

Issues are tracked in GitHub Issues on `ghulam-imad/cat-simulator`.

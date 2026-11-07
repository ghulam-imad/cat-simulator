"""Builds the "labsky" Exercise Set from the Labsky question bank.

    python3 tools/build_labsky_set.py <Bank_Soal_CAT_Labsky_2026_Asli_dan_Latihan.md> sets

- Text is copied verbatim from the bank (no translation); pembahasan is left out.
- 🟨 LATIHAN questions keep the bank's level: M -> low, SD -> medium, SL -> high.
- 🟦 ASLI questions have no level in the bank; ASLI_LEVEL below assigns one, judged against
  the LATIHAN questions of each level.
- Every question of the bank goes into its Subject's Pool for its level. Each Subject asks
  fewer Questions than its Pools hold ("questions: N"), and the app draws them at random,
  so every run gets a different mix.
"""
import re
import sys
from pathlib import Path

SET_NAME = "labsky"

# (file, title as in the bank, LATIHAN code prefix, ASLI tahap, questions asked, timing lines)
SUBJECTS = [
    ("1-kuantitatif.md", "Kemampuan Kuantitatif (Numerasi)", "NUM", 1, 18, ["work: 27 min", "lag: 5 min"]),
    ("2-literasi.md", "Pemahaman Membaca (Literasi)", "LIT", 2, 20, ["lead: 15 min", "work: 25 min", "lag: 5 min"]),
    ("3-verbal.md", "Kemampuan Verbal", "VER", 3, 16, ["lead: 5 min", "work: 8 min", "lag: 5 min"]),
    ("4-akademik.md", "Kemampuan Akademik", "AKA", 4, 20, ["lead: 5 min", "work: 30 min"]),
]
LATIHAN_LEVEL = {"M": "low", "SD": "medium", "SL": "high"}

# Levels for the ASLI questions. Low: one step / read directly. Medium: two steps, ratios,
# percentages, straightforward analogies. High: multi-step, careful conclusions, syllogisms,
# figurative meaning.
ASLI_LEVEL = {
    # Kuantitatif
    "1.1": "low", "1.11": "low", "1.12": "low", "1.13": "low",
    "1.2": "medium", "1.8": "medium", "1.9": "medium",
    "1.3": "high", "1.4": "high", "1.5": "high", "1.6": "high", "1.7": "high", "1.10": "high",
    # Literasi
    "2.1": "low", "2.11": "low", "2.12": "low", "2.13": "low", "2.14": "low", "2.15": "low", "2.16": "low",
    "2.2": "medium", "2.4": "medium", "2.5": "medium", "2.8": "medium", "2.10": "medium", "2.17": "medium",
    "2.3": "high", "2.6": "high", "2.7": "high", "2.9": "high",
    # Verbal
    "3.10": "low", "3.13": "low", "3.14": "low", "3.15": "low", "3.17": "low",
    "3.1": "medium", "3.2": "medium", "3.5": "medium", "3.8": "medium", "3.9": "medium", "3.11": "medium", "3.16": "medium",
    "3.3": "high", "3.4": "high", "3.6": "high", "3.7": "high", "3.12": "high",
    # Akademik
    "4.1": "low", "4.12": "low", "4.13": "low", "4.14": "low", "4.17": "low",
    "4.4": "medium", "4.6": "medium", "4.9": "medium", "4.10": "medium", "4.16": "medium",
    "4.2": "high", "4.3": "high", "4.5": "high", "4.7": "high", "4.8": "high", "4.11": "high", "4.15": "high",
}


def parse_block(code, block):
    """Splits a question block into its text and four options, checking the shape."""
    lines = block.rstrip().split("\n")
    option_at = [k for k, l in enumerate(lines) if re.match(r"^- [A-D]\. ", l)]
    assert len(option_at) == 4 and option_at == list(range(option_at[0], option_at[0] + 4)), (code, "options")
    assert [lines[k][2] for k in option_at] == ["A", "B", "C", "D"], (code, "option letters")
    assert all(not l.strip() for l in lines[option_at[-1] + 1 :]), (code, "text after options")
    text = "\n".join(lines[: option_at[0]]).strip()
    assert text and not re.search(r"^#", text, re.M), (code, "empty text or heading inside")
    return text, [lines[k][5:].strip() for k in option_at]


def read_bank(path):
    content = Path(path).read_text(encoding="utf-8")
    body, answers = content.split("## Kunci Jawaban", 1)
    keys = dict(re.findall(r"^\| ([A-Z]+-(?:M|SD|SL)\d+) \| \*\*([A-D])\*\* \|", answers, re.M))
    keys.update({f"ASLI {c}": k for c, k in re.findall(r"^- \*\*(\d+\.\d+) → ([A-D])\*\*", answers, re.M)})
    end = r"(?=^#### |^### |^## |^---\s*$|^> |\Z)"
    questions = []  # (code, prefix-or-tahap, level, text, options)
    for m in re.finditer(rf"^#### 🟨 LATIHAN ([A-Z]+)-(M|SD|SL)(\d+)\s*\n(.*?){end}", body, re.M | re.S):
        prefix, lvl, n, block = m.groups()
        code = f"{prefix}-{lvl}{n}"
        questions.append((code, prefix, LATIHAN_LEVEL[lvl], *parse_block(code, block)))
    for m in re.finditer(rf"^#### 🟦 ASLI (\d+)\.(\d+)\b.*?\n(.*?){end}", body, re.M | re.S):
        tahap, n, block = m.groups()
        code = f"ASLI {tahap}.{n}"
        questions.append((code, int(tahap), ASLI_LEVEL[f"{tahap}.{n}"], *parse_block(code, block)))
    missing = [q[0] for q in questions if q[0] not in keys]
    assert not missing, ("no answer for", missing)
    assert len([q for q in questions if q[0].startswith("ASLI")]) == len(ASLI_LEVEL), "every ASLI question needs a level"
    return questions, keys


def main(bank_path, sets_dir):
    questions, keys = read_bank(bank_path)
    out = Path(sets_dir) / SET_NAME
    out.mkdir(parents=True, exist_ok=True)
    written = 0
    for file_name, title, prefix, tahap, asked, timing in SUBJECTS:
        parts = [f"# {title}", *timing, f"questions: {asked}", ""]
        sizes = []
        for level in ["high", "medium", "low"]:
            pool = sorted((q for q in questions if q[1] in (prefix, tahap) and q[2] == level), key=lambda q: q[0])
            # Every Pool must hold at least as many as are asked: an all-Low or all-High run never runs dry.
            assert len(pool) >= asked, (title, level, len(pool), asked)
            sizes.append(f"{len(pool)} {level} ({sum(q[0].startswith('ASLI') for q in pool)} ASLI)")
            for code, _, _, text, options in pool:
                answer = "ABCD".index(keys[code])
                parts += [f"## difficulty: {level} · {code}", text, ""]
                parts += [f"- [{'x' if i == answer else ' '}] {opt}" for i, opt in enumerate(options)]
                parts.append("")
                written += 1
        (out / file_name).write_text("\n".join(parts), encoding="utf-8")
        print(f"{title}: asks {asked} of " + ", ".join(sizes))
    assert written == len(questions), (written, len(questions))
    print(f"{SET_NAME}: all {written} questions of the bank")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

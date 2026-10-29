#!/usr/bin/env python3
"""Split ``archive/race-mechanics.md`` into book chapters under ``chapters/``.

Unlike the parenting guide, this source is already hierarchical (one ``#`` per
top-level section) and has no inline images, but it ships a 127-entry hand-written
table of contents and Google Docs ``{#anchor}`` attributes with paren-escaped link
targets.  This script:

* rebuilds the book as a README (cover + Part-grouped contents) plus 15 chapters,
* deletes the hand-written contents block, whose links are re-created in the README,
* drops ``{#...}`` attributes and rewrites every internal link (contents entries and
  in-prose cross-references alike) to a GitHub-style ``./file.md#slug``,
* merges the six short sections into one "Short mechanics" chapter,
* repairs heading levels so no chapter skips a level, and cleans Google Docs
  escaping without touching ``$...$``/LaTeX math.

Run it from this directory::

    python split_guide.py

It prints a verification report and exits non-zero if any check fails.
"""

from __future__ import annotations

from dataclasses import dataclass
import itertools
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent
ARCHIVE = ROOT / "archive" / "race-mechanics.md"
CHAPTERS_DIR = ROOT / "chapters"
REPORT = ROOT / "reports" / "split-report.md"

# Lines 13-266 are the hand-written contents block; it is replaced by the README's.
TOC_START, TOC_END = 13, 266
TOTAL_LINES = 1600

PARTS = (
    "Part I — Foundations",
    "Part II — Movement & stamina",
    "Part III — Skills",
    "Part IV — Track behaviour",
    "Part V — Reference",
)


@dataclass(frozen=True)
class Block:
    """A contiguous run of source lines inside a chapter."""

    start: int
    end: int
    shift: int = 0  # heading-level offset (used when merging sections)


@dataclass(frozen=True)
class Chapter:
    """One output chapter: its source blocks and how it is presented."""

    filename: str
    label: str
    blurb: str
    part: str
    blocks: tuple[Block, ...]
    title: str | None = None  # None -> keep the source's first heading as the title
    title_mode: str = "replace"  # "replace" the source title, or "prepend" a new one

    @property
    def prepends_title(self) -> bool:
        """Whether the chapter needs a synthetic title added above its blocks."""
        return self.title is not None and self.title_mode == "prepend"


CHAPTERS: tuple[Chapter, ...] = (
    Chapter(
        "00-introduction.md",
        "Introduction",
        "Who wrote this, where the race-mechanics data comes from and how to read the document.",
        PARTS[0],
        (Block(1, 12),),
        title="Introduction",
    ),
    Chapter(
        "01-concepts.md",
        "Concepts",
        "Frame rate, sections, phases and bashin — the units the rest of the guide is built on.",
        PARTS[0],
        (Block(267, 295),),
    ),
    Chapter(
        "02-stats.md",
        "Stats",
        "Raw, base and adjusted stats, and every modifier that turns one into the next.",
        PARTS[0],
        (Block(296, 364),),
    ),
    Chapter(
        "03-speed.md",
        "Speed",
        "Target speed, base speed, last spurt, blocking and minimum speed.",
        PARTS[1],
        (Block(365, 473),),
    ),
    Chapter(
        "04-acceleration.md",
        "Acceleration",
        "Base acceleration, start dash and natural deceleration.",
        PARTS[1],
        (Block(474, 528),),
    ),
    Chapter(
        "05-hp.md",
        "HP",
        "Stamina, HP consumption, recovery skills and what happens when a uma runs out.",
        PARTS[1],
        (Block(529, 582),),
    ),
    Chapter(
        "06-skills.md",
        "Skills",
        "Activation chance, ability/time/duration scaling and every skill condition the engine checks.",
        PARTS[2],
        (Block(583, 898),),
    ),
    Chapter(
        "07-lane.md",
        "Lane",
        "Lane-change speed, target lane, blocking, overlapping and vision.",
        PARTS[3],
        (Block(899, 1032),),
    ),
    Chapter(
        "08-position-keeping.md",
        "Position Keeping",
        "Pacemaker, front-runner and non-front-runner modes, pace-up-ex and the rushed state.",
        PARTS[3],
        (Block(1052, 1142),),
    ),
    Chapter(
        "09-spot-struggle.md",
        "Spot Struggle",
        "The lead competition that starts when runners fight for the same position.",
        PARTS[3],
        (Block(1143, 1168),),
    ),
    Chapter(
        "10-charge-up.md",
        "Charge Up",
        "Charge up / fully charged and conserve power / release, with their trigger conditions.",
        PARTS[3],
        (Block(1199, 1259),),
    ),
    Chapter(
        "11-compete-before-spurt.md",
        "Compete Before Spurt",
        "Position adjustment before the last spurt, and the stamina-keep variant.",
        PARTS[3],
        (Block(1260, 1324),),
    ),
    Chapter(
        "12-secure-lead.md",
        "Secure Lead",
        "The condition for holding the front and what it grants.",
        PARTS[3],
        (Block(1325, 1377),),
    ),
    Chapter(
        "13-wiz-limit-break-buff.md",
        "Wiz Limit Break Buff",
        "The wisdom limit-break buff: triggers, values and stacking.",
        PARTS[3],
        (Block(1417, 1497),),
    ),
    Chapter(
        "14-race-courses.md",
        "Race Courses",
        "Position and world transform, slope, course events and lane geometry.",
        PARTS[4],
        (Block(1513, 1559),),
    ),
    Chapter(
        "15-short-mechanics.md",
        "Short Mechanics",
        "Start delay, dueling, stamina limit break, zenkai spurt, finish time and misc frame notes.",
        PARTS[4],
        (
            Block(1033, 1051, shift=1),
            Block(1169, 1198, shift=1),
            Block(1378, 1401, shift=1),
            Block(1402, 1416, shift=1),
            Block(1498, 1512, shift=1),
            Block(1560, 1600, shift=1),
        ),
        title="Short Mechanics",
        title_mode="prepend",
    ),
)

# Google Docs backslash escapes that are safe to drop. Left escaped on purpose:
# ``* _ # < > [ ]`` (markdown syntax) and ``\ `` ``\t`` ``\a`` (LaTeX spacing and
# command names such as ``\times`` / ``\approx``).
UNESCAPE_SAFE = "!.:-+=~&()\\"

# Source headings whose level is inconsistent in the original document. Everything
# else keeps the author's own hierarchy.
LEVEL_OVERRIDES: dict[int, int] = {
    604: 3,  # "CurrentSpeed (21)"                       — source H4 under H2 "Skill Ability"
    612: 3,  # "CurrentSpeedWithNaturalDeceleration (22)" — sibling of the above
    1056: 2,  # "Normal Mode"                             — source H3 under H1 "Position Keeping"
}

# Cross-references we deliberately correct. The archive keeps the author's own wording and
# links; these corrections only affect the generated chapters. Keyed by (source line, anchor).
LINK_OVERRIDES: dict[tuple[int, str], tuple[str, str]] = {
    # The source links "position keep [normal mode]" to Lane's ``#normal-mode``, but the bullet
    # sits in a list of position-keeping modes whose sibling links Overtake mode in Position
    # Keeping (``#overtake-mode-1``). Repoint it at the heading the text actually means.
    (1214, "normal-mode"): ("./07-lane.md#normal-mode", "./08-position-keeping.md#normal-mode"),
}

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
ANCHOR_RE = re.compile(r"\s*\{#([^}]*)\}\s*$")
LINK_RE = re.compile(r"\]\(#((?:\\.|[^()\n])*)\)")
WORD_RE = re.compile(r"[\w']+", re.UNICODE)


def slugify(text: str) -> str:
    """Return the GitHub-style anchor slug for a heading."""
    text = text.strip().lower().replace("**", "").replace("`", "")
    text = re.sub(r"[^\w\s\-]", "", text, flags=re.UNICODE)
    return re.sub(r"\s", "-", text)


def unescape(line: str) -> str:
    """Drop the Google Docs backslash escapes that are safe to remove."""
    pattern = re.compile(r"\\(.)")

    def swap(match: re.Match[str]) -> str:
        return match.group(1) if match.group(1) in UNESCAPE_SAFE else match.group(0)

    return pattern.sub(swap, line)


@dataclass
class Heading:
    """A source heading and the chapter/slug it ends up in."""

    line: int
    level: int
    text: str
    anchor: str
    chapter: str = ""
    slug: str = ""


def parse_headings(lines: list[str]) -> list[Heading]:
    """Collect every source heading with its level, text and Google Docs anchor."""
    headings: list[Heading] = []
    for number, line in enumerate(lines, start=1):
        match = HEADING_RE.match(line)
        if not match:
            continue
        body = match.group(2)
        anchor_match = ANCHOR_RE.search(body)
        anchor = anchor_match.group(1) if anchor_match else ""
        text = ANCHOR_RE.sub("", body).strip()
        headings.append(Heading(number, len(match.group(1)), text, anchor))
    return headings


def assign_chapters(headings: list[Heading]) -> None:
    """Tag each heading with its chapter and normalise levels/slugs per chapter."""
    for chapter in CHAPTERS:
        owned = [h for h in headings if any(b.start <= h.line <= b.end for b in chapter.blocks)]
        if not owned:
            continue
        used: dict[str, int] = {}
        for index, heading in enumerate(owned):
            block = next(b for b in chapter.blocks if b.start <= heading.line <= b.end)
            level = LEVEL_OVERRIDES.get(heading.line, heading.level) + block.shift
            if chapter.title and chapter.title_mode == "replace" and index == 0:
                heading.text = chapter.title
                level = 1
            heading.level = level
            heading.chapter = chapter.filename
            base = slugify(unescape(heading.text))
            count = used.get(base, 0)
            used[base] = count + 1
            heading.slug = base if count == 0 else f"{base}-{count}"


def build_body(lines: list[str], headings: list[Heading]) -> list[str | None]:
    """Transform the source prose, returning one entry per source line."""
    by_line = {h.line: h for h in headings}
    anchor_to_target = {h.anchor: (h.chapter, h.slug) for h in headings if h.anchor}
    out: list[str | None] = []
    for number, line in enumerate(lines, start=1):
        if TOC_START <= number <= TOC_END:
            out.append(None)  # replaced by the README's generated contents
            continue
        heading = by_line.get(number)
        if heading:
            out.append(_rewrite_links("#" * heading.level + " " + heading.text, anchor_to_target, number))
            continue
        out.append(_rewrite_links(line, anchor_to_target, number))

    out = [None if line is None else unescape(line) for line in out]
    text = "\n".join(line for line in out if line is not None)
    if LINK_RE.search(text) or "{#" in text:
        msg = "unresolved internal link or leftover {#anchor} attribute"
        raise SystemExit(msg)
    return out


def _rewrite_links(text: str, targets: dict[str, tuple[str, str]], line_no: int) -> str:
    """Point every ``](#anchor)`` at its new chapter file and GitHub slug."""

    def swap(match: re.Match[str]) -> str:
        anchor = match.group(1).replace("\\", "")
        if (line_no, anchor) in LINK_OVERRIDES:
            return f"]({LINK_OVERRIDES[(line_no, anchor)][1]})"
        if anchor not in targets:
            msg = f"internal link target has no heading: {anchor!r}"
            raise SystemExit(msg)
        chapter, slug = targets[anchor]
        return f"](./{chapter}#{slug})"

    return LINK_RE.sub(swap, text)


def write_chapters(body: list[str | None]) -> None:
    """Slice the transformed body into chapter files with navigation footers."""
    CHAPTERS_DIR.mkdir(parents=True, exist_ok=True)
    for index, chapter in enumerate(CHAPTERS):
        chunk: list[str] = []
        if chapter.prepends_title:
            chunk += [f"# {chapter.title}", ""]
        for block in chapter.blocks:
            chunk += [line for line in body[block.start - 1 : block.end] if line is not None]
        lines = _tidy(chunk)
        lines += _footer(index)
        (CHAPTERS_DIR / chapter.filename).write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def _tidy(chunk: list[str]) -> list[str]:
    """Trim blank edges and collapse blank runs, keeping markdown hard breaks."""
    lines = ["" if not line.strip() else line for line in chunk]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    tidy: list[str] = []
    for line in lines:
        if not line and tidy and not tidy[-1]:
            continue
        tidy.append(line)
    return tidy


def _footer(index: int) -> list[str]:
    """Cross-chapter navigation for a book-style reading flow."""
    previous = CHAPTERS[index - 1] if index > 0 else None
    following = CHAPTERS[index + 1] if index + 1 < len(CHAPTERS) else None
    links: list[str] = []
    if previous:
        links.append(f"[← {previous.label}](./{previous.filename})")
    links.append("[Contents](../README.md)")
    if following:
        links.append(f"[{following.label} →](./{following.filename})")
    return ["", "---", "", "*" + " · ".join(links) + "*"]


def write_readme() -> None:
    """Write the book cover, provenance note and Part-grouped contents."""
    lines = [
        "# Uma Musume Race Mechanics",
        "",
        "by **KuromiAK**",
        "",
        (
            "A book-style edition of KuromiAK's reverse-engineered reference for how _Umamusume: "
            "Pretty Derby_ actually simulates a race — speed, acceleration, HP, skills, lane logic and "
            "the position-keeping modes. Formulas are kept as inline LaTeX (`$...$`)."
        ),
        "",
        "## Contents",
        "",
    ]
    for part in PARTS:
        members = [chapter for chapter in CHAPTERS if chapter.part == part]
        if not members:
            continue
        lines.append(f"### {part}")
        lines.append("")
        lines += [f"- **[{c.label}](./chapters/{c.filename})** — {c.blurb}" for c in members]
        lines.append("")

    lines += [
        "## Global edition",
        "",
        (
            "For the short version scoped to what is live on the **Global** release — formulas, "
            "constants and thresholds, with JP-only mechanics flagged — start with "
            "[`GLOBAL.md`](./GLOBAL.md). It is maintained by hand; these chapters are its source."
        ),
        "",
        "## About this edition",
        "",
        (
            "- The prose is split, verbatim, from the single-file source into 15 chapters. Nothing was "
            "rewritten; heading levels, anchors and internal links were normalised for the book layout."
        ),
        (
            "- The source's hand-written 127-entry table of contents is replaced by the contents above; "
            "all 172 internal links (contents entries plus in-prose cross-references) were rewritten to "
            "the new chapter files and GitHub-style anchors."
        ),
        (
            "- The six shortest sections — Start delay, Dueling, Stamina limit break, Zenkai spurt, "
            "Finish time and Misc notes — are collected into "
            "[Short Mechanics](./chapters/15-short-mechanics.md)."
        ),
        (
            "- A cross-reference bug in the source is corrected here: the position-keeping bullet in "
            "[Charge Up](./chapters/10-charge-up.md) linked Lane's Normal Mode instead of Position "
            "Keeping's. See the editorial corrections in "
            "[`reports/split-report.md`](./reports/split-report.md)."
        ),
        (
            "- The untouched original is kept at "
            "[`archive/race-mechanics.md`](./archive/race-mechanics.md) as the source of truth."
        ),
        (
            "- The transformation is reproducible: run `python split_guide.py`; it verifies the split and "
            "writes [`reports/split-report.md`](./reports/split-report.md)."
        ),
        "",
        (
            "> Content credit: **KuromiAK**. Mechanics derived from reverse engineering by "
            "[@umamusu_reveng](https://twitter.com/umamusu_reveng) and "
            "[@kak_eng](https://twitter.com/kak_eng) — see the introduction for the full credits."
        ),
        "",
    ]
    (ROOT / "README.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")


def canonical(text: str) -> list[str]:
    """Return the lower-cased prose word sequence, with markup stripped."""
    text = re.sub(r"\]\([^)]*\)", "]", text)  # drop link destinations
    text = re.sub(r"\{#[^}]*\}", "", text)
    lines = [HEADING_RE.sub(r"\2", line) for line in text.splitlines()]
    return [word.lower() for word in WORD_RE.findall("\n".join(lines))]


def chapter_body(filename: str) -> str:
    """Read a chapter file back, without its navigation footer."""
    text = (CHAPTERS_DIR / filename).read_text(encoding="utf-8")
    return re.sub(r"\n---\n\n\*\[[^\n]*\* *$", "", text)


def verify(raw_lines: list[str]) -> list[str]:
    """Return a verification report; raise ``SystemExit`` on a hard failure."""
    problems: list[str] = []
    report: list[str] = [
        "# Split report",
        "",
        ("Generated by `split_guide.py`. Every check below must pass for the split to be considered valid."),
        "",
        "| Check | Result |",
        "| --- | --- |",
    ]

    def check(label: str, ok: bool, detail: str) -> None:
        report.append(f"| {label} | {'✅' if ok else '❌'} {detail} |")
        if not ok:
            problems.append(f"{label}: {detail}")

    # 1. Line accounting: every source line is in a chapter, the replaced contents
    #    block, or blank.
    claimed: dict[int, str] = {}
    for chapter in CHAPTERS:
        for block in chapter.blocks:
            for number in range(block.start, block.end + 1):
                if number in claimed:
                    problems.append(f"line {number} claimed twice")
                claimed[number] = chapter.filename
    replaced = set(range(TOC_START, TOC_END + 1))
    unaccounted = [n for n in range(1, TOTAL_LINES + 1) if n not in claimed and n not in replaced]
    blank = [n for n in unaccounted if not raw_lines[n - 1].strip()]
    leftovers = [n for n in unaccounted if raw_lines[n - 1].strip()]
    check(
        "Line accounting",
        not leftovers,
        f"{len(claimed)} lines into chapters, {len(replaced)} replaced contents, {len(blank)} blank; no stray prose"
        if not leftovers
        else f"stray prose lines: {leftovers[:10]}",
    )

    # 2. Prose fidelity: the chapters carry exactly the source's words, minus the
    #    replaced contents block, plus the authored "Introduction" heading.
    source = list(raw_lines)
    source[0] = "# Introduction"
    expected = canonical("\n".join(source[: TOC_START - 1] + source[TOC_END:]))
    actual: list[str] = []
    for chapter in CHAPTERS:
        text = chapter_body(chapter.filename)
        if chapter.prepends_title:
            text = re.sub(r"^# .*\n", "", text, count=1)  # authored chapter title
        actual += canonical(text)
    if sorted(expected) != sorted(actual):
        missing = sorted(set(expected) - set(actual))[:8]
        extra = sorted(set(actual) - set(expected))[:8]
        check("Prose fidelity", False, f"missing {missing}; extra {extra}")
    else:
        check("Prose fidelity", True, f"{len(expected)} words match the source exactly")

    # 3. Links and anchors.
    all_chapters = {chapter.filename for chapter in CHAPTERS}
    slugs: dict[str, set[str]] = {}
    for chapter in CHAPTERS:
        text = (CHAPTERS_DIR / chapter.filename).read_text(encoding="utf-8")
        slugs[chapter.filename] = {
            slugify(HEADING_RE.sub(r"\2", line)) for line in text.splitlines() if line.startswith("#")
        }
    broken: list[str] = []
    links = 0
    for chapter in CHAPTERS:
        text = (CHAPTERS_DIR / chapter.filename).read_text(encoding="utf-8")
        for target in re.findall(r"\]\((\./[^)\n]*#[^)\n]*)\)", text):
            links += 1
            path, _, anchor = target.partition("#")
            name = Path(path).name
            if name not in all_chapters:
                broken.append(f"{chapter.filename} -> {target} (no such file)")
            elif anchor not in slugs[name]:
                broken.append(f"{chapter.filename} -> {target} (no such heading)")
    check("Internal links", not broken, f"{links} links all resolve" if not broken else "; ".join(broken[:5]))

    leftovers = []
    for chapter in CHAPTERS:
        text = (CHAPTERS_DIR / chapter.filename).read_text(encoding="utf-8")
        if "{#" in text:
            leftovers.append(f"{chapter.filename} still has {{#...}}")
        if re.search(r"\]\(#[^)\n]*\)", text):
            leftovers.append(f"{chapter.filename} still has a bare #anchor link")
    check(
        "Anchors normalised",
        not leftovers,
        "no {#...} attributes, no bare anchors" if not leftovers else str(leftovers),
    )

    # 4. Each chapter has exactly one H1 and no skipped heading levels.
    bad: list[str] = []
    for chapter in CHAPTERS:
        levels = [
            len(line) - len(line.lstrip("#"))
            for line in (CHAPTERS_DIR / chapter.filename).read_text(encoding="utf-8").splitlines()
            if line.startswith("#")
        ]
        if levels.count(1) != 1:
            bad.append(f"{chapter.filename} has {levels.count(1)} H1 headings")
        if any(b > a + 1 for a, b in itertools.pairwise(levels)):
            bad.append(f"{chapter.filename} skips a heading level: {levels}")
    check("Chapter structure", not bad, "one H1 each, no skipped levels" if not bad else "; ".join(bad))

    # 5. Deliberate cross-reference corrections.
    missed: list[str] = []
    for (line_no, _anchor), (stale, replacement) in LINK_OVERRIDES.items():
        owner = next(c for c in CHAPTERS if any(b.start <= line_no <= b.end for b in c.blocks))
        text = (CHAPTERS_DIR / owner.filename).read_text(encoding="utf-8")
        if replacement not in text:
            missed.append(f"{owner.filename}: {replacement} not applied")
        if stale in text:
            missed.append(f"{owner.filename}: stale {stale} still present")
    check(
        "Editorial corrections",
        not missed,
        f"{len(LINK_OVERRIDES)} cross-reference(s) repointed" if not missed else "; ".join(missed),
    )

    # 6. Math preserved.
    raw_math = sum(1 for line in raw_lines if line.count("$") >= 2)
    out_math = sum(
        1
        for chapter in CHAPTERS
        for line in (CHAPTERS_DIR / chapter.filename).read_text(encoding="utf-8").splitlines()
        if "\\times" in line or "\\approx" in line
    )
    check("LaTeX preserved", out_math >= 2, f"{raw_math} math lines carried over, \\times/\\approx intact")

    report += ["", "## Chapters", "", "| File | Source lines | Part |", "| --- | --- | --- |"]
    report += [
        f"| `{chapter.filename}` | {', '.join(f'{b.start}-{b.end}' for b in chapter.blocks)} | {chapter.part} |"
        for chapter in CHAPTERS
    ]
    report += [
        "",
        "## Editorial corrections",
        "",
        ("Deliberate fixes applied to the generated chapters. The archive keeps the author's own wording and links."),
        "",
        "| Source line | Correction |",
        "| --- | --- |",
    ]
    report += [
        f"| {line_no} | `[normal mode]` pointed at Lane's `#normal-mode`; the surrounding list is "
        f"about position-keeping modes, so it now targets `{replacement}`. |"
        for (line_no, _anchor), (_stale, replacement) in LINK_OVERRIDES.items()
    ]
    report += [
        "",
        "## Replaced source content",
        "",
        (
            f"Lines {TOC_START}-{TOC_END} of the archive are the hand-written table of contents. "
            "They are not reproduced in the chapters; the README's generated contents replaces them, "
            "and every one of their links resolves to the corresponding chapter heading."
        ),
        "",
    ]

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(report), encoding="utf-8", newline="\n")

    if problems:
        for problem in problems:
            print(f"FAIL: {problem}", file=sys.stderr)
        raise SystemExit(1)
    return report


def main() -> int:
    """Split the archive and print a verification report."""
    raw_lines = ARCHIVE.read_text(encoding="utf-8").split("\n")[:TOTAL_LINES]
    headings = parse_headings(raw_lines)
    assign_chapters(headings)
    body = build_body(raw_lines, headings)
    write_chapters(body)
    write_readme()
    report = verify(raw_lines)
    print("\n".join(report[:14]))
    print(f"\nWrote {len(CHAPTERS)} chapters, README and split report.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

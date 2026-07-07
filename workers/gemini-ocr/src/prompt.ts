/** Instruction prompt sent to Gemini alongside the screenshot. */
export const EXTRACTION_PROMPT = `Analyze this Uma Musume screenshot and extract the runner data.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "name": "character name",
  "outfit": "outfit name in brackets, exactly as shown",
  "speed": 0,
  "stamina": 0,
  "power": 0,
  "guts": 0,
  "wisdom": 0,
  "aptitudes": {
    "turf": "grade", "dirt": "grade",
    "sprint": "grade", "mile": "grade", "medium": "grade", "long": "grade",
    "front": "grade", "pace": "grade", "late": "grade", "end": "grade"
  },
  "strategy": "best visible strategy using only one of: Nige, Senkou, Sasi, Oikomi",
  "skills": ["every visible skill name exactly as shown, keeping any trailing ○/◎/× and any visible Lvl N marker"]
}

Requirements:
- Read the raw screenshot directly.
- Include all five stat numbers.
- Read EVERY aptitude grade individually from the screenshot, do not collapse or pick a best one.
  - Track row -> "turf" and "dirt".
  - Distance row -> "sprint", "mile", "medium", "long".
  - Style row -> "front", "pace", "late", "end".
- Each aptitude grade is exactly one of: S, A, B, C, D, E, F, G. A grade may show a small superscript + (e.g. A+); return just the base letter.
- Return the single best strategy name using Nige, Senkou, Sasi, or Oikomi.
- Include every visible skill name from the screenshot.
- Preserve each skill's visible suffixes such as ○, ◎, ×, and preserve visible level markers like Lvl 1, Lvl 2, Lvl 3, or Lvl 4.
- The suffix symbols ○, ◎, and × are part of the official skill name, not annotations.
- Many different skills exist in both ○ and ◎ versions. Do NOT simplify ◎ into ○ or guess based on familiarity.
- A single circle ○ and a double circle ◎ are different characters and must be transcribed exactly as shown.
- Pay special attention to the tiny symbol at the far right of the skill row; it may be faint but must be preserved exactly.
- If the screenshot shows ◎, return ◎. If it shows ○, return ○. If it shows ×, return ×.
- Example distinctions: "Right-Handed ○" != "Right-Handed ◎", "Hanshin Racecourse ○" != "Hanshin Racecourse ◎", "Long Straightaways ○" != "Long Straightaways ◎".
- Do not add extra keys.
- Do not wrap the JSON in markdown fences.`;

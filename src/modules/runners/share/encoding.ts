import { BitVector } from './bit-vector';
import type { ISingleExportData } from './types';

function parseUtcTimestamp(str: string): number {
  const [datePart, timePart] = str.split(' ');
  const [y, mo, d] = datePart!.split('-').map(Number);
  const [h, mi, s] = timePart!.split(':').map(Number);
  return Date.UTC(y!, mo! - 1, d, h, mi, s);
}

const clampStat = (v: number) => Math.max(0, Math.min(2047, v));
const clampApt = (v: number) => Math.max(0, Math.min(9, v));

export function encodeSingleUma(data: ISingleExportData): string {
  const bv = new BitVector();

  bv.write(2, 8);
  bv.write(data.card_id, 20);

  bv.write(clampStat(data.speed), 11);
  bv.write(clampStat(data.stamina), 11);
  bv.write(clampStat(data.power), 11);
  bv.write(clampStat(data.guts), 11);
  bv.write(clampStat(data.wiz), 11);

  bv.write(clampApt(data.proper_distance_short), 4);
  bv.write(clampApt(data.proper_distance_mile), 4);
  bv.write(clampApt(data.proper_distance_middle), 4);
  bv.write(clampApt(data.proper_distance_long), 4);
  bv.write(clampApt(data.proper_ground_turf), 4);
  bv.write(clampApt(data.proper_ground_dirt), 4);
  bv.write(clampApt(data.proper_running_style_nige), 4);
  bv.write(clampApt(data.proper_running_style_senko), 4);
  bv.write(clampApt(data.proper_running_style_sashi), 4);
  bv.write(clampApt(data.proper_running_style_oikomi), 4);

  const ms = parseUtcTimestamp(data.create_time);
  bv.write(Math.floor(ms / 1000) >>> 0, 32);

  if (data.rank_score != null) {
    bv.write(1, 1);
    bv.write(Math.max(0, Math.min(32767, data.rank_score)), 15);
  } else {
    bv.write(0, 1);
  }

  const skills = data.skill_array.slice(0, 63);
  bv.write(skills.length, 6);
  for (const skill of skills) {
    bv.write(skill.skill_id, 20);
    bv.write(Math.max(0, Math.min(15, skill.skill_level - 1)), 4);
  }

  return bv.toBase64();
}

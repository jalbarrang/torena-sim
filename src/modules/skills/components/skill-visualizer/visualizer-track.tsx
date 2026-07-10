import { Fragment, useMemo } from 'react';
import type { CourseData } from '@/lib/uma-domain/course/definitions';
import { RaceTrackDimensions } from '@/modules/racetrack/types';
import { SlopeVisualization } from '@/modules/racetrack/layers/slope-visualization';
import { SlopeLabelBar } from '@/modules/racetrack/layers/slope-label-bar';
import { SectionTypesBar } from '@/modules/racetrack/layers/section-bar';
import { PhaseBar } from '@/modules/racetrack/layers/phase-bar';
import { XAxis } from '@/modules/racetrack/axes/x-axis';
import type { SkillVisualizerEntry, VisualizerTriggerRow } from './use-skill-visualizer-data';

import '@/modules/racetrack/components/RaceTrack.css';

const ROW_HEIGHT = 30;
const ROWS_GAP = 6;
const BAND_HEIGHT = 12;
const AXIS_HEIGHT = 24;

type TrackRow = {
  key: string;
  label: string;
  color: string;
  trigger: VisualizerTriggerRow | null;
  message?: string;
};

function buildRows(entries: Array<SkillVisualizerEntry>): Array<TrackRow> {
  const rows: Array<TrackRow> = [];

  for (const entry of entries) {
    if (entry.status === 'unsupported') {
      rows.push({
        key: `${entry.skillId}-unsupported`,
        label: entry.name,
        color: entry.color,
        trigger: null,
        message: 'cannot be visualized (unsupported conditions)'
      });
      continue;
    }

    if (entry.status === 'no-activation') {
      rows.push({
        key: `${entry.skillId}-none`,
        label: entry.name,
        color: entry.color,
        trigger: null,
        message: 'does not activate under these race settings'
      });
      continue;
    }

    const contextSuffix = entry.contextLabel ? ` (${entry.contextLabel})` : '';

    for (const [index, trigger] of entry.triggers.entries()) {
      const suffix = entry.triggers.length > 1 ? ` (trigger ${index + 1})` : '';
      rows.push({
        key: `${entry.skillId}-${index}`,
        label: `${entry.name}${suffix}${contextSuffix}`,
        color: entry.color,
        trigger
      });
    }
  }

  return rows;
}

type VisualizerTrackRowProps = {
  row: TrackRow;
  y: number;
  courseDistance: number;
};

function VisualizerTrackRow(props: VisualizerTrackRowProps) {
  const { row, y, courseDistance } = props;
  const { trigger } = row;

  const bandY = ROW_HEIGHT - BAND_HEIGHT - 2;

  return (
    <svg
      x={RaceTrackDimensions.xOffset}
      y={y}
      width={RaceTrackDimensions.RenderWidth}
      height={ROW_HEIGHT}
      overflow="visible"
    >
      <line
        x1="0"
        x2="100%"
        y1={ROW_HEIGHT}
        y2={ROW_HEIGHT}
        stroke="var(--color-border)"
        strokeWidth={0.5}
      />

      {trigger
        ? trigger.regions.map((region) => {
            const xPct = (region.start / courseDistance) * 100;
            const widthPct = ((region.end - region.start) / courseDistance) * 100;
            const tooltip = trigger.isRandom
              ? `${Math.round(region.start)}m – ${Math.round(region.end)}m (activates at a random point inside this window)`
              : `${Math.round(region.start)}m – ${Math.round(region.end)}m`;

            return (
              <Fragment key={`${region.start}-${region.end}`}>
                <rect
                  x={`${xPct}%`}
                  y={bandY}
                  width={`${Math.max(widthPct, 0.25)}%`}
                  height={BAND_HEIGHT}
                  rx={2}
                  fill={row.color}
                  fillOpacity={trigger.isRandom ? 0.4 : 0.85}
                  stroke={row.color}
                  strokeWidth={1}
                  strokeDasharray={trigger.isRandom ? '3,2' : undefined}
                >
                  <title>{tooltip}</title>
                </rect>

                {!trigger.isRandom && (
                  <line
                    x1={`${xPct}%`}
                    x2={`${xPct}%`}
                    y1={bandY - 2}
                    y2={bandY + BAND_HEIGHT + 2}
                    stroke={row.color}
                    strokeWidth={2}
                  />
                )}
              </Fragment>
            );
          })
        : null}

      <text
        x={2}
        y={bandY - 3}
        fontSize={10}
        fontWeight={600}
        fill="var(--color-foreground)"
        stroke="var(--color-background)"
        strokeWidth={2.5}
        paintOrder="stroke"
      >
        {row.label}
        {trigger?.isRandom ? ' · random in window' : ''}
        {trigger?.hasDynamicCondition ? ' *' : ''}
        {row.message ? ` — ${row.message}` : ''}
      </text>
    </svg>
  );
}

export type SkillVisualizerTrackProps = {
  course: CourseData;
  entries: Array<SkillVisualizerEntry>;
};

export function SkillVisualizerTrack(props: SkillVisualizerTrackProps) {
  const { course, entries } = props;

  const rows = useMemo(() => buildRows(entries), [entries]);

  const rowsTop = RaceTrackDimensions.SectionNumbersBarY + ROWS_GAP;
  const axisY = rowsTop + rows.length * ROW_HEIGHT + ROWS_GAP;
  const viewHeight = axisY + AXIS_HEIGHT;

  return (
    <div className="overflow-x-auto md:overflow-x-hidden">
      <div className="min-w-[1000px] md:min-w-0">
        <svg
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${RaceTrackDimensions.ViewWidth} ${viewHeight}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full"
          data-courseid={course.courseId}
        >
          <SlopeVisualization course={course} />
          <SlopeLabelBar course={course} />
          <SectionTypesBar course={course} />
          <PhaseBar course={course} />

          {rows.map((row, index) => (
            <VisualizerTrackRow
              key={row.key}
              row={row}
              y={rowsTop + index * ROW_HEIGHT}
              courseDistance={course.distance}
            />
          ))}

          {/* XAxis positions itself at the fixed RaceTrack layout Y; shift it to sit below the skill rows. */}
          <g transform={`translate(0, ${axisY - RaceTrackDimensions.xAxisY})`}>
            <XAxis courseDistance={course.distance} />
          </g>
        </svg>
      </div>
    </div>
  );
}

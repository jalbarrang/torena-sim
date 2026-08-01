import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { SkillComparisonRoundResult } from '@/modules/simulation/types';
import type { SkillSummaryMeta } from '@/modules/skills/skill-cost-summary';
import type { SkillEntry } from '@/modules/data/services/SkillService';
import { skillsService } from '@/modules/data/services/SkillService';
import { buildSkillCostSummary } from '@/modules/skills/skill-cost-summary';
import { sortableHeader } from './bassin-table-header';
import { skillNameCell } from './skill-name-cell';
import { formatBasinn } from './format-basinn';

type UseBassinColumnsOptions = {
  showUmaIcons: boolean;
  showSkillIds: boolean;
  skillMetadataById: Map<string, SkillEntry>;
  filteredData: Array<SkillComparisonRoundResult>;
  showLPerSP: boolean;
  hasFastLearner: boolean;
  getSkillMeta?: (skillId: string) => SkillSummaryMeta;
};

export function useBassinColumns({
  showUmaIcons,
  showSkillIds,
  skillMetadataById,
  filteredData,
  showLPerSP,
  hasFastLearner,
  getSkillMeta
}: UseBassinColumnsOptions) {
  const costBySkillId = useMemo(() => {
    if (!showLPerSP || !getSkillMeta) return new Map<string, number>();

    return new Map(
      filteredData.map((row) => [
        row.id,
        buildSkillCostSummary({
          skillId: row.id,
          hasFastLearner,
          getSkillMeta
        }).netTotal
      ])
    );
  }, [filteredData, getSkillMeta, hasFastLearner, showLPerSP]);

  const columns: Array<ColumnDef<SkillComparisonRoundResult>> = useMemo(() => {
    return [
      {
        id: 'actions',
        header: '',
        cell: () => null,
        enableSorting: false
      },
      {
        id: 'expand',
        header: '',
        cell: () => null,
        enableSorting: false
      },
      {
        header: () => <span>Skill name</span>,
        accessorKey: 'id',
        cell: skillNameCell({
          showUmaIcons,
          showSkillIds,
          skillMetadataById
        }),
        sortingFn: (a, b, _) => {
          const skillIdA = a.getValue('id');
          const skillIdB = b.getValue('id');

          const skillNameA = skillsService.getNameById(`${skillIdA}`);
          const skillNameB = skillsService.getNameById(`${skillIdB}`);

          return skillNameA < skillNameB ? -1 : 1;
        }
      },
      ...(showLPerSP
        ? [
            {
              id: 'lPerSP',
              header: sortableHeader(
                'L / SP',
                'Mean lengths gained per skill point spent (includes hints, Fast Learner, and prerequisite costs)'
              ),
              accessorFn: (row) => {
                const cost = costBySkillId.get(row.id);
                if (cost == null || cost === 0) return null;
                return row.mean / cost;
              },
              cell: (cellProps) => {
                const value = cellProps.getValue<number | null>();
                const cost = costBySkillId.get(cellProps.row.original.id);
                if (cost === 0) {
                  return <span className="text-muted-foreground text-xs">Owned</span>;
                }
                if (value == null || !Number.isFinite(value)) {
                  return <span className="text-muted-foreground">—</span>;
                }
                return <span>{value.toFixed(3)}</span>;
              },
              sortDescFirst: true,
              sortUndefined: 'last' as const
            } satisfies ColumnDef<SkillComparisonRoundResult>
          ]
        : []),
      {
        header: sortableHeader('Minimum'),
        accessorKey: 'min',
        cell: formatBasinn
      },
      {
        header: sortableHeader('Maximum'),
        accessorKey: 'max',
        cell: formatBasinn,
        sortDescFirst: true
      },
      {
        header: sortableHeader('Mean'),
        accessorKey: 'mean',
        cell: formatBasinn,
        sortDescFirst: true
      },
      {
        header: sortableHeader('Median'),
        accessorKey: 'median',
        cell: formatBasinn,
        sortDescFirst: true
      }
    ];
  }, [showUmaIcons, showSkillIds, skillMetadataById, costBySkillId, showLPerSP]);

  return columns;
}

import { getIconUrl } from '@/assets/icons';
import { memo } from 'react';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { Aptitude } from '@/lib/uma-domain/runner/definitions';

export type IShareCardProps = {
  ref?: React.Ref<HTMLDivElement | null>;
  runner: IRunnerState;
  umaInfo: { name: string; outfit: string } | null;
  imageUrl: string;
  skills: Array<{ id: string; name: string; iconId: string; rarity: number }>;
};

const FONT_STACK = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

const COLORS = {
  bg: '#101010',
  surface: '#171717',
  text: '#fafafa',
  textSecondary: '#a1a1a1',
  primary: '#57a112',
  border: '#282828',
  muted: '#262626'
} as const;

function rarityBarStyle(rarity: number): React.CSSProperties {
  const isUnique = rarity >= 3 && rarity <= 5;
  if (isUnique) {
    return {
      width: 4,
      flexShrink: 0,
      borderRadius: '4px 0 0 4px',
      background:
        'linear-gradient(180deg, rgb(197, 255, 190), rgb(189, 235, 255), rgb(195, 208, 255), rgb(255, 138, 222))'
    };
  }

  const solidColors: Record<number, string> = {
    1: '#9496bd',
    2: '#ffbe28',
    6: '#c0392b'
  };

  return {
    width: 4,
    flexShrink: 0,
    borderRadius: '4px 0 0 4px',
    backgroundColor: solidColors[rarity] ?? solidColors[1]
  };
}

const STAT_DEFS = [
  { key: 'speed', label: 'Spd', icon: getIconUrl('status_00.png') },
  { key: 'stamina', label: 'Sta', icon: getIconUrl('status_01.png') },
  { key: 'power', label: 'Pow', icon: getIconUrl('status_02.png') },
  { key: 'guts', label: 'Guts', icon: getIconUrl('status_03.png') },
  { key: 'wisdom', label: 'Wit', icon: getIconUrl('status_04.png') }
] as const;

const STAT_CARD_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  backgroundColor: COLORS.muted,
  borderRadius: 8,
  padding: '8px 2px 6px'
};

const SKILL_PILL_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'stretch',
  fontSize: 12,
  lineHeight: 1.3,
  borderRadius: 5,
  backgroundColor: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderLeft: 'none',
  color: COLORS.text,
  whiteSpace: 'nowrap',
  overflow: 'hidden'
};

function rankForStat(x: number): number {
  if (x > 1200) {
    return Math.min(18 + Math.floor((x - 1200) / 100) * 10 + (Math.floor(x / 10) % 10), 97);
  } else if (x >= 1150) {
    return 17;
  } else if (x >= 1100) {
    return 16;
  } else if (x >= 400) {
    return 8 + Math.floor((x - 400) / 100);
  } else {
    return Math.floor(x / 50);
  }
}

function rankIconPath(rank: number): string {
  return getIconUrl(`statusrank/ui_statusrank_${(100 + rank).toString().slice(1)}.png`);
}

function aptitudeIconPath(grade: string): string {
  const aptVal = Aptitude[grade as keyof typeof Aptitude] ?? 7;
  const idx = 7 - aptVal;
  return getIconUrl(`utx_ico_statusrank_${(100 + idx).toString().slice(1)}.png`);
}

export const ShareCard = memo(function ShareCard(props: IShareCardProps) {
  const { ref, runner, umaInfo, imageUrl, skills } = props;
  return (
    <div
      ref={ref}
      style={{
        width: 420,
        fontFamily: FONT_STACK,
        backgroundColor: COLORS.bg,
        color: COLORS.text,
        borderRadius: 12,
        overflow: 'hidden',
        border: `1px solid ${COLORS.border}`
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '18px 20px 14px',
          borderBottom: `1px solid ${COLORS.border}`
        }}
      >
        <img
          src={imageUrl}
          alt=""
          style={{
            width: 64,
            height: 64,
            borderRadius: 10,
            objectFit: 'cover',
            border: `2px solid ${COLORS.border}`,
            flexShrink: 0
          }}
        />

        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1 }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              lineHeight: 1.25
            }}
          >
            {umaInfo?.name ?? 'Unknown'}
          </div>

          <div
            style={{
              fontSize: 12,
              color: COLORS.textSecondary
            }}
          >
            {umaInfo?.outfit ?? runner.outfitId}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '14px 16px',
          gap: 6
        }}
      >
        {STAT_DEFS.map((stat) => {
          const value = runner[stat.key];
          const rank = rankForStat(value);

          return (
            <div key={stat.key} style={STAT_CARD_STYLE}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <img src={stat.icon} alt="" style={{ width: 18, height: 18 }} />
                <img
                  src={rankIconPath(rank)}
                  alt=""
                  style={{ width: 18, height: 18, objectFit: 'cover' }}
                />
              </div>

              <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>{value}</div>
            </div>
          );
        })}
      </div>

      {/* Info Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          padding: '6px 20px 14px',
          borderBottom: `1px solid ${COLORS.border}`,
          fontSize: 13
        }}
      >
        <span
          style={{
            backgroundColor: COLORS.surface,
            padding: '3px 10px',
            borderRadius: 6,
            border: `1px solid ${COLORS.border}`,
            color: COLORS.text,
            fontWeight: 600
          }}
        >
          {runner.strategy}
        </span>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 'auto'
          }}
        >
          {(
            [
              ['Distance', runner.distanceAptitude],
              ['Surface', runner.surfaceAptitude],
              ['Style', runner.strategyAptitude]
            ] as const
          ).map(([label, grade]) => (
            <span
              key={label}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                backgroundColor: COLORS.surface,
                padding: '3px 6px',
                borderRadius: 6,
                border: `1px solid ${COLORS.border}`
              }}
            >
              <span style={{ color: COLORS.textSecondary, fontSize: 12 }}>{label}</span>
              <img
                src={aptitudeIconPath(grade)}
                alt={grade}
                style={{ width: 18, height: 14, objectFit: 'contain' }}
              />
            </span>
          ))}
        </div>
      </div>

      {/* Skills */}
      <div style={{ padding: '12px 20px 8px' }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: COLORS.textSecondary,
            textTransform: 'uppercase' as const,
            letterSpacing: 0.8,
            marginBottom: 8
          }}
        >
          Skills
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {skills.map((skill) => (
            <span key={skill.id} style={SKILL_PILL_STYLE}>
              <span style={rarityBarStyle(skill.rarity)} />
              <span
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px' }}
              >
                {skill.iconId && (
                  <img
                    src={getIconUrl(`${skill.iconId}.png`)}
                    alt=""
                    style={{
                      width: 16,
                      height: 16,
                      objectFit: 'contain',
                      flexShrink: 0
                    }}
                  />
                )}
                {skill.name}
              </span>
            </span>
          ))}
          {skills.length === 0 && (
            <span style={{ color: COLORS.textSecondary, fontSize: 12 }}>No skills</span>
          )}
        </div>
      </div>

      {/* Watermark */}
      <div id="share-card-watermark" style={{ height: 24, padding: '0 20px' }} />
    </div>
  );
});

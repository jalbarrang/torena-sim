import React, { useCallback, useRef } from 'react';

const TOOLTIP_PAD_X = 4;
const TOOLTIP_PAD_Y = 2;
const EDGE_MARGIN = 4;

export function useSkillTooltip() {
  const tooltipRef = useRef<SVGGElement>(null);
  const bgRef = useRef<SVGRectElement>(null);

  const show = useCallback(() => {
    const g = tooltipRef.current;
    const bg = bgRef.current;
    const textEl = g?.querySelector('text');
    if (!g || !bg || !textEl) return;

    // SVG paints in document order (no z-index): raise the hovered marker's
    // element chain (markers are nested <svg>s) to the end of each parent so
    // the tooltip is never covered by chips rendered after it. Climbs until
    // the root `.racetrackView` svg.
    let node: Element = g;
    while (node.parentElement && !node.parentElement.classList.contains('racetrackView')) {
      const parent = node.parentElement;
      if (parent.lastElementChild !== node) {
        parent.appendChild(node);
      }
      node = parent;
    }

    g.style.display = '';
    g.setAttribute('transform', '');

    const bbox = textEl.getBBox();
    bg.setAttribute('x', String(bbox.x - TOOLTIP_PAD_X));
    bg.setAttribute('y', String(bbox.y - TOOLTIP_PAD_Y));
    bg.setAttribute('width', String(bbox.width + TOOLTIP_PAD_X * 2));
    bg.setAttribute('height', String(bbox.height + TOOLTIP_PAD_Y * 2));

    const track = g.closest<SVGSVGElement>('.racetrackView') ?? g.ownerSVGElement;
    if (!track) return;

    const gRect = g.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const ctm = g.getCTM();
    if (!ctm || ctm.a === 0) return;

    const scale = ctm.a;
    const overflowRight = gRect.right - trackRect.right;
    const overflowLeft = trackRect.left - gRect.left;

    if (overflowRight > 0) {
      g.setAttribute('transform', `translate(${-(overflowRight / scale + EDGE_MARGIN)}, 0)`);
    } else if (overflowLeft > 0) {
      g.setAttribute('transform', `translate(${overflowLeft / scale + EDGE_MARGIN}, 0)`);
    }
  }, []);

  const hide = useCallback(() => {
    if (tooltipRef.current) tooltipRef.current.style.display = 'none';
  }, []);

  return { tooltipRef, bgRef, show, hide };
}

export type SkillTooltipProps = {
  label: string;
  tooltipRef: React.RefObject<SVGGElement | null>;
  bgRef: React.RefObject<SVGRectElement | null>;
  offsetY: number;
};

export const SkillTooltip = React.memo<SkillTooltipProps>(
  ({ label, tooltipRef, bgRef, offsetY }) => (
    <g ref={tooltipRef} style={{ display: 'none', pointerEvents: 'none' }}>
      <rect ref={bgRef} rx="3" ry="3" fill="rgba(0,0,0,0.8)" />
      <text y={offsetY} textAnchor="middle" fill="#fff" fontSize="8px" fontWeight="500">
        {label}
      </text>
    </g>
  )
);

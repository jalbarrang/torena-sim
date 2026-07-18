import { memo, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { CourseData } from '@/lib/uma-domain/course/definitions';
import {
  getRunnerLanesAtTick,
  getRunnerPositionsAtTick,
  usePlaybackStore
} from '@/modules/race-sim/stores/playback.store';
import { buildCourseTrackPath, type BuiltTrackPath } from '@/modules/race-sim/utils/track-path';
import { pointerToVirtualCanvas, zoomViewportAroundPoint } from './canvasMath';
import { TrackTopDownLegend } from './TrackTopDownLegend';
import { TrackRunnerPackZoom } from './TrackRunnerPackZoom';
import {
  buildTrackTopDownScene,
  paintTrackBaseLayer,
  paintTrackHudLayer,
  paintTrackOverlayLayer,
  resolveTrackSceneColors
} from './trackLayers';
import { CANVAS_H, CANVAS_W, type MainTrackLayerId, type ViewportState } from './shared';
import { buildTrackMarkers } from './trackPrimitives';
import { clamp } from './utils';

type TrackTopDownViewProps = {
  courseData: CourseData;
  runnerNames?: Record<number, string>;
  trackedRunnerIds?: number[];
  viewStart?: number;
  viewEnd?: number;
  className?: string;
};

type TrackState =
  | { status: 'loading' }
  | { status: 'ready'; track: BuiltTrackPath }
  | { status: 'error' };

type TrackAction =
  | { type: 'track:load-start' }
  | { type: 'track:load-success'; track: BuiltTrackPath }
  | { type: 'track:load-error' };

function trackReducer(_state: TrackState, action: TrackAction): TrackState {
  switch (action.type) {
    case 'track:load-start':
      return { status: 'loading' };
    case 'track:load-success':
      return { status: 'ready', track: action.track };
    case 'track:load-error':
      return { status: 'error' };
    default:
      return { status: 'loading' };
  }
}

const EMPTY_TRACK: BuiltTrackPath = {
  points: [],
  turnSign: 0,
  wraps: false,
  lapLength: 1,
  numLaps: 1,
  raceStartOnTrack: 0
};

export const TrackTopDownView = memo<TrackTopDownViewProps>(function TrackTopDownView(props) {
  const {
    courseData,
    runnerNames = {},
    trackedRunnerIds = [],
    viewStart,
    viewEnd,
    className
  } = props;

  const courseDistance = Math.max(courseData.distance, 1);
  const courseWidth = courseData.courseWidth;
  const clampedViewStart = clamp(viewStart ?? 0, 0, courseDistance);
  const clampedViewEnd = clamp(viewEnd ?? courseDistance, clampedViewStart, courseDistance);

  const [trackState, dispatchTrack] = useReducer(trackReducer, { status: 'loading' });
  const markers = useMemo(() => buildTrackMarkers(courseData), [courseData]);
  const activeBuiltTrack = trackState.status === 'ready' ? trackState.track : EMPTY_TRACK;
  const { points, turnSign } = activeBuiltTrack;

  const containerRef = useRef<HTMLDivElement>(null);
  const trackCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ width: CANVAS_W, height: CANVAS_H });
  const [canvasFrameSize, setCanvasFrameSize] = useState(sizeRef.current);
  const viewportRef = useRef<ViewportState>({ zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef<{ pointerId: number | null; x: number; y: number }>({
    pointerId: null,
    x: 0,
    y: 0
  });

  const configRef = useRef({
    builtTrack: activeBuiltTrack,
    turnSign,
    courseWidth,
    courseDistance,
    viewStart: clampedViewStart,
    viewEnd: clampedViewEnd,
    runnerNames,
    trackedRunnerIds,
    turn: courseData.turn,
    markers
  });

  configRef.current = {
    builtTrack: activeBuiltTrack,
    turnSign,
    courseWidth,
    courseDistance,
    viewStart: clampedViewStart,
    viewEnd: clampedViewEnd,
    runnerNames,
    trackedRunnerIds,
    turn: courseData.turn,
    markers
  };

  useEffect(() => {
    let cancelled = false;
    dispatchTrack({ type: 'track:load-start' });

    void buildCourseTrackPath(courseData)
      .then((nextBuiltTrack) => {
        if (!cancelled) {
          dispatchTrack({ type: 'track:load-success', track: nextBuiltTrack });
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to build course track path', error);
        if (!cancelled) {
          dispatchTrack({ type: 'track:load-error' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [courseData]);

  const dirtyLayersRef = useRef<Record<MainTrackLayerId, boolean>>({
    track: true,
    overlay: true,
    hud: true
  });
  const frameRef = useRef<number | null>(null);
  const flushLayers = useRef<() => void>(() => {});
  const scheduleLayers = useRef<(layers?: MainTrackLayerId[]) => void>(() => {});

  flushLayers.current = () => {
    frameRef.current = null;
    const state = usePlaybackStore.getState();
    const positions = getRunnerPositionsAtTick(
      state.results,
      state.selectedRound,
      state.currentTick
    );
    const lanes = getRunnerLanesAtTick(state.results, state.selectedRound, state.currentTick);
    const cfg = configRef.current;
    if (cfg.builtTrack.points.length < 2) return;
    const { width, height } = sizeRef.current;
    const dpr = globalThis.devicePixelRatio || 1;
    const scene = buildTrackTopDownScene({
      viewport: viewportRef.current,
      builtTrack: cfg.builtTrack,
      courseWidth: cfg.courseWidth,
      turnSign: cfg.turnSign,
      courseDistance: cfg.courseDistance,
      viewStart: cfg.viewStart,
      viewEnd: cfg.viewEnd,
      runnerPositions: positions,
      runnerNames: cfg.runnerNames,
      trackedRunnerIds: cfg.trackedRunnerIds,
      markers: cfg.markers
    });
    const colors = resolveTrackSceneColors();

    if (dirtyLayersRef.current.track) {
      const ctx = trackCanvasRef.current?.getContext('2d');
      if (ctx) {
        paintTrackBaseLayer({
          ctx,
          dpr,
          measuredWidth: width,
          measuredHeight: height,
          scene,
          colors
        });
      }
    }

    if (dirtyLayersRef.current.overlay) {
      const ctx = overlayCanvasRef.current?.getContext('2d');
      if (ctx) {
        paintTrackOverlayLayer({
          ctx,
          dpr,
          measuredWidth: width,
          measuredHeight: height,
          scene,
          colors,
          runnerPositions: positions,
          runnerLanes: lanes
        });
      }
    }
    if (dirtyLayersRef.current.hud) {
      const ctx = hudCanvasRef.current?.getContext('2d');
      if (ctx) {
        paintTrackHudLayer({
          ctx,
          dpr,
          measuredWidth: width,
          measuredHeight: height,
          scene,
          colors,
          turn: cfg.turn,
          runnerPositions: positions
        });
      }
    }

    dirtyLayersRef.current = { track: false, overlay: false, hud: false };
  };

  scheduleLayers.current = (layers = ['track', 'overlay', 'hud']) => {
    for (const layer of layers) {
      dirtyLayersRef.current[layer] = true;
    }

    if (frameRef.current != null) return;
    frameRef.current = globalThis.requestAnimationFrame(() => {
      flushLayers.current();
    });
  };

  useEffect(() => {
    viewportRef.current = { zoom: 1, panX: 0, panY: 0 };
    scheduleLayers.current();
  }, [
    points,
    turnSign,
    courseWidth,
    courseDistance,
    clampedViewStart,
    clampedViewEnd,
    runnerNames,
    trackedRunnerIds
  ]);

  useEffect(() => {
    const unsub = usePlaybackStore.subscribe((state, prev) => {
      if (state.currentTick !== prev.currentTick || state.selectedRound !== prev.selectedRound) {
        scheduleLayers.current(['overlay', 'hud']);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const rw = rect.width;
      const rh = rect.height;
      const aspect = CANVAS_W / CANVAS_H;
      let width: number;
      let height: number;
      if (rw / rh > aspect) {
        height = rh;
        width = rh * aspect;
      } else {
        width = rw;
        height = rw / aspect;
      }
      sizeRef.current = { width, height };
      setCanvasFrameSize({ width, height });
      scheduleLayers.current();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      scheduleLayers.current();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style']
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const point = pointerToVirtualCanvas(event.clientX, event.clientY, rect);
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;

      viewportRef.current = zoomViewportAroundPoint(viewportRef.current, point, factor);
      scheduleLayers.current();
    };

    const onPointerDown = (event: PointerEvent) => {
      dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (dragRef.current.pointerId !== event.pointerId) return;
      const rect = canvas.getBoundingClientRect();
      const dx = ((event.clientX - dragRef.current.x) / Math.max(rect.width, 1)) * CANVAS_W;
      const dy = ((event.clientY - dragRef.current.y) / Math.max(rect.height, 1)) * CANVAS_H;
      dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      viewportRef.current = {
        ...viewportRef.current,
        panX: viewportRef.current.panX + dx,
        panY: viewportRef.current.panY + dy
      };
      scheduleLayers.current();
    };

    const endDrag = (event: PointerEvent) => {
      if (dragRef.current.pointerId !== event.pointerId) return;
      dragRef.current = { pointerId: null, x: 0, y: 0 };
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    const onDoubleClick = () => {
      viewportRef.current = { zoom: 1, panX: 0, panY: 0 };
      scheduleLayers.current();
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('dblclick', onDoubleClick);

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('dblclick', onDoubleClick);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) {
        globalThis.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return (
    <div className={cn('flex flex-col md:flex-row w-full', className)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center">
          <div
            className="relative shrink-0"
            style={{ width: canvasFrameSize.width, height: canvasFrameSize.height }}
          >
            <canvas
              ref={trackCanvasRef}
              className="absolute inset-0 block h-full w-full pointer-events-none"
            />
            <canvas
              ref={overlayCanvasRef}
              className="absolute inset-0 block h-full w-full touch-none cursor-grab active:cursor-grabbing"
            />
            <canvas
              ref={hudCanvasRef}
              className="absolute inset-0 block h-full w-full pointer-events-none"
            />
            {trackState.status === 'loading' && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Loading track geometry…
              </div>
            )}
          </div>
        </div>

        <TrackRunnerPackZoom
          courseData={courseData}
          runnerNames={runnerNames}
          trackedRunnerIds={trackedRunnerIds}
        />
      </div>

      <TrackTopDownLegend
        courseData={courseData}
        runnerNames={runnerNames}
        trackedRunnerIds={trackedRunnerIds}
      />
    </div>
  );
});

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  parseVisualizerShareParams,
  VISUALIZER_COURSE_PARAM,
  VISUALIZER_SKILLS_PARAM
} from './share-params';
import { setVisualizedSkills, setVisualizerCourseId } from './store';

/**
 * Deep-link import for the Skill Visualizer.
 *
 * Reads `?skills=<id,id,…>&course=<id>` on load, hydrates the visualizer store, then strips the
 * params so the link isn't re-applied on navigation or shared accidentally. Runs after zustand
 * persist has hydrated (persistence is synchronous for localStorage), so a shared link always
 * wins over whatever the recipient had saved.
 *
 * Example: `/skill-visualizer?skills=100271,200531&course=10501`
 */
export function useVisualizerImport() {
  const [searchParams, setSearchParams] = useSearchParams();
  const importedRef = useRef(false);

  useEffect(() => {
    if (importedRef.current) {
      return;
    }

    const shared = parseVisualizerShareParams(searchParams);
    if (!shared) {
      return;
    }

    importedRef.current = true;

    if (shared.skillIds.length > 0) {
      setVisualizedSkills(shared.skillIds);
    }
    if (shared.courseId !== null) {
      setVisualizerCourseId(shared.courseId);
    }

    if (shared.skillIds.length > 0 || shared.courseId !== null) {
      toast.success('Visualizer loaded from link');
    } else {
      toast.error('Invalid visualizer link');
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete(VISUALIZER_SKILLS_PARAM);
    nextParams.delete(VISUALIZER_COURSE_PARAM);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);
}

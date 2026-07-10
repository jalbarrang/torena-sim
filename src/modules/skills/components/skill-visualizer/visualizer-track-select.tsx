import { useCallback, useMemo } from 'react';
import {
  getCourseIdByTrackIdAndIndex,
  getDefaultTrackIdForCourse,
  useCoursesByTrack
} from '@/modules/racetrack/courses';
import { trackDescription } from '@/modules/racetrack/labels';
import { trackIds } from '@/i18n/lang/tracknames';

import i18n from '@/i18n';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { setVisualizerCourseId, useSkillVisualizerStore } from './store';

const getTrackName = (trackId: number) => {
  return i18n.t(`tracknames.${trackId}`);
};

type VisualizerTrackSelectProps = React.HTMLAttributes<HTMLDivElement>;

export function VisualizerTrackSelect(props: VisualizerTrackSelectProps) {
  const { className, ...rest } = props;

  const courseId = useSkillVisualizerStore((state) => state.courseId);
  const coursesByTrack = useCoursesByTrack();

  const trackid = useMemo(() => getDefaultTrackIdForCourse(courseId), [courseId]);

  const handleChangeCourse = useCallback((value: string | null) => {
    if (!value) {
      return;
    }

    setVisualizerCourseId(+value);
  }, []);

  const handleChangeTrack = useCallback((value: string | null) => {
    if (!value) {
      return;
    }

    const newTrackId = +value;
    setVisualizerCourseId(getCourseIdByTrackIdAndIndex(newTrackId, 0));
  }, []);

  return (
    <div className={className} {...rest}>
      <Select value={trackid.toString()} onValueChange={handleChangeTrack}>
        <SelectTrigger className="w-full md:w-40">
          <SelectValue>{getTrackName(trackid)}</SelectValue>
        </SelectTrigger>

        <SelectContent>
          {trackIds.map((trackId) => (
            <SelectItem key={`track-${trackId}`} value={trackId}>
              {getTrackName(+trackId)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={courseId.toString()} onValueChange={handleChangeCourse}>
        <SelectTrigger className="w-full md:w-40">
          <SelectValue>{trackDescription({ courseid: courseId })}</SelectValue>
        </SelectTrigger>

        <SelectContent>
          {(coursesByTrack[trackid] ?? []).map((cid) => (
            <SelectItem value={cid.toString()} key={cid}>
              {trackDescription({ courseid: +cid })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

import { createRequestId } from './requestId';

/** Each independent experience task starts its own project; continuation is explicit. */
export function newTaskDefaults(className?: string) {
  return className === '体验组'
    ? { projectId: `experience-${createRequestId()}`, inheritPrevious: false }
    : { projectId: 'snake-course', inheritPrevious: true };
}

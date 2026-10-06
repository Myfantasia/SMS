import NoticesHub from '../notices/NoticesHub';
import EventsHub from '../events/EventsHub';
import AttendanceHub from '../attendaces/AttendanceHub';
import ExamsHub from '../exams/ExamsHub';
import AssignmentsHub from '../assignments/AssignmentsHub';
import ResultsHub from '../results/ResultsHub';
import { useAccess } from '../../libs/permissions';

// Route elements for the teacher and staff dashboards, where the same hub has to show a
// different variant depending on what the user's assigned roles grant -- not on which dashboard
// they happen to be in. The admin dashboard passes role="admin" statically because the Admin
// role holds every permission.
//
// The hubs still take a `role` prop ('admin' = manage/post controls, anything else = read-only).
// These wrappers derive that prop from the permission code the backend enforces for the same
// action, so the UI and the API can't disagree -- and, because the layout keeps permissions
// current, the variant switches live when an admin grants or removes the code.

export function NoticesRoute() {
  const { can } = useAccess();
  return <NoticesHub role={can('notices.edit') ? 'admin' : 'teacher'} />;
}

export function EventsRoute() {
  const { can } = useAccess();
  return <EventsHub role={can('events.edit') ? 'admin' : 'teacher'} />;
}

export function AttendanceRoute() {
  const { can } = useAccess();
  return <AttendanceHub role={can('attendance.edit') ? 'admin' : 'teacher'} />;
}

export function ExamsRoute() {
  const { can } = useAccess();
  return <ExamsHub role={can('exams.edit') ? 'admin' : 'teacher'} />;
}

export function AssignmentsRoute() {
  const { can } = useAccess();
  return <AssignmentsHub role={can('assignments.edit') ? 'admin' : 'teacher'} />;
}

export function ResultsRoute() {
  const { can } = useAccess();
  // canPromote inside ResultsHub already checks promotion.manage on its own; this only
  // decides the admin-vs-teacher variant (e.g. the "Calculate" button in Class Performance),
  // which should follow results.edit rather than always being force-enabled for staff.
  return <ResultsHub role={can('results.edit') ? 'admin' : 'teacher'} />;
}

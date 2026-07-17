// Shared between TimetableGrid and MasterTimetableView so the same subject
// renders the same color in both the per-class grid and the whole-school view.
const SUBJECT_COLORS = [
  'bg-blue-50 text-blue-700 border-blue-200', 'bg-purple-50 text-purple-700 border-purple-200',
  'bg-emerald-50 text-emerald-700 border-emerald-200', 'bg-amber-50 text-amber-700 border-amber-200',
  'bg-rose-50 text-rose-700 border-rose-200', 'bg-cyan-50 text-cyan-700 border-cyan-200',
  'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200', 'bg-lime-50 text-lime-700 border-lime-200',
];

// A stable full-string hash instead of `name.length % n` — length alone collides constantly
// (e.g. "Biology" and "History" are both 7 letters and would always render the same color).
export function getSubjectColor(subjectName: string): string {
  let hash = 0;
  for (let i = 0; i < subjectName.length; i++) {
    hash = (hash * 31 + subjectName.charCodeAt(i)) | 0;
  }
  return SUBJECT_COLORS[Math.abs(hash) % SUBJECT_COLORS.length];
}

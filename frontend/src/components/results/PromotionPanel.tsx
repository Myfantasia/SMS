import { useEffect, useRef, useState } from 'react';
import {
  Box, Card, CardContent, CardHeader, Button, TextField, MenuItem, Alert,
  CircularProgress, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Autocomplete, Switch, FormControlLabel,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import { CheckCircle2, Download } from 'lucide-react';
import api from '../../libs/axiosInstance';
import { pollJob } from '../../libs/pollJob';
import { assignmentService } from '../../libs/assignmentService';
import ProcessStepCard from './ProcessStepCard';

interface AcademicYearOption {
  id: number;
  year: string;
}

interface GradeOption {
  id: number;
  grade_name: string;
  curriculum_id: number;
}

interface TierOption {
  id: number;
  name: string;
  exit_exam_code: string;
  exit_is_terminal: boolean;
}

interface ReadinessRow {
  student_id: number;
  name: string;
  grade_name: string | null;
  transition_type: string | null;
  requirement: string | null;
  ready: boolean;
  reason: string | null;
  next_grade_name: string | null;
  exam_code: string | null;
}

interface ReadinessResponse {
  summary: { ready: number; blocked: number; by_reason: Record<string, number> };
  students: ReadinessRow[];
}

interface PromotionOutcome {
  student_id: number;
  outcome: string;
  detail: string;
}

interface PromotionResult {
  message: string;
  outcomes: PromotionOutcome[];
}

interface StudentOption {
  id: number;
  name: string;
}

interface StreamOption {
  id: number;
  label: string;
}

interface TermStatus {
  id: number;
  name: string;
  results_finalized: boolean;
}

interface RequirementGroup {
  transition_type: 'plain' | 'exam_gated' | 'exit';
  exam_code: string | null;
  grade_names: string[];
  requirement: string;
  satisfied: boolean;
  detail: string;
  terms?: TermStatus[];
}

interface PrerequisitesResponse {
  scope: { academic_year: string; grade_name: string | null };
  requirement_groups: RequirementGroup[];
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  // Guard against CSV/formula injection: a cell whose text starts with =, +, -, or @ can be
  // interpreted as a formula by Excel/Sheets/LibreOffice when the file is opened. Some of
  // these fields (student names, exam destinations) are admin-entered free text, so a leading
  // single quote is prefixed to force spreadsheet apps to treat the value as literal text.
  const escape = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ReadinessTable({
  rows, nameById, onExport,
}: {
  rows: ReadinessRow[] | PromotionOutcome[];
  nameById?: Record<number, string>;
  onExport?: () => void;
}) {
  const isReadinessRows = rows.length > 0 && 'ready' in rows[0];
  return (
    <Stack spacing={1}>
      {onExport && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="small" startIcon={<Download size={16} />} onClick={onExport}>Export CSV</Button>
        </Box>
      )}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Student</TableCell>
            {isReadinessRows && <TableCell>Transition</TableCell>}
            <TableCell>{isReadinessRows ? 'Requirement' : 'Outcome'}</TableCell>
            <TableCell>{isReadinessRows ? 'Status' : 'Detail'}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {isReadinessRows
            ? (rows as ReadinessRow[]).map((row) => (
                <TableRow key={row.student_id}>
                  <TableCell>
                    {row.name} <Typography component="span" variant="caption" color="text.secondary">({row.grade_name ?? '—'})</Typography>
                  </TableCell>
                  <TableCell>
                    {row.transition_type === 'exit'
                      ? <Chip size="small" variant="outlined" label={`Graduates${row.exam_code ? ` (${row.exam_code})` : ''}`} />
                      : row.next_grade_name
                        ? <Chip size="small" variant="outlined" label={`→ ${row.next_grade_name}${row.exam_code ? ` (${row.exam_code})` : ''}`} />
                        : '—'}
                  </TableCell>
                  <TableCell>{row.requirement ?? '—'}</TableCell>
                  <TableCell>
                    {row.ready
                      ? <Chip size="small" color="success" label="Ready" />
                      : <Chip size="small" color="warning" label={row.reason ?? 'Blocked'} />}
                  </TableCell>
                </TableRow>
              ))
            : (rows as PromotionOutcome[]).map((row) => (
                <TableRow key={row.student_id}>
                  <TableCell>{nameById?.[row.student_id] ?? `Student #${row.student_id}`}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={row.outcome === 'promoted' ? 'success' : row.outcome === 'graduated' ? 'info' : 'warning'}
                      label={row.outcome}
                    />
                  </TableCell>
                  <TableCell>{row.detail}</TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </Stack>
  );
}

export default function PromotionPanel() {
  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);
  const [grades, setGrades] = useState<GradeOption[]>([]);
  const [tiers, setTiers] = useState<TierOption[]>([]);

  useEffect(() => {
    api.get('/api/academic-years/').then((res) => setAcademicYears(res.data?.data ?? []));
    api.get('/api/academic-hub/').then((res) => setGrades(res.data?.data?.classes ?? []));
    api.get('/api/core/curriculum/tiers/').then((res) => setTiers(res.data ?? []));
  }, []);

  const [students, setStudents] = useState<StudentOption[]>([]);
  const [streams, setStreams] = useState<StreamOption[]>([]);

  useEffect(() => {
    api.get('/api/academic-hub/').then((res) => {
      const classes = res.data?.data?.classes ?? [];
      setStreams(classes.flatMap((c: any) =>
        (c.streams ?? []).map((s: any) => ({ id: s.id, label: `${c.grade_name} · ${s.name}` }))
      ));
    });
    api.get('/api/approved-users/students/').then((res) => {
      setStudents((res.data?.data ?? []).map((s: any) => ({ id: s.id, name: s.name })));
    }).catch(() => setStudents([]));
  }, []);

  // --- Working Scope: shared by the Requirements / Check Readiness / Run Promotion steps. ---
  const [scopeYearId, setScopeYearId] = useState('');
  const [scopeGradeId, setScopeGradeId] = useState('');

  const [prerequisites, setPrerequisites] = useState<PrerequisitesResponse | null>(null);
  const [prereqLoading, setPrereqLoading] = useState(false);
  const [prereqError, setPrereqError] = useState<string | null>(null);
  const [finalizingTermId, setFinalizingTermId] = useState<number | null>(null);

  const fetchPrerequisites = async (yearId: string, gradeId: string) => {
    if (!yearId) {
      setPrerequisites(null);
      return;
    }
    setPrereqLoading(true);
    setPrereqError(null);
    try {
      const params = new URLSearchParams({ academic_year_id: yearId });
      if (gradeId) params.set('grade_id', gradeId);
      const res = await api.get(`/api/promotion/prerequisites/?${params.toString()}`);
      setPrerequisites(res.data);
    } catch (err: any) {
      setPrereqError(err.response?.data?.error || 'Failed to load promotion requirements.');
      setPrerequisites(null);
    } finally {
      setPrereqLoading(false);
    }
  };

  useEffect(() => {
    fetchPrerequisites(scopeYearId, scopeGradeId);
    setReadiness(null);
    setPromoteResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeYearId, scopeGradeId]);

  const handleFinalizeTerm = async (termId: number, finalized: boolean) => {
    setFinalizingTermId(termId);
    try {
      await api.post(`/api/promotion/finalize-term/${termId}/`, { finalized });
      await fetchPrerequisites(scopeYearId, scopeGradeId);
    } catch (err: any) {
      setPrereqError(err.response?.data?.error || 'Failed to update finalization state.');
    } finally {
      setFinalizingTermId(null);
    }
  };

  const noStudentsInScope = prerequisites !== null && prerequisites.requirement_groups.length === 0;
  const allRequirementsSatisfied = prerequisites !== null
    && prerequisites.requirement_groups.length > 0
    && prerequisites.requirement_groups.every((g) => g.satisfied);
  const unmetRequirements = prerequisites?.requirement_groups.filter((g) => !g.satisfied) ?? [];

  const step2Locked = !scopeYearId || prereqLoading || noStudentsInScope;
  const step2LockedReason = !scopeYearId
    ? 'Select an academic year above to begin.'
    : prereqLoading
      ? 'Checking requirements…'
      : 'No enrolled students in this scope.';

  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<PromotionResult | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcomeNameById, setOutcomeNameById] = useState<Record<number, string>>({});

  const handleCheckReadiness = async () => {
    if (!scopeYearId) return;
    setCheckingReadiness(true);
    setReadinessError(null);
    setPromoteResult(null);
    try {
      const params = new URLSearchParams({ academic_year_id: scopeYearId });
      if (scopeGradeId) params.set('grade_id', scopeGradeId);
      const res = await api.get(`/api/promotion/readiness/?${params.toString()}`);
      setReadiness(res.data);
    } catch (err: any) {
      setReadinessError(err.response?.data?.error || 'Failed to check readiness.');
      setReadiness(null);
    } finally {
      setCheckingReadiness(false);
    }
  };

  const handlePromote = async () => {
    if (!scopeYearId || !readiness) return;
    setPromoting(true);
    setPromoteError(null);
    setPromoteResult(null);
    try {
      const response = await api.post('/api/promotion/promote-students/', {
        academic_year_id: scopeYearId,
        grade_id: scopeGradeId || undefined,
      });
      const result = await pollJob<PromotionResult>(response.data.job_id);
      // Snapshot names before clearing readiness below — nameById is derived from `readiness`,
      // so nulling it first would leave the outcome table/CSV with no names to resolve against.
      setOutcomeNameById(Object.fromEntries(readiness.students.map((row) => [row.student_id, row.name])));
      setPromoteResult(result);
      setReadiness(null);
    } catch (err: any) {
      setPromoteError(err.response?.data?.error || err.message || 'Failed to run bulk promotion.');
    } finally {
      setPromoting(false);
    }
  };

  // A successful promoteResult must keep Step 3 unlocked on its own — otherwise clearing the
  // stale pre-promotion `readiness` (above) would re-lock the very step meant to display that
  // result, hiding the success alert, outcome table, and its CSV export the moment the run
  // succeeds (both state updates land in the same batched render).
  const step3Locked = !promoteResult && (!readiness || readiness.summary.ready === 0);
  const step3LockedReason = !readiness
    ? 'Run "Check Readiness" in Step 2 first.'
    : 'No students are currently ready to promote.';

  const exportReadinessCsv = () => {
    if (!readiness) return;
    downloadCsv(
      `promotion-readiness-${scopeYearId}.csv`,
      ['Student', 'Grade', 'Transition', 'Requirement', 'Ready', 'Reason'],
      readiness.students.map((r) => [
        r.name,
        r.grade_name ?? '',
        r.transition_type === 'exit' ? 'Graduates' : (r.next_grade_name ?? ''),
        r.requirement ?? '',
        r.ready ? 'Yes' : 'No',
        r.reason ?? '',
      ]),
    );
  };

  const exportOutcomeCsv = () => {
    if (!promoteResult) return;
    downloadCsv(
      `promotion-outcomes-${scopeYearId}.csv`,
      ['Student', 'Outcome', 'Detail'],
      promoteResult.outcomes.map((o) => [outcomeNameById[o.student_id] ?? `Student #${o.student_id}`, o.outcome, o.detail]),
    );
  };

  const examSectionRef = useRef<HTMLDivElement>(null);

  const [singleStudent, setSingleStudent] = useState<StudentOption | null>(null);
  const [singleYearId, setSingleYearId] = useState('');
  const [singleReadiness, setSingleReadiness] = useState<ReadinessRow | null>(null);
  const [singleChecking, setSingleChecking] = useState(false);
  const [singlePromoting, setSinglePromoting] = useState(false);
  const [singleResult, setSingleResult] = useState<PromotionOutcome | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);

  const [bulkExamMode, setBulkExamMode] = useState(false);
  const [examStudent, setExamStudent] = useState<StudentOption | null>(null);
  const [examStreamId, setExamStreamId] = useState('');
  const [examCode, setExamCode] = useState('KJSEA');
  const [examYearId, setExamYearId] = useState('');
  const [destination, setDestination] = useState('');
  const [recordingExam, setRecordingExam] = useState(false);
  const [examMsg, setExamMsg] = useState<string | null>(null);
  const [examFailed, setExamFailed] = useState(false);

  useEffect(() => {
    if (scopeYearId) {
      setSingleYearId((prev) => prev || scopeYearId);
      setExamYearId((prev) => prev || scopeYearId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeYearId]);

  const handleCheckSingle = async () => {
    if (!singleStudent || !singleYearId) return;
    setSingleChecking(true);
    setSingleError(null);
    setSingleResult(null);
    try {
      const params = new URLSearchParams({ academic_year_id: singleYearId, student_id: String(singleStudent.id) });
      const res = await api.get(`/api/promotion/readiness/?${params.toString()}`);
      setSingleReadiness((res.data as ReadinessResponse).students[0] ?? null);
    } catch (err: any) {
      setSingleError(err.response?.data?.error || 'Failed to check readiness.');
    } finally {
      setSingleChecking(false);
    }
  };

  const handlePromoteSingle = async () => {
    if (!singleStudent || !singleYearId) return;
    setSinglePromoting(true);
    setSingleError(null);
    try {
      const res = await api.post(`/api/promotion/promote-student/${singleStudent.id}/`, { academic_year_id: singleYearId });
      setSingleResult(res.data);
      setSingleReadiness(null);
    } catch (err: any) {
      setSingleError(err.response?.data?.error || 'Failed to promote this student.');
    } finally {
      setSinglePromoting(false);
    }
  };

  const handleRecordExam = async () => {
    if (!examYearId) return;
    setRecordingExam(true);
    setExamMsg(null);
    setExamFailed(false);
    try {
      if (bulkExamMode) {
        if (!examStreamId) return;
        const roster = await assignmentService.getStudentsForStream(examStreamId);
        const studentIds = roster.map((s) => s.id);
        if (studentIds.length === 0) {
          setExamMsg('That stream has no active students.');
          setExamFailed(true);
          return;
        }
        const results = await Promise.allSettled(studentIds.map((id) =>
          api.post(`/api/promotion/national-exam/${id}/`, { exam_code: examCode, academic_year_id: examYearId, destination })
        ));
        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.length - succeeded;
        if (failed === 0) {
          setExamMsg(`Recorded ${examCode} for ${succeeded} student(s).`);
        } else {
          setExamMsg(`Recorded ${examCode} for ${succeeded} of ${results.length} student(s) — ${failed} failed.`);
          setExamFailed(true);
        }
      } else {
        if (!examStudent) return;
        await api.post(`/api/promotion/national-exam/${examStudent.id}/`, { exam_code: examCode, academic_year_id: examYearId, destination });
        setExamMsg('Exam record saved.');
      }
      await fetchPrerequisites(scopeYearId, scopeGradeId);
    } catch (err: any) {
      setExamMsg(err.response?.data?.error || 'Failed to save exam record(s).');
      setExamFailed(true);
    } finally {
      setRecordingExam(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Card variant="outlined">
        <CardHeader title="Tier Requirements" subheader="What each tier requires before a student can promote past it — configure this from Curriculum → Tiers." />
        <CardContent>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tier</TableCell>
                <TableCell>Exit requirement</TableCell>
                <TableCell>Leaves this school</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tiers.map((tier) => (
                <TableRow key={tier.id}>
                  <TableCell>{tier.name}</TableCell>
                  <TableCell>
                    {tier.exit_exam_code
                      ? <Chip size="small" label={tier.exit_exam_code} />
                      : <Chip size="small" variant="outlined" label="Not configured (plain)" />}
                  </TableCell>
                  <TableCell>{tier.exit_exam_code ? (tier.exit_is_terminal ? 'Yes' : 'No') : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader
          title="Working Scope"
          subheader="Every step below applies to this academic year (and grade, if narrowed) until you change it."
        />
        <CardContent>
          <Stack direction="row" spacing={2}>
            <TextField
              select label="Academic Year" value={scopeYearId}
              onChange={(e) => setScopeYearId(e.target.value)}
              size="small" sx={{ minWidth: 160 }}
            >
              {academicYears.map((y) => <MenuItem key={y.id} value={y.id}>{y.year}</MenuItem>)}
            </TextField>
            <TextField
              select label="Grade (optional — whole school if blank)" value={scopeGradeId}
              onChange={(e) => setScopeGradeId(e.target.value)}
              size="small" sx={{ minWidth: 220 }}
            >
              <MenuItem value="">Whole school</MenuItem>
              {grades.map((g) => <MenuItem key={g.id} value={g.id}>{g.grade_name}</MenuItem>)}
            </TextField>
          </Stack>
        </CardContent>
      </Card>

      <ProcessStepCard
        step={1}
        title="Requirements"
        subheader="What must be true before this scope can be checked for readiness."
        locked={false}
      >
        {!scopeYearId && <Alert severity="info">Select an academic year above to see requirements.</Alert>}
        {prereqLoading && <CircularProgress size={20} />}
        {prereqError && <Alert severity="error">{prereqError}</Alert>}
        {prerequisites && noStudentsInScope && <Alert severity="info">No enrolled students in this scope.</Alert>}
        {prerequisites && prerequisites.requirement_groups.length > 0 && (
          <Stack spacing={2}>
            {prerequisites.requirement_groups.map((group) => (
              <Box key={`${group.transition_type}-${group.exam_code ?? 'none'}`}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  {group.satisfied
                    ? <Chip size="small" color="success" label="Satisfied" />
                    : <Chip size="small" color="warning" label="Not yet" />}
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{group.requirement}</Typography>
                  <Typography variant="caption" color="text.secondary">({group.grade_names.join(', ')})</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5, mb: 1 }}>{group.detail}</Typography>
                {group.terms && (
                  <Table size="small">
                    <TableBody>
                      {group.terms.map((term) => (
                        <TableRow key={term.id}>
                          <TableCell>{term.name}</TableCell>
                          <TableCell>
                            {term.results_finalized
                              ? <Chip size="small" color="success" label="Finalized" />
                              : <Chip size="small" variant="outlined" label="Not finalized" />}
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              variant={term.results_finalized ? 'outlined' : 'contained'}
                              disabled={finalizingTermId === term.id}
                              onClick={() => handleFinalizeTerm(term.id, !term.results_finalized)}
                            >
                              {finalizingTermId === term.id
                                ? <CircularProgress size={16} />
                                : term.results_finalized ? 'Un-finalize' : 'Finalize'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {!group.terms && !group.satisfied && (
                  <Button
                    size="small" variant="outlined"
                    onClick={() => {
                      if (group.exam_code) setExamCode(group.exam_code);
                      if (scopeYearId) setExamYearId(scopeYearId);
                      examSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
                    }}
                  >
                    Go to National Exam Recording
                  </Button>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </ProcessStepCard>

      <ProcessStepCard
        step={2}
        title="Check Readiness"
        subheader="Confirms exactly who's ready before anything is run."
        locked={step2Locked}
        lockedReason={step2LockedReason}
      >
        <Stack spacing={2}>
          {prerequisites !== null && !allRequirementsSatisfied && (
            <Alert severity="warning">
              Not all Step 1 requirements are met yet for this scope: {unmetRequirements.map((g) => g.requirement).join('; ')}.
              Some students below may show as blocked for reasons Step 1 already explains.
            </Alert>
          )}
          <Box>
            <Button variant="outlined" disabled={checkingReadiness} onClick={handleCheckReadiness}>
              {checkingReadiness ? <CircularProgress size={20} /> : 'Check Readiness'}
            </Button>
          </Box>
          {readinessError && <Alert severity="error">{readinessError}</Alert>}
          {readiness && (
            <>
              <Stack direction="row" spacing={1}>
                <Chip color="success" label={`${readiness.summary.ready} ready`} />
                {Object.entries(readiness.summary.by_reason).map(([reason, count]) => (
                  <Chip key={reason} color="warning" label={`${count} blocked: ${reason}`} />
                ))}
              </Stack>
              <ReadinessTable rows={readiness.students} onExport={exportReadinessCsv} />
            </>
          )}
        </Stack>
      </ProcessStepCard>

      <ProcessStepCard
        step={3}
        title="Run Promotion"
        subheader="Promotes every ready student in this scope. Held students are skipped, never force-promoted."
        locked={step3Locked}
        lockedReason={step3LockedReason}
      >
        <Stack spacing={2}>
          <Box>
            <Button variant="contained" color="primary" disabled={promoting} onClick={() => setConfirmOpen(true)}>
              {promoting ? <CircularProgress size={20} /> : 'Run Promotion'}
            </Button>
          </Box>
          {promoteError && <Alert severity="error">{promoteError}</Alert>}
          {promoteResult && (
            <>
              <Alert severity="success" icon={<CheckCircle2 size={20} />}>
                <Typography variant="body2">{promoteResult.message}</Typography>
              </Alert>
              <ReadinessTable rows={promoteResult.outcomes} nameById={outcomeNameById} onExport={exportOutcomeCsv} />
            </>
          )}
        </Stack>
      </ProcessStepCard>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Confirm Promotion Run</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will promote {readiness?.summary.ready ?? 0} student(s)
            {readiness && readiness.summary.blocked > 0 ? ` and skip ${readiness.summary.blocked} held student(s)` : ''}
            {' '}for {academicYears.find((y) => String(y.id) === scopeYearId)?.year ?? 'the selected year'}.
            This cannot be undone from this panel. Continue?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={() => { setConfirmOpen(false); handlePromote(); }}>
            Run Promotion
          </Button>
        </DialogActions>
      </Dialog>

      <Card variant="outlined">
        <CardHeader title="Quick Override — Check / Promote a Single Student" subheader="For one-off corrections outside a full scope run." />
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
              <Autocomplete
                options={students}
                getOptionLabel={(o) => o.name}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={singleStudent}
                onChange={(_e, value) => { setSingleStudent(value); setSingleReadiness(null); setSingleResult(null); }}
                sx={{ minWidth: 260 }}
                renderInput={(params) => <TextField {...params} label="Student" size="small" />}
              />
              <TextField select label="Academic Year" value={singleYearId} onChange={(e) => { setSingleYearId(e.target.value); setSingleReadiness(null); }} size="small" sx={{ minWidth: 160 }}>
                {academicYears.map((y) => <MenuItem key={y.id} value={y.id}>{y.year}</MenuItem>)}
              </TextField>
              <Button variant="outlined" disabled={singleChecking || !singleStudent || !singleYearId} onClick={handleCheckSingle}>
                {singleChecking ? <CircularProgress size={20} /> : 'Check'}
              </Button>
            </Stack>
            {singleError && <Alert severity="error">{singleError}</Alert>}
            {singleReadiness && (
              <>
                <Alert severity={singleReadiness.ready ? 'success' : 'warning'}>
                  {singleReadiness.requirement ?? 'No requirement'} — {singleReadiness.ready ? 'Ready to promote.' : singleReadiness.reason}
                </Alert>
                <Box>
                  <Button variant="contained" disabled={!singleReadiness.ready || singlePromoting} onClick={handlePromoteSingle}>
                    {singlePromoting ? <CircularProgress size={20} /> : 'Promote This Student'}
                  </Button>
                </Box>
              </>
            )}
            {singleResult && (
              <Alert severity={singleResult.outcome === 'held' ? 'warning' : 'success'}>
                {singleResult.outcome}: {singleResult.detail}
              </Alert>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined" ref={examSectionRef}>
        <CardHeader title="Record a National Exam" subheader="KPSEA (Grade 6), KJSEA (Grade 9), or KCSE (Form 4 / Grade 12)." />
        <CardContent>
          <Stack spacing={2}>
            <FormControlLabel
              control={<Switch checked={bulkExamMode} onChange={(e) => setBulkExamMode(e.target.checked)} />}
              label="Record for a whole stream at once"
            />
            <Stack direction="row" spacing={2}>
              {bulkExamMode ? (
                <TextField select label="Stream" value={examStreamId} onChange={(e) => setExamStreamId(e.target.value)} size="small" sx={{ minWidth: 220 }}>
                  {streams.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
                </TextField>
              ) : (
                <Autocomplete
                  options={students}
                  getOptionLabel={(o) => o.name}
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  value={examStudent}
                  onChange={(_e, value) => setExamStudent(value)}
                  sx={{ minWidth: 260 }}
                  renderInput={(params) => <TextField {...params} label="Student" size="small" />}
                />
              )}
              <TextField select label="Academic Year" value={examYearId} onChange={(e) => setExamYearId(e.target.value)} size="small" sx={{ minWidth: 160 }}>
                {academicYears.map((y) => <MenuItem key={y.id} value={y.id}>{y.year}</MenuItem>)}
              </TextField>
              <TextField select label="Exam" value={examCode} onChange={(e) => setExamCode(e.target.value)} size="small" sx={{ minWidth: 120 }}>
                <MenuItem value="KPSEA">KPSEA</MenuItem>
                <MenuItem value="KJSEA">KJSEA</MenuItem>
                <MenuItem value="KCSE">KCSE</MenuItem>
              </TextField>
            </Stack>
            <TextField
              label="Destination (placement school / university — optional for KPSEA)"
              value={destination} onChange={(e) => setDestination(e.target.value)} size="small" fullWidth
            />
            <Box>
              <Button
                variant="contained"
                disabled={recordingExam || !examYearId || (bulkExamMode ? !examStreamId : !examStudent)}
                onClick={handleRecordExam}
              >
                {recordingExam ? <CircularProgress size={20} /> : bulkExamMode ? 'Save for Whole Stream' : 'Save Exam Record'}
              </Button>
            </Box>
          </Stack>
          {examMsg && <Alert sx={{ mt: 2 }} severity={examFailed ? 'error' : 'success'}>{examMsg}</Alert>}
        </CardContent>
      </Card>
    </Stack>
  );
}

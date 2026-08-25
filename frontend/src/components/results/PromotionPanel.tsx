import { useEffect, useState } from 'react';
import {
  Box, Card, CardContent, CardHeader, Button, TextField, MenuItem, Alert,
  CircularProgress, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Divider, Autocomplete, Switch, FormControlLabel,
} from '@mui/material';
import { GraduationCap, CheckCircle2 } from 'lucide-react';
import api from '../../libs/axiosInstance';
import { pollJob } from '../../libs/pollJob';
import { assignmentService } from '../../libs/assignmentService';

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

function ReadinessTable({ rows, nameById }: { rows: ReadinessRow[] | PromotionOutcome[]; nameById?: Record<number, string> }) {
  const isReadinessRows = rows.length > 0 && 'ready' in rows[0];
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Student</TableCell>
          <TableCell>{isReadinessRows ? 'Requirement' : 'Outcome'}</TableCell>
          <TableCell>{isReadinessRows ? 'Status' : 'Detail'}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {isReadinessRows
          ? (rows as ReadinessRow[]).map((row) => (
              <TableRow key={row.student_id}>
                <TableCell>{row.name} <Typography component="span" variant="caption" color="text.secondary">({row.grade_name ?? '—'})</Typography></TableCell>
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
      setStreams(classes.map((c: any) => ({ id: c.id, label: `${c.grade_name} · Stream #${c.id}` })));
    });
    api.get('/api/approved-users/students/').then((res) => {
      setStudents((res.data?.data ?? []).map((s: any) => ({ id: s.id, name: s.name })));
    }).catch(() => setStudents([]));
  }, []);

  const [termId, setTermId] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeMsg, setFinalizeMsg] = useState<string | null>(null);
  const [finalizeFailed, setFinalizeFailed] = useState(false);

  const handleFinalize = async (finalized: boolean) => {
    if (!termId) return;
    setFinalizing(true);
    setFinalizeMsg(null);
    setFinalizeFailed(false);
    try {
      await api.post(`/api/promotion/finalize-term/${termId}/`, { finalized });
      setFinalizeMsg(finalized ? 'Term finalized.' : 'Term un-finalized.');
    } catch (err: any) {
      setFinalizeMsg(err.response?.data?.error || 'Failed to update finalization state.');
      setFinalizeFailed(true);
    } finally {
      setFinalizing(false);
    }
  };

  const [bulkYearId, setBulkYearId] = useState('');
  const [bulkGradeId, setBulkGradeId] = useState('');
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<PromotionResult | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const handleCheckReadiness = async () => {
    if (!bulkYearId) return;
    setCheckingReadiness(true);
    setReadinessError(null);
    setPromoteResult(null);
    try {
      const params = new URLSearchParams({ academic_year_id: bulkYearId });
      if (bulkGradeId) params.set('grade_id', bulkGradeId);
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
    if (!bulkYearId || !readiness) return;
    setPromoting(true);
    setPromoteError(null);
    setPromoteResult(null);
    try {
      const response = await api.post('/api/promotion/promote-students/', {
        academic_year_id: bulkYearId,
        grade_id: bulkGradeId || undefined,
      });
      const result = await pollJob<PromotionResult>(response.data.job_id);
      setPromoteResult(result);
    } catch (err: any) {
      setPromoteError(err.response?.data?.error || err.message || 'Failed to run bulk promotion.');
    } finally {
      setPromoting(false);
    }
  };

  const nameById = Object.fromEntries((readiness?.students ?? []).map((row) => [row.student_id, row.name]));

  const [singleStudent, setSingleStudent] = useState<StudentOption | null>(null);
  const [singleYearId, setSingleYearId] = useState('');
  const [singleReadiness, setSingleReadiness] = useState<ReadinessRow | null>(null);
  const [singleChecking, setSingleChecking] = useState(false);
  const [singlePromoting, setSinglePromoting] = useState(false);
  const [singleResult, setSingleResult] = useState<PromotionOutcome | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);

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

  const [bulkExamMode, setBulkExamMode] = useState(false);
  const [examStudent, setExamStudent] = useState<StudentOption | null>(null);
  const [examStreamId, setExamStreamId] = useState('');
  const [examCode, setExamCode] = useState('KJSEA');
  const [examYearId, setExamYearId] = useState('');
  const [destination, setDestination] = useState('');
  const [recordingExam, setRecordingExam] = useState(false);
  const [examMsg, setExamMsg] = useState<string | null>(null);
  const [examFailed, setExamFailed] = useState(false);

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
        await Promise.all(studentIds.map((id) =>
          api.post(`/api/promotion/national-exam/${id}/`, { exam_code: examCode, academic_year_id: examYearId, destination })
        ));
        setExamMsg(`Recorded ${examCode} for ${studentIds.length} student(s).`);
      } else {
        if (!examStudent) return;
        await api.post(`/api/promotion/national-exam/${examStudent.id}/`, { exam_code: examCode, academic_year_id: examYearId, destination });
        setExamMsg('Exam record saved.');
      }
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
        <CardHeader title="Finalize Term Results" subheader="Marks a term's results as done recording — the gate for plain grade promotions." />
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <TextField label="Exam Term ID" value={termId} onChange={(e) => setTermId(e.target.value)} size="small" />
            <Button variant="contained" disabled={finalizing || !termId} onClick={() => handleFinalize(true)}>
              Finalize
            </Button>
            <Button variant="outlined" disabled={finalizing || !termId} onClick={() => handleFinalize(false)}>
              Un-finalize
            </Button>
            {finalizing && <CircularProgress size={20} />}
          </Stack>
          {finalizeMsg && <Alert sx={{ mt: 2 }} severity={finalizeFailed ? 'error' : 'success'}>{finalizeMsg}</Alert>}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader
          avatar={<GraduationCap size={20} />}
          title="Bulk Promotion"
          subheader="Check who's ready before running anything — held students are simply skipped, never force-promoted."
        />
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
              <TextField select label="Academic Year" value={bulkYearId} onChange={(e) => { setBulkYearId(e.target.value); setReadiness(null); }} size="small" sx={{ minWidth: 160 }}>
                {academicYears.map((y) => <MenuItem key={y.id} value={y.id}>{y.year}</MenuItem>)}
              </TextField>
              <TextField select label="Grade (optional — whole school if blank)" value={bulkGradeId} onChange={(e) => { setBulkGradeId(e.target.value); setReadiness(null); }} size="small" sx={{ minWidth: 220 }}>
                <MenuItem value="">Whole school</MenuItem>
                {grades.map((g) => <MenuItem key={g.id} value={g.id}>{g.grade_name}</MenuItem>)}
              </TextField>
              <Button variant="outlined" disabled={checkingReadiness || !bulkYearId} onClick={handleCheckReadiness}>
                {checkingReadiness ? <CircularProgress size={20} /> : 'Check Readiness'}
              </Button>
            </Stack>

            {readinessError && <Alert severity="error">{readinessError}</Alert>}

            {readiness && (
              <>
                <Stack direction="row" spacing={1}>
                  <Chip color="success" label={`${readiness.summary.ready} ready`} />
                  {Object.entries(readiness.summary.by_reason).map(([reason, count]) => (
                    <Chip key={reason} color="warning" label={`${count} blocked: ${reason}`} />
                  ))}
                </Stack>
                <ReadinessTable rows={readiness.students} />
                <Divider />
                <Box>
                  <Button variant="contained" color="primary" disabled={promoting || readiness.summary.ready === 0} onClick={handlePromote}>
                    {promoting ? <CircularProgress size={20} /> : 'Run Promotion'}
                  </Button>
                </Box>
              </>
            )}

            {promoteError && <Alert severity="error">{promoteError}</Alert>}
            {promoteResult && (
              <>
                <Alert severity="success" icon={<CheckCircle2 size={20} />}>
                  <Typography variant="body2">{promoteResult.message}</Typography>
                </Alert>
                <ReadinessTable rows={promoteResult.outcomes} nameById={nameById} />
              </>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Check / Promote a Single Student" subheader="For one-off corrections outside a bulk run." />
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

      <Card variant="outlined">
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

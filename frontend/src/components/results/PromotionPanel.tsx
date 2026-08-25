import { useEffect, useState } from 'react';
import {
  Box, Card, CardContent, CardHeader, Button, TextField, MenuItem, Alert,
  CircularProgress, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Divider,
} from '@mui/material';
import { GraduationCap, CheckCircle2 } from 'lucide-react';
import api from '../../libs/axiosInstance';
import { pollJob } from '../../libs/pollJob';

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

      {/* TASK 8 SECTIONS GO HERE */}
    </Stack>
  );
}

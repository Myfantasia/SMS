import { useState } from 'react';
import {
  Box, Card, CardContent, CardHeader, Button, TextField, MenuItem, Alert,
  CircularProgress, Stack, Typography,
} from '@mui/material';
import { GraduationCap, CheckCircle2 } from 'lucide-react';
import api from '../../libs/axiosInstance';
import { pollJob } from '../../libs/pollJob';

interface PromotionResult {
  message: string;
  outcomes: { student_id: number; outcome: string; detail: string }[];
}

export default function PromotionPanel() {
  const [termId, setTermId] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeMsg, setFinalizeMsg] = useState<string | null>(null);
  const [finalizeFailed, setFinalizeFailed] = useState(false);

  const [examStudentId, setExamStudentId] = useState('');
  const [examCode, setExamCode] = useState('KJSEA');
  const [academicYearId, setAcademicYearId] = useState('');
  const [destination, setDestination] = useState('');
  const [recordingExam, setRecordingExam] = useState(false);
  const [examMsg, setExamMsg] = useState<string | null>(null);
  const [examFailed, setExamFailed] = useState(false);

  const [promoteYearId, setPromoteYearId] = useState('');
  const [promoteGradeId, setPromoteGradeId] = useState('');
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<PromotionResult | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

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

  const handleRecordExam = async () => {
    if (!examStudentId || !academicYearId) return;
    setRecordingExam(true);
    setExamMsg(null);
    setExamFailed(false);
    try {
      await api.post(`/api/promotion/national-exam/${examStudentId}/`, {
        exam_code: examCode, academic_year_id: academicYearId, destination,
      });
      setExamMsg('Exam record saved.');
    } catch (err: any) {
      setExamMsg(err.response?.data?.error || 'Failed to save exam record.');
      setExamFailed(true);
    } finally {
      setRecordingExam(false);
    }
  };

  const handlePromote = async () => {
    if (!promoteYearId) return;
    setPromoting(true);
    setPromoteError(null);
    setPromoteResult(null);
    try {
      const response = await api.post('/api/promotion/promote-students/', {
        academic_year_id: promoteYearId,
        grade_id: promoteGradeId || undefined,
      });
      const result = await pollJob<PromotionResult>(response.data.job_id);
      setPromoteResult(result);
    } catch (err: any) {
      setPromoteError(err.response?.data?.error || err.message || 'Failed to run bulk promotion.');
    } finally {
      setPromoting(false);
    }
  };

  return (
    <Stack spacing={3}>
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
        <CardHeader title="Record a National Exam" subheader="KPSEA (Grade 6), KJSEA (Grade 9), or KCSE (Form 4 / Grade 12)." />
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
              <TextField label="Student ID" value={examStudentId} onChange={(e) => setExamStudentId(e.target.value)} size="small" />
              <TextField label="Academic Year ID" value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)} size="small" />
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
              <Button variant="contained" disabled={recordingExam || !examStudentId || !academicYearId} onClick={handleRecordExam}>
                Save Exam Record
              </Button>
            </Box>
          </Stack>
          {examMsg && <Alert sx={{ mt: 2 }} severity={examFailed ? 'error' : 'success'}>{examMsg}</Alert>}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader
          avatar={<GraduationCap size={20} />}
          title="Promote Students"
          subheader="Runs against every eligible student in scope — held students (results not finalized / exam not recorded) are simply skipped."
        />
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <TextField label="Academic Year ID" value={promoteYearId} onChange={(e) => setPromoteYearId(e.target.value)} size="small" />
            <TextField label="Grade ID (optional — whole school if blank)" value={promoteGradeId} onChange={(e) => setPromoteGradeId(e.target.value)} size="small" />
            <Button variant="contained" color="primary" disabled={promoting || !promoteYearId} onClick={handlePromote}>
              {promoting ? <CircularProgress size={20} /> : 'Run Promotion'}
            </Button>
          </Stack>
          {promoteError && <Alert sx={{ mt: 2 }} severity="error">{promoteError}</Alert>}
          {promoteResult && (
            <Alert sx={{ mt: 2 }} severity="success" icon={<CheckCircle2 size={20} />}>
              <Typography variant="body2">{promoteResult.message}</Typography>
            </Alert>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}

// frontend/src/components/subjectAllocations/RebalanceModal.tsx
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Alert, AlertTitle, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { isAxiosError } from 'axios';
import { ArrowRight } from 'lucide-react';
import api from '../../libs/axiosInstance';

type Scope = 'class' | 'grade' | 'all';

interface Blocker {
  code: string;
  severity: 'HARD' | 'SOFT';
  message: string;
  teacher_id: number | null;
  subject_id: number | null;
  classroom_id: number | null;
  rule_ref: string;
  suggested_fix: string;
}

interface Move {
  classroom_id: number;
  subject_id: number;
  from_teacher_id: number | null;
  to_teacher_id: number;
  reason: string;
  resolves_blocker_code: string;
}

interface Proposal {
  class_ids: number[];
  fingerprint: string;
  blockers_before: Blocker[];
  moves: Move[];
  unresolved_blockers: Blocker[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  termId: string;
  yearId: string;
  classId: string;
  gradeId: string;
  gradeName: string;
  classDisplayName: string;
  onConfirmed: () => void;
}

interface ApiErrorBody {
  error?: string;
  code?: string;
}

const errorBody = (e: unknown): ApiErrorBody => (isAxiosError(e) ? (e.response?.data ?? {}) : {});

interface LoadResult {
  key: string;
  proposal: Proposal | null;
  error: string | null;
}

export default function RebalanceModal({
  open, onClose, termId, yearId, classId, gradeId, gradeName, classDisplayName, onConfirmed,
}: Props) {
  const [scope, setScope] = useState<Scope>('class');
  const [reloadTick, setReloadTick] = useState(0);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [staleNotice, setStaleNotice] = useState(false);

  // Every input that changes the proposal (plus a manual reload tick) forms one key. The proposal
  // on screen is only trusted while its key matches, so a late response for an old scope is ignored.
  const key = `${termId}|${yearId}|${classId}|${gradeId}|${scope}|${reloadTick}`;
  const current = result?.key === key ? result : null;
  const proposal = current?.proposal ?? null;
  const error = current?.error ?? null;
  const loading = open && current === null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .post('/api/allocations/rebalance/propose/', {
        term_id: termId, year_id: yearId, class_id: classId, grade_id: gradeId, scope,
      })
      .then((res) => {
        if (!cancelled) setResult({ key, proposal: res.data as Proposal, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setResult({ key, proposal: null, error: errorBody(e).error || 'Could not compute a rebalance proposal.' });
        }
      });
    return () => { cancelled = true; };
  }, [open, key, termId, yearId, classId, gradeId, scope]);

  const handleClose = () => {
    setResult(null);
    setStaleNotice(false);
    onClose();
  };

  const handleConfirm = async () => {
    if (!proposal) return;
    setConfirming(true);
    try {
      const res = await api.post('/api/allocations/rebalance/confirm/', {
        term_id: termId, year_id: yearId, class_id: classId, grade_id: gradeId, scope,
        proposal_fingerprint: proposal.fingerprint,
      });
      toast.success(res.data.message || 'Rebalance applied.');
      onConfirmed();
      handleClose();
    } catch (e: unknown) {
      const data = errorBody(e);
      if (data.code === 'STALE_PROPOSAL') {
        setStaleNotice(true);
        setReloadTick((t) => t + 1);
      } else {
        toast.error(data.error || 'Rebalance confirm failed.');
      }
    } finally {
      setConfirming(false);
    }
  };

  const renderBlocker = (b: Blocker, index: number) => (
    <Alert key={`${b.code}-${index}`} severity={b.severity === 'HARD' ? 'error' : 'warning'} sx={{ mb: 1 }}>
      <AlertTitle sx={{ fontSize: 13 }}>{b.message}</AlertTitle>
      {b.suggested_fix && <Typography variant="caption">{b.suggested_fix}</Typography>}
    </Alert>
  );

  return (
    <Dialog open={open} onClose={confirming ? undefined : handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Rebalance allocations</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Finds current problems and proposes teacher swaps to fix them. Nothing is saved until you apply.
          </Typography>

          <TextField
            select size="small" label="Scope" value={scope}
            onChange={(e) => { setStaleNotice(false); setScope(e.target.value as Scope); }}
            disabled={loading || confirming}
          >
            <MenuItem value="class">{classDisplayName || 'This class'} only</MenuItem>
            {gradeId && <MenuItem value="grade">Every class in {gradeName || 'this grade'}</MenuItem>}
            <MenuItem value="all">Every class in the school</MenuItem>
          </TextField>

          {staleNotice && (
            <Alert severity="info">This draft changed since the proposal was made. Review it again before applying.</Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={28} /></Box>
          )}

          {!loading && proposal && (
            <>
              {proposal.blockers_before.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Current problems</Typography>
                  {proposal.blockers_before.map(renderBlocker)}
                </Box>
              )}

              {proposal.moves.length === 0 && proposal.unresolved_blockers.length === 0 && (
                <Alert severity="success">No problems found — nothing to rebalance.</Alert>
              )}

              {proposal.moves.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Proposed moves</Typography>
                  {proposal.moves.map((m, i) => (
                    <Alert key={`${m.classroom_id}-${m.subject_id}-${i}`} severity="info" icon={<ArrowRight size={18} />} sx={{ mb: 1 }}>
                      {m.reason}
                    </Alert>
                  ))}
                </Box>
              )}

              {proposal.unresolved_blockers.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Couldn't be fixed automatically</Typography>
                  {proposal.unresolved_blockers.map(renderBlocker)}
                </Box>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={confirming}>Cancel</Button>
        <Button
          variant="contained" onClick={handleConfirm}
          disabled={!proposal || loading || confirming || proposal.moves.length === 0}
        >
          {confirming ? 'Applying…' : `Apply ${proposal?.moves.length ?? 0} move(s)`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

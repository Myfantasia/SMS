// frontend/src/components/timetable/TimetablePublishModal.tsx
//
// Review & Publish for a timetable — mirrors the pattern in
// frontend/src/components/subjectAllocations/PublishReviewModal.tsx, adapted for the timetable's
// richer verification report (apps/timetable/verify.py: conflicts, completeness, pedagogy rules).
//
// Uses framer-motion (AnimatePresence/motion.div) for the blocker-list transitions, per the plan
// brief and the "improve UI/UX = add real animation" convention.
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Alert, AlertTitle, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, Stack, Typography,
} from '@mui/material';
import { isAxiosError } from 'axios';
import api from '../../libs/axiosInstance';

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

interface Preview {
  timetable_id: number;
  fingerprint: string;
  blockers: Blocker[];
  can_publish: boolean;
  requires_acknowledgement: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  timetableId: number;
  timetableName: string;
  onPublished: () => void;
}

interface ApiErrorBody {
  error?: string;
  code?: string;
}

const errorBody = (e: unknown): ApiErrorBody => (isAxiosError(e) ? (e.response?.data ?? {}) : {});

interface LoadResult {
  key: string;
  preview: Preview | null;
  error: string | null;
}

export default function TimetablePublishModal({ open, onClose, timetableId, timetableName, onPublished }: Props) {
  const [reloadTick, setReloadTick] = useState(0);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);

  // Every input that changes what is reviewed (plus a manual reload tick, bumped after a stale
  // publish) forms one key. The preview on screen is only trusted while its key matches —
  // anything else counts as "loading". Same pattern as PublishReviewModal.tsx.
  const key = `${timetableId}|${reloadTick}`;
  const current = result?.key === key ? result : null;
  const preview = current?.preview ?? null;
  const error = current?.error ?? null;
  const loading = open && current === null;
  const acknowledged = acknowledgedKey === key;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .post('/api/timetable/publish/preview/', { timetable_id: timetableId })
      .then((res) => {
        if (!cancelled) setResult({ key, preview: res.data as Preview, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setResult({ key, preview: null, error: errorBody(e).error || 'Could not review this timetable.' });
        }
      });
    return () => { cancelled = true; };
  }, [open, key, timetableId]);

  const handleClose = () => {
    setResult(null);
    setStaleNotice(false);
    setAcknowledgedKey(null);
    onClose();
  };

  const handlePublish = async () => {
    if (!preview) return;
    setPublishing(true);
    try {
      const res = await api.post('/api/timetable/publish/', {
        timetable_id: timetableId,
        review_fingerprint: preview.fingerprint,
        acknowledge_soft: acknowledged,
      });
      toast.success(res.data.message || 'Published.');
      onPublished();
      handleClose();
    } catch (e: unknown) {
      const data = errorBody(e);
      if (data.code === 'STALE_REVIEW') {
        setStaleNotice(true);
        setReloadTick((t) => t + 1);
      } else {
        toast.error(data.error || 'Publish failed.');
      }
    } finally {
      setPublishing(false);
    }
  };

  const hard = preview?.blockers.filter((b) => b.severity === 'HARD') ?? [];
  const soft = preview?.blockers.filter((b) => b.severity === 'SOFT') ?? [];
  const canPublish = !!preview && !loading && !publishing && preview.can_publish &&
    (!preview.requires_acknowledgement || acknowledged);

  const renderBlocker = (b: Blocker, index: number) => (
    <motion.div
      key={`${b.code}-${index}`}
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18, delay: index * 0.03 }}
    >
      <Alert severity={b.severity === 'HARD' ? 'error' : 'warning'} sx={{ mb: 1 }}>
        <AlertTitle sx={{ fontSize: 13 }}>{b.message}</AlertTitle>
        {b.suggested_fix && <Typography variant="caption">{b.suggested_fix}</Typography>}
      </Alert>
    </motion.div>
  );

  return (
    <Dialog open={open} onClose={publishing ? undefined : handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Review &amp; publish "{timetableName}"</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {staleNotice && (
            <Alert severity="info">This timetable changed after you reviewed it. Review it again before publishing.</Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={28} /></Box>
          )}

          {!loading && preview && (
            <>
              {hard.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Must be fixed before publishing</Typography>
                  <AnimatePresence initial={false}>
                    {hard.map(renderBlocker)}
                  </AnimatePresence>
                </Box>
              )}
              {soft.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Warnings</Typography>
                  <AnimatePresence initial={false}>
                    {soft.map(renderBlocker)}
                  </AnimatePresence>
                  <FormControlLabel
                    control={<Checkbox checked={acknowledged} onChange={(e) => setAcknowledgedKey(e.target.checked ? key : null)} />}
                    label="I have read these warnings and want to publish anyway"
                  />
                </Box>
              )}
              {hard.length === 0 && soft.length === 0 && (
                <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}>
                  <Alert severity="success">No problems found.</Alert>
                </motion.div>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={publishing}>Cancel</Button>
        <Button variant="contained" onClick={handlePublish} disabled={!canPublish}>
          {publishing ? 'Publishing…' : 'Publish'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// frontend/src/components/subjectAllocations/PublishReviewModal.tsx
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Alert, AlertTitle, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { isAxiosError } from 'axios';
import api from '../../libs/axiosInstance';

type Scope = 'class' | 'grade' | 'all';

interface Blocker {
  code: string;
  severity: 'HARD' | 'SOFT';
  message: string;
  rule_ref: string;
  suggested_fix: string;
}

interface SyncSummary {
  target_timetable_name: string | null;
  target_is_live: boolean;
  synced: boolean;
  ejected_count: number;
  swapped_count: number;
  locked_skipped_count: number;
  regenerated_subject_count: number;
}

interface Preview {
  class_ids: number[];
  fingerprint: string;
  blockers: Blocker[];
  can_publish: boolean;
  requires_acknowledgement: boolean;
  sync: SyncSummary;
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

export default function PublishReviewModal({
  open, onClose, termId, yearId, classId, gradeId, gradeName, classDisplayName, onPublished,
}: Props) {
  const [scope, setScope] = useState<Scope>('class');
  const [reloadTick, setReloadTick] = useState(0);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);

  // Every input that changes what is reviewed (plus a manual reload tick) forms one key. The
  // preview on screen is only trusted while its key matches — anything else counts as "loading".
  const key = `${termId}|${yearId}|${classId}|${gradeId}|${scope}|${reloadTick}`;
  const current = result?.key === key ? result : null;
  const preview = current?.preview ?? null;
  const error = current?.error ?? null;
  const loading = open && current === null;
  const acknowledged = acknowledgedKey === key;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .post('/api/allocations/publish/preview/', {
        term_id: termId, year_id: yearId, class_id: classId, grade_id: gradeId, scope,
      })
      .then((res) => {
        if (!cancelled) setResult({ key, preview: res.data as Preview, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setResult({ key, preview: null, error: errorBody(e).error || 'Could not review this draft.' });
        }
      });
    return () => { cancelled = true; };
  }, [open, key, termId, yearId, classId, gradeId, scope]);

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
      const res = await api.post('/api/allocations/publish/', {
        term_id: termId, year_id: yearId, class_id: classId, grade_id: gradeId, scope,
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
  const canPublish =
    !!preview && !loading && !publishing && preview.can_publish &&
    (!preview.requires_acknowledgement || acknowledged);

  const renderBlocker = (b: Blocker, index: number) => (
    <Alert key={`${b.code}-${index}`} severity={b.severity === 'HARD' ? 'error' : 'warning'} sx={{ mb: 1 }}>
      <AlertTitle sx={{ fontSize: 13 }}>{b.message}</AlertTitle>
      {b.suggested_fix && <Typography variant="caption">{b.suggested_fix}</Typography>}
    </Alert>
  );

  return (
    <Dialog open={open} onClose={publishing ? undefined : handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Review &amp; publish allocations</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            select size="small" label="What to publish" value={scope}
            onChange={(e) => { setStaleNotice(false); setScope(e.target.value as Scope); }}
            disabled={loading || publishing}
          >
            <MenuItem value="class">{classDisplayName || 'This class'} only</MenuItem>
            {gradeId && <MenuItem value="grade">Every drafted class in {gradeName || 'this grade'}</MenuItem>}
            <MenuItem value="all">Every drafted class in the school</MenuItem>
          </TextField>

          {staleNotice && (
            <Alert severity="info">This draft changed after you reviewed it. Review it again before publishing.</Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={28} /></Box>
          )}

          {!loading && preview && (
            <>
              <Typography variant="body2" color="text.secondary">
                Reviewing {preview.class_ids.length} class{preview.class_ids.length === 1 ? '' : 'es'}.
              </Typography>

              {hard.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Must be fixed before publishing</Typography>
                  {hard.map(renderBlocker)}
                </Box>
              )}
              {soft.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Warnings</Typography>
                  {soft.map(renderBlocker)}
                  <FormControlLabel
                    control={<Checkbox checked={acknowledged} onChange={(e) => setAcknowledgedKey(e.target.checked ? key : null)} />}
                    label="I have read these warnings and want to publish anyway"
                  />
                </Box>
              )}
              {hard.length === 0 && soft.length === 0 && (
                <Alert severity="success">No problems found.</Alert>
              )}

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>What this will do to the timetable</Typography>
                {preview.sync.synced ? (
                  <Typography variant="body2">
                    Updates the draft timetable "{preview.sync.target_timetable_name}": {preview.sync.swapped_count} lesson(s)
                    move to their new teacher, {preview.sync.ejected_count} removed,{' '}
                    {preview.sync.regenerated_subject_count} subject(s) rescheduled
                    {preview.sync.locked_skipped_count > 0 && `, ${preview.sync.locked_skipped_count} locked lesson(s) left as they are`}.
                    Nothing is visible to students or teachers until the timetable itself is published.
                  </Typography>
                ) : preview.sync.target_is_live ? (
                  <Typography variant="body2">
                    The active timetable is live, so it will not be changed. Publishing only locks these allocations;
                    generate a draft timetable afterwards to apply them.
                  </Typography>
                ) : (
                  <Typography variant="body2">
                    There is no active draft timetable to update. Publishing only locks these allocations.
                  </Typography>
                )}
              </Box>
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

import { useEffect, useState } from 'react';
import {
  Card, CardContent, Button, TextField, Select, MenuItem, Table, TableHead,
  TableRow, TableCell, TableBody, Chip, CircularProgress, Alert,
} from '@mui/material';
import toast from 'react-hot-toast';
import { Layers, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  listFeeStructures, createFeeStructure, activateFeeStructure,
  listGradeLevelOptions, listExamTermOptions,
} from '../../libs/financeApi';
import type { FeeStructure, GradeLevelOption, ExamTermOption } from '../../libs/financeApi';

export default function FeeStructuresPage() {
  const navigate = useNavigate();

  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [grades, setGrades] = useState<GradeLevelOption[]>([]);
  const [terms, setTerms] = useState<ExamTermOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [structuresError, setStructuresError] = useState(false);
  const [gradesError, setGradesError] = useState(false);
  const [termsError, setTermsError] = useState(false);
  const [name, setName] = useState('');
  const [gradeId, setGradeId] = useState<number | ''>('');
  const [termId, setTermId] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);
  const [activatingId, setActivatingId] = useState<number | null>(null);

  const loadStructures = () => {
    listFeeStructures()
      .then((res) => {
        setStructures(res.data);
        setStructuresError(false);
      })
      .catch(() => {
        setStructuresError(true);
        toast.error('Failed to load fee structures.');
      });
  };

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      listFeeStructures(),
      listGradeLevelOptions(),
      listExamTermOptions(),
    ])
      .then(([structuresResult, gradesResult, termsResult]) => {
        if (structuresResult.status === 'fulfilled') {
          setStructures(structuresResult.value.data);
        } else {
          setStructuresError(true);
          toast.error('Failed to load fee structures.');
        }

        if (gradesResult.status === 'fulfilled') {
          setGrades(gradesResult.value.data);
        } else {
          setGradesError(true);
          toast.error("Couldn't load grades — try refreshing the page.");
        }

        if (termsResult.status === 'fulfilled') {
          setTerms(termsResult.value.data);
        } else {
          setTermsError(true);
          toast.error("Couldn't load exam terms — try refreshing the page.");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const noGrades = !gradesError && grades.length === 0;
  const noTerms = !termsError && terms.length === 0;

  const handleCreate = async () => {
    if (!name || !gradeId || !termId) {
      toast.error('Name, grade, and term are all required.');
      return;
    }
    setCreating(true);
    try {
      await createFeeStructure({ name, grade_level: gradeId, term: termId });
      toast.success('Fee structure created.');
      setName('');
      setGradeId('');
      setTermId('');
      loadStructures();
    } catch (err: any) {
      const serverMessage = err?.response?.data?.error ?? err?.response?.data?.detail;
      toast.error(serverMessage ?? 'Failed to create fee structure — it may already exist for this grade/term.');
    } finally {
      setCreating(false);
    }
  };

  const handleActivate = async (structureId: number) => {
    setActivatingId(structureId);
    try {
      await activateFeeStructure(structureId);
      toast.success('Activated — invoices are being generated in the background.');
      loadStructures();
    } catch (err: any) {
      const responseStatus = err?.response?.status;
      if (responseStatus === 503) {
        // Real, expected dev scenario: no Celery worker consuming the bulk_ops queue
        // (see school/jobs.py dispatch_background_job). Distinct from a genuine failure.
        toast.error('No background worker is running — invoices could not be queued. Contact IT.');
      } else if (responseStatus === 400 || responseStatus === 404) {
        toast.error(err?.response?.data?.error ?? 'Could not activate this fee structure.');
      } else {
        toast.error('Failed to activate fee structure. Please try again.');
      }
    } finally {
      setActivatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-16 flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
        <CircularProgress size={32} />
        <span className="text-sm">Loading fee structures...</span>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors w-max"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10">
          <Layers className="w-6 h-6" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-slate-100">Fee Structures</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Define a fee structure per grade and term, then activate it to generate student invoices.
          </p>
        </div>
      </div>

      {(gradesError || termsError) && (
        <Alert severity="error">
          {gradesError && termsError
            ? "Couldn't load grades or exam terms — try refreshing the page."
            : gradesError
              ? "Couldn't load grades — try refreshing the page."
              : "Couldn't load exam terms — try refreshing the page."}
        </Alert>
      )}

      {(noGrades || noTerms) && (
        <Alert severity="warning">
          {noGrades && noTerms
            ? 'No grades or terms are configured yet — set them up in Academics before creating a fee structure.'
            : noGrades
              ? 'No grades are configured yet — set them up in Academics before creating a fee structure.'
              : 'No exam terms are configured yet — set them up in Academics before creating a fee structure.'}
        </Alert>
      )}

      <Card className="dark:bg-slate-900" sx={{ bgcolor: 'background.paper' }}>
        <CardContent className="flex flex-wrap gap-3 items-center">
          <TextField
            label="Structure name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="small"
          />
          <Select<number | ''>
            value={gradeId}
            onChange={(e) => setGradeId(e.target.value === '' ? '' : Number(e.target.value))}
            displayEmpty
            size="small"
            disabled={noGrades || gradesError}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">{gradesError ? 'Failed to load grades' : noGrades ? 'No grades available' : 'Select grade'}</MenuItem>
            {grades.map((g) => <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>)}
          </Select>
          <Select<number | ''>
            value={termId}
            onChange={(e) => setTermId(e.target.value === '' ? '' : Number(e.target.value))}
            displayEmpty
            size="small"
            disabled={noTerms || termsError}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">{termsError ? 'Failed to load terms' : noTerms ? 'No terms available' : 'Select term'}</MenuItem>
            {terms.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
          </Select>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={creating || noGrades || noTerms || gradesError || termsError}
          >
            {creating ? 'Creating...' : 'Create Structure'}
          </Button>
        </CardContent>
      </Card>

      <Card className="dark:bg-slate-900" sx={{ bgcolor: 'background.paper' }}>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {structuresError ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <p className="py-8 text-center text-sm text-red-500 dark:text-red-400">
                      Couldn't load fee structures — try refreshing the page.
                    </p>
                  </TableCell>
                </TableRow>
              ) : structures.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                      No fee structures yet — create one above to get started.
                    </p>
                  </TableCell>
                </TableRow>
              ) : structures.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.name}</TableCell>
                  <TableCell>
                    <Chip label={s.status} color={s.status === 'active' ? 'success' : 'default'} size="small" />
                  </TableCell>
                  <TableCell>
                    {s.status === 'draft' && (
                      <Button size="small" disabled={activatingId === s.id} onClick={() => handleActivate(s.id)}>
                        {activatingId === s.id ? 'Activating...' : 'Activate & Generate Invoices'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

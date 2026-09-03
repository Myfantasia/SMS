import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
    ArrowLeft, ShieldAlert, CheckCircle2, Lock, Unlock, Clock, XCircle,
    Trash2, Plus, AlertCircle, Settings, UserCheck, GitBranch, Sparkles, ChevronRight,
} from 'lucide-react';
import {
    Card, CardContent, Tabs, Tab, Chip, Button, IconButton, Select, MenuItem,
    CircularProgress, Alert,
    Tooltip,
} from '@mui/material';
import api from '../../libs/axiosInstance';
import SearchableSelect from '../common/SearchableSelect';

// Tailwind-equivalent tint hexes used directly in sx — MUI's default palette only defines
// main/light/dark/contrastText per color (no numeric 50/100 shades unless the theme adds
// them), so `bgcolor: 'primary.50'` or `'slate.100'` silently resolve to nothing. These are
// explicit so the light "tinted chip" look actually renders.
const TINT = {
    blue50: '#EFF6FF', blue100: '#DBEAFE', blue600: '#2563EB', blue700: '#1D4ED8',
    emerald50: '#ECFDF5', emerald100: '#D1FAE5', emerald600: '#059669', emerald700: '#047857',
    slate50: '#F8FAFC', slate100: '#F1F5F9', slate200: '#E2E8F0', slate400: '#94A3B8', slate600: '#475569',
};

const DEPT_ACCENTS = [
    { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8', chip: '#DBEAFE' }, // blue
    { bg: '#FDF4FF', border: '#F0ABFC', text: '#A21CAF', chip: '#FAE8FF' }, // fuchsia
    { bg: '#FFF7ED', border: '#FDBA74', text: '#C2410C', chip: '#FFEDD5' }, // orange
    { bg: '#ECFDF5', border: '#6EE7B7', text: '#047857', chip: '#D1FAE5' }, // emerald
    { bg: '#EEF2FF', border: '#A5B4FC', text: '#4338CA', chip: '#E0E7FF' }, // indigo
    { bg: '#FEF2F2', border: '#FCA5A5', text: '#B91C1C', chip: '#FEE2E2' }, // red
    { bg: '#F0FDFA', border: '#5EEAD4', text: '#0F766E', chip: '#CCFBF1' }, // teal
];

function deptAccent(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return DEPT_ACCENTS[hash % DEPT_ACCENTS.length];
}

// --- INTERFACES ---
interface Subject {
    id: number;
    code: string;
    name: string;
    is_core: boolean;
}

interface DepartmentGroup {
    department_id: number | null;
    department_name: string;
    subjects: Subject[];
}

interface Department {
    id: number;
    name: string;
    is_active: boolean;
}

interface CategoryLimit {
    id: number;
    department_id: number | null;
    department_name: string | null;
    max_subjects: number;
}

interface ExclusionRule {
    id: number;
    subject_a_id: number;
    subject_a_name: string;
    subject_b_id: number;
    subject_b_name: string;
}

interface EnrolledSubject {
    enrollment_id: number;
    subject_id: number;
    subject_name: string;
    department_name: string | null;
    is_core: boolean;
    status: 'Pending' | 'Approved' | 'Rejected';
}

interface ComboSubject {
    id: number;
    name: string;
    code: string;
}

interface ComboOption {
    id: number;
    name: string;
    code: string;
    subjects: ComboSubject[];
}

interface TrackOption {
    id: number;
    name: string;
    description: string;
    preset_combinations: ComboOption[];
}

interface PathwayOption {
    id: number;
    name: string;
    description: string;
    tracks: TrackOption[];
}

interface PathwaySelection {
    selection_id: number;
    pathway_id: number;
    pathway_name: string;
    track_id: number | null;
    track_name: string | null;
    preset_combination_id: number | null;
    preset_combination_name: string | null;
    status: 'Pending' | 'Approved' | 'Rejected';
}

const AssignSubjectsPage: React.FC = () => {
    const { gradeId, studentId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const studentName = location.state?.studentName || 'Student';
    const academicYearId = location.state?.academicYearId || '';

    // --- UI STATE ---
    const [activeMainTab, setActiveMainTab] = useState<'assign' | 'policies'>('assign');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [unlocking, setUnlocking] = useState(false);

    // --- DATA STATE ---
    const [catalog, setCatalog] = useState<DepartmentGroup[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);

    // Compulsory-tier student profile (locked/unlocked state for the whole catalog)
    const [enrolledSubjects, setEnrolledSubjects] = useState<EnrolledSubject[]>([]);
    const [isLocked, setIsLocked] = useState(false);
    const [canUnlock, setCanUnlock] = useState(false);
    const [requiresPathwayChoice, setRequiresPathwayChoice] = useState(false);

    // Senior Secondary pathway picker
    const [pathways, setPathways] = useState<PathwayOption[]>([]);
    const [pathwaySelection, setPathwaySelection] = useState<PathwaySelection | null>(null);
    const [pathwayChoice, setPathwayChoice] = useState<number | ''>('');
    const [trackChoice, setTrackChoice] = useState<number | ''>('');
    const [comboChoice, setComboChoice] = useState<number | ''>('');

    // Policies State
    const [categoryLimits, setCategoryLimits] = useState<CategoryLimit[]>([]);
    const [exclusionRules, setExclusionRules] = useState<ExclusionRule[]>([]);

    // Policy Builder Form State
    const [newLimitDept, setNewLimitDept] = useState<number | ''>('');
    const [newLimitMax, setNewLimitMax] = useState(1);
    const [newExclusionA, setNewExclusionA] = useState('');
    const [newExclusionB, setNewExclusionB] = useState('');

    // --- FETCH DATA ---
    const fetchData = useCallback(async () => {
        if (!gradeId) return;
        setLoading(true);
        try {
            const [catRes, limitsRes, exclRes] = await Promise.all([
                api.get(`/api/subjects/catalog/${gradeId}/`),
                api.get(`/api/subjects/category-limits/${gradeId}/`),
                api.get(`/api/subjects/exclusion-rules/${gradeId}/`),
            ]);

            const catData = catRes.data;
            const limitsData = limitsRes.data;
            const exclData = exclRes.data;

            // Departments are curriculum-scoped (CBC and 8-4-4 group subjects differently) — this
            // grade's own curriculum, known only once the catalog responds, decides which
            // departments the category-limit picker should offer.
            const curriculumId = catData.status === 'success' ? catData.data.curriculum_id : null;
            const deptRes = await api.get(`/api/departments/`, curriculumId ? { params: { curriculum_id: curriculumId } } : {});
            const deptData = deptRes.data;

            if (catData.status === 'success') {
                setCatalog(catData.data.catalog);
            }
            if (limitsData.status === 'success') setCategoryLimits(limitsData.data);
            if (exclData.status === 'success') setExclusionRules(exclData.data);
            if (deptData.status === 'success') setDepartments(deptData.data);

            if (studentId) {
                const [profRes, pathRes] = await Promise.all([
                    api.get(`/api/subjects/student-profile/${studentId}/`),
                    api.get(`/api/subjects/pathway-options/${studentId}/`),
                ]);
                const profData = profRes.data;
                const pathData = pathRes.data;

                if (profData.status === 'success') {
                    setEnrolledSubjects(profData.data.subjects);
                    setIsLocked(profData.data.is_locked);
                    setCanUnlock(profData.data.can_unlock);
                    setRequiresPathwayChoice(profData.data.requires_pathway_choice);
                }
                if (pathData.status === 'success') {
                    setPathways(pathData.data.pathways);
                    setPathwaySelection(pathData.data.selection);
                    setCanUnlock(pathData.data.can_unlock);
                    setRequiresPathwayChoice(pathData.data.requires_pathway_choice);
                    if (pathData.data.selection) {
                        setPathwayChoice(pathData.data.selection.pathway_id);
                        setTrackChoice(pathData.data.selection.track_id ?? '');
                        setComboChoice(pathData.data.selection.preset_combination_id ?? '');
                    } else {
                        setPathwayChoice('');
                        setTrackChoice('');
                        setComboChoice('');
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            toast.error('Failed to load subject assignment data.');
        } finally {
            setLoading(false);
        }
    }, [gradeId, studentId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Flat list of subjects for dropdowns
    const flatSubjects = useMemo(() => catalog.flatMap((g) => g.subjects), [catalog]);
    const allCatalogIds = useMemo(() => flatSubjects.map((s) => s.id), [flatSubjects]);

    const selectedPathway = useMemo(() => pathways.find((p) => p.id === pathwayChoice) || null, [pathways, pathwayChoice]);
    const selectedTrack = useMemo(() => selectedPathway?.tracks.find((t) => t.id === trackChoice) || null, [selectedPathway, trackChoice]);
    const selectedCombo = useMemo(() => selectedTrack?.preset_combinations.find((c) => c.id === comboChoice) || null, [selectedTrack, comboChoice]);

    // --- COMPULSORY-TIER HANDLERS ---
    const handleSaveAndLockCompulsory = async () => {
        if (!studentId) return;
        setSaving(true);
        try {
            const res = await api.post(`/api/subjects/manage-enrollment/${studentId}/`, {
                subject_ids: allCatalogIds,
                year_id: academicYearId,
            });
            if (res.data.status === 'success') {
                toast.success('Subjects saved and locked.');
                fetchData();
            } else {
                toast.error(res.data.message || 'Failed to save subjects.');
            }
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to save subjects.');
        } finally {
            setSaving(false);
        }
    };

    const handleUnlockSubjects = async () => {
        if (!studentId) return;
        setUnlocking(true);
        try {
            const res = await api.post(`/api/subjects/manage-enrollment/${studentId}/unlock/`);
            if (res.data.status === 'success') {
                toast.success('Subjects unlocked — they can now be re-saved.');
                fetchData();
            } else {
                toast.error(res.data.message || 'Failed to unlock subjects.');
            }
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to unlock subjects.');
        } finally {
            setUnlocking(false);
        }
    };

    // --- SENIOR SECONDARY PATHWAY HANDLERS ---
    const handleAssignPathway = async () => {
        if (!studentId || !pathwayChoice) return;
        setSaving(true);
        try {
            const res = await api.post(`/api/subjects/pathway-options/${studentId}/assign/`, {
                pathway_id: pathwayChoice,
                ...(trackChoice ? { track_id: trackChoice } : {}),
                ...(comboChoice ? { preset_combination_id: comboChoice } : {}),
            });
            if (res.data.status === 'success') {
                toast.success(res.data.message);
                fetchData();
            } else {
                toast.error(res.data.message || 'Failed to assign pathway.');
            }
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to assign pathway.');
        } finally {
            setSaving(false);
        }
    };

    const handleUnlockPathway = async () => {
        if (!studentId) return;
        setUnlocking(true);
        try {
            const res = await api.post(`/api/subjects/pathway-options/${studentId}/unlock/`);
            if (res.data.status === 'success') {
                toast.success('Pathway unlocked — it can now be reassigned.');
                fetchData();
            } else {
                toast.error(res.data.message || 'Failed to unlock pathway.');
            }
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to unlock pathway.');
        } finally {
            setUnlocking(false);
        }
    };

    // --- POLICY BUILDER HANDLERS ---
    const handleAddCategoryLimit = async () => {
        if (!newLimitDept) return;
        try {
            await api.post(`/api/subjects/category-limits/${gradeId}/`, {
                department_id: newLimitDept,
                max_subjects: newLimitMax,
            });
            setNewLimitDept('');
            fetchData();
        } catch (error) {
            console.error(error);
            toast.error('Failed to add category limit.');
        }
    };

    const handleDeleteCategoryLimit = async (id: number) => {
        try {
            await api.delete(`/api/subjects/category-limits/${gradeId}/`, {
                data: { limit_id: id },
            });
            fetchData();
        } catch (error) {
            console.error(error);
            toast.error('Failed to delete category limit.');
        }
    };

    const handleAddExclusion = async () => {
        if (!newExclusionA || !newExclusionB) return;
        try {
            const res = await api.post(`/api/subjects/exclusion-rules/${gradeId}/`, {
                subject_a_id: newExclusionA,
                subject_b_id: newExclusionB,
            });
            if (res.data.status === 'error') toast.error(res.data.message);
            fetchData();
        } catch (error) {
            console.error(error);
            toast.error('Failed to add exclusion rule.');
        }
    };

    const handleDeleteExclusion = async (id: number) => {
        try {
            await api.delete(`/api/subjects/exclusion-rules/${gradeId}/`, {
                data: { rule_id: id },
            });
            fetchData();
        } catch (error) {
            console.error(error);
            toast.error('Failed to delete exclusion rule.');
        }
    };

    if (loading) {
        return (
            <div className="p-16 flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
                <CircularProgress size={32} />
                <span className="text-sm">Loading subject configuration...</span>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto p-6 space-y-6 animate-in fade-in duration-300">

            <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors w-max">
                <ArrowLeft className="w-4 h-4" /> Back to Class
            </button>

            <Card sx={{ borderRadius: 4, overflow: 'hidden', boxShadow: 3 }}>

                {/* PAGE HEADER */}
                <div className="bg-slate-800 p-6 flex justify-between items-center text-white">
                    <div>
                        <h2 className="text-xl font-bold">{studentId ? `Assign Subjects: ${studentName}` : 'Subject Policies'}</h2>
                        <p className="text-slate-400 text-sm mt-1">
                            {requiresPathwayChoice
                                ? 'Assign a Senior Secondary pathway and lock its subject combination.'
                                : 'These subjects are compulsory for this grade — save and lock them for the student.'}
                        </p>
                    </div>
                </div>

                {/* MAIN TABS */}
                <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6">
                    <Tabs value={activeMainTab} onChange={(_, v) => setActiveMainTab(v)}>
                        {studentId && (
                            <Tab
                                value="assign"
                                label="Student Assignment"
                                icon={<UserCheck className="w-4 h-4" />}
                                iconPosition="start"
                                sx={{ textTransform: 'none', fontWeight: 700, minHeight: 56 }}
                            />
                        )}
                        {requiresPathwayChoice && (
                            <Tab
                                value="policies"
                                label="Grade Subject Policies"
                                icon={<Settings className="w-4 h-4" />}
                                iconPosition="start"
                                sx={{ textTransform: 'none', fontWeight: 700, minHeight: 56 }}
                            />
                        )}
                    </Tabs>
                </div>

                {/* PAGE BODY */}
                <CardContent sx={{ p: 3, bgcolor: '#fff' }}>
                    {/* --- TAB 1: STUDENT ASSIGNMENT --- */}
                    {activeMainTab === 'assign' && studentId && (
                        requiresPathwayChoice ? (
                            <SeniorSecondaryPathwayPanel
                                pathways={pathways}
                                pathwaySelection={pathwaySelection}
                                pathwayChoice={pathwayChoice}
                                trackChoice={trackChoice}
                                comboChoice={comboChoice}
                                selectedPathway={selectedPathway}
                                selectedTrack={selectedTrack}
                                selectedCombo={selectedCombo}
                                coreSubjects={flatSubjects.filter((s) => s.is_core)}
                                canUnlock={canUnlock}
                                saving={saving}
                                unlocking={unlocking}
                                onPathwayChange={(id) => { setPathwayChoice(id); setTrackChoice(''); setComboChoice(''); }}
                                onTrackChange={(id) => { setTrackChoice(id); setComboChoice(''); }}
                                onComboChange={setComboChoice}
                                onAssign={handleAssignPathway}
                                onUnlock={handleUnlockPathway}
                            />
                        ) : (
                            <CompulsorySubjectsPanel
                                catalog={catalog}
                                enrolledSubjects={enrolledSubjects}
                                isLocked={isLocked}
                                canUnlock={canUnlock}
                                saving={saving}
                                unlocking={unlocking}
                                onSaveAndLock={handleSaveAndLockCompulsory}
                                onUnlock={handleUnlockSubjects}
                            />
                        )
                    )}

                    {/* --- TAB 2: GRADE POLICIES BUILDER (Senior Secondary only) --- */}
                    {activeMainTab === 'policies' && requiresPathwayChoice && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                            {/* Category Limits */}
                            <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-none flex flex-col h-full">
                                <div className="flex items-center gap-2 mb-4 text-slate-800 dark:text-slate-100">
                                    <ShieldAlert className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
                                    <h3 className="font-bold">Category Limits</h3>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Restrict how many subjects a student can pick from a specific department (governs the student self-service elective flow).</p>

                                <div className="flex gap-2 mb-6 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-100 dark:border-slate-700 shrink-0">
                                    <select aria-label="Select department" className="flex-1 text-sm border rounded px-2 py-1.5 outline-none bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100" value={newLimitDept} onChange={e => setNewLimitDept(e.target.value ? Number(e.target.value) : '')}>
                                        <option value="">Select Dept...</option>
                                        {departments.filter(d => d.is_active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                    </select>
                                    <input type="number" min="1" className="w-20 text-sm border rounded px-2 py-1.5 outline-none bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100" value={newLimitMax} onChange={e => setNewLimitMax(parseInt(e.target.value))} />
                                    <IconButton aria-label="Add category limit" title="Add category limit" onClick={handleAddCategoryLimit} size="small" sx={{ bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.dark' } }}>
                                        <Plus className="w-4 h-4" />
                                    </IconButton>
                                </div>

                                <div className="space-y-2 overflow-y-auto max-h-64 pr-2 custom-scrollbar flex-1">
                                    {categoryLimits.map(limit => (
                                        <div key={limit.id} className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-100 dark:border-slate-700 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-200">{limit.department_name ?? 'Uncategorized'}</span>
                                            <div className="flex items-center gap-4">
                                                <Chip size="small" label={`Max ${limit.max_subjects}`} color="primary" variant="outlined" />
                                                <IconButton aria-label="Delete category limit" title="Delete category limit" onClick={() => handleDeleteCategoryLimit(limit.id)} size="small" sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}>
                                                    <Trash2 className="w-4 h-4" />
                                                </IconButton>
                                            </div>
                                        </div>
                                    ))}
                                    {categoryLimits.length === 0 && <p className="text-center text-xs text-slate-400 dark:text-slate-500 italic mt-4">No limits configured.</p>}
                                </div>
                            </div>

                            {/* Exclusion Rules */}
                            <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-none flex flex-col h-full">
                                <div className="flex items-center gap-2 mb-4 text-slate-800 dark:text-slate-100">
                                    <AlertCircle className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                                    <h3 className="font-bold">Mutually Exclusive</h3>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Define subject combinations that are strictly forbidden (Timetable Clashes).</p>

                                <div className="flex flex-col gap-2 mb-6 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-100 dark:border-slate-700 shrink-0">
                                    <SearchableSelect
                                        aria-label="Select Subject A"
                                        value={newExclusionA}
                                        onChange={setNewExclusionA}
                                        placeholder="Select Subject A..."
                                        searchPlaceholder="Search subjects…"
                                        options={flatSubjects.filter(s => !s.is_core).map(s => ({ value: String(s.id), label: s.name }))}
                                    />
                                    <div className="text-center text-xs font-bold text-slate-400 dark:text-slate-500">CANNOT BE TAKEN WITH</div>
                                    <SearchableSelect
                                        aria-label="Select Subject B"
                                        value={newExclusionB}
                                        onChange={setNewExclusionB}
                                        placeholder="Select Subject B..."
                                        searchPlaceholder="Search subjects…"
                                        options={flatSubjects.filter(s => !s.is_core).map(s => ({ value: String(s.id), label: s.name }))}
                                    />
                                    <Button onClick={handleAddExclusion} variant="contained" color="warning" size="small" sx={{ mt: 1, fontWeight: 700 }}>
                                        Add Rule
                                    </Button>
                                </div>

                                <div className="space-y-2 overflow-y-auto max-h-64 pr-2 custom-scrollbar flex-1">
                                    {exclusionRules.map(rule => (
                                        <div key={rule.id} className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-100 dark:border-slate-700 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-200 text-xs">
                                                <span className="text-red-500 dark:text-red-400 font-bold">{rule.subject_a_name}</span> vs <span className="text-red-500 dark:text-red-400 font-bold">{rule.subject_b_name}</span>
                                            </span>
                                            <IconButton aria-label="Delete exclusion rule" title="Delete exclusion rule" onClick={() => handleDeleteExclusion(rule.id)} size="small" sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}>
                                                <Trash2 className="w-4 h-4" />
                                            </IconButton>
                                        </div>
                                    ))}
                                    {exclusionRules.length === 0 && <p className="text-center text-xs text-slate-400 dark:text-slate-500 italic mt-4">No exclusion rules configured.</p>}
                                </div>
                            </div>

                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

// --- SUB-COMPONENT: Compulsory (Lower/Upper Primary, JSS) — no real per-subject choice, so
// the whole eligible catalog is shown pre-selected and locked in one action. ---
function CompulsorySubjectsPanel({
    catalog, enrolledSubjects, isLocked, canUnlock, saving, unlocking, onSaveAndLock, onUnlock,
}: {
    catalog: DepartmentGroup[];
    enrolledSubjects: EnrolledSubject[];
    isLocked: boolean;
    canUnlock: boolean;
    saving: boolean;
    unlocking: boolean;
    onSaveAndLock: () => void;
    onUnlock: () => void;
}) {
    // Once locked, the source of truth is the student's own enrollment rows (grouped by their
    // resolved department name) rather than the raw grade catalog, so this stays accurate even
    // if the catalog changes later.
    const displayGroups: { name: string; subjects: { id: number; name: string; code: string }[] }[] = isLocked
        ? Object.values(
            enrolledSubjects.reduce((acc, e) => {
                const key = e.department_name ?? 'Uncategorized';
                if (!acc[key]) acc[key] = { name: key, subjects: [] };
                acc[key].subjects.push({ id: e.subject_id, name: e.subject_name, code: '' });
                return acc;
            }, {} as Record<string, { name: string; subjects: { id: number; name: string; code: string }[] }>)
        )
        : catalog.map((g) => ({ name: g.department_name, subjects: g.subjects }));

    const totalCount = displayGroups.reduce((n, g) => n + g.subjects.length, 0);

    return (
        <div className="space-y-6">
            {/* Status banner — a real ribbon, not a plain Alert, so locked-vs-not reads at a glance */}
            <div
                className="rounded-2xl p-5 flex items-center gap-4"
                style={{
                    background: isLocked
                        ? `linear-gradient(135deg, ${TINT.emerald50}, #fff)`
                        : `linear-gradient(135deg, ${TINT.blue50}, #fff)`,
                    border: `1px solid ${isLocked ? TINT.emerald100 : TINT.blue100}`,
                }}
            >
                <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: isLocked ? TINT.emerald600 : TINT.blue600 }}
                >
                    {isLocked ? <Lock className="w-5 h-5 text-white" /> : <ShieldAlert className="w-5 h-5 text-white" />}
                </div>
                <div>
                    <p className="font-bold text-sm" style={{ color: isLocked ? TINT.emerald700 : TINT.blue700 }}>
                        {isLocked ? 'Locked in' : 'No elective choice at this grade'}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {isLocked
                            ? `${totalCount} subject${totalCount !== 1 ? 's' : ''} saved and locked for this student.`
                            : `All ${totalCount} eligible subject${totalCount !== 1 ? 's' : ''} below are compulsory — Save & Lock to confirm them.`}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {displayGroups.map((group) => {
                    const accent = deptAccent(group.name);
                    return (
                        <div
                            key={group.name}
                            className="rounded-2xl overflow-hidden"
                            style={{ border: `1px solid ${accent.border}` }}
                        >
                            <div
                                className="px-4 py-2.5 flex items-center justify-between"
                                style={{ background: accent.bg }}
                            >
                                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: accent.text }}>
                                    {group.name}
                                </span>
                                <span
                                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                    style={{ background: '#fff', color: accent.text }}
                                >
                                    {group.subjects.length}
                                </span>
                            </div>
                            <div className="p-4 flex flex-wrap gap-2 bg-white dark:bg-slate-900">
                                {group.subjects.map((s) => (
                                    <Chip
                                        key={s.id}
                                        label={s.name}
                                        size="small"
                                        icon={<Lock className="w-3 h-3" />}
                                        sx={{ bgcolor: accent.chip, color: accent.text, fontWeight: 600 }}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="flex justify-end items-center gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                {isLocked ? (
                    <Tooltip title={canUnlock ? '' : "Only an admin or this student's Class Teacher can unlock."}>
                        <span>
                            <Button
                                variant="outlined"
                                color="warning"
                                disabled={!canUnlock || unlocking}
                                onClick={onUnlock}
                                startIcon={unlocking ? <CircularProgress size={16} /> : <Unlock className="w-4 h-4" />}
                            >
                                {unlocking ? 'Unlocking...' : 'Unlock'}
                            </Button>
                        </span>
                    </Tooltip>
                ) : (
                    <Button
                        variant="contained"
                        disabled={saving || totalCount === 0}
                        onClick={onSaveAndLock}
                        startIcon={saving ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <Lock className="w-4 h-4" />}
                    >
                        {saving ? 'Saving...' : 'Save & Lock Subjects'}
                    </Button>
                )}
            </div>
        </div>
    );
}

// --- SUB-COMPONENT: Senior Secondary — Pathway -> Track -> Preset Combination cascade,
// admin-direct-assign (no Pending intermediate). ---
const PATHWAY_STATUS_COLOR: Record<string, 'warning' | 'success' | 'error'> = {
    Pending: 'warning', Approved: 'success', Rejected: 'error',
};
const PATHWAY_STATUS_ICON: Record<string, React.ReactElement> = {
    Pending: <Clock className="w-3.5 h-3.5" />,
    Approved: <CheckCircle2 className="w-3.5 h-3.5" />,
    Rejected: <XCircle className="w-3.5 h-3.5" />,
};

function SeniorSecondaryPathwayPanel({
    pathways, pathwaySelection, pathwayChoice, trackChoice, comboChoice,
    selectedPathway, selectedTrack, selectedCombo, coreSubjects,
    canUnlock, saving, unlocking,
    onPathwayChange, onTrackChange, onComboChange, onAssign, onUnlock,
}: {
    pathways: PathwayOption[];
    pathwaySelection: PathwaySelection | null;
    pathwayChoice: number | '';
    trackChoice: number | '';
    comboChoice: number | '';
    selectedPathway: PathwayOption | null;
    selectedTrack: TrackOption | null;
    selectedCombo: ComboOption | null;
    coreSubjects: Subject[];
    canUnlock: boolean;
    saving: boolean;
    unlocking: boolean;
    onPathwayChange: (id: number | '') => void;
    onTrackChange: (id: number | '') => void;
    onComboChange: (id: number | '') => void;
    onAssign: () => void;
    onUnlock: () => void;
}) {
    const isLocked = pathwaySelection?.status === 'Approved';

    return (
        <div className="space-y-6">
            <div
                className="rounded-2xl p-5 flex items-center gap-4"
                style={{ background: `linear-gradient(135deg, #EEF2FF, #fff)`, border: '1px solid #C7D2FE' }}
            >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#4F46E5' }}>
                    <GitBranch className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
                <div>
                    <p className="font-bold text-sm" style={{ color: '#4338CA' }}>Pathway, Track & Subject Combination</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Senior Secondary students choose one Pathway, then a Track, then one KNEC pre-approved subject combination — not individual subjects.
                    </p>
                </div>
            </div>

            {coreSubjects.length > 0 && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Compulsory Core Subjects</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400">{coreSubjects.length}</span>
                    </div>
                    <div className="p-4 flex flex-wrap gap-2 bg-white dark:bg-slate-900">
                        {coreSubjects.map((s) => (
                            <Chip key={s.id} label={s.name} size="small" icon={<Lock className="w-3 h-3" />} sx={{ bgcolor: TINT.slate100, color: TINT.slate600, fontWeight: 600 }} />
                        ))}
                    </div>
                </div>
            )}

            {pathways.length === 0 ? (
                <Alert severity="warning">No pathways are configured for this grade's curriculum yet — set them up in Curriculum Hub first.</Alert>
            ) : isLocked && pathwaySelection ? (
                <div
                    className="rounded-2xl overflow-hidden flex"
                    style={{ border: `1px solid ${TINT.emerald100}` }}
                >
                    <div style={{ background: TINT.emerald600, width: 6 }} />
                    <div className="flex-1 p-5" style={{ background: `linear-gradient(135deg, ${TINT.emerald50}, #fff)` }}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <h4 className="font-bold text-lg text-slate-800 dark:text-slate-100">{pathwaySelection.pathway_name}</h4>
                                    <Chip size="small" color={PATHWAY_STATUS_COLOR[pathwaySelection.status]} icon={PATHWAY_STATUS_ICON[pathwaySelection.status]} label={pathwaySelection.status} />
                                </div>
                                {pathwaySelection.track_name && (
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Track: <span className="font-semibold text-slate-700 dark:text-slate-200">{pathwaySelection.track_name}</span></p>
                                )}
                                {selectedCombo && (
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        {selectedCombo.subjects.map((s) => (
                                            <Chip key={s.id} label={s.name} size="small" sx={{ bgcolor: TINT.emerald100, color: TINT.emerald700, fontWeight: 600 }} />
                                        ))}
                                    </div>
                                )}
                            </div>
                            <Tooltip title={canUnlock ? '' : "Only an admin or this student's Class Teacher can unlock."}>
                                <span>
                                    <IconButton
                                        aria-label="Unlock pathway"
                                        disabled={!canUnlock || unlocking}
                                        onClick={onUnlock}
                                        sx={{ color: 'warning.main', bgcolor: '#fff', border: '1px solid', borderColor: 'warning.light', '&:hover': { bgcolor: 'warning.50' } }}
                                    >
                                        {unlocking ? <CircularProgress size={20} /> : <Unlock className="w-5 h-5" />}
                                    </IconButton>
                                </span>
                            </Tooltip>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <PathwayWizardStep
                        stepNumber={1}
                        label="Pathway"
                        done={!!pathwayChoice}
                        active
                    >
                        <Select
                            fullWidth
                            size="small"
                            displayEmpty
                            value={pathwayChoice}
                            onChange={(e) => onPathwayChange(e.target.value ? Number(e.target.value) : '')}
                            renderValue={(v) => (v ? pathways.find((p) => p.id === v)?.name : <span className="text-slate-400 dark:text-slate-500">Choose a pathway...</span>)}
                        >
                            {pathways.map((p) => (
                                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                            ))}
                        </Select>
                    </PathwayWizardStep>

                    {selectedPathway && selectedPathway.tracks.length > 0 && (
                        <PathwayWizardStep stepNumber={2} label="Track" done={!!trackChoice} active>
                            <Select
                                fullWidth
                                size="small"
                                displayEmpty
                                value={trackChoice}
                                onChange={(e) => onTrackChange(e.target.value ? Number(e.target.value) : '')}
                                renderValue={(v) => (v ? selectedPathway.tracks.find((t) => t.id === v)?.name : <span className="text-slate-400 dark:text-slate-500">Choose a track...</span>)}
                            >
                                {selectedPathway.tracks.map((t) => (
                                    <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                                ))}
                            </Select>
                        </PathwayWizardStep>
                    )}

                    {selectedTrack && selectedTrack.preset_combinations.length > 0 && (
                        <PathwayWizardStep stepNumber={3} label="Subject Combination" done={!!comboChoice} active>
                            <Select
                                fullWidth
                                size="small"
                                displayEmpty
                                value={comboChoice}
                                onChange={(e) => onComboChange(e.target.value ? Number(e.target.value) : '')}
                                renderValue={(v) => (v ? selectedTrack.preset_combinations.find((c) => c.id === v)?.subjects.map((s) => s.name).join(' + ') : <span className="text-slate-400 dark:text-slate-500">Choose a combination...</span>)}
                            >
                                {selectedTrack.preset_combinations.map((c) => (
                                    <MenuItem key={c.id} value={c.id}>{c.subjects.map((s) => s.name).join(' + ')}</MenuItem>
                                ))}
                            </Select>
                            {selectedCombo && (
                                <div className="flex flex-wrap gap-1.5 mt-3">
                                    {selectedCombo.subjects.map((s) => (
                                        <Chip key={s.id} label={s.name} size="small" sx={{ bgcolor: TINT.blue100, color: TINT.blue700, fontWeight: 600 }} />
                                    ))}
                                </div>
                            )}
                        </PathwayWizardStep>
                    )}

                    <div className="flex justify-end pt-2">
                        <Button
                            variant="contained"
                            disabled={!pathwayChoice || saving}
                            onClick={onAssign}
                            startIcon={saving ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <Sparkles className="w-4 h-4" />}
                        >
                            {saving ? 'Assigning...' : 'Assign & Lock Pathway'}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

// A single numbered step in the Pathway -> Track -> Combination wizard. `done` fills the
// step number badge to give an at-a-glance sense of progress through the 3 steps.
function PathwayWizardStep({
    stepNumber, label, done, active, children,
}: {
    stepNumber: number;
    label: string;
    done: boolean;
    active: boolean;
    children: React.ReactNode;
}) {
    return (
        <div className="flex gap-3">
            <div className="flex flex-col items-center pt-1">
                <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors"
                    style={done
                        ? { background: TINT.blue600, color: '#fff' }
                        : { background: TINT.slate100, color: TINT.slate400, border: `1.5px solid ${TINT.slate200}` }}
                >
                    {done ? <CheckCircle2 className="w-4 h-4" /> : stepNumber}
                </div>
                {stepNumber < 3 && <div className="w-px flex-1 my-1" style={{ background: TINT.slate200, minHeight: 16 }} />}
            </div>
            <div className={`flex-1 rounded-2xl border p-4 mb-1 transition-colors ${active ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 dark:bg-slate-800/40'}`} style={{ borderColor: done ? TINT.blue100 : TINT.slate200 }}>
                <div className="flex items-center gap-1.5 mb-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
                    {done && <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600" />}
                </div>
                {children}
            </div>
        </div>
    );
}

export default AssignSubjectsPage;

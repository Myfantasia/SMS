import { useState, useEffect, useCallback, type MouseEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  BookMarked, Plus, Trash2, X, Pencil, Eye, Sunset, Archive, Layers, GitBranch, Sparkles,
  Rows3, GraduationCap, ArrowLeft, ChevronRight, Building2, AlertCircle, CheckCircle2, Circle
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import type { DashboardContextType } from '../../layouts/DashboardLayouts';
import DepartmentsCard from '../../components/academics/DepartmentsCard';
import DepartmentModal from '../../components/academics/DepartmentModal';


interface Curriculum {
  id: number;
  code: string;
  name: string;
  is_active_for_new_grades: boolean;
  is_archived: boolean;
}

interface Pathway {
  id: number;
  curriculum: number;
  name: string;
  description: string;
}

interface Track {
  id: number;
  pathway: number;
  name: string;
  description: string;
  display_order: number;
}

interface Tier {
  id: number;
  curriculum: number;
  name: string;
  code: string;
  display_order: number;
  exit_exam_code: string;
  exit_is_terminal: boolean;
}

interface GradeSummary {
  id: number;
  grade_name: string;
  curriculum_id: number | null;
  tier_id: number | null;
  total_streams: number;
}

interface SubjectPool {
  id?: number;
  preset?: number;
  pool_type: 'CORE_COMPULSORY' | 'PATHWAY_CORE' | 'GUIDED_ELECTIVE';
  min_subjects: number;
  max_subjects: number;
  subjects: number[];
  // Legacy per-pool scoping — superseded by `combinations` below (kept for backward
  // compatibility with any pool built the old, one-pool-per-pathway/track way).
  pathway: number | null;
  track: number | null;
  // Only meaningful on a PATHWAY_CORE pool — the official KNEC combinations this school
  // offers, spanning every pathway/track in the curriculum within a single pool.
  combinations: number[];
}

interface CurriculumPreset {
  id: number;
  name: string;
  min_subjects: number;
  max_subjects: number;
  display_order: number;
  curriculum: number | null;
  tier: number | null;
  pathway: number | null;
  track: number | null;
  pools: SubjectPool[];
}

interface SubjectOption {
  id: number;
  code: string;
  name: string;
  is_core: boolean;
}

interface PresetCombination {
  id: number;
  track: number;
  pathway: number;
  pathway_name: string;
  name: string;
  display_name: string;
  code: string;
  subjects: number[];
  is_active: boolean;
}

interface SubjectCurriculumProfile {
  id: number;
  subject: number;
  curriculum: number;
  tier: number | null;
  is_core: boolean | null;
  department: number | null;
  total_lessons: number | null;
  double_lessons_required: number | null;
  remedial_lessons_required: number | null;
}

interface DepartmentOption {
  id: number;
  name: string;
  description: string;
  subject_count: number;
  curriculum_id: number;
  is_active: boolean;
}

const POOL_TYPE_LABELS: Record<SubjectPool['pool_type'], string> = {
  CORE_COMPULSORY: 'Core Compulsory',
  PATHWAY_CORE: 'Pathway Core',
  GUIDED_ELECTIVE: 'Guided Elective',
};

// Department-grouped subject picker accents for Pathway Core pools — same hash-to-color
// pattern as CompulsorySubjectsPanel in components/action routes/AssignSubjectsPage.tsx.
const DEPT_ACCENTS = [
  { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8' }, // blue
  { bg: '#FDF4FF', border: '#F0ABFC', text: '#A21CAF' }, // fuchsia
  { bg: '#FFF7ED', border: '#FDBA74', text: '#C2410C' }, // orange
  { bg: '#ECFDF5', border: '#6EE7B7', text: '#047857' }, // emerald
  { bg: '#EEF2FF', border: '#A5B4FC', text: '#4338CA' }, // indigo
  { bg: '#FEF2F2', border: '#FCA5A5', text: '#B91C1C' }, // red
  { bg: '#F0FDFA', border: '#5EEAD4', text: '#0F766E' }, // teal
];

function deptAccent(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return DEPT_ACCENTS[hash % DEPT_ACCENTS.length];
}

const emptyPreset = (): Omit<CurriculumPreset, 'id'> => ({
  name: '', min_subjects: 7, max_subjects: 8, display_order: 0,
  curriculum: null, tier: null, pathway: null, track: null, pools: [],
});

type Tab = 'curricula' | 'tiers' | 'pathways' | 'presets';

export default function CurriculumHub() {
  const { permissions } = useOutletContext<DashboardContextType>();
  const canEdit = permissions.includes('curriculum.edit');
  const canArchive = permissions.includes('curriculum.archive');
  const canEditClasses = permissions.includes('classes.edit');

  const [tab, setTab] = useState<Tab>('curricula');
  const [selectedTierId, setSelectedTierId] = useState<number | null>(null);
  const [selectedPathwayId, setSelectedPathwayId] = useState<number | null>(null);
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<number | null>(null);
  const [openPresetId, setOpenPresetId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [pathways, setPathways] = useState<Pathway[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [presets, setPresets] = useState<CurriculumPreset[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [subjectProfiles, setSubjectProfiles] = useState<SubjectCurriculumProfile[]>([]);
  const [grades, setGrades] = useState<GradeSummary[]>([]);
  const [presetCombinations, setPresetCombinations] = useState<PresetCombination[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  const fetchAll = useCallback(async () => {
    try {
      const [curRes, pathRes, trackRes, tierRes, presetRes, subRes, profileRes, academicHubRes, comboRes, deptRes] = await Promise.all([
        api.get('/api/core/curriculum/curricula/'),
        api.get('/api/core/curriculum/pathways/'),
        api.get('/api/core/curriculum/tracks/'),
        api.get('/api/core/curriculum/tiers/'),
        api.get('/api/core/curriculum/presets/'),
        api.get('/api/manage-subjects/'),
        api.get('/api/core/curriculum/subject-profiles/'),
        api.get('/api/academic-hub/'),
        api.get('/api/core/curriculum/preset-combinations/'),
        api.get('/api/departments/'),
      ]);
      setCurricula(curRes.data);
      setPathways(pathRes.data);
      setTracks(trackRes.data);
      setTiers(tierRes.data);
      setPresets(presetRes.data);
      setSubjects(subRes.data?.data ?? []);
      setSubjectProfiles(profileRes.data ?? []);
      setGrades(academicHubRes.data?.data?.classes ?? []);
      setPresetCombinations(comboRes.data);
      setDepartments(deptRes.data?.status === 'success' ? deptRes.data.data : []);
    } catch (error) {
      console.error('Failed to load curriculum data', error);
      toast.error('Failed to load curriculum data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 rounded-2xl"></div>
        <div className="h-64 bg-slate-200 rounded-2xl"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-500/10">
          <BookMarked className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2 dark:text-slate-100">
            Curriculum
            {!canEdit && (
              <span className="flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded-full dark:text-slate-400 dark:bg-slate-800 dark:border-slate-700">
                <Eye className="w-3 h-3" /> View only
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5 dark:text-slate-400">
            {curricula.length} curricul{curricula.length === 1 ? 'um' : 'a'} &middot; {presets.length} preset{presets.length !== 1 ? 's' : ''} &middot; {pathways.length} pathway{pathways.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="flex bg-white rounded-lg p-1 shadow-sm border border-slate-100 w-max flex-wrap dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
        <button onClick={() => { setTab('curricula'); setSelectedTierId(null); setSelectedCurriculumId(null); }} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${tab === 'curricula' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
          <Layers className="w-4 h-4" /> Curricula
        </button>
        <button onClick={() => { setTab('tiers'); setSelectedTierId(null); }} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${tab === 'tiers' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
          <Rows3 className="w-4 h-4" /> Tiers
        </button>
        <button onClick={() => { setTab('presets'); setSelectedTierId(null); }} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${tab === 'presets' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
          <Sparkles className="w-4 h-4" /> Presets
        </button>
        <button onClick={() => { setTab('pathways'); setSelectedTierId(null); setSelectedPathwayId(null); }} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${tab === 'pathways' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
          <GitBranch className="w-4 h-4" /> Pathways
        </button>
      </div>

      {tab === 'curricula' && (() => {
        const selectedCurriculum = selectedCurriculumId ? curricula.find((c) => c.id === selectedCurriculumId) : undefined;
        return selectedCurriculum ? (
          <CurriculumDetailView
            curriculum={selectedCurriculum}
            curricula={curricula}
            tiers={tiers.filter((t) => t.curriculum === selectedCurriculum.id)}
            pathways={pathways.filter((p) => p.curriculum === selectedCurriculum.id)}
            presets={presets.filter((p) => p.curriculum === selectedCurriculum.id)}
            grades={grades.filter((g) => g.curriculum_id === selectedCurriculum.id)}
            subjects={subjects}
            subjectProfiles={subjectProfiles}
            departments={departments}
            canEdit={canEdit}
            onBack={() => setSelectedCurriculumId(null)}
            onChanged={fetchAll}
            onOpenTier={(t) => { setTab('tiers'); setSelectedTierId(t.id); }}
            onOpenPathway={(p) => { setTab('pathways'); setSelectedPathwayId(p.id); }}
            onGoToPresets={() => setTab('presets')}
            onOpenPreset={(p) => { setTab('presets'); setOpenPresetId(p.id); }}
          />
        ) : (
          <CurriculaTab
            curricula={curricula} canEdit={canEdit} canArchive={canArchive}
            onChanged={fetchAll}
            onOpenCurriculum={(c) => setSelectedCurriculumId(c.id)}
          />
        );
      })()}
      {tab === 'tiers' && (() => {
        const selectedTier = selectedTierId ? tiers.find((t) => t.id === selectedTierId) : undefined;
        return selectedTier ? (
          <TierDetailView
            tier={selectedTier}
            curricula={curricula}
            grades={grades}
            subjects={subjects}
            subjectProfiles={subjectProfiles}
            departments={departments}
            presets={presets.filter((p) => p.tier === selectedTier.id)}
            canEdit={canEditClasses}
            canEditSubjects={canEdit}
            onBack={() => setSelectedTierId(null)}
            onChanged={fetchAll}
            onOpenPreset={(p) => { setTab('presets'); setOpenPresetId(p.id); }}
          />
        ) : (
          <TiersTab
            tiers={tiers} curricula={curricula} canEdit={canEdit}
            onChanged={fetchAll}
            onOpenTier={(t) => setSelectedTierId(t.id)}
          />
        );
      })()}
      {tab === 'pathways' && (() => {
        const selectedPathway = selectedPathwayId ? pathways.find((p) => p.id === selectedPathwayId) : undefined;
        return selectedPathway ? (
          <PathwayDetailView
            pathway={selectedPathway}
            tracks={tracks.filter((t) => t.pathway === selectedPathway.id)}
            presetCombinations={presetCombinations.filter((c) => c.pathway === selectedPathway.id)}
            subjects={subjects}
            canEdit={canEdit}
            onBack={() => setSelectedPathwayId(null)}
            onChanged={fetchAll}
          />
        ) : (
          <PathwaysTab
            pathways={pathways} curricula={curricula} tracks={tracks} canEdit={canEdit}
            onChanged={fetchAll}
            onOpenPathway={(p) => setSelectedPathwayId(p.id)}
          />
        );
      })()}
      {tab === 'presets' && (
        <PresetsTab
          presets={presets} curricula={curricula} pathways={pathways} tracks={tracks} tiers={tiers} subjects={subjects}
          subjectProfiles={subjectProfiles} presetCombinations={presetCombinations} departments={departments}
          canEdit={canEdit} onChanged={fetchAll}
          openPresetId={openPresetId} onOpenPresetHandled={() => setOpenPresetId(null)}
        />
      )}
    </div>
  );
}

// ==========================================
// CURRICULA TAB
// ==========================================

function CurriculaTab({ curricula, canEdit, canArchive, onChanged, onOpenCurriculum }: {
  curricula: Curriculum[]; canEdit: boolean; canArchive: boolean; onChanged: () => void;
  onOpenCurriculum: (curriculum: Curriculum) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const handleCreate = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error('Code and name are required.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/core/curriculum/curricula/', { code: code.trim(), name: name.trim() });
      toast.success(`Curriculum '${name}' created.`);
      setCode(''); setName(''); setAdding(false);
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.code?.[0] || error?.response?.data?.detail || 'Failed to create curriculum.');
    } finally {
      setSaving(false);
    }
  };

  const handleSunset = async (curriculum: Curriculum) => {
    if (!window.confirm(`Sunset '${curriculum.name}'? New grades won't be able to select it, but existing grades keep working.`)) return;
    setBusyId(curriculum.id);
    try {
      await api.post(`/api/core/curriculum/curricula/${curriculum.id}/sunset/`);
      toast.success(`'${curriculum.name}' sunset.`);
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to sunset curriculum.');
    } finally {
      setBusyId(null);
    }
  };

  const handleArchive = async (curriculum: Curriculum) => {
    if (!window.confirm(`Archive '${curriculum.name}'? This freezes ALL of its presets, pathways and subject pools against ordinary edits — only users with curriculum.archive will be able to make corrections.`)) return;
    setBusyId(curriculum.id);
    try {
      await api.post(`/api/core/curriculum/curricula/${curriculum.id}/archive/`);
      toast.success(`'${curriculum.name}' archived.`);
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to archive curriculum.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-100 bg-slate-50 dark:text-slate-500 dark:border-slate-700 dark:bg-slate-800/40">
              <th className="px-6 py-3 font-bold">Curriculum</th>
              <th className="px-6 py-3 font-bold">Status</th>
              <th className="px-6 py-3 font-bold text-right">Actions</th>
              <th className="px-6 py-3 font-bold w-8"></th>
            </tr>
          </thead>
          <tbody className="text-sm text-slate-700 divide-y divide-slate-50 dark:text-slate-200 dark:divide-slate-800">
            {curricula.map((c) => (
              <tr
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenCurriculum(c)}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpenCurriculum(c); }}
                title="Open this curriculum's subjects"
                className="hover:bg-slate-50 transition-colors cursor-pointer dark:hover:bg-slate-800/40"
              >
                <td className="px-6 py-4">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{c.name}</span>
                  <span className="text-xs text-slate-400 ml-2 font-mono dark:text-slate-500">{c.code}</span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    {c.is_archived ? (
                      <span className="bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/40">Archived</span>
                    ) : !c.is_active_for_new_grades ? (
                      <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/40">Sunset</span>
                    ) : (
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/40">Active</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSunset(c); }}
                      disabled={!canArchive || busyId === c.id || !c.is_active_for_new_grades || c.is_archived}
                      className="text-slate-400 hover:text-amber-600 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-400 dark:text-slate-500 dark:hover:text-amber-400"
                      title={!canArchive ? "Requires curriculum.archive" : "Sunset — stop new grades from selecting it"}
                    >
                      <Sunset className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleArchive(c); }}
                      disabled={!canArchive || busyId === c.id || c.is_archived}
                      className="text-slate-400 hover:text-red-600 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-400 dark:text-slate-500 dark:hover:text-red-400"
                      title={!canArchive ? "Requires curriculum.archive" : "Archive — freeze all config"}
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                  </div>
                </td>
                <td className="px-6 py-4"><ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" /></td>
              </tr>
            ))}
            {curricula.length === 0 && (
              <tr><td colSpan={4} className="p-8 text-center text-slate-400 dark:text-slate-500">No curricula yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        adding ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-3 dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">New Curriculum</h3>
            <div className="flex gap-3">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code, e.g. IGCSE" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400 dark:focus:ring-indigo-400" />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. International GCSE" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400 dark:focus:ring-indigo-400" />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="flex items-center gap-2 text-sm font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-400">
            <Plus className="w-4 h-4" /> Add Curriculum
          </button>
        )
      )}
    </div>
  );
}

// ==========================================
// PATHWAYS TAB
// ==========================================

function PathwaysTab({ pathways, curricula, tracks, canEdit, onChanged, onOpenPathway }: {
  pathways: Pathway[]; curricula: Curriculum[]; tracks: Track[]; canEdit: boolean; onChanged: () => void;
  onOpenPathway: (pathway: Pathway) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [curriculumId, setCurriculumId] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const curriculumName = (id: number) => curricula.find((c) => c.id === id)?.name ?? 'Unknown';

  const handleCreate = async () => {
    if (!curriculumId || !name.trim()) {
      toast.error('Curriculum and name are required.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/core/curriculum/pathways/', { curriculum: curriculumId, name: name.trim(), description: description.trim() });
      toast.success(`Pathway '${name}' created.`);
      setName(''); setDescription(''); setAdding(false);
      onChanged();
    } catch (error: any) {
      const data = error?.response?.data;
      toast.error(data?.curriculum?.[0] || data?.detail || data?.name?.[0] || 'Failed to create pathway.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pathway: Pathway) => {
    if (!window.confirm(`Delete pathway '${pathway.name}'?`)) return;
    try {
      await api.delete(`/api/core/curriculum/pathways/${pathway.id}/`);
      toast.success('Pathway deleted.');
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to delete pathway.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:divide-slate-800 dark:shadow-none">
        {pathways.map((p) => {
          const trackCount = tracks.filter((t) => t.pathway === p.id).length;
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenPathway(p)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpenPathway(p); }}
              title="Open this pathway's tracks"
              className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer dark:hover:bg-slate-800/40"
            >
              <div>
                <span className="font-semibold text-slate-800 text-sm dark:text-slate-100">{p.name}</span>
                <span className="text-xs text-slate-400 ml-2 dark:text-slate-500">{curriculumName(p.curriculum)}</span>
                <span className="text-xs text-slate-400 ml-2 dark:text-slate-500">&middot; {trackCount} track{trackCount !== 1 ? 's' : ''}</span>
                {p.description && <p className="text-xs text-slate-400 mt-0.5 dark:text-slate-500">{p.description}</p>}
              </div>
              <div className="flex items-center gap-3">
                {canEdit && (
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(p); }} className="text-slate-400 hover:text-red-600 transition dark:text-slate-500 dark:hover:text-red-400" title="Delete pathway">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
              </div>
            </div>
          );
        })}
        {pathways.length === 0 && <div className="text-slate-400 p-10 text-center text-sm dark:text-slate-500">No pathways yet — pathways are SSS specialization tracks (STEM, Social Sciences, Arts & Sports Science) under a CBC curriculum.</div>}
      </div>

      {canEdit && (
        adding ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-3 dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">New Pathway</h3>
            <select aria-label="Curriculum" value={curriculumId} onChange={(e) => setCurriculumId(e.target.value ? Number(e.target.value) : '')} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400 dark:focus:ring-indigo-400">
              <option value="">Select curriculum...</option>
              {curricula.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. STEM" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400 dark:focus:ring-indigo-400" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional) — what this pathway covers, who it suits, where it leads" rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-y dark:border-slate-700 dark:focus:border-indigo-400 dark:focus:ring-indigo-400" />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="flex items-center gap-2 text-sm font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-400">
            <Plus className="w-4 h-4" /> Add Pathway
          </button>
        )
      )}
    </div>
  );
}

// ==========================================
// PATHWAY DETAIL VIEW (Tracks under a Pathway)
// ==========================================
// Opened by clicking a Pathway in the Pathways tab, same shape as TierDetailView — a
// Pathway's Tracks (e.g. STEM's Pure Sciences / Applied Sciences / Technical Studies) only
// make sense scoped to that one Pathway, so they're managed here rather than in a flat,
// pathway-agnostic list.

function PathwayDetailView({ pathway, tracks, presetCombinations, subjects, canEdit, onBack, onChanged }: {
  pathway: Pathway; tracks: Track[]; presetCombinations: PresetCombination[]; subjects: SubjectOption[];
  canEdit: boolean; onBack: () => void; onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [displayOrder, setDisplayOrder] = useState(0);
  const [saving, setSaving] = useState(false);
  const [expandedTrackId, setExpandedTrackId] = useState<number | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('Track name is required.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/core/curriculum/tracks/', {
        pathway: pathway.id, name: name.trim(), description: description.trim(), display_order: displayOrder,
      });
      toast.success(`Track '${name}' created.`);
      setName(''); setDescription(''); setDisplayOrder(0); setAdding(false);
      onChanged();
    } catch (error: any) {
      const data = error?.response?.data;
      toast.error(data?.detail || data?.name?.[0] || 'Failed to create track.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (track: Track) => {
    if (!window.confirm(`Delete track '${track.name}'? Any preset or student selection pointing at it falls back to "no track".`)) return;
    try {
      await api.delete(`/api/core/curriculum/tracks/${track.id}/`);
      toast.success('Track deleted.');
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to delete track.');
    }
  };

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700 transition dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="w-4 h-4" /> Back to Pathways
      </button>

      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-500/10">
          <GitBranch className="w-6 h-6" strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 dark:text-slate-100">{pathway.name}</h2>
          {pathway.description && <p className="text-sm text-slate-500 dark:text-slate-400">{pathway.description}</p>}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:divide-slate-800 dark:shadow-none">
        {tracks.map((t) => {
          const combos = presetCombinations.filter((c) => c.track === t.id);
          const expanded = expandedTrackId === t.id;
          return (
            <div key={t.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpandedTrackId(expanded ? null : t.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') setExpandedTrackId(expanded ? null : t.id); }}
                className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors dark:hover:bg-slate-800/40"
              >
                <div>
                  <span className="font-semibold text-slate-800 text-sm dark:text-slate-100">{t.name}</span>
                  {t.description && <p className="text-xs text-slate-400 mt-0.5 dark:text-slate-500">{t.description}</p>}
                  <span className="text-xs text-slate-400 ml-0 block mt-1 dark:text-slate-500">{combos.length} preset combination{combos.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center gap-3">
                  {canEdit && (
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(t); }} className="text-slate-400 hover:text-red-600 transition dark:text-slate-500 dark:hover:text-red-400" title="Delete track">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <ChevronRight className={`w-4 h-4 text-slate-300 dark:text-slate-600 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                </div>
              </div>
              {expanded && (
                <TrackCombinationsPanel track={t} combos={combos} subjects={subjects} canEdit={canEdit} onChanged={onChanged} />
              )}
            </div>
          );
        })}
        {tracks.length === 0 && (
          <div className="text-slate-400 p-10 text-center text-sm dark:text-slate-500">
            No tracks yet under {pathway.name} — tracks subdivide a pathway's subject offering (e.g. STEM's Pure Sciences vs Technical Studies). Not every pathway needs them.
          </div>
        )}
      </div>

      {canEdit && (
        adding ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-3 dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">New Track</h3>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Pure Sciences" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400 dark:focus:ring-indigo-400" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional) — what this track covers, where it leads" rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-y dark:border-slate-700 dark:focus:border-indigo-400 dark:focus:ring-indigo-400" />
            <label className="text-xs block">
              <span className="block text-slate-500 font-bold mb-1 dark:text-slate-400">Display order</span>
              <input type="number" value={displayOrder} onChange={(e) => setDisplayOrder(Number(e.target.value))} className="w-full sm:w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400" />
            </label>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="flex items-center gap-2 text-sm font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-400">
            <Plus className="w-4 h-4" /> Add Track
          </button>
        )
      )}

      <p className="text-xs text-slate-400 italic dark:text-slate-500">Once a track exists here, it becomes selectable on this Pathway's Presets and on students' Pathway choice screen.</p>
    </div>
  );
}

// ==========================================
// TRACK PRESET COMBINATIONS PANEL
// ==========================================
// The official KNEC 3-subject combination catalog for one Track — deliberately separate
// from the Presets tab's CurriculumPreset/SubjectPool builder (see PresetCombination's
// model docstring): this is the fixed pre-approved-triple list students pick ONE of,
// not a flexible pick-N-from-a-pool structure.

function TrackCombinationsPanel({ track, combos, subjects, canEdit, onChanged }: {
  track: Track; combos: PresetCombination[]; subjects: SubjectOption[]; canEdit: boolean; onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const toggleSubject = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 3) {
        next.add(id);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    if (selected.size !== 3) {
      toast.error('Pick exactly 3 subjects.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/core/curriculum/preset-combinations/', {
        track: track.id, name: name.trim(), subjects: Array.from(selected),
      });
      toast.success('Combination created.');
      setName(''); setSelected(new Set()); setAdding(false);
      onChanged();
    } catch (error: any) {
      const data = error?.response?.data;
      toast.error(data?.subjects?.[0] || data?.detail || 'Failed to create combination.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (combo: PresetCombination) => {
    if (!window.confirm(`Delete combination '${combo.display_name}'?`)) return;
    try {
      await api.delete(`/api/core/curriculum/preset-combinations/${combo.id}/`);
      toast.success('Combination deleted.');
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to delete combination.');
    }
  };

  const handleToggleActive = async (combo: PresetCombination) => {
    try {
      await api.patch(`/api/core/curriculum/preset-combinations/${combo.id}/`, { is_active: !combo.is_active });
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to update combination.');
    }
  };

  return (
    <div className="px-6 pb-5 pl-10 bg-slate-50/60 space-y-2 dark:bg-slate-800/40">
      {combos.length === 0 && !adding && (
        <p className="text-xs text-slate-400 italic py-2 dark:text-slate-500">No preset combinations yet for this track.</p>
      )}
      {combos.map((c) => (
        <div key={c.id} className="flex items-center justify-between bg-white rounded-lg border border-slate-100 px-4 py-2.5 dark:bg-slate-900 dark:border-slate-700">
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{c.display_name}</span>
            {!c.is_active && <span className="ml-2 text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded dark:text-slate-500 dark:bg-slate-800">Retired</span>}
            {c.code && <span className="ml-2 text-xs text-slate-300 font-mono dark:text-slate-600">{c.code}</span>}
          </div>
          {canEdit && (
            <div className="flex items-center gap-3">
              <button onClick={() => handleToggleActive(c)} className="text-xs font-semibold text-slate-500 hover:text-indigo-600 transition dark:text-slate-400 dark:hover:text-indigo-400">
                {c.is_active ? 'Retire' : 'Reactivate'}
              </button>
              <button onClick={() => handleDelete(c)} className="text-slate-400 hover:text-red-600 transition dark:text-slate-500 dark:hover:text-red-400" title="Delete combination">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}

      {canEdit && (
        adding ? (
          <div className="bg-white rounded-lg border border-slate-100 p-4 space-y-3 dark:bg-slate-900 dark:border-slate-700">
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Display name (optional — auto-derived from subjects if left blank)"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400 dark:focus:ring-indigo-400"
            />
            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5 dark:text-slate-400">Pick exactly 3 subjects ({selected.size}/3)</p>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {subjects.map((s) => {
                  const checked = selected.has(s.id);
                  const disabled = !checked && selected.size >= 3;
                  return (
                    <button
                      type="button" key={s.id} disabled={disabled} onClick={() => toggleSubject(s.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                        checked ? 'bg-indigo-100 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-400'
                        : disabled ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'
                      }`}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setAdding(false); setSelected(new Set()); setName(''); }} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="flex items-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-700 pt-1 dark:text-indigo-400 dark:hover:text-indigo-400">
            <Plus className="w-3.5 h-3.5" /> Add Combination
          </button>
        )
      )}
      <p className="text-[11px] text-slate-400 italic pt-1 dark:text-slate-500">
        Only official KNEC-approved 3-subject combinations belong here — for the school's own flexible
        elective pools, use the Presets tab instead.
      </p>
    </div>
  );
}

// ==========================================
// TIERS TAB
// ==========================================

type TierForm = {
  id?: number; curriculum: number | ''; name: string; code: string; display_order: number;
  exit_exam_code: string; exit_is_terminal: boolean;
};
const emptyTierForm = (): TierForm => ({
  curriculum: '', name: '', code: '', display_order: 0, exit_exam_code: '', exit_is_terminal: false,
});

function TiersTab({ tiers, curricula, canEdit, onChanged, onOpenTier }: {
  tiers: Tier[]; curricula: Curriculum[]; canEdit: boolean; onChanged: () => void; onOpenTier: (tier: Tier) => void;
}) {
  const [editing, setEditing] = useState<TierForm | null>(null);
  const [saving, setSaving] = useState(false);

  const curriculumName = (id: number) => curricula.find((c) => c.id === id)?.name ?? 'Unknown';

  const handleSave = async () => {
    if (!editing || !editing.curriculum || !editing.name.trim() || !editing.code.trim()) {
      toast.error('Curriculum, name, and code are required.');
      return;
    }
    setSaving(true);
    const payload = {
      curriculum: editing.curriculum, name: editing.name.trim(), code: editing.code.trim(), display_order: editing.display_order,
      exit_exam_code: editing.exit_exam_code, exit_is_terminal: editing.exit_is_terminal,
    };
    try {
      if (editing.id) {
        await api.put(`/api/core/curriculum/tiers/${editing.id}/`, payload);
        toast.success(`Tier '${editing.name}' updated.`);
      } else {
        await api.post('/api/core/curriculum/tiers/', payload);
        toast.success(`Tier '${editing.name}' created.`);
      }
      setEditing(null);
      onChanged();
    } catch (error: any) {
      const data = error?.response?.data;
      toast.error(data?.curriculum?.[0] || data?.detail || data?.code?.[0] || data?.name?.[0] || 'Failed to save tier.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e: MouseEvent, tier: Tier) => {
    e.stopPropagation();
    if (!window.confirm(`Delete tier '${tier.name}'?`)) return;
    try {
      await api.delete(`/api/core/curriculum/tiers/${tier.id}/`);
      toast.success('Tier deleted.');
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to delete tier.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:divide-slate-800 dark:shadow-none">
        {tiers.map((t) => (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpenTier(t)}
            onKeyDown={(e) => { if (e.key === 'Enter') onOpenTier(t); }}
            title="Open this tier's configuration"
            className="w-full text-left px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer dark:hover:bg-slate-800/40"
          >
            <div>
              <span className="font-semibold text-slate-800 text-sm dark:text-slate-100">{t.name}</span>
              <span className="text-xs text-slate-400 ml-2 font-mono dark:text-slate-500">{t.code}</span>
              <span className="text-xs text-slate-400 ml-2 dark:text-slate-500">{curriculumName(t.curriculum)}</span>
            </div>
            <div className="flex items-center gap-3">
              {canEdit && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditing({
                      id: t.id, curriculum: t.curriculum, name: t.name, code: t.code, display_order: t.display_order,
                      exit_exam_code: t.exit_exam_code, exit_is_terminal: t.exit_is_terminal,
                    }); }}
                    className="text-slate-400 hover:text-indigo-600 transition dark:text-slate-500 dark:hover:text-indigo-400"
                    title="Edit tier"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => handleDelete(e, t)} className="text-slate-400 hover:text-red-600 transition dark:text-slate-500 dark:hover:text-red-400" title="Delete tier">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
              <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
            </div>
          </div>
        ))}
        {tiers.length === 0 && <div className="text-slate-400 p-10 text-center text-sm dark:text-slate-500">No tiers yet — a tier is an optional stage split within a curriculum (e.g. CBC's Junior/Senior Secondary). Curricula that don't split into stages don't need any.</div>}
      </div>

      {canEdit && !editing && (
        <button onClick={() => setEditing(emptyTierForm())} className="flex items-center gap-2 text-sm font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-400">
          <Plus className="w-4 h-4" /> Add Tier
        </button>
      )}

      {canEdit && editing && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-3 dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{editing.id ? 'Edit Tier' : 'New Tier'}</h3>
            <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300" title="Close"><X className="w-4 h-4" /></button>
          </div>
          <select aria-label="Curriculum" value={editing.curriculum} onChange={(e) => setEditing({ ...editing, curriculum: e.target.value ? Number(e.target.value) : '' })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400 dark:focus:ring-indigo-400">
            <option value="">Select curriculum...</option>
            {curricula.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Name, e.g. Junior Secondary" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400 dark:focus:ring-indigo-400" />
          <input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} placeholder="Code, e.g. JSS" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400 dark:focus:ring-indigo-400" />
          <label className="text-xs block">
            <span className="block text-slate-500 font-bold mb-1 dark:text-slate-400">Display order</span>
            <input type="number" value={editing.display_order} onChange={(e) => setEditing({ ...editing, display_order: Number(e.target.value) })} className="w-full sm:w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400" />
          </label>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <label className="text-xs block">
              <span className="block text-slate-500 font-bold mb-1 dark:text-slate-400">Exit requirement (national exam)</span>
              <select
                aria-label="Exit exam code"
                value={editing.exit_exam_code}
                onChange={(e) => setEditing({ ...editing, exit_exam_code: e.target.value, exit_is_terminal: e.target.value ? editing.exit_is_terminal : false })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="">None — plain internal promotion</option>
                <option value="KPSEA">KPSEA</option>
                <option value="KJSEA">KJSEA</option>
                <option value="KCSE">KCSE</option>
              </select>
            </label>
            {editing.exit_exam_code && (
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={editing.exit_is_terminal}
                  onChange={(e) => setEditing({ ...editing, exit_is_terminal: e.target.checked })}
                />
                Student leaves this school on exit (cross-institution or terminal — e.g. KJSEA/KCSE). Leave unchecked for a same-institution exam like KPSEA.
              </label>
            )}
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving...' : editing.id ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// PRESETS TAB
// ==========================================

function PresetsTab({ presets, curricula, pathways, tracks, tiers, subjects, subjectProfiles, presetCombinations, departments, canEdit, onChanged, openPresetId, onOpenPresetHandled }: {
  presets: CurriculumPreset[]; curricula: Curriculum[]; pathways: Pathway[]; tracks: Track[]; tiers: Tier[]; subjects: SubjectOption[];
  subjectProfiles: SubjectCurriculumProfile[]; presetCombinations: PresetCombination[]; departments: DepartmentOption[];
  canEdit: boolean; onChanged: () => void;
  openPresetId?: number | null; onOpenPresetHandled?: () => void;
}) {
  const [editing, setEditing] = useState<CurriculumPreset | Omit<CurriculumPreset, 'id'> | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void }>({
    isOpen: false, title: '', message: '', onConfirm: () => {},
  });

  // Jumped here from a Tier/Curriculum detail view's "open this preset" click — go straight
  // into editing it instead of leaving the admin to find it again in the flat table below.
  useEffect(() => {
    if (openPresetId == null) return;
    const preset = presets.find((p) => p.id === openPresetId);
    if (preset) setEditing(preset);
    onOpenPresetHandled?.();
  }, [openPresetId]);

  const curriculumName = (id: number | null) => curricula.find((c) => c.id === id)?.name ?? 'Uncategorized';

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({ isOpen: true, title, message, onConfirm: () => { onConfirm(); setConfirmDialog((p) => ({ ...p, isOpen: false })); } });
  };

  const handleDelete = (preset: CurriculumPreset) => {
    triggerConfirm('Delete preset?', `Delete preset '${preset.name}'? This can't be undone.`, async () => {
      try {
        await api.delete(`/api/core/curriculum/presets/${preset.id}/`);
        toast.success('Preset deleted.');
        onChanged();
      } catch (error: any) {
        toast.error(error?.response?.data?.detail || 'Failed to delete preset.');
      }
    });
  };

  const handleSave = async () => {
    if (!editing || !editing.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    setSaving(true);
    const payload = {
      ...editing,
      pools: editing.pools.map((pool) => ({ ...pool, subjects: pool.subjects })),
    };
    try {
      if ('id' in editing) {
        await api.put(`/api/core/curriculum/presets/${editing.id}/`, payload);
        toast.success(`Preset '${editing.name}' updated.`);
      } else {
        await api.post('/api/core/curriculum/presets/', payload);
        toast.success(`Preset '${editing.name}' created.`);
      }
      setEditing(null);
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to save preset.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-100 bg-slate-50 dark:text-slate-500 dark:border-slate-700 dark:bg-slate-800/40">
              <th className="px-6 py-3 font-bold">Preset</th>
              <th className="px-6 py-3 font-bold">Curriculum / Tier</th>
              <th className="px-6 py-3 font-bold">Min - Max</th>
              <th className="px-6 py-3 font-bold">Pools</th>
              <th className="px-6 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-sm text-slate-700 divide-y divide-slate-50 dark:text-slate-200 dark:divide-slate-800">
            {presets.map((p) => (
              <tr
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => setEditing(p)}
                onKeyDown={(e) => { if (e.key === 'Enter') setEditing(p); }}
                title="Open this preset"
                className="hover:bg-slate-50 transition-colors cursor-pointer dark:hover:bg-slate-800/40"
              >
                <td className="px-6 py-4 font-semibold text-slate-800 dark:text-slate-100">{p.name}</td>
                <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400">
                  {curriculumName(p.curriculum)}{p.tier ? ` · ${tiers.find((t) => t.id === p.tier)?.code ?? ''}` : ''}{p.pathway ? ` · ${pathways.find((pw) => pw.id === p.pathway)?.name ?? ''}` : ''}{p.track ? ` · ${tracks.find((t) => t.id === p.track)?.name ?? ''}` : ''}
                </td>
                <td className="px-6 py-4">{p.min_subjects} - {p.max_subjects}</td>
                <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400">{p.pools.length > 0 ? p.pools.map((pool) => POOL_TYPE_LABELS[pool.pool_type]).join(', ') : '—'}</td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end items-center gap-3">
                    {canEdit && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); setEditing(p); }} className="text-slate-400 hover:text-indigo-600 transition dark:text-slate-500 dark:hover:text-indigo-400" title="Edit preset"><Pencil className="w-4 h-4" /></button>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(p); }} className="text-slate-400 hover:text-red-600 transition dark:text-slate-500 dark:hover:text-red-400" title="Delete preset"><Trash2 className="w-4 h-4" /></button>
                      </>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                  </div>
                </td>
              </tr>
            ))}
            {presets.length === 0 && (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400 dark:text-slate-500">No presets yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && !editing && (
        <button onClick={() => setEditing(emptyPreset())} className="flex items-center gap-2 text-sm font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-400">
          <Plus className="w-4 h-4" /> Add Preset
        </button>
      )}

      {editing && (
        <PresetEditorPanel
          preset={editing}
          curricula={curricula}
          pathways={pathways}
          tracks={tracks}
          tiers={tiers}
          subjects={subjects}
          subjectProfiles={subjectProfiles}
          presetCombinations={presetCombinations}
          departments={departments}
          saving={saving}
          onChange={setEditing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center dark:bg-slate-900 dark:shadow-none">
            <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4 dark:text-red-400" />
            <h3 className="text-xl font-black mb-2 text-slate-800 dark:text-slate-100">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed dark:text-slate-400">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDialog((p) => ({ ...p, isOpen: false }))} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/40">Cancel</button>
              <button onClick={confirmDialog.onConfirm} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PresetEditorPanel({ preset, curricula, pathways, tracks, tiers, subjects, subjectProfiles, presetCombinations, departments, saving, onChange, onSave, onCancel }: {
  preset: CurriculumPreset | Omit<CurriculumPreset, 'id'>;
  curricula: Curriculum[]; pathways: Pathway[]; tracks: Track[]; tiers: Tier[]; subjects: SubjectOption[];
  subjectProfiles: SubjectCurriculumProfile[]; presetCombinations: PresetCombination[]; departments: DepartmentOption[];
  saving: boolean;
  onChange: (p: any) => void; onSave: () => void; onCancel: () => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const availableTiers = tiers.filter((t) => t.curriculum === preset.curriculum);
  const availablePathways = pathways.filter((pw) => pw.curriculum === preset.curriculum);
  const availableTracks = tracks.filter((t) => t.pathway === preset.pathway);

  const selectedCurriculumObj = curricula.find(c => c.id === preset.curriculum);
  const isCBC = selectedCurriculumObj?.code === 'CBC';
  const selectedTierObj = availableTiers.find(t => t.id === preset.tier);

  // For CBC, Pathway is only available in Senior Secondary.
  const showPathway = !isCBC || (isCBC && selectedTierObj?.name?.toLowerCase().includes('senior secondary'));

  // "Pathway Core" as a Pool Type only makes sense for a CBC Senior Secondary tier — a tier
  // whose subjects are all core (no pathway split, e.g. JSS) has nothing for it to scope.
  const pathwayCoreAllowed = isCBC && !!selectedTierObj?.name?.toLowerCase().includes('senior secondary');

  // Subjects assigned to the selected curriculum and tier explicitly.
  const eligibleSubjects = preset.curriculum == null ? subjects : subjects.filter((s) => {
    return subjectProfiles.some((p) => 
      p.subject === s.id &&
      p.curriculum === preset.curriculum && 
      (preset.tier ? p.tier === preset.tier : true)
    );
  });

  const addPool = () => {
    onChange({ ...preset, pools: [...preset.pools, { pool_type: 'CORE_COMPULSORY', min_subjects: 1, max_subjects: 1, subjects: [], pathway: null, track: null, combinations: [] }] });
  };

  const updatePool = (index: number, patch: Partial<SubjectPool>) => {
    const pools = preset.pools.map((pool, i) => (i === index ? { ...pool, ...patch } : pool));
    onChange({ ...preset, pools });
  };

  const removePool = (index: number) => {
    onChange({ ...preset, pools: preset.pools.filter((_, i) => i !== index) });
  };

  const toggleSubject = (index: number, subjectId: number) => {
    const pool = preset.pools[index];
    const has = pool.subjects.includes(subjectId);
    updatePool(index, { subjects: has ? pool.subjects.filter((id) => id !== subjectId) : [...pool.subjects, subjectId] });
  };

  // Pathway/Track scoping is only meaningful on a Pathway Core pool, and only once the
  // preset's Tier is Senior Secondary (same showPathway gate the preset-level selector uses).
  const isPoolPathwayScoped = (pool: SubjectPool) => showPathway && pool.pool_type === 'PATHWAY_CORE';

  // A Pathway Core pool holds combinations from every pathway/track in the curriculum at
  // once (SubjectPool.combinations) — no need for one pool per pathway/track. Per-student
  // narrowing happens server-side (_pool_subjects_for_student) by matching each ticked
  // combo's own track against the student's approved track.
  const isComboTicked = (pool: SubjectPool, combo: PresetCombination) => pool.combinations.includes(combo.id);

  const toggleCombo = (index: number, pool: SubjectPool, combo: PresetCombination) => {
    const nextCombinations = isComboTicked(pool, combo)
      ? pool.combinations.filter((id) => id !== combo.id)
      : [...pool.combinations, combo.id];
    const nextCombos = presetCombinations.filter((c) => nextCombinations.includes(c.id));
    updatePool(index, {
      combinations: nextCombinations,
      subjects: Array.from(new Set(nextCombos.flatMap((c) => c.subjects))),
    });
  };

  // Every active combination in the preset's curriculum — not scoped to one track, since a
  // single pool now covers every pathway/track at once.
  const curriculumCombos = presetCombinations.filter(
    (c) => c.is_active && pathways.find((pw) => pw.id === c.pathway)?.curriculum === preset.curriculum,
  );

  const groupCombosByPathwayTrack = (combos: PresetCombination[]): [string, PresetCombination[]][] => {
    const map = new Map<string, PresetCombination[]>();
    for (const c of combos) {
      const trackName = tracks.find((t) => t.id === c.track)?.name ?? 'Track';
      const key = `${c.pathway_name} — ${trackName}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries());
  };

  const subjectDepartmentName = (subjectId: number): string => {
    const profile = subjectProfiles.find((p) =>
      p.subject === subjectId && p.curriculum === preset.curriculum && (preset.tier ? p.tier === preset.tier : true)
    );
    const dept = profile?.department != null ? departments.find((d) => d.id === profile.department) : undefined;
    return dept?.name ?? 'Uncategorized';
  };

  const groupByDepartment = (subjectList: SubjectOption[]): [string, SubjectOption[]][] => {
    const map = new Map<string, SubjectOption[]>();
    for (const s of subjectList) {
      const name = subjectDepartmentName(s.id);
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return a.localeCompare(b);
    });
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 p-6 space-y-4 dark:bg-slate-900 dark:border-indigo-500/20 dark:shadow-none">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{'id' in preset ? 'Edit Preset' : 'New Preset'}</h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300" title="Close"><X className="w-4 h-4" /></button>
      </div>

      <input value={preset.name} onChange={(e) => onChange({ ...preset, name: e.target.value })} placeholder="Name, e.g. CBC SSS - STEM" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400 dark:focus:ring-indigo-400" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="text-xs">
          <span className="block text-slate-500 font-bold mb-1 dark:text-slate-400">Min subjects</span>
          <input type="number" min={1} value={preset.min_subjects} onChange={(e) => onChange({ ...preset, min_subjects: Number(e.target.value) })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400" />
        </label>
        <label className="text-xs">
          <span className="block text-slate-500 font-bold mb-1 dark:text-slate-400">Max subjects</span>
          <input type="number" min={1} value={preset.max_subjects} onChange={(e) => onChange({ ...preset, max_subjects: Number(e.target.value) })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400" />
        </label>
        <label className="text-xs">
          <span className="block text-slate-500 font-bold mb-1 dark:text-slate-400">Curriculum</span>
          <select aria-label="Curriculum" value={preset.curriculum ?? ''} onChange={(e) => onChange({ ...preset, curriculum: e.target.value ? Number(e.target.value) : null, tier: null, pathway: null, track: null })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400">
            <option value="">Uncategorized</option>
            {curricula.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-slate-500 font-bold mb-1 dark:text-slate-400">Tier</span>
          <select aria-label="Tier" value={preset.tier ?? ''} disabled={availableTiers.length === 0} onChange={(e) => onChange({ ...preset, tier: e.target.value ? Number(e.target.value) : null })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-700 dark:focus:border-indigo-400">
            <option value="">—</option>
            {availableTiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>

      {availablePathways.length > 0 && showPathway && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs block">
            <span className="block text-slate-500 font-bold mb-1 dark:text-slate-400">Pathway (optional)</span>
            <select aria-label="Pathway" value={preset.pathway ?? ''} onChange={(e) => onChange({ ...preset, pathway: e.target.value ? Number(e.target.value) : null, track: null })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400">
              <option value="">None</option>
              {availablePathways.map((pw) => <option key={pw.id} value={pw.id}>{pw.name}</option>)}
            </select>
          </label>
          <label className="text-xs block">
            <span className="block text-slate-500 font-bold mb-1 dark:text-slate-400">Track (optional)</span>
            <select aria-label="Track" value={preset.track ?? ''} disabled={!preset.pathway || availableTracks.length === 0} onChange={(e) => onChange({ ...preset, track: e.target.value ? Number(e.target.value) : null })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-700 dark:focus:border-indigo-400">
              <option value="">None</option>
              {availableTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="border-t border-slate-100 pt-4 space-y-3 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider dark:text-slate-200">Subject Pools</h4>
          <button onClick={addPool} className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-400"><Plus className="w-3.5 h-3.5" /> Add Pool</button>
        </div>
        {preset.pools.length === 0 && <p className="text-xs text-slate-400 italic dark:text-slate-500">No pools yet — pools group subjects into Core Compulsory / Pathway Core / Guided Elective buckets, each with its own pick count.</p>}
        {preset.pools.map((pool, index) => {
          const poolPathwayScoped = isPoolPathwayScoped(pool);

          return (
          <div key={index} className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3 dark:bg-slate-800/40 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <select
                aria-label="Pool type"
                value={pool.pool_type}
                onChange={(e) => {
                  const pool_type = e.target.value as SubjectPool['pool_type'];
                  updatePool(index, pool_type === 'PATHWAY_CORE' ? { pool_type } : { pool_type, pathway: null, track: null });
                }}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400"
              >
                {(Object.keys(POOL_TYPE_LABELS) as SubjectPool['pool_type'][])
                  .filter(key => key !== 'PATHWAY_CORE' || pathwayCoreAllowed)
                  .map((key) => <option key={key} value={key}>{POOL_TYPE_LABELS[key]}</option>)}
              </select>
              <input type="number" min={0} aria-label="Pool min" value={pool.min_subjects} onChange={(e) => updatePool(index, { min_subjects: Number(e.target.value) })} className="w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400" />
              <span className="text-slate-400 text-xs dark:text-slate-500">to</span>
              <input type="number" min={0} aria-label="Pool max" value={pool.max_subjects} onChange={(e) => updatePool(index, { max_subjects: Number(e.target.value) })} className="w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400" />
              <button onClick={() => removePool(index)} className="text-slate-400 hover:text-red-600 dark:text-slate-500 dark:hover:text-red-400" title="Remove pool"><Trash2 className="w-4 h-4" /></button>
            </div>

            {poolPathwayScoped && curriculumCombos.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                <p className="text-[11px] text-slate-400 dark:text-slate-500">Tick which of the dossier's official combinations your school offers, one pathway/track at a time — this single pool covers every pathway, so building the whole Senior Secondary preset here never needs a second pool.</p>
                {groupCombosByPathwayTrack(curriculumCombos).map(([groupName, combos]) => {
                  const tickedCount = combos.filter((combo) => isComboTicked(pool, combo)).length;
                  const isExpanded = expandedGroups.has(groupName);
                  return (
                    <div key={groupName} className="border border-slate-100 dark:border-slate-700 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleGroup(groupName)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{groupName}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          {tickedCount > 0 && (
                            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 rounded-full">{tickedCount}/{combos.length} selected</span>
                          )}
                          <ChevronRight className={`w-3.5 h-3.5 text-slate-400 dark:text-slate-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="space-y-1.5 p-2">
                          {combos.map((combo) => {
                            const ticked = isComboTicked(pool, combo);
                            return (
                              <button
                                key={combo.id}
                                type="button"
                                onClick={() => toggleCombo(index, pool, combo)}
                                className={`w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition ${ticked ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/40' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'}`}
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  {ticked ? <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0 dark:text-indigo-400" /> : <Circle className="w-4 h-4 text-slate-300 shrink-0 dark:text-slate-600" />}
                                  <span className="text-sm font-medium text-slate-700 truncate dark:text-slate-200">{combo.display_name}</span>
                                </span>
                                {combo.code && <span className="text-[11px] text-slate-400 font-mono shrink-0 dark:text-slate-500">{combo.code}</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : poolPathwayScoped ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                <p className="text-[11px] text-amber-600 italic dark:text-amber-400">No KNEC combination catalog yet for this curriculum — showing all eligible subjects.</p>
                {groupByDepartment(eligibleSubjects).map(([deptName, deptSubjects]) => {
                  const accent = deptAccent(deptName);
                  return (
                    <div key={deptName} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${accent.border}` }}>
                      <div className="px-3 py-1.5" style={{ background: accent.bg }}>
                        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: accent.text }}>{deptName}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 p-2">
                        {deptSubjects.map((s) => {
                          const checked = pool.subjects.includes(s.id);
                          return (
                            <button
                              key={s.id}
                              onClick={() => toggleSubject(index, s.id)}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${checked ? 'bg-indigo-100 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-400' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'}`}
                            >
                              {s.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                {eligibleSubjects.map((s) => {
                  const checked = pool.subjects.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleSubject(index, s.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${checked ? 'bg-indigo-100 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-400' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'}`}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          );
        })}
      </div>

      <div className="flex gap-3 justify-end border-t border-slate-100 pt-4 dark:border-slate-700">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
        <button onClick={onSave} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Preset'}
        </button>
      </div>
    </div>
  );
}

// ==========================================
// TIER DETAIL VIEW
// ==========================================
// Opened by clicking a Tier in the Tiers tab. This is the tier-scoped configuration
// surface: every component that's tier-aware gets a section here, starting with Grades
// (which grades currently belong to this tier, and assigning/removing them), so admins
// configure each component according to how the tier actually functions instead of
// hunting through a flat, curriculum-wide tab.

function TierDetailView({ tier, curricula, grades, subjects, subjectProfiles, departments, presets, canEdit, canEditSubjects, onBack, onChanged, onOpenPreset }: {
  tier: Tier; curricula: Curriculum[]; grades: GradeSummary[];
  subjects: SubjectOption[]; subjectProfiles: SubjectCurriculumProfile[]; departments: DepartmentOption[];
  presets: CurriculumPreset[];
  canEdit: boolean; canEditSubjects: boolean;
  onBack: () => void; onChanged: () => void; onOpenPreset: (preset: CurriculumPreset) => void;
}) {
  const [savingId, setSavingId] = useState<number | null>(null);
  const [section, setSection] = useState<'grades' | 'subjects' | 'presets'>('grades');

  const curriculumName = curricula.find((c) => c.id === tier.curriculum)?.name ?? 'Unknown';
  const scopedGrades = grades.filter((g) => g.curriculum_id === tier.curriculum);

  const handleToggle = async (grade: GradeSummary, assign: boolean) => {
    setSavingId(grade.id);
    try {
      await api.put(`/api/academic-hub/edit-grade/${grade.id}/`, {
        curriculum_id: tier.curriculum, tier_id: assign ? tier.id : null,
      });
      toast.success(`'${grade.grade_name}' ${assign ? `assigned to ${tier.name}` : `removed from ${tier.name}`}.`);
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to update grade.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700 transition dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="w-4 h-4" /> Back to Tiers
      </button>

      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-500/10">
          <Rows3 className="w-6 h-6" strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 dark:text-slate-100">{tier.name}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{curriculumName} &middot; <span className="font-mono">{tier.code}</span></p>
        </div>
      </div>

      <div className="flex bg-white rounded-lg p-1 shadow-sm border border-slate-100 w-max flex-wrap dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
        <button onClick={() => setSection('grades')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${section === 'grades' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
          <GraduationCap className="w-4 h-4" /> Grades
        </button>
        <button onClick={() => setSection('subjects')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${section === 'subjects' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
          <BookMarked className="w-4 h-4" /> Subjects
        </button>
        <button onClick={() => setSection('presets')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${section === 'presets' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
          <Sparkles className="w-4 h-4" /> Presets
        </button>
      </div>

      {section === 'grades' && (
        <>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
            <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2 dark:border-slate-700 dark:bg-slate-800/40">
              <GraduationCap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Grades</h3>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-100 bg-slate-50 dark:text-slate-500 dark:border-slate-700 dark:bg-slate-800/40">
                  <th className="px-6 py-3 font-bold">Grade</th>
                  <th className="px-6 py-3 font-bold">Streams</th>
                  <th className="px-6 py-3 font-bold">Status</th>
                  <th className="px-6 py-3 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="text-sm text-slate-700 divide-y divide-slate-50 dark:text-slate-200 dark:divide-slate-800">
                {scopedGrades.map((g) => {
                  const inThisTier = g.tier_id === tier.id;
                  return (
                    <tr key={g.id} className="hover:bg-slate-50 transition-colors dark:hover:bg-slate-800/40">
                      <td className="px-6 py-4 font-semibold text-slate-800 dark:text-slate-100">{g.grade_name}</td>
                      <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400">{g.total_streams}</td>
                      <td className="px-6 py-4">
                        {inThisTier ? (
                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/40">In this tier</span>
                        ) : g.tier_id ? (
                          <span className="text-xs text-slate-400 dark:text-slate-500">In another tier</span>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">Unassigned</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {canEdit && (
                          <button
                            onClick={() => handleToggle(g, !inThisTier)}
                            disabled={savingId === g.id}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50 ${
                              inThisTier ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10' : 'text-white bg-indigo-600 hover:bg-indigo-700'
                            }`}
                          >
                            {savingId === g.id ? 'Saving...' : inThisTier ? 'Remove' : 'Assign here'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {scopedGrades.length === 0 && (
                  <tr><td colSpan={4} className="p-8 text-center text-slate-400 dark:text-slate-500">No grades under {curriculumName} yet — create one from Academic Hub.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {!canEdit && (
            <p className="text-xs text-slate-400 dark:text-slate-500">Requires classes.edit to assign or remove a grade from this tier.</p>
          )}
        </>
      )}

      {section === 'subjects' && (
        <SubjectAssignmentSection
          subjects={subjects}
          subjectProfiles={subjectProfiles}
          departments={departments}
          curriculumId={tier.curriculum}
          tierId={tier.id}
          canEdit={canEditSubjects}
          onChanged={onChanged}
        />
      )}

      {section === 'presets' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:divide-slate-800 dark:shadow-none">
          {presets.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenPreset(p)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpenPreset(p); }}
              title="Open this preset"
              className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer dark:hover:bg-slate-800/40"
            >
              <div>
                <span className="font-semibold text-slate-800 text-sm dark:text-slate-100">{p.name}</span>
                <span className="text-xs text-slate-400 ml-2 dark:text-slate-500">{p.min_subjects} - {p.max_subjects} subjects &middot; {p.pools.length} pool{p.pools.length !== 1 ? 's' : ''}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
            </div>
          ))}
          {presets.length === 0 && (
            <div className="text-slate-400 p-10 text-center text-sm dark:text-slate-500">No presets scoped to {tier.name} yet — add one from the Presets tab.</div>
          )}
        </div>
      )}

      <p className="text-xs text-slate-400 italic dark:text-slate-500">More tier-scoped components (allocations, timetable rules, and beyond) will appear here as their own tab.</p>
    </div>
  );
}

// ==========================================
// CURRICULUM DETAIL VIEW
// ==========================================
// Opened by clicking a Curriculum in the Curricula tab. Everything scoped to this one
// curriculum lives here — its tiers, pathways, presets, grades and subject assignments —
// so admins get a full picture instead of being dropped straight into a bare subjects list.

type CurriculumSection = 'overview' | 'tiers' | 'pathways' | 'presets' | 'subjects' | 'departments';

function CurriculumDetailView({
  curriculum, curricula, tiers, pathways, presets, grades, subjects, subjectProfiles, departments, canEdit,
  onBack, onChanged, onOpenTier, onOpenPathway, onGoToPresets, onOpenPreset,
}: {
  curriculum: Curriculum; curricula: Curriculum[]; tiers: Tier[]; pathways: Pathway[]; presets: CurriculumPreset[]; grades: GradeSummary[];
  subjects: SubjectOption[]; subjectProfiles: SubjectCurriculumProfile[]; departments: DepartmentOption[]; canEdit: boolean;
  onBack: () => void; onChanged: () => void;
  onOpenTier: (tier: Tier) => void; onOpenPathway: (pathway: Pathway) => void; onGoToPresets: () => void;
  onOpenPreset: (preset: CurriculumPreset) => void;
}) {
  const [section, setSection] = useState<CurriculumSection>('overview');
  const [isDepartmentModalOpen, setDepartmentModalOpen] = useState(false);
  const [departmentToEdit, setDepartmentToEdit] = useState<DepartmentOption | null>(null);

  const handleOpenDepartmentModal = (dept: DepartmentOption | null = null) => {
    setDepartmentToEdit(dept);
    setDepartmentModalOpen(true);
  };
  const assignedSubjectCount = new Set(subjectProfiles.filter((p) => p.curriculum === curriculum.id).map((p) => p.subject)).size;

  const sectionTabs: { key: CurriculumSection; label: string; icon: typeof Layers }[] = [
    { key: 'overview', label: 'Overview', icon: Layers },
    { key: 'tiers', label: 'Tiers', icon: Rows3 },
    { key: 'pathways', label: 'Pathways', icon: GitBranch },
    { key: 'presets', label: 'Presets', icon: Sparkles },
    { key: 'subjects', label: 'Subjects', icon: BookMarked },
    { key: 'departments', label: 'Departments', icon: Building2 as any },
  ];

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700 transition dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="w-4 h-4" /> Back to Curricula
      </button>

      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-500/10">
          <Layers className="w-6 h-6" strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 dark:text-slate-100">{curriculum.name}</h2>
          <p className="text-sm text-slate-500 font-mono dark:text-slate-400">{curriculum.code}</p>
        </div>
      </div>

      <div className="flex bg-white rounded-lg p-1 shadow-sm border border-slate-100 w-max flex-wrap dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
        {sectionTabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${section === key ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {section === 'overview' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Tiers', value: tiers.length },
            { label: 'Grades', value: grades.length },
            { label: 'Pathways', value: pathways.length },
            { label: 'Presets', value: presets.length },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
              <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{value}</div>
              <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mt-1 dark:text-slate-500">{label}</div>
            </div>
          ))}
          <div className="col-span-2 sm:col-span-4 bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-sm text-slate-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400 dark:shadow-none">
            <span className="font-semibold text-slate-700 dark:text-slate-200">{assignedSubjectCount}</span> subject{assignedSubjectCount === 1 ? '' : 's'} assigned to this curriculum so far. Use the tabs above to manage its tiers, pathways, presets, and subject assignments.
          </div>
        </div>
      )}

      {section === 'tiers' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:divide-slate-800 dark:shadow-none">
          {tiers.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenTier(t)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpenTier(t); }}
              title="Open this tier's configuration"
              className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer dark:hover:bg-slate-800/40"
            >
              <div>
                <span className="font-semibold text-slate-800 text-sm dark:text-slate-100">{t.name}</span>
                <span className="text-xs text-slate-400 ml-2 font-mono dark:text-slate-500">{t.code}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
            </div>
          ))}
          {tiers.length === 0 && (
            <div className="text-slate-400 p-10 text-center text-sm dark:text-slate-500">
              No tiers under {curriculum.name} yet — add one from the Tiers tab if this curriculum splits into stages (e.g. CBC's Lower/Upper Primary, Junior/Senior Secondary).
            </div>
          )}
        </div>
      )}

      {section === 'pathways' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:divide-slate-800 dark:shadow-none">
          {pathways.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenPathway(p)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpenPathway(p); }}
              title="Open this pathway's tracks"
              className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer dark:hover:bg-slate-800/40"
            >
              <div>
                <span className="font-semibold text-slate-800 text-sm dark:text-slate-100">{p.name}</span>
                {p.description && <p className="text-xs text-slate-400 mt-0.5 dark:text-slate-500">{p.description}</p>}
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
            </div>
          ))}
          {pathways.length === 0 && (
            <div className="text-slate-400 p-10 text-center text-sm dark:text-slate-500">No pathways under {curriculum.name} yet — add one from the Pathways tab.</div>
          )}
        </div>
      )}

      {section === 'presets' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:divide-slate-800 dark:shadow-none">
          {presets.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenPreset(p)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpenPreset(p); }}
              title="Open this preset"
              className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer dark:hover:bg-slate-800/40"
            >
              <div>
                <span className="font-semibold text-slate-800 text-sm dark:text-slate-100">{p.name}</span>
                <span className="text-xs text-slate-400 ml-2 dark:text-slate-500">{p.min_subjects} - {p.max_subjects} subjects &middot; {p.pools.length} pool{p.pools.length !== 1 ? 's' : ''}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
            </div>
          ))}
          {presets.length === 0 && (
            <div className="text-slate-400 p-10 text-center text-sm dark:text-slate-500">No presets under {curriculum.name} yet.</div>
          )}
          <div className="px-6 py-3 bg-slate-50/50 dark:bg-slate-800/40">
            <button onClick={onGoToPresets} className="text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-400">
              Manage presets in the Presets tab &rarr;
            </button>
          </div>
        </div>
      )}

      {section === 'subjects' && (
        <SubjectAssignmentSection
          subjects={subjects}
          subjectProfiles={subjectProfiles}
          departments={departments}
          curriculumId={curriculum.id}
          tierId={null}
          tiers={tiers}
          canEdit={canEdit}
          onChanged={onChanged}
          emptyHint="Curriculum-wide assignment — for CBC, prefer assigning subjects from a specific Tier unless they truly apply to every tier."
        />
      )}

      {section === 'departments' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
          <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center dark:border-slate-700 dark:bg-slate-800/40">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Departments</h3>
            {canEdit && (
              <button onClick={() => handleOpenDepartmentModal()} className="flex items-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-400">
                <Plus className="w-3.5 h-3.5" /> New Department
              </button>
            )}
          </div>
          <DepartmentsCard
            departments={departments.filter(d => d.curriculum_id === curriculum.id)}
            curricula={curricula}
            subjects={subjects}
            subjectProfiles={subjectProfiles}
            onRefresh={onChanged}
            onEdit={(dept) => handleOpenDepartmentModal(dept)}
          />
        </div>
      )}

      <DepartmentModal
        isOpen={isDepartmentModalOpen}
        curricula={curricula}
        defaultCurriculumId={curriculum.id}
        departmentToEdit={departmentToEdit}
        subjects={subjects}
        subjectProfiles={subjectProfiles}
        onClose={() => setDepartmentModalOpen(false)}
        onSuccess={onChanged}
      />
    </div>
  );
}

// ==========================================
// SUBJECT ASSIGNMENT SECTION (shared by Tier and Curriculum detail views)
// ==========================================
// Same "assign, don't just list" pattern as the Grades section above: every subject in the
// master catalog is listed, with a toggle to assign/remove it from this curriculum/tier
// context, plus a couple of small optional overrides (is_core, weekly lessons) for the rare
// case a subject is taught slightly differently under one curriculum than another.

function SubjectAssignmentSection({ subjects, subjectProfiles, departments, curriculumId, tierId, tiers, canEdit, onChanged, emptyHint }: {
  subjects: SubjectOption[]; subjectProfiles: SubjectCurriculumProfile[]; departments: DepartmentOption[];
  curriculumId: number; tierId: number | null; tiers?: Tier[]; canEdit: boolean; onChanged: () => void;
  emptyHint?: string;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const curriculumDepartments = departments.filter((d) => d.curriculum_id === curriculumId && d.is_active);

  const profileFor = (subjectId: number) =>
    subjectProfiles.find((p) => p.subject === subjectId && p.curriculum === curriculumId && p.tier === tierId);

  // Only meaningful at the curriculum-wide view (tierId === null): surfaces assignments
  // already made from a specific Tier's own Subjects tab, so this overview reflects what
  // was actually selected instead of reporting "Not assigned" for subjects tagged elsewhere
  // under the same curriculum.
  const otherTierProfilesFor = (subjectId: number) =>
    tierId === null
      ? subjectProfiles.filter((p) => p.subject === subjectId && p.curriculum === curriculumId && p.tier !== null)
      : [];

  const isShared = (subjectId: number) =>
    new Set(subjectProfiles.filter((p) => p.subject === subjectId).map((p) => p.curriculum)).size > 1;

  const handleAssign = async (subjectId: number) => {
    setBusyId(subjectId);
    try {
      await api.post('/api/core/curriculum/subject-profiles/', {
        subject: subjectId, curriculum: curriculumId, tier: tierId,
      });
      toast.success('Subject assigned.');
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.tier?.[0] || error?.response?.data?.detail || 'Failed to assign subject.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (profile: SubjectCurriculumProfile) => {
    setBusyId(profile.subject);
    try {
      await api.delete(`/api/core/curriculum/subject-profiles/${profile.id}/`);
      toast.success('Subject removed.');
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to remove subject.');
    } finally {
      setBusyId(null);
    }
  };

  const handlePatch = async (profile: SubjectCurriculumProfile, patch: Partial<Pick<SubjectCurriculumProfile, 'is_core' | 'department' | 'total_lessons' | 'double_lessons_required' | 'remedial_lessons_required'>>) => {
    try {
      await api.patch(`/api/core/curriculum/subject-profiles/${profile.id}/`, patch);
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to update subject.');
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2 dark:border-slate-700 dark:bg-slate-800/40">
        <BookMarked className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Subjects</h3>
      </div>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-100 bg-slate-50 dark:text-slate-500 dark:border-slate-700 dark:bg-slate-800/40">
            <th className="px-6 py-3 font-bold">Subject</th>
            <th className="px-6 py-3 font-bold" title="Whether this subject is mandatory for this curriculum/tier — drives exam rosters, student elective self-service, and allocation splitting.">Core?</th>
            <th className="px-6 py-3 font-bold" title="This subject's department under this curriculum specifically — CBC and 8-4-4 group subjects differently, so this can differ from its department under the other curriculum.">Department</th>
            <th className="px-6 py-3 font-bold" title="Weekly lesson count for this subject under this curriculum/tier. Seeds new grades' quotas and is what 'Auto-Fill Subject Quotas' uses instead of its generic defaults, when set.">Weekly lessons</th>
            <th className="px-6 py-3 font-bold" title="Overrides the default double-period count that goes with the weekly lesson count. Leave blank to use the generic default.">Doubles</th>
            <th className="px-6 py-3 font-bold" title="Overrides the default remedial-slot count that goes with the weekly lesson count. Leave blank to use the generic default.">Remedial</th>
            <th className="px-6 py-3 font-bold">Status</th>
            <th className="px-6 py-3 font-bold text-right">Action</th>
          </tr>
        </thead>
        <tbody className="text-sm text-slate-700 divide-y divide-slate-50 dark:text-slate-200 dark:divide-slate-800">
          {subjects.map((s) => {
            const profile = profileFor(s.id);
            const shared = isShared(s.id);
            const otherProfiles = otherTierProfilesFor(s.id);
            return (
              <tr key={s.id} className="hover:bg-slate-50 transition-colors dark:hover:bg-slate-800/40">
                <td className="px-6 py-4 font-semibold text-slate-800 dark:text-slate-100">
                  {s.name} <span className="text-xs text-slate-400 font-mono ml-1 dark:text-slate-500">{s.code}</span>
                  {shared && (
                    <span className="ml-2 text-[10px] uppercase font-bold bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded-full dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/40">Shared</span>
                  )}
                  {otherProfiles.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {otherProfiles.map((p) => {
                        const tierName = tiers?.find((t) => t.id === p.tier)?.name ?? 'Tier';
                        const isCore = p.is_core ?? s.is_core;
                        return (
                          <span
                            key={p.id}
                            title={`Assigned from the ${tierName} tier's own Subjects tab — ${isCore ? 'core' : 'elective'} there`}
                            className={`text-[10px] font-semibold border px-1.5 py-0.5 rounded-full ${
                              isCore ? 'bg-slate-800 dark:bg-slate-700 text-white border-slate-800 dark:border-slate-700' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/40'
                            }`}
                          >
                            {tierName} &middot; {isCore ? 'Core' : 'Elective'}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4">
                  {profile ? (
                    <input
                      type="checkbox"
                      aria-label={`${s.name} is core`}
                      checked={profile.is_core ?? true}
                      onChange={(e) => handlePatch(profile, { is_core: e.target.checked })}
                      disabled={!canEdit}
                      className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-600 dark:text-emerald-400 dark:focus:ring-emerald-400"
                    />
                  ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                </td>
                <td className="px-6 py-4">
                  {profile ? (
                    <select
                      aria-label={`${s.name} department`}
                      value={profile.department ?? ''}
                      onChange={(e) => handlePatch(profile, { department: e.target.value ? Number(e.target.value) : null })}
                      disabled={!canEdit}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-indigo-500 bg-white max-w-40 dark:border-slate-700 dark:focus:border-indigo-400 dark:bg-slate-900"
                    >
                      <option value="">Uncategorized</option>
                      {curriculumDepartments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                </td>
                <td className="px-6 py-4">
                  {profile ? (
                    <input
                      type="number" min={1} placeholder="4"
                      aria-label={`${s.name} weekly lessons`}
                      value={profile.total_lessons ?? ''}
                      onChange={(e) => handlePatch(profile, { total_lessons: e.target.value ? Number(e.target.value) : null })}
                      disabled={!canEdit}
                      className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400"
                    />
                  ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                </td>
                <td className="px-6 py-4">
                  {profile ? (
                    <input
                      type="number" min={0} placeholder="0"
                      aria-label={`${s.name} double lessons`}
                      value={profile.double_lessons_required ?? ''}
                      onChange={(e) => handlePatch(profile, { double_lessons_required: e.target.value ? Number(e.target.value) : null })}
                      disabled={!canEdit}
                      className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400"
                    />
                  ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                </td>
                <td className="px-6 py-4">
                  {profile ? (
                    <input
                      type="number" min={0} placeholder="1"
                      aria-label={`${s.name} remedial lessons`}
                      value={profile.remedial_lessons_required ?? ''}
                      onChange={(e) => handlePatch(profile, { remedial_lessons_required: e.target.value ? Number(e.target.value) : null })}
                      disabled={!canEdit}
                      className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-400"
                    />
                  ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                </td>
                <td className="px-6 py-4">
                  {profile ? (
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/40">Assigned</span>
                  ) : otherProfiles.length > 0 ? (
                    <span className="text-xs text-slate-400 dark:text-slate-500">Assigned via tier only</span>
                  ) : (
                    <span className="text-xs text-slate-400 dark:text-slate-500">Not assigned</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  {canEdit && (
                    profile ? (
                      <button
                        onClick={() => handleRemove(profile)}
                        disabled={busyId === s.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        {busyId === s.id ? 'Saving...' : 'Remove'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAssign(s.id)}
                        disabled={busyId === s.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {busyId === s.id ? 'Saving...' : 'Assign here'}
                      </button>
                    )
                  )}
                </td>
              </tr>
            );
          })}
          {subjects.length === 0 && (
            <tr><td colSpan={8} className="p-8 text-center text-slate-400 dark:text-slate-500">No subjects in the master catalog yet — add one from Academic Hub.</td></tr>
          )}
        </tbody>
      </table>
      {!canEdit && (
        <p className="text-xs text-slate-400 px-6 py-3 dark:text-slate-500">Requires curriculum.edit to assign or remove a subject here.</p>
      )}
      {emptyHint && <p className="text-xs text-slate-400 px-6 py-3 border-t border-slate-100 dark:text-slate-500 dark:border-slate-700">{emptyHint}</p>}
    </div>
  );
}

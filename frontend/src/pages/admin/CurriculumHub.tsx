import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  BookMarked, Plus, Trash2, X, Pencil, Eye, Sunset, Archive, Layers, GitBranch, Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import type { DashboardContextType } from '../../layouts/DashboardLayouts';

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

interface SubjectPool {
  id?: number;
  preset?: number;
  pool_type: 'CORE_COMPULSORY' | 'PATHWAY_CORE' | 'GUIDED_ELECTIVE';
  min_subjects: number;
  max_subjects: number;
  subjects: number[];
}

interface CurriculumPreset {
  id: number;
  name: string;
  min_subjects: number;
  max_subjects: number;
  display_order: number;
  curriculum: number | null;
  tier: 'JSS' | 'SSS' | null;
  pathway: number | null;
  pools: SubjectPool[];
}

interface SubjectOption {
  id: number;
  code: string;
  name: string;
}

const POOL_TYPE_LABELS: Record<SubjectPool['pool_type'], string> = {
  CORE_COMPULSORY: 'Core Compulsory',
  PATHWAY_CORE: 'Pathway Core',
  GUIDED_ELECTIVE: 'Guided Elective',
};

const emptyPreset = (): Omit<CurriculumPreset, 'id'> => ({
  name: '', min_subjects: 7, max_subjects: 8, display_order: 0,
  curriculum: null, tier: null, pathway: null, pools: [],
});

type Tab = 'curricula' | 'pathways' | 'presets';

export default function CurriculumHub() {
  const { permissions } = useOutletContext<DashboardContextType>();
  const canEdit = permissions.includes('curriculum.edit');
  const canArchive = permissions.includes('curriculum.archive');

  const [tab, setTab] = useState<Tab>('curricula');
  const [loading, setLoading] = useState(true);

  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [pathways, setPathways] = useState<Pathway[]>([]);
  const [presets, setPresets] = useState<CurriculumPreset[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);

  const fetchAll = useCallback(async () => {
    try {
      const [curRes, pathRes, presetRes, subRes] = await Promise.all([
        api.get('/api/core/curriculum/curricula/'),
        api.get('/api/core/curriculum/pathways/'),
        api.get('/api/core/curriculum/presets/'),
        api.get('/api/manage-subjects/'),
      ]);
      setCurricula(curRes.data);
      setPathways(pathRes.data);
      setPresets(presetRes.data);
      setSubjects(subRes.data?.data ?? []);
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
        <div className="p-3 rounded-2xl text-indigo-600 bg-indigo-50">
          <BookMarked className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
            Curriculum
            {!canEdit && (
              <span className="flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded-full">
                <Eye className="w-3 h-3" /> View only
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {curricula.length} curricul{curricula.length === 1 ? 'um' : 'a'} &middot; {presets.length} preset{presets.length !== 1 ? 's' : ''} &middot; {pathways.length} pathway{pathways.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="flex bg-white rounded-lg p-1 shadow-sm border border-slate-100 w-max">
        <button onClick={() => setTab('curricula')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${tab === 'curricula' ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
          <Layers className="w-4 h-4" /> Curricula
        </button>
        <button onClick={() => setTab('presets')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${tab === 'presets' ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
          <Sparkles className="w-4 h-4" /> Presets
        </button>
        <button onClick={() => setTab('pathways')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${tab === 'pathways' ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
          <GitBranch className="w-4 h-4" /> Pathways
        </button>
      </div>

      {tab === 'curricula' && (
        <CurriculaTab
          curricula={curricula} canEdit={canEdit} canArchive={canArchive}
          onChanged={fetchAll}
        />
      )}
      {tab === 'pathways' && (
        <PathwaysTab
          pathways={pathways} curricula={curricula} canEdit={canEdit}
          onChanged={fetchAll}
        />
      )}
      {tab === 'presets' && (
        <PresetsTab
          presets={presets} curricula={curricula} pathways={pathways} subjects={subjects}
          canEdit={canEdit} onChanged={fetchAll}
        />
      )}
    </div>
  );
}

// ==========================================
// CURRICULA TAB
// ==========================================

function CurriculaTab({ curricula, canEdit, canArchive, onChanged }: {
  curricula: Curriculum[]; canEdit: boolean; canArchive: boolean; onChanged: () => void;
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
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-100 bg-slate-50">
              <th className="px-6 py-3 font-bold">Curriculum</th>
              <th className="px-6 py-3 font-bold">Status</th>
              <th className="px-6 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-sm text-slate-700 divide-y divide-slate-50">
            {curricula.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <span className="font-semibold text-slate-800">{c.name}</span>
                  <span className="text-xs text-slate-400 ml-2 font-mono">{c.code}</span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    {c.is_archived ? (
                      <span className="bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">Archived</span>
                    ) : !c.is_active_for_new_grades ? (
                      <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">Sunset</span>
                    ) : (
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">Active</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => handleSunset(c)}
                      disabled={!canArchive || busyId === c.id || !c.is_active_for_new_grades || c.is_archived}
                      className="text-slate-400 hover:text-amber-600 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-400"
                      title={!canArchive ? "Requires curriculum.archive" : "Sunset — stop new grades from selecting it"}
                    >
                      <Sunset className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleArchive(c)}
                      disabled={!canArchive || busyId === c.id || c.is_archived}
                      className="text-slate-400 hover:text-red-600 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-400"
                      title={!canArchive ? "Requires curriculum.archive" : "Archive — freeze all config"}
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {curricula.length === 0 && (
              <tr><td colSpan={3} className="p-8 text-center text-slate-400">No curricula yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        adding ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-3">
            <h3 className="text-sm font-bold text-slate-800">New Curriculum</h3>
            <div className="flex gap-3">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code, e.g. IGCSE" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. International GCSE" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="flex items-center gap-2 text-sm font-bold text-indigo-600 hover:text-indigo-700">
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

function PathwaysTab({ pathways, curricula, canEdit, onChanged }: {
  pathways: Pathway[]; curricula: Curriculum[]; canEdit: boolean; onChanged: () => void;
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
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-50">
        {pathways.map((p) => (
          <div key={p.id} className="px-6 py-4 flex items-center justify-between">
            <div>
              <span className="font-semibold text-slate-800 text-sm">{p.name}</span>
              <span className="text-xs text-slate-400 ml-2">{curriculumName(p.curriculum)}</span>
              {p.description && <p className="text-xs text-slate-400 mt-0.5">{p.description}</p>}
            </div>
            {canEdit && (
              <button onClick={() => handleDelete(p)} className="text-slate-400 hover:text-red-600 transition" title="Delete pathway">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        {pathways.length === 0 && <div className="text-slate-400 p-10 text-center text-sm">No pathways yet — pathways are SSS specialization tracks (STEM, Social Sciences, Arts & Sports Science) under a CBC curriculum.</div>}
      </div>

      {canEdit && (
        adding ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-3">
            <h3 className="text-sm font-bold text-slate-800">New Pathway</h3>
            <select aria-label="Curriculum" value={curriculumId} onChange={(e) => setCurriculumId(e.target.value ? Number(e.target.value) : '')} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500">
              <option value="">Select curriculum...</option>
              {curricula.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. STEM" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="flex items-center gap-2 text-sm font-bold text-indigo-600 hover:text-indigo-700">
            <Plus className="w-4 h-4" /> Add Pathway
          </button>
        )
      )}
    </div>
  );
}

// ==========================================
// PRESETS TAB
// ==========================================

function PresetsTab({ presets, curricula, pathways, subjects, canEdit, onChanged }: {
  presets: CurriculumPreset[]; curricula: Curriculum[]; pathways: Pathway[]; subjects: SubjectOption[];
  canEdit: boolean; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<CurriculumPreset | Omit<CurriculumPreset, 'id'> | null>(null);
  const [saving, setSaving] = useState(false);

  const curriculumName = (id: number | null) => curricula.find((c) => c.id === id)?.name ?? 'Uncategorized';

  const handleDelete = async (preset: CurriculumPreset) => {
    if (!window.confirm(`Delete preset '${preset.name}'?`)) return;
    try {
      await api.delete(`/api/core/curriculum/presets/${preset.id}/`);
      toast.success('Preset deleted.');
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to delete preset.');
    }
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
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-100 bg-slate-50">
              <th className="px-6 py-3 font-bold">Preset</th>
              <th className="px-6 py-3 font-bold">Curriculum / Tier</th>
              <th className="px-6 py-3 font-bold">Min - Max</th>
              <th className="px-6 py-3 font-bold">Pools</th>
              <th className="px-6 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-sm text-slate-700 divide-y divide-slate-50">
            {presets.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 font-semibold text-slate-800">{p.name}</td>
                <td className="px-6 py-4 text-xs text-slate-500">
                  {curriculumName(p.curriculum)}{p.tier ? ` · ${p.tier}` : ''}{p.pathway ? ` · ${pathways.find((pw) => pw.id === p.pathway)?.name ?? ''}` : ''}
                </td>
                <td className="px-6 py-4">{p.min_subjects} - {p.max_subjects}</td>
                <td className="px-6 py-4 text-xs text-slate-500">{p.pools.length > 0 ? p.pools.map((pool) => POOL_TYPE_LABELS[pool.pool_type]).join(', ') : '—'}</td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-3">
                    {canEdit && (
                      <>
                        <button onClick={() => setEditing(p)} className="text-slate-400 hover:text-indigo-600 transition" title="Edit preset"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(p)} className="text-slate-400 hover:text-red-600 transition" title="Delete preset"><Trash2 className="w-4 h-4" /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {presets.length === 0 && (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400">No presets yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && !editing && (
        <button onClick={() => setEditing(emptyPreset())} className="flex items-center gap-2 text-sm font-bold text-indigo-600 hover:text-indigo-700">
          <Plus className="w-4 h-4" /> Add Preset
        </button>
      )}

      {editing && (
        <PresetEditorPanel
          preset={editing}
          curricula={curricula}
          pathways={pathways}
          subjects={subjects}
          saving={saving}
          onChange={setEditing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PresetEditorPanel({ preset, curricula, pathways, subjects, saving, onChange, onSave, onCancel }: {
  preset: CurriculumPreset | Omit<CurriculumPreset, 'id'>;
  curricula: Curriculum[]; pathways: Pathway[]; subjects: SubjectOption[]; saving: boolean;
  onChange: (p: any) => void; onSave: () => void; onCancel: () => void;
}) {
  const selectedCurriculum = curricula.find((c) => c.id === preset.curriculum);
  const isCbc = selectedCurriculum?.code === 'CBC';
  const isSss = isCbc && preset.tier === 'SSS';
  const availablePathways = pathways.filter((pw) => pw.curriculum === preset.curriculum);

  const addPool = () => {
    onChange({ ...preset, pools: [...preset.pools, { pool_type: 'CORE_COMPULSORY', min_subjects: 1, max_subjects: 1, subjects: [] }] });
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

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800">{'id' in preset ? 'Edit Preset' : 'New Preset'}</h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600" title="Close"><X className="w-4 h-4" /></button>
      </div>

      <input value={preset.name} onChange={(e) => onChange({ ...preset, name: e.target.value })} placeholder="Name, e.g. CBC SSS - STEM" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="text-xs">
          <span className="block text-slate-500 font-bold mb-1">Min subjects</span>
          <input type="number" min={1} value={preset.min_subjects} onChange={(e) => onChange({ ...preset, min_subjects: Number(e.target.value) })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
        <label className="text-xs">
          <span className="block text-slate-500 font-bold mb-1">Max subjects</span>
          <input type="number" min={1} value={preset.max_subjects} onChange={(e) => onChange({ ...preset, max_subjects: Number(e.target.value) })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
        <label className="text-xs">
          <span className="block text-slate-500 font-bold mb-1">Curriculum</span>
          <select aria-label="Curriculum" value={preset.curriculum ?? ''} onChange={(e) => onChange({ ...preset, curriculum: e.target.value ? Number(e.target.value) : null, tier: null, pathway: null })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500">
            <option value="">Uncategorized</option>
            {curricula.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-slate-500 font-bold mb-1">Tier</span>
          <select aria-label="Tier" value={preset.tier ?? ''} disabled={!isCbc} onChange={(e) => onChange({ ...preset, tier: e.target.value || null })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed">
            <option value="">—</option>
            <option value="JSS">JSS</option>
            <option value="SSS">SSS</option>
          </select>
        </label>
      </div>

      {isCbc && preset.tier === 'SSS' && (
        <label className="text-xs block">
          <span className="block text-slate-500 font-bold mb-1">Pathway (optional)</span>
          <select aria-label="Pathway" value={preset.pathway ?? ''} onChange={(e) => onChange({ ...preset, pathway: e.target.value ? Number(e.target.value) : null })} className="w-full sm:w-1/2 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500">
            <option value="">None</option>
            {availablePathways.map((pw) => <option key={pw.id} value={pw.id}>{pw.name}</option>)}
          </select>
        </label>
      )}

      {isSss && (
        <div className="border-t border-slate-100 pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Subject Pools</h4>
            <button onClick={addPool} className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700"><Plus className="w-3.5 h-3.5" /> Add Pool</button>
          </div>
          {preset.pools.length === 0 && <p className="text-xs text-slate-400 italic">No pools yet — SSS presets group subjects into Core Compulsory / Pathway Core / Guided Elective pools, each with its own pick count.</p>}
          {preset.pools.map((pool, index) => (
            <div key={index} className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <select aria-label="Pool type" value={pool.pool_type} onChange={(e) => updatePool(index, { pool_type: e.target.value as SubjectPool['pool_type'] })} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500">
                  {(Object.keys(POOL_TYPE_LABELS) as SubjectPool['pool_type'][]).map((key) => <option key={key} value={key}>{POOL_TYPE_LABELS[key]}</option>)}
                </select>
                <input type="number" min={0} aria-label="Pool min" value={pool.min_subjects} onChange={(e) => updatePool(index, { min_subjects: Number(e.target.value) })} className="w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
                <span className="text-slate-400 text-xs">to</span>
                <input type="number" min={0} aria-label="Pool max" value={pool.max_subjects} onChange={(e) => updatePool(index, { max_subjects: Number(e.target.value) })} className="w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
                <button onClick={() => removePool(index)} className="text-slate-400 hover:text-red-600" title="Remove pool"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                {subjects.map((s) => {
                  const checked = pool.subjects.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleSubject(index, s.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${checked ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 justify-end border-t border-slate-100 pt-4">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
        <button onClick={onSave} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Preset'}
        </button>
      </div>
    </div>
  );
}

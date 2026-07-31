import { useState, useEffect } from 'react';
import { Save, Trash2, Layers, BookOpen, Loader2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Grade, Subject, Quota } from '../../libs/types';
import api from '../../libs/axiosInstance';

type PeriodStructure = 'ALL_DOUBLE' | 'ALL_SINGLE' | 'MIXED';

interface SubjectBlockData {
  id: number;
  name: string;
  grade_level_id: number;
  grade_level_name: string;
  academic_year: number | null;
  term: string | null;
  subjects: {
    id: number;
    name: string;
    code: string;
    department_name: string | null;
  }[];
  period_structure: PeriodStructure;
}

const PERIOD_STRUCTURE_LABELS: Record<PeriodStructure, string> = {
  ALL_DOUBLE: 'All Double Periods',
  ALL_SINGLE: 'All Single Periods',
  MIXED: 'Mixed (Each Subject’s Own Split)',
};

interface BlockProps {
  grades: Grade[];       // Ingests global grade level structures from parent state
  subjects: Subject[];   // Ingests base subjects roster from parent state
  quotas: Quota[];       // Used to scope the subject-picker down to this grade
  confirmAction: (title: string, msg: string, onConfirm: () => void) => void;
}

export default function SettingsSubjectBlocks({ grades, subjects, quotas, confirmAction }: BlockProps) {
  const [blocks, setBlocks] = useState<SubjectBlockData[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form Field Model States matching your exact JSON payload variables
  const [selectedBlockId, setSelectedBlockId] = useState<number | null>(null);
  const [blockName, setBlockName] = useState('');
  const [selectedGradeId, setSelectedGradeId] = useState('');
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<number[]>([]);
  const [periodStructure, setPeriodStructure] = useState<PeriodStructure>('MIXED');

  // Fetch block structures matching the active timeframe configurations
  const fetchActiveBlocks = async () => {
    setLoadingBlocks(true);
    try {
      const res = await api.get('/api/timetable/manage-subject-blocks/');
      if (res.data.status === 'success') {
        setBlocks(res.data.data);
      }
    } catch (err) {
      console.error("Error pulling subject block records:", err);
      toast.error("Failed to sync structural option blocks.");
    } finally {
      setLoadingBlocks(false);
    }
  };

  useEffect(() => {
    fetchActiveBlocks();
  }, []);

  // Filter available subjects down to the target grade context: only subjects that
  // already have a Quota configured for this grade make sense to bundle into its block.
  const crossGradeSubjects = subjects.filter(sub => {
    if (!selectedGradeId) return true;
    return quotas.some(q => q.grade_id === Number(selectedGradeId) && q.subject_id === sub.id);
  });

  const toggleSubjectSelection = (id: number) => {
    setSelectedSubjectIds(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  // --- SAVING COMPLIANT: MATCHES YOUR ATOMIC POST TRANSACTION ---
  const handleSaveBlockTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedSubjectIds.length === 0) {
      toast.error("Validation Error: Please select at least one subject to bundle inside this block.");
      return;
    }
    setSaving(true);

    try {
      const payload = {
        id: selectedBlockId,
        name: blockName,
        grade_level_id: Number(selectedGradeId),
        subject_ids: selectedSubjectIds,
        period_structure: periodStructure
      };

      const res = await api.post('/api/timetable/manage-subject-blocks/', payload);
      if (res.data.status === 'success') {
        toast.success(res.data.message || "Subject block compiled securely.");
        // Revert panel parameters back to clean slate states
        setBlockName('');
        setSelectedGradeId('');
        setSelectedSubjectIds([]);
        setSelectedBlockId(null);
        setPeriodStructure('MIXED');
        fetchActiveBlocks();
      }
    } catch (err: any) {
      console.error("Mutation failure:", err);
      const msg = err.response?.data?.message || "Error writing block configurations.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // --- DELETION COMPLIANT: MATCHES YOUR ATOMIC DELETE TRANSACTION ---
  const handleDeleteBlockTemplate = (id: number, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    confirmAction(
      "Split Subject Block?",
      `Are you sure you want to split up '${name}'? Linked subjects will safely revert back to independent tracking slots via system SET_NULL rules.`,
      async () => {
        try {
          const res = await api.delete('/api/timetable/manage-subject-blocks/', {
            data: { id }
          });
          if (res.data.status === 'success') {
            toast.success(res.data.message || "Block container split successfully.");
            if (selectedBlockId === id) {
              setBlockName('');
              setSelectedGradeId('');
              setSelectedSubjectIds([]);
              setSelectedBlockId(null);
              setPeriodStructure('MIXED');
            }
            fetchActiveBlocks();
          }
        } catch (err) {
          console.error("Error breaking apart option block:", err);
          toast.error("Failed to execute container deletion.");
        }
      }
    );
  };

  const loadBlockIntoWorkspace = (block: SubjectBlockData) => {
    setSelectedBlockId(block.id);
    setBlockName(block.name);
    setSelectedGradeId(block.grade_level_id.toString());
    setSelectedSubjectIds(block.subjects.map(s => s.id));
    setPeriodStructure(block.period_structure || 'MIXED');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
      
      {/* Subject Cluster Form Panel Configuration Workspace */}
      <form onSubmit={handleSaveBlockTemplate} className="lg:col-span-1 space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-200 h-fit sticky top-4 shadow-sm">
        <div className="flex justify-between items-center border-b border-slate-200 pb-2">
          <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wide">
            {selectedBlockId ? "Edit Cluster Design" : "Build Option Block"}
          </h3>
          {selectedBlockId && (
            <button 
              type="button" 
              onClick={() => { setSelectedBlockId(null); setBlockName(''); setSelectedGradeId(''); setSelectedSubjectIds([]); setPeriodStructure('MIXED'); }}
              className="text-xs font-bold text-indigo-600 hover:underline"
            >
              Reset Form
            </button>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600">Block Name Identifier</label>
          <input 
            type="text" 
            required 
            placeholder="e.g., Form 4 Technical Block"
            value={blockName} 
            onChange={(e) => setBlockName(e.target.value)} 
            className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white font-medium" 
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600">Target Grade Level Context</label>
          <select 
            required 
            value={selectedGradeId} 
            onChange={(e) => setSelectedGradeId(e.target.value)} 
            className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none bg-white font-bold text-slate-700"
          >
            <option value="">-- Assign Grade Level --</option>
            {grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600">Lesson Period Structure</label>
          <select
            value={periodStructure}
            onChange={(e) => setPeriodStructure(e.target.value as PeriodStructure)}
            className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none bg-white font-bold text-slate-700"
          >
            {(Object.keys(PERIOD_STRUCTURE_LABELS) as PeriodStructure[]).map(key => (
              <option key={key} value={key}>{PERIOD_STRUCTURE_LABELS[key]}</option>
            ))}
          </select>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Governs how the quota and timetable engines split this block's lessons. e.g. a Technical
            practical block is usually "All Double"; a Humanities options block is usually "All Single".
          </p>
        </div>

        {/* Dynamic Multi-Select Checked Chip Box Grid for Subject Pooling */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-600 block">Select Elective Subjects to Pool</label>
          <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto bg-white p-2 space-y-1 custom-scrollbar">
            {crossGradeSubjects.map(sub => {
              const isChecked = selectedSubjectIds.includes(sub.id);
              return (
                <div 
                  key={sub.id}
                  onClick={() => toggleSubjectSelection(sub.id)}
                  className={`flex items-center justify-between p-2 rounded-lg cursor-pointer text-xs font-bold transition-colors ${isChecked ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'hover:bg-slate-50 text-slate-600 border border-transparent'}`}
                >
                  <div className="min-w-0 pr-2">
                    <p className="truncate">{sub.name}</p>
                    <p className="text-[10px] font-medium text-slate-400 mt-0.5">{sub.code || 'No Code'}</p>
                  </div>
                  <div className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ${isChecked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'}`}>
                    {isChecked && <Check className="w-3 h-3 stroke-3" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <button 
          type="submit" 
          disabled={saving}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-sm flex justify-center items-center gap-2 transition-colors shadow-md shadow-indigo-600/10 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>Save Structural Block</span>
        </button>
      </form>

      {/* Roster Layout Sheet Grid Displaying Existing Registered Blocks */}
      <div className="lg:col-span-2 space-y-4">
        <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wide">Registered Subject Clusters</h3>
        
        {loadingBlocks ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 bg-slate-200 rounded-xl"></div>)}
          </div>
        ) : blocks.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-xl p-12 text-center text-slate-400 text-xs font-medium flex flex-col items-center justify-center gap-2">
            <Layers className="w-8 h-8 text-slate-300" />
            <p>No option block structures registered under this year/term matrix yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {blocks.map(block => (
              <div 
                key={block.id}
                onClick={() => loadBlockIntoWorkspace(block)}
                className={`p-4 rounded-xl border bg-white flex flex-col justify-between gap-4 cursor-pointer transition-all hover:shadow-md ${selectedBlockId === block.id ? 'border-indigo-500 ring-2 ring-indigo-100 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div className="space-y-1.5">
                  <div className="flex justify-between items-start gap-2">
                    <h4 className="font-black text-slate-800 tracking-tight leading-snug">{block.name}</h4>
                    <button
                      onClick={(e) => handleDeleteBlockTemplate(block.id, block.name, e)}
                      title="Delete block"
                      aria-label={`Delete ${block.name} block`}
                      className="text-slate-400 hover:text-red-600 p-1.5 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex gap-2 flex-wrap text-[10px] font-black uppercase tracking-wider text-indigo-600">
                    <span className="bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">{block.grade_level_name}</span>
                    {block.term && <span className="bg-slate-100 border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded">{block.term}</span>}
                    <span className="bg-amber-50 border border-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                      {PERIOD_STRUCTURE_LABELS[block.period_structure] || 'Mixed'}
                    </span>
                  </div>
                </div>

                {/* Sub-Subject Badge Loop Pills */}
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <BookOpen className="w-3 h-3" /> Bundled Cluster Subjects ({block.subjects.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto custom-scrollbar pr-1">
                    {block.subjects.map(s => (
                      <span 
                        key={s.id} 
                        className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-md whitespace-nowrap"
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
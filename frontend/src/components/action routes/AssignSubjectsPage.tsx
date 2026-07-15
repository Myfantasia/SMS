import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
    ArrowLeft, ShieldAlert, CheckCircle2, Lock, 
    Trash2, Plus, AlertCircle, Settings, UserCheck 
} from 'lucide-react';
import api from '../../libs/axiosInstance';

// --- INTERFACES ---
interface Subject {
    id: number;
    code: string;
    name: string;
    is_core: boolean;
    department: string;
}

interface CategoryLimit {
    id: number;
    department: string;
    max_subjects: number;
}

interface ExclusionRule {
    id: number;
    subject_a_id: number;
    subject_a_name: string;
    subject_b_id: number;
    subject_b_name: string;
}

const AssignSubjectsPage: React.FC = () => {
    // Replaced Props with Router Hooks
    const { gradeId, studentId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    // Catch passed state from previous views
    const studentName = location.state?.studentName || 'Student';
    const academicYearId = location.state?.academicYearId || '';

    // --- UI STATE ---
    const [activeMainTab, setActiveMainTab] = useState<'assign' | 'policies'>('assign');
    const [activeDeptTab, setActiveDeptTab] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [bypassPolicies, setBypassPolicies] = useState(false);

    // --- DATA STATE ---
    const [catalog, setCatalog] = useState<Record<string, Subject[]>>({});
    const [draftSelection, setDraftSelection] = useState<number[]>([]);
    
    // Policies State
    const [categoryLimits, setCategoryLimits] = useState<CategoryLimit[]>([]);
    const [exclusionRules, setExclusionRules] = useState<ExclusionRule[]>([]);

    // Policy Builder Form State
    const [newLimitDept, setNewLimitDept] = useState('');
    const [newLimitMax, setNewLimitMax] = useState(1);
    const [newExclusionA, setNewExclusionA] = useState('');
    const [newExclusionB, setNewExclusionB] = useState('');

    // --- FETCH DATA ---
const fetchData = useCallback(async () => {
    if (!gradeId) return;
    setLoading(true);
    try {
        // PERFORMANCE BEST PRACTICE: Execute independent network tasks in parallel
        const [catRes, limitsRes, exclRes] = await Promise.all([
          api.get(`/api/subjects/catalog/${gradeId}/`),
          api.get(`/api/subjects/category-limits/${gradeId}/`),
          api.get(`/api/subjects/exclusion-rules/${gradeId}/`)
        ]);

        const catData = catRes.data;
        const limitsData = limitsRes.data;
        const exclData = exclRes.data;

        // Fetch user profile dependencies sequentially only if student identity is defined
        let currentSelections: number[] = [];
        if (studentId) {
            const profRes = await api.get(`/api/subjects/student-profile/${studentId}/`);
            const profData = profRes.data;
            if (profData.status === 'success') {
                currentSelections = profData.data.subjects.map((s: any) => s.subject_id);
            }
        }

        if (catData.status === 'success') {
            setCatalog(catData.data.catalog);
            const departments = Object.keys(catData.data.catalog);
            if (departments.length > 0) setActiveDeptTab(departments[0]);
            
            const coreIds: number[] = [];
            Object.values(catData.data.catalog).flat().forEach((sub: any) => {
                if (sub.is_core) coreIds.push(sub.id);
            });
            
            setDraftSelection(Array.from(new Set([...currentSelections, ...coreIds])));
        }

        if (limitsData.status === 'success') setCategoryLimits(limitsData.data);
        if (exclData.status === 'success') setExclusionRules(exclData.data);

    } catch (error) {
        console.error("Error fetching data:", error);
    } finally {
        setLoading(false);
    }
}, [gradeId, studentId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Flat list of subjects for dropdowns
    const flatSubjects = useMemo(() => Object.values(catalog).flat(), [catalog]);

    // --- THE SMART LOCK-OUT ENGINE ---
    const getSubjectStatus = (subject: Subject) => {
        if (subject.is_core) return { disabled: true, checked: true, reason: 'Core subject (Mandatory)' };
        const isChecked = draftSelection.includes(subject.id);
        
        if (bypassPolicies) return { disabled: false, checked: isChecked, reason: '' };

        // Check 1: Exclusions (Mutually Exclusive)
        for (const rule of exclusionRules) {
            if (rule.subject_a_id === subject.id && draftSelection.includes(rule.subject_b_id)) {
                return { disabled: true, checked: false, reason: `Clash: Cannot take alongside ${rule.subject_b_name}` };
            }
            if (rule.subject_b_id === subject.id && draftSelection.includes(rule.subject_a_id)) {
                return { disabled: true, checked: false, reason: `Clash: Cannot take alongside ${rule.subject_a_name}` };
            }
        }

        // Check 2: Category Limits
        const limit = categoryLimits.find(l => l.department === subject.department);
        if (limit && !isChecked) {
            const currentDeptSelectedCount = draftSelection.filter(id => {
                const sub = flatSubjects.find(s => s.id === id);
                return sub?.department === subject.department && !sub?.is_core;
            }).length;

            if (currentDeptSelectedCount >= limit.max_subjects) {
                return { disabled: true, checked: false, reason: `Department Limit Reached (Max ${limit.max_subjects})` };
            }
        }

        return { disabled: false, checked: isChecked, reason: '' };
    };

    const handleToggleSubject = (subject: Subject) => {
        const status = getSubjectStatus(subject);
        if (status.disabled && !status.checked) return; // Prevent clicking locked items

        setDraftSelection(prev => 
            prev.includes(subject.id) 
                ? prev.filter(id => id !== subject.id) // Uncheck
                : [...prev, subject.id] // Check
        );
    };

    // --- SUBMIT HANDLERS ---
const handleSaveStudentSubjects = async () => {
    if (!studentId) return;
    setSaving(true);
    try {
        const res = await api.post(`/api/subjects/manage-enrollment/${studentId}/`, {
            subject_ids: draftSelection,
            year_id: academicYearId
        });
        
        const result = res.data;
        if (result.status === 'success') {
            navigate(-1);
        } else {
            alert(result.message);
        }
    } catch (error) {
        console.error(error);
    } finally {
        setSaving(true);
    }
};

    // --- POLICY BUILDER HANDLERS ---
    const handleAddCategoryLimit = async () => {
    if (!newLimitDept) return;
    try {
        await api.post(`/api/subjects/category-limits/${gradeId}/`, {
            department: newLimitDept,
            max_subjects: newLimitMax
        });
        fetchData(); // Refresh structural policies
    } catch (error) { 
        console.error(error); 
    }
    };

const handleDeleteCategoryLimit = async (id: number) => {
    try {
        // AXIOS GOTCHA: DELETE payloads must be passed explicitly under a nested config config payload wrapper
        await api.delete(`/api/subjects/category-limits/${gradeId}/`, {
            data: { limit_id: id }
        });
        fetchData();
    } catch (error) { 
        console.error(error); 
    }
};

const handleAddExclusion = async () => {
    if (!newExclusionA || !newExclusionB) return;
    try {
        const res = await api.post(`/api/subjects/exclusion-rules/${gradeId}/`, {
            subject_a_id: newExclusionA,
            subject_b_id: newExclusionB
        });
        
        const result = res.data;
        if (result.status === 'error') alert(result.message);
        fetchData();
    } catch (error) { 
        console.error(error); 
    }
};

const handleDeleteExclusion = async (id: number) => {
    try {
        // Enforcing structured data object keys inside Axios DELETE queries
        await api.delete(`/api/subjects/exclusion-rules/${gradeId}/`, {
            data: { rule_id: id }
        });
        fetchData();
    } catch (error) { 
        console.error(error); 
    }
};

    if (loading) return <div className="p-8 text-center flex justify-center text-slate-500">Loading Configuration...</div>;

    return (
        <div className="max-w-7xl mx-auto p-6 space-y-6 animate-in fade-in duration-300">
            
            <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600 transition-colors w-max">
                <ArrowLeft className="w-4 h-4" /> Back to Class
            </button>

            <div className="bg-slate-800 rounded-2xl shadow-xl w-full flex flex-col overflow-hidden">
                
                {/* PAGE HEADER */}
                <div className="bg-slate-800 p-6 flex justify-between items-center text-white">
                    <div>
                        <h2 className="text-xl font-bold">{studentId ? `Assign Subjects: ${studentName}` : 'Subject Policies'}</h2>
                        <p className="text-slate-400 text-sm mt-1">Configure curriculum and resolve clashes.</p>
                    </div>
                </div>

                {/* MAIN TABS */}
                {/* UPATED: Changed from bg-slate-50 and border-slate-700 to pure bg-white to prevent bleed */}
                <div className="flex border-b border-slate-200 bg-white px-6">
                    {studentId && (
                        <button 
                            type="button"
                            onClick={() => setActiveMainTab('assign')}
                            className={`flex items-center gap-2 py-4 px-4 text-sm font-bold border-b-2 transition ${activeMainTab === 'assign' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                        >
                            <UserCheck className="w-4 h-4" /> Student Assignment
                        </button>
                    )}
                    <button 
                        type="button"
                        onClick={() => setActiveMainTab('policies')}
                        className={`flex items-center gap-2 py-4 px-4 text-sm font-bold border-b-2 transition ${activeMainTab === 'policies' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                        <Settings className="w-4 h-4" /> Grade Subject Policies
                    </button>
                </div>

                {/* PAGE BODY */}
                {/* UPDATED: Changed from bg-slate-50/50 to pure bg-white to prevent dark color bleed */}
                <div className="flex-1 p-6 bg-white">
                    {/* --- TAB 1: STUDENT ASSIGNMENT --- */}
                    {activeMainTab === 'assign' && (
                        <div className="space-y-6">
                            {/* Department Sub-Tabs */}
                            <div className="flex flex-wrap gap-2 mb-6">
                                {Object.keys(catalog).map(dept => (
                                    <button 
                                        type="button"
                                        key={dept}
                                        onClick={() => setActiveDeptTab(dept)}
                                        className={`px-4 py-2 rounded-full text-sm font-medium transition border ${activeDeptTab === dept ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                                    >
                                        {dept}
                                    </button>
                                ))}
                            </div>

                            {/* Subject Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {catalog[activeDeptTab]?.map(subject => {
                                    const status = getSubjectStatus(subject);
                                    return (
                                        <div 
                                            key={subject.id}
                                            onClick={() => handleToggleSubject(subject)}
                                            className={`relative p-4 rounded-xl border-2 transition cursor-pointer flex items-start gap-3
                                                ${status.checked ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300'}
                                                ${status.disabled && !status.checked ? 'opacity-50 cursor-not-allowed bg-slate-50' : ''}
                                            `}
                                            title={status.reason}
                                        >
                                            <div className="mt-0.5">
                                                <div className={`w-5 h-5 rounded border flex items-center justify-center ${status.checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'}`}>
                                                    {status.checked && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <p className={`font-bold text-sm ${status.checked ? 'text-blue-900' : 'text-slate-700'}`}>{subject.name}</p>
                                                <p className="text-xs text-slate-500 mt-0.5">{subject.code}</p>
                                                
                                                {status.disabled && status.reason && !subject.is_core && (
                                                    <div className="flex items-center gap-1 mt-2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded w-max border border-amber-200">
                                                        <Lock className="w-3 h-3" /> {status.reason}
                                                    </div>
                                                )}
                                                {subject.is_core && (
                                                    <div className="flex items-center gap-1 mt-2 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded w-max border border-slate-200">
                                                        <Lock className="w-3 h-3" /> Mandatory
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* --- TAB 2: GRADE POLICIES BUILDER --- */}
                    {activeMainTab === 'policies' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            
                            {/* Category Limits */}
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col h-full">
                                <div className="flex items-center gap-2 mb-4 text-slate-800">
                                    <ShieldAlert className="w-5 h-5 text-indigo-500" />
                                    <h3 className="font-bold">Category Limits</h3>
                                </div>
                                <p className="text-xs text-slate-500 mb-4">Restrict how many subjects a student can pick from a specific department.</p>
                                
                                {/* Add Form */}
                                <div className="flex gap-2 mb-6 bg-slate-50 p-3 rounded-lg border border-slate-100 shrink-0">
                                    <select aria-label="Select department" className="flex-1 text-sm border rounded px-2 py-1.5 outline-none bg-white" value={newLimitDept} onChange={e => setNewLimitDept(e.target.value)}>
                                        <option value="">Select Dept...</option>
                                        {Object.keys(catalog).map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                    <input type="number" min="1" className="w-20 text-sm border rounded px-2 py-1.5 outline-none bg-white" value={newLimitMax} onChange={e => setNewLimitMax(parseInt(e.target.value))} />
                                    <button type="button" aria-label="Add category limit" title="Add category limit" onClick={handleAddCategoryLimit} className="bg-indigo-600 text-white p-2 rounded hover:bg-indigo-700 transition"><Plus className="w-4 h-4"/></button>
                                </div>

                                {/* List with Scrollbar */}
                                <div className="space-y-2 overflow-y-auto max-h-64 pr-2 custom-scrollbar flex-1">
                                    {categoryLimits.map(limit => (
                                        <div key={limit.id} className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-100 text-sm">
                                            <span className="font-medium text-slate-700">{limit.department}</span>
                                            <div className="flex items-center gap-4">
                                                <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-bold">Max {limit.max_subjects}</span>
                                                <button type="button" aria-label="Delete category limit" title="Delete category limit" onClick={() => handleDeleteCategoryLimit(limit.id)} className="text-slate-400 hover:text-red-500 transition"><Trash2 className="w-4 h-4"/></button>
                                            </div>
                                        </div>
                                    ))}
                                    {categoryLimits.length === 0 && <p className="text-center text-xs text-slate-400 italic mt-4">No limits configured.</p>}
                                </div>
                            </div>

                            {/* Exclusion Rules */}
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col h-full">
                                <div className="flex items-center gap-2 mb-4 text-slate-800">
                                    <AlertCircle className="w-5 h-5 text-amber-500" />
                                    <h3 className="font-bold">Mutually Exclusive</h3>
                                </div>
                                <p className="text-xs text-slate-500 mb-4">Define subject combinations that are strictly forbidden (Timetable Clashes).</p>
                                
                                {/* Add Form */}
                                <div className="flex flex-col gap-2 mb-6 bg-slate-50 p-3 rounded-lg border border-slate-100 shrink-0">
                                    <select className="text-sm border rounded px-2 py-1.5 outline-none bg-white" value={newExclusionA} onChange={e => setNewExclusionA(e.target.value)}>
                                        <option value="">Select Subject A...</option>
                                        {flatSubjects.filter(s => !s.is_core).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                    <div className="text-center text-xs font-bold text-slate-400">CANNOT BE TAKEN WITH</div>
                                    <select className="text-sm border rounded px-2 py-1.5 outline-none bg-white" value={newExclusionB} onChange={e => setNewExclusionB(e.target.value)}>
                                        <option value="">Select Subject B...</option>
                                        {flatSubjects.filter(s => !s.is_core).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                    <button type="button" onClick={handleAddExclusion} className="mt-2 bg-amber-500 text-white py-1.5 rounded text-sm font-bold hover:bg-amber-600 transition">Add Rule</button>
                                </div>

                                {/* List with Scrollbar */}
                                <div className="space-y-2 overflow-y-auto max-h-64 pr-2 custom-scrollbar flex-1">
                                    {exclusionRules.map(rule => (
                                        <div key={rule.id} className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-100 text-sm">
                                            <span className="font-medium text-slate-700 text-xs">
                                                <span className="text-red-500 font-bold">{rule.subject_a_name}</span> vs <span className="text-red-500 font-bold">{rule.subject_b_name}</span>
                                            </span>
                                            <button type="button" aria-label="Delete exclusion rule" title="Delete exclusion rule" onClick={() => handleDeleteExclusion(rule.id)} className="text-slate-400 hover:text-red-500 transition"><Trash2 className="w-4 h-4"/></button>
                                        </div>
                                    ))}
                                    {exclusionRules.length === 0 && <p className="text-center text-xs text-slate-400 italic mt-4">No exclusion rules configured.</p>}
                                </div>
                            </div>

                        </div>
                    )}
                </div>

                {/* PAGE FOOTER */}
                {activeMainTab === 'assign' && (
                    <div className="bg-white border-t border-slate-200 p-6 flex justify-between items-center">
                        {/* Admin Bypass Toggle */}
                        <div className="flex items-center gap-3">
                            <button 
                                type="button"
                                aria-label="Toggle admin bypass"
                                title="Toggle admin bypass"
                                onClick={() => setBypassPolicies(!bypassPolicies)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${bypassPolicies ? 'bg-red-500' : 'bg-slate-300'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${bypassPolicies ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                            <div>
                                <p className={`text-sm font-bold ${bypassPolicies ? 'text-red-600' : 'text-slate-700'}`}>Bypass Subject Policies</p>
                                <p className="text-xs text-slate-500">Admin override. Use with caution.</p>
                            </div>
                        </div>

                        {/* Save Actions */}
                        <div className="flex gap-3">
                            <button type="button" onClick={() => navigate(-1)} className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition">Cancel</button>
                            <button 
                                type="button"
                                aria-label="Save student subjects"
                                title="Save student subjects"
                                onClick={handleSaveStudentSubjects}
                                disabled={saving}
                                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-bold transition disabled:opacity-50"
                            >
                                {saving ? 'Saving...' : 'Save & Lock Subjects'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AssignSubjectsPage;
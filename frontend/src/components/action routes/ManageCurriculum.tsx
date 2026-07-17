import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
    Settings, CheckSquare, Save, AlertCircle,
    ShieldCheck, Clock, CheckCircle2, ChevronDown, Plus, Minus, Zap, Eye
} from 'lucide-react';
import api from '../../libs/axiosInstance';
import type { DashboardContextType } from '../../layouts/DashboardLayouts';

interface ManageCurriculumProps {
    streamId: number;
    gradeId: number;
    classNameTitle: string;
}

interface RuleData {
    min_subjects: number;
    max_subjects: number;
}

interface PendingStudent {
    id: number;
    name: string;
    roll: string;
    total_selected: number;
    pending_count: number;
    approved_count: number;
}

interface AcademicYear {
    id: number;
    year: string;
    is_active: boolean;
}

// NEW: Interface for dynamic curriculum presets
interface CurriculumPreset {
    id: number;
    name: string;
    min_subjects: number;
    max_subjects: number;
}

const ManageCurriculum: React.FC<ManageCurriculumProps> = ({ streamId, gradeId, classNameTitle }) => {
    const navigate = useNavigate();
    const { permissions } = useOutletContext<DashboardContextType>();
    const canEdit = permissions.includes('curriculum.edit');
    const [activeTab, setActiveTab] = useState<'rules' | 'approvals'>('rules');
    const [loading, setLoading] = useState<boolean>(true);
    const [saving, setSaving] = useState<boolean>(false);
    
    // Dynamic Academic Year State
    const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
    const [selectedYearId, setSelectedYearId] = useState<string>(''); 

    const [rules, setRules] = useState<RuleData>({ min_subjects: 7, max_subjects: 8 });
    const [ruleMessage, setRuleMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // NEW: State for dynamically fetched presets
    const [presets, setPresets] = useState<CurriculumPreset[]>([]);

    const [pendingStudents, setPendingStudents] = useState<PendingStudent[]>([]);
    const [selectedStudents, setSelectedStudents] = useState<number[]>([]);

    // --- 1. FETCH ACADEMIC YEARS ---
const fetchYearsAndInitialize = useCallback(async () => {
    try {
        const res = await api.get('/api/academic-years/');
        const result = res.data;
        if (result.status === 'success') {
            setAcademicYears(result.data);
            const activeYear = result.data.find((y: AcademicYear) => y.is_active);
            if (activeYear) {
                setSelectedYearId(activeYear.id.toString());
            } else if (result.data.length > 0) {
                setSelectedYearId(result.data[0].id.toString());
            }
        }
    } catch (error) {
        console.error("Failed to fetch academic years:", error);
    }
}, []);

    // --- 2. FETCH RULES ---
const fetchRules = useCallback(async () => {
    try {
        const res = await api.get(`/api/subjects/rules/${gradeId}/`);
        const result = res.data;
        if (result.status === 'success') {
            setRules({ min_subjects: result.data.min_subjects, max_subjects: result.data.max_subjects });
        }
    } catch (error) {
        console.error("Failed to fetch rules:", error);
    }
}, [gradeId]);

    // --- 3. FETCH CURRICULUM PRESETS (NEW) ---
const fetchPresets = useCallback(async () => {
    try {
        const res = await api.get('/api/subjects/curriculum-presets/');
        const result = res.data;
        if (result.status === 'success') {
            setPresets(result.data);
        }
    } catch (error) {
        console.error("Failed to fetch curriculum presets:", error);
    }
}, []);

    // --- 4. FETCH BATCH APPROVALS ---
const fetchApprovals = useCallback(async () => {
    if (!selectedYearId) return;
    setLoading(true);
    try {
        // Axios native options parameter injection mapping matches URL properties cleanly
        const res = await api.get(`/api/subjects/stream-approvals/${streamId}/`, {
            params: { year_id: selectedYearId }
        });
        const result = res.data;
        if (result.status === 'success') {
            setPendingStudents(result.data);
        }
    } catch (error) {
        console.error("Failed to fetch approvals:", error);
    } finally {
        setLoading(false);
    }
}, [streamId, selectedYearId]);

    // Initial Load Sequence
    useEffect(() => {
        setLoading(true);
        fetchRules();
        fetchYearsAndInitialize();
        fetchPresets(); // Fetch the dynamic presets on mount
    }, [fetchRules, fetchYearsAndInitialize, fetchPresets]);

    // Re-fetch approvals whenever the selected year changes
    useEffect(() => {
        if (selectedYearId) {
            fetchApprovals();
        }
    }, [selectedYearId, fetchApprovals]);

    // --- HANDLERS ---
const handleSaveRules = async () => {
    if (rules.min_subjects > rules.max_subjects) {
        setRuleMessage({ type: 'error', text: 'Minimum subjects cannot exceed Maximum.' });
        return;
    }
    setSaving(true);
    setRuleMessage(null);
    try {
        const res = await api.post(`/api/subjects/rules/${gradeId}/`, rules);
        const result = res.data;
        if (result.status === 'success') {
            setRuleMessage({ type: 'success', text: 'Curriculum rules updated.' });
        } else {
            setRuleMessage({ type: 'error', text: result.message });
        }
    } catch (error: any) {
        console.error("Failed to update curriculum rules:", error);
        const errMsg = error.response?.data?.message || 'Failed to connect to the server.';
        setRuleMessage({ type: 'error', text: errMsg });
    } finally {
        setSaving(false);
        setTimeout(() => setRuleMessage(null), 4000);
    }
};

const handleBulkApprove = async () => {
    if (selectedStudents.length === 0) return;
    setLoading(true);
    try {
        const res = await api.post(`/api/subjects/bulk-approve/${streamId}/`, { 
            student_ids: selectedStudents, 
            year_id: selectedYearId 
        });
        const result = res.data;
        alert(result.message); 
        fetchApprovals();         // Refreshes structural UI layouts 
        setSelectedStudents([]);  // Slices selection variables cleanly
    } catch (error) {
        console.error("Bulk approval failed:", error);
    } finally {
        setLoading(false);
    }
};

    // UX Stepper Helpers
    const updateRule = (type: 'min' | 'max', delta: number) => {
        setRules(prev => {
            const newValue = type === 'min' ? prev.min_subjects + delta : prev.max_subjects + delta;
            if (newValue < 1) return prev; // Keep above 0
            return { ...prev, [type === 'min' ? 'min_subjects' : 'max_subjects']: newValue };
        });
    };

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) setSelectedStudents(pendingStudents.map(s => s.id));
        else setSelectedStudents([]);
    };

    const handleSelectStudent = (id: number) => {
        setSelectedStudents(prev => prev.includes(id) ? prev.filter(sId => sId !== id) : [...prev, id]);
    };

    if (loading) return <div className="p-6 text-center text-slate-500">Loading Curriculum Data...</div>;

    const totalPendingInClass = pendingStudents.reduce((acc, curr) => acc + curr.pending_count, 0);

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            
            {/* HEADER */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end bg-white p-6 rounded-xl shadow-sm border border-slate-100 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        Manage Curriculum
                        {!canEdit && (
                            <span className="flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded-full">
                                <Eye className="w-3 h-3" /> View only
                            </span>
                        )}
                    </h1>
                    <p className="text-slate-500 mt-1">{classNameTitle}</p>
                </div>
                
                {/* Dynamic Academic Year Dropdown */}
                <div className="flex flex-col items-end">
                    <label htmlFor="academic-year-select" className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Academic Year</label>
                    <div className="relative">
                        <select 
                            id="academic-year-select"
                            aria-label="Academic Year"
                            className="appearance-none bg-slate-50 border border-slate-200 text-slate-700 py-2 pl-4 pr-10 rounded-lg font-medium outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                            value={selectedYearId}
                            onChange={(e) => setSelectedYearId(e.target.value)}
                        >
                            {academicYears.map(year => (
                                <option key={year.id} value={year.id}>
                                    {year.year} {year.is_active ? '(Current)' : ''}
                                </option>
                            ))}
                        </select>
                        <ChevronDown className="w-4 h-4 text-slate-500 absolute right-3 top-3 pointer-events-none" />
                    </div>
                </div>
            </div>

            {/* TAB NAVIGATION */}
            <div className="flex bg-white rounded-lg p-1 shadow-sm border border-slate-100 w-max">
                <button 
                    onClick={() => setActiveTab('rules')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'rules' ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <Settings className="w-4 h-4" /> Global Rules
                </button>
                <button 
                    onClick={() => setActiveTab('approvals')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'approvals' ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <CheckSquare className="w-4 h-4" /> Batch Approvals
                    {totalPendingInClass > 0 && (
                        <span className="bg-emerald-100 text-emerald-700 py-0.5 px-2 rounded-full text-xs">{totalPendingInClass} Pending</span>
                    )}
                </button>
            </div>

            {/* --- TAB CONTENT: RULES EDITOR (UPGRADED UX) --- */}
            {activeTab === 'rules' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    
                    {/* Controls Column */}
                    <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 p-6">
                        <div className="mb-6">
                            <h2 className="text-lg font-bold text-slate-800">Subject Limits</h2>
                            <p className="text-sm text-slate-500 mt-1">Define boundaries for {classNameTitle}. This automatically guides students during selection.</p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-6 mb-8">
                            {/* Min Subjects Stepper */}
                            <div className="flex-1 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <label className="block text-sm font-bold text-slate-700 mb-4 text-center uppercase tracking-wider">Minimum Subjects</label>
                                <div className="flex items-center justify-center gap-4">
                                    <button aria-label="Decrease minimum subjects" disabled={!canEdit} onClick={() => updateRule('min', -1)} className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-100 transition disabled:opacity-40 disabled:cursor-not-allowed"><Minus className="w-5 h-5 text-slate-600" /></button>
                                    <span className="text-4xl font-black text-slate-800 w-16 text-center">{rules.min_subjects}</span>
                                    <button aria-label="Increase minimum subjects" disabled={!canEdit} onClick={() => updateRule('min', 1)} className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-100 transition disabled:opacity-40 disabled:cursor-not-allowed"><Plus className="w-5 h-5 text-slate-600" /></button>
                                </div>
                            </div>
                            
                            {/* Max Subjects Stepper */}
                            <div className={`flex-1 p-4 rounded-xl border ${rules.max_subjects < rules.min_subjects ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-100'}`}>
                                <label className={`block text-sm font-bold mb-4 text-center uppercase tracking-wider ${rules.max_subjects < rules.min_subjects ? 'text-red-700' : 'text-slate-700'}`}>Maximum Subjects</label>
                                <div className="flex items-center justify-center gap-4">
                                    <button aria-label="Decrease maximum subjects" disabled={!canEdit} onClick={() => updateRule('max', -1)} className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-100 transition disabled:opacity-40 disabled:cursor-not-allowed"><Minus className="w-5 h-5 text-slate-600" /></button>
                                    <span className={`text-4xl font-black w-16 text-center ${rules.max_subjects < rules.min_subjects ? 'text-red-700' : 'text-slate-800'}`}>{rules.max_subjects}</span>
                                    <button aria-label="Increase maximum subjects" disabled={!canEdit} onClick={() => updateRule('max', 1)} className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-100 transition disabled:opacity-40 disabled:cursor-not-allowed"><Plus className="w-5 h-5 text-slate-600" /></button>
                                </div>
                            </div>
                        </div>

                        {ruleMessage && (
                            <div className={`p-4 rounded-lg mb-6 flex items-start gap-3 text-sm font-medium ${ruleMessage.type === 'error' ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
                                {ruleMessage.type === 'error' ? <AlertCircle className="w-5 h-5 shrink-0" /> : <ShieldCheck className="w-5 h-5 shrink-0" />}
                                {ruleMessage.text}
                            </div>
                        )}

                        <div className="border-t border-slate-100 pt-6 flex justify-end">
                            <button
                                onClick={handleSaveRules}
                                disabled={!canEdit || saving || rules.min_subjects > rules.max_subjects}
                                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-lg font-bold transition disabled:opacity-50 shadow-sm"
                            >
                                {saving ? <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span> : <Save className="w-4 h-4" />}
                                {saving ? 'Saving...' : 'Lock Rules'}
                            </button>
                        </div>
                    </div>

                    {/* Quick Presets Sidebar (NOW DYNAMIC) */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 h-max">
                        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2 mb-4">
                            <Zap className="w-4 h-4 text-amber-500" /> Quick Presets
                        </h3>
                        <p className="text-xs text-slate-500 mb-4">Instantly apply common curriculum structures.</p>
                        
                        <div className="space-y-3">
                            {presets.length > 0 ? (
                                presets.map(preset => (
                                    <button
                                        key={preset.id}
                                        disabled={!canEdit}
                                        onClick={() => setRules({ min_subjects: preset.min_subjects, max_subjects: preset.max_subjects })}
                                        className="w-full flex justify-between items-center p-3 rounded-lg border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 transition text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:bg-transparent"
                                    >
                                        <span className="font-bold text-slate-700 text-sm">{preset.name}</span>
                                        <span className="text-xs text-slate-500">{preset.min_subjects} - {preset.max_subjects}</span>
                                    </button>
                                ))
                            ) : (
                                <div className="text-center py-4 text-xs text-slate-400 italic">
                                    No presets found in the database.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* --- TAB CONTENT: BATCH APPROVALS --- */}
            {activeTab === 'approvals' && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                    
                    {selectedStudents.length > 0 && canEdit && (
                        <div className="bg-emerald-50 border-b border-emerald-100 p-4 flex justify-between items-center">
                            <span className="text-emerald-800 font-medium text-sm">
                                {selectedStudents.length} students selected
                            </span>
                            <button
                                onClick={handleBulkApprove}
                                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                            >
                                <CheckCircle2 className="w-4 h-4" /> Approve All Selected
                            </button>
                        </div>
                    )}

                    <table className="w-full text-left text-sm text-slate-600">
                        <thead className="bg-slate-50 border-b border-slate-100 text-slate-500">
                            <tr>
                                <th className="p-4 w-12 text-center">
                                    <input
                                        type="checkbox"
                                        title="Select all pending students"
                                        aria-label="Select all pending students"
                                        disabled={!canEdit}
                                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                        onChange={handleSelectAll}
                                        checked={selectedStudents.length === pendingStudents.length && pendingStudents.length > 0}
                                    />
                                </th>
                                <th className="p-4 font-medium">Student Info</th>
                                <th className="p-4 font-medium text-center">Total Subjects</th>
                                <th className="p-4 font-medium">Status Snapshot</th>
                                <th className="p-4 font-medium text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {pendingStudents.map((student) => {
                                const isRuleViolation = student.total_selected < rules.min_subjects || student.total_selected > rules.max_subjects;
                                return (
                                    <tr key={student.id} className={`hover:bg-slate-50 transition ${selectedStudents.includes(student.id) ? 'bg-slate-50' : ''}`}>
                                        <td className="p-4 text-center">
                                            <input
                                                type="checkbox"
                                                title={`Select ${student.name}`}
                                                aria-label={`Select ${student.name}`}
                                                disabled={!canEdit}
                                                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                                checked={selectedStudents.includes(student.id)}
                                                onChange={() => handleSelectStudent(student.id)}
                                            />
                                        </td>
                                        <td className="p-4">
                                            <p className="font-bold text-slate-800">{student.name}</p>
                                            <p className="text-xs text-slate-500">{student.roll}</p>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className={`font-bold px-2.5 py-1 rounded-md ${isRuleViolation ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
                                                {student.total_selected}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col gap-1">
                                                {student.pending_count > 0 && (
                                                    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full w-max">
                                                        <Clock className="w-3 h-3" /> {student.pending_count} Pending Review
                                                    </span>
                                                )}
                                                {student.approved_count > 0 && (
                                                    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full w-max">
                                                        <ShieldCheck className="w-3 h-3" /> {student.approved_count} Approved
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <button 
                                                // UPDATED: Navigates properly
                                                onClick={() => navigate(`/admin-dashboard/classes/assign-subjects/${gradeId}/${student.id}`, { state: { studentName: student.name, academicYearId: selectedYearId } })} 
                                                className="text-blue-600 hover:text-blue-800 font-medium text-sm"
                                            >
                                                View & Assign
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                            {pendingStudents.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-slate-400">
                                        No pending subject approvals for this class in the selected academic year.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default ManageCurriculum;
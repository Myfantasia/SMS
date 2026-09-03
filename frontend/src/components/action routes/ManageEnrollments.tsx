import React, { useState, useEffect, useCallback } from 'react';
import { 
    ArrowRightLeft, UserCheck, AlertCircle, 
    CheckCircle2, XCircle, FileText, Bell 
} from 'lucide-react';
import BulkTransferModal from './BulkTransferModal';
import api from '../../libs/axiosInstance';
import SearchableSelect from '../common/SearchableSelect';

// --- TYPESCRIPT INTERFACES ---
interface Student {
    id: number;
    name: string;
    roll: string;
    enrollment_state: string;
    fee_balance?: number;
    subjects_assigned?: boolean;
    last_changed?: string;
    enrollment_notes?: string;
}

interface SiblingStream {
    id: number;
    name: string;
    capacity: number;
}

interface ClassInfo {
    name: string;
    grade: string;
    capacity: number;
}

interface ManageEnrollmentsProps {
    streamId?: number;
}

const ManageEnrollments: React.FC<ManageEnrollmentsProps> = ({ streamId = 1 }) => {
    const [activeTab, setActiveTab] = useState<'active' | 'exited'>('active');
    const [loading, setLoading] = useState<boolean>(true);
    
    const [roster, setRoster] = useState<Student[]>([]);
    const [exitedHistory, setExitedHistory] = useState<Student[]>([]);
    const [siblingStreams, setSiblingStreams] = useState<SiblingStream[]>([]);
    const [unassignedPool, setUnassignedPool] = useState<Student[]>([]);
    const [classInfo, setClassInfo] = useState<ClassInfo>({ name: '', grade: '', capacity: 40 });
    const [selectedStudents, setSelectedStudents] = useState<number[]>([]);
    
    const [isActionModalOpen, setIsActionModalOpen] = useState<boolean>(false);
    const [isBulkModalOpen, setIsBulkModalOpen] = useState<boolean>(false);
    const [targetStudent, setTargetStudent] = useState<Student | null>(null);
    const [actionForm, setActionForm] = useState({
        action: '', 
        stream_id: '',
        reason: '',
        notify_parent: false
    });

    const [isPullModalOpen, setIsPullModalOpen] = useState<boolean>(false);
    const [pullForm, setPullForm] = useState({ student_id: '' });

    // --- FETCH REAL DATA FROM DJANGO ---
    // Wrapped in useCallback so we can call it again after an action is completed to refresh the table
const fetchClassData = useCallback(async () => {
    try {
        setLoading(true);
        // Swapped native fetch for clean api.get configuration
        const response = await api.get(`/api/enrollments/class/${streamId}/`);
        const result = response.data;

        if (result.status === 'success') {
            const { stream_name, grade_name, active_roster, exited_history, sibling_streams, unassigned_pool } = result.data;
            
            setClassInfo({ name: stream_name, grade: grade_name, capacity: 40 }); 
            setRoster(active_roster);
            setExitedHistory(exited_history || []);
            setSiblingStreams(sibling_streams);
            setUnassignedPool(unassigned_pool);
        } else {
            console.error("API Error:", result.message);
        }
    } catch (error) {
        console.error("Failed to fetch enrollments:", error);
    } finally {
        setLoading(false);
    }
}, [streamId]);

    // Initial load
    useEffect(() => {
        if (streamId) {
            fetchClassData();
        }
    }, [streamId, fetchClassData]);

    // --- HANDLERS ---
    const handleSelectStudent = (id: number) => {
        setSelectedStudents(prev => 
            prev.includes(id) ? prev.filter(sId => sId !== id) : [...prev, id]
        );
    };

    // --- REAL BULK TRANSFER LOGIC ---
    const handleBulkTransferConfirm = async (targetStreamId: string) => {
    try {
        // Axios handles content headers and body parsing natively
        const response = await api.post('/api/enrollments/bulk-transfer/', {
            student_ids: selectedStudents,
            target_stream_id: parseInt(targetStreamId)
        });
        const result = response.data;
        
        if (result.status === 'success') {
            setSelectedStudents([]); 
            setIsBulkModalOpen(false);
            fetchClassData(); // Refreshes roster UI instantly
        } else {
            alert("Transfer failed: " + result.message);
        }
    } catch (error) {
        console.error("Bulk transfer error:", error);
    }
};


    const handlePullStudentSubmit = async () => {
    if (!pullForm.student_id) return;

    try {
        const response = await api.post(`/api/enrollments/manage-enrollment/${pullForm.student_id}/`, {
            action: 'reactivate',
            stream_id: streamId.toString(),
            reason: `Pulled into ${classInfo.grade} ${classInfo.name} via unassigned pool.`,
            notify_parent: false
        });
        const result = response.data;

        if (result.status === 'success') {
            setIsPullModalOpen(false);
            setPullForm({ student_id: '' }); 
            fetchClassData(); 
        } else {
            alert("Failed to pull student: " + result.message);
        }
    } catch (error) {
        console.error("Error executing unassigned pull:", error);
    }
};


    // --- REAL INDIVIDUAL ACTION LOGIC ---
    const submitAction = async () => {
    if (!targetStudent) return;

    try {
        // Axios natively handles JSON object serialization and applies appropriate Content-Type headers
        const response = await api.post(`/api/enrollments/manage-enrollment/${targetStudent.id}/`, actionForm);
        const result = response.data;

        if (result.status === 'success') {
            setIsActionModalOpen(false);
            fetchClassData(); // Refresh table visualization records
        } else {
            alert("Action failed: " + result.message);
        }
    } catch (error) {
        console.error("Action execution error:", error);
    }
};

    const openActionModal = (student: Student) => {
        setTargetStudent(student);
        setActionForm({ action: '', stream_id: '', reason: '', notify_parent: false });
        setIsActionModalOpen(true);
    };

    // --- RENDER HELPERS ---
    const getStatusBadge = (state: string) => {
        const styles: Record<string, string> = {
            'Active': 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40',
            'Suspended': 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/40',
            'Expelled': 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/40',
            'Transferred': 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/40',
            'Reactivated': 'bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/40'
        };
        return <span className={`px-3 py-1 rounded-full text-xs font-medium border ${styles[state] || 'bg-gray-100 dark:bg-slate-800'}`}>{state}</span>;
    };

    const displayStudents = activeTab === 'active' ? roster : exitedHistory;

    if (loading) return <div className="p-6 text-center text-slate-500 dark:text-slate-400 flex items-center justify-center gap-3"><span className="animate-spin h-5 w-5 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full"></span>Loading real-time enrollments...</div>;

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            {/* HEADER */}
            <div className="flex justify-between items-end bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Manage Enrollments</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">{classInfo.grade} {classInfo.name}</p>
                </div>
                <div className="flex gap-4 items-center">
                    <div className="text-right">
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Capacity</p>
                        <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{roster.length} / {classInfo.capacity}</p>
                    </div>
                    {/* PULL STUDENT BUTTON */}
                    <button
                        onClick={() => setIsPullModalOpen(true)}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition"
                    >
                        <UserCheck className="w-4 h-4" />
                        Pull Reactivated Student
                    </button>
                </div>
            </div>

            {/* TAB AND BULK ACTION BAR */}
            <div className="flex justify-between items-center">
                <div className="flex bg-white dark:bg-slate-900 rounded-lg p-1 shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700">
                    <button
                        onClick={() => setActiveTab('active')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'active' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        Active Roster ({roster.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('exited')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'exited' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        Ghost Roster / Exited ({exitedHistory.length})
                    </button>
                </div>

                {activeTab === 'active' && selectedStudents.length > 0 && (
                    <button
                        onClick={() => setIsBulkModalOpen(true)}
                        className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                    >
                        <ArrowRightLeft className="w-4 h-4" />
                        Bulk Transfer ({selectedStudents.length})
                    </button>
                )}
            </div>

            {/* MAIN TABLE */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
                    <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                        <tr>
                            {activeTab === 'active' && <th className="p-4 w-12"></th>}
                            <th className="p-4 font-medium">Student Info</th>
                            <th className="p-4 font-medium">Roll No</th>
                            <th className="p-4 font-medium">State</th>
                            <th className="p-4 font-medium">Fee Balance</th>
                            {activeTab === 'active' && <th className="p-4 font-medium text-center">Subjects</th>}
                            <th className="p-4 font-medium text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {displayStudents.map((student) => (
                            <tr key={student.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                                {activeTab === 'active' && (
                                    <td className="p-4">
                                        <input
                                            type="checkbox"
                                            className="rounded border-slate-300 dark:border-slate-600 text-blue-600 dark:text-blue-400 focus:ring-blue-500 dark:focus:ring-blue-400 cursor-pointer"
                                            checked={selectedStudents.includes(student.id)}
                                            onChange={() => handleSelectStudent(student.id)}
                                        />
                                    </td>
                                )}
                                <td className="p-4 font-medium text-slate-800 dark:text-slate-100">
                                    {student.name}
                                    {student.enrollment_notes && activeTab === 'exited' && (
                                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-normal line-clamp-1">{student.enrollment_notes}</p>
                                    )}
                                </td>
                                <td className="p-4">{student.roll}</td>
                                <td className="p-4">{getStatusBadge(student.enrollment_state)}</td>
                                <td className="p-4">
                                    <span className={(student.fee_balance || 0) > 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-emerald-600 dark:text-emerald-400'}>
                                        KES {(student.fee_balance || 0).toLocaleString()}
                                    </span>
                                </td>
                                {activeTab === 'active' && (
                                    <td className="p-4 text-center">
                                        {student.subjects_assigned
                                            ? <CheckCircle2 className="w-5 h-5 text-emerald-500 dark:text-emerald-400 mx-auto" />
                                            : <XCircle className="w-5 h-5 text-red-500 dark:text-red-400 mx-auto" />
                                        }
                                    </td>
                                )}
                                <td className="p-4 text-right">
                                    {activeTab === 'active' && (
                                        <button
                                            onClick={() => openActionModal(student)}
                                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium text-sm"
                                        >
                                            Manage
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* UNIFIED ACTION MODAL */}
            {isActionModalOpen && targetStudent && (
                <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl dark:shadow-none w-full max-w-lg overflow-hidden">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-700">
                            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Manage Status: {targetStudent.name}</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Current Status: {getStatusBadge(targetStudent.enrollment_state)}</p>
                        </div>

                        <div className="p-6 space-y-5 bg-slate-50/50 dark:bg-slate-800/40">
                            {/* FEE GUARDRAIL WARNING */}
                            {(targetStudent.fee_balance || 0) > 0 && (
                                <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/40 rounded-lg p-4 flex gap-3 text-red-800 dark:text-red-300">
                                    <AlertCircle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-400" />
                                    <div className="text-sm">
                                        <p className="font-bold">Outstanding Balance: KES {(targetStudent.fee_balance || 0).toLocaleString()}</p>
                                        <p>Please ensure clearance before processing external transfers or expulsions.</p>
                                    </div>
                                </div>
                            )}

                            {/* ACTION SELECTOR */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Select Action</label>
                                <select
                                    className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                                    value={actionForm.action}
                                    onChange={(e) => setActionForm({...actionForm, action: e.target.value})}
                                >
                                    <option value="">-- Choose an action --</option>
                                    {targetStudent.enrollment_state !== 'Active' && <option value="reactivate">Reactivate Student</option>}
                                    <option value="transfer">Internal Transfer (Change Stream)</option>
                                    <option value="suspend">Suspend Student</option>
                                    <option value="transfer_out">Transfer to Another School</option>
                                    <option value="expel">Expel Student</option>
                                </select>
                            </div>

                            {/* STREAM SELECTOR */}
                            {actionForm.action === 'transfer' && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Target Stream</label>
                                    <select
                                        className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                                        value={actionForm.stream_id}
                                        onChange={(e) => setActionForm({...actionForm, stream_id: e.target.value})}
                                    >
                                        <option value="">-- Select Sibling Stream --</option>
                                        {siblingStreams.map(s => (
                                            <option key={s.id} value={s.id}>{s.name} (Capacity: {s.capacity})</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* REASON / AUDIT LOG */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Reason / Notes (Required)</label>
                                <textarea
                                    className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                                    rows={3}
                                    placeholder="Enter reason for audit logs..."
                                    value={actionForm.reason}
                                    onChange={(e) => setActionForm({...actionForm, reason: e.target.value})}
                                />
                            </div>

                            {/* NOTIFICATION TOGGLE */}
                            <label className="flex items-center gap-3 p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                                <input
                                    type="checkbox"
                                    className="rounded border-slate-300 dark:border-slate-600 text-blue-600 dark:text-blue-400 w-4 h-4 cursor-pointer"
                                    checked={actionForm.notify_parent}
                                    onChange={(e) => setActionForm({...actionForm, notify_parent: e.target.checked})}
                                />
                                <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 select-none">
                                    <Bell className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                                    Send immediate alert to Parent Portal
                                </div>
                            </label>
                        </div>

                        <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-900">
                            <button className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition">
                                <FileText className="w-4 h-4" />
                                Generate Doc
                            </button>

                            <div className="flex gap-3">
                                <button onClick={() => setIsActionModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition">Cancel</button>
                                <button
                                    onClick={submitAction}
                                    disabled={!actionForm.action || !actionForm.reason}
                                    className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                >
                                    Execute Action
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* BULK TRANSFER MODAL */}
            <BulkTransferModal 
                isOpen={isBulkModalOpen} 
                onClose={() => setIsBulkModalOpen(false)} 
                onConfirm={handleBulkTransferConfirm} 
                siblingStreams={siblingStreams} 
                count={selectedStudents.length}
            />
            
            {/* PULL STUDENT MODAL */}
            {isPullModalOpen && (
                <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl dark:shadow-none w-full max-w-md p-6">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4">Pull Unassigned Student</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Select a Reactivated or Unassigned student to pull into {classInfo.grade} {classInfo.name}.</p>

                        <div className="mb-6">
                            <SearchableSelect
                                value={pullForm.student_id}
                                onChange={(val) => setPullForm({ student_id: val })}
                                placeholder="-- Select Student --"
                                searchPlaceholder="Search by name or roll no…"
                                options={unassignedPool.map(s => ({
                                    value: String(s.id),
                                    label: `${s.name} (${s.roll})`,
                                    sublabel: s.enrollment_state,
                                }))}
                            />
                        </div>

                        <div className="flex justify-end gap-3">
                            <button onClick={() => setIsPullModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition">Cancel</button>
                            <button
                               type="button"
                               onClick={handlePullStudentSubmit}
                               disabled={!pullForm.student_id}
                               className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                            >
                              Add to Class
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManageEnrollments;
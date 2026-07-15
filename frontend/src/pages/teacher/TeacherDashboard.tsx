import { useState, useEffect, type KeyboardEvent } from 'react';
import {
    Zap, ShieldAlert, Plus, CheckCircle2,
    AlertCircle, Clock, BookOpen, User,
    FileEdit, MoreVertical, Bell, PlusCircle, ClipboardCheck
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../libs/axiosInstance';

// --- TYPESCRIPT INTERFACES (Matches TeacherDashboardOverviewAPI payload) ---
interface Profile {
    name: string;
    subjects: string | null;
    profile_pic: string | null;
}

interface Notice {
    id: number;
    title: string;
    date: string;
    is_urgent: boolean;
}

interface TimetableSession {
    id: number;
    subject: string;
    class_name: string;
    start_time: string; // "HH:MM"
    end_time: string;   // "HH:MM"
    is_double_period: boolean;
    is_remedial: boolean;
}

// Present only for class ("homeroom") teachers — null for ordinary subject teachers.
// Kept as its own nullable block so future teacher sub-roles can add a sibling
// field here without disturbing this one.
interface HomeroomSummary {
    class_stream_id: number;
    class_name: string;
    student_count: number;
    attendance_submitted_today: boolean;
}

interface DashboardData {
    profile: Profile;
    notices: Notice[];
    today_timetable: TimetableSession[];
    is_class_teacher: boolean;
    homeroom: HomeroomSummary | null;
    action_items: {
        pending_exams: number;
        pending_assignments: number;
        unread_messages: number;
        pending_leaves: number;
    };
}

// Compares "HH:MM" wall-clock strings against right now to flag the current lesson.
function isSessionActiveNow(start: string, end: string): boolean {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    };
    return nowMinutes >= toMinutes(start) && nowMinutes < toMinutes(end);
}

export default function TeacherDashboard() {
    const navigate = useNavigate();
    const [data, setData] = useState<DashboardData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);

    // Interactive To-Do List State (The Teacher's personal scratchpad — not backend-persisted)
    const [todos, setTodos] = useState<{ id: number; text: string; done: boolean }[]>([]);
    const [newTodo, setNewTodo] = useState("");

    useEffect(() => {
        api.get('/api/teacher/dashboard-overview/')
            .then((res) => {
                if (res.data?.status === 'success') {
                    setData(res.data.data);
                } else {
                    setError(true);
                }
            })
            .catch((err) => {
                console.error("Failed to fetch teacher dashboard overview", err);
                setError(true);
            })
            .finally(() => setIsLoading(false));
    }, []);

    const handleAddTodo = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && newTodo.trim() !== "") {
            setTodos([{ id: Date.now(), text: newTodo, done: false }, ...todos]);
            setNewTodo("");
        }
    };

    const toggleTodo = (id: number) => {
        setTodos(todos.map(t => t.id === id ? { ...t, done: !t.done } : t));
    };

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return "Good Morning";
        if (hour < 18) return "Good Afternoon";
        return "Good Evening";
    };

    if (isLoading) {
        return (
            <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-pulse">
                <div className="h-24 bg-slate-200 rounded-2xl"></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => <div key={i} className="h-24 bg-slate-200 rounded-2xl"></div>)}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-7 h-96 bg-slate-200 rounded-2xl"></div>
                    <div className="lg:col-span-5 h-96 bg-slate-200 rounded-2xl"></div>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="p-8 text-center text-slate-500">
                <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                Couldn't load your workspace right now. Please refresh the page.
            </div>
        );
    }

    const firstName = data.profile.name.split(' ')[0];
    const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    return (
        <div className="max-w-7xl mx-auto space-y-6">

            {/* ==========================================
                ROW 1: WELCOME & OMNI-ACTION BAR
            ========================================== */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">{getGreeting()}, {firstName}.</h1>
                    <p className="text-slate-500 text-sm mt-1">{todayLabel}{data.profile.subjects ? ` • ${data.profile.subjects}` : ''}</p>
                </div>

                {/* The Omni-Bar (Frictionless Actions) — Attendance only makes sense for class teachers,
                    since ordinary subject teachers have no homeroom register to submit. */}
                <div className="flex gap-3 w-full md:w-auto">
                    {data.is_class_teacher && (
                        <button onClick={() => navigate('/teacher-dashboard/attendance')} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-blue-50 text-blue-700 hover:bg-blue-100 px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
                            <Zap className="w-4 h-4" /> Attendance
                        </button>
                    )}
                    <button onClick={() => navigate('/teacher-dashboard/leave-requests')} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-orange-50 text-orange-700 hover:bg-orange-100 px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
                        <ShieldAlert className="w-4 h-4" /> Leave
                    </button>
                    <button onClick={() => navigate('/teacher-dashboard/assignments/create')} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm shadow-indigo-200">
                        <Plus className="w-4 h-4" /> Assignment
                    </button>
                </div>
            </div>

            {/* ==========================================
                HOMEROOM STRIP — class teachers only. Ordinary subject teachers never see this.
            ========================================== */}
            {data.is_class_teacher && data.homeroom && (
                <div className="bg-indigo-600 rounded-2xl shadow-sm p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-white">
                    <div className="flex items-center gap-3">
                        <div className="bg-white/15 p-2.5 rounded-xl"><User className="w-5 h-5" /></div>
                        <div>
                            <p className="text-xs font-bold uppercase tracking-widest text-indigo-200">Your Homeroom</p>
                            <p className="font-bold">{data.homeroom.class_name} &middot; {data.homeroom.student_count} students</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {data.homeroom.attendance_submitted_today ? (
                            <span className="flex items-center gap-1.5 text-xs font-semibold bg-white/15 px-3 py-1.5 rounded-full">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Today's register submitted
                            </span>
                        ) : (
                            <button
                                onClick={() => navigate('/teacher-dashboard/attendance')}
                                className="flex items-center gap-1.5 text-xs font-bold bg-white text-indigo-700 px-3 py-1.5 rounded-full hover:bg-indigo-50 transition-colors"
                            >
                                <Zap className="w-3.5 h-3.5" /> Submit today's register
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ==========================================
                ROW 2: THE GLANCE CARDS (real action_items)
            ========================================== */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
                <div onClick={() => navigate('/teacher-dashboard/assignments')} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-start gap-4 hover:border-blue-200 cursor-pointer transition-all">
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><FileEdit className="w-6 h-6" /></div>
                    <div>
                        <p className="text-slate-500 text-sm font-medium">Actionable Inbox</p>
                        <h3 className="text-xl font-bold text-slate-800 mt-1">{data.action_items.pending_assignments} Assignments</h3>
                        <p className="text-xs text-blue-600 mt-1 font-medium">Click to grade now →</p>
                    </div>
                </div>

                <div onClick={() => navigate('/teacher-dashboard/exams')} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-start gap-4 hover:border-orange-200 cursor-pointer transition-all">
                    <div className="p-3 bg-orange-50 text-orange-500 rounded-xl"><ClipboardCheck className="w-6 h-6" /></div>
                    <div>
                        <p className="text-slate-500 text-sm font-medium">Draft Exams</p>
                        <h3 className="text-xl font-bold text-slate-800 mt-1">{data.action_items.pending_exams} Awaiting Finalization</h3>
                        <p className="text-xs text-orange-600 mt-1 font-medium">Review and publish →</p>
                    </div>
                </div>

                <div onClick={() => navigate('/teacher-dashboard/messages')} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-start gap-4 hover:border-green-200 cursor-pointer transition-all">
                    <div className="p-3 bg-green-50 text-green-600 rounded-xl"><Bell className="w-6 h-6" /></div>
                    <div>
                        <p className="text-slate-500 text-sm font-medium">Communications</p>
                        <h3 className="text-xl font-bold text-slate-800 mt-1">{data.action_items.unread_messages} Unread</h3>
                        <p className="text-xs text-green-600 mt-1 font-medium">Open Messages →</p>
                    </div>
                </div>
            </div>

            {/* ==========================================
                ROW 3: THE MAIN CANVAS (60/40 Split)
            ========================================== */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                {/* LEFT: Live HUD Timetable (Col Span 7) */}
                <div className="lg:col-span-7 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col">
                    <div className="p-5 border-b border-slate-50 flex justify-between items-center">
                        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <Clock className="w-5 h-5 text-slate-400" /> Today's Timeline
                        </h2>
                        <span className="text-xs font-semibold bg-slate-100 text-slate-500 px-3 py-1 rounded-full">
                            {data.today_timetable.length} Classes
                        </span>
                    </div>
                    <div className="p-5 space-y-4 flex-1">
                        {data.today_timetable.length === 0 ? (
                            <div className="text-center py-10 text-slate-400 text-sm">No lessons scheduled for you today.</div>
                        ) : data.today_timetable.map((session) => {
                            const activeNow = isSessionActiveNow(session.start_time, session.end_time);
                            return (
                                <div
                                    key={session.id}
                                    className={`p-4 rounded-xl flex gap-4 transition-all border ${
                                        activeNow
                                        ? 'bg-indigo-50/50 border-indigo-200 shadow-sm'
                                        : 'bg-slate-50 border-transparent hover:border-slate-200'
                                    }`}
                                >
                                    {/* Time Column */}
                                    <div className="flex flex-col items-end justify-center min-w-17.5">
                                        <span className={`font-bold ${activeNow ? 'text-indigo-700' : 'text-slate-700'}`}>
                                            {session.start_time}
                                        </span>
                                        <span className="text-xs text-slate-400">{session.end_time}</span>
                                    </div>

                                    {/* Divider Line */}
                                    <div className={`w-1 rounded-full ${activeNow ? 'bg-indigo-500' : 'bg-slate-200'}`}></div>

                                    {/* Details Column */}
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className={`font-bold ${activeNow ? 'text-indigo-900' : 'text-slate-800'}`}>
                                                    {session.class_name}
                                                </h3>
                                                <p className={`text-sm ${activeNow ? 'text-indigo-600' : 'text-slate-500'} flex items-center gap-1 mt-1`}>
                                                    <BookOpen className="w-3 h-3" /> {session.subject}
                                                </p>
                                            </div>
                                            {activeNow && (
                                                <button onClick={() => navigate('/teacher-dashboard/attendance')} className="bg-white border border-indigo-200 text-indigo-700 text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors shadow-sm flex items-center gap-1">
                                                    <User className="w-3 h-3" /> Open Roster
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* RIGHT: Teacher's Desk & Notices (Col Span 5) */}
                <div className="lg:col-span-5 space-y-6">

                    {/* The Teacher's Desk (local To-Do List — personal scratchpad, not synced) */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
                        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                            <CheckCircle2 className="w-5 h-5 text-slate-400" /> Teacher's Desk
                        </h2>

                        <div className="relative mb-4">
                            <input
                                type="text"
                                placeholder="Add a quick task and press Enter..."
                                value={newTodo}
                                onChange={(e) => setNewTodo(e.target.value)}
                                onKeyDown={handleAddTodo}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition-all"
                            />
                            <PlusCircle className="absolute right-3 top-2.5 w-5 h-5 text-slate-400" />
                        </div>

                        <div className="space-y-2 max-h-50 overflow-y-auto pr-2">
                            {todos.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center py-4">Nothing on your desk yet.</p>
                            ) : todos.map(todo => (
                                <div
                                    key={todo.id}
                                    onClick={() => toggleTodo(todo.id)}
                                    className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer group"
                                >
                                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${todo.done ? 'bg-green-500 border-green-500' : 'border-slate-300 group-hover:border-indigo-400'}`}>
                                        {todo.done && <CheckCircle2 className="w-3 h-3 text-white" />}
                                    </div>
                                    <span className={`text-sm select-none transition-colors ${todo.done ? 'text-slate-400 line-through' : 'text-slate-700 font-medium'}`}>
                                        {todo.text}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* School Notices Feed */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <AlertCircle className="w-5 h-5 text-slate-400" /> Notice Board
                            </h2>
                            <MoreVertical onClick={() => navigate('/teacher-dashboard/notices')} className="w-4 h-4 text-slate-400 cursor-pointer" />
                        </div>
                        <div className="space-y-3">
                            {data.notices.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center py-4">No notices right now.</p>
                            ) : data.notices.map((notice) => (
                                <div key={notice.id} className={`p-3 rounded-xl border-l-4 bg-slate-50 ${notice.is_urgent ? 'border-l-red-500' : 'border-l-blue-500'}`}>
                                    <h4 className="text-sm font-bold text-slate-800">{notice.title}</h4>
                                    <p className="text-xs text-slate-500 mt-1">{notice.date}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}

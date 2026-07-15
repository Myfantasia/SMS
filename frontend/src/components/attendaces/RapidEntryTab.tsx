import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Save, Loader2 } from 'lucide-react';
import AttendanceFilter from './AttendanceFilter';
import AttendanceGrid from './AttendanceGrid';
import api from '../../libs/axiosInstance';
import type { ClassOption, AttendanceRosterStudent } from '../../libs/types';

export type StatusType = 'Present' | 'Absent' | 'Late' | 'Excused';
export interface ExceptionRecord { status: StatusType; remarks: string; }

// 1. Define the props to receive the role
interface RapidEntryProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

// 2. Accept the role prop
export default function RapidEntryTab({ role }: RapidEntryProps) {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [students, setStudents] = useState<AttendanceRosterStudent[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [submittedBy, setSubmittedBy] = useState<string | null>(null);

  const [exceptions, setExceptions] = useState<Record<number, ExceptionRecord>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch the classes this user is allowed to take a register for.
  useEffect(() => {
    const fetchClasses = async () => {
      setLoadingClasses(true);
      try {
        const res = await api.get('/api/manage-classes/');
        if (res.data.status === 'success') {
          const flat: ClassOption[] = [];
          res.data.data.forEach((grade: any) => {
            grade.streams.forEach((s: any) => {
              flat.push({ id: s.id, name: s.name, is_current_user_class_teacher: s.is_current_user_class_teacher });
            });
          });
          const usable = role === 'teacher' ? flat.filter(c => c.is_current_user_class_teacher) : flat;
          setClasses(usable);
          if (role === 'teacher' && usable.length > 0) setSelectedClass(usable[0].id.toString());
        }
      } catch (error) {
        console.error("Error fetching classes:", error);
        toast.error("Failed to load class list.");
      } finally {
        setLoadingClasses(false);
      }
    };
    fetchClasses();
  }, [role]);

  const loadRoster = useCallback(async () => {
    if (!selectedClass) {
      toast.error('Please select a class stream first.');
      return;
    }
    setLoadingRoster(true);
    try {
      const res = await api.get(`/attendance/roster/${selectedClass}/${selectedDate}/`);
      if (res.data) {
        setStudents(res.data.students || []);
        setAlreadySubmitted(!!res.data.already_submitted);
        setSubmittedBy(res.data.submitted_by || null);

        // Seed exceptions from any student who isn't Present, so the grid reflects
        // an already-submitted register accurately.
        const seeded: Record<number, ExceptionRecord> = {};
        (res.data.students || []).forEach((s: AttendanceRosterStudent) => {
          if (s.status !== 'Present') seeded[s.id] = { status: s.status, remarks: s.remarks };
        });
        setExceptions(seeded);
      }
    } catch (error: any) {
      console.error("Error loading roster:", error);
      const msg = error.response?.data?.error || "Failed to load class roster.";
      toast.error(msg);
      setStudents([]);
    } finally {
      setLoadingRoster(false);
    }
  }, [selectedClass, selectedDate]);

  // Teachers see their one class automatically; the roster reloads whenever the date changes.
  useEffect(() => {
    if (role === 'teacher' && selectedClass) {
      loadRoster();
    }
  }, [role, selectedClass, selectedDate, loadRoster]);

  const handleStatusChange = (studentId: number, status: StatusType) => {
    setExceptions(prev => {
      const updated = { ...prev };
      if (status === 'Present') delete updated[studentId];
      else updated[studentId] = { status, remarks: updated[studentId]?.remarks || '' };
      return updated;
    });
  };

  const handleRemarksChange = (studentId: number, remarks: string) => {
    setExceptions(prev => ({
      ...prev,
      [studentId]: { ...prev[studentId], remarks }
    }));
  };

  const handleSubmit = async () => {
    if (!selectedClass) {
      toast.error('Please select a class stream first.');
      return;
    }
    if (students.length === 0) {
      toast.error('Load the class roster before submitting.');
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = {
        class_stream_id: Number(selectedClass),
        date: selectedDate,
        exceptions: Object.entries(exceptions).map(([studentId, ex]) => ({
          student_id: Number(studentId),
          status: ex.status,
          remarks: ex.remarks || ''
        }))
      };
      const res = await api.post('/attendance/submit/', payload);
      toast.success(res.data.message || 'Attendance submitted successfully! Parents notified.');
      await loadRoster();
    } catch (error: any) {
      console.error("Error submitting attendance:", error);
      const msg = error.response?.data?.error || "Failed to submit attendance register.";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedClassName = classes.find(c => c.id.toString() === selectedClass)?.name || '';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">

      {/* 3. Pass the role down to the Filter component */}
      <AttendanceFilter
        role={role}
        classes={classes}
        loadingClasses={loadingClasses}
        teacherClassName={selectedClassName}
        selectedClass={selectedClass}
        setSelectedClass={setSelectedClass}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        onLoadRoster={loadRoster}
        isLoadingRoster={loadingRoster}
      />

      {alreadySubmitted && (
        <div className="mx-6 mt-4 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg font-medium">
          Register already submitted{submittedBy ? ` by ${submittedBy}` : ''} for this date — showing a read-only view.
        </div>
      )}

      {loadingRoster ? (
        <div className="p-12 flex items-center justify-center text-slate-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading roster...
        </div>
      ) : students.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-sm">
          {selectedClass ? 'No roster loaded yet.' : 'Select a class to begin.'}
        </div>
      ) : (
        <AttendanceGrid
          students={students}
          exceptions={exceptions}
          onStatusChange={handleStatusChange}
          onRemarksChange={handleRemarksChange}
          readOnly={alreadySubmitted}
        />
      )}

      {/* Footer Submit Bar */}
      {students.length > 0 && !alreadySubmitted && (
        <div className="p-6 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-sm text-slate-600">
            <span className="font-semibold text-slate-800">{Object.keys(exceptions).length}</span> exceptions noted out of <span className="font-semibold text-slate-800">{students.length}</span> students.
          </div>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:ring-4 focus:ring-blue-200 transition-all disabled:opacity-70"
          >
            {isSubmitting ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-5 h-5" />}
            Submit Daily Register
          </button>
        </div>
      )}
    </div>
  );
}

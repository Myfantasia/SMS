import { useState } from 'react';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import AttendanceFilter from './AttendanceFilter';
import AttendanceGrid from './AttendanceGrid';

// --- MOCK DATA ---
const MOCK_CLASSES = [
  { id: 1, name: 'Grade 9 East' },
  { id: 2, name: 'Grade 9 West' },
  { id: 3, name: 'Form 1 Alpha' },
];

const MOCK_STUDENTS = [
  { id: 101, name: 'John Doe', roll: 'ADM-001' },
  { id: 102, name: 'Jane Smith', roll: 'ADM-002' },
  { id: 103, name: 'Michael Johnson', roll: 'ADM-003' },
  { id: 104, name: 'Sarah Williams', roll: 'ADM-004' },
  { id: 105, name: 'David Brown', roll: 'ADM-005' },
];

export type StatusType = 'Present' | 'Absent' | 'Late' | 'Excused';
export interface ExceptionRecord { status: StatusType; remarks: string; }

// 1. Define the props to receive the role
interface RapidEntryProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

// 2. Accept the role prop
export default function RapidEntryTab({ role }: RapidEntryProps) {
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [exceptions, setExceptions] = useState<Record<number, ExceptionRecord>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    if (!selectedClass && role === 'admin') {
      toast.error('Please select a class stream first.');
      return;
    }
    setIsSubmitting(true);
    
    // Simulate API Call
    setTimeout(() => {
      toast.success('Attendance submitted successfully! Parents notified.');
      setExceptions({}); 
      setIsSubmitting(false);
    }, 1000);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      
      {/* 3. Pass the role down to the Filter component */}
      <AttendanceFilter 
        role={role}
        classes={MOCK_CLASSES}
        selectedClass={selectedClass}
        setSelectedClass={setSelectedClass}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
      />

      <AttendanceGrid 
        students={MOCK_STUDENTS}
        exceptions={exceptions}
        onStatusChange={handleStatusChange}
        onRemarksChange={handleRemarksChange}
      />

      {/* Footer Submit Bar */}
      <div className="p-6 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-slate-800">{Object.keys(exceptions).length}</span> exceptions noted out of <span className="font-semibold text-slate-800">{MOCK_STUDENTS.length}</span> students.
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
    </div>
  );
}
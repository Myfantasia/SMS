import { Users, Calendar, Filter, Loader2 } from 'lucide-react';
import type { ClassOption } from '../../libs/types';

interface FilterProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
  classes: ClassOption[];
  loadingClasses: boolean;
  teacherClassName: string;
  selectedClass: string;
  setSelectedClass: (id: string) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  onLoadRoster: () => void;
  isLoadingRoster: boolean;
}

export default function AttendanceFilter({
  role, classes, loadingClasses, teacherClassName, selectedClass, setSelectedClass,
  selectedDate, setSelectedDate, onLoadRoster, isLoadingRoster
}: FilterProps) {
  return (
    <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row gap-4 items-end">

      {/* --- ADMIN VIEW: Can select any class --- */}
      {role === 'admin' && (
        <div className="flex-1 w-full">
          <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Select Class</label>
          <div className="relative">
            <Users className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              disabled={loadingClasses}
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white text-slate-700 disabled:opacity-60"
            >
              <option value="">-- Choose Class Stream --</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* --- TEACHER VIEW: Read-only class display, resolved from their profile --- */}
      {role === 'teacher' && (
        <div className="flex-1 w-full">
          <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">My Assigned Class</label>
          <div className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg bg-slate-100 text-slate-600 font-medium flex items-center relative">
            <Users className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <span>{loadingClasses ? 'Loading...' : (teacherClassName || 'No class assigned')}</span>
          </div>
        </div>
      )}

      {/* Shared Date Picker */}
      <div className="flex-1 w-full">
        <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Date</label>
        <div className="relative">
          <Calendar className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-700"
          />
        </div>
      </div>

      {role === 'admin' && (
        <button
          type="button"
          onClick={onLoadRoster}
          disabled={!selectedClass || isLoadingRoster}
          className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-300 transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          {isLoadingRoster ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />} Load Roster
        </button>
      )}
    </div>
  );
}

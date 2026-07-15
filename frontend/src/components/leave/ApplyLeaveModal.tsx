import { useState, useEffect } from 'react';
import { X, CalendarDays, AlignLeft, Tag, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import type { LeaveType, TeacherLeaveRequest } from '../../libs/types';

interface ApplyLeaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: TeacherLeaveRequest | null;
}

const LEAVE_TYPE_OPTIONS: { value: LeaveType; label: string }[] = [
  { value: 'Casual', label: 'Casual Leave' },
  { value: 'Sick', label: 'Medical / Sick Leave' },
  { value: 'Maternity', label: 'Maternity / Paternity Leave' },
  { value: 'Seminar', label: 'Official Duty / Seminar' },
  { value: 'Compassionate', label: 'Compassionate Leave' },
];

export default function ApplyLeaveModal({ isOpen, onClose, onSuccess, initialData }: ApplyLeaveModalProps) {
  const [leaveType, setLeaveType] = useState<LeaveType>('Casual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialData) {
      setLeaveType(initialData.leave_type);
      setStartDate(initialData.start_date);
      setEndDate(initialData.end_date);
      setReason(initialData.reason || '');
    } else {
      setLeaveType('Casual');
      setStartDate('');
      setEndDate('');
      setReason('');
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const durationDays = startDate && endDate
    ? Math.max(0, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1)
    : 0;
  const isLongTerm = durationDays > 7;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (startDate && endDate && startDate > endDate) {
      toast.error('Start date cannot be after the end date.');
      return;
    }

    setIsSubmitting(true);
    const payload = { leave_type: leaveType, start_date: startDate, end_date: endDate, reason };

    try {
      if (initialData) {
        await api.put(`/api/core/leaves/${initialData.id}/`, payload);
        toast.success('Leave application updated.');
      } else {
        await api.post('/api/core/leaves/', payload);
        toast.success('Leave application submitted for approval.');
      }
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error saving leave request:', error);
      const message = error?.response?.data?.non_field_errors?.[0]
        || error?.response?.data?.detail
        || 'Failed to submit leave request. Please check your details.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">
            {initialData ? 'Edit Leave Application' : 'Apply for Leave'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Leave Type *</label>
            <div className="relative">
              <Tag className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select
                required
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-slate-700 appearance-none"
              >
                {LEAVE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Start Date *</label>
              <div className="relative">
                <CalendarDays className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  required
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-slate-700"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">End Date *</label>
              <div className="relative">
                <CalendarDays className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  required
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-slate-700"
                />
              </div>
            </div>
          </div>

          {durationDays > 0 && (
            <div className={`flex items-start gap-2 text-xs font-semibold px-3 py-2.5 rounded-lg border ${isLongTerm ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {durationDays} day{durationDays === 1 ? '' : 's'} requested.
                {isLongTerm && ' This qualifies as long-term leave — the admin may assign a relief teacher to cover your workload upon approval.'}
              </span>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Reason (optional)</label>
            <div className="relative">
              <AlignLeft className="w-5 h-5 absolute left-3 top-3 text-slate-400" />
              <textarea
                rows={4}
                placeholder="Add any context for the admin reviewing this request..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none text-slate-700"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-70 shadow-sm"
            >
              {isSubmitting ? 'Submitting...' : (initialData ? 'Update Application' : 'Submit Application')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

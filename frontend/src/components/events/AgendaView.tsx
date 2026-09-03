import { Clock, Edit, Trash2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SchoolEvent } from './EventsHub';
import api from '../../libs/axiosInstance';


interface AgendaViewProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
  events: SchoolEvent[];
  onRefresh: () => void;
  onEdit: (event: SchoolEvent) => void; // Added onEdit prop
}

export default function AgendaView({ role, events, onRefresh, onEdit }: AgendaViewProps) {

  const getBadgeStyle = (type: string) => {
    switch(type) {
      case 'Exam': return 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/40';
      case 'Holiday': return 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40';
      case 'Meeting': return 'bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/40';
      case 'Sports': return 'bg-orange-100 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/40';
      default: return 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/40';
    }
  };

  // The actual logic that speaks to your Django API
  const executeDelete = async (id: number) => {
    const loadingToast = toast.loading("Purging event from records...");
    try {
      await api.delete(`/api/core/events/${id}/`);
      toast.success("Event permanently deleted.", { id: loadingToast });
      onRefresh(); // Refresh the feed automatically
    } catch (error) {
      console.error("Failed to delete", error);
      toast.error("Critical: Could not complete deletion.", { id: loadingToast });
    }
  };

  // Professional Interactive Toast for Confirmation
  const handleDeleteRequest = (id: number) => {
    toast.custom((t) => (
      <div
        className={`${
          t.visible ? 'animate-enter' : 'animate-leave'
        } max-w-md w-full bg-white dark:bg-slate-900 shadow-2xl dark:shadow-none rounded-xl pointer-events-auto flex ring-1 ring-black ring-opacity-5 overflow-hidden border border-slate-200 dark:border-slate-700`}
      >
        <div className="flex-1 w-0 p-4">
          <div className="flex items-start">
            <div className="shrink-0 pt-0.5">
              <div className="p-2 bg-red-100 dark:bg-red-500/10 rounded-full">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
            </div>
            <div className="ml-4 flex-1">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Confirm Permanent Deletion
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                This event will be removed from both the dashboard and the public website.
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <button
              onClick={() => toast.dismiss(t.id)}
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-all uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                toast.dismiss(t.id);
                executeDelete(id);
              }}
              className="px-4 py-2 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-sm shadow-red-200 dark:shadow-none uppercase tracking-wider"
            >
              Delete Event
            </button>
          </div>
        </div>
      </div>
    ), { duration: Infinity, position: 'top-center' });
  };

  if (events.length === 0) {
    return (
      <div className="text-center py-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl">
        <p className="text-slate-500 dark:text-slate-400 font-medium">No upcoming events found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {events.map((event) => {
        const startDate = new Date(event.start_time);
        const month = startDate.toLocaleString('default', { month: 'short' }).toUpperCase();
        const day = startDate.getDate();
        const time = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return (
          <div key={event.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-0 flex shadow-sm dark:shadow-none hover:shadow-md dark:hover:shadow-none transition-shadow group overflow-hidden">

            <div className="bg-slate-50 dark:bg-slate-800/40 w-24 flex flex-col items-center justify-center border-r border-slate-200 dark:border-slate-700 py-6 shrink-0">
              <span className="text-sm font-bold text-slate-500 dark:text-slate-400 tracking-wider">{month}</span>
              <span className="text-3xl font-black text-slate-800 dark:text-slate-100">{day}</span>
            </div>

            <div className="p-5 flex-1 flex flex-col justify-center relative">
              <div className="flex justify-between items-start mb-2">
                <span className={`px-2.5 py-1 text-xs font-bold rounded-md border ${getBadgeStyle(event.event_type)}`}>
                  {event.event_type}
                </span>

                {/* Admin Controls */}
                {role === 'admin' && (
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onEdit(event)}
                      className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-md transition-colors"
                      title="Edit Event"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteRequest(event.id)}
                      className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors"
                      title="Delete Event"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1 pr-12">{event.title}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-4 leading-relaxed line-clamp-2">
                {event.description}
              </p>

              <div className="flex items-center gap-4 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{time}</span>
                </div>
                {!event.is_active && (
                  <span className="text-orange-600 dark:text-orange-400 italic font-bold uppercase tracking-wider">Draft Mode</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

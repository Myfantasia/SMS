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
      case 'Exam': return 'bg-red-100 text-red-700 border-red-200';
      case 'Holiday': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'Meeting': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'Sports': return 'bg-orange-100 text-orange-700 border-orange-200';
      default: return 'bg-blue-100 text-blue-700 border-blue-200';
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
        } max-w-md w-full bg-white shadow-2xl rounded-xl pointer-events-auto flex ring-1 ring-black ring-opacity-5 overflow-hidden border border-slate-200`}
      >
        <div className="flex-1 w-0 p-4">
          <div className="flex items-start">
            <div className="shrink-0 pt-0.5">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
            </div>
            <div className="ml-4 flex-1">
              <p className="text-sm font-bold text-slate-900">
                Confirm Permanent Deletion
              </p>
              <p className="mt-1 text-sm text-slate-500">
                This event will be removed from both the dashboard and the public website.
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <button
              onClick={() => toast.dismiss(t.id)}
              className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-all uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                toast.dismiss(t.id);
                executeDelete(id);
              }}
              className="px-4 py-2 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-sm shadow-red-200 uppercase tracking-wider"
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
      <div className="text-center py-20 bg-white border border-slate-200 rounded-xl">
        <p className="text-slate-500 font-medium">No upcoming events found.</p>
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
          <div key={event.id} className="bg-white border border-slate-200 rounded-xl p-0 flex shadow-sm hover:shadow-md transition-shadow group overflow-hidden">
            
            <div className="bg-slate-50 w-24 flex flex-col items-center justify-center border-r border-slate-200 py-6 shrink-0">
              <span className="text-sm font-bold text-slate-500 tracking-wider">{month}</span>
              <span className="text-3xl font-black text-slate-800">{day}</span>
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
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" 
                      title="Edit Event"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDeleteRequest(event.id)} 
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" 
                      title="Delete Event"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <h3 className="text-lg font-bold text-slate-800 mb-1 pr-12">{event.title}</h3>
              <p className="text-sm text-slate-600 mb-4 leading-relaxed line-clamp-2">
                {event.description}
              </p>

              <div className="flex items-center gap-4 text-xs font-semibold text-slate-500">
                <div className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded-md">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{time}</span>
                </div>
                {!event.is_active && (
                  <span className="text-orange-600 italic font-bold uppercase tracking-wider">Draft Mode</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
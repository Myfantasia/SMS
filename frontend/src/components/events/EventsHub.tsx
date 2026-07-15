import { useState, useEffect } from 'react';
import { Calendar as CalendarIcon, List, Plus, Loader2, CalendarDays } from 'lucide-react';
import toast from 'react-hot-toast';
import AgendaView from './AgendaView';
import EventFormModal from './EventFormModal';
import CalendarView from './CalendarView';
import api from '../../libs/axiosInstance';

interface EventsHubProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

// 1. Define the TypeScript shape of our Django Event model
export interface SchoolEvent {
  id: number;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  event_type: string;
  is_active: boolean;
}

export default function EventsHub({ role }: EventsHubProps) {
  const [activeView, setActiveView] = useState<'agenda' | 'calendar'>('agenda');
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // NEW: State to track which event we are currently editing
  const [editingEvent, setEditingEvent] = useState<SchoolEvent | null>(null);
  
  // 2. State to hold our real database records
  const [events, setEvents] = useState<SchoolEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 3. The Fetch Function (Calls Django)
  const fetchEvents = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/api/core/events/');
      setEvents(response.data);
    } catch (error) {
      console.error("Error fetching events:", error);
      toast.error("Failed to load events from the database.");
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Run the fetch immediately when the component loads
  useEffect(() => {
    fetchEvents();
  }, []);

  // NEW: Function to open modal with existing data
  const handleEditEvent = (event: SchoolEvent) => {
    setEditingEvent(event);
    setIsModalOpen(true);
  };

  // NEW: Function to safely close modal and clear edit state
  const handleCloseModal = () => {
    setEditingEvent(null);
    setIsModalOpen(false);
  };

  // NEW: Ensure clicking "Add Event" clears any old edit state
  const handleOpenNewModal = () => {
    setEditingEvent(null);
    setIsModalOpen(true);
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-amber-600 bg-amber-50">
            <CalendarDays className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">School Calendar & Events</h1>
            <p className="text-slate-500 text-sm mt-0.5">Manage activities across the public website and internal dashboards.</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveView('agenda')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeView === 'agenda' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <List className="w-4 h-4" /> Agenda
            </button>
            <button
              onClick={() => setActiveView('calendar')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeView === 'calendar' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <CalendarIcon className="w-4 h-4" /> Calendar
            </button>
          </div>

          {role === 'admin' && (
            <button 
              onClick={handleOpenNewModal}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Event
            </button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <>
          {/* Pass the real events down to the Agenda */}
          {activeView === 'agenda' && (
            <AgendaView 
                role={role} 
                events={events} 
                onRefresh={fetchEvents} 
                onEdit={handleEditEvent} // Passed down to handle Edit clicks
            />
          )}
          
          {activeView === 'calendar' && (
            <CalendarView role={role} events={events} />
          )}
        </>
      )}

      {/* Pass the fetchEvents function to the modal so it can refresh the list on save */}
      <EventFormModal 
        isOpen={isModalOpen} 
        onClose={handleCloseModal} 
        onSuccess={fetchEvents}
        initialData={editingEvent} // Passed down to populate the form for edits
      />
    </div>
  );
}
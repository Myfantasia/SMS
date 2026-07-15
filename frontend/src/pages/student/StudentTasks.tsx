import { useEffect, useState } from 'react';
import { ListChecks, Plus, Trash2, Calendar, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface StudentTask {
  id: number;
  title: string;
  due_date: string | null;
  is_done: boolean;
  created_at: string;
}

export default function StudentTasks() {
  const [tasks, setTasks] = useState<StudentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchTasks = () => {
    setLoading(true);
    api.get('/api/student/tasks/')
      .then((res) => {
        setTasks(res.data);
        setError(false);
      })
      .catch((err) => {
        console.error("Failed to fetch tasks", err);
        setError(true);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const extractErrorMessage = (error: any) =>
    error?.response?.data?.detail
    || error?.response?.data?.title?.[0]
    || 'Something went wrong. Please try again.';

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setSubmitting(true);
    try {
      await api.post('/api/student/tasks/', {
        title: newTitle.trim(),
        due_date: newDueDate || null,
      });
      setNewTitle('');
      setNewDueDate('');
      fetchTasks();
    } catch (error) {
      console.error("Failed to add task", error);
      toast.error(extractErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (task: StudentTask) => {
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, is_done: !t.is_done } : t));
    try {
      await api.patch(`/api/student/tasks/${task.id}/`, { is_done: !task.is_done });
    } catch (error) {
      console.error("Failed to update task", error);
      toast.error(extractErrorMessage(error));
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, is_done: task.is_done } : t));
    }
  };

  const handleDelete = async (id: number) => {
    const loadingToast = toast.loading("Deleting task...");
    try {
      await api.delete(`/api/student/tasks/${id}/`);
      toast.success("Task removed.", { id: loadingToast });
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (error) {
      console.error("Failed to delete task", error);
      toast.error(extractErrorMessage(error), { id: loadingToast });
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="p-5 border-b border-slate-100 bg-white/90 backdrop-blur-md z-10 flex justify-between items-center shrink-0">
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-blue-600" />
            My Tasks
          </h1>
          {tasks.length > 0 && (
            <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-1 rounded-full">
              {tasks.filter((t) => !t.is_done).length} PENDING
            </span>
          )}
        </div>

        {/* Add Task Form */}
        <form onSubmit={handleAdd} className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add a new task..."
            className="flex-1 px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="date"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
            className="px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={submitting || !newTitle.trim()}
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </form>

        {/* Task List */}
        <div className="p-4 space-y-3">
          {loading ? (
            <div className="animate-pulse space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-slate-100 rounded-xl"></div>)}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400 space-y-3">
              <ShieldAlert className="w-10 h-10 text-slate-300" />
              <p className="text-sm font-medium">Couldn't load your tasks right now.</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400 space-y-3 opacity-80">
              <ListChecks className="w-12 h-12 text-slate-300" />
              <p className="text-sm font-medium">No tasks yet. Add one above to get started.</p>
            </div>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                className={`relative p-4 rounded-xl border-l-4 transition-all flex items-start gap-3 ${
                  task.is_done
                    ? 'border-emerald-400 bg-emerald-50/60'
                    : 'border-slate-300 bg-slate-50 hover:bg-slate-100/80'
                }`}
              >
                <input
                  type="checkbox"
                  checked={task.is_done}
                  onChange={() => handleToggle(task)}
                  className="mt-0.5 w-4 h-4 shrink-0 accent-blue-600 cursor-pointer"
                />

                <div className="flex flex-col gap-1 w-full">
                  <p className={`text-sm font-medium leading-relaxed ${task.is_done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                    {task.title}
                  </p>
                  {task.due_date && (
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                      <Calendar className="w-3 h-3" />
                      Due {task.due_date}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => handleDelete(task.id)}
                  title="Delete task"
                  className="shrink-0 p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

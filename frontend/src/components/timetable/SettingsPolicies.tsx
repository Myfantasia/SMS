import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Save, Sliders, Shield, ShieldAlert, Loader2, Info } from 'lucide-react';
import api from '../../libs/axiosInstance';

export default function SettingsPolicies() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Structural Form Bindings mapped to your Django database configuration singletons
  const [maxConsecutivePeriods, setMaxConsecutivePeriods] = useState(3);
  const [maxDailySubjectFrequency, setMaxDailySubjectFrequency] = useState(2);
  const [minSubjectSpacingPeriods, setMinSubjectSpacingPeriods] = useState(2);
  const [allowRemedialDoublePeriods, setAllowRemedialDoublePeriods] = useState(false);
  const [heavyDayThreshold, setHeavyDayThreshold] = useState(5);
  const [preventConsecutiveHeavyDays, setPreventConsecutiveHeavyDays] = useState(true);
  const [enforcementMode, setEnforcementMode] = useState<'STRICT' | 'SOFT'>('SOFT');
  const [maxWeeklyLessons, setMaxWeeklyLessons] = useState(40);

  useEffect(() => {
    const fetchPolicies = async () => {
      setLoading(true);
      try {
        const res = await api.get('/api/timetable/manage-policies/');
        const data = res.data;
        if (data.status === 'success') {
          const p = data.data;
          setMaxConsecutivePeriods(p.max_consecutive_periods);
          setMaxDailySubjectFrequency(p.max_daily_subject_frequency);
          setMinSubjectSpacingPeriods(p.min_subject_spacing_periods);
          setAllowRemedialDoublePeriods(p.allow_remedial_double_periods);
          setHeavyDayThreshold(p.heavy_day_threshold);
          setPreventConsecutiveHeavyDays(p.prevent_consecutive_heavy_days);
          setEnforcementMode(p.enforcement_mode);
          setMaxWeeklyLessons(p.max_weekly_lessons);
        }
      } catch (err) {
        console.error("Error pulling rules data:", err);
        toast.error("Failed to recover soft constraint profiles.");
      } finally {
        setLoading(false);
      }
    };
    fetchPolicies();
  }, []);

  const handleUpdatePolicies = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post('/api/timetable/manage-policies/', {
        max_consecutive_periods: maxConsecutivePeriods,
        max_daily_subject_frequency: maxDailySubjectFrequency,
        min_subject_spacing_periods: minSubjectSpacingPeriods,
        allow_remedial_double_periods: allowRemedialDoublePeriods,
        heavy_day_threshold: heavyDayThreshold,
        prevent_consecutive_heavy_days: preventConsecutiveHeavyDays,
        enforcement_mode: enforcementMode,
        max_weekly_lessons: maxWeeklyLessons
      });
      if (res.data.status === 'success') {
        toast.success(res.data.message || "Institutional configurations locked!");
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      console.error("Error writing policies payload:", err);
      toast.error("Network communication failure saving rules configuration.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-4xl animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map((i) => <div key={i} className="h-48 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>)}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleUpdatePolicies} className="space-y-6 max-w-4xl animate-fade-in">
      
      {/* Configuration Cards Layout Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Panel Block A: Cognitive Load Fatigue Control Metrics */}
        <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 p-5 rounded-xl space-y-4 shadow-sm dark:shadow-none">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700 pb-2">
            <Sliders className="w-4 h-4 text-blue-500 dark:text-blue-400" />
            <h4 className="font-bold text-sm uppercase tracking-wide">Cognitive Load Rules</h4>
          </div>

          <div className="space-y-1">
            <label htmlFor="maxConsecutivePeriods" className="text-xs font-bold text-slate-600 dark:text-slate-300">Max Consecutive Teacher/Class Periods</label>
            <input id="maxConsecutivePeriods" type="number" min="1" max="8" required value={maxConsecutivePeriods} onChange={(e) => setMaxConsecutivePeriods(Number(e.target.value))} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100" />
          </div>

          <div className="space-y-1">
            <label htmlFor="maxDailySubjectFrequency" className="text-xs font-bold text-slate-600 dark:text-slate-300">Max Single Day Subject Repeat Cap</label>
            <input id="maxDailySubjectFrequency" type="number" min="1" max="4" required value={maxDailySubjectFrequency} onChange={(e) => setMaxDailySubjectFrequency(Number(e.target.value))} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100" />
          </div>

          <div className="space-y-1">
            <label htmlFor="minSubjectSpacingPeriods" className="text-xs font-bold text-slate-600 dark:text-slate-300">Minimum Subject Spacing Interval (Periods)</label>
            <input id="minSubjectSpacingPeriods" type="number" min="0" max="5" required value={minSubjectSpacingPeriods} onChange={(e) => setMinSubjectSpacingPeriods(Number(e.target.value))} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100" />
          </div>

          <label className="flex items-center gap-2 pt-2 cursor-pointer select-none">
            <input id="allowRemedialDoublePeriods" type="checkbox" checked={allowRemedialDoublePeriods} onChange={(e) => setAllowRemedialDoublePeriods(e.target.checked)} className="w-4 h-4 text-blue-600 rounded focus:ring-0" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Allow double periods for Remedial tracks</span>
          </label>
        </div>

        {/* Panel Block B: Workload and Enforcement Parameters */}
        <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 p-5 rounded-xl space-y-4 shadow-sm dark:shadow-none">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700 pb-2">
            <Shield className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
            <h4 className="font-bold text-sm uppercase tracking-wide">Workload & Enforcement</h4>
          </div>

          <div className="space-y-1">
            <label htmlFor="heavyDayThreshold" className="text-xs font-bold text-slate-600 dark:text-slate-300">Heavy Subject Daily Threshold (Periods)</label>
            <input id="heavyDayThreshold" aria-label="Heavy Subject Daily Threshold in periods" placeholder="e.g. 3" type="number" min="1" max="6" required value={heavyDayThreshold} onChange={(e) => setHeavyDayThreshold(Number(e.target.value))} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100" />
          </div>

          <div className="space-y-1">
            <label htmlFor="maxWeeklyLessons" className="text-xs font-bold text-slate-600 dark:text-slate-300">Max Weekly Lessons Policy Cap</label>
            <input id="maxWeeklyLessons" type="number" min="10" max="60" required value={maxWeeklyLessons} onChange={(e) => setMaxWeeklyLessons(Number(e.target.value))} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100" />
          </div>

          <div className="space-y-1">
            <label htmlFor="enforcementMode" className="text-xs font-bold text-slate-600 dark:text-slate-300">Scheduler Compliance Mode</label>
            <select id="enforcementMode" value={enforcementMode} onChange={(e) => setEnforcementMode(e.target.value as 'STRICT' | 'SOFT')} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg p-2 bg-white dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200">
              <option value="SOFT">Flexible (Warn on soft-constraint exceptions)</option>
              <option value="STRICT">Strict (Block placements on soft exceptions)</option>
            </select>
          </div>

          <label className="flex items-center gap-2 pt-2 cursor-pointer select-none">
            <input id="preventConsecutiveHeavyDays" type="checkbox" checked={preventConsecutiveHeavyDays} onChange={(e) => setPreventConsecutiveHeavyDays(e.target.checked)} className="w-4 h-4 text-blue-600 rounded focus:ring-0" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Block back-to-back heavy student days</span>
          </label>
        </div>

      </div>

      {/* Form Action Footnote Summary */}
      <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start gap-3 text-xs leading-normal font-medium text-amber-800">
        {enforcementMode === 'STRICT' ? <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" /> : <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
        <p>
          {enforcementMode === 'STRICT'
            ? "⚠️ Enforcement Guard active. Your custom rules will operate as hard stops. Placements will be blocked during manual entry if they create a conflict." 
            : "ℹ️ Validation Alert active. Soft rules will surface alert badges to administrators during manual dragging without completely locking the schedule grid cell entry."}
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <button type="submit" disabled={saving} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm shadow-md flex items-center gap-2 transition-all disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>Lock System Configurations</span>
        </button>
      </div>

    </form>
  );
}
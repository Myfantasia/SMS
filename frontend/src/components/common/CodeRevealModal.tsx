// CodeRevealModal.tsx
// One-shot "here's your code, copy it now" modal — shared by admin approval, admin invite
// generation, and verification-code regeneration, since all three only ever show a
// server-generated secret once (it's stored hashed afterward, so it can't be shown again).
import { ShieldCheck, Copy } from 'lucide-react';
import toast from 'react-hot-toast';

interface CodeRevealModalProps {
  title: string;
  description: React.ReactNode;
  code: string;
  onClose: () => void;
}

export default function CodeRevealModal({ title, description, code, onClose }: CodeRevealModalProps) {
  const copyCode = () => {
    navigator.clipboard?.writeText(code);
    toast.success('Code copied to clipboard.');
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl dark:shadow-none dark:border dark:border-slate-700 max-w-sm w-full p-6 text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-4">
          <ShieldCheck className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">{title}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">{description}</p>
        <div className="flex items-center justify-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-4 mb-5 px-3">
          <span className="text-2xl font-extrabold tracking-[0.15em] text-slate-800 dark:text-slate-100 break-all">{code}</span>
          <button onClick={copyCode} className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0" title="Copy code">
            <Copy className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          </button>
        </div>
        <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 rounded-lg py-2 px-3 mb-5">
          This won't be shown again — copy or relay it now.
        </p>
        <button
          onClick={onClose}
          className="w-full py-2.5 bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 text-white rounded-xl text-sm font-bold transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

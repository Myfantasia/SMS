import { useState, forwardRef } from 'react';
import { Eye, EyeOff, type LucideIcon } from 'lucide-react';

interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: LucideIcon;
}

// Shared password field: same visual style every profile/signup form already used
// (left icon + bordered pill input), plus a show/hide eye toggle on the right so
// users can verify what they typed before submitting.
const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ icon: Icon, className, ...inputProps }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative">
        {Icon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Icon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
          </div>
        )}
        <input
          {...inputProps}
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={`${className ?? 'w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 focus:border-blue-500 dark:focus:border-blue-400 outline-none transition-all'} pr-10`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    );
  }
);

PasswordInput.displayName = 'PasswordInput';

export default PasswordInput;

// SearchableSelect.tsx
// Drop-in replacement for a flat <select> when the option list is long enough that
// scrolling to find one entry is painful (staff, students, streams, subjects...).
// Click/focus opens a filterable dropdown; typing narrows by label (and optional sublabel).
import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}

// A named branch of options ("Grade 7", "Agriculture", ...) — opt-in tree/nested-dropdown
// rendering for pickers with a natural hierarchy, instead of one long flat list. Every other
// SearchableSelect caller is unaffected: passing `groups` is the only way into this mode.
export interface SearchableSelectGroup {
  key: string;
  label: string;
  options: SearchableSelectOption[];
}

interface SearchableSelectProps {
  options?: SearchableSelectOption[];
  groups?: SearchableSelectGroup[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

function matchesQuery(o: SearchableSelectOption, words: string[]) {
  const haystack = `${o.label.toLowerCase()} ${(o.sublabel || '').toLowerCase()}`;
  return words.every(w => haystack.includes(w));
}

export default function SearchableSelect({
  options,
  groups,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matches found.',
  disabled = false,
  required = false,
  name,
  id,
  className = '',
  'aria-label': ariaLabel,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The full option set regardless of mode, purely for resolving the CURRENT value's label —
  // callers using `groups` don't need to also pass a flattened `options`.
  const allOptions = useMemo(
    () => options ?? groups?.flatMap(g => g.options) ?? [],
    [options, groups]
  );
  const selected = allOptions.find(o => o.value === value);

  const filtered = useMemo(() => {
    if (groups) return [];
    const opts = options ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return opts;
    // Every typed word must appear somewhere (label or sublabel), in any order, so
    // "7 north" matches "Grade 7 North" — then rank label-prefix matches to the top
    // so the most likely pick is never buried under partial/sublabel-only matches.
    const words = q.split(/\s+/).filter(Boolean);
    const scored: { opt: SearchableSelectOption; rank: number }[] = [];
    for (const o of opts) {
      const label = o.label.toLowerCase();
      const sublabel = (o.sublabel || '').toLowerCase();
      const haystack = `${label} ${sublabel}`;
      if (!words.every(w => haystack.includes(w))) continue;
      const rank = label === q ? 0 : label.startsWith(q) ? 1 : label.includes(q) ? 2 : 3;
      scored.push({ opt: o, rank });
    }
    scored.sort((a, b) => a.rank - b.rank);
    return scored.map(s => s.opt);
  }, [options, groups, search]);

  // Tree mode: a branch stays in the list if its own label matches (showing every child, so
  // "grade 7" surfaces the whole group) or at least one child matches (showing just those).
  const filteredGroups = useMemo(() => {
    if (!groups) return null;
    const q = search.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    if (!words.length) return groups;
    return groups
      .map(g => {
        const groupMatches = words.every(w => g.label.toLowerCase().includes(w));
        const opts = groupMatches ? g.options : g.options.filter(o => matchesQuery(o, words));
        return { ...g, options: opts };
      })
      .filter(g => g.options.length > 0);
  }, [groups, search]);

  const isSearching = search.trim().length > 0;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openDropdown = () => {
    if (disabled) return;
    setIsOpen(true);
    setSearch('');
    // Start with just the branch holding the current selection open (if any) so a re-opened
    // picker doesn't dump every branch open at once — everything else stays collapsed until
    // the user asks for it, which is the whole point of a tree over one long flat list.
    if (groups) {
      const ownerGroup = groups.find(g => g.options.some(o => o.value === value));
      setExpandedGroups(ownerGroup ? new Set([ownerGroup.key]) : new Set());
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const pick = (opt: SearchableSelectOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      {/* Hidden input carries the value for plain <form> submits / required validation */}
      {name && <input type="hidden" name={name} value={value} required={required} />}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="w-full flex items-center gap-2 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-left outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-indigo-500 dark:focus:border-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
        <span className={`flex-1 min-w-0 truncate font-medium ${selected ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg dark:shadow-none overflow-hidden animate-fade-in">
          <div className="p-2 border-b border-slate-100 dark:border-slate-700">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            />
          </div>
          <div className="max-h-72 overflow-y-auto" role="listbox">
            {groups ? (
              filteredGroups!.length === 0 ? (
                <div className="px-3 py-4 text-xs text-slate-400 dark:text-slate-500 font-medium text-center">{emptyMessage}</div>
              ) : (
                filteredGroups!.map(g => {
                  const open = isSearching || expandedGroups.has(g.key);
                  return (
                    <div key={g.key}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(g.key)}
                        className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10 border-b border-slate-50 dark:border-slate-800"
                      >
                        <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                        <span className="flex-1 truncate">{g.label}</span>
                        <span className="text-[10px] font-normal normal-case text-slate-400 dark:text-slate-500">{g.options.length}</span>
                      </button>
                      {open && (
                        // Tree connector: a vertical rule down the branch with each child
                        // indented under it, instead of every row looking like a sibling of
                        // the group headers — the visual cue that these belong to this group.
                        <div className="ml-[1.15rem] border-l border-slate-200 dark:border-slate-700">
                          {g.options.map(opt => (
                            <button
                              key={opt.value}
                              type="button"
                              role="option"
                              aria-selected={opt.value === value}
                              disabled={opt.disabled}
                              onClick={() => pick(opt)}
                              className={`w-full text-left pl-4 pr-3 py-2 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                opt.value === value ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 font-bold' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium'
                              }`}
                            >
                              {opt.label}
                              {opt.sublabel && <span className="ml-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">{opt.sublabel}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-slate-400 dark:text-slate-500 font-medium text-center">{emptyMessage}</div>
            ) : (
              filtered.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  disabled={opt.disabled}
                  onClick={() => pick(opt)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    opt.value === value ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 font-bold' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium'
                  }`}
                >
                  {opt.label}
                  {opt.sublabel && <span className="ml-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">{opt.sublabel}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

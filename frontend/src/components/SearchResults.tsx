import { useEffect, useState } from 'react';
import { useSearchParams, Link, useLocation } from 'react-router-dom';
import { Search, ChevronRight, User } from 'lucide-react';
import api from '../libs/axiosInstance';

interface SearchResult {
  id: number;
  name: string;
  username: string;
  type: string; // 'students', 'teachers', 'parents'
  role_label: string; // 'Student', 'Teacher', 'Parent'
}

export default function SearchResults() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const location = useLocation();
  
  // Find out if we are in admin, teacher, etc. based on the current URL
  const dashboardPrefix = location.pathname.split('/')[1]; 

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

useEffect(() => {
  if (!query) return;

  const fetchResults = async () => {
    setLoading(true);
    try {
      // Axios cleans up URL generation. You can pass parameters cleanly via the config object.
      const response = await api.get('/api/search/', {
        params: { q: query }
      });
      
      const data = response.data;
      if (data.status === 'success') {
        setResults(data.data);
      }
    } catch (error) {
      console.error("Search failed", error);
    }
    setLoading(false);
  };

  fetchResults();
}, [query]);

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Search className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          Search Results
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Showing results for: <span className="font-semibold text-slate-800 dark:text-slate-200">"{query}"</span>
        </p>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500 dark:text-slate-400 animate-pulse">Searching database...</div>
      ) : results.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 p-8 rounded-xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 text-center text-slate-500 dark:text-slate-400">
          No students, teachers, parents, or staff found matching your query.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {results.map((result, index) => (
              <li key={`${result.type}-${result.id}-${index}`}>
                <Link
                  to={`/${dashboardPrefix}/${result.type}/view/${result.id}`}
                  className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center font-bold">
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                        {result.name}
                      </h3>
                      <div className="text-xs text-slate-500 dark:text-slate-400 flex gap-2">
                        <span className="font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{result.role_label}</span>
                        <span>•</span>
                        <span>ID: {result.username}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-300 dark:text-slate-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
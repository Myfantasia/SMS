import { useEffect, useState } from 'react';
import { useSearchParams, Link, useLocation } from 'react-router-dom';
import { Search, ChevronRight, User } from 'lucide-react';

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
        const response = await fetch(`http://localhost:8000/api/search/?q=${encodeURIComponent(query)}`);
        const data = await response.json();
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
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Search className="w-6 h-6 text-blue-600" />
          Search Results
        </h1>
        <p className="text-gray-500 mt-1">
          Showing results for: <span className="font-semibold text-gray-800">"{query}"</span>
        </p>
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-500 animate-pulse">Searching database...</div>
      ) : results.length === 0 ? (
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-100 text-center text-gray-500">
          No students, teachers, or parents found matching your query.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {results.map((result, index) => (
              <li key={`${result.type}-${result.id}-${index}`}>
                <Link 
                  to={`/${dashboardPrefix}/${result.type}/view/${result.id}`} 
                  className="flex items-center justify-between p-4 hover:bg-slate-50 transition group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center font-bold">
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-800 group-hover:text-blue-600 transition">
                        {result.name}
                      </h3>
                      <div className="text-xs text-gray-500 flex gap-2">
                        <span className="font-semibold uppercase tracking-wider text-slate-400">{result.role_label}</span>
                        <span>•</span>
                        <span>ID: {result.username}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500 transition" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
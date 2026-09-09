import { useState, useEffect, useCallback } from 'react';
import {
  Newspaper, Quote, Plus, Loader2, Edit, Trash2, Eye, EyeOff, AlertTriangle, User,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import BlogPostFormModal from './BlogPostFormModal';
import AlumniReviewFormModal from './AlumniReviewFormModal';

export interface BlogPost {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  cover_image: string | null;
  author_name: string;
  is_published: boolean;
  published_at: string;
}

export interface AlumniReview {
  id: number;
  name: string;
  title: string;
  quote: string;
  photo: string | null;
  is_published: boolean;
  display_order: number;
}

type Tab = 'blog' | 'alumni';

function confirmDelete(message: string, onConfirm: () => void) {
  toast.custom((t) => (
    <div
      className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-md w-full bg-white dark:bg-slate-900 shadow-2xl dark:shadow-none rounded-xl pointer-events-auto flex ring-1 ring-black ring-opacity-5 overflow-hidden border border-slate-200 dark:border-slate-700`}
    >
      <div className="flex-1 w-0 p-4">
        <div className="flex items-start">
          <div className="shrink-0 pt-0.5">
            <div className="p-2 bg-red-100 dark:bg-red-500/10 rounded-full">
              <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
          </div>
          <div className="ml-4 flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Confirm Permanent Deletion</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>
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
            onClick={() => { toast.dismiss(t.id); onConfirm(); }}
            className="px-4 py-2 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-sm dark:shadow-none shadow-red-200 uppercase tracking-wider"
          >
            Confirm Delete
          </button>
        </div>
      </div>
    </div>
  ), { duration: Infinity, position: 'top-center' });
}

export default function ContentHub() {
  const [tab, setTab] = useState<Tab>('blog');

  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [reviews, setReviews] = useState<AlumniReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null);

  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [editingReview, setEditingReview] = useState<AlumniReview | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [postsRes, reviewsRes] = await Promise.all([
        api.get('/api/core/admin/blog-posts/'),
        api.get('/api/core/admin/alumni-reviews/'),
      ]);
      setPosts(postsRes.data.results ?? postsRes.data);
      setReviews(reviewsRes.data.results ?? reviewsRes.data);
    } catch (error) {
      console.error('Error fetching content:', error);
      toast.error('Failed to load content from the database.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleOpenNew = () => {
    if (tab === 'blog') {
      setEditingPost(null);
      setIsPostModalOpen(true);
    } else {
      setEditingReview(null);
      setIsReviewModalOpen(true);
    }
  };

  const togglePostPublished = async (post: BlogPost) => {
    try {
      await api.patch(`/api/core/admin/blog-posts/${post.id}/`, { is_published: !post.is_published });
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, is_published: !p.is_published } : p)));
    } catch {
      toast.error('Could not update publish status.');
    }
  };

  const toggleReviewPublished = async (review: AlumniReview) => {
    try {
      await api.patch(`/api/core/admin/alumni-reviews/${review.id}/`, { is_published: !review.is_published });
      setReviews((prev) => prev.map((r) => (r.id === review.id ? { ...r, is_published: !r.is_published } : r)));
    } catch {
      toast.error('Could not update publish status.');
    }
  };

  const deletePost = (post: BlogPost) => {
    confirmDelete(`"${post.title}" will be permanently removed.`, async () => {
      const loadingToast = toast.loading('Deleting post...');
      try {
        await api.delete(`/api/core/admin/blog-posts/${post.id}/`);
        toast.success('Post deleted.', { id: loadingToast });
        fetchAll();
      } catch {
        toast.error('Could not delete post.', { id: loadingToast });
      }
    });
  };

  const deleteReview = (review: AlumniReview) => {
    confirmDelete(`The review from "${review.name}" will be permanently removed.`, async () => {
      const loadingToast = toast.loading('Deleting review...');
      try {
        await api.delete(`/api/core/admin/alumni-reviews/${review.id}/`);
        toast.success('Review deleted.', { id: loadingToast });
        fetchAll();
      } catch {
        toast.error('Could not delete review.', { id: loadingToast });
      }
    });
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10">
            <Newspaper className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">Blog & Alumni Content</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">Manage the articles and alumni reviews shown on the public website.</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setTab('blog')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${tab === 'blog' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              <Newspaper className="w-4 h-4" /> Blog & Articles
            </button>
            <button
              onClick={() => setTab('alumni')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${tab === 'alumni' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              <Quote className="w-4 h-4" /> Alumni Reviews
            </button>
          </div>

          <button
            onClick={handleOpenNew}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-all shadow-sm dark:shadow-none"
          >
            <Plus className="w-4 h-4" /> {tab === 'blog' ? 'New Post' : 'New Review'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 dark:text-blue-400" />
        </div>
      ) : tab === 'blog' ? (
        posts.length === 0 ? (
          <div className="text-center py-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-inner dark:shadow-none">
            <p className="text-slate-400 dark:text-slate-500 font-semibold tracking-tight italic">No blog posts yet. Create the first one.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <div key={post.id} className="group bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 hover:shadow-xl dark:hover:shadow-none hover:border-slate-300 dark:hover:border-slate-600 transition-all flex gap-5">
                {post.cover_image ? (
                  <img src={post.cover_image} alt="" className="w-28 h-28 rounded-xl object-cover flex-shrink-0" />
                ) : (
                  <div className="w-28 h-28 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
                    <Newspaper className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-100 truncate">{post.title}</h3>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => togglePostPublished(post)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${post.is_published ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
                      >
                        {post.is_published ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        {post.is_published ? 'Published' : 'Draft'}
                      </button>
                      <button onClick={() => { setEditingPost(post); setIsPostModalOpen(true); }} className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-all p-2 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-500/10" title="Edit">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button onClick={() => deletePost(post)} className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition-all p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{post.excerpt || post.body}</p>
                  <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-3">
                    By {post.author_name} • {new Date(post.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )
      ) : reviews.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-inner dark:shadow-none">
          <p className="text-slate-400 dark:text-slate-500 font-semibold tracking-tight italic">No alumni reviews yet. Add the first one.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="group bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700 hover:shadow-xl dark:hover:shadow-none hover:border-slate-300 dark:hover:border-slate-600 transition-all flex gap-5">
              {review.photo ? (
                <img src={review.photo} alt="" className="w-16 h-16 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
                  <User className="w-7 h-7 text-slate-300 dark:text-slate-600" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100">{review.name}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold">{review.title}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mr-1">Order {review.display_order}</span>
                    <button
                      onClick={() => toggleReviewPublished(review)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${review.is_published ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
                    >
                      {review.is_published ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      {review.is_published ? 'Published' : 'Draft'}
                    </button>
                    <button onClick={() => { setEditingReview(review); setIsReviewModalOpen(true); }} className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-all p-2 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-500/10" title="Edit">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteReview(review)} className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition-all p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 italic">"{review.quote}"</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <BlogPostFormModal
        isOpen={isPostModalOpen}
        onClose={() => setIsPostModalOpen(false)}
        onSuccess={fetchAll}
        initialData={editingPost}
      />
      <AlumniReviewFormModal
        isOpen={isReviewModalOpen}
        onClose={() => setIsReviewModalOpen(false)}
        onSuccess={fetchAll}
        initialData={editingReview}
      />
    </div>
  );
}

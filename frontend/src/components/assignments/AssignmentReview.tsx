import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Download, MessageSquare, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { studentAssignmentService } from '../../libs/studentAssignmentService';
import { parentAssignmentService } from '../../libs/parentAssignmentService';
import type { ReviewData } from '../../libs/assignments';

interface AssignmentReviewProps {
  role: 'student' | 'parent';
}

export default function AssignmentReview({ role }: AssignmentReviewProps) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const studentId = searchParams.get('student_id');
  const navigate = useNavigate();

  const [review, setReview] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReview = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const data = role === 'parent' && studentId
          ? await parentAssignmentService.getReview(studentId, id)
          : await studentAssignmentService.getReview(id);
        setReview(data);
      } catch (error: any) {
        console.error("Error loading review:", error);
        toast.error(error.response?.data?.error || "Failed to load this review.");
        navigate('..');
      } finally {
        setLoading(false);
      }
    };
    fetchReview();
  }, [id, role, studentId]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
        <div className="h-14 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-32 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-56 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
      </div>
    );
  }

  if (!review) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <button onClick={() => navigate('..')} className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-sm font-medium">
        <ArrowLeft className="w-4 h-4" /> Back to Assignments
      </button>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{review.assignment_title}</h1>
          <p className="flex items-center gap-1.5 mt-1 text-sm text-slate-500 dark:text-slate-400">
            <Clock className="w-4 h-4" /> Submitted: {review.submitted_at ? new Date(review.submitted_at).toLocaleString() : 'N/A'}
            {review.is_late && <span className="ml-2 text-[10px] font-black bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-2 py-0.5 rounded border border-red-200 dark:border-red-500/40 uppercase">Late</span>}
          </p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-xl px-5 py-3 text-center">
          <p className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">Final Score</p>
          <p className="text-2xl font-black text-blue-700 dark:text-blue-400">{review.total_awarded_score} <span className="text-sm text-slate-400 dark:text-slate-500 font-bold">/ {review.total_max_score}</span></p>
        </div>
      </div>

      {review.overall_feedback && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 p-6 space-y-2">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <MessageSquare className="w-4 h-4" /> Teacher's Overall Feedback
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{review.overall_feedback}</p>
        </div>
      )}

      {(review.student_attachment || review.teacher_returned_file) && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 p-6 flex flex-wrap gap-4">
          {review.student_attachment && (
            <a href={review.student_attachment} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              <Download className="w-4 h-4" /> Your Submitted File
            </a>
          )}
          {review.teacher_returned_file && (
            <a href={review.teacher_returned_file} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/40 rounded-lg text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors">
              <Download className="w-4 h-4" /> Teacher's Annotated Return
            </a>
          )}
        </div>
      )}

      <div className="space-y-5">
        {review.detailed_answers.map((ans, index) => (
          <div key={index} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-800/40 px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
              <span className="font-semibold text-slate-800 dark:text-slate-100">Question {index + 1}</span>
              <div className="flex items-center gap-2">
                {ans.correct_answer !== null && (
                  ans.awarded_score >= ans.max_score
                    ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/40 px-2 py-1 rounded"><CheckCircle2 className="w-3.5 h-3.5" /> Correct</span>
                    : <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/40 px-2 py-1 rounded"><XCircle className="w-3.5 h-3.5" /> Incorrect</span>
                )}
                <span className="text-sm font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-md">{ans.awarded_score} / {ans.max_score}</span>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{ans.question_text}</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Your Answer</p>
                  <p className="text-sm text-slate-700 dark:text-slate-200">
                    {ans.student_selected_options.length > 0
                      ? ans.student_selected_options.join(', ')
                      : (ans.teacher_corrected_text || ans.student_text_answer || <span className="italic text-slate-400 dark:text-slate-500">No answer provided</span>)}
                  </p>
                </div>
                {ans.correct_answer && (
                  <div className="bg-emerald-50 dark:bg-emerald-500/10 p-4 rounded-xl border border-emerald-200 dark:border-emerald-500/40">
                    <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-1.5">Correct Answer</p>
                    <p className="text-sm text-emerald-900 dark:text-emerald-300">{ans.correct_answer}</p>
                  </div>
                )}
              </div>

              {ans.criterion_scores.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wider">Rubric Breakdown</p>
                  {ans.criterion_scores.map((cs, ci) => (
                    <div key={ci} className="flex items-center justify-between text-sm bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/40 rounded-lg px-3 py-1.5">
                      <span className="text-purple-800 dark:text-purple-300">{cs.criterion_text}</span>
                      <span className="font-bold text-purple-700 dark:text-purple-400">{cs.score} / {cs.max_points}</span>
                    </div>
                  ))}
                </div>
              )}

              {ans.teacher_comment && (
                <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/40 rounded-lg p-3">
                  <MessageSquare className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-blue-800 dark:text-blue-300">{ans.teacher_comment}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

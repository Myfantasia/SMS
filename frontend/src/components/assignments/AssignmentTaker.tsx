import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Clock, Timer, Link2, UploadCloud, Send, Users, AlertCircle, PlayCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { studentAssignmentService, type AnswerPayload } from '../../libs/studentAssignmentService';
import type { TakerAssignment } from '../../libs/assignments';

type AnswerState = Record<number, { text_answer?: string; selected_options?: number[] }>;

export default function AssignmentTaker() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [assignment, setAssignment] = useState<TakerAssignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [beginningQuiz, setBeginningQuiz] = useState(false);

  const fetchDetail = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await studentAssignmentService.getAssignmentDetail(id);
      setAssignment(data);

      const initialAnswers: AnswerState = {};
      data.existing_answers.forEach(a => {
        initialAnswers[a.question_id] = { text_answer: a.text_answer || '', selected_options: a.selected_options };
      });
      setAnswers(initialAnswers);
    } catch (error: any) {
      console.error("Error loading assignment:", error);
      toast.error(error.response?.data?.error || "Failed to load this assignment.");
      navigate('..');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDetail(); }, [id]);

  // --- Quiz timer ---
  useEffect(() => {
    if (!assignment?.is_quiz || !assignment.started_at || !assignment.duration_minutes) return;
    const deadline = new Date(assignment.started_at).getTime() + assignment.duration_minutes * 60000;

    const tick = () => {
      const secondsLeft = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setRemainingSeconds(secondsLeft);
      if (secondsLeft === 0) {
        toast("Time's up! Submitting your quiz automatically.", { icon: '⏱️' });
        handleSubmit();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.started_at, assignment?.duration_minutes, assignment?.is_quiz]);

  const handleBeginQuiz = async () => {
    if (!id) return;
    try {
      setBeginningQuiz(true);
      await studentAssignmentService.startQuiz(id);
      await fetchDetail();
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to start the quiz.");
    } finally {
      setBeginningQuiz(false);
    }
  };

  const setTextAnswer = (qId: number, text: string) => {
    setAnswers(prev => ({ ...prev, [qId]: { ...prev[qId], text_answer: text } }));
  };

  const setSingleOption = (qId: number, optId: number) => {
    setAnswers(prev => ({ ...prev, [qId]: { ...prev[qId], selected_options: [optId] } }));
  };

  const toggleCheckboxOption = (qId: number, optId: number, maxRequired: number | null) => {
    setAnswers(prev => {
      const current = prev[qId]?.selected_options || [];
      const has = current.includes(optId);
      if (!has && maxRequired && current.length >= maxRequired) {
        toast.error(`You can only select up to ${maxRequired} options.`);
        return prev;
      }
      const next = has ? current.filter(x => x !== optId) : [...current, optId];
      return { ...prev, [qId]: { ...prev[qId], selected_options: next } };
    });
  };

  const handleSubmit = async () => {
    if (!id || !assignment) return;
    try {
      setSubmitting(true);
      const payload: AnswerPayload[] = assignment.questions.map(q => ({
        question_id: q.id,
        text_answer: answers[q.id]?.text_answer || '',
        selected_options: answers[q.id]?.selected_options || [],
      }));
      const result = await studentAssignmentService.submitAssignment(id, payload, file);
      toast.success(`Submitted! Status: ${result.status === 'Graded' ? 'Auto-graded' : 'Pending teacher review'}`);
      navigate('..');
    } catch (error: any) {
      console.error("Error submitting assignment:", error);
      toast.error(error.response?.data?.error || "Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const formattedTime = useMemo(() => {
    if (remainingSeconds === null) return null;
    const m = Math.floor(remainingSeconds / 60).toString().padStart(2, '0');
    const s = (remainingSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, [remainingSeconds]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
        <div className="h-14 bg-slate-200 rounded-2xl"></div>
        <div className="h-40 bg-slate-200 rounded-2xl"></div>
        <div className="h-56 bg-slate-200 rounded-2xl"></div>
      </div>
    );
  }

  if (!assignment) return null;

  // Quiz not started yet — require an explicit "Begin" click so the timer starts fairly.
  if (assignment.is_quiz && !assignment.started_at) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <button onClick={() => navigate('..')} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors text-sm font-medium">
          <ArrowLeft className="w-4 h-4" /> Back to Assignments
        </button>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mx-auto">
            <Timer className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">{assignment.title}</h1>
          <p className="text-sm text-slate-500">
            This is a timed quiz. You will have <strong>{assignment.duration_minutes} minutes</strong> once you begin, and the timer cannot be paused.
          </p>
          <button
            onClick={handleBeginQuiz}
            disabled={beginningQuiz}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <PlayCircle className="w-5 h-5" /> {beginningQuiz ? 'Starting...' : 'Begin Quiz'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <button onClick={() => navigate('..')} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors text-sm font-medium">
          <ArrowLeft className="w-4 h-4" /> Back to Assignments
        </button>
        {assignment.is_quiz && formattedTime && (
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border font-black text-lg ${remainingSeconds! < 60 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
            <Clock className="w-5 h-5" /> {formattedTime}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-2">
        <h1 className="text-2xl font-bold text-slate-800">{assignment.title}</h1>
        <p className="text-sm text-slate-500">{assignment.subject}</p>
        {assignment.is_group_assignment && assignment.group_name && (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded mt-1">
            <Users className="w-3.5 h-3.5" /> Group: {assignment.group_name} — your submission will be shared with your group.
          </span>
        )}
        {assignment.grading_status === 'Returned' && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-2">
            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">Your teacher returned this for revision. Update your answers below and resubmit.</p>
          </div>
        )}
      </div>

      {(assignment.reference_notes || assignment.reference_links.length > 0 || assignment.teacher_attachment) && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-3">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Reference Material</h3>
          {assignment.reference_notes && <p className="text-sm text-slate-600 whitespace-pre-wrap">{assignment.reference_notes}</p>}
          {assignment.teacher_attachment && (
            <a href={assignment.teacher_attachment} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
              <UploadCloud className="w-4 h-4" /> Download master document
            </a>
          )}
          {assignment.reference_links.map((link, idx) => (
            <a key={idx} href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
              <Link2 className="w-4 h-4" /> {link.label || link.url}
            </a>
          ))}
        </div>
      )}

      <div className="space-y-5">
        {assignment.questions.map((q, index) => (
          <div key={q.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-800">Question {index + 1}</h4>
              <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">{q.max_score} pts</span>
            </div>
            <p className="text-slate-700 whitespace-pre-wrap">{q.question_text}</p>

            {q.question_type === 'MCQ' && (
              <div className="space-y-2">
                {q.options.map(opt => (
                  <label key={opt.id} className="flex items-center gap-3 p-2.5 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      checked={(answers[q.id]?.selected_options || []).includes(opt.id)}
                      onChange={() => setSingleOption(q.id, opt.id)}
                    />
                    <span className="text-sm text-slate-700">{opt.option_text}</span>
                  </label>
                ))}
              </div>
            )}

            {q.question_type === 'CHECKBOX' && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">Select up to {q.required_answers || 1} option(s).</p>
                {q.options.map(opt => (
                  <label key={opt.id} className="flex items-center gap-3 p-2.5 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={(answers[q.id]?.selected_options || []).includes(opt.id)}
                      onChange={() => toggleCheckboxOption(q.id, opt.id, q.required_answers)}
                    />
                    <span className="text-sm text-slate-700">{opt.option_text}</span>
                  </label>
                ))}
              </div>
            )}

            {q.question_type === 'SHORT_ANSWER' && (
              <input
                type="text"
                value={answers[q.id]?.text_answer || ''}
                onChange={(e) => setTextAnswer(q.id, e.target.value)}
                placeholder="Type your answer..."
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
              />
            )}

            {q.question_type === 'ESSAY' && (
              <textarea
                rows={5}
                value={answers[q.id]?.text_answer || ''}
                onChange={(e) => setTextAnswer(q.id, e.target.value)}
                placeholder="Write your response..."
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none resize-y"
              />
            )}

            {q.question_type === 'FILE_UPLOAD' && (
              <p className="text-sm text-slate-500 italic">Attach your work for this question using the file upload at the bottom of the page.</p>
            )}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-3">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Attach a File (Optional)</h3>
        <label className="inline-flex items-center gap-2 px-4 py-2.5 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50 cursor-pointer">
          <UploadCloud className="w-4 h-4" />
          {file ? file.name : 'Click to choose a file'}
          <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        {assignment.student_attachment && !file && (
          <p className="text-xs text-slate-500">Currently attached: <a href={assignment.student_attachment} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">view file</a></p>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
        >
          <Send className="w-4 h-4" /> {submitting ? 'Submitting...' : 'Submit Assignment'}
        </button>
      </div>
    </div>
  );
}

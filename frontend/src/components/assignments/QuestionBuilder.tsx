import React from 'react';
import {
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  CheckSquare,
  Square,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  UploadCloud,
  ClipboardList
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Question } from '../../libs/assignments';

interface QuestionBuilderProps {
  questions: Question[];
  setQuestions: React.Dispatch<React.SetStateAction<Question[]>>;
}

export default function QuestionBuilder({ questions, setQuestions }: QuestionBuilderProps) {

  // --- 1. CORE QUESTION HANDLERS ---
  const addQuestion = () => {
    const newQuestion: Question = {
      question_text: '',
      question_type: 'MCQ',
      is_auto_graded: true, // MCQ is auto-graded by default
      max_score: 1,
      options: [
        { option_text: '', is_correct: true },
        { option_text: '', is_correct: false }
      ] // Start MCQs with 2 default options
    };
    setQuestions([...questions, newQuestion]);
  };

  const removeQuestion = (indexToRemove: number) => {
    const question = questions[indexToRemove];
    const hasContent = question.question_text.trim() || question.options?.some(o => o.option_text.trim());

    const doRemove = () => setQuestions(questions.filter((_, index) => index !== indexToRemove));

    if (!hasContent) {
      doRemove();
      return;
    }

    // Confirm before discarding a question with real content — mirrors the confirm
    // pattern already used for deleting assignments in AssignmentsHub.
    toast((t) => (
      <div className="flex flex-col gap-3 max-w-sm">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-relaxed">
          Remove Question {indexToRemove + 1}? All its text and options will be discarded.
        </p>
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { toast.dismiss(t.id); doRemove(); }}
            className="px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors shadow-sm"
          >
            Remove
          </button>
        </div>
      </div>
    ), { duration: Infinity, position: 'top-center', style: { minWidth: '320px' } });
  };

  const moveQuestion = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= questions.length) return;
    const updated = [...questions];
    [updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]];
    setQuestions(updated);
  };

  const updateQuestion = (index: number, field: keyof Question, value: any) => {
    const updatedQuestions = [...questions];
    updatedQuestions[index] = { ...updatedQuestions[index], [field]: value };

    // Auto-update the 'is_auto_graded' flag based on the selected type
    if (field === 'question_type') {
      // <-- NEW: Added CHECKBOX to the auto-graded check
      const isAuto = value === 'MCQ' || value === 'SHORT_ANSWER' || value === 'CHECKBOX';
      updatedQuestions[index].is_auto_graded = isAuto;

      // If switching to MCQ or CHECKBOX and options are missing, initialize them
      if ((value === 'MCQ' || value === 'CHECKBOX') && !updatedQuestions[index].options) {
        updatedQuestions[index].options = [
          { option_text: '', is_correct: true },
          { option_text: '', is_correct: false }
        ];
      }

      // Default to requiring 2 answers if they switch to multiple response
      if (value === 'CHECKBOX') {
        updatedQuestions[index].required_answers = 2;
      }
    }

    setQuestions(updatedQuestions);
  };

  // --- 2. OPTION HANDLERS ---
  const addOption = (qIndex: number) => {
    const updatedQuestions = questions.map((q, i) =>
      i === qIndex ? { ...q, options: [...(q.options || []), { option_text: '', is_correct: false }] } : q
    );
    setQuestions(updatedQuestions);
  };

  const updateOptionText = (qIndex: number, optIndex: number, text: string) => {
    const updatedQuestions = [...questions];
    if (updatedQuestions[qIndex].options) {
      updatedQuestions[qIndex].options![optIndex].option_text = text;
    }
    setQuestions(updatedQuestions);
  };

  const removeOption = (qIndex: number, optIndex: number) => {
    const updatedQuestions = [...questions];
    if (updatedQuestions[qIndex].options) {
      updatedQuestions[qIndex].options = updatedQuestions[qIndex].options!.filter((_, i) => i !== optIndex);
    }
    setQuestions(updatedQuestions);
  };

  const setCorrectOption = (qIndex: number, correctOptIndex: number) => {
    const updatedQuestions = [...questions];
    const q = updatedQuestions[qIndex];

    if (q.options) {
      // --- NEW: Handle CHECKBOX vs MCQ logic ---
      if (q.question_type === 'CHECKBOX') {
        const isCurrentlyCorrect = q.options[correctOptIndex].is_correct;

        // If they are trying to check a NEW box, validate the limit
        if (!isCurrentlyCorrect) {
          const currentCorrectCount = q.options.filter(opt => opt.is_correct).length;
          if (currentCorrectCount >= 3) {
            toast.error("Maximum 3 correct answers allowed for this question type.");
            return; // Block the state update
          }
        }
        // Toggle the specific option
        q.options[correctOptIndex].is_correct = !isCurrentlyCorrect;

      } else {
        // Standard MCQ logic: Loop through all options and set only the chosen one to true
        q.options = q.options.map((opt, i) => ({
          ...opt,
          is_correct: i === correctOptIndex
        }));
      }
    }
    setQuestions(updatedQuestions);
  };

  // --- 3. RUBRIC CRITERIA HANDLERS ---
  const addCriterion = (qIndex: number) => {
    const updatedQuestions = questions.map((q, i) => {
      if (i !== qIndex) return q;
      const criteria = [...(q.rubric_criteria || []), { criterion_text: '', max_points: 1 }];
      return { ...q, rubric_criteria: criteria, max_score: criteria.reduce((sum, c) => sum + (c.max_points || 0), 0) };
    });
    setQuestions(updatedQuestions);
  };

  const removeCriterion = (qIndex: number, cIndex: number) => {
    const updatedQuestions = questions.map((q, i) => {
      if (i !== qIndex) return q;
      const criteria = (q.rubric_criteria || []).filter((_, ci) => ci !== cIndex);
      const nextScore = criteria.length > 0 ? criteria.reduce((sum, c) => sum + (c.max_points || 0), 0) : q.max_score;
      return { ...q, rubric_criteria: criteria, max_score: nextScore };
    });
    setQuestions(updatedQuestions);
  };

  const updateCriterion = (qIndex: number, cIndex: number, field: 'criterion_text' | 'max_points', value: string | number) => {
    const updatedQuestions = questions.map((q, i) => {
      if (i !== qIndex) return q;
      const criteria = (q.rubric_criteria || []).map((c, ci) => ci === cIndex ? { ...c, [field]: value } : c);
      return { ...q, rubric_criteria: criteria, max_score: criteria.reduce((sum, c) => sum + (Number(c.max_points) || 0), 0) };
    });
    setQuestions(updatedQuestions);
  };

  return (
    <div className="space-y-6">

      {questions.map((q, qIndex) => (
        <div key={qIndex} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm dark:shadow-none overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">

          {/* Question Header */}
          <div className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex flex-col -my-1">
                <button
                  type="button"
                  onClick={() => moveQuestion(qIndex, -1)}
                  disabled={qIndex === 0}
                  title="Move question up"
                  aria-label="Move question up"
                  className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveQuestion(qIndex, 1)}
                  disabled={qIndex === questions.length - 1}
                  title="Move question down"
                  aria-label="Move question down"
                  className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <h4 className="font-semibold text-slate-700 dark:text-slate-200">Question {qIndex + 1}</h4>
            </div>
            <button
              type="button"
              onClick={() => removeQuestion(qIndex)}
              className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition-colors p-1"
              title="Remove question"
              aria-label={`Remove question ${qIndex + 1}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* Question Text & Core Settings */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-8">
                <label htmlFor={`question_text_${qIndex}`} className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Question Prompt</label>
                <textarea
                  id={`question_text_${qIndex}`}
                  rows={2}
                  value={q.question_text}
                  onChange={(e) => updateQuestion(qIndex, 'question_text', e.target.value)}
                  placeholder="Type your question here..."
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400 outline-none transition-all resize-y"
                />
              </div>

              <div className="md:col-span-3">
                <label htmlFor={`question_type_${qIndex}`} className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Type</label>
                <select
                  id={`question_type_${qIndex}`}
                  value={q.question_type}
                  onChange={(e) => updateQuestion(qIndex, 'question_type', e.target.value)}
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400 outline-none"
                >
                  <option value="MCQ">Multiple Choice</option>
                  <option value="CHECKBOX">Multiple Response (Checkboxes)</option> {/* <-- NEW */}
                  <option value="SHORT_ANSWER">Short Answer (Exact Match)</option>
                  <option value="ESSAY">Essay / Long Text</option>
                  <option value="FILE_UPLOAD">File Upload</option>
                </select>
              </div>

              <div className="md:col-span-1">
                <label htmlFor={`max_score_${qIndex}`} className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Points</label>
                <input
                  id={`max_score_${qIndex}`}
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={q.max_score}
                  disabled={(q.rubric_criteria?.length || 0) > 0}
                  title={(q.rubric_criteria?.length || 0) > 0 ? "Derived from rubric criteria below" : undefined}
                  onChange={(e) => updateQuestion(qIndex, 'max_score', parseFloat(e.target.value) || 0)}
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:bg-white dark:focus:bg-slate-800 outline-none text-center disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            {/* Optional Grading Rubric — mainly useful for manually-graded question types */}
            {(q.question_type === 'ESSAY' || q.question_type === 'FILE_UPLOAD') && (
              <div className="pl-4 border-l-2 border-purple-200 dark:border-purple-500/40 mt-4 bg-purple-50/40 dark:bg-purple-500/10 p-4 rounded-r-lg space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <ClipboardList className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  <label className="block text-xs font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wider">Grading Rubric (Optional)</label>
                </div>
                <p className="text-xs text-purple-600/80 dark:text-purple-400/80 mb-2">
                  Break this question into scored criteria. When used, the Points field above is auto-summed from these.
                </p>
                {(q.rubric_criteria || []).map((c, cIndex) => (
                  <div key={cIndex} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={c.criterion_text}
                      onChange={(e) => updateCriterion(qIndex, cIndex, 'criterion_text', e.target.value)}
                      placeholder={`Criterion ${cIndex + 1}, e.g. "Clarity of argument"`}
                      className="flex-1 p-2 bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-500/40 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 dark:focus:border-purple-400"
                    />
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={c.max_points}
                      onChange={(e) => updateCriterion(qIndex, cIndex, 'max_points', parseFloat(e.target.value) || 0)}
                      className="w-20 p-2 bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-500/40 rounded-lg text-sm outline-none text-center"
                      aria-label={`Points for criterion ${cIndex + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeCriterion(qIndex, cIndex)}
                      className="text-purple-400 dark:text-purple-500 hover:text-red-500 dark:hover:text-red-400 p-1.5"
                      aria-label={`Remove criterion ${cIndex + 1}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addCriterion(qIndex)}
                  className="mt-1 text-sm font-medium text-purple-700 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-300 flex items-center gap-1 p-1 rounded transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add Criterion
                </button>
              </div>
            )}

            {/* --- CONDITIONAL RENDERING BASED ON QUESTION TYPE --- */}

            {/* 1. Multiple Choice & Multiple Response (Checkboxes) Logic */}
            {(q.question_type === 'MCQ' || q.question_type === 'CHECKBOX') && (
              <div className="pl-4 border-l-2 border-blue-200 dark:border-blue-500/40 space-y-3 mt-4">

                {/* Header for Options */}
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {q.question_type === 'MCQ' ? 'Answer Choices (Pick 1)' : 'Answer Choices (Pick up to 3)'}
                  </label>

                  {/* Limit Setter for Checkboxes */}
                  {q.question_type === 'CHECKBOX' && (
                    <div className="flex items-center gap-2 text-xs">
                      <label htmlFor={`required_answers_${qIndex}`} className="text-slate-600 dark:text-slate-300 font-medium">Required Answers:</label>
                      <input
                        id={`required_answers_${qIndex}`}
                        type="number"
                        min="1"
                        max="3"
                        value={q.required_answers || 2}
                        onChange={(e) => {
                          let val = parseInt(e.target.value);
                          if (val > 3) val = 3;
                          if (val < 1) val = 1;
                          updateQuestion(qIndex, 'required_answers', val);
                        }}
                        className="w-12 p-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded text-center focus:outline-none focus:border-blue-500 dark:focus:border-blue-400"
                      />
                    </div>
                  )}
                </div>

                {/* Options List */}
                {q.options?.map((opt, optIndex) => (
                  <div key={optIndex} className="flex items-center gap-3">
                    {/* The Correct Answer Selector */}
                    <button
                      type="button"
                      onClick={() => setCorrectOption(qIndex, optIndex)}
                      className="shrink-0 focus:outline-none transition-transform active:scale-95"
                      title={opt.is_correct ? "Remove as correct answer" : "Mark as correct answer"}
                    >
                      {/* Render Circle for MCQ, Square for CHECKBOX */}
                      {q.question_type === 'MCQ' ? (
                        opt.is_correct ? <CheckCircle2 className="w-6 h-6 text-emerald-500" /> : <Circle className="w-6 h-6 text-slate-300 dark:text-slate-600 hover:text-emerald-400" />
                      ) : (
                        opt.is_correct ? <CheckSquare className="w-6 h-6 text-blue-600" /> : <Square className="w-6 h-6 text-slate-300 dark:text-slate-600 hover:text-blue-400" />
                      )}
                    </button>

                    <input
                      type="text"
                      value={opt.option_text}
                      onChange={(e) => updateOptionText(qIndex, optIndex, e.target.value)}
                      placeholder={`Option ${optIndex + 1}`}
                      className={`flex-1 p-2 bg-slate-50 dark:bg-slate-800 border rounded-lg text-sm outline-none transition-all ${opt.is_correct ? (q.question_type === 'MCQ' ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-500/10' : 'border-blue-300 dark:border-blue-500/40 bg-blue-50/30 dark:bg-blue-500/10') : 'border-slate-200 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-800 focus:border-blue-500 dark:focus:border-blue-400'}`}
                    />

                    <button
                      type="button"
                      onClick={() => removeOption(qIndex, optIndex)}
                      className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 p-2"
                      title="Remove option"
                      aria-label="Remove option"
                      disabled={(q.options?.length || 0) <= 2}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => addOption(qIndex)}
                  className="mt-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center gap-1 p-1 rounded transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add Option
                </button>
              </div>
            )}

            {/* 2. Short Answer Logic */}
            {q.question_type === 'SHORT_ANSWER' && (
              <div className="pl-4 border-l-2 border-emerald-200 dark:border-emerald-500/40 mt-4 bg-emerald-50/50 dark:bg-emerald-500/10 p-4 rounded-r-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                  <div className="flex-1">
                    <label htmlFor={`exact_match_${qIndex}`} className="block text-sm font-medium text-emerald-800 dark:text-emerald-300 mb-1">Exact Match Answer Key</label>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-3">The system will auto-grade the student's answer against this exact text (ignoring capitalization).</p>
                    <input
                      id={`exact_match_${qIndex}`}
                      type="text"
                      value={q.exact_match_answer || ''}
                      onChange={(e) => updateQuestion(qIndex, 'exact_match_answer', e.target.value)}
                      placeholder="e.g., 42, Paris, Mitochondria"
                      className="w-full p-2.5 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-500/40 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 dark:focus:border-emerald-400"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 3. File Upload Visual Zone */}
            {q.question_type === 'FILE_UPLOAD' && (
              <div className="pl-4 border-l-2 border-slate-200 dark:border-slate-700 mt-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-r-lg border border-dashed flex flex-col items-center justify-center">
                <UploadCloud className="w-8 h-8 text-slate-400 dark:text-slate-500 mb-2" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Student File Upload Zone</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Students will see a button here to upload their PDF, Document, or Image.</p>
              </div>
            )}

            {/* 4. Essay & File Upload Warning */}
            {(q.question_type === 'ESSAY' || q.question_type === 'FILE_UPLOAD') && (
              <div className="pl-4 border-l-2 border-amber-200 dark:border-amber-500/40 mt-4 bg-amber-50/50 dark:bg-amber-500/10 p-3 rounded-r-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  This question cannot be auto-graded. It will be flagged for manual review after submission.
                </p>
              </div>
            )}

          </div>
        </div>
      ))}

      {/* Global Add Question Button */}
      <button
        type="button"
        onClick={addQuestion}
        className="w-full py-4 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 hover:border-slate-400 dark:hover:border-slate-500 transition-all flex flex-col items-center justify-center gap-2"
      >
        <Plus className="w-6 h-6" />
        <span className="font-semibold">Add New Question</span>
      </button>

    </div>
  );
}

import React from 'react';
import { 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Circle,
  CheckSquare,  // <-- NEW: Added for Checkbox UI
  Square,       // <-- NEW: Added for Checkbox UI
  GripVertical,
  AlertCircle,
  UploadCloud   // <-- NEW: Added for File Upload visual
} from 'lucide-react';
import toast from 'react-hot-toast'; // <-- NEW: Added to trigger the Max 3 warning
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
    setQuestions(questions.filter((_, index) => index !== indexToRemove));
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
    const updatedQuestions = [...questions];
    updatedQuestions[qIndex].options?.push({ option_text: '', is_correct: false });
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

  return (
    <div className="space-y-6">
      
      {questions.map((q, qIndex) => (
        <div key={qIndex} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
          
          {/* Question Header */}
          <div className="bg-slate-50 border-b border-slate-200 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GripVertical className="w-5 h-5 text-slate-400 cursor-grab active:cursor-grabbing" />
              <h4 className="font-semibold text-slate-700">Question {qIndex + 1}</h4>
            </div>
            <button 
              type="button" 
              onClick={() => removeQuestion(qIndex)}
              className="text-slate-400 hover:text-red-600 transition-colors p-1"
              title="Remove question"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* Question Text & Core Settings */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-8">
                <label className="block text-sm font-medium text-slate-700 mb-1">Question Prompt</label>
                <textarea 
                  rows={2}
                  value={q.question_text}
                  onChange={(e) => updateQuestion(qIndex, 'question_text', e.target.value)}
                  placeholder="Type your question here..."
                  title="Question Prompt"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all resize-y"
                />
              </div>
              
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <select 
                  value={q.question_type}
                  onChange={(e) => updateQuestion(qIndex, 'question_type', e.target.value)}
                  title="Type"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                >
                  <option value="MCQ">Multiple Choice</option>
                  <option value="CHECKBOX">Multiple Response (Checkboxes)</option> {/* <-- NEW */}
                  <option value="SHORT_ANSWER">Short Answer (Exact Match)</option>
                  <option value="ESSAY">Essay / Long Text</option>
                  <option value="FILE_UPLOAD">File Upload</option>
                </select>
              </div>

              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">Points</label>
                <input 
                  id={`max_score_${qIndex}`}
                  type="number" 
                  min="1"
                  value={q.max_score}
                  title="Points"
                  onChange={(e) => updateQuestion(qIndex, 'max_score', parseInt(e.target.value) || 0)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white outline-none text-center"
                />
              </div>
            </div>

            {/* --- CONDITIONAL RENDERING BASED ON QUESTION TYPE --- */}
            
            {/* 1. Multiple Choice & Multiple Response (Checkboxes) Logic */}
            {(q.question_type === 'MCQ' || q.question_type === 'CHECKBOX') && (
              <div className="pl-4 border-l-2 border-blue-200 space-y-3 mt-4">
                
                {/* Header for Options */}
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                    {q.question_type === 'MCQ' ? 'Answer Choices (Pick 1)' : 'Answer Choices (Pick up to 3)'}
                  </label>

                  {/* Limit Setter for Checkboxes */}
                  {q.question_type === 'CHECKBOX' && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-600 font-medium">Required Answers:</span>
                      <input 
                        type="number"
                        min="1"
                        max="3"
                        value={q.required_answers || 2}
                        title="Required Answers"
                        onChange={(e) => {
                          let val = parseInt(e.target.value);
                          if (val > 3) val = 3;
                          if (val < 1) val = 1;
                          updateQuestion(qIndex, 'required_answers', val);
                        }}
                        className="w-12 p-1 border border-slate-200 rounded text-center focus:outline-none focus:border-blue-500"
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
                        opt.is_correct ? <CheckCircle2 className="w-6 h-6 text-emerald-500" /> : <Circle className="w-6 h-6 text-slate-300 hover:text-emerald-400" />
                      ) : (
                        opt.is_correct ? <CheckSquare className="w-6 h-6 text-blue-600" /> : <Square className="w-6 h-6 text-slate-300 hover:text-blue-400" />
                      )}
                    </button>
                    
                    <input 
                      type="text" 
                      value={opt.option_text}
                      onChange={(e) => updateOptionText(qIndex, optIndex, e.target.value)}
                      placeholder={`Option ${optIndex + 1}`}
                      className={`flex-1 p-2 bg-slate-50 border rounded-lg text-sm outline-none transition-all ${opt.is_correct ? (q.question_type === 'MCQ' ? 'border-emerald-300 bg-emerald-50/30' : 'border-blue-300 bg-blue-50/30') : 'border-slate-200 focus:bg-white focus:border-blue-500'}`}
                    />
                    
                    <button 
                      type="button"
                      onClick={() => removeOption(qIndex, optIndex)}
                      className="text-slate-400 hover:text-red-500 p-2"
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
                  className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 p-1 rounded transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add Option
                </button>
              </div>
            )}

            {/* 2. Short Answer Logic */}
            {q.question_type === 'SHORT_ANSWER' && (
              <div className="pl-4 border-l-2 border-emerald-200 mt-4 bg-emerald-50/50 p-4 rounded-r-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-emerald-600 mt-0.5" />
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-emerald-800 mb-1">Exact Match Answer Key</label>
                    <p className="text-xs text-emerald-600 mb-3">The system will auto-grade the student's answer against this exact text (ignoring capitalization).</p>
                    <input 
                      type="text" 
                      value={q.exact_match_answer || ''}
                      onChange={(e) => updateQuestion(qIndex, 'exact_match_answer', e.target.value)}
                      placeholder="e.g., 42, Paris, Mitochondria"
                      className="w-full p-2.5 bg-white border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 3. File Upload Visual Zone */}
            {q.question_type === 'FILE_UPLOAD' && (
              <div className="pl-4 border-l-2 border-slate-200 mt-4 p-4 bg-slate-50 rounded-r-lg border border-dashed flex flex-col items-center justify-center">
                <UploadCloud className="w-8 h-8 text-slate-400 mb-2" />
                <p className="text-sm font-medium text-slate-700">Student File Upload Zone</p>
                <p className="text-xs text-slate-500 mt-1">Students will see a button here to upload their PDF, Document, or Image.</p>
              </div>
            )}

            {/* 4. Essay & File Upload Warning */}
            {(q.question_type === 'ESSAY' || q.question_type === 'FILE_UPLOAD') && (
              <div className="pl-4 border-l-2 border-amber-200 mt-4 bg-amber-50/50 p-3 rounded-r-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <p className="text-sm text-amber-800">
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
        className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:bg-slate-50 hover:text-slate-800 hover:border-slate-400 transition-all flex flex-col items-center justify-center gap-2"
      >
        <Plus className="w-6 h-6" />
        <span className="font-semibold">Add New Question</span>
      </button>

    </div>
  );
}
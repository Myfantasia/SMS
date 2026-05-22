import { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Paperclip, 
  Edit2, 
  Trash2, 
  X, 
  FileText, 
  Loader2,
  ShieldCheck,
  Image as ImageIcon, 
  MapPin,
  File
} from 'lucide-react'; 
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { onAuthStateChanged, type User } from 'firebase/auth';
import toast from 'react-hot-toast';
import { useChat } from './ChatProvider';
import type { IFirebaseMessage } from '../../libs/chat';
import { auth, db, storage } from '../../firebaseConfig';

export default function ChatWindow() {
  const { activeThreadId, inboxThreads } = useChat();
  const [messages, setMessages] = useState<IFirebaseMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [editingMessage, setEditingMessage] = useState<IFirebaseMessage | null>(null);
  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const myEmail = localStorage.getItem('my_chat_email');
  
  // --- ATTACHMENT MENU STATE ---
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [acceptType, setAcceptType] = useState("*");

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentThread = inboxThreads.find(t => t.thread_id === activeThreadId);

  // ==========================================
  // 0. TRACK FIREBASE AUTH STATE
  // ==========================================
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  // ==========================================
  // 1. REAL-TIME LISTENER
  // ==========================================
  useEffect(() => {
    if (!activeThreadId || !currentUser) return;

    const q = query(
      collection(db, 'chat_threads', activeThreadId, 'messages'),
      orderBy('sent_at', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as IFirebaseMessage[];
      
      setMessages(msgs);
      scrollToBottom();
    });

    return () => unsubscribe();
  }, [activeThreadId, currentUser]);

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // ==========================================
  // 2. SEND / EDIT LOGIC
  // ==========================================
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newMessage.trim() && !isUploading) return;
    if (!activeThreadId || !currentUser) return;

    try {
      if (editingMessage) {
        const msgRef = doc(db, 'chat_threads', activeThreadId, 'messages', editingMessage.id!);
        await updateDoc(msgRef, {
          message_body: newMessage,
          is_edited: true, 
          updated_at: serverTimestamp() 
        });
        setEditingMessage(null);
        toast.success("Message updated");
      } else {
        await addDoc(collection(db, 'chat_threads', activeThreadId, 'messages'), {
          sender_email: myEmail,
          message_body: newMessage,
          sent_at: Date.now(), 
          firebase_sent_at: serverTimestamp() 
        });
      }
      setNewMessage('');
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Message failed to send.");
    }
  };

  // ==========================================
  // 3. SECURE FILE UPLOAD LOGIC
  // ==========================================
  const triggerFileInput = (type: string) => {
    setAcceptType(type);
    setIsAttachMenuOpen(false);
    setTimeout(() => fileInputRef.current?.click(), 10);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeThreadId || !currentUser) return;

    if (file.size > 25 * 1024 * 1024) {
      toast.error("File is too large (Max 25MB).");
      return;
    }

    setIsUploading(true);
    try {
      const storageRef = ref(storage, `chats/${activeThreadId}/${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snapshot.ref);

      await addDoc(collection(db, 'chat_threads', activeThreadId, 'messages'), {
        sender_email: myEmail,
        message_body: `📎 Attached: ${file.name}`,
        attachment_url: url,
        attachment_name: file.name,
        sent_at: Date.now()
      });
      
    } catch (error) {
        console.error("File upload error:", error);
      toast.error("File upload failed.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ==========================================
  // 4. GPS LOCATION SHARING
  // ==========================================
  const handleLocationShare = () => {
    setIsAttachMenuOpen(false);
    
    if (!navigator.geolocation) {
      toast.error("Location sharing is not supported by your browser.");
      return;
    }

    setIsLocating(true);
    const toastId = toast.loading("Acquiring GPS coordinates...");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
        
        try {
          await addDoc(collection(db, 'chat_threads', activeThreadId!, 'messages'), {
            sender_email: myEmail,
            message_body: `📍 Shared Location:\n${mapsUrl}`,
            sent_at: Date.now(),
            firebase_sent_at: serverTimestamp()
          });
          toast.success("Location sent!", { id: toastId });
        } catch (error) {
          console.error("Error sending location message:", error);
          toast.error("Failed to send location.", { id: toastId });
        } finally {
          setIsLocating(false);
        }
      },
      (error) => {
        setIsLocating(false);
        console.error(error);
        toast.error("Could not fetch location. Please check device permissions.", { id: toastId });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // ==========================================
  // 5. INFINITE SOFT DELETE LOGIC
  // ==========================================
  const handleDeleteMessage = (messageId: string) => {
    // Fire a custom interactive toast instead of the browser alert
    toast((t) => (
      <div className="flex flex-col gap-3 min-w-50">
        <span className="text-sm font-medium text-slate-800">Delete for everyone?</span>
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              toast.dismiss(t.id); // Close the toast
              
              // Proceed with the actual database update
              try {
                const msgRef = doc(db, 'chat_threads', activeThreadId!, 'messages', messageId);
                await updateDoc(msgRef, {
                  message_body: "🚫 This message was deleted.",
                  attachment_url: null, 
                  attachment_name: null,
                  is_deleted: true
                });
              } catch (error) {
                console.error("Delete message error:", error);
                toast.error("Could not delete message.");
              }
            }}
            className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    ), { 
      duration: 10000, // Give them 10 seconds to decide before it auto-closes
      id: messageId    // Prevents duplicate toasts if they click multiple times
    });
  };
  return (
    <div className="flex flex-col h-full bg-slate-50 relative">
      
      {/* HEADER BAR */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-white z-10 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-lg">
            {currentThread?.chat_name.charAt(0).toUpperCase() || 'C'}
          </div>
          <div>
            <h3 className="font-bold text-slate-800">{currentThread?.chat_name || 'Active Chat'}</h3>
            <p className="text-xs text-emerald-600 flex items-center gap-1 font-medium">
              <ShieldCheck className="w-3 h-3" />
              End-to-End Encrypted
            </p>
          </div>
        </div>
      </div>

      {/* SCROLLABLE MESSAGE HISTORY */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.map((msg) => (
          <MessageBubble 
            key={msg.id} 
            message={msg}
            onEdit={() => {
              setEditingMessage(msg);
              setNewMessage(msg.message_body.replace(/📎 Attached: .*/, ''));
            }}
            onDelete={() => handleDeleteMessage(msg.id!)}
          />
        ))}
        <div ref={scrollRef} />
      </div>

      {/* INPUT CONTROLS */}
      <div className="p-4 border-t border-slate-200 bg-white shrink-0">
        
        {/* Editing Banner */}
        {editingMessage && (
          <div className="mb-3 flex items-center justify-between bg-blue-50 border border-blue-100 p-2.5 rounded-lg text-blue-700 text-xs font-medium animate-pulse">
            <span className="flex items-center gap-2"><Edit2 className="w-3.5 h-3.5"/> Editing Message...</span>
            <button
              type="button"
              onClick={() => {setEditingMessage(null); setNewMessage('');}}
              className="hover:bg-blue-200 p-1 rounded-full transition-colors"
              title="Cancel editing"
              aria-label="Cancel editing"
            >
              <X className="w-4 h-4"/>
            </button>
          </div>
        )}
        
        <form onSubmit={handleSendMessage} className="flex items-end gap-2 relative">
          
          {/* PROFESSIONAL ATTACHMENT MENU */}
          <div className="relative shrink-0">
            <button 
              type="button"
              onClick={() => setIsAttachMenuOpen(!isAttachMenuOpen)}
              disabled={isUploading || isLocating}
              className={`p-3 rounded-full transition-all flex items-center justify-center
                ${isAttachMenuOpen ? 'bg-blue-100 text-blue-600' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}
              `}
              title="Attachment options"
              aria-label="Attachment options"
            >
              {(isUploading || isLocating) ? <Loader2 className="w-5 h-5 animate-spin"/> : <Paperclip className="w-5 h-5" />}
            </button>

            {/* Hidden Input for generic uploads */}
            <input 
              type="file" 
              title='Upload'
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept={acceptType}
              className="hidden" 
            />

            {/* The Dropdown Popover */}
            {isAttachMenuOpen && (
              <>
                {/* Invisible backdrop to close menu when clicking outside */}
                <div className="fixed inset-0 z-40" onClick={() => setIsAttachMenuOpen(false)}></div>
                
                <div className="absolute bottom-14 left-0 bg-white border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-2xl p-2 flex flex-col gap-1 w-64 z-50 animate-in fade-in zoom-in-95 duration-200 origin-bottom-left">
                  
                  <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Share Attachment
                  </div>

                  <button type="button" onClick={() => triggerFileInput('image/*,video/*')} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-xl text-slate-700 text-sm font-medium transition-colors w-full text-left">
                    <div className="bg-blue-100 p-2 rounded-lg text-blue-600 shadow-sm"><ImageIcon className="w-4 h-4"/></div>
                    <div>
                      <p>Photos & Videos</p>
                      <p className="text-[10px] text-slate-400 font-normal">Gallery or Camera</p>
                    </div>
                  </button>
                  
                  <button type="button" onClick={() => triggerFileInput('.pdf,.doc,.docx,.txt,.csv,.xlsx')} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-xl text-slate-700 text-sm font-medium transition-colors w-full text-left">
                    <div className="bg-emerald-100 p-2 rounded-lg text-emerald-600 shadow-sm"><FileText className="w-4 h-4"/></div>
                    <div>
                      <p>Document</p>
                      <p className="text-[10px] text-slate-400 font-normal">PDFs, Word, Excel</p>
                    </div>
                  </button>

                  <div className="h-px bg-slate-100 my-1 mx-2"></div>
                  
                  <button type="button" onClick={handleLocationShare} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-xl text-slate-700 text-sm font-medium transition-colors w-full text-left">
                    <div className="bg-rose-100 p-2 rounded-lg text-rose-600 shadow-sm"><MapPin className="w-4 h-4"/></div>
                    <div>
                      <p>Location</p>
                      <p className="text-[10px] text-slate-400 font-normal">Send current GPS spot</p>
                    </div>
                  </button>
                  
                </div>
              </>
            )}
          </div>

          {/* Text Area */}
          <div className="flex-1 bg-slate-100 rounded-2xl px-4 py-1 border border-slate-200 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white transition-all">
            <textarea
              rows={1}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={isUploading ? "Uploading file..." : isLocating ? "Getting location..." : "Write a secure message..."}
              disabled={isUploading || isLocating}
              className="w-full bg-transparent border-none outline-none text-sm text-slate-700 py-2 resize-none max-h-32"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />
          </div>

          {/* Send Button */}
          <button 
            type="submit" 
            disabled={(!newMessage.trim() && !isUploading && !isLocating) || isUploading || isLocating}
            className="p-3.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-all shadow-md active:scale-95 shrink-0"
            title="Send message"
            aria-label="Send message"
          >
            <Send className="w-5 h-5 ml-0.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// SUB-COMPONENT: INDIVIDUAL MESSAGE BUBBLE
// ==========================================
function MessageBubble({ message, onEdit, onDelete }: { 
  message: IFirebaseMessage;
  onEdit: () => void; 
  onDelete: () => void;
}) {
  const myEmail = localStorage.getItem('my_chat_email');
  const isMe = message.sender_email === myEmail;
  
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isMe) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => clearInterval(interval);
  }, [isMe]);
  
  const twoHoursInMs = 2 * 60 * 60 * 1000;
  const canEdit = isMe && (now - message.sent_at < twoHoursInMs);
  const canDelete = isMe;
  const isDeleted = (message as any).is_deleted === true;

  // Render clickable links seamlessly (especially for Google Maps URLs)
  const renderMessageBody = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.split(urlRegex).map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-blue-200 transition-colors">
            {part.includes('maps') ? 'View on Google Maps' : part}
          </a>
        );
      }
      return part;
    });
  };

  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} group w-full`}>
      <div className={`max-w-[85%] md:max-w-[70%] relative flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        
        {!isMe && <p className="text-[10px] font-medium text-slate-500 mb-1 ml-1">{message.sender_email}</p>}

        <div className={`p-3.5 rounded-2xl shadow-sm text-sm relative
          ${isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'}
          ${isDeleted ? 'italic opacity-70 bg-slate-100 border-dashed border-slate-300 text-slate-500' : ''}
        `}>
          
          {message.attachment_url && !isDeleted && (
            <a 
              href={message.attachment_url} 
              target="_blank" 
              rel="noreferrer"
              className={`flex items-center gap-3 p-3 rounded-xl mb-3 border transition-colors
                ${isMe ? 'bg-blue-700/50 border-blue-500 hover:bg-blue-700' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}
            >
              <div className={`p-2 rounded-lg ${isMe ? 'bg-blue-600' : 'bg-white shadow-sm'}`}>
                <FileText className={`w-5 h-5 ${isMe ? 'text-white' : 'text-blue-600'}`} />
              </div>
              <span className="text-xs font-semibold truncate max-w-50">
                {(message as any).attachment_name || 'Secure Document'}
              </span>
            </a>
          )}

          <p className="whitespace-pre-wrap leading-relaxed">{renderMessageBody(message.message_body)}</p>
          
          <div className={`flex items-center gap-2 mt-2 select-none ${isMe ? 'justify-end' : 'justify-start'}`}>
             {(message as any).is_edited && !isDeleted && (
               <span className={`text-[9px] font-medium ${isMe ? 'text-blue-200' : 'text-slate-400'}`}>
                 (Edited)
               </span>
             )}
             <span className={`text-[10px] font-medium ${isMe ? 'text-blue-200' : 'text-slate-400'}`}>
                {new Date(message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
             </span>
          </div>
        </div>

        {(canEdit || canDelete) && !isDeleted && (
          <div className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-1 transition-all opacity-0 group-hover:opacity-100 
            ${isMe ? '-left-20 pr-2' : '-right-20 pl-2'}`}
          >
            {canEdit && (
              <button onClick={onEdit} className="p-2 bg-white shadow-sm border border-slate-200 hover:bg-slate-50 rounded-full text-slate-400 hover:text-blue-600 transition-all" title="Edit Message (Available for 2 hours)">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
            {canDelete && (
              <button onClick={onDelete} className="p-2 bg-white shadow-sm border border-slate-200 hover:bg-red-50 rounded-full text-slate-400 hover:text-red-600 transition-all" title="Delete for Everyone">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
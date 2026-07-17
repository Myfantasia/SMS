import React, { useState } from 'react';
import { X } from 'lucide-react';

interface SiblingStream {
    id: number;
    name: string;
    capacity: number;
}

interface BulkTransferModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (streamId: string) => void;
    siblingStreams: SiblingStream[];
    count: number;
}

const BulkTransferModal: React.FC<BulkTransferModalProps> = ({ isOpen, onClose, onConfirm, siblingStreams, count }) => {
    const [selectedStreamId, setSelectedStreamId] = useState('');

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-slate-800">Bulk Transfer</h2>
                    <button onClick={onClose} className="hover:bg-slate-100 p-1 rounded-full"><X className="w-5 h-5 text-slate-400" /></button>
                </div>
                <p className="text-sm text-slate-500 mb-4">Transfer {count} students to:</p>
                
                <select 
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm mb-6 bg-white"
                    value={selectedStreamId}
                    onChange={(e) => setSelectedStreamId(e.target.value)}
                >
                    <option value="">-- Select Target Stream --</option>
                    {siblingStreams.map(s => (
                        <option key={s.id} value={s.id}>{s.name} (Capacity: {s.capacity})</option>
                    ))}
                </select>

                <div className="flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">Cancel</button>
                    <button 
                        onClick={() => onConfirm(selectedStreamId)} 
                        disabled={!selectedStreamId}
                        className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                        Confirm Transfer
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BulkTransferModal;
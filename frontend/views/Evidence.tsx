import React from 'react';
import { CalibrationLog, ChatMessage, Language } from '../types';
import { Clock, AlertTriangle, FileText, Download } from 'lucide-react';
import { translations } from '../utils/translations';

interface Props {
  logs: CalibrationLog[];
  messages: ChatMessage[];
  language: Language;
}

export const Evidence: React.FC<Props> = ({ logs, messages, language }) => {
  const t = translations[language];

  const exportData = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ logs, messages }, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href",     dataStr);
    downloadAnchorNode.setAttribute("download", "cognisync_research_export.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-100">{t.researchLogs}</h2>
            <p className="text-slate-500">{t.logsDesc}</p>
          </div>
          <button 
            onClick={exportData}
            className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors"
          >
            <Download size={16} />
            <span>{t.exportJson}</span>
          </button>
      </div>

      <div className="space-y-8 relative before:absolute before:left-6 before:top-0 before:h-full before:w-0.5 before:bg-slate-800">
        
        {/* Merge logs and messages if we wanted a unified timeline, but for now let's just show logs */}
        {logs.map((log) => (
            <div key={log.id} className="relative pl-16">
                <div className="absolute left-4 top-2 w-5 h-5 bg-slate-900 border-2 border-indigo-500 rounded-full z-10"></div>
                
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-indigo-500/30 transition-colors">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center space-x-2">
                            <span className={`px-2 py-1 text-xs font-bold rounded uppercase tracking-wider ${
                                log.type === 'Profile' ? 'bg-indigo-900/50 text-indigo-300' : 'bg-amber-900/50 text-amber-300'
                            }`}>
                                {log.type} Calibration
                            </span>
                            <span className="text-sm text-slate-500 flex items-center space-x-1">
                                <Clock size={14} />
                                <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                            </span>
                        </div>
                        <div className="text-right">
                             <div className="text-xs text-slate-500 uppercase">{t.totalDisagreement} (Idx)</div>
                             <div className="font-mono font-bold text-slate-200">{Math.round(log.disagreementIndex)}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4 bg-slate-950/50 p-4 rounded-lg">
                        <div>
                            <span className="text-xs text-slate-500 block">{t.modelLabel}</span>
                            <code className="text-xs text-rose-300 block mt-1">
                                {typeof log.modelValue === 'object' 
                                    ? JSON.stringify(log.modelValue).replace(/"/g, '').replace(/,/g, ', ') 
                                    : `${log.modelValue}%`}
                            </code>
                        </div>
                        <div>
                            <span className="text-xs text-slate-500 block">{t.userLabel}</span>
                            <code className="text-xs text-emerald-300 block mt-1">
                                {typeof log.userValue === 'object' 
                                    ? JSON.stringify(log.userValue).replace(/"/g, '').replace(/,/g, ', ') 
                                    : `${log.userValue}%`}
                            </code>
                        </div>
                    </div>

                    {log.reason && (
                        <div className="flex items-start space-x-2 text-sm text-slate-300">
                            <FileText size={16} className="mt-1 text-slate-500 shrink-0" />
                            <p>"{log.reason}"</p>
                        </div>
                    )}
                    
                    {log.likertTrust && (
                         <div className="mt-4 pt-4 border-t border-slate-800 flex items-center space-x-2">
                            <span className="text-xs text-slate-500">{t.trustScore}:</span>
                            <div className="flex space-x-1">
                                {[1,2,3,4,5].map(n => (
                                    <div key={n} className={`w-2 h-2 rounded-full ${n <= log.likertTrust! ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                                ))}
                            </div>
                         </div>
                    )}
                </div>
            </div>
        ))}

        {logs.length === 0 && (
            <div className="pl-16 text-slate-500 italic">{t.noLogs}</div>
        )}

      </div>
    </div>
  );
};
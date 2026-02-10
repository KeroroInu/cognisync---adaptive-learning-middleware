import React from 'react';
import { CalibrationLog, ChatMessage, Language } from '../types';
import { Clock, AlertTriangle, FileText, Download } from 'lucide-react';
import { translations } from '../utils/translations';

interface Props {
  logs: CalibrationLog[];
  messages: ChatMessage[];
  language: Language;
  theme: 'light' | 'dark';
}

export const Evidence: React.FC<Props> = ({ logs, messages, language, theme }) => {
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
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold" style={{ color: theme === 'light' ? '#000000' : '#ffffff' }}>{t.researchLogs}</h2>
            <p style={{ color: theme === 'light' ? '#404040' : '#e2e8f0' }}>{t.logsDesc}</p>
          </div>
          <button
            onClick={exportData}
            className="flex items-center space-x-2 px-4 py-2 glass-card hover:shadow-lg rounded-lg transition-all duration-300 active:scale-95"
            style={{ color: theme === 'light' ? '#000000' : '#ffffff' }}
          >
            <Download size={16} />
            <span>{t.exportJson}</span>
          </button>
      </div>

      <div className="space-y-8 relative">
        <div className="absolute left-6 top-0 h-full w-0.5" style={{
          backgroundColor: theme === 'light' ? 'rgba(0, 0, 0, 0.15)' : '#475569'
        }}></div>

        {/* Merge logs and messages if we wanted a unified timeline, but for now let's just show logs */}
        {logs.map((log, idx) => (
            <div key={log.id} className={`relative pl-16 animate-slide-in-left stagger-${Math.min(idx + 1, 6)}`}>
                <div className="absolute left-4 top-2 w-5 h-5 border-2 border-indigo-500 rounded-full z-10 shadow-md" style={{
                  backgroundColor: theme === 'light' ? '#ffffff' : '#0f172a'
                }}></div>

                <div className="glass-card p-6 hover:shadow-xl transition-all duration-300">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center space-x-2">
                            <span className="px-2 py-1 text-xs font-bold rounded uppercase tracking-wider" style={{
                              backgroundColor: log.type === 'Profile'
                                ? (theme === 'light' ? '#e0e7ff' : '#312e81')
                                : (theme === 'light' ? '#fef3c7' : '#78350f'),
                              color: log.type === 'Profile'
                                ? (theme === 'light' ? '#4338ca' : '#a5b4fc')
                                : (theme === 'light' ? '#92400e' : '#fbbf24')
                            }}>
                                {log.type} Calibration
                            </span>
                            <span className="text-sm flex items-center space-x-1" style={{
                              color: theme === 'light' ? '#404040' : '#cbd5e1'
                            }}>
                                <Clock size={14} />
                                <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                            </span>
                        </div>
                        <div className="text-right">
                             <div className="text-xs uppercase" style={{
                               color: theme === 'light' ? '#404040' : '#e2e8f0'
                             }}>{t.totalDisagreement} (Idx)</div>
                             <div className="font-mono font-bold" style={{
                               color: theme === 'light' ? '#000000' : '#ffffff'
                             }}>{Math.round(log.disagreementIndex)}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4 p-4 rounded-lg" style={{
                      backgroundColor: theme === 'light' ? '#f9fafb' : '#1e293b',
                      border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
                    }}>
                        <div>
                            <span className="text-xs block" style={{
                              color: theme === 'light' ? '#404040' : '#e2e8f0'
                            }}>{t.modelLabel}</span>
                            <code className="text-xs text-rose-600 dark:text-rose-300 block mt-1">
                                {typeof log.modelValue === 'object'
                                    ? JSON.stringify(log.modelValue).replace(/"/g, '').replace(/,/g, ', ')
                                    : `${log.modelValue}%`}
                            </code>
                        </div>
                        <div>
                            <span className="text-xs block" style={{
                              color: theme === 'light' ? '#404040' : '#e2e8f0'
                            }}>{t.userLabel}</span>
                            <code className="text-xs text-emerald-600 dark:text-emerald-300 block mt-1">
                                {typeof log.userValue === 'object'
                                    ? JSON.stringify(log.userValue).replace(/"/g, '').replace(/,/g, ', ')
                                    : `${log.userValue}%`}
                            </code>
                        </div>
                    </div>

                    {log.reason && (
                        <div className="flex items-start space-x-2 text-sm" style={{
                          color: theme === 'light' ? '#000000' : '#ffffff'
                        }}>
                            <FileText size={16} className="mt-1 shrink-0" style={{
                              color: theme === 'light' ? '#6b7280' : '#94a3b8'
                            }} />
                            <p>"{log.reason}"</p>
                        </div>
                    )}

                    {log.likertTrust && (
                         <div className="mt-4 pt-4 flex items-center space-x-2" style={{
                           borderTop: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
                         }}>
                            <span className="text-xs" style={{
                              color: theme === 'light' ? '#404040' : '#cbd5e1'
                            }}>{t.trustScore}:</span>
                            <div className="flex space-x-1">
                                {[1,2,3,4,5].map(n => (
                                    <div key={n} className={`w-2 h-2 rounded-full ${n <= log.likertTrust! ? 'bg-emerald-500 shadow-sm' : ''}`} style={n > log.likertTrust! ? {
                                      backgroundColor: theme === 'light' ? '#d1d5db' : '#475569'
                                    } : {}} />
                                ))}
                            </div>
                         </div>
                    )}
                </div>
            </div>
        ))}

        {logs.length === 0 && (
            <div className="pl-16 italic" style={{
              color: theme === 'light' ? '#6b7280' : '#cbd5e1'
            }}>{t.noLogs}</div>
        )}

      </div>
    </div>
  );
};
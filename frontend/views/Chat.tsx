import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, Language } from '../types';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import { translations } from '../utils/translations';

interface Props {
  messages: ChatMessage[];
  onSendMessage: (text: string, role: 'user' | 'assistant', analysis?: any) => void;
  language: Language;
}

export const Chat: React.FC<Props> = ({ messages, onSendMessage, language }) => {
  const t = translations[language];
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    // User Message
    onSendMessage(input, 'user');
    const userText = input;
    setInput('');
    setIsTyping(true);

    // Simulate AI Latency & Analysis
    setTimeout(() => {
        // Simple heuristic mock response logic
        let responseText = language === 'zh' ? "你能再详细说明一下吗？" : "Could you elaborate on that?";
        let analysisMock = {
            intent: 'statement',
            emotion: 'neutral',
            detectedConcepts: [],
            delta: { cognition: 0, affect: 0, behavior: 0 }
        };

        const lcText = userText.toLowerCase();

        if (lcText.includes('understand') || lcText.includes('confus') || lcText.includes('不懂') || lcText.includes('困惑')) {
            responseText = language === 'zh' 
                ? "我注意到你有些困惑。让我们看看知识图谱中关于“过拟合”的分解。" 
                : "I notice some confusion. Let's look at the Knowledge Graph for a breakdown of 'Overfitting'.";
            analysisMock = {
                intent: 'help-seeking',
                emotion: 'confused',
                detectedConcepts: language === 'zh' ? ['过拟合', '神经网络'] : ['Overfitting', 'Neural Networks'],
                delta: { cognition: -5, affect: -10, behavior: +5 }
            };
        } else if (lcText.includes('yes') || lcText.includes('good') || lcText.includes('是') || lcText.includes('好')) {
            responseText = language === 'zh'
                ? "太好了！你对这些概念的掌握似乎很扎实。接下来我们讨论优化技术。"
                : "Great! Your grasp of these concepts seems strong. Moving on to optimization techniques.";
            analysisMock = {
                intent: 'confirmation',
                emotion: 'confident',
                detectedConcepts: language === 'zh' ? ['梯度下降'] : ['Gradient Descent'],
                delta: { cognition: +8, affect: +5, behavior: +2 }
            };
        } else {
             responseText = language === 'zh'
                ? "这是一个有趣的观点。你认为这与反向传播有什么关系？"
                : "That's an interesting perspective. How do you think this relates to backpropagation?";
             analysisMock = {
                intent: 'elaborate',
                emotion: 'neutral',
                detectedConcepts: language === 'zh' ? ['反向传播'] : ['Backpropagation'],
                delta: { cognition: +2, affect: 0, behavior: +2 }
            };
        }

        onSendMessage(responseText, 'assistant', analysisMock);
        setIsTyping(false);
    }, 1500);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-6">
      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={scrollRef}>
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-emerald-600'}`}>
                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className={`p-4 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user' 
                    ? 'bg-indigo-600/20 text-indigo-100 border border-indigo-500/30 rounded-tr-sm' 
                    : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-tl-sm'
                }`}>
                    {msg.text}
                </div>
              </div>
            </div>
          ))}
          {isTyping && (
             <div className="flex justify-start">
                 <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center shrink-0 animate-pulse">
                         <Bot size={16} />
                    </div>
                    <div className="bg-slate-800 p-4 rounded-2xl rounded-tl-sm flex space-x-1 items-center">
                        <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms'}}></div>
                        <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms'}}></div>
                        <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms'}}></div>
                    </div>
                 </div>
             </div>
          )}
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 border-t border-slate-800 bg-slate-900">
            <div className="relative">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={t.inputPlaceholder}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 pl-4 pr-12 text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <button 
                    type="submit" 
                    disabled={!input.trim()}
                    className="absolute right-2 top-2 p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <Send size={18} />
                </button>
            </div>
        </form>
      </div>

      {/* Analysis Sidebar (Last Message Context) */}
      <div className="w-80 shrink-0 space-y-4">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">{t.turnAnalysis}</h3>
        
        {messages.filter(m => m.role === 'assistant' && m.analysis).slice(-1).map((msg) => (
             <div key={`analysis-${msg.id}`} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center space-x-2 text-indigo-400 mb-2">
                    <Sparkles size={16} />
                    <span className="font-semibold text-sm">{t.turnAnalysis}</span>
                </div>
                
                <div className="space-y-3">
                    <div>
                        <span className="text-xs text-slate-500 block mb-1">{t.detectedIntent}</span>
                        <span className="inline-block px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-slate-300 capitalize">
                            {msg.analysis?.intent}
                        </span>
                    </div>
                    <div>
                         <span className="text-xs text-slate-500 block mb-1">{t.emotionState}</span>
                         <span className="inline-block px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-slate-300 capitalize">
                            {msg.analysis?.emotion}
                         </span>
                    </div>
                    <div>
                        <span className="text-xs text-slate-500 block mb-1">{t.profileImpact}</span>
                        <div className="grid grid-cols-3 gap-2">
                            {Object.entries(msg.analysis?.delta || {}).map(([key, val]) => (
                                <div key={key} className={`text-center p-1 rounded border text-xs ${
                                    (val as number) > 0 
                                    ? 'bg-emerald-950/30 border-emerald-900 text-emerald-400' 
                                    : (val as number) < 0 
                                        ? 'bg-rose-950/30 border-rose-900 text-rose-400'
                                        : 'bg-slate-800 border-slate-700 text-slate-500'
                                }`}>
                                    {t[key as keyof typeof t]?.toString().substring(0,3)} {(val as number) > 0 ? '+' : ''}{val}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
             </div>
        ))}

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h4 className="text-xs text-slate-500 mb-2">{t.systemStatus}</h4>
            <div className="flex items-center space-x-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                <span className="text-sm text-slate-300">{t.trackingConcepts}</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
                System is actively monitoring for misconceptions regarding <strong>{language === 'zh' ? '神经网络' : 'Neural Networks'}</strong>.
            </p>
        </div>
      </div>
    </div>
  );
};
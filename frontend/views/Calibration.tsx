import React, { useState } from 'react';
import { RadarDisplay } from '../components/RadarDisplay';
import { UserProfile, CalibrationLog, Language } from '../types';
import { CheckCircle2, AlertCircle, Edit3 } from 'lucide-react';
import { translations } from '../utils/translations';
import { postCalibration, type CalibrationDimension } from '../services/api';

interface Props {
  profile: UserProfile;
  onLogCalibration: (log: Omit<CalibrationLog, 'id' | 'timestamp'>) => void;
  language: Language;
  theme: 'light' | 'dark';
}

export const Calibration: React.FC<Props> = ({ profile, onLogCalibration, language, theme }) => {
  const t = translations[language];
  const [selfProfile, setSelfProfile] = useState<UserProfile>({ ...profile });
  const [reason, setReason] = useState('');
  const [likertTrust, setLikertTrust] = useState<number>(3);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const calculateTotalDelta = () => {
    return Math.abs(profile.cognition - selfProfile.cognition) +
           Math.abs(profile.affect - selfProfile.affect) +
           Math.abs(profile.behavior - selfProfile.behavior);
  };

  const handleSubmit = async () => {
    if (saving) return;
    const disagreement = calculateTotalDelta();
    const comment = reason || 'User submitted calibration';

    // 三个维度分三次上报：后端一条记录只承载一个维度，冲突等级也按维度计算。
    // 串行而非并发——一次自我校准不赶时间，串行能在第一个失败时立刻停下，
    // 不会把「后两个维度也写进去了」这种半截状态铺得更开。
    const dimensions: CalibrationDimension[] = ['cognition', 'affect', 'behavior'];
    setSaving(true);
    setSaveError(null);
    try {
      for (const dimension of dimensions) {
        await postCalibration({
          dimension,
          systemValue: profile[dimension],
          userValue: selfProfile[dimension],
          userComment: comment,
          likertTrust,
        });
      }
    } catch {
      // 落库失败时**不**显示"已记录"。校准是元认知分析的唯一数据源，
      // 学生不会主动做第二次；界面骗他一次，这条数据就永久缺失且无人察觉。
      setSaveError(
        language === 'zh'
          ? '校准没能保存，请检查网络后再点一次提交。'
          : 'Your calibration was not saved. Check your connection and submit again.',
      );
      return;
    } finally {
      setSaving(false);
    }

    onLogCalibration({
        type: 'Profile',
        modelValue: profile,
        userValue: selfProfile,
        reason: comment,
        disagreementIndex: disagreement,
        likertTrust: likertTrust
    });
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full">
      {/* Left: Visualization */}
      <div className="flex flex-col glass-card p-6 animate-fade-in hover:shadow-xl transition-all duration-300">
        <h2 className="text-xl font-bold mb-2" style={{ color: theme === 'light' ? '#000000' : '#ffffff' }}>{t.modelAlignment}</h2>
        <p className="text-sm mb-6" style={{ color: theme === 'light' ? '#404040' : '#e2e8f0' }}>{t.compareDesc}</p>

        <div className="flex-1 min-h-[300px]">
            <RadarDisplay data={profile} compareData={selfProfile} showLegend language={language} />
        </div>

        <div className="mt-6 p-4 rounded-lg" style={{
          backgroundColor: theme === 'light' ? '#f9fafb' : '#334155',
          border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
        }}>
            <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold" style={{ color: theme === 'light' ? '#000000' : '#ffffff' }}>{t.totalDisagreement}</span>
                <span className="text-xl font-mono" style={{ color: theme === 'light' ? '#000000' : '#ffffff' }}>{Math.round(calculateTotalDelta())}</span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{
              backgroundColor: theme === 'light' ? '#e5e7eb' : '#475569'
            }}>
                <div
                    className={`h-full transition-all duration-500 ${calculateTotalDelta() > 50 ? 'bg-rose-500' : 'bg-fuchsia-500'}`}
                    style={{ width: `${Math.min(100, calculateTotalDelta())}%`}}
                />
            </div>
            <p className="text-xs mt-2" style={{ color: theme === 'light' ? '#6b7280' : '#cbd5e1' }}>
                {calculateTotalDelta() < 20
                    ? t.highAlignment
                    : t.divergenceDetected}
            </p>
        </div>
      </div>

      {/* Right: Controls */}
      <div className="flex flex-col space-y-6 overflow-y-auto">
        {/* Sliders */}
        <div className="glass-card p-6 space-y-6 animate-slide-in-right stagger-2 hover:shadow-xl transition-all duration-300">
            <h3 className="text-lg font-medium flex items-center space-x-2" style={{ color: theme === 'light' ? '#000000' : '#ffffff' }}>
                <Edit3 size={18} /> <span>{t.adjustDimensions}</span>
            </h3>

            {(['cognition', 'affect', 'behavior'] as const).map((dim) => (
                <div key={dim} className="space-y-2">
                    <div className="flex justify-between">
                        <label className="capitalize text-sm font-medium" style={{ color: theme === 'light' ? '#000000' : '#ffffff' }}>{t[dim]}</label>
                        <div className="flex space-x-3 text-sm">
                            <span className="text-indigo-500 dark:text-indigo-300">AI: {Math.round(profile[dim])}</span>
                            <span className="text-fuchsia-400 dark:text-fuchsia-300">You: {selfProfile[dim]}</span>
                        </div>
                    </div>
                    <input
                        type="range"
                        min="0" max="100"
                        value={selfProfile[dim]}
                        onChange={(e) => setSelfProfile({...selfProfile, [dim]: parseInt(e.target.value)})}
                        className="w-full accent-fuchsia-500 h-2 rounded-lg appearance-none cursor-pointer"
                        style={{
                          backgroundColor: theme === 'light' ? '#e5e7eb' : '#475569'
                        }}
                    />
                    <div className="text-xs flex justify-between px-1" style={{ color: theme === 'light' ? '#6b7280' : '#cbd5e1' }}>
                         <span>Low</span>
                         <span>High</span>
                    </div>
                </div>
            ))}
        </div>

        {/* Evidence & Reason */}
        <div className="glass-card p-6 space-y-4 animate-slide-in-right stagger-3 hover:shadow-xl transition-all duration-300">
            <div>
                <label className="block text-sm font-medium mb-2" style={{ color: theme === 'light' ? '#000000' : '#ffffff' }}>{t.whyDiffer}</label>
                <textarea
                    className="w-full rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    rows={3}
                    placeholder={t.reasonPlaceholder}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    style={{
                      backgroundColor: theme === 'light' ? 'rgba(255, 255, 255, 0.8)' : '#1e293b',
                      border: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`,
                      color: theme === 'light' ? '#000000' : '#ffffff'
                    }}
                />
            </div>

            {/* Research Scale */}
            <div className="pt-4" style={{
              borderTop: `1px solid ${theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'}`
            }}>
                <label className="block text-sm font-medium mb-3" style={{ color: theme === 'light' ? '#000000' : '#ffffff' }}>{t.researchQuestion}</label>
                <div className="flex justify-between items-center px-2">
                    {[1, 2, 3, 4, 5].map((val) => (
                        <button
                            key={val}
                            onClick={() => setLikertTrust(val)}
                            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
                                likertTrust === val
                                ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white scale-110 shadow-lg shadow-indigo-500/30'
                                : ''
                            }`}
                            style={likertTrust !== val ? {
                              backgroundColor: theme === 'light' ? '#e5e7eb' : '#475569',
                              color: theme === 'light' ? '#000000' : '#ffffff'
                            } : {}}
                        >
                            {val}
                        </button>
                    ))}
                </div>
                <div className="flex justify-between text-xs mt-2 px-2" style={{ color: theme === 'light' ? '#6b7280' : '#cbd5e1' }}>
                    <span>{t.stronglyDisagree}</span>
                    <span>{t.stronglyAgree}</span>
                </div>
            </div>
        </div>

        {/* Submit */}
        {saveError && (
            <div className="flex items-start gap-2 mb-3 p-3 rounded-lg text-sm" style={{
              backgroundColor: theme === 'light' ? '#fef2f2' : '#7f1d1d',
              color: theme === 'light' ? '#991b1b' : '#fecaca',
            }}>
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <span>{saveError}</span>
            </div>
        )}
        <button
            onClick={handleSubmit}
            disabled={submitted || saving}
            className={`w-full py-4 rounded-xl font-bold text-white shadow-lg transition-all flex items-center justify-center space-x-2 animate-slide-in-right stagger-4 ${
                submitted
                ? 'bg-violet-600 cursor-default'
                : saving
                ? 'bg-indigo-400 cursor-wait'
                : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:shadow-indigo-500/30 hover:shadow-xl active:scale-[0.98]'
            }`}
        >
            {submitted ? (
                <>
                    <CheckCircle2 size={20} />
                    <span>{t.calibrationRecorded}</span>
                </>
            ) : saving ? (
                <span>{language === 'zh' ? '保存中…' : 'Saving…'}</span>
            ) : (
                <span>{t.confirmSubmit}</span>
            )}
        </button>
      </div>
    </div>
  );
};
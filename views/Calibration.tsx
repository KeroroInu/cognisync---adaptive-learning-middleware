import React, { useState } from 'react';
import { RadarDisplay } from '../components/RadarDisplay';
import { UserProfile, CalibrationLog, Language } from '../types';
import { CheckCircle2, AlertCircle, Edit3 } from 'lucide-react';
import { translations } from '../utils/translations';

interface Props {
  profile: UserProfile;
  onLogCalibration: (log: Omit<CalibrationLog, 'id' | 'timestamp'>) => void;
  language: Language;
}

export const Calibration: React.FC<Props> = ({ profile, onLogCalibration, language }) => {
  const t = translations[language];
  const [selfProfile, setSelfProfile] = useState<UserProfile>({ ...profile });
  const [reason, setReason] = useState('');
  const [likertTrust, setLikertTrust] = useState<number>(3);
  const [submitted, setSubmitted] = useState(false);

  const calculateTotalDelta = () => {
    return Math.abs(profile.cognition - selfProfile.cognition) +
           Math.abs(profile.affect - selfProfile.affect) +
           Math.abs(profile.behavior - selfProfile.behavior);
  };

  const handleSubmit = () => {
    const disagreement = calculateTotalDelta();
    onLogCalibration({
        type: 'Profile',
        modelValue: profile,
        userValue: selfProfile,
        reason: reason || "User submitted calibration",
        disagreementIndex: disagreement,
        likertTrust: likertTrust
    });
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full">
      {/* Left: Visualization */}
      <div className="flex flex-col bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-xl font-bold text-slate-100 mb-2">{t.modelAlignment}</h2>
        <p className="text-sm text-slate-500 mb-6">{t.compareDesc}</p>
        
        <div className="flex-1 min-h-[300px]">
            <RadarDisplay data={profile} compareData={selfProfile} showLegend language={language} />
        </div>

        <div className="mt-6 p-4 bg-slate-800/50 rounded-lg border border-slate-800">
            <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold text-slate-400">{t.totalDisagreement}</span>
                <span className="text-xl font-mono text-slate-200">{Math.round(calculateTotalDelta())}</span>
            </div>
            <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                <div 
                    className={`h-full transition-all duration-500 ${calculateTotalDelta() > 50 ? 'bg-rose-500' : 'bg-emerald-500'}`} 
                    style={{ width: `${Math.min(100, calculateTotalDelta())}%`}}
                />
            </div>
            <p className="text-xs text-slate-500 mt-2">
                {calculateTotalDelta() < 20 
                    ? t.highAlignment 
                    : t.divergenceDetected}
            </p>
        </div>
      </div>

      {/* Right: Controls */}
      <div className="flex flex-col space-y-6 overflow-y-auto">
        {/* Sliders */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
            <h3 className="text-lg font-medium text-slate-200 flex items-center space-x-2">
                <Edit3 size={18} /> <span>{t.adjustDimensions}</span>
            </h3>
            
            {(['cognition', 'affect', 'behavior'] as const).map((dim) => (
                <div key={dim} className="space-y-2">
                    <div className="flex justify-between">
                        <label className="capitalize text-sm text-slate-300 font-medium">{t[dim]}</label>
                        <div className="flex space-x-3 text-sm">
                            <span className="text-indigo-400">AI: {Math.round(profile[dim])}</span>
                            <span className="text-emerald-400">You: {selfProfile[dim]}</span>
                        </div>
                    </div>
                    <input 
                        type="range" 
                        min="0" max="100" 
                        value={selfProfile[dim]}
                        onChange={(e) => setSelfProfile({...selfProfile, [dim]: parseInt(e.target.value)})}
                        className="w-full accent-emerald-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="text-xs text-slate-500 flex justify-between px-1">
                         <span>Low</span>
                         <span>High</span>
                    </div>
                </div>
            ))}
        </div>

        {/* Evidence & Reason */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">{t.whyDiffer}</label>
                <textarea 
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
                    rows={3}
                    placeholder={t.reasonPlaceholder}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                />
            </div>
            
            {/* Research Scale */}
            <div className="pt-4 border-t border-slate-800">
                <label className="block text-sm font-medium text-slate-300 mb-3">{t.researchQuestion}</label>
                <div className="flex justify-between items-center px-2">
                    {[1, 2, 3, 4, 5].map((val) => (
                        <button
                            key={val}
                            onClick={() => setLikertTrust(val)}
                            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
                                likertTrust === val 
                                ? 'bg-indigo-600 text-white scale-110 shadow-lg shadow-indigo-500/20' 
                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                            }`}
                        >
                            {val}
                        </button>
                    ))}
                </div>
                <div className="flex justify-between text-xs text-slate-500 mt-2 px-2">
                    <span>{t.stronglyDisagree}</span>
                    <span>{t.stronglyAgree}</span>
                </div>
            </div>
        </div>

        {/* Submit */}
        <button 
            onClick={handleSubmit}
            disabled={submitted}
            className={`w-full py-4 rounded-xl font-bold text-white shadow-lg transition-all flex items-center justify-center space-x-2 ${
                submitted 
                ? 'bg-emerald-600 cursor-default' 
                : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:shadow-indigo-500/25 active:scale-[0.98]'
            }`}
        >
            {submitted ? (
                <>
                    <CheckCircle2 size={20} />
                    <span>{t.calibrationRecorded}</span>
                </>
            ) : (
                <span>{t.confirmSubmit}</span>
            )}
        </button>
      </div>
    </div>
  );
};
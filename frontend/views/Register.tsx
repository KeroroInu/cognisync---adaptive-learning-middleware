import React from 'react';
import { ClipboardList, MessageSquare, Check, ArrowLeft } from 'lucide-react';
import { translations } from '../utils/translations';
import type { Language } from '../types';

export interface RegisterProps {
  language: Language;
  onSelectMode: (mode: 'scale' | 'ai') => void;
  onNavigateToLogin: () => void;
}

export const Register: React.FC<RegisterProps> = ({
  language,
  onSelectMode,
  onNavigateToLogin
}) => {
  const t = translations[language];

  return (
    <div className="min-h-screen flex items-center justify-center gradient-mesh p-4">
      <div className="w-full max-w-6xl animate-scale-in">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white mb-6 shadow-xl animate-float">
            <svg
              className="w-10 h-10"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gradient mb-4">
            {t.chooseOnboardingMode}
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            {t.chooseOnboardingDesc}
          </p>
        </div>

        {/* Mode Selection Cards */}
        <div className="grid md:grid-cols-2 gap-8 mb-8">
          {/* Scale Mode Card */}
          <div className="glass-card p-8 group hover:shadow-2xl transition-all duration-300 hover:scale-[1.02] relative overflow-hidden">
            {/* Background Gradient Effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

            <div className="relative z-10">
              {/* Icon */}
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white mb-6 shadow-lg group-hover:scale-110 transition-transform duration-300">
                <ClipboardList className="w-8 h-8" />
              </div>

              {/* Title & Description */}
              <h2 className="text-2xl font-bold mb-3 bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-transparent">
                {t.scaleMode}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                {t.scaleModeDesc}
              </p>

              {/* Features List */}
              <ul className="space-y-3 mb-8">
                {t.scaleModeFeatures.map((feature: string, index: number) => (
                  <li
                    key={index}
                    className="flex items-start gap-3 text-gray-700 dark:text-gray-300 animate-fade-in"
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mt-0.5">
                      <Check className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    </div>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {/* Select Button */}
              <button
                onClick={() => onSelectMode('scale')}
                className="w-full px-6 py-4 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center gap-2 group-hover:scale-105"
              >
                <ClipboardList className="w-5 h-5" />
                {t.selectMode}
              </button>
            </div>
          </div>

          {/* AI Mode Card */}
          <div className="glass-card p-8 group hover:shadow-2xl transition-all duration-300 hover:scale-[1.02] relative overflow-hidden">
            {/* Background Gradient Effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

            <div className="relative z-10">
              {/* Icon */}
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 text-white mb-6 shadow-lg group-hover:scale-110 transition-transform duration-300">
                <MessageSquare className="w-8 h-8" />
              </div>

              {/* Title & Description */}
              <h2 className="text-2xl font-bold mb-3 bg-gradient-to-r from-purple-600 to-pink-600 dark:from-purple-400 dark:to-pink-400 bg-clip-text text-transparent">
                {t.aiMode}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                {t.aiModeDesc}
              </p>

              {/* Features List */}
              <ul className="space-y-3 mb-8">
                {t.aiModeFeatures.map((feature: string, index: number) => (
                  <li
                    key={index}
                    className="flex items-start gap-3 text-gray-700 dark:text-gray-300 animate-fade-in"
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mt-0.5">
                      <Check className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                    </div>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {/* Select Button */}
              <button
                onClick={() => onSelectMode('ai')}
                className="w-full px-6 py-4 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center gap-2 group-hover:scale-105"
              >
                <MessageSquare className="w-5 h-5" />
                {t.selectMode}
              </button>
            </div>
          </div>
        </div>

        {/* Back to Login Link */}
        <div className="text-center">
          <button
            onClick={onNavigateToLogin}
            className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 font-medium transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform duration-300" />
            <span>
              {t.hasAccount}{' '}
              <span className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300">
                {t.login}
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

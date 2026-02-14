import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

interface LanguageSwitcherProps {
  compact?: boolean;
}

export const LanguageSwitcher = ({ compact = false }: LanguageSwitcherProps) => {
  const { i18n, t } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(newLang);
    localStorage.setItem('language', newLang);
  };

  return (
    <button
      onClick={toggleLanguage}
      className={`flex items-center ${compact ? 'justify-center' : 'space-x-3'} w-full px-4 py-3 rounded-xl transition-all duration-300 hover:bg-gray-100 dark:hover:bg-gray-700`}
      title={i18n.language === 'zh' ? t('language.english') : t('language.chinese')}
    >
      <Languages size={20} />
      {!compact && (
        <span className="font-medium">
          {i18n.language === 'zh' ? '中文' : 'English'}
        </span>
      )}
    </button>
  );
};

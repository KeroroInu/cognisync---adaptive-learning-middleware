import { useState, useEffect } from 'react';

export type Theme = 'light' | 'dark';
const THEME_VERSION = 'terminal-v2';

export const useTheme = () => {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('cognisync-admin-theme');
    const savedVersion = localStorage.getItem('cognisync-admin-theme-version');
    const savedTheme = saved === 'light' || saved === 'dark' ? saved : null;
    const initialTheme: Theme = savedVersion === THEME_VERSION && savedTheme ? savedTheme : 'light';
    
    if (typeof document !== 'undefined') {
      localStorage.setItem('cognisync-admin-theme', initialTheme);
      localStorage.setItem('cognisync-admin-theme-version', THEME_VERSION);
      document.documentElement.setAttribute('data-theme', initialTheme);
      document.documentElement.classList.toggle('dark', initialTheme === 'dark');
    }
    
    return initialTheme;
  });

  useEffect(() => {
    localStorage.setItem('cognisync-admin-theme', theme);
    localStorage.setItem('cognisync-admin-theme-version', THEME_VERSION);
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = () => {
    setThemeState(prev => prev === 'light' ? 'dark' : 'light');
  };

  return { theme, toggleTheme };
};

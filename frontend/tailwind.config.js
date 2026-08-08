/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './index.html',
    './*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './features/**/*.{js,ts,jsx,tsx}',
    './routes/**/*.{js,ts,jsx,tsx}',
    './services/**/*.{js,ts,jsx,tsx}',
    './utils/**/*.{js,ts,jsx,tsx}',
    './views/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Bricolage Grotesque"', '"Noto Sans SC"', 'ui-sans-serif', 'system-ui'],
        mono: ['"Google Sans Code"', '"SFMono-Regular"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        soft: '0 18px 50px rgba(14, 20, 18, 0.12)',
        panel: '0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 18px 60px rgba(0, 0, 0, 0.28)',
      },
    },
  },
  plugins: [],
};

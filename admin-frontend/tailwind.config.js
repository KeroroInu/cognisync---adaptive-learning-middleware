/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../shared/components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 品牌色（从 frontend 复用）
        'brand-blue': '#3b82f6',
        'brand-indigo': '#6366f1',
        'brand-purple': '#8b5cf6',
        'brand-green': '#10b981',
        'brand-rose': '#f43f5e',
      },
      borderRadius: {
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
        'xl': '20px',
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
        'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
      },
      transitionDuration: {
        'base': '300ms',
        'fast': '150ms',
      },
    },
  },
  plugins: [],
  darkMode: ['selector', '[data-theme="dark"]'],
}

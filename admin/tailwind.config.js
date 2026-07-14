/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#edf6ff',
          100: '#d0e7ff',
          200: '#a8d1ff',
          300: '#74b5ff',
          400: '#5ba0ff',
          500: '#2f80ed',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
      },
      borderRadius: {
        DEFAULT: '0px',
        sm: '0px',
        md: '0px',
        lg: '0px',
        xl: '0px',
        '2xl': '0px',
        '3xl': '0px',
        full: '9999px',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['Geist Mono', 'JetBrains Mono', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.08)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.10)',
        modal: '0 8px 24px rgba(0,0,0,0.12)',
      },
      fontSize: {
        'page': ['1.125rem', { lineHeight: '1.4' }],
        'card-title': ['1rem', { lineHeight: '1.4' }],
        'body': ['0.875rem', { lineHeight: '1.5' }],
        'helper': ['0.75rem', { lineHeight: '1.5' }],
        'micro': ['0.6875rem', { lineHeight: '1.4' }],
      },
    },
  },
  plugins: [],
};

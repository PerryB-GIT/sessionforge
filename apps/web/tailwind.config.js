/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f4ff',
          100: '#e0e9ff',
          500: '#667eea',
          600: '#5a6fd6',
          700: '#4a5bc2',
          900: '#764ba2',
        },
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}

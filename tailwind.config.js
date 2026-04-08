/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          50: '#f8f9fa',
          100: '#1e1e2e',
          200: '#181825',
          300: '#11111b',
          400: '#0a0a14',
        },
        accent: {
          DEFAULT: '#cba6f7',
          hover: '#b48aea',
          dim: '#45364d',
        },
        text: {
          primary: '#cdd6f4',
          secondary: '#a6adc8',
          muted: '#6c7086',
        },
      },
    },
  },
  plugins: [],
}

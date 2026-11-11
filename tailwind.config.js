/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // phones held sideways: wide but very little height
        short: { raw: '(orientation: landscape) and (max-height: 540px)' },
      },
      fontFamily: {
        display: ['"Russo One"', 'system-ui', 'sans-serif'],
        body: ['Nunito', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
        pop: { '0%': { transform: 'scale(0.4)', opacity: '0' }, '60%': { transform: 'scale(1.15)', opacity: '1' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        shine: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        slideUp: { '0%': { transform: 'translateY(24px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
      animation: {
        floaty: 'floaty 3s ease-in-out infinite',
        pop: 'pop 0.45s cubic-bezier(.2,.9,.3,1.3) both',
        shine: 'shine 3s linear infinite',
        slideUp: 'slideUp 0.4s ease-out both',
      },
    },
  },
  plugins: [],
};

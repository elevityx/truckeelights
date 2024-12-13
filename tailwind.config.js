/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        christmasRed: '#c0392b',
        christmasGreen: '#27ae60',
        gold: '#f1c40f',
        silver: '#bdc3c7',
        snowWhite: '#ecf0f1',
      },
      fontFamily: {
        sans: ["'Mountains of Christmas'", "cursive"],
      },
    },
    screens: {
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
    },
  },
  plugins: [],
};


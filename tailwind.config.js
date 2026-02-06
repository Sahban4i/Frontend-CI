/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Poppins", "Inter", "sans-serif"],
        body: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      colors: {
        midnight: {
          950: "#050515",
        },
      },
      boxShadow: {
        glow: "0 20px 45px -12px rgba(168, 85, 247, 0.45)",
      },
    },
  },
  plugins: [],
};
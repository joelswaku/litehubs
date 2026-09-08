/**
 * Tailwind 4 is a PostCSS plugin and needs this file to run at all.
 * `@tailwindcss/postcss` was installed but never wired up, so no utility class
 * in the app was doing anything.
 *
 * Tailwind 4 also replaces tailwind.config.js with CSS-first configuration —
 * the design tokens live in `@theme` inside app/globals.css. That is why there
 * is deliberately no tailwind.config.ts here.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;

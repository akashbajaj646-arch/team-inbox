import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Nunito Sans', 'sans-serif'],
        display: ['Inter', 'Fraunces', 'serif'],
        body: ['Inter', 'Lora', 'serif'],
        ui: ['Inter', 'Nunito Sans', 'sans-serif'],
      },
      colors: {
        // Background colors
        'analog-bg': '#f0f4f7',
        'analog-surface': '#f7f9fb',
        'analog-surface-alt': '#eef2f5',
        'analog-hover': '#e8edf1',

        // Border colors
        'analog-border-strong': 'rgba(169, 180, 185, 0.4)',
        'analog-border': 'rgba(169, 180, 185, 0.25)',
        'analog-border-light': 'rgba(169, 180, 185, 0.15)',

        // Text colors
        'analog-text': '#2a3439',
        'analog-text-secondary': '#3d4f57',
        'analog-text-muted': '#566166',
        'analog-text-faint': '#7a8f96',
        'analog-text-placeholder': '#a9b4b9',

        // Accent colors
        'analog-accent': '#005bc4',
        'analog-accent-hover': '#004eab',
        'analog-accent-light': '#3d7fd4',
        'analog-secondary': '#545f73',
        'analog-secondary-light': '#6b7a91',

        // Status colors
        'analog-success': '#3d7a5c',
        'analog-warning': '#b8860b',
        'analog-error': '#9f403d',
      },
      boxShadow: {
        'analog-sm': '0 1px 3px rgba(42, 52, 57, 0.05)',
        'analog-md': '0 4px 16px rgba(42, 52, 57, 0.06)',
        'analog-lg': '0 12px 40px rgba(42, 52, 57, 0.06)',
        'analog-accent': '0 4px 14px rgba(0, 91, 196, 0.18)',
        'analog-accent-lg': '0 2px 8px rgba(42, 52, 57, 0.08)',
      },
      borderRadius: {
        'analog': '8px',
      },
    },
  },
  plugins: [],
};

export default config;

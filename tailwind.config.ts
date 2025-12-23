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
        display: ['Fraunces', 'serif'],
        body: ['Lora', 'serif'],
        ui: ['Nunito Sans', 'sans-serif'],
      },
      colors: {
        // Background colors
        'analog-bg': '#F5F0E6',
        'analog-surface': '#FFFDF8',
        'analog-surface-alt': '#FAF7F2',
        'analog-hover': '#F5F0E6',
        
        // Border colors
        'analog-border-strong': '#D4C9BA',
        'analog-border': '#E5DDD0',
        'analog-border-light': '#EDE8E0',
        
        // Text colors
        'analog-text': '#3D2C1F',
        'analog-text-secondary': '#5D4E40',
        'analog-text-muted': '#6B5C4D',
        'analog-text-faint': '#8A7B6C',
        'analog-text-placeholder': '#A99C8D',
        
        // Accent colors
        'analog-accent': '#C9594A',
        'analog-accent-hover': '#B8493A',
        'analog-accent-light': '#E07A6C',
        'analog-secondary': '#6B8E9F',
        'analog-secondary-light': '#8AACBB',
        
        // Status colors
        'analog-success': '#7B9F6B',
        'analog-warning': '#D4A84B',
        'analog-error': '#C9594A',
      },
      boxShadow: {
        'analog-sm': '0 1px 3px rgba(61, 44, 31, 0.08)',
        'analog-md': '0 3px 10px rgba(61, 44, 31, 0.1)',
        'analog-lg': '0 5px 20px rgba(61, 44, 31, 0.12)',
        'analog-accent': '0 3px 10px rgba(201, 89, 74, 0.25)',
        'analog-accent-lg': '0 5px 15px rgba(201, 89, 74, 0.35)',
      },
      borderRadius: {
        'analog': '8px',
      },
    },
  },
  plugins: [],
};

export default config;

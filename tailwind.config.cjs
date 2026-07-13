module.exports = {
    content: ['./analyze/index.html'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
            colors: {
                'brand-primary': '#3b82f6',
                'brand-primary-hover': '#60a5fa',
                'brand-secondary': '#facc15',
                'brand-secondary-hover': '#fde047',
                'dark-bg': '#111827',
                'dark-card': '#1F2937',
                'dark-text': '#E5E7EB',
                'dark-text-secondary': '#9CA3AF',
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            },
        },
    },
};

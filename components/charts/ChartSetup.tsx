'use client';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler } from 'chart.js';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Title, Tooltip, Legend, Filler
);

// Плавні анімації графіків за замовчуванням
ChartJS.defaults.animation = {
  duration: 1100,
  easing: 'easeOutQuart',
};

// Колекційні анімації (числа/кольори) успадковують тривалість лише якщо їх не перевизначено
const numbersAnim = ChartJS.defaults.animations?.numbers;
if (numbersAnim) {
  numbersAnim.duration = 1100;
  numbersAnim.easing = 'easeOutQuart';
}

// Плавна поява секторів і масштабу донат-діаграм
const doughnutOverride = ChartJS.overrides.doughnut as unknown as { animation?: Record<string, boolean> } | undefined;
if (doughnutOverride) {
  doughnutOverride.animation = { animateRotate: true, animateScale: true };
}

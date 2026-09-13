'use client';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler } from 'chart.js';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Title, Tooltip, Legend, Filler
);

// Плавніші анімації графіків: мутуємо поля дефолтів, а не замінюємо об'єкти —
// Chart.js тримає в конфігах внутрішні функції, заміна ламає анімації і тултіпи
if (ChartJS.defaults.animation) {
  ChartJS.defaults.animation.duration = 1100;
  ChartJS.defaults.animation.easing = 'easeOutQuart';
}

const numbersAnim = ChartJS.defaults.animations?.numbers;
if (numbersAnim) {
  numbersAnim.duration = 1100;
  numbersAnim.easing = 'easeOutQuart';
}

// Плавна поява секторів і масштабу донат-діаграм
const doughnutAnim = ChartJS.overrides.doughnut?.animation as unknown as Record<string, boolean> | undefined;
if (doughnutAnim) {
  doughnutAnim.animateRotate = true;
  doughnutAnim.animateScale = true;
}

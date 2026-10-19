'use client';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler } from 'chart.js';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Title, Tooltip, Legend, Filler
);

// Плавніші анімації графіків: мутуємо поля дефолтів, а не замінюємо об'єкти —
// Chart.js тримає в конфігах внутрішні функції, заміна ламає анімації і тултіпи
if (ChartJS.defaults.animation) {
  ChartJS.defaults.animation.duration = 400;
  ChartJS.defaults.animation.easing = 'easeOutQuart';
}

const numbersAnim = ChartJS.defaults.animations?.numbers;
if (numbersAnim) {
  numbersAnim.duration = 400;
  numbersAnim.easing = 'easeOutQuart';
}

// Плавна поява секторів і масштабу донат-діаграм
const doughnutAnim = ChartJS.overrides.doughnut?.animation as unknown as Record<string, boolean> | undefined;
if (doughnutAnim) {
  doughnutAnim.animateRotate = true;
  doughnutAnim.animateScale = true;
}

/**
 * Спільна тема графітів для всіх графіків. Значення збігаються з
 * --g-grid / --g-text-muted у globals.css; Chart.js працює поза DOM,
 * тому CSS-змінні тут недоступні — тримаємо їх поруч і в одному місці.
 */
export const CHART = {
  grid: 'rgba(255,255,255,0.06)',
  tick: '#8E92A0',
  legend: '#ACACBB',
  font: { size: 11 } as const,
  income: '#65D6A1',
  incomeFill: 'rgba(101,214,161,0.18)',
  expense: '#F48891',
  expenseFill: 'rgba(244,136,145,0.18)',
  accent: '#FF8156',
  accentFill: 'rgba(255,129,86,0.18)',
  neutral: '#70747C',
  neutralFill: 'rgba(112,116,124,0.35)',
  warning: '#E8BD69',
};

/** X-вісь: без сітки, компактні підписи — 12 місяців на 360 px. */
export const CHART_X = {
  grid: { display: false, drawBorder: false },
  ticks: { color: CHART.tick, font: CHART.font, maxRotation: 0, autoSkipPadding: 8 },
};

/** Y-вісь: легка сітка, без рамки, компактні значення. */
export const CHART_Y = {
  grid: { color: CHART.grid, drawBorder: false },
  ticks: { color: CHART.tick, font: CHART.font, maxTicksLimit: 5, padding: 4 },
};

/** Легенда: праворуч угорі, не перекриває графік. */
export const CHART_LEGEND = {
  display: true,
  position: 'top' as const,
  align: 'end' as const,
  labels: { color: CHART.legend, font: CHART.font, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', padding: 12 },
};

export const CHART_TOOLTIP = {
  backgroundColor: '#24242E',
  titleColor: '#F5F5F7',
  bodyColor: '#ACACBB',
  borderColor: '#70747C',
  borderWidth: 1,
  padding: 10,
  cornerRadius: 10,
  displayColors: true,
  boxWidth: 10,
  boxHeight: 10,
  usePointStyle: true,
};

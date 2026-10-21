'use client';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler } from 'chart.js';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Title, Tooltip, Legend, Filler
);

// Плавніші анімації графіків: мутуємо поля дефолтів, а не замінюємо об'єкти —
// Chart.js тримає в конфігах внутрішні функції, заміна ламає анімації і тултіпи
if (ChartJS.defaults.animation) {
  ChartJS.defaults.animation.duration = 850;
  ChartJS.defaults.animation.easing = 'easeOutQuart';
}

// react-chartjs-2 ставить role="img" на самому <canvas>, але без тексту —
// axe це вважає порушенням (role-img-alt). Роль і підпис уже є на
// батьківському .chart-body, тому сам canvas ховаємо від скрінрідерів.
ChartJS.register({
  id: 'canvas-a11y',
  afterInit(chart) {
    const c = chart.canvas as HTMLCanvasElement | undefined;
    if (c && !c.getAttribute('aria-label')) c.setAttribute('aria-hidden', 'true');
  },
});

const numbersAnim = ChartJS.defaults.animations?.numbers;
if (numbersAnim) {
  numbersAnim.duration = 850;
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
  tick: '#B3BAC9',
  legend: '#CCD1DC',
  font: { size: 11 } as const,
  income: '#65D6A1',
  incomeFill: 'rgba(101,214,161,0.18)',
  expense: '#F48891',
  expenseFill: 'rgba(244,136,145,0.18)',
  accent: '#FF7A42',
  accentFill: 'rgba(255,122,66,0.18)',
  neutral: '#70747C',
  neutralFill: 'rgba(112,116,124,0.35)',
  warning: '#E8BD69',
};

/** Chart.js entrance motion stays smooth while honoring the OS accessibility setting. */
export const chartAnimation = () => ({
  duration: typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 850,
  easing: 'easeOutQuart' as const,
});

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
  backgroundColor: '#303642',
  titleColor: '#F5F5F7',
  bodyColor: '#CCD1DC',
  borderColor: '#828C9C',
  borderWidth: 1,
  padding: 10,
  cornerRadius: 10,
  displayColors: true,
  boxWidth: 10,
  boxHeight: 10,
  usePointStyle: true,
};

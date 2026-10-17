import { redirect } from 'next/navigation';

// Пакет 06: розділ «Завдання» замінено на «Заплановані проєкти».
// Старі задачі (колекція tasks) лишаються в даних як legacy, але
// розділ більше не відображається — пряме посилання перенаправляється.
export default function TasksPage() {
  redirect('/planned-projects');
}

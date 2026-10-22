'use client';
import { AssistantScreen } from '@/components/assistant/AssistantScreen';
import Modal from '@/components/ui/Modal';
import { useApp } from '@/context/AppContext';

export default function AssistantDrawer() {
  const { assistantOpen, setAssistantOpen } = useApp();
  return (
    <Modal isOpen={assistantOpen} onClose={() => setAssistantOpen(false)} title="AI" size="lg">
      <AssistantScreen drawerMode />
    </Modal>
  );
}

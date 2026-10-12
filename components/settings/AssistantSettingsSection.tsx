'use client';
import { useEffect, useState } from 'react';
import ProviderSettingsCard from '@/components/assistant/ProviderSettingsCard';
import {
  DEFAULT_PROVIDER_SETTINGS,
  type ProviderSettings,
} from '@/lib/assistant/contract';
import { loadProviderSettings, saveProviderSettings, assertNoStoredSecrets } from '@/lib/assistant/prefs';
import { emitToast } from '@/lib/toast-bus';

/**
 * Вкладка «AI-помічник»: той самий `ProviderSettingsCard`, що й на
 * сторінці /assistant. Жодних нових сховищ: провайдер/модель/demo
 * живуть у `crm_assistant_provider`, ключі ніде не зберігаються.
 */
export default function AssistantSettingsSection() {
  const [settings, setSettings] = useState<ProviderSettings>({ ...DEFAULT_PROVIDER_SETTINGS });

  useEffect(() => {
    setSettings(loadProviderSettings());
    const leaked = assertNoStoredSecrets();
    if (leaked.length) {
      emitToast(`У локальному сховищі знайдено службові ключі: ${leaked.join(', ')}`, 'error');
    }
  }, []);

  const saveSettings = (next: ProviderSettings) => {
    const safe = saveProviderSettings(next);
    setSettings(safe);
    emitToast(`Провайдер: ${safe.provider} · модель ${safe.model} (ключ не збережено)`, 'success');
  };

  return (
    <div className="settings-grid">
      <ProviderSettingsCard settings={settings} onSave={saveSettings} />
      <div className="settings-card">
        <h3 className="settings-title">Як працює помічник</h3>
        <ul className="ai-capability-list">
          <li>Читання, обчислення й звіти — без підтвердження</li>
          <li>Зміни — лише чернеткою після перегляду й підтвердження</li>
          <li>Ключ не зберігається: ні в localStorage, ні в копіях</li>
          <li>Дати обліку — Europe/Kyiv; суми рахуються CRM, а не моделлю</li>
        </ul>
        <p className="settings-text" style={{ marginTop: 10 }}>
          Ті самі налаштування доступні на сторінці «AI-помічник». Перемикання провайдера
          не чіпає незавершену команду в чаті.
        </p>
      </div>
    </div>
  );
}

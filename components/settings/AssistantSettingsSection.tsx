'use client';
import { useEffect, useState } from 'react';
import ProviderSettingsCard from '@/components/assistant/ProviderSettingsCard';
import type { ProviderSettings } from '@/lib/assistant/contract';
import { loadProviderSettings, saveProviderSettings, assertNoStoredSecrets } from '@/lib/assistant/prefs';
import { emitToast } from '@/lib/toast-bus';

/**
 * Вкладка «AI-помічник»: той самий `ProviderSettingsCard`, що й на
 * сторінці /assistant. Жодних нових сховищ: провайдер/модель/demo
 * живуть у `crm_assistant_provider`.
 *
 * P1: форма НЕ монтується з типовими значеннями. Сховище читається
 * синхронно в lazy-ініціалізаторі useState (той самий прийом, що й на
 * /assistant), тому перший рендер уже показує ЗБЕРЕЖЕНИЙ профіль
 * (opencode/demo/baseUrl), а не openrouter/free. Ефект лише перевіряє
 * витік секретів.
 */
function readStoredSettings(): ProviderSettings {
  try {
    return loadProviderSettings();
  } catch {
    return { provider: 'openrouter', model: 'openrouter/free', demo: false };
  }
}

export default function AssistantSettingsSection() {
  const [settings, setSettings] = useState<ProviderSettings>(readStoredSettings);

  useEffect(() => {
    const leaked = assertNoStoredSecrets();
    if (leaked.length) {
      emitToast(`У локальному сховищі знайдено службові ключі: ${leaked.join(', ')}`, 'error');
    }
  }, []);

  const saveSettings = (next: ProviderSettings) => {
    const safe = saveProviderSettings(next);
    setSettings(safe);
    emitToast(`Провайдер: ${safe.provider} · модель ${safe.model} (ключ у браузері не зберігається)`, 'success');
  };

  return (
    <div className="settings-grid">
      {/* key = збережений профіль: після завантаження/збереження картка
          перемонтовується з коректними початковими полями; ручний
          незбережений ввід картка береже власним dirty-гардом. */}
      <ProviderSettingsCard
        key={`${settings.provider}|${settings.model}|${settings.baseUrl || ''}|${settings.demo ? '1' : '0'}`}
        settings={settings}
        onSave={saveSettings}
      />
      <div className="settings-card">
        <h3 className="settings-title">Як працює помічник</h3>
        <ul className="ai-capability-list">
          <li>Читання, обчислення й звіти — без підтвердження</li>
          <li>Зміни — лише чернеткою після перегляду й підтвердження</li>
          <li>Ключ не зберігається в браузері та не потрапляє в резервні копії; для підтриманих live-провайдерів серверний ключ налаштовується окремо</li>
          <li>Дати обліку — Europe/Kyiv; суми рахуються CRM, а не моделлю</li>
        </ul>
        <p className="settings-text" style={{ marginTop: 10 }}>
          Ті самі налаштування доступні на сторінці «AI-помічник». Перемикання провайдера
          не чіпає незавершену команду в чаті. Сам вибір провайдера в цьому списку ще не
          означає, що live-модель уже відповідає: перевірте чат перед робочими командами.
        </p>
      </div>
    </div>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useErrorText } from '@/components/forms/useErrorText';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { postJson } from '@/lib/client/api';

export function AdminLogin() {
  const t = useTranslations('admin');
  const errorText = useErrorText();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        const res = await postJson('/api/admin/login', { password }, 0);
        setBusy(false);
        if (!res.ok) {
          setError(res.code === 'admin_password_wrong' ? t('wrongPassword') : errorText(res.code));
          return;
        }
        router.replace('/admin');
        router.refresh();
      }}
    >
      <Field label={t('password')}>
        {({ inputId, describedBy }) => (
          <TextInput
            id={inputId}
            aria-describedby={describedBy}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      {error && <Alert tone="error" title={error} live />}
      <Button type="submit" block busy={busy}>
        {t('login')}
      </Button>
    </form>
  );
}

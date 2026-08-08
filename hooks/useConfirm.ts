'use client';
import { useState, useCallback } from 'react';

export function useConfirm() {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [callback, setCallback] = useState<(() => void) | null>(null);

  const confirm = useCallback((title: string, text: string, cb: () => void) => {
    setTitle(title);
    setText(text);
    setCallback(() => cb);
    setIsOpen(true);
  }, []);

  const handleConfirm = useCallback(() => {
    if (callback) callback();
    setIsOpen(false);
    setCallback(null);
  }, [callback]);

  const cancel = useCallback(() => {
    setIsOpen(false);
    setCallback(null);
  }, []);

  return { isOpen, title, text, confirm, handleConfirm, cancel };
}

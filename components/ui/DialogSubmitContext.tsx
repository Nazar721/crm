'use client';
import { createContext } from 'react';

export const DialogSubmitContext = createContext({ nativeSubmit: false, submitting: false });

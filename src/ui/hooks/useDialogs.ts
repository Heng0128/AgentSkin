// SPDX-License-Identifier: MPL-2.0

/** Owns all dialog/prompt state — centralized so any hook can set a prompt. */

import { useState } from 'react';
import type { FileImportConfirmRequest, ThemeCatalogItem } from '@shared/types';
import type { RestartPrompt } from './useThemes';

export function useDialogs() {
  const [restartPrompt, setRestartPrompt] = useState<RestartPrompt | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<ThemeCatalogItem | null>(null);
  const [fileImportPrompt, setFileImportPrompt] = useState<FileImportConfirmRequest | null>(null);

  return {
    restartPrompt,
    setRestartPrompt,
    deletePrompt,
    setDeletePrompt,
    fileImportPrompt,
    setFileImportPrompt,
  };
}

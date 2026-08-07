// SPDX-License-Identifier: MPL-2.0

/**
 * # useCommandPalette
 *
 * Global Cmd+K (macOS) / Ctrl+K (Windows/Linux) shortcut that toggles the
 * command palette. Follows the same pattern as the existing sidebar toggle
 * (Ctrl/Cmd+\\) and inject-dock (Ctrl/Cmd+D) shortcuts in useAppController.
 *
 * Ignores the shortcut while the user is typing in an input/textarea so it
 * never hijacks form-level keybindings.
 */

import { useCallback, useEffect, useState } from 'react';

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k') return;
      if (!(event.ctrlKey || event.metaKey)) return;

      // Don't hijack shortcuts while typing in a field.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      event.preventDefault();
      setOpen((prev) => !prev);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { open, setOpen, toggle };
}

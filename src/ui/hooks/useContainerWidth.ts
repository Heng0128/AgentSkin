// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef, useState } from 'react';

/**
 * 监听容器宽度变化（使用 ResizeObserver）
 * 返回容器的当前像素宽度
 */
export function useContainerWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 初始化宽度
    setWidth(el.clientWidth);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

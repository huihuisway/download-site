import { motion, useInView } from 'framer-motion';
import { useRef, useEffect, useState } from 'react';

export function NumberTicker({ value, direction = 'up', delay = 0, className = '' }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '0px' });
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (!isInView) return;

    const timeout = setTimeout(() => {
      const start = direction === 'up' ? 0 : value;
      const end = direction === 'up' ? value : 0;
      const duration = 1200;
      const startTime = performance.now();

      const animate = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(start + (end - start) * eased);
        setDisplayValue(current);
        if (progress < 1) requestAnimationFrame(animate);
      };

      requestAnimationFrame(animate);
    }, delay * 1000);

    return () => clearTimeout(timeout);
  }, [isInView, value, direction, delay]);

  return (
    <span ref={ref} className={className}>
      {displayValue.toLocaleString()}
    </span>
  );
}

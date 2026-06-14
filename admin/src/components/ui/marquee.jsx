import { cn } from '../../lib/utils';

export function Marquee({ children, className, reverse = false }) {
  return (
    <div className={cn('relative flex overflow-hidden', className)}>
      <div className={cn(
        'flex shrink-0 gap-4',
        reverse ? 'animate-marquee-reverse' : 'animate-marquee',
      )}>
        {children}
        {children}
      </div>
    </div>
  );
}

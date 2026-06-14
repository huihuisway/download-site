import { cn } from '../../lib/utils';

export function GradientText({ children, className }) {
  return (
    <span className={cn(
      'bg-gradient-to-r from-primary-600 via-blue-500 to-primary-600 bg-clip-text text-transparent',
      'animate-gradient bg-[length:200%_auto]',
      className,
    )}>
      {children}
    </span>
  );
}

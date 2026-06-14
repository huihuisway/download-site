import { cn } from '../../lib/utils';

export function DotPattern({ className, gap = 16, size = 1, color = 'rgba(0,0,0,0.1)' }) {
  return (
    <svg className={cn('pointer-events-none absolute inset-0 h-full w-full', className)} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id={`dot-${gap}-${size}`} width={gap} height={gap} patternUnits="userSpaceOnUse">
          <circle cx={size} cy={size} r={size} fill={color} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#dot-${gap}-${size})`} />
    </svg>
  );
}

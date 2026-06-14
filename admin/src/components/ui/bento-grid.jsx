import { cn } from '../../lib/utils';

export function BentoGrid({ children, className }) {
  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4', className)}>
      {children}
    </div>
  );
}

export function BentoCard({ children, className, icon }) {
  return (
    <div className={cn(
      'relative rounded-2xl border border-gray-200/80 bg-white p-5',
      'hover:border-primary-300 transition-all duration-300',
      'group overflow-hidden',
      className,
    )}>
      {/* Hover gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      <div className="relative z-10">
        {icon && (
          <div className="mb-3 text-2xl opacity-60 group-hover:opacity-100 transition-opacity">
            {icon}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

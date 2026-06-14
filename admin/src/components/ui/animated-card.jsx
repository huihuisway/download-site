import { cn } from '../../lib/utils';
import { motion } from 'framer-motion';

export function AnimatedCard({ children, className, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.25, 0.4, 0.25, 1] }}
      className={cn(
        'relative rounded-2xl border border-gray-200 bg-white p-6',
        'shadow-sm hover:shadow-md transition-shadow duration-300',
        'overflow-hidden',
        className,
      )}
    >
      {/* Subtle gradient border glow */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary-500/5 via-transparent to-blue-500/5 pointer-events-none" />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}

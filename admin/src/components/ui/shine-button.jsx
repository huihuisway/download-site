import { cn } from '../../lib/utils';
import { motion } from 'framer-motion';

export function ShineButton({ children, className, ...props }) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'relative inline-flex items-center justify-center rounded-xl px-5 py-2.5 font-medium text-sm',
        'bg-gray-900 text-white overflow-hidden group',
        'shadow-lg shadow-gray-900/20',
        className,
      )}
      {...props}
    >
      <span className="relative z-10">{children}</span>
      <motion.span
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"
      />
    </motion.button>
  );
}

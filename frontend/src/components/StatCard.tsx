import { motion } from 'framer-motion';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: 'default' | 'amber' | 'green' | 'blue';
  loading?: boolean;
}

const colorMap = {
  default: 'text-primary',
  amber: 'text-amber-400',
  green: 'text-emerald-400',
  blue: 'text-sky-400',
};

export function StatCard({ label, value, sub, color = 'default', loading }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5 flex flex-col gap-3"
    >
      <p className="section-label">{label}</p>
      {loading ? (
        <div className="space-y-2">
          <div className="h-8 w-16 bg-surface-raised rounded animate-pulse" />
          <div className="h-3 w-24 bg-surface-raised rounded animate-pulse" />
        </div>
      ) : (
        <>
          <span className={`text-3xl font-bold tracking-tight ${colorMap[color]}`}>
            {value}
          </span>
          {sub && <span className="text-xs text-muted">{sub}</span>}
        </>
      )}
    </motion.div>
  );
}

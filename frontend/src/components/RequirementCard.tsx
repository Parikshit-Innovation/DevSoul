import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, CheckCircle2, Circle } from 'lucide-react';
import type { Requirement } from '../api/pipeline';

const priorityColor = {
  critical: 'text-red-400 border-red-900 bg-red-950',
  high: 'text-amber-400 border-amber-900 bg-amber-950',
  medium: 'text-sky-400 border-sky-900 bg-sky-950',
  low: 'text-stone-400 border-stone-700 bg-stone-800',
};

interface RequirementCardProps {
  req: Requirement;
  index: number;
}

export function RequirementCard({ req, index }: RequirementCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="card overflow-hidden"
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-raised transition-colors text-left"
      >
        <span className={`mono px-2 py-0.5 rounded border text-[10px] font-semibold ${priorityColor[req.priority] ?? priorityColor.medium}`}>
          {req.priority}
        </span>
        <span className="text-xs mono text-muted">{req.id}</span>
        <span className="flex-1 text-sm font-medium text-primary">{req.title}</span>
        <motion.div animate={{ rotate: expanded ? 180 : 0 }}>
          <ChevronDown className="w-4 h-4 text-muted" />
        </motion.div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
              <p className="text-sm text-muted leading-relaxed">{req.description}</p>
              {req.acceptance_criteria?.length > 0 && (
                <div>
                  <p className="section-label mb-2">Acceptance Criteria</p>
                  <ul className="space-y-1.5">
                    {req.acceptance_criteria.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-secondary">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

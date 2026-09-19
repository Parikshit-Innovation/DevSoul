import { motion } from 'framer-motion';
import { Bot, Wrench, Link2, ArrowRight } from 'lucide-react';
import type { Agent } from '../api/pipeline';

const lifecycleStyle = {
  ready: 'badge-success',
  waiting: 'badge-warning',
  blocked: 'badge-error',
  default: 'badge-muted',
};

interface AgentCardProps {
  agent: Agent;
  index: number;
}

export function AgentCard({ agent, index }: AgentCardProps) {
  const ls = agent.lifecycle?.state ?? 'default';
  const badgeClass = lifecycleStyle[ls as keyof typeof lifecycleStyle] ?? lifecycleStyle.default;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.07 }}
      className="card p-5 flex flex-col gap-4 hover:border-stone-700 transition-colors"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-950/60 border border-amber-900/50 flex items-center justify-center">
            <Bot className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-primary">{agent.role}</p>
            <p className="mono text-muted mt-0.5">{agent.id}</p>
          </div>
        </div>
        <span className={badgeClass}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {ls}
        </span>
      </div>

      {/* Task */}
      <p className="text-sm text-muted leading-relaxed line-clamp-3">{agent.task}</p>

      {/* Tools */}
      {agent.tools?.length > 0 && (
        <div>
          <p className="section-label mb-2">Tools</p>
          <div className="flex flex-wrap gap-1.5">
            {agent.tools.map((t) => (
              <span key={t} className="mono badge badge-muted">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Dependencies */}
      {agent.depends_on?.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <ArrowRight className="w-3 h-3" />
          Depends on: {agent.depends_on.join(', ')}
        </div>
      )}

      {/* Requirements */}
      {agent.requirement_ids?.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <Link2 className="w-3 h-3" />
          {agent.requirement_ids.join(', ')}
        </div>
      )}
    </motion.div>
  );
}

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Activity, GitBranch, Cpu, FileText, Bot } from 'lucide-react';
import { usePipelineStore } from '../store/pipelineStore';
import { StatCard } from '../components/StatCard';

const stageSteps = [
  { key: 'ri', label: 'Requirement Intelligence', icon: FileText, route: '/requirements' },
  { key: 'ai', label: 'Architecture Intelligence', icon: Cpu, route: '/architecture' },
  { key: 'factory', label: 'Agent Factory', icon: Bot, route: '/agents' },
];

const stageProgress: Record<string, number> = {
  idle: 0, ri: 15, ri_interview: 30, ri_done: 33,
  ai: 50, ai_done: 66, factory: 80, done: 100, failed: 0,
};

function PipelineProgressBar() {
  const { stage } = usePipelineStore();
  const pct = stageProgress[stage] ?? 0;
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <p className="section-label">Pipeline Progress</p>
        <span className="text-xs text-muted">{pct}%</span>
      </div>
      <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-amber-500 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

function ActivityFeed() {
  const { activityFeed } = usePipelineStore();

  if (activityFeed.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-muted text-sm">
        No activity yet — pipeline events will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-72 overflow-y-auto">
      {activityFeed.slice(0, 20).map((ev) => (
        <div key={ev.id} className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
          <Activity className="w-3.5 h-3.5 text-muted flex-shrink-0 mt-0.5" />
          <p className="text-sm text-secondary flex-1">{ev.message}</p>
          <span className="text-xs text-stone-600 flex-shrink-0 font-mono">
            {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    pipelineId, projectName, summary, stage,
    requirements, agents, architecture,
    activityFeed,
  } = usePipelineStore();

  // Redirect if no pipeline started
  useEffect(() => {
    if (!pipelineId) navigate('/');
  }, [pipelineId]);

  if (!pipelineId) return null;

  const currentStageIndex = stageSteps.findIndex(
    (s) => stage.startsWith(s.key)
  );

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="border-b border-border px-8 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary tracking-tight">{projectName || 'New Project'}</h1>
            <p className="text-muted text-sm mt-1 max-w-xl">{summary || 'Pipeline starting…'}</p>
          </div>
          <motion.button
            onClick={() => navigate('/requirements')}
            whileHover={{ scale: 1.02 }}
            className="btn-primary flex items-center gap-2 mt-1"
          >
            {stage === 'done' ? 'View Agents' : 'Continue Pipeline'}
            <ArrowRight className="w-4 h-4" />
          </motion.button>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label="Requirements"
            value={requirements.length || '—'}
            sub={requirements.length > 0 ? `${requirements.filter(r => r.priority === 'critical' || r.priority === 'high').length} high priority` : 'Gathering…'}
            color={requirements.length > 0 ? 'amber' : 'default'}
          />
          <StatCard
            label="Architecture"
            value={architecture ? Object.keys(architecture.technology_stack ?? {}).length : '—'}
            sub={architecture ? architecture.technology_stack?.frontend || 'Designed' : 'Not yet started'}
            color={architecture ? 'green' : 'default'}
          />
          <StatCard
            label="Agents Planned"
            value={agents.length || '—'}
            sub={agents.length > 0 ? `${agents.filter(a => a.lifecycle?.state === 'ready').length} ready` : 'Pending factory'}
            color={agents.length > 0 ? 'amber' : 'default'}
          />
        </div>

        {/* Progress */}
        <div className="card p-5">
          <PipelineProgressBar />

          {/* Stage steps */}
          <div className="mt-6 flex items-center gap-0">
            {stageSteps.map((step, i) => {
              const isActive = i === currentStageIndex;
              const isDone = i < currentStageIndex || stage === 'done';
              const Icon = step.icon;
              return (
                <div key={step.key} className="flex items-center flex-1">
                  <div
                    className={`flex items-center gap-2.5 flex-1 p-3 rounded-lg transition-all ${
                      isActive ? 'bg-amber-950/40 border border-amber-900/50' :
                      isDone ? 'opacity-60' : 'opacity-30'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isDone ? 'text-emerald-400' : isActive ? 'text-amber-400' : 'text-muted'}`} />
                    <div>
                      <p className="text-xs font-medium text-primary">{step.label}</p>
                      <p className="text-xs text-muted mt-0.5">
                        {isDone ? 'Completed' : isActive ? 'In progress…' : 'Pending'}
                      </p>
                    </div>
                  </div>
                  {i < stageSteps.length - 1 && (
                    <div className={`h-px w-4 ${isDone ? 'bg-emerald-800' : 'bg-border'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Activity feed */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-muted" />
            <h3 className="text-sm font-semibold text-primary">Activity Feed</h3>
          </div>
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}

import { NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  ListChecks,
  Layers,
  Bot,
  Zap,
  ChevronRight,
} from 'lucide-react';
import { usePipelineStore } from '../store/pipelineStore';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/requirements', icon: ListChecks, label: 'Requirements' },
  { to: '/architecture', icon: Layers, label: 'Architecture' },
  { to: '/agents', icon: Bot, label: 'Agents' },
];

const stageOrder = ['ri', 'ri_interview', 'ri_done', 'ai', 'ai_done', 'factory', 'done'];
const stageRoutes: Record<string, string> = {
  ri: '/requirements',
  ri_interview: '/requirements',
  ri_done: '/requirements',
  ai: '/architecture',
  ai_done: '/architecture',
  factory: '/agents',
  done: '/agents',
};

export function Sidebar() {
  const { projectName, stage, pipelineId } = usePipelineStore();
  const navigate = useNavigate();

  const isAccessible = (to: string) => {
    if (!pipelineId) return to === '/dashboard';
    if (to === '/dashboard') return true;
    if (to === '/requirements') return true;
    if (to === '/architecture') return ['ri_done', 'ai', 'ai_done', 'factory', 'done'].includes(stage);
    if (to === '/agents') return ['ai_done', 'factory', 'done'].includes(stage);
    return false;
  };

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="w-56 flex-shrink-0 flex flex-col bg-surface border-r border-border h-screen sticky top-0"
    >
      {/* Logo */}
      <div className="p-5 border-b border-border">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2.5 group"
        >
          <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center">
            <Zap className="w-4 h-4 text-stone-950" />
          </div>
          <span className="font-bold text-primary text-sm tracking-tight">DevSoul</span>
        </button>
      </div>

      {/* Project context */}
      {projectName && (
        <div className="px-4 py-3 border-b border-border">
          <p className="section-label mb-1">Project</p>
          <p className="text-sm font-medium text-primary truncate">{projectName}</p>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => {
          const accessible = isAccessible(to);
          return (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150',
                  !accessible
                    ? 'text-stone-600 cursor-not-allowed pointer-events-none'
                    : isActive
                    ? 'bg-amber-950/60 text-amber-400 font-medium'
                    : 'text-muted hover:text-primary hover:bg-surface-raised',
                ].join(' ')
              }
              onClick={(e) => { if (!accessible) e.preventDefault(); }}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span>{label}</span>
              {accessible && (
                <ChevronRight className="w-3 h-3 ml-auto opacity-30" />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Stage pill at bottom */}
      {stage !== 'idle' && (
        <div className="p-4 border-t border-border">
          <p className="section-label mb-2">Pipeline</p>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              stage === 'done' ? 'bg-emerald-400' :
              stage === 'failed' ? 'bg-red-400' :
              'bg-amber-400 animate-pulse'
            }`} />
            <span className="text-xs text-muted capitalize">{
              stage === 'done' ? 'Complete' :
              stage === 'failed' ? 'Failed' :
              stage === 'ri' || stage === 'ri_interview' ? 'Gathering requirements…' :
              stage === 'ri_done' ? 'Requirements done' :
              stage === 'ai' ? 'Designing architecture…' :
              stage === 'ai_done' ? 'Architecture done' :
              stage === 'factory' ? 'Planning agents…' : ''
            }</span>
          </div>
        </div>
      )}
    </motion.aside>
  );
}

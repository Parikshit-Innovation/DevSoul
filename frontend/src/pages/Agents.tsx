import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Bot, CheckCircle2, Download, Loader2 } from 'lucide-react';
import { usePipelineStore } from '../store/pipelineStore';
import { AgentCard } from '../components/AgentCard';
import { getAgents, subscribeToEvents } from '../api/pipeline';
import yaml from 'js-yaml';

function RunningAnimation() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6">
      <div className="relative w-20 h-20">
        <div className="absolute inset-0 rounded-full border-2 border-amber-500/20 animate-ping" />
        <div className="absolute inset-2 rounded-full border-2 border-amber-500/40 animate-ping" style={{ animationDelay: '0.4s' }} />
        <div className="absolute inset-4 rounded-full bg-amber-950 border border-amber-900 flex items-center justify-center">
          <Bot className="w-6 h-6 text-amber-400" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-primary font-semibold">Agent Factory Running</p>
        <p className="text-muted text-sm mt-1">Planning agents based on requirements and architecture…</p>
      </div>
    </div>
  );
}

export default function Agents() {
  const navigate = useNavigate();
  const {
    pipelineId, agents, setAgents, factoryRunning, setFactoryRunning,
    factoryLog, appendFactoryLog, stage, setStage, pushActivity,
  } = usePipelineStore();
  const [error, setError] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pipelineId) { navigate('/'); return; }
    if (stage === 'factory' && agents.length === 0) {
      setFactoryRunning(true);
      pollAgents();
    }
    const unsub = subscribeToEvents(pipelineId, (ev) => {
      if (ev.message) appendFactoryLog(`[${ev.type}] ${ev.message}`);
      if (ev.type?.includes('AGENT') || ev.type?.includes('FACTORY')) {
        fetchAgents();
      }
    });
    return unsub;
  }, [pipelineId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [factoryLog]);

  const pollAgents = async () => {
    let attempts = 0;
    while (attempts < 60) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const res = await getAgents(pipelineId!);
        if (res.length > 0) {
          setAgents(res);
          setFactoryRunning(false);
          setStage('done');
          pushActivity({ type: 'FACTORY_COMPLETED', message: `${res.length} agents planned successfully.`, timestamp: new Date().toISOString() });
          return;
        }
      } catch {
        appendFactoryLog(`[${new Date().toLocaleTimeString()}] Factory still processing…`);
      }
      attempts++;
    }
    setFactoryRunning(false);
    setError('Agent factory timed out.');
  };

  const fetchAgents = async () => {
    try {
      const res = await getAgents(pipelineId!);
      if (res.length > 0) {
        setAgents(res);
        setFactoryRunning(false);
        setStage('done');
      }
    } catch {}
  };

  const downloadYaml = () => {
    const content = `# DevSoul — agents.yaml\n# Generated: ${new Date().toISOString()}\nagents:\n` +
      agents.map(a =>
        `  - id: ${a.id}\n    role: ${a.role}\n    task: ${JSON.stringify(a.task)}\n    tools: [${a.tools.join(', ')}]\n    depends_on: [${a.depends_on.join(', ')}]`
      ).join('\n');
    const blob = new Blob([content], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'agents.yaml'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="border-b border-border px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary">Agents</h1>
          <p className="text-muted text-sm mt-0.5">Planned agents for this project</p>
        </div>
        {agents.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="badge-success">
              <CheckCircle2 className="w-3 h-3" />
              {agents.length} agents planned
            </span>
            <button onClick={downloadYaml} className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export YAML
            </button>
          </div>
        )}
      </div>

      <div className="p-8 space-y-6">
        {/* Running */}
        {factoryRunning && agents.length === 0 && (
          <div className="card">
            <RunningAnimation />
            {factoryLog.length > 0 && (
              <div className="border-t border-border p-5 font-mono text-xs text-stone-500 space-y-1 max-h-40 overflow-y-auto">
                {factoryLog.map((l, i) => <p key={i}>{l}</p>)}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 rounded-xl bg-red-950/60 border border-red-900 text-red-400 text-sm">{error}</div>
        )}

        {/* Success */}
        {agents.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="card p-5">
                <p className="section-label mb-2">Total Agents</p>
                <p className="text-3xl font-bold text-amber-400">{agents.length}</p>
              </div>
              <div className="card p-5">
                <p className="section-label mb-2">Ready</p>
                <p className="text-3xl font-bold text-emerald-400">
                  {agents.filter(a => a.lifecycle?.state === 'ready').length}
                </p>
              </div>
              <div className="card p-5">
                <p className="section-label mb-2">Total Tools</p>
                <p className="text-3xl font-bold text-sky-400">
                  {[...new Set(agents.flatMap(a => a.tools))].length}
                </p>
              </div>
            </div>

            {/* Agent grid */}
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
              {agents.map((agent, i) => (
                <AgentCard key={agent.id} agent={agent} index={i} />
              ))}
            </div>
          </motion.div>
        )}

        {/* Waiting to start */}
        {!factoryRunning && agents.length === 0 && stage !== 'factory' && (
          <div className="card p-10 flex flex-col items-center gap-4 text-center">
            <Bot className="w-8 h-8 text-stone-600" />
            <div>
              <p className="text-primary font-medium">Agent Factory</p>
              <p className="text-muted text-sm mt-1">Complete the architecture stage first to plan agents.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Loader2, CheckCircle2, ArrowRight, Server, Globe, Database, Box, Send, Wand2 } from 'lucide-react';
import { usePipelineStore } from '../store/pipelineStore';
import { getArchitecture, startAgentFactory, subscribeToEvents, getAiInterviewRound, submitAiAnswer, startArchitecture } from '../api/pipeline';

const techIcons: Record<string, typeof Globe> = {
  frontend: Globe,
  backend: Server,
  database: Database,
};

function RunningAnimation() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6">
      <div className="relative w-20 h-20">
        <div className="absolute inset-0 rounded-full border-2 border-amber-500/20 animate-ping" />
        <div className="absolute inset-2 rounded-full border-2 border-amber-500/40 animate-ping" style={{ animationDelay: '0.3s' }} />
        <div className="absolute inset-4 rounded-full bg-amber-950 border border-amber-900 flex items-center justify-center">
          <Cpu className="w-6 h-6 text-amber-400" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-primary font-semibold">Architecture Intelligence Running</p>
        <p className="text-muted text-sm mt-1">Analyzing requirements and designing system…</p>
      </div>
    </div>
  );
}

function AiQuestionPanel() {
  const { pipelineId, aiCurrentRound, setAiCurrentRound, aiInterviewCompleted, setAiInterviewCompleted, setAiRunning, pushActivity } = usePipelineStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const currentQ = aiCurrentRound?.questions?.[0] ?? null;

  const handleSubmitAnswer = async (value?: string) => {
    if (!pipelineId || !currentQ || submitting) return;
    setSubmitting(true);
    try {
      const answer = value ?? (currentQ.allow_free_text ? freeText : selected) ?? '';
      const res = await submitAiAnswer(pipelineId, currentQ.node_id, answer);
      setSelected(null);
      setFreeText('');
      
      if (res.completed) {
        setAiInterviewCompleted(true);
        setAiCurrentRound(null);
        await startArchitecture(pipelineId);
        setAiRunning(true);
        pushActivity({ type: 'AI_STARTED', message: 'Architecture generation started after interview.', timestamp: new Date().toISOString() });
      } else if (res.next_round) {
        setAiCurrentRound(res.next_round);
      }
    } catch (e: any) {
      alert('Failed to submit answer: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAutoDecide = async () => {
    if (!pipelineId || submitting) return;
    setSubmitting(true);
    try {
      setAiInterviewCompleted(true);
      setAiCurrentRound(null);
      await startArchitecture(pipelineId);
      setAiRunning(true);
      pushActivity({ type: 'AI_AUTO_DECIDED', message: 'Architecture AI auto-deciding remaining questions.', timestamp: new Date().toISOString() });
    } catch (e: any) {
      alert('Failed to start architecture: ' + e.message);
      setAiInterviewCompleted(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (aiInterviewCompleted || !currentQ) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card p-8 flex flex-col items-center justify-center text-center gap-4 h-full"
      >
        <div className="w-12 h-12 rounded-xl bg-emerald-950 border border-emerald-900 flex items-center justify-center">
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-primary">Interview Complete</h3>
          <p className="text-muted text-sm mt-1">Generating architecture decisions…</p>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="card p-5 flex flex-col gap-4">
      {/* Progress */}
      {aiCurrentRound && (
        <div>
          <div className="flex justify-between text-xs text-muted mb-1.5">
            <span>Decisions made</span>
            <span>{aiCurrentRound.topics_covered} / {aiCurrentRound.total_topics}</span>
          </div>
          <div className="h-1 bg-surface-raised rounded-full">
            <motion.div
              className="h-full bg-amber-500 rounded-full"
              animate={{ width: `${(aiCurrentRound.topics_covered / aiCurrentRound.total_topics) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Question */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentQ.node_id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="space-y-4"
        >
          <p className="text-sm font-medium text-primary leading-relaxed">{currentQ.question}</p>

          {/* Options */}
          <div className="space-y-2">
            {currentQ.options.map((opt) => (
              <button
                key={opt}
                onClick={() => { setSelected(opt); if (!currentQ.allow_free_text) handleSubmitAnswer(opt); }}
                className={`w-full text-left text-sm px-4 py-3 rounded-lg border transition-all ${
                  selected === opt
                    ? 'border-amber-500 bg-amber-950/40 text-amber-400'
                    : 'border-border bg-surface-raised hover:border-stone-600 text-secondary'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>

          {/* Free text */}
          {currentQ.allow_free_text && (
            <div className="flex gap-2">
              <input
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitAnswer()}
                placeholder="Or type a custom answer…"
                className="input flex-1 text-sm"
              />
              <button
                onClick={() => handleSubmitAnswer()}
                disabled={!freeText.trim() && !selected}
                className="btn-primary px-3 disabled:opacity-40"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          )}

          {/* Auto decide */}
          <button
            onClick={handleAutoDecide}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-amber-900/60 text-amber-400 hover:bg-amber-950/40 text-sm transition-all"
          >
            <Wand2 className="w-4 h-4" />
            Decide Everything
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default function Architecture() {
  const navigate = useNavigate();
  const {
    pipelineId, architecture, setArchitecture, aiRunning, setAiRunning,
    aiLog, appendAiLog, stage, setStage, pushActivity, aiInterviewCompleted, setAiInterviewCompleted, setAiCurrentRound
  } = usePipelineStore();
  const [error, setError] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);
  
  // Track polling
  const isPolling = useRef(false);

  useEffect(() => {
    if (!pipelineId) { navigate('/'); return; }
    
    const initInterview = async () => {
      try {
        const round = await getAiInterviewRound(pipelineId);
        if (round.completed) {
          setAiInterviewCompleted(true);
          if (!architecture && !aiRunning) {
             // Only auto-start architecture if we aren't already running or completed
             await startArchitecture(pipelineId);
             setAiRunning(true);
          }
        } else {
          setAiCurrentRound(round);
        }
      } catch (err) {
        console.error("Failed to fetch ai interview round", err);
      }
    };

    if (!architecture && stage === 'ai' && !aiInterviewCompleted) {
      initInterview();
    } else if (!architecture && stage === 'ai' && aiInterviewCompleted && !aiRunning) {
      setAiRunning(true);
    }
    
    // Subscribe to SSE events
    const unsub = subscribeToEvents(pipelineId, (ev) => {
      if (ev.message) appendAiLog(`[${ev.type}] ${ev.message}`);
      if (ev.type === 'ARCHITECTURE_COMPLETED' || ev.type === 'AI_COMPLETED') {
        fetchArchResult();
      }
    });
    return unsub;
  }, [pipelineId, architecture, stage, aiInterviewCompleted]);

  useEffect(() => {
    if (aiRunning && !architecture && !isPolling.current) {
      pollArchitecture();
    }
  }, [aiRunning, architecture]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiLog]);

  const pollArchitecture = async () => {
    isPolling.current = true;
    let attempts = 0;
    while (attempts < 60 && !usePipelineStore.getState().architecture) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const arch = await getArchitecture(pipelineId!);
        if (arch) {
           setArchitecture(arch);
           setAiRunning(false);
           setStage('ai_done');
           pushActivity({ type: 'AI_COMPLETED', message: 'Architecture design complete.', timestamp: new Date().toISOString() });
           isPolling.current = false;
           return;
        }
      } catch {
        appendAiLog(`[${new Date().toLocaleTimeString()}] Designing architecture…`);
      }
      attempts++;
    }
    isPolling.current = false;
    if (!usePipelineStore.getState().architecture) {
       setAiRunning(false);
       setError('Architecture timed out. The backend may still be processing.');
    }
  };

  const fetchArchResult = async () => {
    try {
      const arch = await getArchitecture(pipelineId!);
      setArchitecture(arch);
      setAiRunning(false);
      setStage('ai_done');
    } catch {}
  };

  const handleContinue = async () => {
    if (!pipelineId) return;
    try {
      await startAgentFactory(pipelineId);
      setStage('factory');
      pushActivity({ type: 'FACTORY_STARTED', message: 'Agent Factory started planning agents.', timestamp: new Date().toISOString() });
      navigate('/agents');
    } catch (e: any) {
      setError('Failed to start agent factory: ' + e.message);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-8 py-5 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-primary">Architecture</h1>
          <p className="text-muted text-sm mt-0.5">System design and technology decisions</p>
        </div>
        {architecture && (
          <motion.button
            onClick={handleContinue}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="btn-primary flex items-center gap-2"
          >
            Plan Agents <ArrowRight className="w-4 h-4" />
          </motion.button>
        )}
      </div>

      {stage === 'ai' && !aiInterviewCompleted ? (
        <div className="p-8 flex-1 overflow-y-auto">
           <div className="max-w-md mx-auto mt-10">
             <AiQuestionPanel />
           </div>
        </div>
      ) : (
        <div className="p-8 space-y-6 flex-1 overflow-y-auto">
          {/* Running state */}
          {aiRunning && !architecture && (
            <div className="card">
              <RunningAnimation />
              {/* Live log */}
              {aiLog.length > 0 && (
                <div className="border-t border-border p-5 font-mono text-xs text-stone-500 space-y-1 max-h-40 overflow-y-auto">
                  {aiLog.map((l, i) => <p key={i}>{l}</p>)}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 rounded-xl bg-red-950/60 border border-red-900 text-red-400 text-sm">{error}</div>
          )}

          {/* Architecture Result */}
          {architecture && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              {/* Summary */}
              <div className="card p-6">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-primary">Architecture Summary</h3>
                </div>
                <p className="text-secondary text-sm leading-relaxed">{architecture.architecture_summary}</p>
              </div>

              {/* Tech Stack */}
              <div>
                <p className="section-label mb-3">Technology Stack</p>
                <div className="grid grid-cols-3 gap-4">
                  {Object.entries(architecture.technology_stack ?? {}).map(([layer, tech]) => {
                    const Icon = techIcons[layer] ?? Box;
                    return (
                      <motion.div
                        key={layer}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="card p-5"
                      >
                        <div className="flex items-center gap-2.5 mb-3">
                          <div className="w-8 h-8 rounded-lg bg-surface-overlay flex items-center justify-center">
                            <Icon className="w-4 h-4 text-muted" />
                          </div>
                          <span className="section-label">{layer}</span>
                        </div>
                        <p className="text-lg font-semibold text-primary">{tech}</p>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Components */}
              {architecture.components?.length > 0 && (
                <div>
                  <p className="section-label mb-3">Components</p>
                  <div className="grid grid-cols-2 gap-3">
                    {architecture.components.map((c, i) => (
                      <motion.div
                        key={c.name}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="card-raised p-4"
                      >
                        <p className="text-sm font-medium text-primary">{c.name}</p>
                        <p className="text-xs text-muted mt-1">{c.description}</p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Constraints */}
              {architecture.design_constraints?.length > 0 && (
                <div>
                  <p className="section-label mb-3">Design Constraints</p>
                  <ul className="space-y-2">
                    {architecture.design_constraints.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-secondary">
                        <span className="text-amber-500 mt-0.5">—</span>
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>
          )}

          {/* Waiting for AI to start */}
          {!aiRunning && !architecture && stage !== 'ai' && (
            <div className="card p-10 flex flex-col items-center gap-4 text-center">
              <Cpu className="w-8 h-8 text-stone-600" />
              <div>
                <p className="text-primary font-medium">Architecture Intelligence</p>
                <p className="text-muted text-sm mt-1">Complete the requirements interview first, then proceed here.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wand2, CheckCircle2, Circle, Send, Loader2, ArrowRight, ChevronRight
} from 'lucide-react';
import { usePipelineStore } from '../store/pipelineStore';
import { RequirementCard } from '../components/RequirementCard';
import {
  getRequirements, getInterviewRound, submitAnswer, autoDecide,
  initArchitecture,
} from '../api/pipeline';

function QuestionPanel() {
  const { pipelineId, currentRound, setCurrentRound, setRiProgress, setRiCompleted, setStage, pushActivity } =
    usePipelineStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoLog, setAutoLog] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  const currentQ = currentRound?.questions?.[0] ?? null;

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [autoLog]);

  const handleSubmitAnswer = async (value?: string) => {
    if (!pipelineId || !currentQ || submitting) return;
    setSubmitting(true);
    try {
      const answer = value ?? (currentQ.allow_free_text ? freeText : selected) ?? '';
      const res = await submitAnswer(pipelineId, currentQ.node_id, answer);
      setSelected(null);
      setFreeText('');
      if (res.completed) {
        setRiCompleted(true);
        setStage('ri_done');
        pushActivity({ type: 'RI_COMPLETED', message: 'All requirements gathered successfully.', timestamp: new Date().toISOString() });
        setCurrentRound(null);
      } else if (res.next_round) {
        setCurrentRound(res.next_round);
        setRiProgress(res.next_round.topics_covered, res.next_round.total_topics);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAutoDecide = async () => {
    if (!pipelineId || autoRunning) return;
    setAutoRunning(true);
    setAutoLog([]);
    try {
      setAutoLog((l) => [...l, '🤖 Auto-deciding all remaining questions…']);
      const res = await autoDecide(pipelineId);
      setAutoLog((l) => [...l, '✓ All decisions made by AI.']);
      setRiCompleted(true);
      setStage('ri_done');
      pushActivity({ type: 'RI_AUTO_DECIDED', message: 'AI auto-decided all remaining questions.', timestamp: new Date().toISOString() });
      setCurrentRound(null);

      // Refresh requirements
      const reqs = await getRequirements(pipelineId);
      usePipelineStore.getState().setRequirements(reqs);
    } catch (e: any) {
      setAutoLog((l) => [...l, `✗ Error: ${e.message}`]);
    } finally {
      setAutoRunning(false);
    }
  };

  // Auto-running log view
  if (autoRunning || (autoLog.length > 0 && !currentQ)) {
    return (
      <div className="card p-5 h-full flex flex-col">
        <div className="flex items-center gap-2 mb-4">
          <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
          <h3 className="text-sm font-semibold text-primary">Auto-deciding…</h3>
        </div>
        <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1.5 text-stone-400">
          <AnimatePresence>
            {autoLog.map((line, i) => (
              <motion.p
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
              >
                {line}
              </motion.p>
            ))}
          </AnimatePresence>
          <div ref={logEndRef} />
        </div>
      </div>
    );
  }

  const { riCompleted } = usePipelineStore.getState();
  if (riCompleted || !currentQ) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card p-8 flex flex-col items-center justify-center text-center gap-4"
      >
        <div className="w-12 h-12 rounded-xl bg-emerald-950 border border-emerald-900 flex items-center justify-center">
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-primary">Requirements Complete</h3>
          <p className="text-muted text-sm mt-1">All topics have been covered. Ready to design architecture.</p>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="card p-5 flex flex-col gap-4">
      {/* Progress */}
      {currentRound && (
        <div>
          <div className="flex justify-between text-xs text-muted mb-1.5">
            <span>Topics covered</span>
            <span>{currentRound.topics_covered} / {currentRound.total_topics}</span>
          </div>
          <div className="h-1 bg-surface-raised rounded-full">
            <motion.div
              className="h-full bg-amber-500 rounded-full"
              animate={{ width: `${(currentRound.topics_covered / currentRound.total_topics) * 100}%` }}
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

export default function Requirements() {
  const navigate = useNavigate();
  const {
    pipelineId, requirements, setRequirements, currentRound, setCurrentRound,
    setRiProgress, stage, riCompleted,
  } = usePipelineStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pipelineId) { navigate('/'); return; }
    loadData();
  }, [pipelineId]);

  const loadData = async () => {
    if (!pipelineId) return;
    setLoading(true);
    try {
      const [reqs, round] = await Promise.all([
        getRequirements(pipelineId),
        getInterviewRound(pipelineId).catch(() => null),
      ]);
      setRequirements(reqs);
      if (round) {
        setCurrentRound(round);
        setRiProgress(round.topics_covered, round.total_topics);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!pipelineId) return;
    try {
      await initArchitecture(pipelineId);
      usePipelineStore.getState().setStage('ai');
      usePipelineStore.getState().pushActivity({
        type: 'AI_STARTED',
        message: 'Architecture Intelligence started.',
        timestamp: new Date().toISOString(),
      });
      navigate('/architecture');
    } catch (e: any) {
      alert('Failed to start architecture: ' + e.message);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="border-b border-border px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary">Requirements</h1>
          <p className="text-muted text-sm mt-0.5">Discover and refine what the system needs to do</p>
        </div>
        {riCompleted && (
          <motion.button
            onClick={handleContinue}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            className="btn-primary flex items-center gap-2"
          >
            Design Architecture <ArrowRight className="w-4 h-4" />
          </motion.button>
        )}
      </div>

      <div className="p-8 grid grid-cols-[1fr_360px] gap-6 items-start">
        {/* Requirements list */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="section-label">{requirements.length} Requirements</p>
            <button onClick={loadData} className="text-xs text-muted hover:text-primary transition-colors">Refresh</button>
          </div>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-14 bg-surface rounded-xl animate-pulse" />
              ))}
            </div>
          ) : requirements.length === 0 ? (
            <div className="card p-8 text-center text-muted text-sm">
              Requirements are being gathered…
            </div>
          ) : (
            <div className="space-y-2">
              {requirements.map((req, i) => (
                <RequirementCard key={req.id} req={req} index={i} />
              ))}
            </div>
          )}
        </div>

        {/* Interview panel (sticky) */}
        <div className="sticky top-4">
          <p className="section-label mb-3">Interview</p>
          <QuestionPanel />
        </div>
      </div>
    </div>
  );
}

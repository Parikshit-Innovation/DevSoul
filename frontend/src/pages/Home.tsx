import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Zap, Lightbulb } from 'lucide-react';
import { startPipeline } from '../api/pipeline';
import { usePipelineStore } from '../store/pipelineStore';

const examples = [
  'A task management app for remote teams',
  'An e-commerce store for a jewelry shop',
  'A blog platform with markdown support',
  'A real-time chat application',
  'A SaaS dashboard for analytics',
];

export default function Home() {
  const [idea, setIdea] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exampleIndex, setExampleIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const store = usePipelineStore();

  // Rotate placeholder example
  useEffect(() => {
    const interval = setInterval(() => {
      setExampleIndex((i) => (i + 1) % examples.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async () => {
    if (!idea.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      store.reset();
      const res = await startPipeline(idea.trim());
      store.setIdea(idea.trim());
      store.setPipelineId(res.pipeline_id);
      store.setProjectName(res.project_name);
      store.setSummary(res.summary);
      store.setStage('ri');
      store.pushActivity({
        type: 'PIPELINE_STARTED',
        message: `Started pipeline for: ${idea.trim().slice(0, 60)}`,
        timestamp: new Date().toISOString(),
      });
      navigate('/dashboard');
    } catch (e: any) {
      setError(e.message || 'Failed to start pipeline. Is the API server running?');
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  };

  return (
    <div className="min-h-screen bg-stone-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background subtle gradient */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-amber-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-amber-500/3 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-2xl relative z-10"
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-12">
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
            <Zap className="w-4.5 h-4.5 text-stone-950" />
          </div>
          <span className="font-bold text-primary text-base tracking-tight">DevSoul</span>
        </div>

        {/* Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="text-5xl font-bold text-primary mb-3 leading-tight tracking-tight"
        >
          What do you want
          <br />
          <span className="text-gradient-amber">to build?</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="text-muted text-base mb-10 leading-relaxed"
        >
          Describe your idea. DevSoul will gather requirements, design the architecture,
          and plan the agents to build it.
        </motion.p>

        {/* Input */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="relative"
        >
          <textarea
            ref={textareaRef}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            className="w-full bg-surface border border-border rounded-xl px-5 py-4 text-primary placeholder-stone-600 text-base focus:outline-none focus:border-stone-600 transition-all duration-200 resize-none leading-relaxed"
            placeholder={examples[exampleIndex]}
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-stone-600 font-mono">
              {idea.length > 0 ? `${idea.length} chars · ` : ''}<kbd className="text-stone-700">⌘ Enter</kbd> to submit
            </span>
            <motion.button
              onClick={handleSubmit}
              disabled={!idea.trim() || loading}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-stone-950/30 border-t-stone-950 rounded-full animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  Start Building
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </motion.button>
          </div>
        </motion.div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-4 p-3.5 rounded-lg bg-red-950/60 border border-red-900 text-red-400 text-sm"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Example chips */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-10"
        >
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-3.5 h-3.5 text-muted" />
            <span className="section-label">Try an example</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => setIdea(ex)}
                className="text-xs text-muted hover:text-primary border border-border hover:border-stone-600 px-3.5 py-1.5 rounded-full transition-all duration-150"
              >
                {ex}
              </button>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

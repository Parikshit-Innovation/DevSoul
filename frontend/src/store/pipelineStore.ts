import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Requirement, Agent, ArchitectureResult, InterviewRound } from '../api/pipeline';

export type PipelineStage = 'idle' | 'ri' | 'ri_interview' | 'ri_done' | 'ai' | 'ai_done' | 'factory' | 'done' | 'failed';

export interface ActivityEvent {
  id: string;
  type: string;
  message: string;
  timestamp: string;
}

interface PipelineStore {
  // Core pipeline state
  pipelineId: string | null;
  idea: string;
  projectName: string;
  summary: string;
  stage: PipelineStage;

  // Requirements (Stage 1)
  requirements: Requirement[];
  currentRound: InterviewRound | null;
  topicsCovered: number;
  totalTopics: number;
  riCompleted: boolean;

  // Architecture (Stage 2)
  architecture: ArchitectureResult | null;
  aiCurrentRound: InterviewRound | null;
  aiInterviewCompleted: boolean;
  aiRunning: boolean;
  aiLog: string[];

  // Agents (Stage 3)
  agents: Agent[];
  factoryRunning: boolean;
  factoryLog: string[];

  // Activity feed
  activityFeed: ActivityEvent[];

  // Actions
  setPipelineId: (id: string) => void;
  setIdea: (idea: string) => void;
  setProjectName: (name: string) => void;
  setSummary: (summary: string) => void;
  setStage: (stage: PipelineStage) => void;
  setRequirements: (reqs: Requirement[]) => void;
  setCurrentRound: (round: InterviewRound | null) => void;
  setRiProgress: (covered: number, total: number) => void;
  setRiCompleted: (val: boolean) => void;
  setArchitecture: (arch: ArchitectureResult) => void;
  setAiCurrentRound: (round: InterviewRound | null) => void;
  setAiInterviewCompleted: (val: boolean) => void;
  setAiRunning: (val: boolean) => void;
  appendAiLog: (msg: string) => void;
  setAgents: (agents: Agent[]) => void;
  setFactoryRunning: (val: boolean) => void;
  appendFactoryLog: (msg: string) => void;
  pushActivity: (event: Omit<ActivityEvent, 'id'>) => void;
  reset: () => void;
}

const initialState = {
  pipelineId: null,
  idea: '',
  projectName: '',
  summary: '',
  stage: 'idle' as PipelineStage,
  requirements: [],
  currentRound: null,
  topicsCovered: 0,
  totalTopics: 6,
  riCompleted: false,
  architecture: null,
  aiCurrentRound: null,
  aiInterviewCompleted: false,
  aiRunning: false,
  aiLog: [],
  agents: [],
  factoryRunning: false,
  factoryLog: [],
  activityFeed: [],
};

export const usePipelineStore = create<PipelineStore>()(
  persist(
    (set) => ({
      ...initialState,
      setPipelineId: (id) => set({ pipelineId: id }),
      setIdea: (idea) => set({ idea }),
      setProjectName: (projectName) => set({ projectName }),
      setSummary: (summary) => set({ summary }),
      setStage: (stage) => set({ stage }),
      setRequirements: (requirements) => set({ requirements }),
      setCurrentRound: (currentRound) => set({ currentRound }),
      setRiProgress: (topicsCovered, totalTopics) => set({ topicsCovered, totalTopics }),
      setRiCompleted: (riCompleted) => set({ riCompleted }),
      setArchitecture: (architecture) => set({ architecture }),
      setAiCurrentRound: (aiCurrentRound) => set({ aiCurrentRound }),
      setAiInterviewCompleted: (aiInterviewCompleted) => set({ aiInterviewCompleted }),
      setAiRunning: (aiRunning) => set({ aiRunning }),
      appendAiLog: (msg) => set((s) => ({ aiLog: [...s.aiLog.slice(-100), msg] })),
      setAgents: (agents) => set({ agents }),
      setFactoryRunning: (factoryRunning) => set({ factoryRunning }),
      appendFactoryLog: (msg) => set((s) => ({ factoryLog: [...s.factoryLog.slice(-100), msg] })),
      pushActivity: (event) =>
        set((s) => ({
          activityFeed: [
            { ...event, id: crypto.randomUUID() },
            ...s.activityFeed.slice(0, 49),
          ],
        })),
      reset: () => set(initialState),
    }),
    { name: 'devsoul-pipeline' }
  )
);

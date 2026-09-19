/// <reference types="vite/client" />
export const API_BASE = '';


export interface PipelineStartResponse {
  pipeline_id: string;
  project_name: string;
  summary: string;
}

export interface PipelineStatus {
  pipeline_id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  stage: 'ri' | 'ai' | 'factory' | 'done';
  progress: number;
  project_name?: string;
  summary?: string;
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  acceptance_criteria: string[];
}

export interface InterviewQuestion {
  node_id: string;
  question: string;
  options: string[];
  allow_free_text: boolean;
}

export interface InterviewRound {
  round_number: number;
  questions: InterviewQuestion[];
  topics_covered: number;
  total_topics: number;
  completed: boolean;
}

export interface ArchitectureResult {
  architecture_summary: string;
  technology_stack: {
    frontend: string;
    backend: string;
    database: string;
    [key: string]: string;
  };
  components: { name: string; description: string }[];
  design_constraints: string[];
}

export interface Agent {
  id: string;
  role: string;
  task: string;
  tools: string[];
  requirement_ids: string[];
  architecture_components: string[];
  depends_on: string[];
  lifecycle: { state: string };
  success_criteria: string[];
}

// ── API Calls ──────────────────────────────────────────────────────────────

export async function startPipeline(idea: string): Promise<PipelineStartResponse> {
  const res = await fetch(`${API_BASE}/api/pipeline/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idea }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getPipelineStatus(id: string): Promise<PipelineStatus> {
  const res = await fetch(`${API_BASE}/api/pipeline/${id}/status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getRequirements(id: string): Promise<Requirement[]> {
  const res = await fetch(`${API_BASE}/api/pipeline/${id}/requirements`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getInterviewRound(id: string): Promise<InterviewRound> {
  const res = await fetch(`${API_BASE}/api/pipeline/${id}/interview/round`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function submitAnswer(
  id: string,
  node_id: string,
  value: string
): Promise<{ next_round: InterviewRound | null; completed: boolean }> {
  const res = await fetch(`${API_BASE}/api/pipeline/${id}/interview/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id, value }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function autoDecide(id: string): Promise<{ completed: boolean }> {
  const res = await fetch(`${API_BASE}/api/pipeline/${id}/interview/auto-decide`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function initArchitecture(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/pipeline/${id}/architecture/init`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getAiInterviewRound(id: string): Promise<InterviewRound> {
  const res = await fetch(`${API_BASE}/api/pipeline/${id}/architecture/interview/round`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function submitAiAnswer(
  id: string,
  node_id: string,
  value: string
): Promise<{ next_round: InterviewRound | null; completed: boolean }> {
  const res = await fetch(`${API_BASE}/api/pipeline/${id}/architecture/interview/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id, value }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function startArchitecture(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/pipeline/${id}/architecture/start`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getArchitecture(id: string): Promise<ArchitectureResult> {
  const res = await fetch(`${API_BASE}/api/pipeline/${id}/architecture`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function startAgentFactory(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/pipeline/${id}/factory/start`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getAgents(id: string): Promise<Agent[]> {
  const res = await fetch(`${API_BASE}/api/pipeline/${id}/agents`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function subscribeToEvents(id: string, onEvent: (e: any) => void): () => void {
  const es = new EventSource(`${API_BASE}/api/pipeline/${id}/events`);
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      onEvent({ type: 'RAW', message: e.data });
    }
  };
  return () => es.close();
}

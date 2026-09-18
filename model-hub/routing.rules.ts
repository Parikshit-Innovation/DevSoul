import type { RoutingRule } from './src/models.ts';

/**
 * Ordered Routing Rule Table for DevOS Model Hub & Router
 * First matching rule determines the candidate model priority list.
 */
export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  {
    name: 'Private Code Rule (Hard Local Constraint)',
    when: {
      sensitivity: 'private',
    },
    prefer: ['qwen-2-5-coder-7b', 'deepseek-r1-8b', 'llama-3-2-3b'],
  },
  {
    name: 'Simple Refactoring Rule',
    when: {
      category: 'refactor_simple',
    },
    prefer: ['qwen-2-5-coder-7b', 'llama-3-1-8b', 'gemini-flash-1-5', 'claude-3-5-sonnet'],
  },
  {
    name: 'System Architecture & High-Level Design Rule',
    when: {
      category: 'architecture',
    },
    prefer: ['claude-3-5-sonnet', 'gpt-4o', 'deepseek-r1-8b', 'qwen-2-5-coder-7b'],
  },
  {
    name: 'Documentation & Markdown Rule',
    when: {
      category: 'documentation',
    },
    prefer: ['llama-3-1-8b', 'gemini-flash-1-5', 'llama-3-2-3b', 'qwen-2-5-coder-7b'],
  },
  {
    name: 'Boilerplate & CRUD Generation Rule',
    when: {
      category: 'boilerplate',
    },
    prefer: ['llama-3-1-8b', 'gemini-flash-1-5', 'qwen-2-5-coder-7b', 'claude-3-5-sonnet'],
  },
  {
    name: 'Debugging & Error Diagnosis Rule',
    when: {
      category: 'debugging',
    },
    prefer: ['claude-3-5-sonnet', 'gpt-4o', 'deepseek-r1-8b', 'qwen-2-5-coder-7b'],
  },
  {
    name: 'Code Review & Security Audit Rule',
    when: {
      category: 'code_review',
    },
    prefer: ['claude-3-5-sonnet', 'gpt-4o', 'qwen-2-5-coder-7b', 'deepseek-r1-8b'],
  },
  {
    name: 'Test Generation & TDD Rule',
    when: {
      category: 'test_generation',
    },
    prefer: ['qwen-2-5-coder-7b', 'llama-3-1-8b', 'claude-3-5-sonnet', 'gemini-flash-1-5'],
  },
  {
    name: 'General Purpose Default Rule',
    when: {
      category: 'general',
    },
    prefer: ['claude-3-5-sonnet', 'gpt-4o', 'qwen-2-5-coder-7b', 'llama-3-1-8b'],
  },
];

import type { ChatMessage, TaskCategory } from './models.ts';

export interface CategoryClassificationResult {
  category: TaskCategory;
  reasons: string[];
  inferred: boolean;
}

export class CategoryClassifier {
  private static readonly KEYWORD_MAP: { category: TaskCategory; keywords: RegExp }[] = [
    {
      category: 'architecture',
      keywords: /\b(architecture|architect|design pattern|system design|scalability|microservices|distributed system|infrastructure|trade-offs|high-level design|database schema design)\b/i,
    },
    {
      category: 'documentation',
      keywords: /\b(readme|docstring|document|documentation|jsdoc|typedoc|markdown doc|swagger|openapi doc|explain this codebase)\b/i,
    },
    {
      category: 'boilerplate',
      keywords: /\b(boilerplate|scaffold|crud|generate template|starter code|skeleton|bootstrap|stub|initial setup)\b/i,
    },
    {
      category: 'refactor_simple',
      keywords: /\b(refactor|rename|extract function|extract variable|simplify|clean up|format|restructure code|decouple)\b/i,
    },
    {
      category: 'test_generation',
      keywords: /\b(test|tests|unit test|integration test|jest|mocha|pytest|e2e test|test suite|coverage|tdd|spec)\b/i,
    },
    {
      category: 'debugging',
      keywords: /\b(bug|error|stack trace|fix|exception|crash|fails|segfault|debug|unexpected token|null pointer|undefined is not a function)\b/i,
    },
    {
      category: 'code_review',
      keywords: /\b(code review|review this|pr review|pull request review|audit this code|security review|best practices review)\b/i,
    },
  ];

  public static classify(
    explicitCategory?: TaskCategory,
    messages: ChatMessage[] = []
  ): CategoryClassificationResult {
    // 1. Explicit category specified in request
    if (explicitCategory) {
      return {
        category: explicitCategory,
        reasons: [`Explicit task category provided: '${explicitCategory}'`],
        inferred: false,
      };
    }

    // 2. Classify from user prompt
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const contentToAnalyze = lastUserMessage.toLowerCase();

    for (const rule of this.KEYWORD_MAP) {
      const match = rule.keywords.exec(contentToAnalyze);
      if (match) {
        return {
          category: rule.category,
          reasons: [
            `Inferred task category '${rule.category}' from keyword match '${match[0]}' in user prompt`,
          ],
          inferred: true,
        };
      }
    }

    // 3. Fallback to general
    return {
      category: 'general',
      reasons: ["No specific category keywords matched; defaulting to 'general'"],
      inferred: true,
    };
  }
}

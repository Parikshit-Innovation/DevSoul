export interface Question {
  key: string;
  category: string;
  prompt: string;
}

export const QUESTIONS: Question[] = [
  // ── Frontend ───────────────────────────────────────────────────────────────
  {
    key: "frontend_core",
    category: "Frontend",
    prompt: "What is the primary frontend approach? (e.g. SPA, SSR, MPA, PWA)",
  },
  {
    key: "frontend_framework",
    category: "Frontend",
    prompt:
      "Which frontend framework will you use? (e.g. React, Vue, Angular, Next.js, SvelteKit)",
  },
  {
    key: "frontend_state",
    category: "Frontend",
    prompt:
      "How will client-side state be managed? (e.g. Redux, Zustand, Pinia, React Query, none)",
  },

  // ── Backend ────────────────────────────────────────────────────────────────
  {
    key: "backend_runtime",
    category: "Backend",
    prompt:
      "Which backend runtime / language? (e.g. Node.js, Python, Go, Java, Ruby)",
  },
  {
    key: "backend_api",
    category: "Backend",
    prompt:
      "Which API style / framework? (e.g. Express, FastAPI, Gin, Spring Boot, Django REST)",
  },

  // ── Database ───────────────────────────────────────────────────────────────
  {
    key: "db_relational",
    category: "Database",
    prompt:
      "Primary relational / SQL database? (e.g. PostgreSQL, MySQL, SQLite, none)",
  },
  {
    key: "db_nonrelational",
    category: "Database",
    prompt:
      "Any NoSQL / document store? (e.g. MongoDB, DynamoDB, Firestore, none)",
  },
  {
    key: "db_caching",
    category: "Database",
    prompt: "Caching layer? (e.g. Redis, Memcached, none)",
  },

  // ── Auth ───────────────────────────────────────────────────────────────────
  {
    key: "auth",
    category: "Auth",
    prompt:
      "Authentication strategy? (e.g. JWT, OAuth2 / OIDC, Session-based, Firebase Auth, none)",
  },

  // ── DevOps ─────────────────────────────────────────────────────────────────
  {
    key: "devops_cloud",
    category: "DevOps",
    prompt:
      "Cloud / hosting platform? (e.g. AWS, GCP, Azure, Vercel, Railway, DigitalOcean)",
  },
  {
    key: "devops_containers",
    category: "DevOps",
    prompt: "Container / orchestration strategy? (e.g. Docker, Kubernetes, none)",
  },
  {
    key: "devops_cicd",
    category: "DevOps",
    prompt:
      "CI/CD pipeline? (e.g. GitHub Actions, GitLab CI, CircleCI, Jenkins, none)",
  },
  {
    key: "devops_iac",
    category: "DevOps",
    prompt:
      "Infrastructure-as-code tooling? (e.g. Terraform, Pulumi, AWS CDK, none)",
  },

  // ── Monitoring ─────────────────────────────────────────────────────────────
  {
    key: "monitoring_error",
    category: "Monitoring",
    prompt:
      "Error tracking / APM? (e.g. Sentry, Datadog, New Relic, none)",
  },
  {
    key: "monitoring_logs",
    category: "Monitoring",
    prompt:
      "Log aggregation? (e.g. Datadog Logs, Elastic Stack, Loki/Grafana, CloudWatch, none)",
  },
];

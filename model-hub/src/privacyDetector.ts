import type { RouteRequest, Sensitivity, SensitivityProvider } from './models.ts';
import { matchGlob } from './utils.ts';

export interface SecretPattern {
  name: string;
  regex: RegExp;
  description: string;
}

export interface PrivacyEvaluationResult {
  sensitivity: Sensitivity;
  isPrivate: boolean;
  reasons: string[];
  detectedPatterns: string[];
  matchedFilePaths: string[];
}

export class PrivacyDetector {
  /**
   * Well-defined regex patterns for credentials and secrets
   */
  public static readonly SECRET_PATTERNS: SecretPattern[] = [
    {
      name: 'PRIVATE_KEY_BLOCK',
      regex: /-----BEGIN\s+(RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/i,
      description: 'Cryptographic Private Key Block (RSA/EC/DSA/OpenSSH)',
    },
    {
      name: 'AWS_ACCESS_KEY',
      regex: /\b(AKIA[0-9A-Z]{16})\b/,
      description: 'AWS Access Key ID (AKIA...)',
    },
    {
      name: 'STRIPE_SECRET_KEY',
      regex: /\b(sk_live_[0-9a-zA-Z]{24,34})\b/,
      description: 'Stripe Live Secret Key (sk_live_...)',
    },
    {
      name: 'GOOGLE_API_KEY',
      regex: /\b(AIza[0-9A-Za-z\-_]{30,40})\b/,
      description: 'Google Cloud / Firebase API Key (AIza...)',
    },
    {
      name: 'GITHUB_TOKEN',
      regex: /\b(ghp_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{82})\b/,
      description: 'GitHub Personal Access Token (ghp_... / github_pat_...)',
    },
    {
      name: 'GENERIC_ASSIGNMENT_SECRET',
      regex: /(?:[A-Za-z0-9_]*(?:password|passwd|secret|api_?key|auth_?token|client_?secret|private_?key)[A-Za-z0-9_]*)\s*[:=]\s*(?:["']([^"'\r\n]{6,})["']|([A-Za-z0-9_\-!@#$%^&*+=]{8,}))/i,
      description: 'Explicit credential assignment (password/secret/token/apiKey)',
    },
    {
      name: 'DATABASE_CONNECTION_URI',
      regex: /(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s]+:[^@\s]+@[^\s/]+/i,
      description: 'Database connection URI containing credentials',
    },
  ];

  private privateGlobs: string[];
  private privateProject: boolean;
  private externalProvider: SensitivityProvider | null = null;

  constructor(
    privateGlobs: string[] = [
      '.env*',
      '**/secrets/**',
      '**/*.pem',
      '**/*.key',
      '**/credentials*',
      '**/*.p12',
      '**/.ssh/**',
      '**/.aws/**',
    ],
    privateProject: boolean = false
  ) {
    this.privateGlobs = [...privateGlobs];
    this.privateProject = privateProject;
  }

  public setSensitivityProvider(provider: SensitivityProvider | null): void {
    this.externalProvider = provider;
  }

  public setPrivateGlobs(globs: string[]): void {
    this.privateGlobs = [...globs];
  }

  public setPrivateProject(isPrivate: boolean): void {
    this.privateProject = isPrivate;
  }

  public async evaluate(request: RouteRequest): Promise<PrivacyEvaluationResult> {
    const reasons: string[] = [];
    const detectedPatterns: string[] = [];
    const matchedFilePaths: string[] = [];

    // 1. Explicit request flag (hard escalation if private)
    if (request.sensitivity === 'private') {
      reasons.push('Explicit task sensitivity set to PRIVATE');
    }

    // 2. Global Project-Level Privacy Flag
    if (this.privateProject) {
      reasons.push('Project-level setting privateProject: true enforces local processing');
    }

    // 3. File path inspection against sensitive globs
    if (request.filePaths && request.filePaths.length > 0) {
      for (const fp of request.filePaths) {
        for (const glob of this.privateGlobs) {
          if (matchGlob(fp, glob)) {
            matchedFilePaths.push(fp);
            reasons.push(`Target file '${fp}' matches private glob pattern '${glob}'`);
            break;
          }
        }
      }
    }

    // 4. Message content secret regex inspection across EVERY message (system, user, assistant, tool)
    if (request.messages && Array.isArray(request.messages)) {
      for (const msg of request.messages) {
        const content = typeof msg.content === 'string' ? msg.content : '';
        for (const pattern of PrivacyDetector.SECRET_PATTERNS) {
          if (pattern.regex.test(content) && !detectedPatterns.includes(pattern.name)) {
            detectedPatterns.push(pattern.name);
            reasons.push(`Message [role=${msg.role || 'unknown'}] contains detected secret pattern: ${pattern.description}`);
          }
        }

        // Also check if message text explicitly references sensitive file paths (e.g. .env, id_rsa)
        for (const glob of this.privateGlobs) {
          const simpleName = glob.replace(/\*\*\/?/g, '').replace(/\*/g, '');
          if (simpleName && simpleName.length > 3 && content.includes(simpleName)) {
            if (!matchedFilePaths.includes(simpleName)) {
              matchedFilePaths.push(simpleName);
              reasons.push(`Message [role=${msg.role || 'unknown'}] references sensitive file/path '${simpleName}'`);
            }
          }
        }
      }

      // Also test concatenated messages for split secrets across messages
      const fullText = request.messages.map((m) => m.content || '').join('\n');
      for (const pattern of PrivacyDetector.SECRET_PATTERNS) {
        if (pattern.regex.test(fullText) && !detectedPatterns.includes(pattern.name)) {
          detectedPatterns.push(pattern.name);
          reasons.push(`Combined message stream contains detected secret pattern: ${pattern.description}`);
        }
      }
    }

    // 5. External Hook (e.g. Aegis Control Plane)
    if (this.externalProvider) {
      try {
        const externalOpinion = await this.externalProvider.evaluateSensitivity(request);
        if (externalOpinion === 'private') {
          reasons.push('External Security Provider (Aegis) escalated sensitivity to PRIVATE');
        }
      } catch (err: any) {
        // External provider failure should fail-safe to private if error indicates threat
        reasons.push(`External security provider evaluation: ${err?.message || 'Error'}`);
      }
    }

    const isPrivate =
      request.sensitivity === 'private' ||
      this.privateProject ||
      matchedFilePaths.length > 0 ||
      detectedPatterns.length > 0 ||
      reasons.some((r) => r.includes('PRIVATE'));

    // Safety rule: If any detector found private content, escalate to 'private'
    // Nothing can downgrade a 'private' decision to 'public'
    const finalSensitivity: Sensitivity = isPrivate ? 'private' : 'public';

    if (finalSensitivity === 'public') {
      reasons.push('No private files, secret tokens, or project-level privacy constraints detected (PUBLIC)');
    }

    return {
      sensitivity: finalSensitivity,
      isPrivate,
      reasons,
      detectedPatterns,
      matchedFilePaths,
    };
  }
}

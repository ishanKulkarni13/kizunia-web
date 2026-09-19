// prisma/seed/data/technologies.ts
// Comprehensive tech stack covering web, mobile, AI/ML, blockchain, DevOps, etc.
//
// `type` classifies what the Technology *is* (see TechnologyType in
// schema.prisma) — it never encodes anything about how a particular
// consumer (Project/Competition/Portfolio) uses it.

import type { TechnologyType } from "../../../src/generated/prisma";

export const technologies: {
  name: string;
  slug: string;
  description: string;
  type: TechnologyType;
}[] = [
  // Frontend
  { name: "React", slug: "react", description: "JavaScript library for building UIs", type: "LIBRARY" },
  { name: "Next.js", slug: "nextjs", description: "React framework for production", type: "FRAMEWORK" },
  { name: "Vue.js", slug: "vuejs", description: "Progressive JavaScript framework", type: "FRAMEWORK" },
  { name: "Angular", slug: "angular", description: "Platform for building mobile & desktop web apps", type: "FRAMEWORK" },
  { name: "Svelte", slug: "svelte", description: "Cybernetically enhanced web apps", type: "FRAMEWORK" },
  { name: "Tailwind CSS", slug: "tailwindcss", description: "Utility-first CSS framework", type: "LIBRARY" },

  // Mobile
  { name: "Flutter", slug: "flutter", description: "Google's UI toolkit for cross-platform apps", type: "FRAMEWORK" },
  { name: "React Native", slug: "react-native", description: "Build native apps with React", type: "FRAMEWORK" },
  { name: "Swift", slug: "swift", description: "Apple's programming language for iOS/macOS", type: "LANGUAGE" },
  { name: "Kotlin", slug: "kotlin", description: "Modern language for Android development", type: "LANGUAGE" },

  // Backend
  { name: "Node.js", slug: "nodejs", description: "JavaScript runtime built on V8", type: "RUNTIME" },
  { name: "Python", slug: "python", description: "General-purpose programming language", type: "LANGUAGE" },
  { name: "Go", slug: "golang", description: "Statically typed, compiled language by Google", type: "LANGUAGE" },
  { name: "Rust", slug: "rust", description: "Systems programming language focused on safety", type: "LANGUAGE" },
  { name: "Java", slug: "java", description: "Enterprise-grade programming language", type: "LANGUAGE" },
  { name: "Django", slug: "django", description: "High-level Python web framework", type: "FRAMEWORK" },
  { name: "FastAPI", slug: "fastapi", description: "Modern, fast Python web framework", type: "FRAMEWORK" },
  { name: "Express.js", slug: "expressjs", description: "Minimal Node.js web framework", type: "FRAMEWORK" },

  // AI/ML
  { name: "TensorFlow", slug: "tensorflow", description: "End-to-end ML platform", type: "LIBRARY" },
  { name: "PyTorch", slug: "pytorch", description: "ML framework for research and production", type: "LIBRARY" },
  { name: "LangChain", slug: "langchain", description: "Framework for LLM-powered applications", type: "LIBRARY" },
  { name: "Hugging Face", slug: "huggingface", description: "ML model hub and tooling", type: "PLATFORM" },
  { name: "OpenAI API", slug: "openai-api", description: "GPT and AI model APIs", type: "SERVICE" },

  // Blockchain / Web3
  { name: "Solidity", slug: "solidity", description: "Smart contract language for Ethereum", type: "LANGUAGE" },
  { name: "Ethereum", slug: "ethereum", description: "Decentralized blockchain platform", type: "PLATFORM" },
  { name: "Solana", slug: "solana", description: "High-performance blockchain", type: "PLATFORM" },
  { name: "IPFS", slug: "ipfs", description: "Peer-to-peer distributed file system", type: "TOOL" },

  // Databases
  { name: "PostgreSQL", slug: "postgresql", description: "Advanced open-source relational database", type: "DATABASE" },
  { name: "MongoDB", slug: "mongodb", description: "NoSQL document database", type: "DATABASE" },
  { name: "Redis", slug: "redis", description: "In-memory data store", type: "DATABASE" },
  { name: "Supabase", slug: "supabase", description: "Open-source Firebase alternative", type: "SERVICE" },
  { name: "Firebase", slug: "firebase", description: "Google's app development platform", type: "SERVICE" },

  // DevOps / Cloud
  { name: "Docker", slug: "docker", description: "Container platform for building and shipping apps", type: "TOOL" },
  { name: "Kubernetes", slug: "kubernetes", description: "Container orchestration platform", type: "TOOL" },
  { name: "AWS", slug: "aws", description: "Amazon Web Services cloud platform", type: "PLATFORM" },
  { name: "Google Cloud", slug: "gcp", description: "Google's cloud computing platform", type: "PLATFORM" },
  { name: "Terraform", slug: "terraform", description: "Infrastructure as code tool", type: "TOOL" },
  { name: "GitHub Actions", slug: "github-actions", description: "CI/CD platform by GitHub", type: "TOOL" },

  // Other
  { name: "GraphQL", slug: "graphql", description: "Query language for APIs", type: "OTHER" },
  { name: "WebAssembly", slug: "webassembly", description: "Binary instruction format for the web", type: "OTHER" },
  { name: "Figma", slug: "figma", description: "Collaborative design tool", type: "TOOL" },
  { name: "Arduino", slug: "arduino", description: "Open-source electronics platform", type: "PLATFORM" },
  { name: "Raspberry Pi", slug: "raspberry-pi", description: "Single-board computer for IoT", type: "PLATFORM" },
] as const;

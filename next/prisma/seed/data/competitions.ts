// prisma/seed/data/competitions.ts
// 20 competitions with diverse values across every filterable field.
// Mix of real-world-inspired and fictional competitions for thorough filter testing.
//
// Coverage matrix:
// - CompetitionMode:         ONLINE (5), OFFLINE (8), HYBRID (7)
// - CompetitionStatus:       UPCOMING (4), REGISTRATION_OPEN (5), REGISTRATION_CLOSED (2), ONGOING (4), COMPLETED (4), CANCELLED (1)
// - CompetitionVisibility:   PUBLIC (16), UNLISTED (2), PRIVATE (1), ARCHIVED (1)
// - RegistrationFeeType:   FREE (12), PAID (5), CONDITIONAL (3)
// - RegistrationPlatform:  KIZUNIA, UNSTOP, DEVPOST, DEVFOLIO, DORAHACKS, HACKEREARTH, LUMA, GOOGLE_FORM, CUSTOM
// - OrganizerType:         COLLEGE, COMPANY, COMMUNITY, GOVERNMENT, NON_PROFIT, STARTUP, INDIVIDUAL, OPEN_SOURCE
// - DifficultyLevel:       BEGINNER (5), INTERMEDIATE (6), ADVANCED (5), OPEN (4)
// - CertificateType:       NONE, PARTICIPATION, WINNER
// - EligibilityType:       Various combinations
// - RegistrationType:      INDIVIDUAL, TEAM, BOTH

import type {
  CompetitionMode,
  CompetitionStatus,
  CompetitionVisibility,
  RegistrationFeeType,
  RegistrationPlatform,
  OrganizerType,
  DifficultyLevel,
  CertificateType,
  RegistrationType,
  EligibilityType,
  CompetitionMemberRole,
} from "../../../src/generated/prisma";

interface CompetitionSeed {
  title: string;
  slug: string;
  shortDescription: string;
  organizer: string;
  mode: CompetitionMode;
  location: string | null;
  status: CompetitionStatus;
  visibility: CompetitionVisibility;
  startDate: Date;
  endDate: Date;
  registrationDeadline: Date;
  prizePool: string | null;
  minTeamSize: number;
  maxTeamSize: number;
  registrationPlatform: RegistrationPlatform;
  registrationType: RegistrationType;
  registrationFeeType: RegistrationFeeType;
  registrationFee: string | null;
  organizerType: OrganizerType;
  difficulty: DifficultyLevel;
  certificateType: CertificateType;
  website: string | null;
  registrationLink: string | null;
  // Indices into the arrays seeded separately (resolved at runtime)
  categorySlugs: string[];
  technologySlugs: string[];
  eligibilities: EligibilityType[];
  // Owner user index (into users array) and extra members
  ownerIndex: number;
  members: { userIndex: number; role: CompetitionMemberRole }[];
}

export const competitions: CompetitionSeed[] = [
  // ─────────────────────────────────────────────────────────────
  // 1. Real-inspired — ETHGlobal (Web3, Online, Community)
  // ─────────────────────────────────────────────────────────────
  {
    title: "ETHGlobal New Delhi 2026",
    slug: "ethglobal-new-delhi-2026",
    shortDescription: "The largest Ethereum competition comes to India. Build the future of Web3 in 36 hours.",
    organizer: "ETHGlobal",
    mode: "OFFLINE",
    location: "New Delhi, India",
    status: "UPCOMING",
    visibility: "PUBLIC",
    startDate: new Date("2026-10-15T09:00:00Z"),
    endDate: new Date("2026-10-17T18:00:00Z"),
    registrationDeadline: new Date("2026-10-01T23:59:00Z"),
    prizePool: "$150,000",
    minTeamSize: 1,
    maxTeamSize: 5,
    registrationPlatform: "CUSTOM",
    registrationType: "BOTH",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "COMMUNITY",
    difficulty: "OPEN",
    certificateType: "PARTICIPATION",
    website: "https://ethglobal.com",
    registrationLink: "https://ethglobal.com/events/newdelhi2026",
    categorySlugs: ["web3", "fintech", "open-source"],
    technologySlugs: ["solidity", "ethereum", "react", "nodejs", "ipfs"],
    eligibilities: ["OPEN"],
    ownerIndex: 2, // Sara Chen (blockchain dev)
    members: [{ userIndex: 0, role: "ORGANIZER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 2. Real-inspired — Smart India Competition (Govt, Offline)
  // ─────────────────────────────────────────────────────────────
  {
    title: "Smart India Competition 2026",
    slug: "sih-2026",
    shortDescription: "India's largest open innovation model. Solve real-world government problem statements.",
    organizer: "Ministry of Education, Govt of India",
    mode: "OFFLINE",
    location: "Multiple cities, India",
    status: "REGISTRATION_OPEN",
    visibility: "PUBLIC",
    startDate: new Date("2026-12-10T09:00:00Z"),
    endDate: new Date("2026-12-12T18:00:00Z"),
    registrationDeadline: new Date("2026-11-15T23:59:00Z"),
    prizePool: "₹50,00,000",
    minTeamSize: 6,
    maxTeamSize: 6,
    registrationPlatform: "CUSTOM",
    registrationType: "TEAM",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "GOVERNMENT",
    difficulty: "INTERMEDIATE",
    certificateType: "PARTICIPATION",
    website: "https://sih.gov.in",
    registrationLink: "https://sih.gov.in/register",
    categorySlugs: ["ai", "iot", "healthtech", "edtech", "sustainability", "social-impact"],
    technologySlugs: ["python", "react", "nodejs", "flutter", "tensorflow", "postgresql"],
    eligibilities: ["UNDERGRADUATE", "POSTGRADUATE", "ENGINEERING"],
    ownerIndex: 0, // Priya (admin)
    members: [{ userIndex: 1, role: "MAINTAINER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 3. Real-inspired — MLH Global Hack Week
  // ─────────────────────────────────────────────────────────────
  {
    title: "MLH Global Hack Week: AI Edition",
    slug: "mlh-ghw-ai-2026",
    shortDescription: "A week-long celebration of building with AI. Workshops, challenges, and community.",
    organizer: "Major League Hacking",
    mode: "ONLINE",
    location: null,
    status: "REGISTRATION_OPEN",
    visibility: "PUBLIC",
    startDate: new Date("2026-09-01T00:00:00Z"),
    endDate: new Date("2026-09-07T23:59:00Z"),
    registrationDeadline: new Date("2026-09-01T00:00:00Z"),
    prizePool: "$10,000 in prizes & swag",
    minTeamSize: 1,
    maxTeamSize: 4,
    registrationPlatform: "CUSTOM",
    registrationType: "BOTH",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "COMMUNITY",
    difficulty: "BEGINNER",
    certificateType: "PARTICIPATION",
    website: "https://ghw.mlh.io",
    registrationLink: "https://ghw.mlh.io/register",
    categorySlugs: ["ai", "ml", "genai-llms", "web-dev"],
    technologySlugs: ["python", "pytorch", "langchain", "openai-api", "huggingface"],
    eligibilities: ["UNDERGRADUATE", "POSTGRADUATE", "FRESHER", "OPEN"],
    ownerIndex: 1, // Arjun (ML)
    members: [{ userIndex: 7, role: "ORGANIZER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 4. Real-inspired — HackMIT (College, Offline, Advanced)
  // ─────────────────────────────────────────────────────────────
  {
    title: "HackMIT 2026",
    slug: "hackmit-2026",
    shortDescription: "MIT's flagship competition. 1000+ hackers. 24 hours. Infinite possibilities.",
    organizer: "MIT",
    mode: "OFFLINE",
    location: "Cambridge, MA, USA",
    status: "UPCOMING",
    visibility: "PUBLIC",
    startDate: new Date("2026-09-20T10:00:00Z"),
    endDate: new Date("2026-09-21T14:00:00Z"),
    registrationDeadline: new Date("2026-08-31T23:59:00Z"),
    prizePool: "$50,000",
    minTeamSize: 1,
    maxTeamSize: 4,
    registrationPlatform: "CUSTOM",
    registrationType: "BOTH",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "COLLEGE",
    difficulty: "ADVANCED",
    certificateType: "WINNER",
    website: "https://hackmit.org",
    registrationLink: "https://hackmit.org/apply",
    categorySlugs: ["ai", "web-dev", "dev-tools", "social-impact"],
    technologySlugs: ["react", "nextjs", "python", "pytorch", "aws", "docker"],
    eligibilities: ["UNDERGRADUATE", "POSTGRADUATE"],
    ownerIndex: 4, // Emily (MIT)
    members: [{ userIndex: 7, role: "ORGANIZER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 5. Real-inspired — Google Solution Challenge
  // ─────────────────────────────────────────────────────────────
  {
    title: "Google Solution Challenge 2026",
    slug: "google-solution-challenge-2026",
    shortDescription: "Build solutions addressing UN Sustainable Development Goals using Google tech.",
    organizer: "Google Developer Student Clubs",
    mode: "ONLINE",
    location: null,
    status: "ONGOING",
    visibility: "PUBLIC",
    startDate: new Date("2026-07-01T00:00:00Z"),
    endDate: new Date("2026-08-31T23:59:00Z"),
    registrationDeadline: new Date("2026-07-15T23:59:00Z"),
    prizePool: "$20,000 + mentorship",
    minTeamSize: 2,
    maxTeamSize: 4,
    registrationPlatform: "GOOGLE_FORM",
    registrationType: "TEAM",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "COMPANY",
    difficulty: "INTERMEDIATE",
    certificateType: "PARTICIPATION",
    website: "https://developers.google.com/community/gdsc-solution-challenge",
    registrationLink: null,
    categorySlugs: ["sustainability", "social-impact", "mobile-dev", "cloud-devops"],
    technologySlugs: ["flutter", "firebase", "gcp", "kotlin", "tensorflow"],
    eligibilities: ["UNDERGRADUATE", "POSTGRADUATE", "ENGINEERING"],
    ownerIndex: 3, // Rahul (Flutter)
    members: [{ userIndex: 0, role: "ORGANIZER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 6. Real-inspired — Devfolio IIIT-H Competition (Paid, College)
  // ─────────────────────────────────────────────────────────────
  {
    title: "Hack the Mountains 5.0",
    slug: "hack-the-mountains-5",
    shortDescription: "India's premier community-driven hybrid competition. 48 hours of innovation.",
    organizer: "Hack the Mountains Community",
    mode: "HYBRID",
    location: "Dehradun, India + Online",
    status: "REGISTRATION_OPEN",
    visibility: "PUBLIC",
    startDate: new Date("2026-10-05T09:00:00Z"),
    endDate: new Date("2026-10-07T18:00:00Z"),
    registrationDeadline: new Date("2026-09-25T23:59:00Z"),
    prizePool: "₹5,00,000",
    minTeamSize: 2,
    maxTeamSize: 4,
    registrationPlatform: "DEVFOLIO",
    registrationType: "TEAM",
    registrationFeeType: "CONDITIONAL",
    registrationFee: "₹200 for offline (free for online)",
    organizerType: "COMMUNITY",
    difficulty: "INTERMEDIATE",
    certificateType: "PARTICIPATION",
    website: "https://hackthemountains.tech",
    registrationLink: "https://devfolio.co/hackthemountains5",
    categorySlugs: ["web-dev", "ai", "open-source", "dev-tools"],
    technologySlugs: ["react", "nextjs", "nodejs", "python", "docker", "github-actions"],
    eligibilities: ["UNDERGRADUATE", "POSTGRADUATE", "FRESHER", "PROFESSIONAL"],
    ownerIndex: 0,
    members: [{ userIndex: 3, role: "ORGANIZER" }, { userIndex: 6, role: "MAINTAINER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 7. Fictional — Startup weekend style (Paid, Startup)
  // ─────────────────────────────────────────────────────────────
  {
    title: "LaunchPad 48: Startup Competition",
    slug: "launchpad-48-startup",
    shortDescription: "Build, pitch, and launch a startup in 48 hours. Real investors, real feedback.",
    organizer: "LaunchPad Ventures",
    mode: "OFFLINE",
    location: "Bangalore, India",
    status: "REGISTRATION_OPEN",
    visibility: "PUBLIC",
    startDate: new Date("2026-11-01T09:00:00Z"),
    endDate: new Date("2026-11-03T18:00:00Z"),
    registrationDeadline: new Date("2026-10-20T23:59:00Z"),
    prizePool: "$25,000 seed funding",
    minTeamSize: 3,
    maxTeamSize: 5,
    registrationPlatform: "LUMA",
    registrationType: "TEAM",
    registrationFeeType: "PAID",
    registrationFee: "₹1,500 per person",
    organizerType: "STARTUP",
    difficulty: "ADVANCED",
    certificateType: "WINNER",
    website: null,
    registrationLink: "https://lu.ma/launchpad48",
    categorySlugs: ["fintech", "healthtech", "sustainability"],
    technologySlugs: ["react", "nodejs", "postgresql", "aws", "figma"],
    eligibilities: ["PROFESSIONAL", "POSTGRADUATE"],
    ownerIndex: 1,
    members: [{ userIndex: 4, role: "ORGANIZER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 8. Fictional — Beginner-friendly, Online, Individual
  // ─────────────────────────────────────────────────────────────
  {
    title: "First Hack: Code Your First Project",
    slug: "first-hack-beginners",
    shortDescription: "Never coded before? Start here. Mentors, workshops, and zero judgment.",
    organizer: "CodeNewbie Community",
    mode: "ONLINE",
    location: null,
    status: "REGISTRATION_OPEN",
    visibility: "PUBLIC",
    startDate: new Date("2026-08-15T00:00:00Z"),
    endDate: new Date("2026-08-17T23:59:00Z"),
    registrationDeadline: new Date("2026-08-14T23:59:00Z"),
    prizePool: "Swag packs + mentorship",
    minTeamSize: 1,
    maxTeamSize: 1,
    registrationPlatform: "KIZUNIA",
    registrationType: "INDIVIDUAL",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "COMMUNITY",
    difficulty: "BEGINNER",
    certificateType: "PARTICIPATION",
    website: null,
    registrationLink: null,
    categorySlugs: ["web-dev", "edtech"],
    technologySlugs: ["react", "nodejs", "tailwindcss"],
    eligibilities: ["SCHOOL", "UNDERGRADUATE", "FRESHER", "OPEN"],
    ownerIndex: 6, // Aisha (designer)
    members: [],
  },

  // ─────────────────────────────────────────────────────────────
  // 9. Real-inspired — Devpost-style, Completed, Large prize
  // ─────────────────────────────────────────────────────────────
  {
    title: "AWS GameDay Challenge 2026",
    slug: "aws-gameday-2026",
    shortDescription: "Test your cloud skills in this gamified AWS architecture challenge.",
    organizer: "Amazon Web Services",
    mode: "ONLINE",
    location: null,
    status: "COMPLETED",
    visibility: "PUBLIC",
    startDate: new Date("2026-03-10T09:00:00Z"),
    endDate: new Date("2026-03-12T18:00:00Z"),
    registrationDeadline: new Date("2026-03-01T23:59:00Z"),
    prizePool: "$75,000 in AWS credits",
    minTeamSize: 3,
    maxTeamSize: 5,
    registrationPlatform: "DEVPOST",
    registrationType: "TEAM",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "COMPANY",
    difficulty: "ADVANCED",
    certificateType: "WINNER",
    website: "https://aws.amazon.com/gameday",
    registrationLink: null,
    categorySlugs: ["cloud-devops", "dev-tools"],
    technologySlugs: ["aws", "docker", "kubernetes", "terraform", "python"],
    eligibilities: ["PROFESSIONAL", "ENGINEERING"],
    ownerIndex: 4, // Emily (DevOps)
    members: [{ userIndex: 1, role: "MAINTAINER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 10. Fictional — Cybersecurity CTF (Paid, Advanced, Hybrid)
  // ─────────────────────────────────────────────────────────────
  {
    title: "CyberStrike CTF 2026",
    slug: "cyberstrike-ctf-2026",
    shortDescription: "Elite capture-the-flag competition. Jeopardy + Attack-Defense. Are you ready?",
    organizer: "CyberStrike Foundation",
    mode: "HYBRID",
    location: "Hyderabad, India + Online",
    status: "UPCOMING",
    visibility: "PUBLIC",
    startDate: new Date("2026-11-15T09:00:00Z"),
    endDate: new Date("2026-11-16T21:00:00Z"),
    registrationDeadline: new Date("2026-11-01T23:59:00Z"),
    prizePool: "₹10,00,000",
    minTeamSize: 2,
    maxTeamSize: 4,
    registrationPlatform: "HACKEREARTH",
    registrationType: "TEAM",
    registrationFeeType: "PAID",
    registrationFee: "₹500 per team",
    organizerType: "NON_PROFIT",
    difficulty: "ADVANCED",
    certificateType: "WINNER",
    website: null,
    registrationLink: null,
    categorySlugs: ["cybersecurity"],
    technologySlugs: ["python", "rust", "docker"],
    eligibilities: ["UNDERGRADUATE", "POSTGRADUATE", "PROFESSIONAL", "ENGINEERING"],
    ownerIndex: 5, // Karthik (cybersecurity)
    members: [{ userIndex: 0, role: "ORGANIZER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 11. Fictional — Design competition (Individual, Beginner)
  // ─────────────────────────────────────────────────────────────
  {
    title: "PixelCraft Design Jam",
    slug: "pixelcraft-design-jam",
    shortDescription: "48-hour design sprint. Figma, prototyping, and user research. No code required.",
    organizer: "PixelCraft Studio",
    mode: "ONLINE",
    location: null,
    status: "ONGOING",
    visibility: "PUBLIC",
    startDate: new Date("2026-07-20T00:00:00Z"),
    endDate: new Date("2026-07-28T23:59:00Z"),
    registrationDeadline: new Date("2026-07-19T23:59:00Z"),
    prizePool: "$5,000 + Figma Pro licenses",
    minTeamSize: 1,
    maxTeamSize: 3,
    registrationPlatform: "TYPEFORM",
    registrationType: "BOTH",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "STARTUP",
    difficulty: "BEGINNER",
    certificateType: "PARTICIPATION",
    website: null,
    registrationLink: null,
    categorySlugs: ["design-ux", "web-dev"],
    technologySlugs: ["figma", "react", "tailwindcss"],
    eligibilities: ["DESIGN", "OPEN"],
    ownerIndex: 6, // Aisha (designer)
    members: [],
  },

  // ─────────────────────────────────────────────────────────────
  // 12. Real-inspired — Unstop competition (College, Offline)
  // ─────────────────────────────────────────────────────────────
  {
    title: "VIT Hack 2026",
    slug: "vit-hack-2026",
    shortDescription: "VIT's annual flagship competition. 500+ teams. 24 hours of non-stop coding.",
    organizer: "VIT Vellore",
    mode: "OFFLINE",
    location: "Vellore, Tamil Nadu, India",
    status: "REGISTRATION_CLOSED",
    visibility: "PUBLIC",
    startDate: new Date("2026-08-01T09:00:00Z"),
    endDate: new Date("2026-08-02T18:00:00Z"),
    registrationDeadline: new Date("2026-07-20T23:59:00Z"),
    prizePool: "₹3,00,000",
    minTeamSize: 3,
    maxTeamSize: 4,
    registrationPlatform: "UNSTOP",
    registrationType: "TEAM",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "COLLEGE",
    difficulty: "INTERMEDIATE",
    certificateType: "PARTICIPATION",
    website: "https://vithack.in",
    registrationLink: "https://unstop.com/vithack2026",
    categorySlugs: ["ai", "web-dev", "mobile-dev", "iot"],
    technologySlugs: ["react", "flutter", "python", "tensorflow", "arduino"],
    eligibilities: ["UNDERGRADUATE", "ENGINEERING"],
    ownerIndex: 3, // Rahul (VIT Pune)
    members: [{ userIndex: 5, role: "MAINTAINER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 13. Fictional — Open source contribution (Online, Free)
  // ─────────────────────────────────────────────────────────────
  {
    title: "Hacktoberfest Hacks 2026",
    slug: "hacktoberfest-hacks-2026",
    shortDescription: "Month-long open source contribution drive. PRs, patches, and community love.",
    organizer: "DigitalOcean & GitHub",
    mode: "ONLINE",
    location: null,
    status: "UPCOMING",
    visibility: "PUBLIC",
    startDate: new Date("2026-10-01T00:00:00Z"),
    endDate: new Date("2026-10-31T23:59:00Z"),
    registrationDeadline: new Date("2026-10-31T23:59:00Z"),
    prizePool: "Exclusive swag + tree planting",
    minTeamSize: 1,
    maxTeamSize: 1,
    registrationPlatform: "CUSTOM",
    registrationType: "INDIVIDUAL",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "OPEN_SOURCE",
    difficulty: "OPEN",
    certificateType: "PARTICIPATION",
    website: "https://hacktoberfest.com",
    registrationLink: "https://hacktoberfest.com/register",
    categorySlugs: ["open-source", "dev-tools", "web-dev"],
    technologySlugs: ["react", "python", "golang", "rust", "docker", "github-actions"],
    eligibilities: ["OPEN"],
    ownerIndex: 4,
    members: [],
  },

  // ─────────────────────────────────────────────────────────────
  // 14. Fictional — Robotics + IoT (Offline, College, Paid)
  // ─────────────────────────────────────────────────────────────
  {
    title: "RoboRumble: Hardware Competition",
    slug: "roborumble-hardware-2026",
    shortDescription: "Build robots, drones, and IoT devices. Soldering stations provided. Get your hands dirty.",
    organizer: "IEEE Student Branch, IIT Madras",
    mode: "OFFLINE",
    location: "Chennai, India",
    status: "REGISTRATION_CLOSED",
    visibility: "PUBLIC",
    startDate: new Date("2026-08-10T09:00:00Z"),
    endDate: new Date("2026-08-12T18:00:00Z"),
    registrationDeadline: new Date("2026-07-25T23:59:00Z"),
    prizePool: "₹2,00,000 + hardware kits",
    minTeamSize: 2,
    maxTeamSize: 5,
    registrationPlatform: "UNSTOP",
    registrationType: "TEAM",
    registrationFeeType: "PAID",
    registrationFee: "₹300 per person",
    organizerType: "COLLEGE",
    difficulty: "ADVANCED",
    certificateType: "PARTICIPATION",
    website: null,
    registrationLink: null,
    categorySlugs: ["robotics", "iot"],
    technologySlugs: ["python", "arduino", "raspberry-pi", "rust"],
    eligibilities: ["UNDERGRADUATE", "POSTGRADUATE", "ENGINEERING"],
    ownerIndex: 5,
    members: [{ userIndex: 3, role: "ORGANIZER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 15. Fictional — FinTech + Blockchain (Hybrid, Paid)
  // ─────────────────────────────────────────────────────────────
  {
    title: "DeFi Builders Summit",
    slug: "defi-builders-summit-2026",
    shortDescription: "Build the next generation of DeFi protocols. $100K in bounties from top protocols.",
    organizer: "DeFi Alliance",
    mode: "HYBRID",
    location: "Singapore + Online",
    status: "ONGOING",
    visibility: "PUBLIC",
    startDate: new Date("2026-07-22T09:00:00Z"),
    endDate: new Date("2026-08-05T23:59:00Z"),
    registrationDeadline: new Date("2026-07-21T23:59:00Z"),
    prizePool: "$100,000",
    minTeamSize: 1,
    maxTeamSize: 5,
    registrationPlatform: "DORAHACKS",
    registrationType: "BOTH",
    registrationFeeType: "PAID",
    registrationFee: "$50 (refundable on submission)",
    organizerType: "COMMUNITY",
    difficulty: "ADVANCED",
    certificateType: "NONE",
    website: null,
    registrationLink: null,
    categorySlugs: ["web3", "fintech"],
    technologySlugs: ["solidity", "ethereum", "solana", "rust", "react", "graphql"],
    eligibilities: ["PROFESSIONAL", "POSTGRADUATE", "ENGINEERING"],
    ownerIndex: 2, // Sara (blockchain)
    members: [{ userIndex: 7, role: "MAINTAINER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 16. Fictional — HealthTech (Hybrid, Non-Profit)
  // ─────────────────────────────────────────────────────────────
  {
    title: "MedHack: Healthcare Innovation Sprint",
    slug: "medhack-healthcare-2026",
    shortDescription: "Doctors meet developers. Solve real healthcare challenges with technology.",
    organizer: "Health Innovation Foundation",
    mode: "HYBRID",
    location: "Mumbai, India + Online",
    status: "ONGOING",
    visibility: "PUBLIC",
    startDate: new Date("2026-07-18T09:00:00Z"),
    endDate: new Date("2026-07-30T18:00:00Z"),
    registrationDeadline: new Date("2026-07-17T23:59:00Z"),
    prizePool: "₹8,00,000 + incubation support",
    minTeamSize: 3,
    maxTeamSize: 6,
    registrationPlatform: "DEVFOLIO",
    registrationType: "TEAM",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "NON_PROFIT",
    difficulty: "INTERMEDIATE",
    certificateType: "PARTICIPATION",
    website: null,
    registrationLink: null,
    categorySlugs: ["healthtech", "ai", "data-science"],
    technologySlugs: ["python", "pytorch", "fastapi", "react", "postgresql", "docker"],
    eligibilities: ["UNDERGRADUATE", "POSTGRADUATE", "MEDICAL", "ENGINEERING", "PROFESSIONAL"],
    ownerIndex: 7, // James (data scientist)
    members: [{ userIndex: 1, role: "ORGANIZER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 17. Fictional — COMPLETED (Archived visibility)
  // ─────────────────────────────────────────────────────────────
  {
    title: "BuildWithAI India 2025",
    slug: "buildwithai-india-2025",
    shortDescription: "Google's AI competition for Indian developers. Build solutions using Gemini API.",
    organizer: "Google Developer Groups India",
    mode: "HYBRID",
    location: "Bangalore, India + Online",
    status: "COMPLETED",
    visibility: "ARCHIVED",
    startDate: new Date("2025-11-15T09:00:00Z"),
    endDate: new Date("2025-11-17T18:00:00Z"),
    registrationDeadline: new Date("2025-11-01T23:59:00Z"),
    prizePool: "$30,000",
    minTeamSize: 2,
    maxTeamSize: 4,
    registrationPlatform: "DEVFOLIO",
    registrationType: "TEAM",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "COMPANY",
    difficulty: "INTERMEDIATE",
    certificateType: "PARTICIPATION",
    website: null,
    registrationLink: null,
    categorySlugs: ["ai", "genai-llms", "mobile-dev"],
    technologySlugs: ["flutter", "python", "tensorflow", "firebase", "gcp"],
    eligibilities: ["UNDERGRADUATE", "POSTGRADUATE", "ENGINEERING", "FRESHER"],
    ownerIndex: 1,
    members: [{ userIndex: 0, role: "ORGANIZER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 18. Fictional — COMPLETED (old, public)
  // ─────────────────────────────────────────────────────────────
  {
    title: "Solana Summer Competition 2025",
    slug: "solana-summer-2025",
    shortDescription: "Build on Solana. The fastest blockchain competition of the summer.",
    organizer: "Solana Foundation",
    mode: "ONLINE",
    location: null,
    status: "COMPLETED",
    visibility: "PUBLIC",
    startDate: new Date("2025-06-01T00:00:00Z"),
    endDate: new Date("2025-06-30T23:59:00Z"),
    registrationDeadline: new Date("2025-06-01T00:00:00Z"),
    prizePool: "$500,000",
    minTeamSize: 1,
    maxTeamSize: 5,
    registrationPlatform: "DORAHACKS",
    registrationType: "BOTH",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "OPEN_SOURCE",
    difficulty: "OPEN",
    certificateType: "NONE",
    website: "https://solana.com/competition",
    registrationLink: null,
    categorySlugs: ["web3", "fintech", "gaming-ar-vr"],
    technologySlugs: ["solana", "rust", "react", "nodejs"],
    eligibilities: ["OPEN"],
    ownerIndex: 2,
    members: [],
  },

  // ─────────────────────────────────────────────────────────────
  // 19. Fictional — CANCELLED (edge case)
  // ─────────────────────────────────────────────────────────────
  {
    title: "HackNova 2026 (Cancelled)",
    slug: "hacknova-2026-cancelled",
    shortDescription: "Was planned as a mega competition but cancelled due to venue issues.",
    organizer: "NovaTech Events",
    mode: "OFFLINE",
    location: "Delhi, India",
    status: "CANCELLED",
    visibility: "PUBLIC",
    startDate: new Date("2026-09-05T09:00:00Z"),
    endDate: new Date("2026-09-07T18:00:00Z"),
    registrationDeadline: new Date("2026-08-25T23:59:00Z"),
    prizePool: "₹15,00,000",
    minTeamSize: 2,
    maxTeamSize: 5,
    registrationPlatform: "UNSTOP",
    registrationType: "TEAM",
    registrationFeeType: "CONDITIONAL",
    registrationFee: "₹100 (early bird free)",
    organizerType: "STARTUP",
    difficulty: "INTERMEDIATE",
    certificateType: "PARTICIPATION",
    website: null,
    registrationLink: null,
    categorySlugs: ["ai", "web-dev", "mobile-dev"],
    technologySlugs: ["react", "flutter", "python", "nodejs"],
    eligibilities: ["UNDERGRADUATE", "POSTGRADUATE"],
    ownerIndex: 0,
    members: [],
  },

  // ─────────────────────────────────────────────────────────────
  // 20. Fictional — PRIVATE visibility (test hidden)
  // ─────────────────────────────────────────────────────────────
  {
    title: "Internal Company Competition: Q4",
    slug: "internal-company-hack-q4",
    shortDescription: "Private internal competition for employees only. Innovation week.",
    organizer: "TechCorp Internal",
    mode: "HYBRID",
    location: "Office + Remote",
    status: "UPCOMING",
    visibility: "UNLISTED", // DB enum doesn't have PRIVATE yet (not migrated)
    startDate: new Date("2026-12-01T09:00:00Z"),
    endDate: new Date("2026-12-03T18:00:00Z"),
    registrationDeadline: new Date("2026-11-25T23:59:00Z"),
    prizePool: null,
    minTeamSize: 2,
    maxTeamSize: 6,
    registrationPlatform: "KIZUNIA",
    registrationType: "TEAM",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "COMPANY",
    difficulty: "OPEN",
    certificateType: "NONE",
    website: null,
    registrationLink: null,
    categorySlugs: ["dev-tools", "cloud-devops"],
    technologySlugs: ["react", "nextjs", "golang", "kubernetes", "docker"],
    eligibilities: ["PROFESSIONAL"],
    ownerIndex: 4,
    members: [{ userIndex: 7, role: "MAINTAINER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 21. Fictional — UNLISTED (test unlisted filter)
  // ─────────────────────────────────────────────────────────────
  {
    title: "Stealth Mode AI Buildathon",
    slug: "stealth-ai-buildathon",
    shortDescription: "Invite-only AI competition. Top builders only. Unlisted.",
    organizer: "Stealth AI Labs",
    mode: "ONLINE",
    location: null,
    status: "REGISTRATION_OPEN",
    visibility: "UNLISTED",
    startDate: new Date("2026-09-10T00:00:00Z"),
    endDate: new Date("2026-09-12T23:59:00Z"),
    registrationDeadline: new Date("2026-09-08T23:59:00Z"),
    prizePool: "$50,000",
    minTeamSize: 1,
    maxTeamSize: 3,
    registrationPlatform: "KIZUNIA",
    registrationType: "BOTH",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "STARTUP",
    difficulty: "ADVANCED",
    certificateType: "NONE",
    website: null,
    registrationLink: null,
    categorySlugs: ["ai", "genai-llms"],
    technologySlugs: ["python", "pytorch", "langchain", "openai-api", "huggingface"],
    eligibilities: ["PROFESSIONAL", "PHD"],
    ownerIndex: 7, // James (PhD)
    members: [{ userIndex: 1, role: "ORGANIZER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 22. Fictional — UNLISTED, COMPLETED
  // ─────────────────────────────────────────────────────────────
  {
    title: "NIT Warangal CodeSprint 2025",
    slug: "nitw-codesprint-2025",
    shortDescription: "Annual inter-college coding competition by NIT Warangal ACM chapter.",
    organizer: "ACM Student Chapter, NIT Warangal",
    mode: "OFFLINE",
    location: "Warangal, Telangana, India",
    status: "COMPLETED",
    visibility: "UNLISTED",
    startDate: new Date("2025-09-15T09:00:00Z"),
    endDate: new Date("2025-09-16T18:00:00Z"),
    registrationDeadline: new Date("2025-09-01T23:59:00Z"),
    prizePool: "₹1,00,000",
    minTeamSize: 2,
    maxTeamSize: 3,
    registrationPlatform: "HACK2SKILL",
    registrationType: "TEAM",
    registrationFeeType: "CONDITIONAL",
    registrationFee: "Free for NIT students, ₹150 for others",
    organizerType: "COLLEGE",
    difficulty: "INTERMEDIATE",
    certificateType: "PARTICIPATION",
    website: null,
    registrationLink: null,
    categorySlugs: ["web-dev", "data-science", "dev-tools"],
    technologySlugs: ["python", "java", "react", "postgresql", "mongodb"],
    eligibilities: ["UNDERGRADUATE", "ENGINEERING"],
    ownerIndex: 5,
    members: [{ userIndex: 3, role: "MAINTAINER" }],
  },

  // ─────────────────────────────────────────────────────────────
  // 23. Fictional — Individual-only, Government organizer
  // ─────────────────────────────────────────────────────────────
  {
    title: "Digital India Innovation Challenge",
    slug: "digital-india-innovation-2026",
    shortDescription: "Solo challenge by MeitY. Build digital solutions for rural India.",
    organizer: "MeitY, Govt of India",
    mode: "ONLINE",
    location: null,
    status: "ONGOING",
    visibility: "PUBLIC",
    startDate: new Date("2026-07-01T00:00:00Z"),
    endDate: new Date("2026-09-30T23:59:00Z"),
    registrationDeadline: new Date("2026-08-15T23:59:00Z"),
    prizePool: "₹25,00,000 + incubation",
    minTeamSize: 1,
    maxTeamSize: 1,
    registrationPlatform: "GOOGLE_FORM",
    registrationType: "INDIVIDUAL",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "GOVERNMENT",
    difficulty: "OPEN",
    certificateType: "PARTICIPATION",
    website: "https://innovateindia.mygov.in",
    registrationLink: null,
    categorySlugs: ["social-impact", "edtech", "healthtech", "sustainability"],
    technologySlugs: ["python", "react", "flutter", "firebase", "nodejs"],
    eligibilities: ["OPEN"],
    ownerIndex: 0,
    members: [],
  },

  // ─────────────────────────────────────────────────────────────
  // 24. Fictional — Gaming / AR-VR (Paid, Individual organizer)
  // ─────────────────────────────────────────────────────────────
  {
    title: "MetaVerse Game Jam 2026",
    slug: "metaverse-game-jam-2026",
    shortDescription: "Build immersive VR/AR games in 72 hours. Unity + Unreal + WebXR welcome.",
    organizer: "GameDev Guru (Indie organizer)",
    mode: "ONLINE",
    location: null,
    status: "REGISTRATION_OPEN",
    visibility: "PUBLIC",
    startDate: new Date("2026-10-20T00:00:00Z"),
    endDate: new Date("2026-10-23T23:59:00Z"),
    registrationDeadline: new Date("2026-10-18T23:59:00Z"),
    prizePool: "$8,000",
    minTeamSize: 1,
    maxTeamSize: 4,
    registrationPlatform: "DEVPOST",
    registrationType: "BOTH",
    registrationFeeType: "PAID",
    registrationFee: "$10 per person",
    organizerType: "INDIVIDUAL",
    difficulty: "INTERMEDIATE",
    certificateType: "WINNER",
    website: null,
    registrationLink: null,
    categorySlugs: ["gaming-ar-vr", "design-ux"],
    technologySlugs: ["webassembly", "react", "figma"],
    eligibilities: ["OPEN"],
    ownerIndex: 6,
    members: [],
  },

  // ─────────────────────────────────────────────────────────────
  // 25. Fictional — School-eligible (Beginner, Free, Hybrid)
  // ─────────────────────────────────────────────────────────────
  {
    title: "Young Innovators Competition",
    slug: "young-innovators-competition-2026",
    shortDescription: "For school and college students. Build your first app with mentorship and workshops.",
    organizer: "Atal Innovation Mission",
    mode: "HYBRID",
    location: "Pan-India (ATL Labs) + Online",
    status: "REGISTRATION_OPEN",
    visibility: "PUBLIC",
    startDate: new Date("2026-09-15T09:00:00Z"),
    endDate: new Date("2026-09-17T18:00:00Z"),
    registrationDeadline: new Date("2026-09-10T23:59:00Z"),
    prizePool: "₹2,50,000 + innovation kits",
    minTeamSize: 2,
    maxTeamSize: 5,
    registrationPlatform: "CUSTOM",
    registrationType: "TEAM",
    registrationFeeType: "FREE",
    registrationFee: null,
    organizerType: "GOVERNMENT",
    difficulty: "BEGINNER",
    certificateType: "PARTICIPATION",
    website: "https://aim.gov.in",
    registrationLink: null,
    categorySlugs: ["edtech", "social-impact", "iot", "sustainability"],
    technologySlugs: ["python", "arduino", "react", "flutter"],
    eligibilities: ["SCHOOL", "UNDERGRADUATE", "SCIENCE", "ENGINEERING"],
    ownerIndex: 0,
    members: [{ userIndex: 6, role: "ORGANIZER" }],
  },
];

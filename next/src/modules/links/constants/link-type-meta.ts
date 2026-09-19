import {
  ClipboardList,
  Figma,
  FileText,
  Github,
  Gitlab,
  Globe,
  Instagram,
  Linkedin,
  Link as LinkIcon,
  MessageCircle,
  Rocket,
  Trophy,
  Twitter,
  User,
  Youtube,
  type LucideIcon,
} from "lucide-react";

import { LinkType } from "@/generated/prisma";

export interface LinkTypeMeta {
  label: string;
  icon: LucideIcon;
}

/**
 * Presentation metadata for `LinkType`. V1 icons are derived purely from the
 * type — there is no per-link custom icon.
 */
export const LINK_TYPE_META: Record<LinkType, LinkTypeMeta> = {
  WEBSITE: { label: "Website", icon: Globe },
  REGISTRATION: { label: "Registration", icon: ClipboardList },
  GITHUB: { label: "GitHub", icon: Github },
  GITLAB: { label: "GitLab", icon: Gitlab },
  DEMO: { label: "Demo", icon: Rocket },
  DOCUMENTATION: { label: "Documentation", icon: FileText },
  FIGMA: { label: "Figma", icon: Figma },
  DEVPOST: { label: "Devpost", icon: Trophy },
  DEVFOLIO: { label: "Devfolio", icon: Trophy },
  UNSTOP: { label: "Unstop", icon: Trophy },
  LINKEDIN: { label: "LinkedIn", icon: Linkedin },
  TWITTER: { label: "Twitter / X", icon: Twitter },
  INSTAGRAM: { label: "Instagram", icon: Instagram },
  DISCORD: { label: "Discord", icon: MessageCircle },
  YOUTUBE: { label: "YouTube", icon: Youtube },
  PORTFOLIO: { label: "Portfolio", icon: User },
  OTHER: { label: "Other", icon: LinkIcon },
};

"use client";

import type { PublicSiteContent } from "@repo/contracts";
import { UJJWAL_KIDS_THEME } from "@/components/sites/presets";

/**
 * The starter site a new org gets from the editor's empty state (the TASKS
 * "starter-content generator" item). Deliberately factual-minimal: no
 * invented stats, no stock claims — just the school's name in a valid
 * skeleton the staff then fills in. Anchors on the linkable sections match
 * the starter nav hrefs.
 */
export function buildStarterContent(orgName: string): PublicSiteContent {
  const name = orgName.trim() || "Our School";
  return {
    chrome: { orgName: name },
    nav: [
      { label: "About", href: "#about" },
      { label: "Programs", href: "#programs" },
      { label: "Contact", href: "#contact" },
    ],
    theme: { ...UJJWAL_KIDS_THEME },
    sections: [
      {
        key: "hero",
        content: {
          ribbon: "Admissions open",
          title: `Welcome to ${name}`,
          subtitle: "Replace this line with one sentence about your school.",
          images: [],
          ctas: [],
        },
      },
      {
        key: "about",
        id: "about",
        content: {
          title: "About our school",
          body: "Write two or three sentences about your school here.",
          images: [],
          ctas: [],
        },
      },
      {
        key: "cardGrid",
        id: "programs",
        content: {
          title: "Our programs",
          cards: [{ title: "New program", description: "Describe this program." }],
        },
      },
      {
        key: "contact",
        id: "contact",
        content: {
          title: "Contact us",
          address: "",
          email: "office@example.com",
          phones: ["+91 90000 00000"],
          hours: "",
        },
      },
    ],
    footer: { copyright: `© ${new Date().getFullYear()} ${name}`, columns: [], social: [] },
  };
}

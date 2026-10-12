"use client";

import type { PublicSiteContent, SiteTheme } from "@repo/contracts";
import { UJJWAL_KIDS_THEME } from "@/components/sites/presets";

/**
 * The Playful Kindergarten template's sample page — the thing a new org
 * actually receives. Same 15-section skeleton as the design reference
 * (hero, stats, seven card grids, faculty, gallery, FAQ, CTA banner,
 * contact), same nav/footer shape, but every word is generic SAMPLE content
 * and every photo a neutral placeholder. Written fresh from the design; it
 * never reads any org's row (a template must not derive from its children).
 *
 * Honesty rules for this file: no real-sounding claims (stats are marked
 * sample, achievers are "Sample achiever"), contact details are obvious
 * placeholders, and the hero ribbon brands the whole draft unfinished until
 * the school replaces it. A hasty publish must look unfinished, never false.
 */

const PH = "/sites/placeholders";
const SAMPLE_PHOTO_ALT = "Sample photo — replace with a school photo";

export function buildTemplateStarter(orgName: string, theme?: SiteTheme): PublicSiteContent {
  const name = orgName.trim() || "Our School";
  const year = new Date().getFullYear();
  return {
    chrome: {
      orgName: name,
      topbar: {
        phone: "+91 90000 00000",
        email: "office@example.com",
        hours: "Mon - Sat: 9:00 AM - 4:00 PM",
      },
    },
    nav: [
      { label: "Home", href: "#top" },
      { label: "Programs", href: "#programs" },
      { label: "Campuses", href: "#campuses" },
      { label: "Achievements", href: "#achievements" },
      { label: "Projects", href: "#projects" },
      { label: "Gallery", href: "#gallery" },
      { label: "FAQ", href: "#faq" },
      { label: "Contact", href: "#contact" },
    ],
    theme: theme ? { ...theme } : { ...UJJWAL_KIDS_THEME },
    sections: [
      {
        key: "hero",
        content: {
          ribbon: "SAMPLE CONTENT — replace before publishing",
          title: `Welcome to ${name}`,
          subtitle:
            "Sample subtitle — replace with one sentence about your school: what you teach, whom you serve, what makes mornings here good.",
          images: [
            { url: `${PH}/placeholder-1.svg`, alt: SAMPLE_PHOTO_ALT },
            { url: `${PH}/placeholder-2.svg`, alt: SAMPLE_PHOTO_ALT },
          ],
          ctas: [
            { label: "Apply for Admission", href: "#contact", style: "primary" },
            { label: "Explore Programs", href: "#programs", style: "secondary" },
          ],
        },
      },
      {
        key: "stats",
        content: {
          items: [
            { value: "10+", label: "Sample stat — replace" },
            { value: "5+", label: "Sample stat — replace" },
            { value: "9+", label: "Sample stat — replace" },
            { value: "100%", label: "Sample stat — replace" },
          ],
        },
      },
      {
        key: "cardGrid",
        id: "campus-life",
        content: {
          title: "Campus Life",
          subtitle: "Sample subtitle — replace with a line about a day at your school.",
          cards: [
            {
              title: "Sample event",
              description: "Sample card — replace with a real moment from your campus.",
              imageUrl: `${PH}/placeholder-1.svg`,
              imageAlt: SAMPLE_PHOTO_ALT,
            },
            {
              title: "Sample activity",
              description: "Sample card — replace with a real moment from your campus.",
              imageUrl: `${PH}/placeholder-2.svg`,
              imageAlt: SAMPLE_PHOTO_ALT,
            },
            {
              title: "Sample celebration",
              description: "Sample card — replace with a real moment from your campus.",
              imageUrl: `${PH}/placeholder-3.svg`,
              imageAlt: SAMPLE_PHOTO_ALT,
            },
          ],
        },
      },
      {
        key: "cardGrid",
        id: "programs",
        content: {
          title: "Our Programs",
          subtitle: "Sample subtitle — replace with a line about what your school teaches.",
          cards: [
            {
              title: "Sample program",
              badge: "Sample tag",
              description: "Sample card — replace with a real program: what it covers, whom it is for.",
              bullets: ["Sample highlight — replace", "Sample highlight — replace"],
            },
            {
              title: "Sample program",
              badge: "Sample tag",
              description: "Sample card — replace with a real program: what it covers, whom it is for.",
              bullets: ["Sample highlight — replace", "Sample highlight — replace"],
            },
            {
              title: "Sample program",
              badge: "Sample tag",
              description: "Sample card — replace with a real program: what it covers, whom it is for.",
              bullets: ["Sample highlight — replace", "Sample highlight — replace"],
            },
          ],
        },
      },
      {
        key: "cardGrid",
        id: "tech-programs",
        content: {
          title: "Skill Programs",
          subtitle: "Sample subtitle — replace, or delete this grid if your school has no skill courses.",
          cards: [
            {
              title: "Sample skill course",
              badge: "Sample tag",
              description: "Sample card — replace with a real course, or remove this grid.",
              bullets: ["Sample highlight — replace", "Sample highlight — replace"],
            },
            {
              title: "Sample skill course",
              badge: "Sample tag",
              description: "Sample card — replace with a real course, or remove this grid.",
              bullets: ["Sample highlight — replace", "Sample highlight — replace"],
            },
          ],
        },
      },
      {
        key: "cardGrid",
        id: "difference",
        content: {
          title: `The ${name} Difference`,
          cards: [
            {
              title: "Sample strength",
              description: "Sample card — replace with a real reason families choose your school.",
            },
            {
              title: "Sample strength",
              description: "Sample card — replace with a real reason families choose your school.",
            },
            {
              title: "Sample strength",
              description: "Sample card — replace with a real reason families choose your school.",
            },
          ],
        },
      },
      {
        key: "cardGrid",
        id: "resources",
        content: {
          title: "Resources",
          subtitle: "Sample subtitle — replace, or delete this grid if you have no links to share.",
          cards: [
            {
              title: "Sample resource",
              badge: "Sample link",
              href: "#resources",
              description: "Sample card — replace with a real link families use.",
            },
            {
              title: "Sample resource",
              badge: "Sample link",
              href: "#resources",
              description: "Sample card — replace with a real link families use.",
            },
          ],
        },
      },
      {
        key: "cardGrid",
        id: "campuses",
        content: {
          title: "Our Campuses",
          subtitle: "Sample subtitle — replace; delete extra cards if your school has one campus.",
          cards: [
            {
              title: "Sample campus",
              badge: "Main Campus",
              description: "Sample card — replace with your real campus and its facilities.",
              bullets: ["Sample facility — replace", "Sample facility — replace"],
            },
            {
              title: "Sample campus",
              badge: "Sample tag",
              description: "Sample card — replace with your real campus, or delete it.",
              bullets: ["Sample facility — replace", "Sample facility — replace"],
            },
          ],
        },
      },
      {
        key: "cardGrid",
        id: "achievements",
        content: {
          title: "Student Achievements",
          subtitle: "Sample subtitle — replace with real student accomplishments.",
          cards: [
            {
              title: "Sample achiever",
              badge: "Sample class",
              imageUrl: `${PH}/placeholder-3.svg`,
              imageAlt: SAMPLE_PHOTO_ALT,
              description: "Sample card — replace with a real student's real achievement.",
            },
            {
              title: "Sample achiever",
              badge: "Sample class",
              imageUrl: `${PH}/placeholder-1.svg`,
              imageAlt: SAMPLE_PHOTO_ALT,
              description: "Sample card — replace with a real student's real achievement.",
            },
            {
              title: "Sample achiever",
              badge: "Sample class",
              imageUrl: `${PH}/placeholder-2.svg`,
              imageAlt: SAMPLE_PHOTO_ALT,
              description: "Sample card — replace with a real student's real achievement.",
            },
          ],
        },
      },
      {
        key: "cardGrid",
        id: "projects",
        content: {
          title: "Student Projects",
          subtitle:
            "Sample subtitle — replace. Add a YouTube video id to a card to show its video.",
          cards: [
            {
              title: "Sample project",
              badge: "Sample tag",
              // Empty video key on purpose: the editor only renders keys
              // that exist, so without this the YouTube field is unfillable.
              // "" renders no media (falsy) and passes the contract.
              videoId: "",
              description: "Sample card — replace with a real student project.",
            },
            {
              title: "Sample project",
              badge: "Sample tag",
              videoId: "",
              description: "Sample card — replace with a real student project.",
            },
            {
              title: "Sample project",
              badge: "Sample tag",
              videoId: "",
              description: "Sample card — replace with a real student project.",
            },
          ],
        },
      },
      {
        key: "faculty",
        id: "faculty",
        content: {
          title: "Our Faculty",
          subtitle: "Sample subtitle — replace with a line about your teachers.",
          members: [
            {
              name: "Sample Teacher One",
              designation: "Head of School",
              qualification: "Sample entry — replace with real staff",
            },
            {
              name: "Sample Teacher Two",
              designation: "Senior Teacher",
              qualification: "Sample entry — replace with real staff",
            },
            {
              name: "Sample Teacher Three",
              designation: "Subject Coordinator",
              qualification: "Sample entry — replace with real staff",
            },
            {
              name: "Sample Teacher Four",
              designation: "Activity Instructor",
              qualification: "Sample entry — replace with real staff",
            },
          ],
        },
      },
      {
        key: "gallery",
        id: "gallery",
        content: {
          title: "Gallery",
          subtitle: "Sample photos — replace with your school's pictures.",
          images: [
            { url: `${PH}/placeholder-1.svg`, alt: SAMPLE_PHOTO_ALT },
            { url: `${PH}/placeholder-2.svg`, alt: SAMPLE_PHOTO_ALT },
            { url: `${PH}/placeholder-3.svg`, alt: SAMPLE_PHOTO_ALT },
          ],
        },
      },
      {
        key: "faq",
        id: "faq",
        content: {
          title: "Frequently Asked Questions",
          subtitle: "Sample answers — replace with your school's real information.",
          items: [
            {
              question: "What age groups do you accept for admission?",
              answer:
                "Sample answer — replace with your school's real admission age range.",
            },
            {
              question: "What is your admission process?",
              answer: "Sample answer — replace with your school's real admission steps.",
            },
            {
              question: "What curriculum do you follow?",
              answer: "Sample answer — replace with your school's real board and curriculum.",
            },
            {
              question: "Do you offer transportation?",
              answer: "Sample answer — replace with your school's real transport details.",
            },
          ],
        },
      },
      {
        key: "ctaBanner",
        content: {
          title: `Admissions Open at ${name}`,
          subtitle: "Sample line — replace with your admission message.",
          imageUrl: `${PH}/placeholder-2.svg`,
          ctas: [
            { label: "Apply for Admission", href: "#contact", style: "primary" },
            { label: "Call Us", href: "tel:+919000000000", style: "secondary" },
          ],
        },
      },
      {
        key: "contact",
        id: "contact",
        content: {
          title: "Get in Touch",
          subtitle: "Sample line — replace with your welcome message.",
          address: "",
          email: "office@example.com",
          phones: ["+91 90000 00000"],
          hours: "Mon - Sat: 9:00 AM - 4:00 PM",
        },
      },
    ],
    footer: {
      blurb: "Sample line — replace with one sentence about your school.",
      columns: [
        {
          heading: "Quick Links",
          links: [
            { label: "Programs", href: "#programs" },
            { label: "FAQ", href: "#faq" },
            { label: "Projects", href: "#projects" },
          ],
        },
        {
          heading: "Explore",
          links: [
            { label: "Campuses", href: "#campuses" },
            { label: "Achievements", href: "#achievements" },
            { label: "Gallery", href: "#gallery" },
          ],
        },
        {
          heading: "Other Links",
          links: [{ label: "Contact", href: "#contact" }],
        },
      ],
      social: [
        { label: "Facebook", href: "#" },
        { label: "Instagram", href: "#" },
        { label: "YouTube", href: "#" },
      ],
      copyright: `© ${year} ${name}`,
    },
  };
}

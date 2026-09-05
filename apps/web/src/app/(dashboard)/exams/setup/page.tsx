"use client";

import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { copy } from "@/lib/copy";
import { GradingScalesSection } from "@/features/exams/grading-scales-section";
import { PassCriteriaSection } from "@/features/exams/pass-criteria-section";
import { SubjectTypesSection } from "@/features/exams/subject-types-section";

/**
 * EXAM SETUP — the policy screen (S1). Subject types, grading scales, and
 * pass criteria: everything an exam reads before it exists (ADR-032).
 * Three tabs, one per policy layer; each tab is its own section component
 * with the fees-style table + dialog idiom.
 */
export default function ExamSetupPage() {
  return (
    <>
      <PageHeader title={copy.exams.setup.title} description={copy.exams.setup.subtitle} />
      <Tabs defaultValue="types">
        <TabsList>
          <TabsTrigger value="types">{copy.exams.setup.tabs.types}</TabsTrigger>
          <TabsTrigger value="scales">{copy.exams.setup.tabs.scales}</TabsTrigger>
          <TabsTrigger value="criteria">{copy.exams.setup.tabs.criteria}</TabsTrigger>
        </TabsList>
        <TabsContent value="types">
          <SubjectTypesSection />
        </TabsContent>
        <TabsContent value="scales">
          <GradingScalesSection />
        </TabsContent>
        <TabsContent value="criteria">
          <PassCriteriaSection />
        </TabsContent>
      </Tabs>
    </>
  );
}
